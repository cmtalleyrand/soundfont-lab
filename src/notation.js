const SUPERSCRIPT_TO_DIGIT = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
};

const KEY_ACCIDENTALS = {
  C: [], G: ['F#'], D: ['F#', 'C#'], A: ['F#', 'C#', 'G#'], E: ['F#', 'C#', 'G#', 'D#'],
  B: ['F#', 'C#', 'G#', 'D#', 'A#'], 'F#': ['F#', 'C#', 'G#', 'D#', 'A#', 'E#'],
  'C#': ['F#', 'C#', 'G#', 'D#', 'A#', 'E#', 'B#'], F: ['Bb'], Bb: ['Bb', 'Eb'],
  Eb: ['Bb', 'Eb', 'Ab'], Ab: ['Bb', 'Eb', 'Ab', 'Db'], Db: ['Bb', 'Eb', 'Ab', 'Db', 'Gb'],
  Gb: ['Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'], Cb: ['Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb', 'Fb'],
};

function normalizeSuperscript(input) {
  return input.split('').map((ch) => SUPERSCRIPT_TO_DIGIT[ch] ?? ch).join('');
}

function toAbcOctave(letter, octave) {
  const upper = letter.toUpperCase();
  if (octave > 4) {
    const suffix = "'".repeat(Math.max(0, octave - 5));
    return `${upper.toLowerCase()}${suffix}`;
  }

  const commas = ','.repeat(Math.max(0, 4 - octave));
  return `${upper}${commas}`;
}

function toAbcAccidental(accidental) {
  if (accidental === '#') return '^';
  if (accidental === 'b') return '_';
  return '';
}

function accidentalInKey(letter, key) {
  const inKey = KEY_ACCIDENTALS[key] ?? [];
  return inKey.find((acc) => acc.startsWith(letter.toUpperCase()));
}

function formatDuration(durationText) {
  if (!durationText) return '1';
  return durationText;
}

function parseHybridToken(token, key) {
  const normalized = normalizeSuperscript(token);
  const match = normalized.match(/^([A-Ga-g])([#b]?)(\d)(\d+(?:\/\d+)?)?$/);
  if (!match) {
    throw new Error('Invalid hybrid token format. Expected e.g. C#⁴4 or Gb⁶3/2');
  }

  const [, rawLetter, accidental, octaveText, durationText] = match;
  const letter = rawLetter.toUpperCase();
  const octave = Number(octaveText);
  const abcPitch = `${toAbcAccidental(accidental)}${toAbcOctave(letter, octave)}`;
  const duration = formatDuration(durationText);

  return {
    raw: token,
    mode: 'hybrid',
    pitchClass: `${letter}${accidental}`,
    octave,
    duration,
    abc: `${abcPitch}${duration === '1' ? '' : duration}`,
    keyContext: key,
  };
}

function parsePureAbcToken(token, key) {
  const normalized = token.trim();
  const match = normalized.match(/^(\^\^|\^|__|_|=)?([A-Ga-g])([',]*)(\d+(?:\/\d+)?)?$/);

  if (!match) {
    throw new Error('Invalid ABC token format. Expected e.g. ^c\'2 or _G,3/2');
  }

  const [, accidentalMark = '', letterRaw, octaveMarks = '', durationText] = match;
  const isLower = letterRaw === letterRaw.toLowerCase();
  const baseOctave = isLower ? 5 : 4;
  const upMarks = (octaveMarks.match(/'/g) || []).length;
  const downMarks = (octaveMarks.match(/,/g) || []).length;
  const octave = baseOctave + upMarks - downMarks;

  let accidental = '';
  if (accidentalMark === '^' || accidentalMark === '^^') accidental = '#';
  if (accidentalMark === '_' || accidentalMark === '__') accidental = 'b';

  const defaultAcc = accidentalInKey(letterRaw, key);
  const inferredAccidental = accidental || (defaultAcc ? defaultAcc[1].toLowerCase() : '');

  return {
    raw: token,
    mode: 'pure-abc',
    pitchClass: `${letterRaw.toUpperCase()}${inferredAccidental}`,
    octave,
    duration: formatDuration(durationText),
    abc: `${accidentalMark}${letterRaw}${octaveMarks}${durationText || ''}`,
    keyContext: key,
  };
}

export function parseNotationInput({ input, mode, key }) {
  if (!key) {
    throw new Error('K (key) is required for both pure ABC and hybrid SPN/ABC input.');
  }

  const tokens = input
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  return tokens.map((token) => (mode === 'pure-abc'
    ? parsePureAbcToken(token, key)
    : parseHybridToken(token, key)));
}
