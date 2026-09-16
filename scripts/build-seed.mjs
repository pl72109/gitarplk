/**
 * Builds data/seed/<band>.json from the researched rig data.
 *
 * Run with: node scripts/build-seed.mjs
 * Then:     npm run seed        (merges the seed files into data/songs.json)
 *
 * Input is the research journal produced by the rig-research workflow. Every
 * claim in it was put through an adversarial fact-check pass, and the
 * corrections that pass raised are applied here by the CORRECTIONS map below -
 * each entry is traceable back to a specific finding (wrong tuning, gear that
 * did not exist yet, a citation that was invented, a confidence label that
 * overstated what the sources actually support).
 *
 * This script deliberately contains no tablature. The seeded records are gear
 * catalogue entries - metadata, tuning and rig - and each carries status
 * "needs-score" so the app prompts for a Guitar Pro upload.
 *
 * Pass a journal path as argv[2] to use a different research run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const seedDir = path.join(root, 'data', 'seed');

const DEFAULT_JOURNAL = path.join(
  'C:', 'Users', 'zsadi', '.claude', 'projects', 'c--projekt-gitarplk',
  'f983beb5-f1f8-43e8-8cfe-cd239bf407fc', 'subagents', 'workflows',
  'wf_caeb9b2e-c53', 'journal.jsonl'
);

const journalPath = process.argv[2] || DEFAULT_JOURNAL;

/* ------------------------------------------------------------------ *
 * Corrections from the adversarial fact-check pass.
 *
 * Keyed by artist -> song title -> dotted field path. `null` deletes.
 * `__dropPedal` removes a pedal whose model matches the given substring.
 * ------------------------------------------------------------------ */

const CORRECTIONS = {
  Nirvana: {
    'Smells Like Teen Spirit': {
      // The humbucker mod came after the Nevermind sessions.
      'rig.guitar': '1969 Fender Competition Mustang, stock single-coils (humbucker mod came later)',
      'rig.amp.model': 'Fender Bassman (rented, modified); Mesa/Boogie Studio Preamp + Crown live',
    },
    'In Bloom': {
      'rig.amp.model': 'Mesa/Boogie Studio Preamp into Crown Power Base 2; Fender Bassman for choruses',
      bpm: 157, // 78 was a half-time count
    },
    'Heart-Shaped Box': {
      // The Randall Switchmaster feed was not supported by any source.
      'rig.amp.model': '1970s Fender Quad Reverb, deliberately left broken (one power tube, one blown speaker)',
      'rig.confidence': 'widely-reported',
    },
    'All Apologies': {
      'rig.amp.model': '1970s Fender Quad Reverb, used on its own (broken power tubes, blown speaker)',
      'rig.confidence': 'widely-reported',
    },
  },

  'Alice in Chains': {
    'Them Bones': {
      // Jerden's documented three-amp split, not a Dual Rectifier.
      'rig.amp.model': 'Bogner Fish preamp into VHT power amp (lows); Bogner Ecstasy (mids); Rockman (highs)',
      'rig.cab': 'Marshall 4x12 with Vox Bulldog speakers',
    },
    'Man in the Box': {
      'rig.cab': "Snorkler head into a 4x12 with '70s Greenbacks, front and rear mics blended",
      'rig.confidence': 'approximation', // three conflicting accounts of the Facelift rhythm amp
    },
    'Would?': {
      'rig.amp.model': 'Bogner Fish preamp into VHT power amp (low layer of the three-amp Dirt split)',
    },
    'No Excuses': {
      // The ASAT HH is a later live guitar, not the 1993 recording.
      'rig.guitar': 'G&L Rampage "Blue Dress"',
    },
    Nutshell: {
      'rig.guitar': 'Guild acoustic (Cantrell\'s documented main acoustic of the era)',
      'rig.confidence': 'approximation',
    },
    Rooster: {
      'rig.confidence': 'approximation', // the flanger is inferred, not documented
    },
    'Check My Brain': {
      'rig.guitar': 'Gibson Les Paul Custom, or the G&L Rampage; Motor City bridge pickup',
      'rig.confidence': 'approximation',
    },
  },

  Pantera: {
    'Cowboys from Hell': {
      'rig.guitar': 'Dean ML "Dean From Hell" (1981, Bill Lawrence L-500XL bridge, Floyd Rose)',
      'rig.cab': 'Randall 412JB 4x12 with Jaguar 60s; 412CB with Celestions for cleans',
    },
    'Cemetery Gates': {
      'rig.guitar': 'Dean ML "Dean From Hell" (blue 1981 ML, Bill Lawrence L-500XL bridge, Floyd Rose)',
    },
    'This Love': {
      // Not D standard - same quarter-flat E family as the rest of the album.
      tuning: 'E Standard (E A D G B E), recorded roughly a quarter step flat',
      tuningPitches: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'],
    },
    Becoming: {
      'rig.guitar': 'Dean ML, tobacco-sunburst 1979 ML Standard (Floyd Rose, DiMarzio bridge)',
    },
    "I'm Broken": {
      'rig.guitar': 'Dean ML, tobacco-sunburst 1979 ML Standard (Floyd Rose, DiMarzio bridge)',
    },
    Floods: {
      'rig.guitar': 'Washburn Dime 3 (Bill Lawrence L-500XL bridge, Seymour Duncan \'59 neck)',
      tuning: 'C# Standard (C# F# B E G# C#), recorded slightly flat',
      'rig.confidence': 'approximation',
    },
  },

  Radiohead: {
    'My Iron Lung': {
      // The "high E to Eb" tuning was invented, and propped up with a fake citation.
      tuning: 'Altered - E G D G B E (A string down to G)',
      tuningPitches: ['E4', 'B3', 'G3', 'D3', 'G2', 'E2'],
      'rig.confidence': 'approximation',
    },
    'Street Spirit (Fade Out)': {
      // The DD-5 shipped in March 1995; The Bends was tracked in 1994.
      'rig.amp.model': 'Vox AC30 (Ed\'s clean amp through 1994-95)',
      'rig.confidence': 'approximation',
    },
    'Paranoid Android': {
      'rig.guitar': 'Fender Telecaster Plus (Denmark Street, 1992), later fitted with a killswitch',
    },
    '2 + 2 = 5': {
      'rig.guitar': '1970s Fender Telecaster Deluxe (Thom)',
    },
    Bodysnatchers: {
      // The session date and microphone were invented; the chain ran into the normal channel.
      'rig.amp.model': 'Vox AC30TB, normal channel (From the Basement session, April 2008)',
    },
  },
};

