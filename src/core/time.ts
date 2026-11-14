/**
 * Time core. Internal time is Julian Day (TT). Calendar dates are UT with astronomical year numbering
 * (year 0 = 1 BC) and switch from the Julian to the Gregorian calendar on 1582-10-15, the same
 * convention JPL Horizons uses. JS `Date` is deliberately not used: it is proleptic Gregorian.
 */
import { AstroTime } from 'astronomy-engine';
import type { CalendarDate, Lang } from './types';

export const J2000 = 2451545.0;
export const SECONDS_PER_DAY = 86400;
/** First day of the Gregorian calendar (1582-10-15 00:00). */
const GREGORIAN_START_JD = 2299160.5;

export type CalendarKind = 'julian' | 'gregorian';

/** Calendar date → Julian Day in the same time scale as the input. */
export function jdFromCalendar(d: CalendarDate, calendar: CalendarKind | 'auto' = 'auto'): number {
  let y = d.year;
  let m = d.month;
  const dayFrac = d.day + ((d.hour ?? 0) + ((d.minute ?? 0) + (d.second ?? 0) / 60) / 60) / 24;
  const julian = calendar === 'auto'
    ? (y < 1582 || (y === 1582 && (m < 10 || (m === 10 && d.day < 15))))
    : calendar === 'julian';
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  const b = julian ? 0 : 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + dayFrac + b - 1524.5;
}

export interface CalendarResult extends Required<CalendarDate> { calendar: CalendarKind }

/** Julian Day → calendar date (Julian calendar before 1582-10-15). Seconds are rounded to the nearest second. */
export function calendarFromJd(jd: number): CalendarResult {
  // Round to the nearest second first so 23:59:59.9 does not print as 24:00:00.
  const jdr = Math.round(jd * SECONDS_PER_DAY) / SECONDS_PER_DAY;
  const z = Math.floor(jdr + 0.5);
  const f = jdr + 0.5 - z;
  let a = z;
  const gregorian = jdr >= GREGORIAN_START_JD;
  if (gregorian) {
    const alpha = Math.floor((z - 1867216.25) / 36524.25);
    a = z + 1 + alpha - Math.floor(alpha / 4);
  }
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const dd = Math.floor(365.25 * c);
  const e = Math.floor((b - dd) / 30.6001);
  const day = b - dd - Math.floor(30.6001 * e);
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  let secs = Math.round(f * SECONDS_PER_DAY);
  if (secs >= SECONDS_PER_DAY) secs = SECONDS_PER_DAY - 1;
  const hour = Math.floor(secs / 3600);
  const minute = Math.floor((secs - hour * 3600) / 60);
  const second = secs - hour * 3600 - minute * 60;
  return { year, month, day, hour, minute, second, calendar: gregorian ? 'gregorian' : 'julian' };
}

/** UT Julian Day → TT Julian Day (ΔT from the Espenak–Meeus model in astronomy-engine). */
export function jdTTfromUT(jdUT: number): number {
  return new AstroTime(jdUT - J2000).tt + J2000;
}

/** TT Julian Day → UT Julian Day. */
export function jdUTfromTT(jdTT: number): number {
  return AstroTime.FromTerrestrialTime(jdTT - J2000).ut + J2000;
}

/** The present moment as a TT Julian Day. */
export function jdTTNow(): number {
  return jdTTfromUT(Date.now() / (SECONDS_PER_DAY * 1000) + 2440587.5);
}

/** Calendar date (UT) → jdTT. */
export function jdTTFromCalendarUT(d: CalendarDate): number {
  return jdTTfromUT(jdFromCalendar(d));
}

/** jdTT → calendar date in UT. */
export function calendarUTFromJdTT(jdTT: number): CalendarResult {
  return calendarFromJd(jdUTfromTT(jdTT));
}

/** astronomy-engine time object for a jdTT. */
export function astroTime(jdTT: number): AstroTime {
  return AstroTime.FromTerrestrialTime(jdTT - J2000);
}

/** ΔT = TT − UT in seconds. */
export function deltaTSeconds(jdTT: number): number {
  return (jdTT - jdUTfromTT(jdTT)) * SECONDS_PER_DAY;
}

