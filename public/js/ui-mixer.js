/**
 * Track mixer: one row per instrument in the score, with mute, solo, a volume
 * fader and a visibility toggle.
 *
 * Rebuilt from scratch on every `scoreLoaded`, since the track list belongs to
 * the score.
 */

export class TrackMixer {
  constructor(player, listElement, countElement) {
    this.player = player;
    this.listElement = listElement;
    this.countElement = countElement;
    this.visible = new Set(); // track indices currently drawn in the score

    // `score.tracks` is only populated after the score has been parsed.
    player.on('scoreLoaded', (score) => this.render(score));
  }

  render(score) {
    const tracks = Array.from(score.tracks);
    this.listElement.innerHTML = '';
    this.visible = new Set(tracks.map((t) => t.index));

    if (this.countElement) {
      this.countElement.textContent = `${tracks.length} track${tracks.length === 1 ? '' : 's'}`;
    }

    tracks.forEach((track) => {
      this.listElement.appendChild(this._buildRow(track));
    });

    // AlphaTab renders only the first track by default. Draw them all so the
    // score matches the visibility toggles the mixer is showing as active.
    if (tracks.length > 1) this.player.renderTracks(tracks);
  }

  _buildRow(track) {
    const row = document.createElement('div');
    row.className = 'mixer-row';
    row.dataset.trackIndex = String(track.index);

    // `track.name` comes from the file; fall back to the MIDI program.
    const name = track.name || `Track ${track.index + 1}`;

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
