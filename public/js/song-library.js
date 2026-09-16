/**
 * Song directory: the sidebar list, the search and artist filters, and the rig
 * inspector panel.
 *
 * Knows nothing about AlphaTab - it hands whole song records to the callback
 * passed into `onSelect` and lets app.js wire that to the player. The "Add
 * Song" modal is a separate component (ui-add-song.js); this class only tells
 * it when to open and reloads the list once it saves.
 *
 * Guitar only: a song record carries one guitar arrangement and one rig, so
 * the inspector reads `song.rig` directly rather than walking a track list.
 */

export class SongLibrary {
  constructor({ onSelect }) {
    this.songs = [];
    this.currentSong = null;
    this.onSelect = onSelect;
    this.artistFilter = null;

    this.els = {
      list: document.getElementById('song-list'),
      search: document.getElementById('song-search'),
      artistFilters: document.getElementById('artist-filters'),
      emptyState: document.getElementById('empty-workspace'),
      noScoreState: document.getElementById('no-score-state'),
      metaPanel: document.getElementById('song-meta-panel'),
      viewport: document.getElementById('tab-viewport'),

      title: document.getElementById('display-title'),
      artist: document.getElementById('display-artist'),
      status: document.getElementById('display-status'),
      album: document.getElementById('display-album'),
      difficulty: document.getElementById('display-difficulty'),
      bpm: document.getElementById('display-bpm'),

      ampTitle: document.getElementById('rig-amp-title'),
      ampKnobs: document.getElementById('rig-amp-knobs'),
      cab: document.getElementById('rig-cab'),
      pedalsList: document.getElementById('rig-pedals-list'),
      tuning: document.getElementById('rig-tuning'),
      capo: document.getElementById('rig-capo'),
      presetName: document.getElementById('rig-preset-name'),
      guitar: document.getElementById('rig-guitar'),
      notes: document.getElementById('rig-notes'),
    };

    this.els.search.addEventListener('input', () => this._renderList());
  }

  async load() {
    const response = await fetch('/api/songs');
    this.songs = await response.json();
    this._renderArtistFilters();
    this._renderList();
  }

  /** Distinct artists in the catalogue, for the quick-filter chips. */
  artists() {
    return [...new Set(this.songs.map((s) => s.artist))].sort();
  }

  _renderArtistFilters() {
    const artists = this.artists();
    this.els.artistFilters.innerHTML = '';

    const makeChip = (label, value) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'artist-chip';
      chip.textContent = label;
      chip.classList.toggle('active', this.artistFilter === value);
      chip.addEventListener('click', () => {
        this.artistFilter = this.artistFilter === value ? null : value;
        this._renderArtistFilters();
        this._renderList();
      });
      this.els.artistFilters.appendChild(chip);
    };

