/**
 * Regression guard for the guitar-only invariant.
 *
 * Two halves:
 *   1. the stored catalogue - no record may carry the old multi-instrument
 *      shape (`tracks[]`, `instrument`) or a non-guitar tuning
 *   2. the import filter - synthetic bass/drum/keyboard tracks must be
 *      rejected by nonGuitarReason, and guitars must survive it
 *
 * Run with: node scripts/verify-guitar-only.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nonGuitarReason, partitionTracks } from '../public/js/guitar-tracks.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const songs = JSON.parse(fs.readFileSync(path.join(root, '..', 'data', 'songs.json'), 'utf8'));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

/* ------------------------------------------------------------------ *
 * 1. Stored catalogue
 * ------------------------------------------------------------------ */

const withTracks = songs.filter((s) => Array.isArray(s.tracks));
check('no song carries a legacy tracks[] array', withTracks.length === 0,
  withTracks.map((s) => s.title).join(', '));

const withInstrument = songs.filter((s) => 'instrument' in s);
check('no song carries an instrument field', withInstrument.length === 0,
  withInstrument.map((s) => s.title).join(', '));

const badTuning = songs.filter(
  (s) => Array.isArray(s.tuningPitches) && (s.tuningPitches.length < 6 || s.tuningPitches.length > 8)
);
check('every tuning is 6-8 strings', badTuning.length === 0,
  badTuning.map((s) => `${s.title}=${s.tuningPitches.length}`).join(', '));

// The catalogue is guitar-only, so a bass or drum part should not be
// describable anywhere in the stored text either.
const suspicious = songs.filter((s) => {
  const blob = JSON.stringify({ rig: s.rig, tuning: s.tuning });
  return /\bbass guitar\b|\bdrum kit\b|\bdrums\b/i.test(blob);
});
check('no bass/drum gear in any rig', suspicious.length === 0,
  suspicious.map((s) => s.title).join(', '));

const missingRig = songs.filter((s) => !s.rig || !s.rig.amp || !s.rig.amp.model);
check('every song has a rig with an amp', missingRig.length === 0,
  missingRig.map((s) => s.title).join(', '));

/* ------------------------------------------------------------------ *
 * 2. Import filter
 * ------------------------------------------------------------------ */

/** Minimal stand-in for an AlphaTab Track. */
function track({ name, program = 30, strings = 6, percussion = false, channel = 0 }) {
  return {
    index: 0,
    name,
    isPercussion: percussion,
    playbackInfo: { program, primaryChannel: channel },
    staves: [{ stringTuning: { tunings: new Array(strings).fill(0) } }],
  };
}

const rejects = [
  ['a percussion track', track({ name: 'Drums', percussion: true })],
  ['a track on MIDI channel 10', track({ name: 'Kit', channel: 9 })],
  ['a track named Bass', track({ name: 'Bass', program: 33, strings: 4 })],
  ['a track named Bass Guitar', track({ name: 'Bass Guitar', program: 30, strings: 6 })],
  ['a 4-string stringed track', track({ name: 'Low End', program: 0, strings: 4 })],
  ['a General MIDI bass program', track({ name: 'Low End', program: 34, strings: 6 })],
  ['a vocal track', track({ name: 'Vocals', program: 52, strings: 0 })],
  ['a piano track', track({ name: 'Piano', program: 0, strings: 0 })],
];

for (const [label, candidate] of rejects) {
  const reason = nonGuitarReason(candidate);
  check(`rejects ${label}`, reason !== null, reason || 'was accepted');
}

const accepts = [
  ['a distortion guitar', track({ name: 'Guitar', program: 30 })],
  ['a clean guitar', track({ name: 'Clean Gtr', program: 27 })],
  ['a rhythm part with no program', track({ name: 'Rhythm', program: 0, strings: 6 })],
  ['a 7-string guitar', track({ name: 'Guitar 7', program: 30, strings: 7 })],
  ['an unnamed 6-string track', track({ name: '', program: 25, strings: 6 })],
  // Bassoon must not trip the word-bounded \bbass\b pattern.
  ['a track named Bassoon Doubling Gtr', track({ name: 'Bassoon Doubling Gtr', program: 30 })],
];

for (const [label, candidate] of accepts) {
  const reason = nonGuitarReason(candidate);
  check(`accepts ${label}`, reason === null, reason || '');
}

// A realistic mixed score: two guitars plus bass and drums.
const mixed = {
  tracks: [
    track({ name: 'Rhythm Guitar', program: 30 }),
    track({ name: 'Lead Guitar', program: 29 }),
    track({ name: 'Bass', program: 33, strings: 4 }),
    track({ name: 'Drums', percussion: true }),
  ],
};
const { guitars, rejected } = partitionTracks(mixed);
check('partitions a mixed score to guitars only', guitars.length === 2 && rejected.length === 2,
  `${guitars.length} kept, ${rejected.length} dropped`);

/* ------------------------------------------------------------------ */

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
