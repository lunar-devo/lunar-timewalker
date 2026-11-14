/** A translation is merged into the text it was written for and into no other, whatever was extracted in between. */
import { describe, expect, it } from 'vitest';
import { keyedTexts, mergeDone, textKey } from './i18n';

describe('merging done files', () => {
  const byKey = keyedTexts(['Close', 'Open', '{0} light years']);

  it('finds the text of an entry by the key made from its English wording', () => {
    const have: Record<string, string> = {};
    const done = { [textKey('Open')]: 'Öffnen', [textKey('{0} light years')]: '{0} Lichtjahre' };
    expect(mergeDone(done, byKey, have)).toEqual([]);
    expect(have).toEqual({ Open: 'Öffnen', '{0} light years': '{0} Lichtjahre' });
  });

  it('refuses a file numbered by place in an older todo list instead of applying it to other texts', () => {
    const have: Record<string, string> = {};
    const wrong = mergeDone({ 0: 'Hilfe', 1: 'Zurück' }, byKey, have);
    expect(wrong).toHaveLength(1);
    expect(wrong[0]).toContain('2 entries (0, 1)');
    expect(wrong[0]).toContain('extract');
    expect(have).toEqual({});
  });

  it('refuses an entry whose English text has changed since, and takes the others', () => {
    const have: Record<string, string> = {};
    const wrong = mergeDone({ [textKey('Close')]: 'Schließen', [textKey('Close window')]: 'Fenster schließen' }, byKey, have);
    expect(wrong).toHaveLength(1);
    expect(have).toEqual({ Close: 'Schließen' });
  });

  it('refuses empty translations and changed placeholders', () => {
    const have: Record<string, string> = {};
    const wrong = mergeDone({ [textKey('Close')]: ' ', [textKey('Open')]: 3, [textKey('{0} light years')]: 'Lichtjahre' }, byKey, have);
    expect(wrong).toHaveLength(3);
    expect(have).toEqual({});
  });
});
