/**
 * Builds data/songs.json from the per-band catalogue files in data/seed/.
 *
 * Run with: npm run seed
 *
 * The seed entries are gear catalogue records: metadata, tuning and a full rig
 * (amp settings + pedalboard), with no score attached. They carry
 * status "needs-score" so the UI prompts for a Guitar Pro upload. No
 * tablature ships with this repo - users attach their own score files.
 *
 * Re-running is safe. A song that owns an uploaded Guitar Pro file is never
 * touched by a re-seed. A rig-only song is refreshed from the seed file when
 * one matches it by artist+title, because the seeded rigs have been through a
 * fact-checking pass and the entries they replace have not.
 *
 * Legacy records are converted as follows:
 *   - the guitar part is promoted out of tracks[]; bass and drum parts are dropped
 *   - an ASCII-only entry becomes rig-only: its stored tab text is discarded
 *   - an entry with an uploaded Guitar Pro file keeps that file
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const songsPath = path.join(root, 'data', 'songs.json');
const seedDir = path.join(root, 'data', 'seed');

const DEFAULT_TUNING = 'Standard (E A D G B E)';
const DEFAULT_TUNING_PITCHES = ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'];

/* ------------------------------------------------------------------ *
 * Normalisation
 * ------------------------------------------------------------------ */

/** Mirrors the server's clamp so seeded data survives a round trip unchanged. */
function knob(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(0, Math.round(n)));
}

function normalizeRig(raw = {}) {
  const amp = raw.amp || {};
  const settings = {};
  for (const [name, value] of Object.entries(amp.settings || {})) {
    settings[String(name).slice(0, 40)] = knob(value);
  }

  return {
    preset: String(raw.preset || 'Custom Preset').slice(0, 80),
    guitar: String(raw.guitar || '').slice(0, 80),
    amp: {
      model: String(amp.model || 'Custom Tube Amp').slice(0, 80),
      settings: Object.keys(settings).length ? settings : { Gain: 5, Bass: 5, Mid: 5, Treble: 5 },
    },
    cab: String(raw.cab || '').slice(0, 80),
    pedals: (raw.pedals || []).slice(0, 12).map((pedal) => {
      const knobs = {};
      for (const [name, value] of Object.entries(pedal.settings || {})) {
        knobs[String(name).slice(0, 40)] = String(value).slice(0, 40);
      }
      return {
        model: String(pedal.model || '').slice(0, 80),
        type: String(pedal.type || 'Utility').slice(0, 30),
        settings: knobs,
      };
    }).filter((p) => p.model),
    notes: String(raw.notes || '').slice(0, 500),
  };
}

/** Promotes a legacy tracks[] record to the flat guitar-only schema. */
function migrateLegacy(song) {
  if (!Array.isArray(song.tracks)) return song;

  const guitar = song.tracks.find((t) => /guitar/i.test(t.instrument || '')) || song.tracks[0] || {};
  const dropped = song.tracks.filter((t) => t !== guitar).map((t) => t.instrument || 'unnamed');
  if (dropped.length) {
    console.log(`  migrated "${song.title}" - dropped ${dropped.join(', ')}`);
  }

  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album || '',
    year: song.year ?? null,
    bpm: song.bpm || 120,
    // An ASCII transcription is not carried forward; the entry keeps its rig.
    status: 'needs-score',
    difficulty: song.difficulty || 'Intermediate',
    tuning: guitar.tuning || DEFAULT_TUNING,
    tuningPitches: song.tuningPitches || DEFAULT_TUNING_PITCHES,
    capo: song.capo || 0,
    rig: normalizeRig({
      preset: guitar.preset,
      amp: guitar.amp,
      pedals: guitar.pedals,
    }),
    source: { format: 'none' },
  };
}

/**
 * Converts an existing record to the current schema.
 * Uploaded Guitar Pro scores are preserved; ASCII tab text is not.
 */
function migrate(song) {
  const migrated = migrateLegacy(song);

  if (migrated.source && migrated.source.format === 'gp' && migrated.source.file) {
    return migrated; // an uploaded file - leave it alone
  }

  if (migrated.tab) {
    console.log(`  "${migrated.title}" converted to rig-only (stored tab text discarded)`);
    delete migrated.tab;
    migrated.source = { format: 'none' };
    migrated.status = 'needs-score';
  }

  return migrated;
}