/** Pedals to remove entirely, by artist -> title -> model substring. */
const PEDAL_REMOVALS = {
  Radiohead: {
    'Street Spirit (Fade Out)': ['DD-5'], // anachronistic; the DD-3 is period-correct
  },
};

/** Pedal model renames, by artist -> title -> [fromSubstring, to]. */
const PEDAL_RENAMES = {
  Pantera: {
    // The 535Q did not exist in this era - the plain GCB-95 is period-correct.
    'Cowboys from Hell': [['535Q', 'Dunlop GCB-95 Cry Baby']],
    'Mouth for War': [['535Q', 'Dunlop GCB-95 Cry Baby (leads only)']],
    Walk: [['535Q', 'Dunlop GCB-95 Cry Baby']],
    "I'm Broken": [['535Q', 'Dunlop GCB-95 Cry Baby (leads only)']],
  },
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function setPath(object, dotted, value) {
  const parts = dotted.split('.');
  let node = object;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!node[parts[i]] || typeof node[parts[i]] !== 'object') node[parts[i]] = {};
    node = node[parts[i]];
  }
  if (value === null) delete node[parts[parts.length - 1]];
  else node[parts[parts.length - 1]] = value;
}

/** Trims to `max` at a word boundary rather than mid-word. */
function smartTrim(text, max) {
  const value = String(text ?? '').trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const boundary = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf(';'), cut.lastIndexOf(','));
  return (boundary > max * 0.6 ? cut.slice(0, boundary) : cut).replace(/[,;(\s]+$/, '');
}

/**
 * Splits a researched tuning string into a short label and its qualifier.
 *
 * Research often returns things like "E Standard (E A D G B E), recorded
 * roughly a quarter step flat (reference pitch A~428 Hz)". The sidebar and the
 * rig inspector want the canonical name; the pitch-reference detail is real
 * information but belongs in the notes, where it will not be truncated.
 *
 * The split is on the first comma that falls outside the parenthesised
 * string list, so "Drop D (D A D G B E)" survives intact.
 */
function splitTuning(raw) {
  const text = String(raw ?? '').trim();
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if ((ch === ',' || ch === '-') && depth === 0) {
      const label = text.slice(0, i).trim();
      const qualifier = text.slice(i + 1).trim();
      // A leading "Altered - E G D G B E" has no canonical name before the
      // dash, so keep the whole string rather than reducing it to "Altered".
      if (label.length < 8) break;
      return { label, qualifier };
    }
  }
  return { label: text, qualifier: '' };
}

