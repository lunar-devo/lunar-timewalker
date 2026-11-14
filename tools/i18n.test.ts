/**
 * Every language offered in the app has a translation for every text in the source, with the same
 * {0}, {1}… placeholders. Fails when a text is added or changed without re-running the translation tool.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LANGS } from '../src/core/l10n';
import { collect, TRANSLATED_LANGS } from './i18n';

const placeholders = (s: string): string => (s.match(/\{\d+\}/g) ?? []).sort().join('');
const edges = (s: string): string => `${/^\s*/.exec(s)?.[0]}|${/\s*$/.exec(s)?.[0]}`;

describe('translations', () => {
  const { texts, problems } = collect();

  it('offers exactly the languages that have a dictionary', () => {
    expect(LANGS.map((l) => l.id).filter((id) => id !== 'tr' && id !== 'en')).toEqual([...TRANSLATED_LANGS]);
  });

  it('finds every text of the source in a translatable form', () => {
    expect(problems).toEqual([]);
    expect(texts.size).toBeGreaterThan(500);
  });

  for (const lang of TRANSLATED_LANGS) {
    it(`${lang}: translates every text and keeps placeholders and surrounding spaces`, () => {
      const file = fileURLToPath(new URL(`../public/assets/i18n/${lang}.json`, import.meta.url));
      const dict = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
      const all = [...texts.keys()];
      expect(all.filter((en) => typeof dict[en] !== 'string' || dict[en].trim() === '')).toEqual([]);
      expect(all.filter((en) => placeholders(en) !== placeholders(dict[en]))).toEqual([]);
      expect(all.filter((en) => edges(en) !== edges(dict[en]))).toEqual([]);
    });
  }
});
