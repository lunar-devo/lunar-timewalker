/** Saved settings are read back value by value: whatever is not a valid value of its setting gets the default. */
import { describe, expect, it } from 'vitest';
import type { Settings } from './types';
import { sanitiseSettings } from './store';

const DEFAULTS: Settings = {
  lang: 'tr',
  quality: 'medium',
  mouseSensitivity: 1,
  masterVolume: 0.7,
  soundOn: true,
  narration: false,
  reducedFlash: false,
  showLabels: true,
  showConstellations: false,
  invertY: false,
};

describe('sanitiseSettings', () => {
  it('takes every valid saved value', () => {
    const saved: Settings = {
      lang: 'de',
      quality: 'ultra',
      mouseSensitivity: 2.5,
      masterVolume: 0,
      soundOn: false,
      narration: true,
      reducedFlash: true,
      showLabels: false,
      showConstellations: true,
      invertY: true,
    };
    expect(sanitiseSettings(JSON.parse(JSON.stringify(saved)), DEFAULTS)).toEqual(saved);
  });

  it('keeps the default of a setting whose saved value is of the wrong kind', () => {
    expect(sanitiseSettings({ quality: 'broken' }, DEFAULTS)).toEqual(DEFAULTS);
    expect(sanitiseSettings({ quality: 'toString', lang: 'xx' }, DEFAULTS)).toEqual(DEFAULTS);
    expect(sanitiseSettings({ soundOn: 'no', invertY: 1, masterVolume: '0.2', mouseSensitivity: null }, DEFAULTS)).toEqual(DEFAULTS);
  });

  it('keeps the default of a number outside its range', () => {
    expect(sanitiseSettings({ masterVolume: 1.01 }, DEFAULTS).masterVolume).toBe(0.7);
    expect(sanitiseSettings({ masterVolume: -0.1 }, DEFAULTS).masterVolume).toBe(0.7);
    expect(sanitiseSettings({ masterVolume: 1 }, DEFAULTS).masterVolume).toBe(1);
    expect(sanitiseSettings({ mouseSensitivity: 0.1 }, DEFAULTS).mouseSensitivity).toBe(1);
    expect(sanitiseSettings({ mouseSensitivity: 3.5 }, DEFAULTS).mouseSensitivity).toBe(1);
    expect(sanitiseSettings({ mouseSensitivity: Number.NaN }, DEFAULTS).mouseSensitivity).toBe(1);
    expect(sanitiseSettings({ mouseSensitivity: Number.POSITIVE_INFINITY }, DEFAULTS).mouseSensitivity).toBe(1);
    expect(sanitiseSettings({ mouseSensitivity: 0.2 }, DEFAULTS).mouseSensitivity).toBe(0.2);
    expect(sanitiseSettings({ mouseSensitivity: 3 }, DEFAULTS).mouseSensitivity).toBe(3);
  });

  it('judges each setting by itself', () => {
    expect(sanitiseSettings({ quality: 'broken', lang: 'fr', narration: true }, DEFAULTS))
      .toEqual({ ...DEFAULTS, lang: 'fr', narration: true });
  });

  it('drops keys that are not settings', () => {
    expect(sanitiseSettings({ lang: 'en', theme: 'dark', version: 2 }, DEFAULTS))
      .toEqual({ ...DEFAULTS, lang: 'en' });
  });

  it('gives the defaults for anything that is not an object of settings', () => {
    for (const saved of [null, undefined, 3, 'high', true, [], ['low']]) {
      expect(sanitiseSettings(saved, DEFAULTS)).toEqual(DEFAULTS);
    }
  });

  it('leaves the defaults it was given untouched', () => {
    const defaults = { ...DEFAULTS };
    sanitiseSettings({ lang: 'ru' }, defaults);
    expect(defaults).toEqual(DEFAULTS);
  });
});
