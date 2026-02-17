import { describe, it, expect } from 'vitest';
import { parseNotationInput } from '../src/notation.js';

describe('Notation parser', () => {
  it('parses hybrid SPN/ABC tokens with superscript octaves', () => {
    const parsed = parseNotationInput({
      input: 'C#⁴4 Gb⁶3/2',
      mode: 'hybrid',
      key: 'D',
    });

    expect(parsed).toHaveLength(2);
    expect(parsed[0].pitchClass).toBe('C#');
    expect(parsed[0].octave).toBe(4);
    expect(parsed[0].duration).toBe('4');
    expect(parsed[1].pitchClass).toBe('Gb');
    expect(parsed[1].octave).toBe(6);
    expect(parsed[1].duration).toBe('3/2');
  });

  it('parses pure ABC tokens and infers octave', () => {
    const parsed = parseNotationInput({
      input: "^c'2 _G,3/2",
      mode: 'pure-abc',
      key: 'G',
    });

    expect(parsed).toHaveLength(2);
    expect(parsed[0].pitchClass).toBe('C#');
    expect(parsed[0].octave).toBe(6);
    expect(parsed[1].pitchClass).toBe('Gb');
    expect(parsed[1].octave).toBe(3);
  });

  it('requires K in both modes', () => {
    expect(() => parseNotationInput({
      input: 'C#⁴4',
      mode: 'hybrid',
      key: '',
    })).toThrow(/K \(key\) is required/i);
  });
});
