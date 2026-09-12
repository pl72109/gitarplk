const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const dataDir = path.join(__dirname, 'data');
const dataPath = path.join(dataDir, 'songs.json');
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
 * API
 * ------------------------------------------------------------------ */

function readSongs() {
    return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
}

function writeSongs(songs) {
    fs.writeFileSync(dataPath, JSON.stringify(songs, null, 2));
}

app.get('/api/songs', (req, res) => {
    try {
        res.json(readSongs());
    } catch (err) {
        res.status(500).json({ error: 'Failed to read data' });
    }
});

/**
 * Accepts a new song in any of the three supported score formats.
 *
 *  - Guitar Pro: multipart/form-data with a `score` file and a JSON `meta` field
 *  - alphaTex / ASCII: application/json with a `source` field
 *
 * `upload.single` is a no-op for JSON requests, so one handler covers both.
 */
app.post('/api/songs', upload.single('score'), (req, res) => {
    try {
        const songs = readSongs();

        // Multipart sends the metadata as a JSON string alongside the file.
        const incoming = req.file ? JSON.parse(req.body.meta || '{}') : req.body;

        if (!incoming.title || !incoming.artist) {
            return res.status(400).json({ error: 'Title and artist are required' });
        }

        const newSong = {
            ...incoming,
            id: songs.length ? Math.max(...songs.map((s) => s.id)) + 1 : 1,
            status: 'pending',
            bpm: incoming.bpm || 116,
        };

        if (req.file) {
            newSong.source = { format: 'gp', file: req.file.filename };
        } else if (!newSong.source) {
            newSong.source = { format: 'ascii' };
        }

        songs.push(newSong);
        writeSongs(songs);
        res.json(newSong);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save song' });
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
