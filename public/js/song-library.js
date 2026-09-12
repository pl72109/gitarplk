/**
 * Song directory: the sidebar list, the search filter, the rig inspector
 * panel, and the "add song" modal.
 *
 * Knows nothing about AlphaTab - it hands whole song records to the callback
 * passed into `onSelect` and lets app.js wire that to the player.
 */

export class SongLibrary {
  constructor({ onSelect }) {
    this.songs = [];
    this.currentSong = null;
    this.onSelect = onSelect;

    this.els = {
      list: document.getElementById('song-list'),
      search: document.getElementById('song-search'),
      emptyState: document.getElementById('empty-workspace'),
      metaPanel: document.getElementById('song-meta-panel'),
      viewport: document.getElementById('tab-viewport'),

      title: document.getElementById('display-title'),
      artist: document.getElementById('display-artist'),
      status: document.getElementById('display-status'),

      ampTitle: document.getElementById('rig-amp-title'),
      ampKnobs: document.getElementById('rig-amp-knobs'),
      pedalsList: document.getElementById('rig-pedals-list'),
      tuning: document.getElementById('rig-tuning'),
      presetName: document.getElementById('rig-preset-name'),
    };

    this.els.search.addEventListener('input', () => this._applyFilter());
    this._bindModal();
  }

  async load() {
    const response = await fetch('/api/songs');
    this.songs = await response.json();
    this._renderList(this.songs);
  }

  _applyFilter() {
    const query = this.els.search.value.toLowerCase();
    const filtered = this.songs.filter(
      (song) =>
        song.title.toLowerCase().includes(query) || song.artist.toLowerCase().includes(query)
    );
    this._renderList(filtered);
  }

