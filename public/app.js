document.addEventListener('DOMContentLoaded', () => {
    let songs = [];
    let currentSong = null;
    let currentTrackIndex = 0;
    
    // Playback Engine state
    let isPlaying = false;
    let playInterval = null;
    let audioCtx = null;
    let currentColumn = 0;
    let maxColumns = 0;

    // Elements
    const els = {
        songList: document.getElementById('song-list'),
        search: document.getElementById('song-search'),
        viewport: document.getElementById('tab-viewport'),
        canvas: document.getElementById('tab-canvas'),
        emptyState: document.getElementById('empty-workspace'),
        metaPanel: document.getElementById('song-meta-panel'),
        
        displayTitle: document.getElementById('display-title'),
        displayArtist: document.getElementById('display-artist'),
        displayStatus: document.getElementById('display-status'),
        
        ampTitle: document.getElementById('rig-amp-title'),
        ampKnobs: document.getElementById('rig-amp-knobs'),
        pedalsList: document.getElementById('rig-pedals-list'),
        tuning: document.getElementById('rig-tuning'),
        presetName: document.getElementById('rig-preset-name'),
        
        trackSelector: document.getElementById('track-selector'),
        btnPlay: document.getElementById('btn-play-pause'),
        bpmInput: document.getElementById('bpm-input'),
        bpmSlider: document.getElementById('bpm-slider'),
        
        modal: document.getElementById('add-song-modal'),
        btnOpenModal: document.getElementById('btn-open-modal'),
        btnCloseModal: document.getElementById('btn-close-modal'),
        btnCancelModal: document.getElementById('btn-cancel-modal'),
        btnSubmitSong: document.getElementById('btn-submit-song'),
        
        tabTextarea: document.getElementById('new-tab-text')
    };

    // Frequencies mapping for standard guitar tuning
    const stringFreqs = {
        'e': 329.63, 'B': 246.94, 'G': 196.00, 'D': 146.83, 'A': 110.00, 'E': 82.41,
        'g': 392.00, 'd': 293.66, 'a': 220.00, 'e1': 164.81
    };

    function fetchSongs() {
        fetch('/api/songs')
            .then(res => res.json())
            .then(data => {
                songs = data;
                renderSongList(songs);
            });
    }

    function renderSongList(items) {
        els.songList.innerHTML = '';
        items.forEach((song, idx) => {
            const li = document.createElement('li');
            li.innerHTML = `
                <div>
                    <span class="s-title">${song.title}</span>
                    <span class="s-artist">${song.artist}</span>
                </div>
                ${song.status === 'pending' ? '<span class="badge-pending">Pending</span>' : ''}
            `;
            li.addEventListener('click', () => selectSong(song.id));
            els.songList.appendChild(li);
        });
    }

    function selectSong(id) {
        stopPlayback();
        currentSong = songs.find(s => s.id === id);
        currentTrackIndex = 0;

        els.emptyState.classList.add('hidden');
        els.metaPanel.classList.remove('hidden');
        els.viewport.classList.remove('hidden');

        els.displayTitle.textContent = currentSong.title;
        els.displayArtist.textContent = currentSong.artist;
        els.displayStatus.textContent = currentSong.status.toUpperCase();
        
        const bpm = currentSong.bpm || 116;
        els.bpmInput.value = bpm;
        els.bpmSlider.value = bpm;

        renderTrackPicker();
        loadTrackData();
    }

    function renderTrackPicker() {
        els.trackSelector.innerHTML = '';
        currentSong.tracks.forEach((track, idx) => {
            const btn = document.createElement('button');
            btn.textContent = track.instrument;
            if (idx === currentTrackIndex) btn.classList.add('active');
            btn.addEventListener('click', () => {
                stopPlayback();
                currentTrackIndex = idx;
                Array.from(els.trackSelector.children).forEach((b, i) => b.classList.toggle('active', i === idx));
                loadTrackData();
            });
            els.trackSelector.appendChild(btn);
        });
    }

    function loadTrackData() {
        const track = currentSong.tracks[currentTrackIndex];
        
        els.tuning.textContent = track.tuning;
        els.presetName.textContent = track.preset;
        
        // Render Amp
        els.ampTitle.textContent = track.amp ? track.amp.model : "Standard Amp";
        els.ampKnobs.innerHTML = '';
        if (track.amp && track.amp.settings) {
            for (const [k, v] of Object.entries(track.amp.settings)) {
                els.ampKnobs.innerHTML += `<div class="knob-unit"><span>${k}</span><strong>${v}</strong></div>`;
            }
        }

        // Render Pedals
        els.pedalsList.innerHTML = '';
        if (track.pedals && track.pedals.length) {
            track.pedals.forEach(p => {
                els.pedalsList.innerHTML += `<div style="font-size:12px; color:#fff; margin-bottom:3px;">• ${p.model}</div>`;
            });
        } else {
            els.pedalsList.innerHTML = '<span style="font-size:12px; color:#666;">No Pedals Active</span>';
        }

        // Render Tab Canvas
        renderTabCanvas(track.tab);
    }

    function renderTabCanvas(tabText) {
        els.canvas.innerHTML = '';
        const lines = tabText.split('\n');
        
        // Wrap in code container
        const textNode = document.createElement('div');
        textNode.textContent = tabText;
        els.canvas.appendChild(textNode);

        // Add Playhead Cursor Element
        const cursor = document.createElement('div');
        cursor.id = 'playhead';
        cursor.className = 'playhead-cursor';
        cursor.style.left = '0px';
        els.canvas.appendChild(cursor);

        // Calculate max string length
        maxColumns = Math.max(...lines.map(l => l.length));
        currentColumn = 0;
    }

    // Sound Synthesizer
    function playAudioNote(freq) {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

        gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start();
        osc.stop(audioCtx.currentTime + 0.25);
    }

    // Playback Engine (Songsterr Sync)
    function togglePlayback() {
        if (isPlaying) {
            stopPlayback();
        } else {
            startPlayback();
        }
    }

    function startPlayback() {
        if (!currentSong) return;
        isPlaying = true;
        els.btnPlay.textContent = '■ STOP';
        els.btnPlay.classList.add('playing');

        const bpm = parseInt(els.bpmInput.value, 10) || 120;
        const intervalMs = (60000 / bpm) / 4; // 16th note subdivisions

        const track = currentSong.tracks[currentTrackIndex];
        const lines = track.tab.split('\n').filter(l => l.includes('|'));

        playInterval = setInterval(() => {
            if (currentColumn >= maxColumns) {
                currentColumn = 0;
            }

            // Move Playhead Cursor
            const cursor = document.getElementById('playhead');
            if (cursor) {
                // Character width is roughly 10.8px in Courier New 18px
                const charWidth = 10.8; 
                cursor.style.left = `${currentColumn * charWidth}px`;
            }

            // Scan notes in current column
            lines.forEach(line => {
                const stringChar = line.charAt(0);
                const charAtCol = line.charAt(currentColumn);

                if (/\d/.test(charAtCol)) {
                    const fret = parseInt(charAtCol, 10);
                    const baseFreq = stringFreqs[stringChar] || 110;
                    const noteFreq = baseFreq * Math.pow(2, fret / 12);
                    playAudioNote(noteFreq);
                }
            });

            currentColumn++;
        }, intervalMs);
    }

    function stopPlayback() {
        isPlaying = false;
        clearInterval(playInterval);
        els.btnPlay.textContent = '▶ PLAY';
        els.btnPlay.classList.remove('playing');
    }

    els.btnPlay.addEventListener('click', togglePlayback);

    // Sync BPM Sliders
    els.bpmInput.addEventListener('input', (e) => {
        els.bpmSlider.value = e.target.value;
        if (isPlaying) { stopPlayback(); startPlayback(); }
    });
    els.bpmSlider.addEventListener('input', (e) => {
        els.bpmInput.value = e.target.value;
        if (isPlaying) { stopPlayback(); startPlayback(); }
    });

    // Search filter
    els.search.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = songs.filter(s => s.title.toLowerCase().includes(query) || s.artist.toLowerCase().includes(query));
        renderSongList(filtered);
    });

    // Modal & Add Song logic
    els.btnOpenModal.addEventListener('click', () => els.modal.classList.remove('hidden'));
    els.btnCloseModal.addEventListener('click', () => els.modal.classList.add('hidden'));
    els.btnCancelModal.addEventListener('click', () => els.modal.classList.add('hidden'));

    // Modal Tabs Navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            e.target.classList.add('active');
            document.getElementById(e.target.dataset.tab).classList.add('active');
        });
    });

    // Insert Blank Tab Template
    document.getElementById('btn-insert-template').addEventListener('click', () => {
        els.tabTextarea.value = 
`e|---------------------------------|---------------------------------|
B|---------------------------------|---------------------------------|
G|---------------------------------|---------------------------------|
D|---------------------------------|---------------------------------|
A|---------------------------------|---------------------------------|
E|---------------------------------|---------------------------------|`;
    });

    document.getElementById('btn-insert-bar').addEventListener('click', () => {
        els.tabTextarea.value += '|\n';
    });

    // Save Song
    els.btnSubmitSong.addEventListener('click', () => {
        const artist = document.getElementById('new-artist').value;
        const title = document.getElementById('new-title').value;
        const bpm = parseInt(document.getElementById('new-bpm').value, 10) || 120;
        const instrument = document.getElementById('new-instrument').value;
        const preset = document.getElementById('new-preset-name').value || "Custom Preset";
        const tuning = document.getElementById('new-tuning').value;
        const tab = els.tabTextarea.value;

        if (!artist || !title || !tab) return alert("Please fill Artist, Title and Tablature!");

        const newSong = {
            title, artist, bpm,
            tracks: [{
                instrument,
                tuning,
                preset,
                amp: {
                    model: document.getElementById('new-amp-model').value || "Tube Amp",
                    settings: {
                        Gain: parseInt(document.getElementById('amp-g').value, 10) || 5,
                        Bass: parseInt(document.getElementById('amp-b').value, 10) || 5,
                        Mid: parseInt(document.getElementById('amp-m').value, 10) || 5,
                        Treble: parseInt(document.getElementById('amp-t').value, 10) || 5
                    }
                },
                pedals: [{ model: document.getElementById('new-pedal-name').value || "Overdrive", settings: {} }],
                tab
            }]
        };

        fetch('/api/songs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newSong)
        })
        .then(res => res.json())
        .then(() => {
            els.modal.classList.add('hidden');
            fetchSongs();
        });
    });

    fetchSongs();
});