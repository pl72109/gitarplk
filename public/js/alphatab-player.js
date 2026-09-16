/**
 * Thin controller around the AlphaTab API.
 *
 * Everything that touches `alphaTab.*` lives here; the UI modules talk to this
 * class and never to AlphaTab directly. The class is an event emitter of its
 * own so the transport bar and the mixer can subscribe without knowing about
 * AlphaTab's event objects.
 *
 * AlphaTab itself is loaded as a classic script tag in index.html, which makes
 * it available as the `alphaTab` global. The UMD bundle is self-contained: it
 * spawns its web worker (layout) and audio worklet (synth) from its own URL,
 * so no bundler step is required.
 */

import { songToAlphaTex } from './ascii-to-alphatex.js';
import { partitionTracks, describeRejected } from './guitar-tracks.js';

const VENDOR_BASE = '/vendor/alphatab';

export class AlphaTabPlayer {
  /**
   * @param {HTMLElement} renderElement - the element AlphaTab renders into
   * @param {HTMLElement} scrollElement - the scrolling viewport around it
   */
  constructor(renderElement, scrollElement) {
    this.renderElement = renderElement;
    this.scrollElement = scrollElement;
    this.api = null;
    this.score = null;
    this.guitarTracks = []; // the only tracks this app renders or plays
    this.rejectedTracks = []; // non-guitar parts dropped from the score
    this.isReady = false; // true once the SoundFont is decoded and playable
    this._cachedEndTick = 0;
    this._listeners = new Map();
    this._soloed = new Set();
    this._muted = new Set();
  }