  _renderList(items) {
    this.els.list.innerHTML = '';

    items.forEach((song) => {
      const li = document.createElement('li');
      li.dataset.songId = String(song.id);
      if (this.currentSong && this.currentSong.id === song.id) li.classList.add('active');

      li.innerHTML = `
        <div class="s-info">
          <span class="s-title">${escapeHtml(song.title)}</span>
          <span class="s-artist">${escapeHtml(song.artist)}</span>
        </div>
        <div class="s-tags">
          <span class="badge-format">${formatLabel(song)}</span>
          ${song.status === 'pending' ? '<span class="badge-pending">Pending</span>' : ''}
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
    this._renderList(this._currentFilterResults());
    this._showSong(song);
    this.onSelect(song);
  }

  _currentFilterResults() {
    const query = this.els.search.value.toLowerCase();
    return this.songs.filter(
      (song) =>
        song.title.toLowerCase().includes(query) || song.artist.toLowerCase().includes(query)
    );
  }

  _showSong(song) {
    const { els } = this;
    els.emptyState.classList.add('hidden');
    els.metaPanel.classList.remove('hidden');
    els.viewport.classList.remove('hidden');

    els.title.textContent = song.title;
    els.artist.textContent = song.artist;
    els.status.textContent = (song.status || 'approved').toUpperCase();

    // The rig inspector still reflects the first track's gear. AlphaTab does
    // not model amps or pedals, so this stays project metadata.
    const track = (song.tracks && song.tracks[0]) || {};
    els.tuning.textContent = track.tuning || '—';
    els.presetName.textContent = track.preset || '—';
    els.ampTitle.textContent = track.amp ? track.amp.model : 'Standard Amp';

    els.ampKnobs.innerHTML = '';
    if (track.amp && track.amp.settings) {
      for (const [knob, value] of Object.entries(track.amp.settings)) {
        const unit = document.createElement('div');
        unit.className = 'knob-unit';
        unit.innerHTML = `<span>${escapeHtml(knob)}</span><strong>${escapeHtml(value)}</strong>`;
        els.ampKnobs.appendChild(unit);
      }
    }

    els.pedalsList.innerHTML = '';
    if (track.pedals && track.pedals.length) {
      track.pedals.forEach((pedal) => {
        const row = document.createElement('div');
        row.className = 'pedal-row';
        row.textContent = `• ${pedal.model}`;
        els.pedalsList.appendChild(row);
      });
    } else {
      els.pedalsList.innerHTML = '<span class="muted-note">No Pedals Active</span>';
    }
  }

  /* ------------------------------------------------------------------ *
   * Add-song modal
   * ------------------------------------------------------------------ */

  _bindModal() {
    const modal = document.getElementById('add-song-modal');
    const open = () => modal.classList.remove('hidden');
    const close = () => modal.classList.add('hidden');

    document.getElementById('btn-open-modal').addEventListener('click', open);
    document.getElementById('btn-close-modal').addEventListener('click', close);
    document.getElementById('btn-cancel-modal').addEventListener('click', close);

    // Modal tab navigation
    document.querySelectorAll('.tab-btn').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
        button.classList.add('active');
        document.getElementById(button.dataset.tab).classList.add('active');
      });
    });

    // Score-format switcher inside the modal
    const formatRadios = document.querySelectorAll('input[name="score-format"]');
    formatRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        document.querySelectorAll('.format-pane').forEach((pane) => {
          pane.classList.toggle('active', pane.dataset.format === radio.value);
        });
      });
    });

    // Guitar Pro drop zone
    const dropZone = document.getElementById('gp-dropzone');
    const fileInput = document.getElementById('gp-file');
    const fileLabel = document.getElementById('gp-file-name');

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragging');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragging');
      if (e.dataTransfer.files.length) {
        fileInput.files = e.dataTransfer.files;
        fileLabel.textContent = e.dataTransfer.files[0].name;
      }
    });
    fileInput.addEventListener('change', () => {
      fileLabel.textContent = fileInput.files.length ? fileInput.files[0].name : 'No file chosen';
    });

    // ASCII helpers, carried over from the original editor
    document.getElementById('btn-insert-template').addEventListener('click', () => {
      document.getElementById('new-tab-text').value =
        'e|---------------------------------|---------------------------------|\n' +
        'B|---------------------------------|---------------------------------|\n' +
        'G|---------------------------------|---------------------------------|\n' +
        'D|---------------------------------|---------------------------------|\n' +
        'A|---------------------------------|---------------------------------|\n' +
        'E|---------------------------------|---------------------------------|';
    });

    document.getElementById('btn-insert-bar').addEventListener('click', () => {
      document.getElementById('new-tab-text').value += '|\n';
    });

    document.getElementById('btn-submit-song').addEventListener('click', () => {
      this._submit(close);
    });
  }

  async _submit(onDone) {
    const value = (id) => document.getElementById(id).value.trim();
    const format = document.querySelector('input[name="score-format"]:checked').value;

    const artist = value('new-artist');
    const title = value('new-title');
    if (!artist || !title) return alert('Please fill in Artist and Title.');

    const meta = {
      title,
      artist,
      bpm: parseInt(value('new-bpm'), 10) || 120,
      tracks: [
        {
          instrument: value('new-instrument') || 'Guitar',
          tuning: value('new-tuning'),
          preset: value('new-preset-name') || 'Custom Preset',
          amp: {
            model: value('new-amp-model') || 'Tube Amp',
            settings: {
              Gain: parseInt(value('amp-g'), 10) || 5,
              Bass: parseInt(value('amp-b'), 10) || 5,
              Mid: parseInt(value('amp-m'), 10) || 5,
              Treble: parseInt(value('amp-t'), 10) || 5,
            },
          },
          pedals: value('new-pedal-name')
            .split(',')
            .map((name) => name.trim())
            .filter(Boolean)
            .map((model) => ({ model, settings: {} })),
        },
      ],
    };

    let response;

    if (format === 'gp') {
      // Guitar Pro files go up as multipart so the bytes stay intact.
      const fileInput = document.getElementById('gp-file');
      if (!fileInput.files.length) return alert('Please choose a Guitar Pro file.');

      const body = new FormData();
      body.append('score', fileInput.files[0]);
      body.append('meta', JSON.stringify(meta));
      response = await fetch('/api/songs', { method: 'POST', body });
    } else {
      const payload = { ...meta };
      if (format === 'alphatex') {
        const tex = document.getElementById('new-alphatex').value;
        if (!tex.trim()) return alert('Please enter some alphaTex.');
        payload.source = { format: 'alphatex', data: tex };
      } else {
        const tab = document.getElementById('new-tab-text').value;
        if (!tab.trim()) return alert('Please enter some tablature.');
        payload.source = { format: 'ascii' };
        payload.tracks[0].tab = tab;
      }
      response = await fetch('/api/songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return alert(`Could not save: ${error.error || response.status}`);
    }

    onDone();
    await this.load();
  }
}

/** Small badge showing which importer a song will go through. */
function formatLabel(song) {
  const format = song.source && song.source.format;
  if (format === 'gp') return 'GP';
  if (format === 'alphatex') return 'TEX';
  return 'ASCII';
}

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
  );
}