/** Research returns [{knob, value}]; the app wants {knob: value}. */
function settingsToObject(pairs, { numeric }) {
  const out = {};
  for (const pair of pairs || []) {
    const name = smartTrim(pair.knob, 40);
    if (!name) continue;
    if (numeric) {
      const n = Number(pair.value);
      out[name] = Number.isFinite(n) ? Math.min(10, Math.max(0, Math.round(n))) : 5;
    } else {
      out[name] = smartTrim(pair.value, 40);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Read the research out of the workflow journal
 * ------------------------------------------------------------------ */

if (!fs.existsSync(journalPath)) {
  console.error(`Journal not found: ${journalPath}`);
  process.exit(1);
}

const lines = fs.readFileSync(journalPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const labelByAgent = {};
for (const entry of lines) {
  if (entry.type === 'started') labelByAgent[entry.agentId] = entry.label;
}

const research = [];
for (const entry of lines) {
  if (entry.type !== 'result') continue;
  const label = labelByAgent[entry.agentId] || '';
  if (!label.startsWith('research:')) continue;
  research.push({ key: label.slice('research:'.length), data: entry.result });
}

if (research.length === 0) {
  console.error('No research results found in the journal.');
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * Transform
 * ------------------------------------------------------------------ */

fs.mkdirSync(seedDir, { recursive: true });

let totalSongs = 0;
let totalCorrections = 0;

for (const { key, data } of research) {
  const artist = data.band;
  const bandFixes = CORRECTIONS[artist] || {};
  const bandRemovals = PEDAL_REMOVALS[artist] || {};
  const bandRenames = PEDAL_RENAMES[artist] || {};
  const songs = [];

  for (const raw of data.songs || []) {
    // Work on a copy so the corrections below are the only mutation.
    const song = JSON.parse(JSON.stringify(raw));

    // 1. Apply the fact-check corrections for this song.
    const fixes = bandFixes[song.title] || {};
    for (const [field, value] of Object.entries(fixes)) {
      setPath(song, field, value);
      totalCorrections++;
    }

    // 2. Remove anachronistic pedals, rename period-incorrect ones.
    const removals = bandRemovals[song.title] || [];
    if (removals.length && song.rig.pedals) {
      const before = song.rig.pedals.length;
      song.rig.pedals = song.rig.pedals.filter(
        (p) => !removals.some((needle) => String(p.model).includes(needle))
      );
      totalCorrections += before - song.rig.pedals.length;
    }
    for (const [needle, replacement] of bandRenames[song.title] || []) {
      for (const pedal of song.rig.pedals || []) {
        if (String(pedal.model).includes(needle)) {
          pedal.model = replacement;
          totalCorrections++;
        }
      }
    }

    // 3. Normalise to the app's song schema.
    const pitches = (song.tuningPitches || []).map((p) => String(p).trim()).filter(Boolean);
    if (pitches.length < 6 || pitches.length > 8) {
      console.warn(`  ! skipping "${song.title}" - ${pitches.length}-string tuning is not a guitar`);
      continue;
    }

    // Keep the tuning label short enough to read in the sidebar; the pitch
    // reference detail moves into the notes rather than being truncated away.
    const { label: tuningLabel, qualifier: tuningNote } = splitTuning(song.tuning);

    // The sourcing tag is carried in the notes so users can see at a glance
    // whether a setting is documented or an educated guess.
    const confidence = song.rig.confidence || 'approximation';
    const notes = [
      smartTrim(song.rig.notes, 380),
      tuningNote ? `Tuning note: ${tuningNote}.` : '',
    ]
      .filter(Boolean)
      .join(' ');

    songs.push({
      title: smartTrim(song.title, 120),
      artist,
      album: smartTrim(song.album, 120),
      year: Number.isFinite(Number(song.year)) ? Number(song.year) : null,
      bpm: Math.min(320, Math.max(20, Number(song.bpm) || 120)),
      status: 'needs-score',
      difficulty: song.difficulty || 'Intermediate',
      tuning: smartTrim(tuningLabel, 60),
      tuningPitches: pitches,
      capo: Math.min(12, Math.max(0, Number(song.capo) || 0)),
      rig: {
        preset: smartTrim(song.rig.preset, 80),
        guitar: smartTrim(song.rig.guitar, 80),
        amp: {
          model: smartTrim(song.rig.amp.model, 80),
          settings: settingsToObject(song.rig.amp.settings, { numeric: true }),
        },
        cab: smartTrim(song.rig.cab, 80),
        pedals: (song.rig.pedals || []).slice(0, 12).map((pedal) => ({
          model: smartTrim(pedal.model, 80),
          type: smartTrim(pedal.type, 30) || 'Utility',
          settings: settingsToObject(pedal.settings, { numeric: false }),
        })).filter((p) => p.model),
        notes: `${notes} [Sourcing: ${confidence}]`,
      },
      source: { format: 'none' },
    });
  }

  const file = path.join(seedDir, `${key}.json`);
  fs.writeFileSync(file, `${JSON.stringify(songs, null, 2)}\n`);
  console.log(`  ${key}.json: ${songs.length} songs`);
  totalSongs += songs.length;
}

console.log(`\n${totalSongs} songs written to data/seed/, ${totalCorrections} fact-check corrections applied.`);
