/**
 * Languages. Every text is written in Turkish and English. The other languages are dictionaries keyed by
 * the English text (public/assets/i18n/<lang>.json, built by tools/i18n.ts) and fetched when first chosen;
 * a text with no entry falls back to English.
 */
import type { L10n, L10nArg, Lang } from './types';
import { assetUrl } from './assets';

export interface LangInfo {
  id: Lang;
  /** The language's own name, for the picker. */
  name: string;
  /** BCP 47 tag for number formatting and speech. */
  locale: string;
}

export const LANGS: LangInfo[] = [
  { id: 'tr', name: 'Türkçe', locale: 'tr-TR' },
  { id: 'en', name: 'English', locale: 'en-US' },
  { id: 'de', name: 'Deutsch', locale: 'de-DE' },
  { id: 'fr', name: 'Français', locale: 'fr-FR' },
  { id: 'es', name: 'Español', locale: 'es-ES' },
  { id: 'it', name: 'Italiano', locale: 'it-IT' },
  { id: 'ru', name: 'Русский', locale: 'ru-RU' },
];

export const LOCALE = Object.fromEntries(LANGS.map((l) => [l.id, l.locale])) as Record<Lang, string>;

export function isLang(value: unknown): value is Lang {
  return LANGS.some((l) => l.id === value);
}

const dicts: Partial<Record<Lang, Record<string, string>>> = {};
const pending = new Map<Lang, Promise<void>>();
let revision = 0;
const listeners = new Set<() => void>();

/** Calls `cb` whenever a dictionary arrives; returns the unsubscribe function. */
export function onDictChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Counts dictionary arrivals (a snapshot for React's useSyncExternalStore). */
export function dictRevision(): number {
  return revision;
}

/** Installs a dictionary (also used by tests). */
export function setDict(lang: Lang, dict: Record<string, string>): void {
  dicts[lang] = dict;
  revision++;
  for (const cb of listeners) cb();
}

/**
 * The dictionary in a downloaded file: its entries that are texts (anything else in it is dropped), or null
 * when the file does not hold a dictionary at all.
 */
export function dictFromJson(json: unknown): Record<string, string> | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const dict: Record<string, string> = {};
  for (const [en, text] of Object.entries(json)) {
    if (typeof text === 'string') dict[en] = text;
  }
  return dict;
}

/**
 * Fetches the dictionary of a translated language (no-op for Turkish and English). Never rejects: when the
 * download fails nothing is installed, the texts stay English, and the next call tries again.
 */
export function loadDict(lang: Lang): Promise<void> {
  if (lang === 'tr' || lang === 'en' || dicts[lang]) return Promise.resolve();
  let job = pending.get(lang);
  if (!job) {
    job = fetch(assetUrl(`assets/i18n/${lang}.json`))
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((json: unknown) => {
        pending.delete(lang);
        const dict = dictFromJson(json);
        if (dict) setDict(lang, dict);
      });
    pending.set(lang, job);
  }
  return job;
}

/** A text with values in it: the template with {0}, {1}… in place of the values, and the values. */
export interface Tpl {
  key: string;
  values: L10nArg[];
}

/** Tag for texts with values: tpl`${n} light years` → template "{0} light years" + [n]. */
export function tpl(strings: TemplateStringsArray, ...values: L10nArg[]): Tpl {
  let key = strings[0];
  for (let i = 0; i < values.length; i++) key += `{${i}}${strings[i + 1]}`;
  return { key, values };
}

function fill(template: string, values: L10nArg[], lang: Lang): string {
  return template.replace(/\{(\d+)\}/g, (_m, index: string) => {
    const arg = values[Number(index)];
    if (arg === undefined) return '';
    if (typeof arg === 'function') return arg(lang);
    return typeof arg === 'object' ? loc(arg, lang) : String(arg);
  });
}

/** The text in `lang`. */
export function loc(text: L10n, lang: Lang): string {
  if (lang === 'tr') return text.tr;
  if (lang === 'en') return text.en;
  const dict = dicts[lang];
  if (text.tpl !== undefined) return fill(dict?.[text.tpl] ?? text.tpl, text.args ?? [], lang);
  return dict?.[text.en] ?? text.en;
}

/** An inline Turkish/English pair in `lang`: tx(lang, 'Kapat', 'Close'), or with tpl`…` templates. */
export function tx(lang: Lang, trText: string | Tpl, enText: string | Tpl): string {
  if (lang === 'tr') return typeof trText === 'string' ? trText : fill(trText.key, trText.values, 'tr');
  if (typeof enText === 'string') return lang === 'en' ? enText : dicts[lang]?.[enText] ?? enText;
  return fill(lang === 'en' ? enText.key : dicts[lang]?.[enText.key] ?? enText.key, enText.values, lang);
}

/** A localized text built from values, for state and content: lf(tpl`${site.name} yükleniyor…`, tpl`Loading ${site.name}…`). */
export function lf(trText: Tpl, enText: Tpl): L10n {
  return {
    tr: fill(trText.key, trText.values, 'tr'),
    en: fill(enText.key, enText.values, 'en'),
    tpl: enText.key,
    args: enText.values,
  };
}

/** Locale-aware number formatting with fixed decimals (Turkish, German… use a decimal comma). */
export function fmt(n: number, decimals: number, lang: Lang): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(LOCALE[lang], { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
