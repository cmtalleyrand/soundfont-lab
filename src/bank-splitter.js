/**
 * Bank Splitter
 *
 * Splits a parsed SF2 file into separate SF2 files, one per bank.
 * Each output file contains only the presets, instruments, and samples
 * belonging to that bank.
 *
 * The tricky part is remapping all index references:
 *   preset -> presetBag -> presetGenerator (references instrument index)
 *   instrument -> instrumentBag -> instrumentGenerator (references sampleID)
 *   sample headers (references sample data offsets)
 */

import { GeneratorType } from './sf2-parser.js';
import { writeSF2 } from './sf2-writer.js';

/**
 * Split a parsed SF2 into per-bank SF2 files.
 *
 * @param {Object} sf2 - Parsed SF2 object from parseSF2()
 * @returns {Map<number, {bankNumber: number, name: string, buffer: ArrayBuffer}>}
 */
export function splitBanks(sf2) {
  const results = new Map();

  // Group presets by bank (exclude terminal record)
  const presetsByBank = new Map();
  const presets = sf2.presetHeaders.slice(0, -1);

  for (let i = 0; i < presets.length; i++) {
    const p = presets[i];
    if (!presetsByBank.has(p.bank)) {
      presetsByBank.set(p.bank, []);
    }
    presetsByBank.get(p.bank).push({ ...p, originalIndex: i });
  }

  for (const [bankNum, bankPresets] of presetsByBank) {
    const bankSF2 = extractBank(sf2, bankPresets, bankNum);
    const buffer = writeSF2(bankSF2);
    const bankName = sf2.info.INAM
      ? `${sf2.info.INAM} - Bank ${bankNum}`
      : `Bank ${bankNum}`;

    results.set(bankNum, {
      bankNumber: bankNum,
      name: bankName,
      presetCount: bankPresets.length,
      buffer,
    });
  }

  return results;
}

/**
 * Extract a single bank's worth of data into a new SF2 structure.
 */
