/**
 * Guitar mixer: one row per guitar part in the score, with mute, solo, a
 * volume fader and a visibility toggle.
 *
 * Only guitar tracks reach this component. Bass, drum and other staves are
 * stripped from the score by guitar-tracks.js before `scoreLoaded` fires, so
 * there is deliberately no instrument switch or per-instrument grouping here -
 * every row is a guitar.
 *
 * Rebuilt from scratch on every `scoreLoaded`, since the track list belongs to
 * the score.
 */

export class TrackMixer {
  constructor(player, listElement, countElement, noticeElement) {
    this.player = player;
    this.listElement = listElement;
    this.countElement = countElement;
    this.noticeElement = noticeElement;
    this.visible = new Set(); // track indices currently drawn in the score

    // The payload is already filtered to guitars by AlphaTabPlayer.
    player.on('scoreLoaded', ({ tracks, rejected }) => this.render(tracks, rejected));
  }

  render(tracks, rejected = []) {
    this.listElement.innerHTML = '';
    this.visible = new Set(tracks.map((t) => t.index));

    if (this.countElement) {
      const n = tracks.length;
      this.countElement.textContent = `${n} guitar track${n === 1 ? '' : 's'}`;
    }

    // Tell the user why a multi-track file came in with fewer parts than they
    // expected, rather than letting it look like a failed import.
    if (this.noticeElement) {
      if (rejected.length) {
        const names = rejected.map((r) => r.name).join(', ');
        this.noticeElement.textContent = `Guitar-only: filtered out ${names}`;
        this.noticeElement.classList.remove('hidden');
      } else {
        this.noticeElement.classList.add('hidden');
      }
    }

    tracks.forEach((track) => {
      this.listElement.appendChild(this._buildRow(track));
    });

    // AlphaTab renders only the first track by default. The player already
    // called renderTracks with the full guitar set, so the visibility toggles
    // and the score agree from the start.
  }

  _buildRow(track) {
    const row = document.createElement('div');
    row.className = 'mixer-row';
    row.dataset.trackIndex = String(track.index);

    // `track.name` comes from the file; every row here is a guitar part, so
    // the fallback says so rather than a generic "Track N".
    const name = track.name || `Guitar ${track.index + 1}`;

    row.innerHTML = `
      <button class="mx-visible active" title="Show/hide in score" aria-label="Toggle visibility">◉</button>
      <div class="mx-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
      <button class="mx-mute" title="Mute">M</button>
      <button class="mx-solo" title="Solo">S</button>
      <input class="mx-volume" type="range" min="0" max="150" value="100" title="Volume">
    `;

    const btnVisible = row.querySelector('.mx-visible');
    const btnMute = row.querySelector('.mx-mute');
    const btnSolo = row.querySelector('.mx-solo');
    const volume = row.querySelector('.mx-volume');

    btnMute.addEventListener('click', () => {
      const muted = !this.player.isMuted(track);
      this.player.setTrackMute(track, muted);
      this._syncButtons();
    });

    btnSolo.addEventListener('click', () => {
      const soloed = !this.player.isSoloed(track);
      this.player.setTrackSolo(track, soloed);
      this._syncButtons();
    });

    // 100 on the fader means "as authored"; AlphaTab takes a multiplier.
    volume.addEventListener('input', () => {
      this.player.setTrackVolume(track, Number(volume.value) / 100);
    });

    btnVisible.addEventListener('click', () => {
      this._toggleVisibility(track, btnVisible);
    });

    return row;
  }

  /**
   * Show/hide a track in the rendered score. This is purely visual - a hidden
   * track still plays, which is why it is separate from mute.
   */
  _toggleVisibility(track, button) {
    if (this.visible.has(track.index)) {
      // Never let the last visible track be hidden; AlphaTab would render
      // an empty sheet with no way back.
      if (this.visible.size === 1) return;
      this.visible.delete(track.index);
    } else {
      this.visible.add(track.index);
    }

    button.classList.toggle('active', this.visible.has(track.index));
    this.player.renderTracks(this.player.tracks.filter((t) => this.visible.has(t.index)));
  }

  /**
   * Repaints mute/solo states for every row at once. Solo is exclusive-ish:
   * when any track is soloed, the others read as implicitly silenced.
   */
  _syncButtons() {
    const anySolo = this.player.tracks.some((t) => this.player.isSoloed(t));

    this.listElement.querySelectorAll('.mixer-row').forEach((row) => {
      const index = Number(row.dataset.trackIndex);
      const track = this.player.tracks.find((t) => t.index === index);
      if (!track) return;

      const muted = this.player.isMuted(track);
      const soloed = this.player.isSoloed(track);

      row.querySelector('.mx-mute').classList.toggle('active', muted);
      row.querySelector('.mx-solo').classList.toggle('active', soloed);
      row.classList.toggle('is-silent', anySolo ? !soloed : muted);
    });
  }
}

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
  );
}
