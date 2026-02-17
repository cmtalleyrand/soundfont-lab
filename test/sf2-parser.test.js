/**
 * Tests for SF2 parser, writer, and bank splitter.
 *
 * Since we don't have real SF2 files in the repo, we build
 * minimal valid SF2 binaries programmatically and verify round-trip.
 */

import { describe, it, expect } from 'vitest';
import { parseSF2, getSF2Summary, GeneratorType } from '../src/sf2-parser.js';
import { writeSF2 } from '../src/sf2-writer.js';
import { splitBanks, previewSplit } from '../src/bank-splitter.js';

/**
 * Build a minimal but valid SF2 file in memory.
 * Contains presets across multiple banks with instruments and samples.
 */
function buildTestSF2() {
  // Create sample data: 2 short samples (100 sample points each = 200 bytes each)
  const samplePointsPerSample = 100;
  const totalSamplePoints = samplePointsPerSample * 2;
  const sampleData = new ArrayBuffer(totalSamplePoints * 2); // 16-bit samples
  const sampleView = new Int16Array(sampleData);

  // Fill with simple waveforms
  for (let i = 0; i < samplePointsPerSample; i++) {
    sampleView[i] = Math.round(Math.sin(2 * Math.PI * i / samplePointsPerSample) * 16000);
  }
  for (let i = 0; i < samplePointsPerSample; i++) {
    sampleView[samplePointsPerSample + i] = Math.round(
      Math.sin(2 * Math.PI * i / (samplePointsPerSample / 2)) * 12000
    );
  }

  return {
    info: {
      ifil: { major: 2, minor: 1 },
      isng: 'EMU8000',
      INAM: 'Test SoundFont',
      IENG: 'Test Author',
    },
    sampleData,
    sampleData24: null,

    // 3 presets: 2 in bank 0, 1 in bank 1, plus terminal
    presetHeaders: [
      { name: 'Piano', preset: 0, bank: 0, bagIndex: 0, library: 0, genre: 0, morphology: 0 },
      { name: 'Strings', preset: 48, bank: 0, bagIndex: 1, library: 0, genre: 0, morphology: 0 },
      { name: 'Kick', preset: 0, bank: 128, bagIndex: 2, library: 0, genre: 0, morphology: 0 },
      { name: 'EOP', preset: 0, bank: 0, bagIndex: 3, library: 0, genre: 0, morphology: 0 },
    ],

    // 3 preset bags + terminal
    presetBags: [
      { generatorIndex: 0, modulatorIndex: 0 },
      { generatorIndex: 1, modulatorIndex: 0 },
      { generatorIndex: 2, modulatorIndex: 0 },
      { generatorIndex: 3, modulatorIndex: 0 },
    ],

    // 3 preset generators + terminal: each references an instrument
    presetGenerators: [
      { oper: GeneratorType.instrument, amount: 0 }, // Piano -> instrument 0
      { oper: GeneratorType.instrument, amount: 1 }, // Strings -> instrument 1
      { oper: GeneratorType.instrument, amount: 0 }, // Kick -> instrument 0 (reuse)
      { oper: 0, amount: 0 }, // terminal
    ],

    presetModulators: [
      { srcOper: 0, destOper: 0, amount: 0, amtSrcOper: 0, transOper: 0 },
    ],

    // 2 instruments + terminal
    instrumentHeaders: [
      { name: 'Piano Inst', bagIndex: 0 },
      { name: 'Strings Inst', bagIndex: 1 },
      { name: 'EOI', bagIndex: 2 },
    ],

    // 2 instrument bags + terminal
    instrumentBags: [
      { generatorIndex: 0, modulatorIndex: 0 },
      { generatorIndex: 1, modulatorIndex: 0 },
      { generatorIndex: 2, modulatorIndex: 0 },
    ],

    // 2 instrument generators + terminal: each references a sample
    instrumentGenerators: [
      { oper: GeneratorType.sampleID, amount: 0 }, // instrument 0 -> sample 0
      { oper: GeneratorType.sampleID, amount: 1 }, // instrument 1 -> sample 1
      { oper: 0, amount: 0 }, // terminal
    ],

    instrumentModulators: [
      { srcOper: 0, destOper: 0, amount: 0, amtSrcOper: 0, transOper: 0 },
    ],

    // 2 samples + terminal
    sampleHeaders: [
      {
        name: 'Piano Sample',
        start: 0, end: 100,
        loopStart: 10, loopEnd: 90,
        sampleRate: 44100,
        originalPitch: 60,
        pitchCorrection: 0,
        sampleLink: 0,
        sampleType: 1, // monoSample
      },
      {
        name: 'Strings Sample',
        start: 100, end: 200,
        loopStart: 110, loopEnd: 190,
        sampleRate: 44100,
        originalPitch: 60,
        pitchCorrection: 0,
        sampleLink: 0,
        sampleType: 1,
      },
      {
        name: 'EOS',
        start: 0, end: 0,
        loopStart: 0, loopEnd: 0,
        sampleRate: 0,
        originalPitch: 0,
        pitchCorrection: 0,
        sampleLink: 0,
        sampleType: 0,
      },
    ],

    rawChunks: {},
  };
}