function extractBank(sf2, bankPresets, bankNum) {
  // Step 1: Determine which instruments are needed
  const instrumentIndices = new Set();

  for (const preset of bankPresets) {
    const bagStart = preset.bagIndex;
    const nextPresetIdx = preset.originalIndex + 1;
    const bagEnd = nextPresetIdx < sf2.presetHeaders.length
      ? sf2.presetHeaders[nextPresetIdx].bagIndex
      : sf2.presetBags.length;

    for (let bi = bagStart; bi < bagEnd; bi++) {
      const bag = sf2.presetBags[bi];
      const genStart = bag.generatorIndex;
      const genEnd = bi + 1 < sf2.presetBags.length
        ? sf2.presetBags[bi + 1].generatorIndex
        : sf2.presetGenerators.length;

      for (let gi = genStart; gi < genEnd; gi++) {
        const gen = sf2.presetGenerators[gi];
        if (gen.oper === GeneratorType.instrument) {
          instrumentIndices.add(gen.amount);
        }
      }
    }
  }

  // Step 2: Determine which samples are needed
  const sampleIndices = new Set();
  const sortedInstruments = [...instrumentIndices].sort((a, b) => a - b);

  for (const instIdx of sortedInstruments) {
    const inst = sf2.instrumentHeaders[instIdx];
    const nextInst = sf2.instrumentHeaders[instIdx + 1];
    const bagStart = inst.bagIndex;
    const bagEnd = nextInst ? nextInst.bagIndex : sf2.instrumentBags.length;

    for (let bi = bagStart; bi < bagEnd; bi++) {
      const bag = sf2.instrumentBags[bi];
      const genStart = bag.generatorIndex;
      const genEnd = bi + 1 < sf2.instrumentBags.length
        ? sf2.instrumentBags[bi + 1].generatorIndex
        : sf2.instrumentGenerators.length;

      for (let gi = genStart; gi < genEnd; gi++) {
        const gen = sf2.instrumentGenerators[gi];
        if (gen.oper === GeneratorType.sampleID) {
          sampleIndices.add(gen.amount);
        }
      }
    }
  }

  // Also include linked samples (stereo pairs)
  const sortedSamples = [...sampleIndices].sort((a, b) => a - b);
  for (const sIdx of sortedSamples) {
    const sh = sf2.sampleHeaders[sIdx];
    if (sh && sh.sampleLink !== 0 && (sh.sampleType & 0x04 || sh.sampleType & 0x02)) {
      sampleIndices.add(sh.sampleLink);
    }
  }

  // Step 3: Build remapping tables
  const instrumentRemap = new Map(); // old index -> new index
  const sortedInstrumentsFinal = [...instrumentIndices].sort((a, b) => a - b);
  sortedInstrumentsFinal.forEach((oldIdx, newIdx) => {
    instrumentRemap.set(oldIdx, newIdx);
  });

  const sampleRemap = new Map(); // old index -> new index
  const sortedSamplesFinal = [...sampleIndices].sort((a, b) => a - b);
  sortedSamplesFinal.forEach((oldIdx, newIdx) => {
    sampleRemap.set(oldIdx, newIdx);
  });

  // Step 4: Build new sample data
  // We need to figure out the minimal sample data and remap offsets
  const sampleDataView = sf2.sampleData ? new Uint8Array(sf2.sampleData) : new Uint8Array(0);
  const newSampleChunks = [];
  let newSampleOffset = 0;
  const sampleOffsetRemap = new Map(); // old sample index -> { newStart, newEnd, newLoopStart, newLoopEnd }

  for (const oldSampleIdx of sortedSamplesFinal) {
    const sh = sf2.sampleHeaders[oldSampleIdx];
    if (!sh) continue;

    // Sample data is in 16-bit samples, offsets are in sample points
    const byteStart = sh.start * 2;
    const byteEnd = sh.end * 2;
    const sampleLength = sh.end - sh.start;
    const loopStartOffset = sh.loopStart - sh.start;
    const loopEndOffset = sh.loopEnd - sh.start;

    if (byteEnd <= sampleDataView.length) {
      newSampleChunks.push(sampleDataView.slice(byteStart, byteEnd));
    } else {
      // Handle edge case: sample data might extend beyond buffer
      const available = Math.max(0, sampleDataView.length - byteStart);
      const chunk = new Uint8Array(Math.max(0, byteEnd - byteStart));
      if (available > 0) {
        chunk.set(sampleDataView.slice(byteStart, byteStart + available));
      }
      newSampleChunks.push(chunk);
    }

    sampleOffsetRemap.set(oldSampleIdx, {
      newStart: newSampleOffset,
      newEnd: newSampleOffset + sampleLength,
      newLoopStart: newSampleOffset + loopStartOffset,
      newLoopEnd: newSampleOffset + loopEndOffset,
    });

    newSampleOffset += sampleLength;
  }

  // Concatenate sample data
  const totalSampleBytes = newSampleOffset * 2;
  const newSampleData = new ArrayBuffer(totalSampleBytes);
  const newSampleView = new Uint8Array(newSampleData);
  let writeOffset = 0;
  for (const chunk of newSampleChunks) {
    newSampleView.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }

  // Step 5: Build new preset headers, bags, generators, modulators
  const newPresetHeaders = [];
  const newPresetBags = [];
  const newPresetGenerators = [];
  const newPresetModulators = [];

  let newBagIndex = 0;
  let newGenIndex = 0;
  let newModIndex = 0;

  // Sort presets by preset number for clean output
  const sortedPresets = [...bankPresets].sort((a, b) => a.preset - b.preset);

  for (const preset of sortedPresets) {
    newPresetHeaders.push({
      name: preset.name,
      preset: preset.preset,
      bank: preset.bank,
      bagIndex: newBagIndex,
      library: preset.library || 0,
      genre: preset.genre || 0,
      morphology: preset.morphology || 0,
    });

    const bagStart = preset.bagIndex;
    const nextPresetIdx = preset.originalIndex + 1;
    const bagEnd = nextPresetIdx < sf2.presetHeaders.length
      ? sf2.presetHeaders[nextPresetIdx].bagIndex
      : sf2.presetBags.length;

    for (let bi = bagStart; bi < bagEnd; bi++) {
      const bag = sf2.presetBags[bi];
      newPresetBags.push({
        generatorIndex: newGenIndex,
        modulatorIndex: newModIndex,
      });
      newBagIndex++;

      // Copy generators, remapping instrument references
      const genStart = bag.generatorIndex;
      const genEnd = bi + 1 < sf2.presetBags.length
        ? sf2.presetBags[bi + 1].generatorIndex
        : sf2.presetGenerators.length;

      for (let gi = genStart; gi < genEnd; gi++) {
        const gen = { ...sf2.presetGenerators[gi] };
        if (gen.oper === GeneratorType.instrument) {
          gen.amount = instrumentRemap.get(gen.amount) ?? gen.amount;
        }
        if (gen.range) gen.range = { ...gen.range };
        newPresetGenerators.push(gen);
        newGenIndex++;
      }

      // Copy modulators
      const modStart = bag.modulatorIndex;
      const modEnd = bi + 1 < sf2.presetBags.length
        ? sf2.presetBags[bi + 1].modulatorIndex
        : sf2.presetModulators.length;

      for (let mi = modStart; mi < modEnd; mi++) {
        newPresetModulators.push({ ...sf2.presetModulators[mi] });
        newModIndex++;
      }
    }
  }

  // Terminal preset record (EOP)
  newPresetHeaders.push({
    name: 'EOP',
    preset: 0,
    bank: 0,
    bagIndex: newBagIndex,
    library: 0,
    genre: 0,
    morphology: 0,
  });

  // Terminal preset bag
  newPresetBags.push({
    generatorIndex: newGenIndex,
    modulatorIndex: newModIndex,
  });

  // Terminal preset generator
  newPresetGenerators.push({ oper: 0, amount: 0 });

  // Terminal preset modulator
  newPresetModulators.push({
    srcOper: 0, destOper: 0, amount: 0, amtSrcOper: 0, transOper: 0,
  });

  // Step 6: Build new instrument headers, bags, generators, modulators
  const newInstrumentHeaders = [];
  const newInstrumentBags = [];
  const newInstrumentGenerators = [];
  const newInstrumentModulators = [];

  let newInstBagIndex = 0;
  let newInstGenIndex = 0;
  let newInstModIndex = 0;

  for (const oldInstIdx of sortedInstrumentsFinal) {
    const inst = sf2.instrumentHeaders[oldInstIdx];
    newInstrumentHeaders.push({
      name: inst.name,
      bagIndex: newInstBagIndex,
    });

    const bagStart = inst.bagIndex;
    const nextInst = sf2.instrumentHeaders[oldInstIdx + 1];
    const bagEnd = nextInst ? nextInst.bagIndex : sf2.instrumentBags.length;

    for (let bi = bagStart; bi < bagEnd; bi++) {
      const bag = sf2.instrumentBags[bi];
      newInstrumentBags.push({
        generatorIndex: newInstGenIndex,
        modulatorIndex: newInstModIndex,
      });
      newInstBagIndex++;

      // Copy generators, remapping sampleID references
      const genStart = bag.generatorIndex;
      const genEnd = bi + 1 < sf2.instrumentBags.length
        ? sf2.instrumentBags[bi + 1].generatorIndex
        : sf2.instrumentGenerators.length;

      for (let gi = genStart; gi < genEnd; gi++) {
        const gen = { ...sf2.instrumentGenerators[gi] };
        if (gen.oper === GeneratorType.sampleID) {
          gen.amount = sampleRemap.get(gen.amount) ?? gen.amount;
        }
        if (gen.range) gen.range = { ...gen.range };
        newInstrumentGenerators.push(gen);
        newInstGenIndex++;
      }

      // Copy modulators
      const modStart = bag.modulatorIndex;
      const modEnd = bi + 1 < sf2.instrumentBags.length
        ? sf2.instrumentBags[bi + 1].modulatorIndex
        : sf2.instrumentModulators.length;

      for (let mi = modStart; mi < modEnd; mi++) {
        newInstrumentModulators.push({ ...sf2.instrumentModulators[mi] });
        newInstModIndex++;
      }
    }
  }

  // Terminal instrument record (EOI)
  newInstrumentHeaders.push({
    name: 'EOI',
    bagIndex: newInstBagIndex,
  });

  // Terminal instrument bag
  newInstrumentBags.push({
    generatorIndex: newInstGenIndex,
    modulatorIndex: newInstModIndex,
  });

  // Terminal instrument generator
  newInstrumentGenerators.push({ oper: 0, amount: 0 });

  // Terminal instrument modulator
  newInstrumentModulators.push({
    srcOper: 0, destOper: 0, amount: 0, amtSrcOper: 0, transOper: 0,
  });

  // Step 7: Build new sample headers with remapped offsets
  const newSampleHeaders = [];

  for (const oldSampleIdx of sortedSamplesFinal) {
    const sh = sf2.sampleHeaders[oldSampleIdx];
    const offsets = sampleOffsetRemap.get(oldSampleIdx);

    newSampleHeaders.push({
      name: sh.name,
      start: offsets.newStart,
      end: offsets.newEnd,
      loopStart: offsets.newLoopStart,
      loopEnd: offsets.newLoopEnd,
      sampleRate: sh.sampleRate,
      originalPitch: sh.originalPitch,
      pitchCorrection: sh.pitchCorrection,
      sampleLink: sh.sampleLink !== 0 ? (sampleRemap.get(sh.sampleLink) ?? 0) : 0,
      sampleType: sh.sampleType,
    });
  }

  // Terminal sample header (EOS)
  newSampleHeaders.push({
    name: 'EOS',
    start: 0,
    end: 0,
    loopStart: 0,
    loopEnd: 0,
    sampleRate: 0,
    originalPitch: 0,
    pitchCorrection: 0,
    sampleLink: 0,
    sampleType: 0,
  });

  // Assemble the new SF2 structure
  const bankName = sf2.info.INAM
    ? `${sf2.info.INAM} - Bank ${bankNum}`
    : `Bank ${bankNum}`;

  return {
    info: {
      ...sf2.info,
      INAM: bankName,
      ICMT: `Bank ${bankNum} extracted from ${sf2.info.INAM || 'unknown soundfont'}`,
    },
    sampleData: newSampleData,
    sampleData24: null, // TODO: handle 24-bit sample splitting
    presetHeaders: newPresetHeaders,
    presetBags: newPresetBags,
    presetGenerators: newPresetGenerators,
    presetModulators: newPresetModulators,
    instrumentHeaders: newInstrumentHeaders,
    instrumentBags: newInstrumentBags,
    instrumentGenerators: newInstrumentGenerators,
    instrumentModulators: newInstrumentModulators,
    sampleHeaders: newSampleHeaders,
  };
}

/**
 * Get a summary of what splitting would produce, without actually building the files.
 */
export function previewSplit(sf2) {
  const presets = sf2.presetHeaders.slice(0, -1);
  const bankMap = new Map();

  for (const p of presets) {
    if (!bankMap.has(p.bank)) {
      bankMap.set(p.bank, { presets: [], instrumentCount: 0, sampleCount: 0 });
    }
    bankMap.get(p.bank).presets.push(p);
  }

  return [...bankMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bankNum, data]) => ({
      bankNumber: bankNum,
      presetCount: data.presets.length,
      presets: data.presets.sort((a, b) => a.preset - b.preset),
    }));
}
