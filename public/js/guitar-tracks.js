/**
 * Guitar-track filtering.
 *
 * GITARPLK is a guitar-only application. Uploaded Guitar Pro and MusicXML files
 * routinely carry bass, drum, vocal and keyboard staves alongside the guitars,
 * so every score is filtered through here before it reaches the renderer or the
 * mixer. Everything that is not a guitar is dropped - it is never rendered,
 * never listed in the mixer, and never audible.
 *
 * There is no single authoritative "this is a guitar" flag in a score file, so
 * the decision combines three signals, strongest first:
 *
 *   1. percussion       - AlphaTab resolves this itself (drum staves, MIDI ch 10)
 *   2. the track name    - what the transcriber actually called the part
 *   3. the MIDI program  - General MIDI assigns guitars a contiguous range
 *   4. the string count  - a 4-string stringed staff is a bass, not a guitar
 *
 * Name beats program on purpose: transcribers mislabel MIDI programs far more
 * often than they mislabel the part itself.
 */

/** General MIDI program numbers 24-31 are the guitar family. */
const GM_GUITAR_FIRST = 24;
const GM_GUITAR_LAST = 31;

/** General MIDI program numbers 32-39 are the bass family. */
const GM_BASS_FIRST = 32;
const GM_BASS_LAST = 39;

/** MIDI channel 10 (zero-based 9) is reserved for percussion. */
const MIDI_PERCUSSION_CHANNEL = 9;

/** A guitar has at least six strings; anything shorter is a bass. */
const MIN_GUITAR_STRINGS = 6;

/**
 * Part names that are definitely not guitars.
 *
 * `\bbass\b` is word-bounded so it matches "Bass" and "Bass Gtr" but not
 * "Bassoon"; "Bass Drum" is caught by the drum pattern either way.
 */
const NON_GUITAR_NAME = new RegExp(
  [
    '\\bbass(es|line)?\\b',
    '\\bdrum(s|kit|set)?\\b',
    '\\bperc(ussion)?\\b',
    '\\bcymbal|\\bsnare|\\bkick\\b|\\bhi-?hat',
    '\\bvocal(s|ist)?\\b|\\bvoice\\b|\\bsing(er|ing)?\\b|\\bchoir\\b',
    '\\bpiano\\b|\\bkeys\\b|\\bkeyboard\\b|\\borgan\\b|\\bsynth\\b|\\brhodes\\b',
    '\\bstrings\\b|\\bviolin\\b|\\bcello\\b|\\bviola\\b',
    '\\bhorn(s)?\\b|\\bbrass\\b|\\bsax\\b|\\btrumpet\\b|\\bflute\\b',
  ].join('|'),
  'i'
);

/** Part names that are guitars even when the MIDI program disagrees. */
const GUITAR_NAME = /\b(guitar|gtr|gitar|lead|rhythm|acoustic|electric|nylon|steel|riff)\b/i;

/**
 * Why a track was excluded, for the "N tracks hidden" notice in the mixer.
 * @param {object} track - an AlphaTab Track
 * @returns {string|null} a short reason, or null if the track is a guitar
 */
export function nonGuitarReason(track) {
  if (!track) return 'missing track';

  // 1. Percussion. AlphaTab exposes this as a getter that already accounts for
  //    drum staves in Guitar Pro and MusicXML, so it is the most reliable flag.
  if (track.isPercussion) return 'drums';
  if (track.playbackInfo && track.playbackInfo.primaryChannel === MIDI_PERCUSSION_CHANNEL) {
    return 'drums';
  }

  // 2. The transcriber's own label.
  const name = String(track.name || '');
  if (NON_GUITAR_NAME.test(name)) {
    return /bass/i.test(name) ? 'bass' : 'not a guitar part';
  }
  if (GUITAR_NAME.test(name)) return null;

  // 3. General MIDI program.
  const program = track.playbackInfo ? track.playbackInfo.program : undefined;
  if (Number.isFinite(program)) {
    if (program >= GM_GUITAR_FIRST && program <= GM_GUITAR_LAST) return null;
    if (program >= GM_BASS_FIRST && program <= GM_BASS_LAST) return 'bass';
  }

  // 4. String count. A stringed staff with fewer than six strings is a bass;
  //    a staff with no strings at all is not a fretted instrument.
  const staff = track.staves && track.staves[0];
  if (staff) {
    const strings = staff.stringTuning ? staff.stringTuning.tunings.length : 0;
    if (strings >= MIN_GUITAR_STRINGS) return null;
    if (strings > 0) return 'bass';
    return 'not a fretted instrument';
  }

  return 'unrecognised instrument';
}

/** @returns {boolean} true when the track should be shown and heard. */
export function isGuitarTrack(track) {
  return nonGuitarReason(track) === null;
}

/**
 * Splits a score's tracks into the guitars we keep and the parts we drop.
 *
 * @param {object} score - an AlphaTab Score
 * @returns {{guitars: object[], rejected: Array<{name: string, reason: string}>}}
 */
export function partitionTracks(score) {
  const tracks = score && score.tracks ? Array.from(score.tracks) : [];
  const guitars = [];
  const rejected = [];

  for (const track of tracks) {
    const reason = nonGuitarReason(track);
    if (reason === null) {
      guitars.push(track);
    } else {
      rejected.push({ name: track.name || `Track ${track.index + 1}`, reason });
    }
  }

  return { guitars, rejected };
}

/** Human-readable summary of what was filtered out, or null if nothing was. */
export function describeRejected(rejected) {
  if (!rejected || rejected.length === 0) return null;
  const names = rejected.map((r) => `${r.name} (${r.reason})`).join(', ');
  return `${rejected.length} non-guitar track${rejected.length === 1 ? '' : 's'} hidden: ${names}`;
}