describe('SF2 Parser', () => {
  it('should parse a written SF2 file (round-trip)', () => {
    const original = buildTestSF2();
    const buffer = writeSF2(original);
    const parsed = parseSF2(buffer);

    expect(parsed.info.INAM).toBe('Test SoundFont');
    expect(parsed.info.ifil.major).toBe(2);
    expect(parsed.info.ifil.minor).toBe(1);
    expect(parsed.presetHeaders.length).toBe(4); // 3 presets + terminal
    expect(parsed.instrumentHeaders.length).toBe(3); // 2 instruments + terminal
    expect(parsed.sampleHeaders.length).toBe(3); // 2 samples + terminal
  });

  it('should preserve preset names and numbers', () => {
    const original = buildTestSF2();
    const buffer = writeSF2(original);
    const parsed = parseSF2(buffer);

    expect(parsed.presetHeaders[0].name).toBe('Piano');
    expect(parsed.presetHeaders[0].preset).toBe(0);
    expect(parsed.presetHeaders[0].bank).toBe(0);

    expect(parsed.presetHeaders[1].name).toBe('Strings');
    expect(parsed.presetHeaders[1].preset).toBe(48);
    expect(parsed.presetHeaders[1].bank).toBe(0);

    expect(parsed.presetHeaders[2].name).toBe('Kick');
    expect(parsed.presetHeaders[2].bank).toBe(128);
  });

  it('should preserve generator references', () => {
    const original = buildTestSF2();
    const buffer = writeSF2(original);
    const parsed = parseSF2(buffer);

    // Preset generators should reference instruments
    expect(parsed.presetGenerators[0].oper).toBe(GeneratorType.instrument);
    expect(parsed.presetGenerators[0].amount).toBe(0);

    // Instrument generators should reference samples
    expect(parsed.instrumentGenerators[0].oper).toBe(GeneratorType.sampleID);
    expect(parsed.instrumentGenerators[0].amount).toBe(0);
  });

  it('should preserve sample header data', () => {
    const original = buildTestSF2();
    const buffer = writeSF2(original);
    const parsed = parseSF2(buffer);

    expect(parsed.sampleHeaders[0].name).toBe('Piano Sample');
    expect(parsed.sampleHeaders[0].sampleRate).toBe(44100);
    expect(parsed.sampleHeaders[0].originalPitch).toBe(60);
    expect(parsed.sampleHeaders[0].start).toBe(0);
    expect(parsed.sampleHeaders[0].end).toBe(100);
  });
});

describe('getSF2Summary', () => {
  it('should produce a correct summary', () => {
    const sf2 = buildTestSF2();
    const summary = getSF2Summary(sf2);

    expect(summary.name).toBe('Test SoundFont');
    expect(summary.totalPresets).toBe(3);
    expect(summary.totalInstruments).toBe(2);
    expect(summary.totalSamples).toBe(2);
    expect(Object.keys(summary.banks)).toHaveLength(2); // bank 0 and bank 128
    expect(summary.banks[0]).toHaveLength(2);
    expect(summary.banks[128]).toHaveLength(1);
  });
});

describe('Bank Splitter', () => {
  it('should preview split correctly', () => {
    const sf2 = buildTestSF2();
    const preview = previewSplit(sf2);

    expect(preview).toHaveLength(2);
    expect(preview[0].bankNumber).toBe(0);
    expect(preview[0].presetCount).toBe(2);
    expect(preview[1].bankNumber).toBe(128);
    expect(preview[1].presetCount).toBe(1);
  });

  it('should split into separate valid SF2 files', () => {
    const sf2 = buildTestSF2();
    const buffer = writeSF2(sf2);
    const parsed = parseSF2(buffer);

    const bankFiles = splitBanks(parsed);

    expect(bankFiles.size).toBe(2);
    expect(bankFiles.has(0)).toBe(true);
    expect(bankFiles.has(128)).toBe(true);

    // Bank 0 should have 2 presets
    const bank0 = bankFiles.get(0);
    expect(bank0.presetCount).toBe(2);

    // Bank 128 should have 1 preset
    const bank128 = bankFiles.get(128);
    expect(bank128.presetCount).toBe(1);
  });

  it('should produce parseable SF2 files after splitting', () => {
    const sf2 = buildTestSF2();
    const buffer = writeSF2(sf2);
    const parsed = parseSF2(buffer);

    const bankFiles = splitBanks(parsed);

    // Parse each bank file to verify it's valid
    for (const [bankNum, bankData] of bankFiles) {
      const bankParsed = parseSF2(bankData.buffer);
      expect(bankParsed.info.INAM).toContain(`Bank ${bankNum}`);

      // Should have correct number of presets (minus terminal)
      const presetCount = bankParsed.presetHeaders.length - 1;
      expect(presetCount).toBe(bankData.presetCount);

      // All generator references should be valid
      for (const gen of bankParsed.presetGenerators) {
        if (gen.oper === GeneratorType.instrument) {
          expect(gen.amount).toBeLessThan(bankParsed.instrumentHeaders.length - 1);
        }
      }

      for (const gen of bankParsed.instrumentGenerators) {
        if (gen.oper === GeneratorType.sampleID) {
          expect(gen.amount).toBeLessThan(bankParsed.sampleHeaders.length - 1);
        }
      }
    }
  });

  it('should handle shared instruments across banks correctly', () => {
    // In our test SF2, both bank 0 and bank 128 reference instrument 0
    const sf2 = buildTestSF2();
    const buffer = writeSF2(sf2);
    const parsed = parseSF2(buffer);

    const bankFiles = splitBanks(parsed);

    // Both banks should have the shared instrument
    const bank0 = parseSF2(bankFiles.get(0).buffer);
    const bank128 = parseSF2(bankFiles.get(128).buffer);

    // Bank 0 uses instruments 0 and 1
    expect(bank0.instrumentHeaders.length - 1).toBe(2);

    // Bank 128 uses only instrument 0 (remapped)
    expect(bank128.instrumentHeaders.length - 1).toBe(1);
    expect(bank128.instrumentHeaders[0].name).toBe('Piano Inst');
  });
});
