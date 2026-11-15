import { describe, expect, it } from 'vitest';
import { computeSky, sunEarthFromMoon } from './index';
import { computeSiteTimeline, SYNODIC_MONTH_DAYS } from './navigator';
import { jdTTFromCalendarUT } from '../core/time';

const APOLLO11 = { latDeg: 0.67416, lonDeg: 23.47314 };
const SHACKLETON = { latDeg: -89.78, lonDeg: -155.73 };
const EQUATOR = { latDeg: 0, lonDeg: 0 };
const FLAT = new Float32Array(360);
const START = jdTTFromCalendarUT({ year: 2026, month: 11, day: 15, hour: 0 });
const WINDOW_HOURS = SYNODIC_MONTH_DAYS * 24;

/** A skyline 6° high toward the north half of the sky (azimuth 270°..90°), flat toward the south. */
const NORTH_WALL = Float32Array.from({ length: 360 }, (_, az) => (az >= 270 || az <= 90 ? 6 : 0));

describe('sunEarthFromMoon', () => {
  it('gives the Sun and Earth exactly where computeSky puts them', () => {
    const dates = [
      jdTTFromCalendarUT({ year: 1969, month: 7, day: 20, hour: 20, minute: 17 }),
      START,
      jdTTFromCalendarUT({ year: 2028, month: 3, day: 2, hour: 6 }),
    ];
    for (const site of [APOLLO11, SHACKLETON, EQUATOR, { latDeg: 45, lonDeg: -120 }]) {
      for (const jdTT of dates) {
        const lean = sunEarthFromMoon(jdTT, site);
        const sky = computeSky(jdTT, site);
        for (const body of ['sun', 'earth'] as const) {
          expect(Math.abs(lean[body].azDeg - sky.bodies[body].azDeg)).toBeLessThan(1e-9);
          expect(Math.abs(lean[body].elDeg - sky.bodies[body].elDeg)).toBeLessThan(1e-9);
          expect(lean[body].distanceKm).toBe(sky.bodies[body].distanceKm);
        }
        expect(lean.sunObscuredByEarth).toBe(sky.sunObscuredByEarth);
      }
    }
  });
});

describe('computeSiteTimeline', () => {
  it('samples one synodic month hourly by default', () => {
    const t = computeSiteTimeline(EQUATOR, START, FLAT);
    expect(t.stepHours).toBe(1);
    expect(t.sunElDeg.length).toBe(Math.ceil(WINDOW_HOURS));
    expect(t.fluxWm2.length).toBe(t.sunVisible.length);
  });

  it('keeps the Sun up about half of a lunar day on the equator with a flat skyline', () => {
    const { summary } = computeSiteTimeline(EQUATOR, START, FLAT);
    // Day and night are equal on the equator. The share comes out 0.5007..0.5035 over 2026: hourly sampling moves
    // it by up to 2/709 (one sample at each edge of the day) and a disc counts as up while only 5 % shows, a few
    // minutes before its centre rises and after it sets. Hence a tolerance of 0.005.
    expect(Math.abs(summary.sunlitShare - 0.5)).toBeLessThan(0.005);
    // A night lasts about 354 h; the window's edges may cut it in two, so the longest dark run is at most that.
    expect(summary.longestDarkHours).toBeGreaterThan(0);
    expect(summary.longestDarkHours).toBeLessThan(356);
    // Sub-Earth point near 0°/0°: the Earth stays high all month.
    expect(summary.earthVisibleShare).toBe(1);
    expect(summary.longestEarthOutageHours).toBe(0);
    expect(summary.nextEarth).toBeNull();
  });

  it('gives a south-pole site walled off to the north less sunlight than a flat one', () => {
    const flat = computeSiteTimeline(SHACKLETON, START, FLAT).summary;
    const walled = computeSiteTimeline(SHACKLETON, START, NORTH_WALL).summary;
    expect(walled.sunlitShare).toBeLessThan(flat.sunlitShare);
    expect(walled.meanFluxWm2).toBeLessThan(flat.meanFluxWm2);
    expect(walled.longestDarkHours).toBeGreaterThan(flat.longestDarkHours);
  });

  it('announces a sunset when the Sun is up at the start, and a sunrise when it is down', () => {
    const t = computeSiteTimeline(EQUATOR, START, FLAT);
    const upAt = t.sunVisible.findIndex((v) => v > 0.5);
    const downAt = t.sunVisible.findIndex((v) => v < 0.01);
    const fromDay = computeSiteTimeline(EQUATOR, START + upAt / 24, FLAT).summary;
    const fromNight = computeSiteTimeline(EQUATOR, START + downAt / 24, FLAT).summary;
    expect(fromDay.now.sunVisible).toBeGreaterThan(0.05);
    expect(fromDay.nextSun?.kind).toBe('set');
    expect(fromNight.nextSun?.kind).toBe('rise');
  });

  it('pins the next sunset down to about a minute', () => {
    const t = computeSiteTimeline(EQUATOR, START, FLAT);
    const { nextSun } = t.summary;
    expect(nextSun).not.toBeNull();
    const at = START + nextSun!.inHours / 24;
    const before = computeSiteTimeline(EQUATOR, at - 1 / 1440, FLAT, { days: 0.01, stepHours: 0.1 }).sunVisible[0];
    const after = computeSiteTimeline(EQUATOR, at + 1 / 1440, FLAT, { days: 0.01, stepHours: 0.1 }).sunVisible[0];
    expect((before > 0.05) !== (after > 0.05)).toBe(true);
  });

  it('keeps shares within 0..1 and runs within the window', () => {
    for (const [site, horizon] of [[APOLLO11, FLAT], [SHACKLETON, NORTH_WALL], [SHACKLETON, FLAT]] as const) {
      for (const days of [SYNODIC_MONTH_DAYS, 3.3]) {
        const { summary } = computeSiteTimeline(site, START, horizon, { days });
        for (const share of [summary.sunlitShare, summary.earthVisibleShare]) {
          expect(share).toBeGreaterThanOrEqual(0);
          expect(share).toBeLessThanOrEqual(1);
        }
        for (const hours of [summary.longestDarkHours, summary.longestEarthOutageHours]) {
          expect(hours).toBeGreaterThanOrEqual(0);
          expect(hours).toBeLessThanOrEqual(days * 24);
        }
        for (const next of [summary.nextSun, summary.nextEarth]) {
          if (next) expect(next.inHours).toBeLessThanOrEqual(days * 24);
        }
      }
    }
  });

  it('gives a fully dark window a dark run of the whole window', () => {
    const wall = new Float32Array(360).fill(30);
    const { summary } = computeSiteTimeline(SHACKLETON, START, wall, { days: 2.5 });
    expect(summary.sunlitShare).toBe(0);
    expect(summary.longestDarkHours).toBe(60);
    expect(summary.meanFluxWm2).toBe(0);
    expect(summary.nextSun).toBeNull();
  });
});
