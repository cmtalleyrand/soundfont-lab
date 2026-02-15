/**
 * SF2 Writer
 *
 * Serializes a structured SF2 object back into a valid SF2 binary file.
 */

import { GeneratorType } from './sf2-parser.js';

class BinaryWriter {
  constructor(initialSize = 1024 * 1024) {
    this.buffer = new ArrayBuffer(initialSize);
    this.view = new DataView(this.buffer);
    this.pos = 0;
  }

  ensure(bytes) {
    while (this.pos + bytes > this.buffer.byteLength) {
      const newBuffer = new ArrayBuffer(this.buffer.byteLength * 2);
      new Uint8Array(newBuffer).set(new Uint8Array(this.buffer));
      this.buffer = newBuffer;
      this.view = new DataView(this.buffer);
    }
  }

  writeUint8(val) {
    this.ensure(1);
    this.view.setUint8(this.pos, val);
    this.pos += 1;
  }

  writeUint16(val) {
    this.ensure(2);
    this.view.setUint16(this.pos, val, true);
    this.pos += 2;
  }

  writeInt16(val) {
    this.ensure(2);
    this.view.setInt16(this.pos, val, true);
    this.pos += 2;
  }

  writeUint32(val) {
    this.ensure(4);
    this.view.setUint32(this.pos, val, true);
    this.pos += 4;
  }

  writeFourCC(str) {
    this.ensure(4);
    for (let i = 0; i < 4; i++) {
      this.view.setUint8(this.pos + i, i < str.length ? str.charCodeAt(i) : 0);
    }
    this.pos += 4;
  }

  writeString(str, length) {
    this.ensure(length);
    const bytes = new Uint8Array(this.buffer, this.pos, length);
    bytes.fill(0);
    for (let i = 0; i < Math.min(str.length, length - 1); i++) {
      bytes[i] = str.charCodeAt(i);
    }
    this.pos += length;
  }

  writeBytes(arrayBuffer) {
    const src = new Uint8Array(arrayBuffer);
    this.ensure(src.length);
    new Uint8Array(this.buffer, this.pos, src.length).set(src);
    this.pos += src.length;
  }

  // Write a placeholder for a size field, returns offset to patch later
  writeSizePlaceholder() {
    const offset = this.pos;
    this.writeUint32(0);
    return offset;
  }

  patchSize(offset, size) {
    this.view.setUint32(offset, size, true);
  }

  getResult() {
    return this.buffer.slice(0, this.pos);
  }
}

/**
 * Write a complete SF2 file from a structured SF2 object.
 * Returns an ArrayBuffer containing the SF2 binary data.
 */
export function writeSF2(sf2) {
  const w = new BinaryWriter();

  // RIFF header
  w.writeFourCC('RIFF');
  const riffSizeOffset = w.writeSizePlaceholder();
  w.writeFourCC('sfbk');

  // INFO list
  writeInfoList(w, sf2);

  // sdta list (sample data)
  writeSdtaList(w, sf2);

  // pdta list (preset data)
  writePdtaList(w, sf2);

  // Patch RIFF size
  w.patchSize(riffSizeOffset, w.pos - 8);

  return w.getResult();
}

function writeInfoList(w, sf2) {
  w.writeFourCC('LIST');
  const listSizeOffset = w.writeSizePlaceholder();
  const listStart = w.pos;
  w.writeFourCC('INFO');

  // ifil - version (required, write first)
  const ifil = sf2.info.ifil || { major: 2, minor: 1 };
  w.writeFourCC('ifil');
  w.writeUint32(4);
  w.writeUint16(ifil.major);
  w.writeUint16(ifil.minor);

  // isng - sound engine
  writeInfoString(w, 'isng', sf2.info.isng || 'EMU8000');

  // INAM - name (required)
  writeInfoString(w, 'INAM', sf2.info.INAM || 'Untitled');

  // Optional info chunks
  const optionalKeys = ['ICRD', 'IENG', 'IPRD', 'ICOP', 'ICMT', 'ISFT'];
  for (const key of optionalKeys) {
    if (sf2.info[key]) {
      writeInfoString(w, key, sf2.info[key]);
    }
  }

  // iver
  if (sf2.info.iver) {
    w.writeFourCC('iver');
    w.writeUint32(4);
    w.writeUint16(sf2.info.iver.major);
    w.writeUint16(sf2.info.iver.minor);
  }

  w.patchSize(listSizeOffset, w.pos - listStart);
}

