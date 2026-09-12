/**
 * Legacy ASCII tablature -> alphaTex converter.
 *
 * AlphaTab cannot read ASCII tab. It imports Guitar Pro files, MusicXML or
 * alphaTex, so the songs already stored in data/songs.json are translated to
 * alphaTex on the fly before being handed to the API.
 *
 * THE BIG CAVEAT: ASCII tab encodes pitch but not rhythm. There is no way to
 * recover real note durations from it. What we do instead is treat horizontal
 * spacing as rhythm - every bar is mapped onto a 16-slot grid of 16th notes and
 * each note lands on the slot nearest to its relative position in the bar. That
 * is the same assumption the old player made (one character column = one 16th),
 * but bar-relative, so bars of differing character widths still line up.
 *
 * Supported: multi-digit frets, dead notes (x), ties (~), slides (/ and \),
 * hammer-ons / pull-offs (h, p), bar lines, and [SECTION: name] headers.
 * Not supported: tuplets, dotted notes, bends, vibrato, dynamics, repeats.
 */

// Default tunings, written string 1 (highest) first, as alphaTex expects.
const DEFAULT_TUNINGS = {
  4: ['G2', 'D2', 'A1', 'E1'], // bass
  5: ['G2', 'D2', 'A1', 'E1', 'B0'],
  6: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'], // guitar
  7: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2', 'B1'],
};

// General MIDI program numbers, keyed by the `instrument` field in songs.json.
const GM_PROGRAMS = {
  Guitar: 30, // Distortion Guitar
  Bass: 33, // Electric Bass (finger)
  Drums: 0,
};

const SLOTS_PER_BAR = 16; // 16th-note resolution in 4/4

/** A line is a tab line if it looks like `e|--3--5--|`. */
function isTabLine(line) {
  return /^\s*[A-Ga-g][#b]?\s*\|/.test(line);
}

/** `[SECTION: Main Riff]` -> `Main Riff` */
function parseSectionHeader(line) {
  const match = line.match(/^\s*\[\s*SECTION\s*:\s*(.+?)\s*\]\s*$/i);
  return match ? match[1] : null;
}

/**
 * Splits the raw tab text into systems: runs of consecutive tab lines, each
 * optionally preceded by a section header. A six-line run is one guitar system,
 * a four-line run is one bass system, and so on.
 */
function splitIntoSystems(tabText) {
  const systems = [];
  let current = null;
  let pendingSection = null;

  for (const rawLine of tabText.split('\n')) {
    const section = parseSectionHeader(rawLine);
    if (section) {
      pendingSection = section;
      current = null;
      continue;
    }

    if (isTabLine(rawLine)) {
      if (!current) {
        current = { section: pendingSection, lines: [] };
        systems.push(current);
        pendingSection = null;
      }
      current.lines.push(rawLine);
    } else {
      // Any non-tab line (usually a blank one) terminates the current system.
      current = null;
    }
  }

  return systems;
}

/**
 * Reads one tab line into { stringLetter, cells } where cells[i] describes what
 * sits at character column i. Multi-digit frets occupy their first column and
 * leave the rest empty so columns stay aligned across strings.
 */
function parseTabLine(line) {
  const pipe = line.indexOf('|');
  const stringLetter = line.slice(0, pipe).trim();
  const body = line.slice(pipe + 1);
  const cells = new Array(body.length).fill(null);

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];

    if (ch === '|') {
      cells[i] = { type: 'bar' };
      continue;
    }

    if (ch === 'x' || ch === 'X') {
      cells[i] = { type: 'note', fret: 0, dead: true };
      continue;
    }

    if (ch >= '0' && ch <= '9') {
      // Greedily consume the full number so 12 does not become 1 then 2.
      let digits = ch;
      while (i + 1 < body.length && body[i + 1] >= '0' && body[i + 1] <= '9') {
        digits += body[++i];
      }
      // The articulation that *precedes* a note tells us how it is reached.
      const prev = body[i - digits.length - 1];
      cells[i - digits.length + 1] = {
        type: 'note',
        fret: parseInt(digits, 10),
        dead: false,
        slide: prev === '/' || prev === '\\',
        hammer: prev === 'h' || prev === 'p',
        tie: prev === '~',
      };
      continue;
    }
  }

  return { stringLetter, cells, length: body.length };
}

/**
 * Slices a parsed system into bars using the `|` columns. Bars are taken from
 * the first string line; ASCII tabs keep bar lines vertically aligned, so that
 * is enough.
 */
function sliceIntoBars(parsedLines) {
  const width = Math.max(...parsedLines.map((l) => l.length));
  const barColumns = [];

  for (let col = 0; col < width; col++) {
    if (parsedLines.some((line) => line.cells[col] && line.cells[col].type === 'bar')) {
      barColumns.push(col);
    }
  }

  const boundaries = [0, ...barColumns, width];
  const bars = [];

  for (let b = 0; b < boundaries.length - 1; b++) {
    const start = boundaries[b] + (b === 0 ? 0 : 1); // skip the bar line itself
    const end = boundaries[b + 1];
    if (end - start > 0) bars.push({ start, end });
  }

  return bars;
}

/**
 * Quantises one bar onto the 16th-note grid.
 * Returns an array of SLOTS_PER_BAR entries, each either null or a list of
 * simultaneous notes: { string, fret, dead, slide, hammer, tie }.
 */