    makeChip(`All (${this.songs.length})`, null);
    artists.forEach((artist) => {
      const count = this.songs.filter((s) => s.artist === artist).length;
      makeChip(`${artist} (${count})`, artist);
    });
  }

  /** Songs matching both the text search and the active artist chip. */
  _visibleSongs() {
    const query = this.els.search.value.toLowerCase();
    return this.songs.filter((song) => {
      if (this.artistFilter && song.artist !== this.artistFilter) return false;
      if (!query) return true;
      return (
        song.title.toLowerCase().includes(query) ||
        song.artist.toLowerCase().includes(query) ||
        (song.album || '').toLowerCase().includes(query) ||
        (song.tuning || '').toLowerCase().includes(query)
      );
    });
  }

  _renderList() {
    const items = this._visibleSongs();
    this.els.list.innerHTML = '';

    if (items.length === 0) {
      this.els.list.innerHTML = '<li class="list-empty">No songs match that filter.</li>';
      return;
    }

    items.forEach((song) => {
      const li = document.createElement('li');
      li.dataset.songId = String(song.id);
      if (this.currentSong && this.currentSong.id === song.id) li.classList.add('active');

      li.innerHTML = `
        <div class="s-info">
          <span class="s-title">${escapeHtml(song.title)}</span>
          <span class="s-artist">${escapeHtml(song.artist)}</span>
          <span class="s-tuning">${escapeHtml(song.tuning || '')}</span>
        </div>
        <div class="s-tags">
          <span class="badge-format">${formatLabel(song)}</span>
          ${statusBadge(song.status)}
        </div>
      `;

      li.addEventListener('click', () => this.select(song.id));
      this.els.list.appendChild(li);
    });
  }

  select(id) {
    const song = this.songs.find((s) => s.id === id);
    if (!song) return;

    this.currentSong = song;
    this._renderList();
    this._showSong(song);

    // A catalogue entry with no attached score has a rig to show but nothing
    // to render, so the player is not invoked at all.
    if (hasPlayableScore(song)) {
      this.onSelect(song);
    }
  }

  _showSong(song) {
    const { els } = this;
    const playable = hasPlayableScore(song);

    els.emptyState.classList.add('hidden');
    els.metaPanel.classList.remove('hidden');
    els.viewport.classList.toggle('hidden', !playable);
    els.noScoreState.classList.toggle('hidden', playable);

    els.title.textContent = song.title;
    els.artist.textContent = song.artist;
    els.status.textContent = (song.status || 'approved').replace('-', ' ').toUpperCase();
    els.status.className = `status-badge status-${song.status || 'approved'}`;

    setChip(els.album, song.album && song.year ? `${song.album} · ${song.year}` : song.album);
    setChip(els.difficulty, song.difficulty);
    setChip(els.bpm, song.bpm ? `${song.bpm} BPM` : '');

    // AlphaTab does not model amps or pedals, so the rig stays project
    // metadata rendered from the song record.
    const rig = song.rig || {};
    els.tuning.textContent = song.tuning || '—';
    els.capo.textContent = song.capo ? `Fret ${song.capo}` : 'None';
    els.presetName.textContent = rig.preset || '—';
    els.guitar.textContent = rig.guitar || '—';
    els.ampTitle.textContent = (rig.amp && rig.amp.model) || 'Standard Amp';
    els.cab.textContent = rig.cab || '';

    els.ampKnobs.innerHTML = '';
    const settings = (rig.amp && rig.amp.settings) || {};
    for (const [knob, value] of Object.entries(settings)) {
      const unit = document.createElement('div');
      unit.className = 'knob-unit';
      unit.innerHTML = `<span>${escapeHtml(knob)}</span><strong>${escapeHtml(value)}</strong>`;
      els.ampKnobs.appendChild(unit);
    }

    els.pedalsList.innerHTML = '';
    if (rig.pedals && rig.pedals.length) {
      rig.pedals.forEach((pedal) => {
        const row = document.createElement('div');
        row.className = 'pedal-row';
        const knobs = Object.entries(pedal.settings || {})
          .map(([knob, value]) => `${knob} ${value}`)
          .join(' · ');
        row.innerHTML = `
          <span class="pedal-name">${escapeHtml(pedal.model)}</span>
          <span class="pedal-type">${escapeHtml(pedal.type || '')}</span>
          ${knobs ? `<span class="pedal-knobs-summary">${escapeHtml(knobs)}</span>` : ''}
        `;
        els.pedalsList.appendChild(row);
      });
    } else {
      els.pedalsList.innerHTML = '<span class="muted-note">No Pedals Active</span>';
    }

    if (rig.notes) {
      els.notes.textContent = rig.notes;
      els.notes.classList.remove('hidden');
    } else {
      els.notes.classList.add('hidden');
    }
  }
}

/** True when the song has something AlphaTab can actually render. */
export function hasPlayableScore(song) {
  const format = song.source && song.source.format;
  if (format === 'gp') return Boolean(song.source.file);
  if (format === 'alphatex') return Boolean(song.source.data);
  if (format === 'ascii') return Boolean(song.tab);
  return false;
}

/** Small badge showing which importer a song will go through. */
function formatLabel(song) {
  const format = song.source && song.source.format;
  if (format === 'gp') return 'GP';
  if (format === 'alphatex') return 'TEX';
  if (format === 'ascii') return 'ASCII';
  return 'RIG';
}

function statusBadge(status) {
  if (status === 'pending') return '<span class="badge-pending">Pending</span>';
  if (status === 'needs-score') return '<span class="badge-needs-score">Needs score</span>';
  return '';
}

function setChip(element, text) {
  element.textContent = text || '';
  element.classList.toggle('hidden', !text);
}

function escapeHtml(text) {
  return String(text ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
  );
}