/* ------------------------------------------------------------------ *
 * Validation - the same invariants verify-guitar-only.mjs enforces
 * ------------------------------------------------------------------ */

function validate(song, where) {
  const problems = [];
  if (!song.title || !song.artist) problems.push('missing title or artist');
  if (Array.isArray(song.tracks)) problems.push('still has a tracks[] array');
  if ('instrument' in song) problems.push('still has an instrument field');

  const strings = (song.tuningPitches || []).length;
  if (strings < 6 || strings > 8) {
    problems.push(`tuningPitches has ${strings} entries (guitar needs 6-8)`);
  }
  if (!song.rig || !song.rig.amp || !song.rig.amp.model) problems.push('missing rig.amp.model');
  if (song.tab) problems.push('carries tablature');

  if (problems.length) {
    throw new Error(`${where}: "${song.title}" - ${problems.join('; ')}`);
  }
}

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

const existing = fs.existsSync(songsPath)
  ? JSON.parse(fs.readFileSync(songsPath, 'utf8'))
  : [];

console.log(`Migrating ${existing.length} existing song(s)…`);
const songs = existing.map(migrate);
songs.forEach((s) => validate(s, 'existing'));

const key = (song) => `${song.artist}::${song.title}`.toLowerCase();
const indexByKey = new Map(songs.map((song, index) => [key(song), index]));

/** An uploaded score is user data; a rig-only entry is just catalogue data. */
const ownsUploadedScore = (song) =>
  song.source && song.source.format === 'gp' && Boolean(song.source.file);

if (!fs.existsSync(seedDir)) {
  console.error(`\nNo seed directory at ${seedDir} - nothing to add.`);
  process.exit(1);
}

const seedFiles = fs.readdirSync(seedDir).filter((f) => f.endsWith('.json')).sort();
let added = 0;
let skipped = 0;
let refreshed = 0;

for (const file of seedFiles) {
  const entries = JSON.parse(fs.readFileSync(path.join(seedDir, file), 'utf8'));
  let bandAdded = 0;

  for (const entry of entries) {
    const song = {
      title: String(entry.title || '').trim(),
      artist: String(entry.artist || '').trim(),
      album: String(entry.album || ''),
      year: Number.isFinite(Number(entry.year)) ? Number(entry.year) : null,
      bpm: Math.min(320, Math.max(20, Number(entry.bpm) || 120)),
      status: 'needs-score',
      difficulty: entry.difficulty || 'Intermediate',
      tuning: String(entry.tuning || DEFAULT_TUNING).slice(0, 60),
      tuningPitches: entry.tuningPitches || DEFAULT_TUNING_PITCHES,
      capo: Math.min(12, Math.max(0, Number(entry.capo) || 0)),
      rig: normalizeRig(entry.rig),
      source: { format: 'none' },
    };

    validate(song, file);

    const existingIndex = indexByKey.get(key(song));

    if (existingIndex !== undefined) {
      const current = songs[existingIndex];
      if (ownsUploadedScore(current)) {
        // Never clobber a score the user uploaded.
        skipped++;
        continue;
      }
      // Refresh the rig from the fact-checked seed, keeping the stable id.
      songs[existingIndex] = { ...song, id: current.id };
      refreshed++;
      continue;
    }

    indexByKey.set(key(song), songs.length);
    songs.push(song);
    bandAdded++;
    added++;
  }

  console.log(`  ${file}: +${bandAdded} song(s)`);
}

// Renumber so ids are stable and contiguous after a merge.
songs.forEach((song, index) => {
  song.id = index + 1;
});

fs.writeFileSync(songsPath, `${JSON.stringify(songs, null, 2)}\n`);

const byArtist = songs.reduce((acc, s) => {
  acc[s.artist] = (acc[s.artist] || 0) + 1;
  return acc;
}, {});

console.log(
  `\n${songs.length} songs written to data/songs.json ` +
    `(${added} added, ${refreshed} rig refreshed, ${skipped} left alone - uploaded score).`
);
for (const [artist, count] of Object.entries(byArtist).sort()) {
  console.log(`  ${count.toString().padStart(3)}  ${artist}`);
}
