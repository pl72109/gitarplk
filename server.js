const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const dataDir = path.join(__dirname, 'data');
const dataPath = path.join(dataDir, 'songs.json');
const catalogPath = path.join(dataDir, 'rig-catalog.json');
const scoresDir = path.join(dataDir, 'scores');

// Uploaded Guitar Pro files live here and are served back at /scores/<file>.
fs.mkdirSync(scoresDir, { recursive: true });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/*
 * AlphaTab's browser assets.
 *
 * The bundle needs three things at runtime, all of which ship inside the npm
 * package, so we mount its dist folder rather than copying files around:
 *   - alphaTab.min.js          the library itself (also the worker source)
 *   - font/Bravura.*           the music font used to draw notation glyphs
 *   - soundfont/sonivox.sf3    the ~1 MB instrument bank AlphaSynth plays
 *
 * Serving locally keeps playback start-up fast and works offline.
 */
const alphaTabDist = path.join(__dirname, 'node_modules', '@coderline', 'alphatab', 'dist');

// Fail at boot rather than serving a page that 404s its own engine.
if (!fs.existsSync(path.join(alphaTabDist, 'alphaTab.min.js'))) {
    console.error(`AlphaTab assets not found at ${alphaTabDist} - run "npm install".`);
    process.exit(1);
}

app.use(
    '/vendor/alphatab',
    express.static(alphaTabDist, {
        maxAge: '30d',
        immutable: true,
    })
);

// Uploaded scores
app.use('/scores', express.static(scoresDir, { maxAge: '1h' }));

/* ------------------------------------------------------------------ *
 * Uploads
 * ------------------------------------------------------------------ */

const ALLOWED_SCORE_EXTENSIONS = new Set([
    '.gp', '.gp3', '.gp4', '.gp5', '.gpx', '.musicxml', '.xml',
]);

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, done) => done(null, scoresDir),
        filename: (req, file, done) => {
            // Never trust the client's filename: keep only the extension and
            // generate the rest, so uploads cannot escape scoresDir.
            const ext = path.extname(file.originalname).toLowerCase();
            done(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
        },
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, done) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!ALLOWED_SCORE_EXTENSIONS.has(ext)) {
            return done(new Error(`Unsupported score format: ${ext || 'none'}`));
        }
        done(null, true);
    },
});

/* ------------------------------------------------------------------ *
 * Song schema
 *
 * GITARPLK is guitar-only. A song record is one guitar arrangement plus the
 * rig it is played through:
 *
 *   {
 *     id, title, artist, album, year, bpm, status, difficulty,
 *     tuning, tuningPitches[], capo,
 *     rig: { preset, guitar, amp: { model, settings{} }, cab,
 *            pedals: [{ model, type, settings{} }], notes },
 *     source: { format: 'gp'|'alphatex'|'ascii'|'none', file?, data? },
 *     tab                                   // ASCII only
 *   }
 *
 * There is deliberately no `tracks[]` array and no `instrument` field: bass
 * and drum parts are not representable. Legacy multi-instrument records are
 * migrated on read by `migrateLegacySong`, which keeps the guitar part and
 * discards the rest.
 * ------------------------------------------------------------------ */

const SCORE_FORMATS = new Set(['gp', 'alphatex', 'ascii', 'none']);
const DIFFICULTIES = new Set(['Beginner', 'Intermediate', 'Advanced', 'Expert']);
const DEFAULT_TUNING = 'Standard (E A D G B E)';
const DEFAULT_TUNING_PITCHES = ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'];

/** Clamps an amp knob to the 0-10 range the UI renders. */
function knobValue(raw, fallback = 5) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(10, Math.max(0, Math.round(value)));
}

/** Coerces a `{ knob: value }` map, dropping anything unusable. */
function cleanSettings(raw, asKnob) {
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
        const name = String(key).trim().slice(0, 40);
        if (!name) continue;
        out[name] = asKnob ? knobValue(value) : String(value).slice(0, 40);
    }
    return out;
}

