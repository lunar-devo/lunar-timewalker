import { describe, expect, it } from 'vitest';
import { BODY_RADIUS_M, type Dem } from '../core/dem';
import { globalHorizonProfile } from './globalHorizon';

const R = BODY_RADIUS_M.moon;
const RAD2DEG = 180 / Math.PI;
const EYE_M = 2;
/** 0.05° per pixel: about 1.5 km on the Moon's equator. */
const W = 7200;
const H = 3600;

/** Flat global DEM (height 0 everywhere, 1 m per unit) whose pixels can then be raised one by one. */
function flatDem(): Dem {
  return {
    meta: {
      width: W, height: H, offset: 0, scale: 1, nodata: null, projection: 'equirect',
      lonLeftDeg: -180, latTopDeg: 90, metersPerSample: (2 * Math.PI * R) / W, source: 'synthetic', credit: 'test',
    },
    data: new Uint16Array(W * H),
  };
}

/** Raise every pixel around (0°, 0°) whose centre lies at least minDistM away (great circle, up to 6°) to heightM. */
function raiseRing(dem: Dem, minDistM: number, heightM: number): void {
  const span = 6 * (W / 360);
  for (let j = H / 2 - span; j < H / 2 + span; j++) {
    for (let i = W / 2 - span; i < W / 2 + span; i++) {
      const lat = 90 - ((j + 0.5) * 180) / H;
      const lon = -180 + ((i + 0.5) * 360) / W;
      const c = Math.cos(lat / RAD2DEG) * Math.cos(lon / RAD2DEG);
      if (Math.acos(Math.min(1, c)) * R >= minDistM) dem.data[j * W + i] = heightM;
    }
  }
}

/** Elevation angle, degrees, of a point at ground distance d and height h, seen from eye height above a 0 m site. */
function sightAngle(dM: number, hM: number): number {
  const th = dM / R;
  return Math.atan2((R + hM) * Math.cos(th) - (R + EYE_M), (R + hM) * Math.sin(th)) * RAD2DEG;
}

function argMax(values: Float32Array): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

/** Centre of pixel (W/2, H/2), so pixels in the same row or column lie exactly east, west, north or south of it. */
const CENTRE_LAT = 90 - ((H / 2 + 0.5) * 180) / H;
const CENTRE_LON = -180 + ((W / 2 + 0.5) * 360) / W;

describe('globalHorizonProfile', () => {
  it('sees the geometric dip of the horizon over a smooth sphere', () => {
    const dip = -Math.acos(R / (R + EYE_M)) * RAD2DEG;
    const profile = globalHorizonProfile(flatDem(), 10, 20, EYE_M, 360);
    for (const v of profile) expect(Math.abs(v - dip)).toBeLessThan(0.01);
  });

  it('measures a ring wall of known height at a known distance', () => {
    // March distances: 3 m · 1.08^k. Put the wall edge 4.5 km inside one of them (the 4 × 4 bicubic footprint reaches
    // 2 pixels, 3 km, along each axis), so that sample reads the full height while the sample before it, 6.7 km
    // nearer, reads flat ground or the slightly negative Catmull–Rom undershoot.
    let d = 3;
    while (d < 85_000) d *= 1.08;
    const wallM = 3000;
    const dem = flatDem();
    raiseRing(dem, d - 4500, wallM);
    const profile = globalHorizonProfile(dem, 0, 0, EYE_M, 360);
    const expected = sightAngle(d, wallM);
    for (const v of profile) expect(v).toBeCloseTo(expected, 3);
  });

  it('puts a mountain due east at index 90 and due north at index 0', () => {
    const east = flatDem();
    east.data[(H / 2) * W + W / 2 + 10] = 2000;
    expect(argMax(globalHorizonProfile(east, CENTRE_LAT, CENTRE_LON, EYE_M, 360))).toBe(90);

    const north = flatDem();
    north.data[(H / 2 - 10) * W + W / 2] = 2000;
    expect(argMax(globalHorizonProfile(north, CENTRE_LAT, CENTRE_LON, EYE_M, 360))).toBe(0);
  });

  it('stays finite next to the south pole', () => {
    const dem = flatDem();
    for (let i = 0; i < W; i += 7) dem.data[(H - 1) * W + i] = 500;
    const profile = globalHorizonProfile(dem, -89.95, 37, EYE_M, 360);
    for (const v of profile) expect(Number.isFinite(v)).toBe(true);
  });

  it('does not turn post-to-post jitter of the crowded polar rows into a skyline', () => {
    // ±5 m of pseudo-random jitter on every post within 2° of the south pole, where neighbouring posts in a row
    // lie only metres apart (the LOLA map near Shackleton varies like this).
    const dem = flatDem();
    for (let j = H - 40; j < H; j++) {
      for (let i = 0; i < W; i++) dem.data[j * W + i] = 5 + Math.round(5 * Math.sin(i * 12.9898 + j * 78.233));
    }
    const profile = globalHorizonProfile(dem, -89.78, -155.73, EYE_M, 360);
    for (const v of profile) expect(v).toBeLessThan(1);
  });

  it('honours other sample counts', () => {
    const dem = flatDem();
    dem.data[(H / 2) * W + W / 2 + 10] = 2000;
    const profile = globalHorizonProfile(dem, CENTRE_LAT, CENTRE_LON, EYE_M, 720);
    expect(profile.length).toBe(720);
    expect(argMax(profile)).toBe(180);
    expect(globalHorizonProfile(dem, CENTRE_LAT, CENTRE_LON, EYE_M, 36).length).toBe(36);
  });
});
