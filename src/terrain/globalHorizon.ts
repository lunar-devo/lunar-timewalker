/**
 * Skyline of any point on the Moon, computed straight from the global LOLA elevation map
 * (no terrain streaming, no landing). Used to compare sites without visiting them.
 */
import { BODY_RADIUS_M, demMeters, loadDem, type Dem } from '../core/dem';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
/** Ray march from 3 m out to 100 km, each step 8 % longer than the last, as terrain.horizonProfile does. */
const FIRST_STEP_M = 3;
const REACH_M = 100_000;
const STEP_GROWTH = 1.08;

let moonDem: Promise<Dem> | null = null;

/** The Moon's global LOLA map (assets/dem/moon_global.json), fetched once and shared by every caller. */
export function loadMoonGlobalDem(): Promise<Dem> {
  moonDem ??= loadDem('assets/dem/moon_global.json');
  return moonDem;
}

/** Catmull–Rom weights of the four samples around fraction t, written into out. */
function catmullRomWeights(t: number, out: Float64Array): void {
  const t2 = t * t;
  const t3 = t2 * t;
  out[0] = 0.5 * (-t3 + 2 * t2 - t);
  out[1] = 0.5 * (3 * t3 - 5 * t2 + 2);
  out[2] = 0.5 * (-3 * t3 + 4 * t2 + t);
  out[3] = 0.5 * (t3 - t2);
}

const weightsU = new Float64Array(4);
const weightsV = new Float64Array(4);
const rowStrides = new WeakMap<Dem, Int32Array>();
/** Closest east–west post spacing read from a row: the node spacing of the 3D terrain's wide grid (WIDE_SPACING_M). */
const MIN_POST_SPACING_M = 200;

/**
 * Column step of each DEM row: the smallest divisor of the width that keeps the posts read from that row at least
 * MIN_POST_SPACING_M apart. Toward the poles an equirectangular row packs its posts metres apart, and their
 * metre-sized differences would otherwise turn into steep false slopes right next to the site; the 3D terrain
 * avoids them the same way by resampling the map onto its 200 m grid.
 */
function strideTable(dem: Dem): Int32Array {
  const cached = rowStrides.get(dem);
  if (cached) return cached;
  const { width: w, height: h, latTopDeg = 90 } = dem.meta;
  const equatorSpacingM = (2 * Math.PI * BODY_RADIUS_M.moon) / w;
  const divisors: number[] = [];
  for (let s = 1; s <= w; s++) if (w % s === 0) divisors.push(s);
  const table = new Int32Array(h);
  for (let j = 0; j < h; j++) {
    const spacingM = equatorSpacingM * Math.cos((latTopDeg - ((j + 0.5) * 180) / h) * DEG2RAD);
    table[j] = divisors.find((s) => s * spacingM >= MIN_POST_SPACING_M) ?? w;
  }
  rowStrides.set(dem, table);
  return table;
}

/**
 * Bicubic (Catmull–Rom) height in metres of an equirectangular DEM, the interpolation the 3D terrain also uses for
 * the global map, so summits and ridges keep their height. Each row is read every strideTable() posts; longitude
 * wraps around, latitude clamps at the poles.
 */
function sampleBicubic(dem: Dem, strides: Int32Array, latDeg: number, lonDeg: number): number {
  const { width: w, height: h, lonLeftDeg = -180, latTopDeg = 90 } = dem.meta;
  const u = ((lonDeg - lonLeftDeg) / 360) * w - 0.5;
  const v = ((latTopDeg - latDeg) / 180) * h - 0.5;
  const j0 = Math.floor(v);
  catmullRomWeights(v - j0, weightsV);
  let sum = 0;
  for (let r = 0; r < 4; r++) {
    const j = j0 - 1 + r;
    const s = strides[j < 0 ? 0 : j >= h ? h - 1 : j];
    const us = u / s;
    const i0 = Math.floor(us);
    catmullRomWeights(us - i0, weightsU);
    let row = 0;
    for (let k = 0; k < 4; k++) row += weightsU[k] * demMeters(dem, ((((i0 - 1 + k) * s) % w) + w) % w, j);
    sum += weightsV[r] * row;
  }
  return sum;
}

/**
 * Elevation angle of the skyline, degrees, at azimuths i·360/samples clockwise from north, seen from eyeHeightM
 * above the ground at (latDeg, lonDeg). Each azimuth follows its great circle outward from 3 m to 100 km and keeps
 * the steepest point; the Moon is treated as an exact sphere of BODY_RADIUS_M.moon carrying the DEM heights,
 * so the values include the drop of its curvature (a flat plain gives the geometric dip of the horizon).
 */
export function globalHorizonProfile(dem: Dem, latDeg: number, lonDeg: number, eyeHeightM = 2, samples = 360): Float32Array {
  const r = BODY_RADIUS_M.moon;
  const strides = strideTable(dem);
  const eyeR = r + sampleBicubic(dem, strides, latDeg, lonDeg) + eyeHeightM;
  const phi1 = latDeg * DEG2RAD;
  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);

  const sinTheta: number[] = [];
  const cosTheta: number[] = [];
  for (let d = FIRST_STEP_M; d < REACH_M; d *= STEP_GROWTH) {
    sinTheta.push(Math.sin(d / r));
    cosTheta.push(Math.cos(d / r));
  }

  const profile = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const bearing = (i * 360 / samples) * DEG2RAD;
    const sinB = Math.sin(bearing);
    const cosB = Math.cos(bearing);
    // The steepest sight line has the largest rise/run; atan2 is applied once to the winner.
    let bestRise = -1;
    let bestRun = 0;
    for (let k = 0; k < sinTheta.length; k++) {
      const st = sinTheta[k];
      const ct = cosTheta[k];
      const sinPhi2 = sinPhi1 * ct + cosPhi1 * st * cosB;
      const lat = Math.asin(sinPhi2) * RAD2DEG;
      const lon = lonDeg + Math.atan2(sinB * st * cosPhi1, ct - sinPhi1 * sinPhi2) * RAD2DEG;
      const pr = r + sampleBicubic(dem, strides, lat, lon);
      const rise = pr * ct - eyeR;
      const run = pr * st;
      if (rise * bestRun > bestRise * run) {
        bestRise = rise;
        bestRun = run;
      }
    }
    profile[i] = Math.atan2(bestRise, bestRun) * RAD2DEG;
  }
  return profile;
}
