/**
 * "Add Song" dashboard.
 *
 * A three-step form - song details, rig, score file - over one song record.
 * It owns the whole modal: step navigation, the rig editor (amp controls and
 * pedalboard), the live rig preview, validation, and the POST to /api/songs.
 *
 * Guitar only. There is no instrument picker, and the tuning list contains
 * only six- to eight-string guitar tunings, so a bass or drum part cannot be
 * entered here in the first place.
 *
 * Picklist contents (tunings, amps, cabs, pedals, amp knob names) come from
 * /api/rig/catalog so the form and the server agree on one vocabulary.
 */

const STEPS = ['tab-info', 'tab-rig', 'tab-score'];

export class AddSongDashboard {
  /**
   * @param {object} options
   * @param {() => Promise<void>} options.onSaved - called after a successful save
   * @param {() => string[]} options.getArtists - existing artists, for autocomplete
   */
  constructor({ onSaved, getArtists }) {
    this.onSaved = onSaved;
    this.getArtists = getArtists || (() => []);

    this.catalog = null;
    this.pedals = []; // the chain being edited: { model, type, settings: [{knob, value}] }
    this.stepIndex = 0;
    this.isSaving = false;

    this.els = {
      modal: document.getElementById('add-song-modal'),
      steps: document.querySelectorAll('.step-item'),
      panes: document.querySelectorAll('.tab-content'),
      prev: document.getElementById('btn-prev-step'),
      next: document.getElementById('btn-next-step'),
      submit: document.getElementById('btn-submit-song'),
      error: document.getElementById('form-error'),

      artist: document.getElementById('new-artist'),
      artistOptions: document.getElementById('artist-options'),
      title: document.getElementById('new-title'),
      album: document.getElementById('new-album'),
      year: document.getElementById('new-year'),
      bpm: document.getElementById('new-bpm'),
      difficulty: document.getElementById('new-difficulty'),
      tuning: document.getElementById('new-tuning'),
      tuningPreview: document.getElementById('tuning-preview'),
      capo: document.getElementById('new-capo'),

      presetName: document.getElementById('new-preset-name'),
      guitarModel: document.getElementById('new-guitar-model'),
      guitarOptions: document.getElementById('guitar-options'),
      ampModel: document.getElementById('new-amp-model'),
      ampOptions: document.getElementById('amp-options'),
      cab: document.getElementById('new-cab'),
      cabOptions: document.getElementById('cab-options'),
      ampKnobs: document.getElementById('amp-knobs'),
      rigNotes: document.getElementById('new-rig-notes'),

      pedalSearch: document.getElementById('pedal-search'),
      pedalSuggestions: document.getElementById('pedal-suggestions'),
      addCustomPedal: document.getElementById('btn-add-custom-pedal'),
      pedalChain: document.getElementById('pedal-chain'),
      pedalEmpty: document.getElementById('pedal-empty'),

      gpDropzone: document.getElementById('gp-dropzone'),
      gpFile: document.getElementById('gp-file'),
      gpFileName: document.getElementById('gp-file-name'),
      alphatex: document.getElementById('new-alphatex'),
      asciiTab: document.getElementById('new-tab-text'),

      pvAmp: document.getElementById('pv-amp'),
      pvKnobs: document.getElementById('pv-knobs'),
      pvCab: document.getElementById('pv-cab'),
      pvPedals: document.getElementById('pv-pedals'),
      pvTuning: document.getElementById('pv-tuning'),
      pvPreset: document.getElementById('pv-preset'),
    };
  }

  /** Fetches the catalog and wires every control. Safe to call once. */
  async init() {
    try {
      const response = await fetch('/api/rig/catalog');
      this.catalog = await response.json();
    } catch (error) {
      console.error('Could not load the rig catalog', error);
      this.catalog = { tunings: [], amps: [], cabs: [], pedals: [], ampKnobs: [] };
    }

    this._populatePicklists();
    this._buildAmpKnobs();
    this._bindChrome();
    this._bindRigEditor();
    this._bindScorePane();
    this._refreshPreview();
    return this;
  }

  /* ------------------------------------------------------------------ *
   * Setup
   * ------------------------------------------------------------------ */