/** Normalises the rig block, filling in sane defaults for missing pieces. */
function normalizeRig(raw) {
    const rig = raw && typeof raw === 'object' ? raw : {};
    const amp = rig.amp && typeof rig.amp === 'object' ? rig.amp : {};

    const pedals = Array.isArray(rig.pedals) ? rig.pedals : [];

    return {
        preset: String(rig.preset || 'Custom Preset').slice(0, 80),
        guitar: String(rig.guitar || '').slice(0, 80),
        amp: {
            model: String(amp.model || 'Custom Tube Amp').slice(0, 80),
            settings: Object.keys(cleanSettings(amp.settings, true)).length
                ? cleanSettings(amp.settings, true)
                : { Gain: 5, Bass: 5, Mid: 5, Treble: 5 },
        },
        cab: String(rig.cab || '').slice(0, 80),
        pedals: pedals
            .filter((p) => p && (p.model || typeof p === 'string'))
            .slice(0, 12) // a pedalboard, not a rack farm
            .map((p) => {
                const pedal = typeof p === 'string' ? { model: p } : p;
                return {
                    model: String(pedal.model || '').slice(0, 80),
                    type: String(pedal.type || 'Utility').slice(0, 30),
                    settings: cleanSettings(pedal.settings, false),
                };
            })
            .filter((p) => p.model),
        notes: String(rig.notes || '').slice(0, 500),
    };
}

/**
 * Validates and normalises an incoming song payload.
 * @throws {Error} with a user-facing message when the payload is unusable.
 */
function normalizeSong(incoming, id) {
    const title = String(incoming.title || '').trim();
    const artist = String(incoming.artist || '').trim();
    if (!title || !artist) throw new Error('Title and artist are required');

    const pitches = Array.isArray(incoming.tuningPitches)
        ? incoming.tuningPitches.map((p) => String(p).trim()).filter(Boolean)
        : [];

    // A guitar staff has 6-8 strings. Anything else is a different instrument
    // (a 4-string tuning would be a bass) and is rejected rather than coerced.
    if (pitches.length && (pitches.length < 6 || pitches.length > 8)) {
        throw new Error(
            `A guitar tuning needs 6-8 strings, got ${pitches.length}. GITARPLK is guitar-only.`
        );
    }

    const difficulty = DIFFICULTIES.has(incoming.difficulty)
        ? incoming.difficulty
        : 'Intermediate';

    const rawFormat = incoming.source && incoming.source.format;
    const format = SCORE_FORMATS.has(rawFormat) ? rawFormat : 'none';

    const song = {
        id,
        title: title.slice(0, 120),
        artist: artist.slice(0, 120),
        album: String(incoming.album || '').slice(0, 120),
        year: Number.isFinite(Number(incoming.year)) ? Number(incoming.year) : null,
        bpm: Math.min(320, Math.max(20, Number(incoming.bpm) || 120)),
        status: incoming.status === 'approved' ? 'approved' : 'pending',
        difficulty,
        tuning: String(incoming.tuning || DEFAULT_TUNING).slice(0, 60),
        tuningPitches: pitches.length ? pitches : DEFAULT_TUNING_PITCHES,
        capo: Math.min(12, Math.max(0, Number(incoming.capo) || 0)),
        rig: normalizeRig(incoming.rig),
        source: { format },
    };

    if (format === 'alphatex') {
        const data = String((incoming.source && incoming.source.data) || '');
        if (!data.trim()) throw new Error('alphaTex source is empty');
        song.source.data = data;
    } else if (format === 'ascii') {
        const tab = String(incoming.tab || '');
        if (!tab.trim()) throw new Error('ASCII tablature is empty');
        song.tab = tab;
    }

    return song;
}

/**
 * Migrates a pre-guitar-only record.
 *
 * Old records carried a `tracks[]` array that could hold Bass and Drums
 * alongside the guitar. The guitar part is promoted to the top level and every
 * other part is dropped - permanently, on the next write.
 */