  /* ------------------------------------------------------------------ *
   * Minimal event emitter
   * ------------------------------------------------------------------ */

  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return () => this._listeners.get(event).delete(handler);
  }

  _emit(event, payload) {
    const handlers = this._listeners.get(event);
    if (handlers) handlers.forEach((handler) => handler(payload));
  }

  /* ------------------------------------------------------------------ *
   * Initialisation
   * ------------------------------------------------------------------ */

  /**
   * Creates the AlphaTab instance and wires up its events.
   *
   * The settings worth knowing about:
   *  - core.fontDirectory   where the Bravura music font lives. AlphaTab draws
   *                         noteheads/clefs as glyphs from it, so if this path
   *                         is wrong you get a blank or boxy score.
   *  - display.layoutMode   `Page` reflows the score to the container width,
   *                         which is what makes the rendering responsive.
   *  - player.playerMode    `EnabledAutomatic` turns on AlphaSynth. (The older
   *                         `enablePlayer: true` flag is deprecated in 1.8.)
   *  - player.soundFont     URL of the SF2/SF3 bank AlphaSynth renders with.
   *                         Served locally so there is no CDN round trip.
   *  - player.scrollElement the element AlphaTab scrolls to follow the cursor.
   */
  init() {
    if (typeof alphaTab === 'undefined') {
      throw new Error('AlphaTab failed to load - check the /vendor/alphatab mount in server.js');
    }

    this.api = new alphaTab.AlphaTabApi(this.renderElement, {
      core: {
        fontDirectory: `${VENDOR_BASE}/font/`,
      },
      display: {
        layoutMode: alphaTab.LayoutMode.Page, // responsive reflow
        staveProfile: alphaTab.StaveProfile.ScoreTab, // notation + tablature
        scale: 1.0,
        // The app chrome is dark but the score itself sits on light "paper"
        // (#fafafa in style.css) because notation is far more legible that
        // way - so these are dark-on-light, not the app's dark palette.
        resources: {
          staffLineColor: '#8a8a8a',
          barSeparatorColor: '#3a3a3a',
          barNumberColor: '#1565c0',
          mainGlyphColor: '#1a1a1a',
          secondaryGlyphColor: '#666666',
          scoreInfoColor: '#111111',
        },
      },
      player: {
        playerMode: alphaTab.PlayerMode.EnabledAutomatic,
        soundFont: `${VENDOR_BASE}/soundfont/sonivox.sf3`,
        scrollElement: this.scrollElement,
        enableCursor: true, // highlights the current bar
        enableAnimatedBeatCursor: true, // smooth beat-level cursor
        enableElementHighlighting: true, // colours the notes being played
        scrollMode: alphaTab.ScrollMode.Continuous,
        scrollOffsetY: -30,
      },
    });

    this._bindEvents();
    return this;
  }

  _bindEvents() {
    const api = this.api;

    // Fired while the SoundFont downloads. `e.loaded` / `e.total` are bytes.
    api.soundFontLoad.on((e) => {
      const ratio = e.total > 0 ? e.loaded / e.total : 0;
      this._emit('soundFontProgress', Math.round(ratio * 100));
    });

    // Fired once the synth has a decoded SoundFont AND a score: playback is
    // only safe to trigger from here on, so the UI stays disabled until then.
    api.playerReady.on(() => {
      this.isReady = true;
      this._emit('ready');
    });

    // Fired whenever a new score finishes parsing.
    //
    // This is the single choke point where the app becomes guitar-only: an
    // uploaded Guitar Pro file may contain bass, drum and vocal staves, and
    // they are dropped here before anything downstream ever sees them. The
    // mixer is built from `this.guitarTracks`, not from `score.tracks`.
    api.scoreLoaded.on((score) => {
      this.score = score;
      this._cachedEndTick = 0;
      this._soloed.clear();
      this._muted.clear();

      const { guitars, rejected } = partitionTracks(score);
      this.guitarTracks = guitars;
      this.rejectedTracks = rejected;

      if (guitars.length === 0) {
        // Rendering an empty track list leaves a blank sheet with no
        // explanation, so surface this as a real error instead.
        this._emit('error', new Error('This score contains no guitar tracks. GITARPLK is guitar-only.'));
        return;
      }

      this._applyGuitarOnly();

      const notice = describeRejected(rejected);
      if (notice) this._emit('tracksFiltered', notice);

      this._emit('scoreLoaded', { score, tracks: guitars, rejected });
    });

    // Fired on every synth tick during playback (~50ms). Drives the progress
    // bar and the time read-out.
    api.playerPositionChanged.on((e) => {
      this._cachedEndTick = e.endTick; // authoritative once playback has begun
      this._emit('position', {
        currentTime: e.currentTime,
        endTime: e.endTime,
        currentTick: e.currentTick,
        endTick: e.endTick,
      });
    });

    // Fired on play / pause / stop. `e.state` is a PlayerState enum value.
    api.playerStateChanged.on((e) => {
      this._emit('stateChanged', {
        isPlaying: e.state === alphaTab.synth.PlayerState.Playing,
        state: e.state,
      });
    });

    api.renderStarted.on(() => this._emit('renderStarted'));
    api.renderFinished.on(() => this._emit('renderFinished'));

    api.error.on((error) => {
      console.error('[AlphaTab]', error);
      this._emit('error', error);
    });
  }

  /* ------------------------------------------------------------------ *
   * Loading scores
   * ------------------------------------------------------------------ */

  /**
   * Loads a song regardless of which of the three supported formats it uses.
   *
   * @param {object} song - a record from /api/songs
   */
  async load(song) {
    this.isReady = false;
    this._emit('loading', song);

    const source = resolveSource(song);

    switch (source.format) {
      case 'gp':
        // Guitar Pro files are handed over as raw bytes; AlphaTab sniffs the
        // version (gp3/gp4/gp5/gpx/gp7+) itself.
        await this._loadBinary(source.url);
        break;

      case 'alphatex':
        // `tex()` parses alphaTex source directly.
        this.api.tex(source.data);
        break;

      case 'ascii':
      default:
        // Legacy ASCII tab: convert to alphaTex first. See ascii-to-alphatex.js
        // for what survives the translation and what does not.
        this.api.tex(songToAlphaTex(song));
        break;
    }
  }

  async _loadBinary(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not fetch score: ${response.status}`);
    const buffer = await response.arrayBuffer();
    // `load()` accepts an ArrayBuffer/Uint8Array and returns false if the file
    // could not be parsed by any of the importers.
    if (!this.api.load(buffer)) {
      throw new Error('AlphaTab could not parse this file as a Guitar Pro score');
    }
  }

  /* ------------------------------------------------------------------ *
   * Transport
   * ------------------------------------------------------------------ */

  play() {
    if (this.isReady) this.api.play();
  }

  pause() {
    this.api.pause();
  }

  playPause() {
    if (this.isReady) this.api.playPause();
  }

  stop() {
    // Stops playback and rewinds the cursor to the start.
    this.api.stop();
  }

  /** Seek by fraction of the whole song, 0..1 - used by the progress bar. */
  seekToRatio(ratio) {
    const endTick = this._endTick();
    if (!endTick) return;
    const clamped = Math.min(1, Math.max(0, ratio));
    // tickPosition is the MIDI tick; setting it moves both synth and cursor.
    this.api.tickPosition = Math.floor(clamped * endTick);
  }

  /**
   * Total length of the score in MIDI ticks.
   *
   * `playerPositionChanged` reports this, but only once playback has started -
   * seeking before the first play has to derive it from the score instead.
   */
  _endTick() {
    if (this._cachedEndTick) return this._cachedEndTick;
    const bars = this.score && this.score.masterBars;
    if (!bars || bars.length === 0) return 0;
    const lastBar = bars[bars.length - 1];
    this._cachedEndTick = lastBar.start + lastBar.calculateDuration();
    return this._cachedEndTick;
  }

  /**
   * Playback speed as a multiplier (0.5 = half speed). AlphaSynth re-renders
   * the MIDI at the new tempo, so pitch is unaffected - no time-stretching
   * artefacts, unlike resampling an audio file.
   */
  setSpeed(multiplier) {
    this.api.playbackSpeed = multiplier;
  }

  setMasterVolume(volume) {
    this.api.masterVolume = volume;
  }

  setMetronome(enabled) {
    this.api.metronomeVolume = enabled ? 1 : 0;
  }

  setLooping(enabled) {
    this.api.isLooping = enabled;
  }

  /* ------------------------------------------------------------------ *
   * Mixer
   * ------------------------------------------------------------------ */

  /**
   * The guitar tracks, and only those.
   *
   * Everything downstream - the mixer, solo/mute bookkeeping, visibility
   * toggles - reads this rather than `score.tracks`, so a bass or drum staff
   * in an uploaded file can never reappear through one of those paths.
   */
  get tracks() {
    return this.guitarTracks;
  }

  /**
   * Renders only the guitar tracks and hard-mutes everything else.
   *
   * `renderTracks` is purely visual, so a filtered-out bass staff would still
   * be audible without the explicit mute; both calls are needed.
   */
  _applyGuitarOnly() {
    this.api.renderTracks(this.guitarTracks);

    const rejectedNames = new Set(this.rejectedTracks.map((r) => r.name));
    const silenced = Array.from(this.score.tracks).filter(
      (track) => !this.guitarTracks.includes(track)
    );
    if (silenced.length) this.api.changeTrackMute(silenced, true);
    if (rejectedNames.size) {
      console.info('[GITARPLK] non-guitar tracks filtered out:', [...rejectedNames].join(', '));
    }
  }

  setTrackVolume(track, volume) {
    // AlphaTab takes a multiplier where 1 is the track's authored volume.
    this.api.changeTrackVolume([track], volume);
  }

  setTrackMute(track, muted) {
    if (muted) this._muted.add(track.index);
    else this._muted.delete(track.index);
    this._applyMixer();
  }

  setTrackSolo(track, soloed) {
    if (soloed) this._soloed.add(track.index);
    else this._soloed.delete(track.index);
    this._applyMixer();
  }

  isMuted(track) {
    return this._muted.has(track.index);
  }

  isSoloed(track) {
    return this._soloed.has(track.index);
  }

  /**
   * Pushes the whole mute/solo state to AlphaTab in one go.
   *
   * AlphaTab has a native solo flag, but driving both flags from a single
   * source of truth avoids the classic bug where un-soloing a track leaves
   * unrelated tracks silent.
   */
  _applyMixer() {
    const hasSolo = this._soloed.size > 0;
    for (const track of this.tracks) {
      const audible = hasSolo ? this._soloed.has(track.index) : !this._muted.has(track.index);
      this.api.changeTrackMute([track], !audible);
    }
    this._emit('mixerChanged');
  }

  /** Shows only the given tracks in the score view (audio is unaffected). */
  renderTracks(tracks) {
    this.api.renderTracks(tracks);
  }

  /* ------------------------------------------------------------------ *
   * Zoom
   * ------------------------------------------------------------------ */

  /**
   * Changes the stave size. `display.scale` only takes effect after
   * `updateSettings()` followed by a re-render.
   */
  setZoom(scale) {
    this.api.settings.display.scale = scale;
    this.api.updateSettings();
    this.api.render();
  }

  destroy() {
    if (this.api) this.api.destroy();
    this.api = null;
  }
}

/**
 * Normalises the three supported score sources into one shape.
 * Falls back to the legacy ASCII field so pre-existing songs keep working
 * without a migration.
 */
function resolveSource(song) {
  if (song.source && song.source.format) {
    const { format, file, data } = song.source;
    if (format === 'gp') return { format: 'gp', url: `/scores/${file}` };
    if (format === 'alphatex') return { format: 'alphatex', data };
  }
  // No explicit source: this is a legacy record with ASCII tab in tracks[].tab
  return { format: 'ascii' };
}
