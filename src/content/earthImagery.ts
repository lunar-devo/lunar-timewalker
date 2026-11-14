/**
 * Which picture of Earth to show for a given moment. On chapter dates with satellite coverage the game uses
 * that day's real NASA GIBS true-colour mosaic (clouds included); otherwise the cloud-free Blue Marble NG
 * composite of the same calendar month (2004), so snow and vegetation match the season. City lights
 * (Black Marble 2016) are only drawn for years when electric lighting existed.
 */
import type { L10n } from '../core/types';
import { lf, tpl } from '../core/l10n';
import { calendarUTFromJdTT, jdTTFromCalendarUT } from '../core/time';

export interface EarthImagery {
  /** Texture base name for texUrl(), e.g. 'earth_day_20240510'. */
  texName: string;
  label: L10n;
  /** True when the clouds are the real ones of that day. */
  dated: boolean;
}

/** Dates built by tools/build_assets.py (step earth_imagery). */
const DATED = [
  { y: 2000, m: 5, d: 5, sensor: 'MODIS Terra' },
  { y: 2003, m: 8, d: 27, sensor: 'MODIS Terra' },
  { y: 2018, m: 6, d: 20, sensor: 'VIIRS SNPP' },
  { y: 2024, m: 5, d: 10, sensor: 'VIIRS SNPP' },
  { y: 2026, m: 8, d: 12, sensor: 'VIIRS SNPP' },
].map((e) => ({ ...e, jd: jdTTFromCalendarUT({ year: e.y, month: e.m, day: e.d, hour: 12 }) }));

const pad = (n: number): string => String(n).padStart(2, '0');

export function earthImageryFor(jdTT: number): EarthImagery {
  for (const e of DATED) {
    if (Math.abs(jdTT - e.jd) <= 2) {
      const day = `${e.y}-${pad(e.m)}-${pad(e.d)}`;
      return {
        texName: `earth_day_${e.y}${pad(e.m)}${pad(e.d)}`,
        dated: true,
        label: lf(tpl`Dünya: ${day} gerçek bulutları (${e.sensor}, NASA GIBS)`, tpl`Earth: real clouds of ${day} (${e.sensor}, NASA GIBS)`),
      };
    }
  }
  const month = calendarUTFromJdTT(jdTT).month;
  return {
    texName: `earth_day_m${pad(month)}`,
    dated: false,
    label: lf(
      tpl`Dünya: bulutsuz Blue Marble, ${month}. ay birleşimi (2004) — o günün bulutları değil`,
      tpl`Earth: cloud-free Blue Marble, month ${month} composite (2004) — not that day's clouds`,
    ),
  };
}

/** 0..1 strength of city lights on the night side: none before 1880, Black Marble level from 1990. */
export function cityLightsFor(year: number): number {
  return Math.min(1, Math.max(0, (year - 1880) / 110));
}