  _populatePicklists() {
    const { tunings = [], amps = [], cabs = [] } = this.catalog;

    this.els.tuning.innerHTML = tunings
      .map((t, i) => `<option value="${i}">${escapeHtml(t.name)}</option>`)
      .join('');

    fillDatalist(this.els.ampOptions, amps);
    fillDatalist(this.els.cabOptions, cabs);
    fillDatalist(this.els.guitarOptions, [
      'Fender Stratocaster',
      'Fender Telecaster',
      'Fender Jaguar',
      'Fender Mustang',
      'Gibson Les Paul',
      'Gibson SG',
      'Dean ML',
      'G&L Rampage',
      'Ibanez RG',
      'Jackson Soloist',
      'Epiphone Les Paul',
    ]);
  }

  /** One labelled 0-10 slider per amp knob named in the catalog. */
  _buildAmpKnobs() {
    const knobs = this.catalog.ampKnobs || ['Gain', 'Bass', 'Mid', 'Treble'];

    this.els.ampKnobs.innerHTML = knobs
      .map(
        (knob) => `
        <div class="knob-control" data-knob="${escapeHtml(knob)}">
          <label for="knob-${slug(knob)}">${escapeHtml(knob)}</label>
          <input type="range" id="knob-${slug(knob)}" min="0" max="10" step="1" value="5">
          <output for="knob-${slug(knob)}">5</output>
        </div>`
      )
      .join('');

    this.els.ampKnobs.querySelectorAll('input[type="range"]').forEach((slider) => {
      slider.addEventListener('input', () => {
        slider.nextElementSibling.textContent = slider.value;
        this._refreshPreview();
      });
    });
  }

  _bindChrome() {
    const { els } = this;

    document.getElementById('btn-open-modal').addEventListener('click', () => this.open());
    document.getElementById('btn-close-modal').addEventListener('click', () => this.close());
    document.getElementById('btn-cancel-modal').addEventListener('click', () => this.close());

    // Click the backdrop (but not the window) to dismiss.
    els.modal.addEventListener('mousedown', (e) => {
      if (e.target === els.modal) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !els.modal.classList.contains('hidden')) this.close();
    });

    els.steps.forEach((step, index) => {
      step.addEventListener('click', () => this._goToStep(index));
    });
    els.prev.addEventListener('click', () => this._goToStep(this.stepIndex - 1));
    els.next.addEventListener('click', () => this._goToStep(this.stepIndex + 1));
    els.submit.addEventListener('click', () => this._submit());

    // Tuning drives the pitch preview shown under the select.
    els.tuning.addEventListener('change', () => {
      const tuning = this._selectedTuning();
      els.tuningPreview.textContent = tuning ? tuning.pitches.join(' ') : '—';
      this._refreshPreview();
    });

