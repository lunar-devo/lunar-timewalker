/**
 * Lunar-day timelines for the landing-site navigator: where the Sun and Earth stand above a site's skyline,
 * hour by hour, and what that means for solar power and direct-to-Earth radio.
 *
 * The places come from `sunEarthFromMoon` (the arithmetic of `computeSky`); the skyline is a horizon profile
 * (value i: elevation of the skyline, degrees, at azimuth i·360/length, clockwise from north). There is no
 * atmosphere, so no refraction: a body is hidden only by the terrain and the curve of the Moon.
 */
import type { SiteCoord } from '../core/types';
import {
  discVisibleFraction, HORIZON_DISC_RADIUS_DEG, horizonElevationAt, PANEL_EFFICIENCY, solarFluxWm2,
  sunEarthFromMoon, VISIBLE_DISC_FRACTION,
} from './index';
import type { SunEarthPlaces } from './index';

/** Mean length of the lunar day (new Moon to new Moon), days. */
export const SYNODIC_MONTH_DAYS = 29.530589;

/** The bisection of a rise or set stops once it is pinned down to this many days (about one minute). */
const EVENT_PRECISION_DAYS = 1 / 1440;

/** The share of the Sun's light the engine takes away when the Earth covers the whole disc (a lunar eclipse). */
const ECLIPSE_DIMMING = 0.95;

export interface TimelineSummary {
  /** The sky at the window's start, worked out exactly as the in-app telemetry is. */
  now: {
    sunAzDeg: number;
    sunElDeg: number;
    sunHorizonDeg: number;
    sunVisible: number;
    fluxWm2: number;
    panelPowerW: number;
    earthAzDeg: number;
    earthElDeg: number;
    earthHorizonDeg: number;
    earthVisible: boolean;
    lightTimeSec: number;
  };
  /** The first sunset or sunrise inside the window, hours after its start; null when none happens. */
  nextSun: { kind: 'set' | 'rise'; inHours: number } | null;
  /** The first Earthset or Earthrise inside the window, hours after its start; null when none happens. */
  nextEarth: { kind: 'set' | 'rise'; inHours: number } | null;
  /** Share (0..1) of the hourly samples with the Sun visible. */
  sunlitShare: number;
  /** The longest run of samples without the Sun, hours, at most the window's length. */
  longestDarkHours: number;
  /** Share (0..1) of the hourly samples with the Earth visible. */
  earthVisibleShare: number;
  /** The longest run of samples without the Earth, hours, at most the window's length. */
  longestEarthOutageHours: number;
  /** Mean of `fluxWm2` over the samples, W/m². */
  meanFluxWm2: number;
}

/**
 * Samples at `startJdTT + i·stepHours`. `sunVisible` and `earthVisible` are the shares (0..1) of each disc above
 * the skyline, with the mean radii rises and sets use; the Sun's share is dimmed as the engine dims it while
 * the Earth covers it. A body counts as visible above a share of 0.05. `fluxWm2` is the sunlight reaching a
 * panel turned square to the Sun: the solar constant scaled to the Sun's distance, times the Sun's visible
 * share (zero while it is hidden).
 */
export interface SiteTimeline {
  startJdTT: number;
  stepHours: number;
  sunElDeg: Float32Array;
  sunAzDeg: Float32Array;
  sunVisible: Float32Array;
  earthElDeg: Float32Array;
  earthAzDeg: Float32Array;
  earthVisible: Float32Array;
  fluxWm2: Float32Array;
  summary: TimelineSummary;
}

/** The Sun and Earth at one instant with the visible shares (0..1) of their discs, as the timeline samples them. */
interface SkySample extends SunEarthPlaces {
  sunShare: number;
  earthShare: number;
}

function sampleSky(site: SiteCoord, jdTT: number, horizon: Float32Array): SkySample {
  const places = sunEarthFromMoon(jdTT, site);
  const { sun, earth, sunObscuredByEarth } = places;
  return {
    ...places,
    sunShare: discVisibleFraction(horizon, sun.azDeg, sun.elDeg, HORIZON_DISC_RADIUS_DEG.sun)
      * (1 - sunObscuredByEarth * ECLIPSE_DIMMING),
    earthShare: discVisibleFraction(horizon, earth.azDeg, earth.elDeg, HORIZON_DISC_RADIUS_DEG.earth),
  };
}

/**
 * The first change of visibility of `body` inside the window: found between hourly samples (and the window's
 * end), then bisected to about a minute. A rise and set both falling between two samples go unseen.
 */