function quantiseBar(parsedLines, bar) {
  const grid = new Array(SLOTS_PER_BAR).fill(null);
  const barWidth = bar.end - bar.start;
  if (barWidth <= 0) return grid;

  parsedLines.forEach((line, lineIndex) => {
    for (let col = bar.start; col < bar.end; col++) {
      const cell = line.cells[col];
      if (!cell || cell.type !== 'note') continue;

      // Position within the bar, 0..1, snapped to the nearest 16th.
      const relative = (col - bar.start) / barWidth;
      const slot = Math.min(SLOTS_PER_BAR - 1, Math.round(relative * SLOTS_PER_BAR));

      if (!grid[slot]) grid[slot] = [];
      grid[slot].push({
        string: lineIndex + 1, // alphaTex string 1 = topmost line = highest string
        fret: cell.fret,
        dead: cell.dead,
        slide: cell.slide,
        hammer: cell.hammer,
        tie: cell.tie,
      });
    }
  });

  return grid;
}

/** Renders one grid slot as an alphaTex beat, e.g. `(3.5 3.4).8` or `r.16`. */
function renderBeat(notes, duration) {
  if (!notes || notes.length === 0) return `r.${duration}`;

  const rendered = notes.map((note) => {
    const fret = note.dead ? 'x' : note.fret;
    const effects = [];
    if (note.slide) effects.push('sl');
    if (note.hammer) effects.push('h');
    if (note.tie) effects.push('t');
    const suffix = effects.length ? `{${effects.join(' ')}}` : '';
    return `${fret}.${note.string}${suffix}`;
  });

  return rendered.length === 1
    ? `${rendered[0]}.${duration}`
    : `(${rendered.join(' ')}).${duration}`;
}

/**
 * Walks a quantised bar and emits alphaTex beats, merging runs of empty slots
 * into longer notes/rests so the output is not 16 sixteenths on every bar.
 */
function renderBar(grid) {
  const beats = [];
  let slot = 0;

  while (slot < SLOTS_PER_BAR) {
    const notes = grid[slot];

    // How long this event lasts: until the next non-empty slot, or bar end.
    let span = 1;
    while (slot + span < SLOTS_PER_BAR && !grid[slot + span]) span++;

    // Break the span into note values AlphaTab can express (16, 8, 4, 2, 1).
    let remaining = span;
    let first = true;
    while (remaining > 0) {
      const value = largestFittingDuration(remaining);
      const duration = SLOTS_PER_BAR / value; // 4 slots -> quarter note -> `4`
      // Only the first chunk carries the notes; the remainder is held as rests.
      beats.push(renderBeat(first ? notes : null, duration));
      remaining -= value;
      first = false;
    }

    slot += span;
  }

  return beats.join(' ');
}

/** Largest power-of-two slot count that fits in `remaining` (max a whole bar). */
function largestFittingDuration(remaining) {
  let value = SLOTS_PER_BAR;
  while (value > remaining) value /= 2;
  return value;
}

/** Chooses a tuning for a system based on how many strings it has. */
function tuningFor(stringCount, instrument) {
  if (DEFAULT_TUNINGS[stringCount]) return DEFAULT_TUNINGS[stringCount];
  return instrument === 'Bass' ? DEFAULT_TUNINGS[4] : DEFAULT_TUNINGS[6];
}

/**
 * Converts one track's ASCII tab into the alphaTex *body* for a single track
 * (everything after `\track`). Returns { body, stringCount }.
 */
export function convertTrackBody(tabText, instrument) {
  const systems = splitIntoSystems(tabText || '');
  if (systems.length === 0) return { body: '', stringCount: 6 };

  // All systems in a track should agree on string count; trust the first.
  const stringCount = systems[0].lines.length;
  const chunks = [];

  for (const system of systems) {
    const parsedLines = system.lines.map(parseTabLine);
    const bars = sliceIntoBars(parsedLines);
    let sectionEmitted = false;

    for (const bar of bars) {
      const grid = quantiseBar(parsedLines, bar);
      const rendered = renderBar(grid);
      // A section marker attaches to the first bar of the system.
      const marker =
        system.section && !sectionEmitted ? `\\section "${escapeTex(system.section)}" ` : '';
      if (marker) sectionEmitted = true;
      chunks.push(`${marker}${rendered}`);
    }
  }

  return { body: chunks.join(' |\n'), stringCount };
}

/** alphaTex string literals are double-quoted, so quotes must not leak through. */
function escapeTex(text) {
  return String(text).replace(/"/g, "'");
}

/**
 * Converts a whole song record from songs.json into a single multi-track
 * alphaTex document, so every instrument shows up in the AlphaTab mixer.
 *
 * @param {object} song - a song entry: { title, artist, bpm, tracks: [...] }
 * @returns {string} alphaTex source ready for `api.tex(...)`
 */
export function songToAlphaTex(song) {
  const header = [
    `\\title "${escapeTex(song.title || 'Untitled')}"`,
    `\\artist "${escapeTex(song.artist || 'Unknown')}"`,
    `\\tempo ${song.bpm || 120}`,
  ];

  const trackBlocks = (song.tracks || []).map((track) => {
    const { body, stringCount } = convertTrackBody(track.tab, track.instrument);
    const tuning = tuningFor(stringCount, track.instrument);
    const program = GM_PROGRAMS[track.instrument] ?? GM_PROGRAMS.Guitar;

    return [
      `\\track "${escapeTex(track.instrument || 'Track')}"`,
      `\\instrument ${program}`,
      `\\tuning ${tuning.join(' ')}`,
      '.',
      body,
    ].join('\n');
  });

  // The `.` terminates the metadata block and starts the notation.
  return `${header.join('\n')}\n.\n${trackBlocks.join('\n')}`;
}