    // Suggest a preset name from the artist, so the field is rarely empty.
    els.artist.addEventListener('blur', () => {
      if (!els.presetName.value.trim() && els.artist.value.trim()) {
        els.presetName.value = `${els.artist.value.trim()} tone`;
        this._refreshPreview();
      }
    });
  }

  _bindRigEditor() {
    const { els } = this;

    [els.presetName, els.ampModel, els.cab, els.guitarModel].forEach((input) => {
      input.addEventListener('input', () => this._refreshPreview());
    });

    // Pedal search: filter the catalog as the user types.
    els.pedalSearch.addEventListener('input', () => this._renderPedalSuggestions());
    els.pedalSearch.addEventListener('focus', () => this._renderPedalSuggestions());
    els.pedalSearch.addEventListener('blur', () => {
      // Delay so a click on a suggestion registers before the list closes.
      setTimeout(() => els.pedalSuggestions.classList.remove('open'), 150);
    });

    els.addCustomPedal.addEventListener('click', () => {
      this._addPedal({ model: '', type: 'Overdrive', knobs: [] });
    });
  }

  _bindScorePane() {
    const { els } = this;

    document.querySelectorAll('input[name="score-format"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        document.querySelectorAll('.format-pane').forEach((pane) => {
          pane.classList.toggle('active', pane.dataset.format === radio.value);
        });
        this._clearError();
      });
    });

    els.gpDropzone.addEventListener('click', () => els.gpFile.click());
    els.gpDropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        els.gpFile.click();
      }
    });
    els.gpDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      els.gpDropzone.classList.add('dragging');
    });
    els.gpDropzone.addEventListener('dragleave', () =>
      els.gpDropzone.classList.remove('dragging')
    );
    els.gpDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      els.gpDropzone.classList.remove('dragging');
      if (e.dataTransfer.files.length) {
        els.gpFile.files = e.dataTransfer.files;
        this._showChosenFile();
      }
    });
    els.gpFile.addEventListener('change', () => this._showChosenFile());

    document.getElementById('btn-insert-template').addEventListener('click', () => {
      const line = '-'.repeat(33);
      els.asciiTab.value = ['e', 'B', 'G', 'D', 'A', 'E']
        .map((string) => `${string}|${line}|${line}|`)
        .join('\n');
    });

    document.getElementById('btn-insert-bar').addEventListener('click', () => {
      els.asciiTab.value += '|\n';
    });
  }

  _showChosenFile() {
    const { gpFile, gpFileName } = this.els;
    const chosen = gpFile.files.length ? gpFile.files[0].name : null;
    gpFileName.textContent = chosen || 'No file chosen';
    gpFileName.classList.toggle('has-file', Boolean(chosen));
    this._clearError();
  }

  /* ------------------------------------------------------------------ *
   * Pedalboard
   * ------------------------------------------------------------------ */

  _renderPedalSuggestions() {
    const query = this.els.pedalSearch.value.trim().toLowerCase();
    const all = this.catalog.pedals || [];
    const matches = (query
      ? all.filter(
          (p) => p.model.toLowerCase().includes(query) || p.type.toLowerCase().includes(query)
        )
      : all
    ).slice(0, 8);

    if (matches.length === 0) {
      this.els.pedalSuggestions.classList.remove('open');
      return;
    }

    this.els.pedalSuggestions.innerHTML = matches
      .map(
        (pedal) => `
        <button type="button" class="pedal-suggestion" data-model="${escapeHtml(pedal.model)}">
          <span class="ps-name">${escapeHtml(pedal.model)}</span>
          <span class="ps-type">${escapeHtml(pedal.type)}</span>
        </button>`
      )
      .join('');
    this.els.pedalSuggestions.classList.add('open');

    this.els.pedalSuggestions.querySelectorAll('.pedal-suggestion').forEach((button) => {
      button.addEventListener('click', () => {
        const pedal = all.find((p) => p.model === button.dataset.model);
        if (pedal) this._addPedal(pedal);
        this.els.pedalSearch.value = '';
        this.els.pedalSuggestions.classList.remove('open');
      });
    });
  }

  /** @param {{model: string, type: string, knobs?: string[]}} pedal */
  _addPedal(pedal) {
    this.pedals.push({
      model: pedal.model || '',
      type: pedal.type || 'Utility',
      settings: (pedal.knobs || []).map((knob) => ({ knob, value: '' })),
    });
    this._renderPedalChain();
    this._refreshPreview();
  }

  _renderPedalChain() {
    const { pedalChain, pedalEmpty } = this.els;
    const types = this.catalog.pedalTypes || ['Overdrive', 'Distortion', 'Utility'];

    pedalEmpty.classList.toggle('hidden', this.pedals.length > 0);
    pedalChain.innerHTML = '';

    this.pedals.forEach((pedal, index) => {
      const card = document.createElement('div');
      card.className = 'pedal-card';
      card.innerHTML = `
        <div class="pedal-card-head">
          <span class="pedal-index">${index + 1}</span>
          <input class="pedal-model" type="text" value="${escapeHtml(pedal.model)}"
                 placeholder="Pedal name">
          <select class="pedal-type">
            ${types
              .map(
                (t) =>
                  `<option${t === pedal.type ? ' selected' : ''}>${escapeHtml(t)}</option>`
              )
              .join('')}
          </select>
          <div class="pedal-card-actions">
            <button type="button" class="icon-btn pedal-up" title="Move earlier in the chain"
                    ${index === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="icon-btn pedal-down" title="Move later in the chain"
                    ${index === this.pedals.length - 1 ? 'disabled' : ''}>↓</button>
            <button type="button" class="icon-btn danger pedal-remove" title="Remove">×</button>
          </div>
        </div>
        <div class="pedal-knobs"></div>
        <button type="button" class="sm-btn ghost pedal-add-knob">+ knob</button>
      `;

      const knobsHost = card.querySelector('.pedal-knobs');
      pedal.settings.forEach((setting, knobIndex) => {
        knobsHost.appendChild(this._buildKnobRow(index, knobIndex, setting));
      });

      card.querySelector('.pedal-model').addEventListener('input', (e) => {
        pedal.model = e.target.value;
        this._refreshPreview();
      });
      card.querySelector('.pedal-type').addEventListener('change', (e) => {
        pedal.type = e.target.value;
        this._refreshPreview();
      });
      card.querySelector('.pedal-remove').addEventListener('click', () => {
        this.pedals.splice(index, 1);
        this._renderPedalChain();
        this._refreshPreview();
      });
      card.querySelector('.pedal-up').addEventListener('click', () => this._movePedal(index, -1));
      card.querySelector('.pedal-down').addEventListener('click', () => this._movePedal(index, 1));
      card.querySelector('.pedal-add-knob').addEventListener('click', () => {
        pedal.settings.push({ knob: '', value: '' });
        this._renderPedalChain();
      });

      pedalChain.appendChild(card);
    });
  }

  _buildKnobRow(pedalIndex, knobIndex, setting) {
    const row = document.createElement('div');
    row.className = 'pedal-knob-row';
    row.innerHTML = `
      <input class="pk-name" type="text" value="${escapeHtml(setting.knob)}" placeholder="Knob">
      <input class="pk-value" type="text" value="${escapeHtml(setting.value)}" placeholder="Value">
      <button type="button" class="icon-btn danger pk-remove" title="Remove knob">×</button>
    `;

    row.querySelector('.pk-name').addEventListener('input', (e) => {
      setting.knob = e.target.value;
    });
    row.querySelector('.pk-value').addEventListener('input', (e) => {
      setting.value = e.target.value;
    });
    row.querySelector('.pk-remove').addEventListener('click', () => {
      this.pedals[pedalIndex].settings.splice(knobIndex, 1);
      this._renderPedalChain();
    });

    return row;
  }

  _movePedal(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= this.pedals.length) return;
    const [pedal] = this.pedals.splice(index, 1);
    this.pedals.splice(target, 0, pedal);
    this._renderPedalChain();
    this._refreshPreview();
  }

  /* ------------------------------------------------------------------ *
   * Live preview
   * ------------------------------------------------------------------ */

  _refreshPreview() {
    const { els } = this;
    const rig = this._collectRig();
    const tuning = this._selectedTuning();

    els.pvAmp.textContent = rig.amp.model || 'Custom Tube Amp';
    els.pvCab.textContent = rig.cab || '';
    els.pvPreset.textContent = rig.preset || '—';
    els.pvTuning.textContent = tuning ? tuning.name : '—';

    els.pvKnobs.innerHTML = Object.entries(rig.amp.settings)
      .map(
        ([knob, value]) =>
          `<div class="knob-unit"><span>${escapeHtml(knob)}</span><strong>${value}</strong></div>`
      )
      .join('');

    const named = rig.pedals.filter((p) => p.model);
    els.pvPedals.innerHTML = named.length
      ? named
          .map((p) => `<div class="pedal-row">• ${escapeHtml(p.model)}</div>`)
          .join('')
      : '<span class="muted-note">No Pedals Active</span>';
  }

  /* ------------------------------------------------------------------ *
   * Step navigation
   * ------------------------------------------------------------------ */

  _goToStep(index) {
    const clamped = Math.min(STEPS.length - 1, Math.max(0, index));
    this.stepIndex = clamped;

    this.els.steps.forEach((step, i) => {
      step.classList.toggle('active', i === clamped);
      step.classList.toggle('done', i < clamped);
    });
    this.els.panes.forEach((pane) => {
      pane.classList.toggle('active', pane.id === STEPS[clamped]);
    });

    this.els.prev.disabled = clamped === 0;
    this.els.next.disabled = clamped === STEPS.length - 1;
    this._clearError();
  }

  /* ------------------------------------------------------------------ *
   * Open / close
   * ------------------------------------------------------------------ */

  /** @param {{artist?: string, title?: string}} [prefill] */
  open(prefill = {}) {
    fillDatalist(this.els.artistOptions, unique(this.getArtists()));
    if (prefill.artist) this.els.artist.value = prefill.artist;
    if (prefill.title) this.els.title.value = prefill.title;

    this.els.modal.classList.remove('hidden');
    this._goToStep(0);
    this._refreshPreview();
    this.els.artist.focus();
  }

  close() {
    this.els.modal.classList.add('hidden');
    this._clearError();
  }

  _reset() {
    const { els } = this;
    [
      els.artist, els.title, els.album, els.year,
      els.presetName, els.guitarModel, els.ampModel, els.cab,
      els.rigNotes, els.alphatex, els.asciiTab, els.pedalSearch,
    ].forEach((input) => {
      input.value = '';
    });

    els.bpm.value = '120';
    els.capo.value = '0';
    els.difficulty.value = 'Intermediate';
    els.tuning.selectedIndex = 0;
    els.tuningPreview.textContent = (this._selectedTuning() || { pitches: [] }).pitches.join(' ');
    els.gpFile.value = '';
    this._showChosenFile();

    document.querySelector('input[name="score-format"][value="gp"]').checked = true;
    document.querySelectorAll('.format-pane').forEach((pane) => {
      pane.classList.toggle('active', pane.dataset.format === 'gp');
    });

    this.pedals = [];
    this._renderPedalChain();
    this.els.ampKnobs.querySelectorAll('input[type="range"]').forEach((slider) => {
      slider.value = '5';
      slider.nextElementSibling.textContent = '5';
    });
    this._refreshPreview();
  }

  /* ------------------------------------------------------------------ *
   * Collecting and saving
   * ------------------------------------------------------------------ */

  _selectedTuning() {
    const tunings = this.catalog.tunings || [];
    return tunings[Number(this.els.tuning.value)] || tunings[0] || null;
  }

  _collectRig() {
    const settings = {};
    this.els.ampKnobs.querySelectorAll('.knob-control').forEach((control) => {
      settings[control.dataset.knob] = Number(control.querySelector('input').value);
    });

    return {
      preset: this.els.presetName.value.trim(),
      guitar: this.els.guitarModel.value.trim(),
      amp: { model: this.els.ampModel.value.trim(), settings },
      cab: this.els.cab.value.trim(),
      pedals: this.pedals
        .filter((p) => p.model.trim())
        .map((p) => ({
          model: p.model.trim(),
          type: p.type,
          // Drop half-filled knob rows so the saved record stays clean.
          settings: Object.fromEntries(
            p.settings
              .filter((s) => s.knob.trim() && s.value.trim())
              .map((s) => [s.knob.trim(), s.value.trim()])
          ),
        })),
      notes: this.els.rigNotes.value.trim(),
    };
  }

  _collectMeta() {
    const tuning = this._selectedTuning();
    return {
      title: this.els.title.value.trim(),
      artist: this.els.artist.value.trim(),
      album: this.els.album.value.trim(),
      year: this.els.year.value ? Number(this.els.year.value) : null,
      bpm: Number(this.els.bpm.value) || 120,
      difficulty: this.els.difficulty.value,
      tuning: tuning ? tuning.name : 'Standard (E A D G B E)',
      tuningPitches: tuning ? tuning.pitches : undefined,
      capo: Number(this.els.capo.value) || 0,
      rig: this._collectRig(),
    };
  }

  async _submit() {
    if (this.isSaving) return;

    const format = document.querySelector('input[name="score-format"]:checked').value;
    const meta = this._collectMeta();

    if (!meta.artist || !meta.title) {
      this._goToStep(0);
      return this._showError('Artist and song title are both required.');
    }

    let request;

    if (format === 'gp') {
      if (!this.els.gpFile.files.length) {
        this._goToStep(2);
        return this._showError('Choose a Guitar Pro file, or switch to "Rig only" to save the gear on its own.');
      }
      const body = new FormData();
      body.append('score', this.els.gpFile.files[0]);
      body.append('meta', JSON.stringify(meta));
      request = { method: 'POST', body };
    } else {
      const payload = { ...meta, source: { format } };

      if (format === 'alphatex') {
        const tex = this.els.alphatex.value;
        if (!tex.trim()) {
          this._goToStep(2);
          return this._showError('The alphaTex editor is empty.');
        }
        payload.source.data = tex;
      } else if (format === 'ascii') {
        const tab = this.els.asciiTab.value;
        if (!tab.trim()) {
          this._goToStep(2);
          return this._showError('The tablature editor is empty.');
        }
        payload.tab = tab;
      }

      request = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      };
    }

    this._setSaving(true);
    try {
      const response = await fetch('/api/songs', request);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        return this._showError(body.error || `Save failed (${response.status})`);
      }
      this._reset();
      this.close();
      await this.onSaved();
    } catch (error) {
      this._showError(`Save failed: ${error.message}`);
    } finally {
      this._setSaving(false);
    }
  }

  _setSaving(saving) {
    this.isSaving = saving;
    this.els.submit.disabled = saving;
    this.els.submit.textContent = saving ? 'Saving…' : 'Save song';
  }

  _showError(message) {
    this.els.error.textContent = message;
    this.els.error.classList.remove('hidden');
  }

  _clearError() {
    this.els.error.classList.add('hidden');
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function fillDatalist(datalist, values) {
  if (!datalist) return;
  datalist.innerHTML = values.map((v) => `<option value="${escapeHtml(v)}">`).join('');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

/** Makes a string safe for use in an id/for attribute. */
function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function escapeHtml(text) {
  return String(text ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
  );
}