function migrateLegacySong(song) {
    if (!song || !Array.isArray(song.tracks)) return song;

    const guitar =
        song.tracks.find((t) => /guitar/i.test(t.instrument || '')) || song.tracks[0] || {};

    const migrated = {
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album || '',
        year: song.year ?? null,
        bpm: song.bpm || 120,
        status: song.status || 'approved',
        difficulty: song.difficulty || 'Intermediate',
        tuning: guitar.tuning || DEFAULT_TUNING,
        tuningPitches: song.tuningPitches || DEFAULT_TUNING_PITCHES,
        capo: song.capo || 0,
        rig: normalizeRig({
            preset: guitar.preset,
            guitar: guitar.guitarModel,
            amp: guitar.amp,
            cab: guitar.cab,
            pedals: guitar.pedals,
        }),
        source: song.source || { format: guitar.tab ? 'ascii' : 'none' },
    };

    if (guitar.tab) migrated.tab = guitar.tab;
    return migrated;
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

function readSongs() {
    const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    return raw.map(migrateLegacySong);
}

function writeSongs(songs) {
    fs.writeFileSync(dataPath, JSON.stringify(songs, null, 2));
}

function readCatalog() {
    return JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
}

/* ------------------------------------------------------------------ *
 * API
 * ------------------------------------------------------------------ */

/** Amps, cabs, pedals and tunings that populate the Add Song rig editor. */
app.get('/api/rig/catalog', (req, res) => {
    try {
        res.json(readCatalog());
    } catch (err) {
        res.status(500).json({ error: 'Failed to read rig catalog' });
    }
});

app.get('/api/songs', (req, res) => {
    try {
        res.json(readSongs());
    } catch (err) {
        res.status(500).json({ error: 'Failed to read data' });
    }
});

app.get('/api/songs/:id', (req, res) => {
    try {
        const song = readSongs().find((s) => s.id === Number(req.params.id));
        if (!song) return res.status(404).json({ error: 'Song not found' });
        res.json(song);
    } catch (err) {
        res.status(500).json({ error: 'Failed to read data' });
    }
});

/**
 * Accepts a new guitar song.
 *
 *  - Guitar Pro: multipart/form-data with a `score` file and a JSON `meta` field
 *  - alphaTex / ASCII / metadata-only: application/json
 *
 * `upload.single` is a no-op for JSON requests, so one handler covers both.
 */
app.post('/api/songs', upload.single('score'), (req, res) => {
    try {
        const songs = readSongs();

        // Multipart sends the metadata as a JSON string alongside the file.
        const incoming = req.file ? JSON.parse(req.body.meta || '{}') : req.body;

        const id = songs.length ? Math.max(...songs.map((s) => s.id)) + 1 : 1;

        // A file upload always wins over whatever `source` the client declared.
        if (req.file) {
            incoming.source = { format: 'gp' };
        }

        const song = normalizeSong(incoming, id);

        if (req.file) {
            song.source = { format: 'gp', file: req.file.filename };
        }

        // A song with no playable score is still a useful catalogue entry - the
        // rig is the point - but it is flagged so the UI can prompt for one.
        if (song.source.format === 'none') song.status = 'needs-score';

        songs.push(song);
        writeSongs(songs);
        res.status(201).json(song);
    } catch (err) {
        // Normalisation errors are the user's to fix; anything else is ours.
        const isValidation = /required|empty|guitar-only|strings/i.test(err.message);
        if (!isValidation) console.error(err);
        res.status(isValidation ? 400 : 500).json({
            error: isValidation ? err.message : 'Failed to save song',
        });
    }
});

/** Removes a song and, if it owned an uploaded score, that file too. */
app.delete('/api/songs/:id', (req, res) => {
    try {
        const songs = readSongs();
        const index = songs.findIndex((s) => s.id === Number(req.params.id));
        if (index === -1) return res.status(404).json({ error: 'Song not found' });

        const [removed] = songs.splice(index, 1);
        writeSongs(songs);

        if (removed.source && removed.source.format === 'gp' && removed.source.file) {
            // basename() guards against a crafted `file` escaping scoresDir.
            const file = path.join(scoresDir, path.basename(removed.source.file));
            fs.rm(file, { force: true }, () => {});
        }

        res.json({ deleted: removed.id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete song' });
    }
});

// Multer rejections (bad extension, oversized file) arrive here.
app.use((err, req, res, next) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
});

app.listen(PORT, () => {
    console.log(`GITARPLK is running on http://localhost:${PORT}`);
});
