/**
 * SF2 (SoundFont 2) Binary Parser
 *
 * Parses the RIFF-based SF2 file format into a structured representation.
 * Reference: SF2 specification v2.01 / v2.04
 *
 * Structure:
 *   RIFF('sfbk')
 *     LIST('INFO') - metadata
 *     LIST('sdta') - sample data (smpl, sm24)
 *     LIST('pdta') - preset/instrument/sample headers
 */

// Generator enumerations used in SF2
export const GeneratorType = {
  startAddrsOffset: 0,
  endAddrsOffset: 1,
  startloopAddrsOffset: 2,
  endloopAddrsOffset: 3,
  startAddrsCoarseOffset: 4,
  modLfoToPitch: 5,
  vibLfoToPitch: 6,
  modEnvToPitch: 7,
  initialFilterFc: 8,
  initialFilterQ: 9,
  modLfoToFilterFc: 10,
  modEnvToFilterFc: 11,
  endAddrsCoarseOffset: 12,
  modLfoToVolume: 13,
  chorusEffectsSend: 15,
  reverbEffectsSend: 16,
  pan: 17,
  delayModLFO: 21,
  freqModLFO: 22,
  delayVibLFO: 23,
  freqVibLFO: 24,
  delayModEnv: 25,
  attackModEnv: 26,
  holdModEnv: 27,
  decayModEnv: 28,
  sustainModEnv: 29,
  releaseModEnv: 30,
  keynumToModEnvHold: 31,
  keynumToModEnvDecay: 32,
  delayVolEnv: 33,
  attackVolEnv: 34,
  holdVolEnv: 35,
  decayVolEnv: 36,
  sustainVolEnv: 37,
  releaseVolEnv: 38,
  keynumToVolEnvHold: 39,
  keynumToVolEnvDecay: 40,
  instrument: 41,
  keyRange: 43,
  velRange: 44,
  startloopAddrsCoarseOffset: 45,
  keynum: 46,
  velocity: 47,
  initialAttenuation: 48,
  endloopAddrsCoarseOffset: 50,
  coarseTune: 51,
  fineTune: 52,
  sampleID: 53,
  sampleModes: 54,
  scaleTuning: 56,
  exclusiveClass: 57,
  overridingRootKey: 58,
};

class BinaryReader {
  constructor(buffer) {
    this.view = new DataView(buffer);
    this.pos = 0;
    this.length = buffer.byteLength;
    this.buffer = buffer;
  }

  readUint8() {
    const val = this.view.getUint8(this.pos);
    this.pos += 1;
    return val;
  }

  readUint16() {
    const val = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return val;
  }

  readInt16() {
    const val = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return val;
  }

  readUint32() {
    const val = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return val;
  }

  readString(length) {
    const bytes = new Uint8Array(this.buffer, this.pos, length);
    this.pos += length;
    // Trim null terminators
    let end = bytes.indexOf(0);
    if (end === -1) end = length;
    return new TextDecoder('ascii').decode(bytes.subarray(0, end));
  }

  readFourCC() {
    return this.readString(4);
  }

  skip(n) {
    this.pos += n;
  }

  slice(offset, length) {
    return this.buffer.slice(offset, offset + length);
  }
}

/**
 * Parse an SF2 file from an ArrayBuffer.
 * Returns a structured object with all SF2 data.
 */
export function parseSF2(buffer) {
  const reader = new BinaryReader(buffer);

  // RIFF header
  const riffId = reader.readFourCC();
  if (riffId !== 'RIFF') throw new Error('Not a RIFF file');
  const riffSize = reader.readUint32();
  const format = reader.readFourCC();
  if (format !== 'sfbk') throw new Error('Not a SoundFont file (expected sfbk)');

  const sf2 = {
    info: {},
    sampleData: null,
    sampleData24: null,
    presetHeaders: [],
    presetBags: [],
    presetGenerators: [],
    presetModulators: [],
    instrumentHeaders: [],
    instrumentBags: [],
    instrumentGenerators: [],
    instrumentModulators: [],
    sampleHeaders: [],
    // Raw chunk data preserved for faithful reconstruction
    rawChunks: {},
  };

  const riffEnd = 12 + riffSize - 4; // account for 'sfbk' fourcc
  while (reader.pos < riffEnd && reader.pos < reader.length) {
    const chunkId = reader.readFourCC();
    const chunkSize = reader.readUint32();
    const chunkStart = reader.pos;

    if (chunkId === 'LIST') {
      const listType = reader.readFourCC();
      const listEnd = chunkStart + chunkSize;

      if (listType === 'INFO') {
        parseInfoList(reader, listEnd, sf2);
      } else if (listType === 'sdta') {
        parseSdtaList(reader, listEnd, sf2);
      } else if (listType === 'pdta') {
        parsePdtaList(reader, listEnd, sf2);
      } else {
        reader.pos = listEnd;
      }
    } else {
      reader.pos = chunkStart + chunkSize;
    }

    // Chunks are word-aligned
    if (reader.pos % 2 !== 0 && reader.pos < reader.length) {
      reader.pos++;
    }
  }

  return sf2;
}

function parseInfoList(reader, end, sf2) {
  while (reader.pos < end) {
    const id = reader.readFourCC();
    const size = reader.readUint32();
    const start = reader.pos;

    if (id === 'ifil' || id === 'iver') {
      const major = reader.readUint16();
      const minor = reader.readUint16();
      sf2.info[id] = { major, minor };
    } else {
      sf2.info[id] = reader.readString(size);
    }

    reader.pos = start + size;
    if (reader.pos % 2 !== 0 && reader.pos < end) reader.pos++;
  }
}

