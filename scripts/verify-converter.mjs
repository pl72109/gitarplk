/**
 * Verifies that every legacy ASCII song in data/songs.json converts to
 * alphaTex that AlphaTab's own importer accepts.
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

let failures = 0;

for (const song of songs) {
  const tex = songToAlphaTex(song);
  process.stdout.write(`\n=== ${song.artist} - ${song.title} ===\n`);

  try {
    const importer = new alphaTab.importer.AlphaTexImporter();
    importer.initFromString(tex, new alphaTab.Settings());
    const score = importer.readScore();

    const tracks = Array.from(score.tracks);
    console.log(`  OK  tracks=${tracks.length} masterBars=${score.masterBars.length}`);
    for (const track of tracks) {
      const staff = track.staves[0];
      const notes = staff.bars.reduce(
        (sum, bar) =>
          sum +
          Array.from(bar.voices).reduce(
            (v, voice) =>
              v + Array.from(voice.beats).reduce((b, beat) => b + beat.notes.length, 0),
            0
          ),
        0
      );
      console.log(
        `      "${track.name}" strings=${staff.stringTuning.tunings.length} bars=${staff.bars.length} notes=${notes}`
      );
    }
  } catch (error) {
    failures++;
    console.log(`  FAIL ${error.message}`);
    console.log('  --- generated alphaTex (first 600 chars) ---');
    console.log(tex.slice(0, 600));
  }
}

console.log(`\n${failures === 0 ? 'All songs converted cleanly.' : `${failures} song(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