function firstCrossing(
  body: 'sun' | 'earth',
  shares: Float32Array,
  timeline: { site: SiteCoord; startJdTT: number; stepDays: number; endJdTT: number; horizon: Float32Array },
): { kind: 'set' | 'rise'; inHours: number } | null {
  const { site, startJdTT, stepDays, endJdTT, horizon } = timeline;
  const visibleAt = (jdTT: number): boolean => sampleSky(site, jdTT, horizon)[`${body}Share`] > VISIBLE_DISC_FRACTION;
  const startVisible = shares[0] > VISIBLE_DISC_FRACTION;
  let lo = startJdTT;
  let hi = Number.NaN;
  for (let i = 1; i < shares.length; i++) {
    if ((shares[i] > VISIBLE_DISC_FRACTION) !== startVisible) {
      lo = startJdTT + (i - 1) * stepDays;
      hi = startJdTT + i * stepDays;
      break;
    }
  }
  if (Number.isNaN(hi)) {
    lo = startJdTT + (shares.length - 1) * stepDays;
    if (lo >= endJdTT || visibleAt(endJdTT) === startVisible) return null;
    hi = endJdTT;
  }
  while (hi - lo > EVENT_PRECISION_DAYS) {
    const mid = 0.5 * (lo + hi);
    if (visibleAt(mid) === startVisible) lo = mid;
    else hi = mid;
  }
  return { kind: startVisible ? 'set' : 'rise', inHours: (0.5 * (lo + hi) - startJdTT) * 24 };
}

/** The share of samples above the visibility threshold and the longest run below it, in hours. */
function runStats(shares: Float32Array, stepHours: number, windowHours: number): { share: number; longestGapHours: number } {
  let visibleCount = 0;
  let gap = 0;
  let longestGap = 0;
  for (const share of shares) {
    if (share > VISIBLE_DISC_FRACTION) {
      visibleCount++;
      gap = 0;
    } else {
      gap++;
      longestGap = Math.max(longestGap, gap);
    }
  }
  return {
    share: visibleCount / shares.length,
    longestGapHours: Math.min(windowHours, longestGap * stepHours),
  };
}

/**
 * The Sun and Earth above a Moon site from `startJdTT` (TT) for `days` (default one synodic month) every
 * `stepHours` (default 1), against the skyline `horizon`, with a summary for comparing sites.
 */
export function computeSiteTimeline(
  site: SiteCoord,
  startJdTT: number,
  horizon: Float32Array,
  options: { days?: number; stepHours?: number } = {},
): SiteTimeline {
  const days = options.days ?? SYNODIC_MONTH_DAYS;
  const stepHours = options.stepHours ?? 1;
  const windowHours = days * 24;
  const count = Math.max(1, Math.ceil(windowHours / stepHours - 1e-9));
  const stepDays = stepHours / 24;

  const sunElDeg = new Float32Array(count);
  const sunAzDeg = new Float32Array(count);
  const sunVisible = new Float32Array(count);
  const earthElDeg = new Float32Array(count);
  const earthAzDeg = new Float32Array(count);
  const earthVisible = new Float32Array(count);
  const fluxWm2 = new Float32Array(count);
  let fluxSum = 0;

  for (let i = 0; i < count; i++) {
    const { sun, earth, sunShare, earthShare } = sampleSky(site, startJdTT + i * stepDays, horizon);
    sunElDeg[i] = sun.elDeg;
    sunAzDeg[i] = sun.azDeg;
    sunVisible[i] = sunShare;
    earthElDeg[i] = earth.elDeg;
    earthAzDeg[i] = earth.azDeg;
    earthVisible[i] = earthShare;
    fluxWm2[i] = solarFluxWm2(sun.distanceAU) * sunShare;
    fluxSum += fluxWm2[i];
  }

  const { sun, earth, sunObscuredByEarth } = sunEarthFromMoon(startJdTT, site);
  const nowSunVisible = discVisibleFraction(horizon, sun.azDeg, sun.elDeg, sun.angularDiameterDeg * 0.5)
    * (1 - sunObscuredByEarth * ECLIPSE_DIMMING);
  const nowFlux = solarFluxWm2(sun.distanceAU);
  const span = { site, startJdTT, stepDays, endJdTT: startJdTT + days, horizon };
  const sunRuns = runStats(sunVisible, stepHours, windowHours);
  const earthRuns = runStats(earthVisible, stepHours, windowHours);

  return {
    startJdTT,
    stepHours,
    sunElDeg,
    sunAzDeg,
    sunVisible,
    earthElDeg,
    earthAzDeg,
    earthVisible,
    fluxWm2,
    summary: {
      now: {
        sunAzDeg: sun.azDeg,
        sunElDeg: sun.elDeg,
        sunHorizonDeg: horizonElevationAt(horizon, sun.azDeg),
        sunVisible: nowSunVisible,
        fluxWm2: nowFlux,
        panelPowerW: nowFlux * PANEL_EFFICIENCY * nowSunVisible,
        earthAzDeg: earth.azDeg,
        earthElDeg: earth.elDeg,
        earthHorizonDeg: horizonElevationAt(horizon, earth.azDeg),
        earthVisible: discVisibleFraction(horizon, earth.azDeg, earth.elDeg, earth.angularDiameterDeg * 0.5) > VISIBLE_DISC_FRACTION,
        lightTimeSec: earth.lightTimeSec,
      },
      nextSun: firstCrossing('sun', sunVisible, span),
      nextEarth: firstCrossing('earth', earthVisible, span),
      sunlitShare: sunRuns.share,
      longestDarkHours: sunRuns.longestGapHours,
      earthVisibleShare: earthRuns.share,
      longestEarthOutageHours: earthRuns.longestGapHours,
      meanFluxWm2: fluxSum / count,
    },
  };
}