function parseSdtaList(reader, end, sf2) {
  while (reader.pos < end) {
    const id = reader.readFourCC();
    const size = reader.readUint32();
    const start = reader.pos;

    if (id === 'smpl') {
      sf2.sampleData = reader.slice(start, size);
    } else if (id === 'sm24') {
      sf2.sampleData24 = reader.slice(start, size);
    }

    reader.pos = start + size;
    if (reader.pos % 2 !== 0 && reader.pos < end) reader.pos++;
  }
}

function parsePdtaList(reader, end, sf2) {
  while (reader.pos < end) {
    const id = reader.readFourCC();
    const size = reader.readUint32();
    const start = reader.pos;

    // Preserve raw data for each pdta sub-chunk
    sf2.rawChunks[id] = reader.slice(start, size);

    switch (id) {
      case 'phdr': parsePresetHeaders(reader, size, sf2); break;
      case 'pbag': parseBags(reader, size, sf2.presetBags); break;
      case 'pmod': parseModulators(reader, size, sf2.presetModulators); break;
      case 'pgen': parseGenerators(reader, size, sf2.presetGenerators); break;
      case 'inst': parseInstrumentHeaders(reader, size, sf2); break;
      case 'ibag': parseBags(reader, size, sf2.instrumentBags); break;
      case 'imod': parseModulators(reader, size, sf2.instrumentModulators); break;
      case 'igen': parseGenerators(reader, size, sf2.instrumentGenerators); break;
      case 'shdr': parseSampleHeaders(reader, size, sf2); break;
      default: reader.pos = start + size;
    }

    reader.pos = start + size;
    if (reader.pos % 2 !== 0 && reader.pos < end) reader.pos++;
  }
}

function parsePresetHeaders(reader, size, sf2) {
  const count = size / 38;
  for (let i = 0; i < count; i++) {
    sf2.presetHeaders.push({
      name: reader.readString(20),
      preset: reader.readUint16(),
      bank: reader.readUint16(),
      bagIndex: reader.readUint16(),
      library: reader.readUint32(),
      genre: reader.readUint32(),
      morphology: reader.readUint32(),
    });
  }
}

function parseInstrumentHeaders(reader, size, sf2) {
  const count = size / 22;
  for (let i = 0; i < count; i++) {
    sf2.instrumentHeaders.push({
      name: reader.readString(20),
      bagIndex: reader.readUint16(),
    });
  }
}

function parseBags(reader, size, bagArray) {
  const count = size / 4;
  for (let i = 0; i < count; i++) {
    bagArray.push({
      generatorIndex: reader.readUint16(),
      modulatorIndex: reader.readUint16(),
    });
  }
}

function parseGenerators(reader, size, genArray) {
  const count = size / 4;
  for (let i = 0; i < count; i++) {
    const oper = reader.readUint16();
    // Ranges are stored as two bytes (lo, hi)
    if (oper === GeneratorType.keyRange || oper === GeneratorType.velRange) {
      const lo = reader.readUint8();
      const hi = reader.readUint8();
      genArray.push({ oper, range: { lo, hi } });
    } else {
      const amount = reader.readInt16();
      genArray.push({ oper, amount });
    }
  }
}

function parseModulators(reader, size, modArray) {
  const count = size / 10;
  for (let i = 0; i < count; i++) {
    modArray.push({
      srcOper: reader.readUint16(),
      destOper: reader.readUint16(),
      amount: reader.readInt16(),
      amtSrcOper: reader.readUint16(),
      transOper: reader.readUint16(),
    });
  }
}

function parseSampleHeaders(reader, size, sf2) {
  const count = size / 46;
  for (let i = 0; i < count; i++) {
    sf2.sampleHeaders.push({
      name: reader.readString(20),
      start: reader.readUint32(),
      end: reader.readUint32(),
      loopStart: reader.readUint32(),
      loopEnd: reader.readUint32(),
      sampleRate: reader.readUint32(),
      originalPitch: reader.readUint8(),
      pitchCorrection: reader.readUint8() << 24 >> 24, // sign extend
      sampleLink: reader.readUint16(),
      sampleType: reader.readUint16(),
    });
  }
}

/**
 * Get a human-readable summary of a parsed SF2 file.
 */
export function getSF2Summary(sf2) {
  const banks = new Map();

  // Last preset header is the terminal record (EOP)
  const presets = sf2.presetHeaders.slice(0, -1);

  for (const p of presets) {
    if (!banks.has(p.bank)) {
      banks.set(p.bank, []);
    }
    banks.get(p.bank).push(p);
  }

  // Sort presets within each bank
  for (const [, presetList] of banks) {
    presetList.sort((a, b) => a.preset - b.preset);
  }

  return {
    name: sf2.info.INAM || 'Unknown',
    version: sf2.info.ifil ? `${sf2.info.ifil.major}.${sf2.info.ifil.minor}` : 'Unknown',
    engine: sf2.info.isng || '',
    author: sf2.info.IENG || '',
    copyright: sf2.info.ICOP || '',
    comment: sf2.info.ICMT || '',
    totalPresets: presets.length,
    totalInstruments: sf2.instrumentHeaders.length - 1, // minus terminal
    totalSamples: sf2.sampleHeaders.length - 1, // minus terminal
    banks: Object.fromEntries([...banks].sort((a, b) => a[0] - b[0])),
  };
}
