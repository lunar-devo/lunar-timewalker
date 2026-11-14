/** Durations are rounded to whole minutes before they are split into hours and minutes. */
import { describe, expect, it } from 'vitest';
import { formatDuration } from './time';

describe('formatDuration', () => {
  it('never writes 60 minutes', () => {
    expect(formatDuration(59.6 / 60, 'en')).toBe('1 h 00 min');
    expect(formatDuration(119.7 / 60, 'en')).toBe('2 h 00 min');
    expect(formatDuration(59.4 / 60, 'en')).toBe('59 min');
    expect(formatDuration(1.9999, 'tr')).toBe('2 sa 00 dk');
    expect(formatDuration(23.9999, 'en')).toBe('24 h 00 min');
  });

  it('writes minutes alone under an hour, and hours with two-digit minutes from there', () => {
    expect(formatDuration(0, 'en')).toBe('0 min');
    expect(formatDuration(0.2, 'en')).toBe('12 min');
    expect(formatDuration(3.2, 'en')).toBe('3 h 12 min');
    expect(formatDuration(3.2, 'tr')).toBe('3 sa 12 dk');
    expect(formatDuration(-3.2, 'en')).toBe('3 h 12 min');
    expect(formatDuration(5.05, 'en')).toBe('5 h 03 min');
  });

  it('writes days from two days on, also when rounding is what reaches them', () => {
    expect(formatDuration(47.98, 'en')).toBe('47 h 59 min');
    expect(formatDuration(47.9999, 'en')).toBe('2.0 d');
    expect(formatDuration(48, 'en')).toBe('2.0 d');
    expect(formatDuration(57.6, 'tr')).toBe('2,4 gün');
  });
});
