/**
 * Verifies that every ASCII song in data/songs.json converts to alphaTex that
 * AlphaTab's own importer accepts, and that the result is a guitar staff.
 *
 * Most catalogue entries carry a rig but no score (status "needs-score"), so
 * they have nothing to convert and are reported as skipped rather than failed.
 *
 * Run with: node scripts/verify-converter.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as alphaTab from '@coderline/alphatab';
import { songToAlphaTex } from '../public/js/ascii-to-alphatex.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const songs = JSON.parse(fs.readFileSync(path.join(root, '..', 'data', 'songs.json'), 'utf8'));

// A guitar staff has 6-8 strings. Anything else means a bass or another
// instrument has crept back into the converter.
const MIN_STRINGS = 6;
const MAX_STRINGS = 8;

let failures = 0;
let converted = 0;
let skipped = 0;

for (const song of songs) {
  // Only ASCII records go through this converter; gp/alphatex/none do not.
  if (!song.tab || !song.tab.trim()) {
    skipped++;
    continue;
  }

  const tex = songToAlphaTex(song);
  process.stdout.write(`\n=== ${song.artist} - ${song.title} ===\n`);

  try {
    const importer = new alphaTab.importer.AlphaTexImporter();
    importer.initFromString(tex, new alphaTab.Settings());
    const score = importer.readScore();

    const tracks = Array.from(score.tracks);
    converted++;

    if (tracks.length !== 1) {
      failures++;
      console.log(`  FAIL expected exactly 1 guitar track, got ${tracks.length}`);
      continue;
    }

    const staff = tracks[0].staves[0];
    const strings = staff.stringTuning.tunings.length;
    const notes = staff.bars.reduce(
      (sum, bar) =>
        sum +
        Array.from(bar.voices).reduce(
          (v, voice) => v + Array.from(voice.beats).reduce((b, beat) => b + beat.notes.length, 0),
          0
        ),
      0
    );

    if (strings < MIN_STRINGS || strings > MAX_STRINGS) {
      failures++;
      console.log(`  FAIL "${tracks[0].name}" has ${strings} strings - not a guitar`);
      continue;
    }

    console.log(
      `  OK  "${tracks[0].name}" strings=${strings} bars=${staff.bars.length} notes=${notes}`
    );
  } catch (error) {
    failures++;
    console.log(`  FAIL ${error.message}`);
    console.log('  --- generated alphaTex (first 600 chars) ---');
    console.log(tex.slice(0, 600));
  }
}

console.log(
  `\n${converted} converted, ${skipped} skipped (no ASCII tab), ${failures} failed.`
);
process.exit(failures === 0 ? 0 : 1);
