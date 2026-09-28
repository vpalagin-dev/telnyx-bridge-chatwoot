import { describe, expect, it } from 'vitest';
import { normalizePhone } from '../../src/domain/phone.js';

describe('normalizePhone', () => {
  it.each([
    ['+1 (415) 555-2671', '+14155552671'],
    ['00 44 20 7946 0958', '+442079460958'],
    ['+380-67-123-45-67', '+380671234567'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['4155552671', '+0123456789', '+123', 'not-a-phone', '+abc14155552671'])('rejects non E.164-like input %s', (input) => {
    expect(() => normalizePhone(input)).toThrow(/E\.164/);
  });
});
