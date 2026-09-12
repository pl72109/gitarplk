/**
 * Transport bar: play / pause / stop, progress + seeking, speed, zoom.
 *
 * Pure UI - all state lives in the AlphaTabPlayer instance it is handed.
 */

const ZOOM_STEPS = [0.5, 0.6, 0.75, 0.9, 1.0, 1.15, 1.3, 1.5, 1.75, 2.0];

export class TransportBar {
  constructor(player, root) {
    this.player = player;
    this.root = root;
    this.zoomIndex = ZOOM_STEPS.indexOf(1.0);
    this.isScrubbing = false;

    this.els = {
      playPause: root.querySelector('#tp-play-pause'),
      stop: root.querySelector('#tp-stop'),
      progress: root.querySelector('#tp-progress'),
      progressFill: root.querySelector('#tp-progress-fill'),
      timeCurrent: root.querySelector('#tp-time-current'),
      timeTotal: root.querySelector('#tp-time-total'),
      speed: root.querySelector('#tp-speed'),
      speedLabel: root.querySelector('#tp-speed-label'),
      zoomIn: root.querySelector('#tp-zoom-in'),
      zoomOut: root.querySelector('#tp-zoom-out'),
      zoomLabel: root.querySelector('#tp-zoom-label'),
      metronome: root.querySelector('#tp-metronome'),
      loop: root.querySelector('#tp-loop'),
      status: root.querySelector('#tp-status'),
    };

    this._bindControls();
    this._bindPlayerEvents();
    this.setEnabled(false);
  }

  /* ------------------------------------------------------------------ *
   * DOM -> player
   * ------------------------------------------------------------------ */

  _bindControls() {
    const { els, player } = this;

    els.playPause.addEventListener('click', () => player.playPause());
    els.stop.addEventListener('click', () => player.stop());

    // Seeking: dragging updates the bar locally, and only on release do we
    // tell the synth, so scrubbing does not stutter the audio.
    els.progress.addEventListener('input', () => {
      this.isScrubbing = true;
      this._paintProgress(Number(els.progress.value) / 1000);
    });
    els.progress.addEventListener('change', () => {
      player.seekToRatio(Number(els.progress.value) / 1000);
      this.isScrubbing = false;
    });

    // Speed: AlphaSynth re-times the MIDI stream, so pitch is preserved.
    els.speed.addEventListener('input', () => {
      const multiplier = Number(els.speed.value) / 100;
      player.setSpeed(multiplier);
      els.speedLabel.textContent = `${els.speed.value}%`;
    });

    els.zoomIn.addEventListener('click', () => this._stepZoom(1));
    els.zoomOut.addEventListener('click', () => this._stepZoom(-1));

    els.metronome.addEventListener('click', () => {
      const active = els.metronome.classList.toggle('active');
      player.setMetronome(active);
    });

    els.loop.addEventListener('click', () => {
      const active = els.loop.classList.toggle('active');
      player.setLooping(active);
    });

    // Space bar is the universal play/pause, except while typing.
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space') return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      player.playPause();
    });
  }

  _stepZoom(direction) {
    const next = this.zoomIndex + direction;
    if (next < 0 || next >= ZOOM_STEPS.length) return;
    this.zoomIndex = next;
    const scale = ZOOM_STEPS[next];
    this.player.setZoom(scale);
    this.els.zoomLabel.textContent = `${Math.round(scale * 100)}%`;
    this.els.zoomOut.disabled = next === 0;
    this.els.zoomIn.disabled = next === ZOOM_STEPS.length - 1;
  }

  /* ------------------------------------------------------------------ *
   * Player -> DOM
   * ------------------------------------------------------------------ */

  _bindPlayerEvents() {
    const { player, els } = this;

    player.on('loading', () => {
      this.setEnabled(false);
      this._setStatus('Loading score…');
      this._paintProgress(0);
    });

    player.on('soundFontProgress', (percent) => {
      if (percent < 100) this._setStatus(`Loading sounds… ${percent}%`);
    });

    // Only now is it safe to call play(): the synth has both a score and a
    // decoded SoundFont.
    player.on('ready', () => {
      this.setEnabled(true);
      this._setStatus('Ready');
    });

    player.on('stateChanged', ({ isPlaying }) => {
      els.playPause.textContent = isPlaying ? '❚❚' : '▶';
      els.playPause.classList.toggle('playing', isPlaying);
      els.playPause.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
      this._setStatus(isPlaying ? 'Playing' : 'Paused');
    });

    player.on('position', ({ currentTime, endTime }) => {
      els.timeCurrent.textContent = formatTime(currentTime);
      els.timeTotal.textContent = formatTime(endTime);
      if (this.isScrubbing || endTime <= 0) return;
      const ratio = currentTime / endTime;
      els.progress.value = String(Math.round(ratio * 1000));
      this._paintProgress(ratio);
    });

    player.on('error', (error) => {
      this.setEnabled(false);
      this._setStatus(`Error: ${error.message || error}`);
    });
  }

  /** Paints the filled portion of the custom progress track. */
  _paintProgress(ratio) {
    this.els.progressFill.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
  }

  _setStatus(text) {
    this.els.status.textContent = text;
  }

  setEnabled(enabled) {
    this.els.playPause.disabled = !enabled;
    this.els.stop.disabled = !enabled;
    this.els.progress.disabled = !enabled;
    this.root.classList.toggle('is-loading', !enabled);
  }
}

function formatTime(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '0:00';
  const total = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