/** Fractional astronomical year (for sliders and labels). */
export function decimalYear(jdTT: number): number {
  const c = calendarUTFromJdTT(jdTT);
  const start = jdFromCalendar({ year: c.year, month: 1, day: 1 });
  const end = jdFromCalendar({ year: c.year + 1, month: 1, day: 1 });
  return c.year + (jdUTfromTT(jdTT) - start) / (end - start);
}

/** jdTT for a fractional astronomical year. */
export function jdTTFromDecimalYear(year: number): number {
  const y = Math.floor(year);
  const start = jdFromCalendar({ year: y, month: 1, day: 1 });
  const end = jdFromCalendar({ year: y + 1, month: 1, day: 1 });
  return jdTTfromUT(start + (year - y) * (end - start));
}

const MONTHS: Record<Lang, string[]> = {
  tr: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  it: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
  // Genitive, as used in dates.
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
};

/** How a year before the common era is written; {y} is the year number. */
const BC_YEAR: Record<Lang, string> = {
  tr: 'M.Ö. {y}', en: '{y} BC', de: '{y} v. Chr.', fr: '{y} av. J.-C.', es: '{y} a. C.', it: '{y} a.C.', ru: '{y} до н. э.',
};

/** Day–month–year order and joiners. */
const DATE_PATTERN: Record<Lang, string> = {
  tr: '{d} {m} {y}', en: '{d} {m} {y}', de: '{d}. {m} {y}', fr: '{d} {m} {y}', es: '{d} de {m} de {y}', it: '{d} {m} {y}', ru: '{d} {m} {y}',
};

const JULIAN_TAG: Record<Lang, string> = {
  tr: 'Jülyen', en: 'Julian', de: 'julianisch', fr: 'julien', es: 'juliano', it: 'giuliano', ru: 'юлианский',
};

const UNIT_DAY: Record<Lang, string> = { tr: 'gün', en: 'd', de: 'T', fr: 'j', es: 'd', it: 'g', ru: 'сут' };
const UNIT_HOUR: Record<Lang, string> = { tr: 'sa', en: 'h', de: 'h', fr: 'h', es: 'h', it: 'h', ru: 'ч' };
const UNIT_MINUTE: Record<Lang, string> = { tr: 'dk', en: 'min', de: 'min', fr: 'min', es: 'min', it: 'min', ru: 'мин' };

/** "M.Ö. 44" / "44 BC" for year -43; plain number for CE years. */
export function yearLabel(astronomicalYear: number, lang: Lang): string {
  if (astronomicalYear > 0) return String(astronomicalYear);
  return BC_YEAR[lang].replace('{y}', String(1 - astronomicalYear));
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export interface FormatDateOptions { time?: boolean; seconds?: boolean; calendarTag?: boolean }

/** Human readable UT date for a jdTT, e.g. "4 Temmuz 1054 13:20 UT (Jülyen)". */
export function formatDate(jdTT: number, lang: Lang, opts: FormatDateOptions = {}): string {
  const c = calendarUTFromJdTT(jdTT);
  let s = DATE_PATTERN[lang]
    .replace('{d}', String(c.day))
    .replace('{m}', MONTHS[lang][c.month - 1])
    .replace('{y}', yearLabel(c.year, lang));
  if (opts.time) {
    s += ` ${pad2(c.hour)}:${pad2(c.minute)}${opts.seconds ? ':' + pad2(c.second) : ''} UT`;
  }
  if (opts.calendarTag && c.calendar === 'julian') s += ` (${JULIAN_TAG[lang]})`;
  return s;
}

/** "3 sa 12 dk" / "3 h 12 min", "2,4 gün" / "2.4 d". */
export function formatDuration(hours: number, lang: Lang): string {
  const h = Math.abs(hours);
  if (h >= 48) {
    const days = (h / 24).toFixed(1);
    return `${lang === 'en' ? days : days.replace('.', ',')} ${UNIT_DAY[lang]}`;
  }
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  if (hh === 0) return `${mm} ${UNIT_MINUTE[lang]}`;
  return `${hh} ${UNIT_HOUR[lang]} ${pad2(mm)} ${UNIT_MINUTE[lang]}`;
}