function writeInfoString(w, id, str) {
  const encoded = str + '\0';
  let len = encoded.length;
  // Pad to even length
  if (len % 2 !== 0) len++;

  w.writeFourCC(id);
  w.writeUint32(len);
  w.writeString(str, len);
}

function writeSdtaList(w, sf2) {
  w.writeFourCC('LIST');
  const listSizeOffset = w.writeSizePlaceholder();
  const listStart = w.pos;
  w.writeFourCC('sdta');

  if (sf2.sampleData) {
    const sampleBytes = new Uint8Array(sf2.sampleData);
    w.writeFourCC('smpl');
    w.writeUint32(sampleBytes.length);
    w.writeBytes(sf2.sampleData);
    // Pad to even
    if (sampleBytes.length % 2 !== 0) w.writeUint8(0);
  }

  if (sf2.sampleData24) {
    const sample24Bytes = new Uint8Array(sf2.sampleData24);
    w.writeFourCC('sm24');
    w.writeUint32(sample24Bytes.length);
    w.writeBytes(sf2.sampleData24);
    if (sample24Bytes.length % 2 !== 0) w.writeUint8(0);
  }

  w.patchSize(listSizeOffset, w.pos - listStart);
}

function writePdtaList(w, sf2) {
  w.writeFourCC('LIST');
  const listSizeOffset = w.writeSizePlaceholder();
  const listStart = w.pos;
  w.writeFourCC('pdta');

  writePresetHeaders(w, sf2.presetHeaders);
  writeBags(w, 'pbag', sf2.presetBags);
  writeModulators(w, 'pmod', sf2.presetModulators);
  writeGenerators(w, 'pgen', sf2.presetGenerators);
  writeInstrumentHeaders(w, sf2.instrumentHeaders);
  writeBags(w, 'ibag', sf2.instrumentBags);
  writeModulators(w, 'imod', sf2.instrumentModulators);
  writeGenerators(w, 'igen', sf2.instrumentGenerators);
  writeSampleHeaders(w, sf2.sampleHeaders);

  w.patchSize(listSizeOffset, w.pos - listStart);
}

function writePresetHeaders(w, headers) {
  w.writeFourCC('phdr');
  w.writeUint32(headers.length * 38);
  for (const h of headers) {
    w.writeString(h.name, 20);
    w.writeUint16(h.preset);
    w.writeUint16(h.bank);
    w.writeUint16(h.bagIndex);
    w.writeUint32(h.library || 0);
    w.writeUint32(h.genre || 0);
    w.writeUint32(h.morphology || 0);
  }
}

function writeBags(w, chunkId, bags) {
  w.writeFourCC(chunkId);
  w.writeUint32(bags.length * 4);
  for (const b of bags) {
    w.writeUint16(b.generatorIndex);
    w.writeUint16(b.modulatorIndex);
  }
}

function writeGenerators(w, chunkId, generators) {
  w.writeFourCC(chunkId);
  w.writeUint32(generators.length * 4);
  for (const g of generators) {
    w.writeUint16(g.oper);
    if (g.oper === GeneratorType.keyRange || g.oper === GeneratorType.velRange) {
      w.writeUint8(g.range ? g.range.lo : 0);
      w.writeUint8(g.range ? g.range.hi : 127);
    } else {
      w.writeInt16(g.amount || 0);
    }
  }
}

function writeModulators(w, chunkId, modulators) {
  w.writeFourCC(chunkId);
  w.writeUint32(modulators.length * 10);
  for (const m of modulators) {
    w.writeUint16(m.srcOper);
    w.writeUint16(m.destOper);
    w.writeInt16(m.amount);
    w.writeUint16(m.amtSrcOper);
    w.writeUint16(m.transOper);
  }
}

function writeInstrumentHeaders(w, headers) {
  w.writeFourCC('inst');
  w.writeUint32(headers.length * 22);
  for (const h of headers) {
    w.writeString(h.name, 20);
    w.writeUint16(h.bagIndex);
  }
}

function writeSampleHeaders(w, headers) {
  w.writeFourCC('shdr');
  w.writeUint32(headers.length * 46);
  for (const h of headers) {
    w.writeString(h.name, 20);
    w.writeUint32(h.start);
    w.writeUint32(h.end);
    w.writeUint32(h.loopStart);
    w.writeUint32(h.loopEnd);
    w.writeUint32(h.sampleRate);
    w.writeUint8(h.originalPitch);
    w.writeUint8(h.pitchCorrection & 0xFF);
    w.writeUint16(h.sampleLink);
    w.writeUint16(h.sampleType);
  }
}
