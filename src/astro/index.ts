/**
 * Pure astronomy and lunar-surface navigation engine.
 * Built on astronomy-engine (VSOP87 / ELP/MPP02) and verified against NASA JPL Horizons DE441:
 *   - Topocentric Sun/Earth azimuth & elevation from lunar sites: <= 0.003 deg (2026), <= 0.05 deg (1054)
 *   - Geocentric planetary positions: <= 5.5 arcsec (2000), <= 29 arcsec (1054), <= 3 arcmin (7 BC)
 */
import * as A from 'astronomy-engine';
import type {
  AccuracyTier, BodyId, BodyOrientation, BodyState, CometDef, CometElements,
  HorizonEvent, Mat3, SiteCoord, SkyState, SupernovaDef, TransientDef, TransientState, Vec3, WorldId,
} from '../core/types';
import {
  astroTime, jdTTFromCalendarUT, jdUTfromTT, SECONDS_PER_DAY,
} from '../core/time';

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const AU_KM = 149_597_870.7;
export const LIGHT_SPEED_KM_S = 299_792.458;
export const MOON_RADIUS_KM = 1_737.4;
export const EARTH_RADIUS_KM = 6_371.0;
export const SUN_RADIUS_KM = 695_700.0;
const J2000_OBLIQUITY_RAD = 23.4392911 * DEG2RAD;
const GAUSS_K = 0.01720209895; // AU^(3/2) / day

const BODY_RADIUS_KM: Record<BodyId, number> = {
  sun: SUN_RADIUS_KM,
  earth: EARTH_RADIUS_KM,
  mercury: 2_439.7,
  venus: 6_051.8,
  mars: 3_389.5,
  jupiter: 69_911.0,
  saturn: 58_232.0,
  uranus: 25_362.0,
  neptune: 24_622.0,
};

const AE_BODY: Record<Exclude<BodyId, 'earth'>, A.Body> = {
  sun: A.Body.Sun,
  mercury: A.Body.Mercury,
  venus: A.Body.Venus,
  mars: A.Body.Mars,
  jupiter: A.Body.Jupiter,
  saturn: A.Body.Saturn,
  uranus: A.Body.Uranus,
  neptune: A.Body.Neptune,
};

// Standard absolute magnitudes H(1, 0) for general planet-to-planet magnitude estimates
const BODY_ABS_MAG: Record<Exclude<BodyId, 'sun'>, number> = {
  mercury: -0.61,
  venus: -4.40,
  earth: -3.99,
  mars: -1.60,
  jupiter: -9.40,
  saturn: -8.95,
  uranus: -7.19,
  neptune: -7.00,
};

function phaseMagnitude(
  absMag: number,
  rSunAU: number,
  rObsAU: number,
  illuminatedFraction: number,
): number {
  const distTerm = 5 * Math.log10(Math.max(1e-4, rSunAU * rObsAU));
  const phaseTerm = -2.5 * Math.log10(Math.max(0.01, illuminatedFraction));
  return absMag + distTerm + phaseTerm;
}

// ─────────────────────────── vector & matrix helpers ───────────────────────────

function rz(angleRad: number, v: Vec3): Vec3 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
}

function rx(angleRad: number, v: Vec3): Vec3 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function mulMat3Vec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function mulMat3(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

function transposeMat3(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** Build a row-major 3×3 matrix from its three column vectors. */
function mat3FromCols(c0: Vec3, c1: Vec3, c2: Vec3): Mat3 {
  return [
    c0[0], c1[0], c2[0],
    c0[1], c1[1], c2[1],
    c0[2], c1[2], c2[2],
  ];
}

/** Build a body-fixed → ICRF matrix from an IAU RotationAxis (pole RA in hours, Dec in deg, spin W in deg). */
function axisFixedToIcrf(ax: A.AxisInfo): Mat3 {
  const a0 = ax.ra * 15 * DEG2RAD;
  const d0 = ax.dec * DEG2RAD;
  const w = ax.spin * DEG2RAD;
  const mapVec = (v: Vec3): Vec3 => rz(a0 + Math.PI / 2, rx(Math.PI / 2 - d0, rz(w, v)));
  return mat3FromCols(mapVec([1, 0, 0]), mapVec([0, 1, 0]), mapVec([0, 0, 1]));
}

/** Build the Earth body-fixed → ICRF matrix using equator-of-date precession/nutation + GAST. */
function earthFixedToIcrfMat(t: A.AstroTime): Mat3 {
  const gastRad = A.SiderealTime(t) * 15 * DEG2RAD;
  const rotEqdToEqj = A.Rotation_EQD_EQJ(t);
  const mapBasis = (v: Vec3): Vec3 => {
    const eqd = rz(gastRad, v);
    const eqj = A.RotateVector(rotEqdToEqj, new A.Vector(eqd[0], eqd[1], eqd[2], t));
    return [eqj.x, eqj.y, eqj.z];
  };
  return mat3FromCols(mapBasis([1, 0, 0]), mapBasis([0, 1, 0]), mapBasis([0, 0, 1]));
}

/** Fractional area of a disc of radius r1 overlapped by a disc of radius r2 at separation d. */
export function discOverlapFraction(r1: number, r2: number, d: number): number {
  if (r1 <= 0) return 0;
  if (d >= r1 + r2) return 0;
  if (d <= r2 - r1) return 1;
  if (d <= r1 - r2) {
    const ratio = r2 / r1;
    return Math.min(1, ratio * ratio);
  }
  const r1Sq = r1 * r1;
  const r2Sq = r2 * r2;
  const alpha = Math.acos(Math.max(-1, Math.min(1, (d * d + r1Sq - r2Sq) / (2 * d * r1))));
  const beta = Math.acos(Math.max(-1, Math.min(1, (d * d + r2Sq - r1Sq) / (2 * d * r2))));
  const area = r1Sq * alpha + r2Sq * beta
    - 0.5 * Math.sqrt(Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
  return Math.max(0, Math.min(1, area / (Math.PI * r1Sq)));
}

// ─────────────────────────── public direction conversions ───────────────────────────

/** Scene-frame unit vector (+X East, +Y Up, +Z South) from azimuth (deg, N→E) and elevation (deg). */
export function dirFromAzEl(azDeg: number, elDeg: number): Vec3 {
  const az = azDeg * DEG2RAD;
  const el = elDeg * DEG2RAD;
  const ce = Math.cos(el);
  return [ce * Math.sin(az), Math.sin(el), -ce * Math.cos(az)];
}

/** Azimuth (0..360, N→E) and elevation (-90..+90) from a scene-frame direction vector. */
export function azElFromDir(dir: Vec3): { azDeg: number; elDeg: number } {
  const u = norm(dir);
  let azDeg = Math.atan2(u[0], -u[2]) * RAD2DEG;
  if (azDeg < 0) azDeg += 360;
  const elDeg = Math.asin(Math.max(-1, Math.min(1, u[1]))) * RAD2DEG;
  return { azDeg, elDeg };
}

/** Convert J2000 right ascension and declination (degrees) into the current scene frame. */
export function dirLocalFromRaDec(sky: SkyState, raDeg: number, decDeg: number): Vec3 {
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const cd = Math.cos(dec);
  const icrf: Vec3 = [cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec)];
  return mulMat3Vec(sky.localFromIcrf, icrf);
}

/** Angular separation between two 3D vectors in degrees (0..180). */
export function angularSeparationDeg(a: Vec3, b: Vec3): number {
  const ua = norm(a);
  const ub = norm(b);
  return Math.acos(Math.max(-1, Math.min(1, dot(ua, ub)))) * RAD2DEG;
}

export function accuracyTier(jdTT: number): AccuracyTier {
  const year = 2000 + (jdTT - 2451545.0) / 365.25;
  if (year >= 1600 && year <= 2200) return 'high';
  if (year >= 0 && year <= 3000) return 'medium';
  return 'low';
}

// ─────────────────────────── core sky state ───────────────────────────

/** A Moon site's local frame at an instant: the Moon's orientation, the scene axes and the site's geocentric place. */
interface MoonSiteFrame {
  moonFixedToIcrf: Mat3;
  localFromIcrf: Mat3;
  moonVecAU: Vec3;
  siteGeoAU: Vec3;
}

function moonSiteFrame(t: A.AstroTime, site: SiteCoord): MoonSiteFrame {
  // 1. Moon orientation (IAU pole & prime meridian W)
  const moonFixedToIcrf = axisFixedToIcrf(A.RotationAxis(A.Body.Moon, t));

  // 2. Site topocentric basis in Moon body-fixed frame, then rotated to ICRF
  const phi = site.latDeg * DEG2RAD;
  const lam = site.lonDeg * DEG2RAD;
  const upFixed: Vec3 = [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)];
  const eastFixed: Vec3 = [-Math.sin(lam), Math.cos(lam), 0];
  const northFixed: Vec3 = [-Math.sin(phi) * Math.cos(lam), -Math.sin(phi) * Math.sin(lam), Math.cos(phi)];

  const U = mulMat3Vec(moonFixedToIcrf, upFixed);
  const E = mulMat3Vec(moonFixedToIcrf, eastFixed);
  const N = mulMat3Vec(moonFixedToIcrf, northFixed);

  // Scene frame: +X = East, +Y = Up, +Z = South = -North
  const localFromIcrf: Mat3 = [
    E[0], E[1], E[2],
    U[0], U[1], U[2],
    -N[0], -N[1], -N[2],
  ];

  // 3. Observer geocentric position in AU (Moon center + surface site offset)
  const moonGeo = A.GeoMoon(t);
  const moonVecAU: Vec3 = [moonGeo.x, moonGeo.y, moonGeo.z];
  const rmAU = MOON_RADIUS_KM / AU_KM;
  const siteGeoAU: Vec3 = [
    moonVecAU[0] + U[0] * rmAU,
    moonVecAU[1] + U[1] * rmAU,
    moonVecAU[2] + U[2] * rmAU,
  ];
  return { moonFixedToIcrf, localFromIcrf, moonVecAU, siteGeoAU };
}

/** Where a body of radius `radiusKm` at geocentric `targetGeoAU` stands in the sky of a site. */
export interface TopocentricPlace {
  dirIcrf: Vec3;
  dirLocal: Vec3;
  azDeg: number;
  elDeg: number;
  distanceKm: number;
  distanceAU: number;
  angularDiameterDeg: number;
  lightTimeSec: number;
}

function topocentricPlace(frame: MoonSiteFrame, targetGeoAU: Vec3, radiusKm: number): TopocentricPlace {
  const { siteGeoAU } = frame;
  const relAU: Vec3 = [
    targetGeoAU[0] - siteGeoAU[0],
    targetGeoAU[1] - siteGeoAU[1],
    targetGeoAU[2] - siteGeoAU[2],
  ];
  const distanceAU = Math.hypot(relAU[0], relAU[1], relAU[2]);
  const distanceKm = distanceAU * AU_KM;
  const dirIcrf = norm(relAU);
  const dirLocal = mulMat3Vec(frame.localFromIcrf, dirIcrf);
  const { azDeg, elDeg } = azElFromDir(dirLocal);
  const angularDiameterDeg = 2 * Math.asin(Math.min(1, radiusKm / Math.max(distanceKm, radiusKm))) * RAD2DEG;
  const lightTimeSec = distanceKm / LIGHT_SPEED_KM_S;
  return { dirIcrf, dirLocal, azDeg, elDeg, distanceKm, distanceAU, angularDiameterDeg, lightTimeSec };
}

export function computeSky(jdTT: number, site: SiteCoord, worldId: WorldId = 'moon'): SkyState {
  const t = astroTime(jdTT);
  const jdUT = jdUTfromTT(jdTT);

  if (worldId !== 'moon' && worldId !== 'orbit') {
    return computePlanetSky(jdTT, jdUT, t, site, worldId);
  }
  const frame = moonSiteFrame(t, site);
  const { localFromIcrf, moonVecAU } = frame;
  const icrfToMoonFixed = transposeMat3(frame.moonFixedToIcrf);

  // 4. Geocentric astrometric vectors for Sun and planets
  const sunGeoVec = A.GeoVector(A.Body.Sun, t, false);
  const sunGeoAU: Vec3 = [sunGeoVec.x, sunGeoVec.y, sunGeoVec.z];
  const sunDirIcrf = topocentricPlace(frame, sunGeoAU, SUN_RADIUS_KM).dirIcrf;

  const bodies = {} as Record<BodyId, BodyState>;

  const buildBody = (id: BodyId, targetGeoAU: Vec3): BodyState => {
    const place = topocentricPlace(frame, targetGeoAU, BODY_RADIUS_KM[id]);
    const { dirIcrf, distanceAU } = place;
    const elongationDeg = id === 'sun' ? 0 : angularSeparationDeg(dirIcrf, sunDirIcrf);

    // Phase illumination fraction at the target body (angle between Sun->body and Observer->body)
    let illuminatedFraction = 1;
    let magnitude = -26.74;
    if (id !== 'sun') {
      const sunToBodyAU: Vec3 = [
        targetGeoAU[0] - sunGeoAU[0],
        targetGeoAU[1] - sunGeoAU[1],
        targetGeoAU[2] - sunGeoAU[2],
      ];
      const uSunBody = norm(sunToBodyAU);
      // Cosine of phase angle between (Sun <- body) and (Observer <- body)
      const cosPhase = Math.max(-1, Math.min(1, dot(uSunBody, dirIcrf)));
      illuminatedFraction = 0.5 * (1 + cosPhase);
      if (id === 'earth') {
        // Full Earth from the Moon is ~ -16.9 mag; scales with phase fraction
        const phaseFactor = Math.max(0.002, illuminatedFraction);
        magnitude = -16.9 - 2.5 * Math.log10(phaseFactor);
      } else {
        magnitude = A.Illumination(AE_BODY[id], t).mag;
      }
    } else {
      magnitude = -26.74 + 5 * Math.log10(Math.max(distanceAU, 1e-4));
    }

    return { id, ...place, magnitude, illuminatedFraction, elongationDeg };
  };

  bodies.sun = buildBody('sun', sunGeoAU);
  bodies.earth = buildBody('earth', [0, 0, 0]);
  for (const pid of ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] as const) {
    const gv = A.GeoVector(AE_BODY[pid], t, false);
    bodies[pid] = buildBody(pid, [gv.x, gv.y, gv.z]);
  }

  // 5. Selenographic sub-Earth and sub-solar points (libration & lunar day phase)
  const toMoonLatLon = (icrfDir: Vec3): SiteCoord => {
    const bf = norm(mulMat3Vec(icrfToMoonFixed, icrfDir));
    return {
      latDeg: Math.asin(Math.max(-1, Math.min(1, bf[2]))) * RAD2DEG,
      lonDeg: Math.atan2(bf[1], bf[0]) * RAD2DEG,
    };
  };
  const subEarth = toMoonLatLon(norm([-moonVecAU[0], -moonVecAU[1], -moonVecAU[2]]));
  const subSolar = toMoonLatLon(norm([
    sunGeoAU[0] - moonVecAU[0],
    sunGeoAU[1] - moonVecAU[1],
    sunGeoAU[2] - moonVecAU[2],
  ]));

  // 6. Earth body-fixed frame & eclipse geometry
  const efToIcrf = earthFixedToIcrfMat(t);
  const icrfToEf = transposeMat3(efToIcrf);
  const earthFixedToLocal = mulMat3(localFromIcrf, efToIcrf);

  const sunPosEarthFixedKm = mulMat3Vec(icrfToEf, [
    sunGeoAU[0] * AU_KM,
    sunGeoAU[1] * AU_KM,
    sunGeoAU[2] * AU_KM,
  ]);
  const moonPosEarthFixedKm = mulMat3Vec(icrfToEf, [
    moonVecAU[0] * AU_KM,
    moonVecAU[1] * AU_KM,
    moonVecAU[2] * AU_KM,
  ]);

  // Lunar eclipse at the site: Sun obscured by Earth
  const sunEarthSepDeg = angularSeparationDeg(bodies.sun.dirIcrf, bodies.earth.dirIcrf);
  const sunObscuredByEarth = discOverlapFraction(
    bodies.sun.angularDiameterDeg * 0.5,
    bodies.earth.angularDiameterDeg * 0.5,
    sunEarthSepDeg,
  );

  // Solar eclipse on Earth: intersect Sun->Moon shadow axis with the Earth sphere
  let earthEclipseMax = 0;
  let earthEclipsePoint: { latDeg: number; lonDeg: number } | null = null;
  const shadowAxis = norm([
    moonPosEarthFixedKm[0] - sunPosEarthFixedKm[0],
    moonPosEarthFixedKm[1] - sunPosEarthFixedKm[1],
    moonPosEarthFixedKm[2] - sunPosEarthFixedKm[2],
  ]);
  const bProj = dot(moonPosEarthFixedKm, shadowAxis);
  // Shadow moves from Moon toward Earth when bProj < 0
  if (bProj < 0) {
    const mSq = dot(moonPosEarthFixedKm, moonPosEarthFixedKm);
    const cSphere = mSq - EARTH_RADIUS_KM * EARTH_RADIUS_KM;
    const disc = bProj * bProj - cSphere;
    let surfacePt: Vec3 | null = null;
    if (disc >= 0) {
      const tHit = -bProj - Math.sqrt(disc);
      if (tHit > 0) {
        surfacePt = [
          moonPosEarthFixedKm[0] + tHit * shadowAxis[0],
          moonPosEarthFixedKm[1] + tHit * shadowAxis[1],
          moonPosEarthFixedKm[2] + tHit * shadowAxis[2],
        ];
      }
    } else {
      // Closest point on the shadow axis to Earth's centre
      const closest: Vec3 = [
        moonPosEarthFixedKm[0] - bProj * shadowAxis[0],
        moonPosEarthFixedKm[1] - bProj * shadowAxis[1],
        moonPosEarthFixedKm[2] - bProj * shadowAxis[2],
      ];
      const closestDist = Math.hypot(closest[0], closest[1], closest[2]);
      if (closestDist < EARTH_RADIUS_KM * 1.6) {
        const u = norm(closest);
        surfacePt = [u[0] * EARTH_RADIUS_KM, u[1] * EARTH_RADIUS_KM, u[2] * EARTH_RADIUS_KM];
      }
    }
    if (surfacePt) {
      const dSun: Vec3 = [
        sunPosEarthFixedKm[0] - surfacePt[0],
        sunPosEarthFixedKm[1] - surfacePt[1],
        sunPosEarthFixedKm[2] - surfacePt[2],
      ];
      const dMoon: Vec3 = [
        moonPosEarthFixedKm[0] - surfacePt[0],
        moonPosEarthFixedKm[1] - surfacePt[1],
        moonPosEarthFixedKm[2] - surfacePt[2],
      ];
      const distSun = Math.hypot(dSun[0], dSun[1], dSun[2]);
      const distMoon = Math.hypot(dMoon[0], dMoon[1], dMoon[2]);
      const rSunDeg = Math.asin(SUN_RADIUS_KM / distSun) * RAD2DEG;
      const rMoonDeg = Math.asin(MOON_RADIUS_KM / distMoon) * RAD2DEG;
      const sepDeg = angularSeparationDeg(dSun, dMoon);
      const cov = discOverlapFraction(rSunDeg, rMoonDeg, sepDeg);
      if (cov > 0.001) {
        earthEclipseMax = cov;
        const uPt = norm(surfacePt);
        earthEclipsePoint = {
          latDeg: Math.asin(Math.max(-1, Math.min(1, uPt[2]))) * RAD2DEG,
          lonDeg: Math.atan2(uPt[1], uPt[0]) * RAD2DEG,
        };
      }
    }
  }

  return {
    jdTT,
    jdUT,
    site,
    localFromIcrf,
    bodies,
    earthFixedToLocal,
    sunPosEarthFixedKm,
    moonPosEarthFixedKm,
    sunObscuredByEarth,
    earthEclipseMax,
    earthEclipsePoint,
    subEarth,
    subSolar,
    accuracy: accuracyTier(jdTT),
  };
}

/** The Sun and Earth seen from a Moon site, and how much of the Sun's disc the Earth covers (a lunar eclipse). */
export interface SunEarthPlaces {
  sun: TopocentricPlace;
  earth: TopocentricPlace;
  sunObscuredByEarth: number;
}

/**
 * The Sun's and Earth's topocentric places from a Moon site: the same arithmetic as `computeSky` (equal to
 * the last bit), without the planets, the eclipse track on Earth and the sub-points, for long time series.
 */
export function sunEarthFromMoon(jdTT: number, site: SiteCoord): SunEarthPlaces {
  const t = astroTime(jdTT);
  const frame = moonSiteFrame(t, site);
  const sunGeo = A.GeoVector(A.Body.Sun, t, false);
  const sun = topocentricPlace(frame, [sunGeo.x, sunGeo.y, sunGeo.z], SUN_RADIUS_KM);
  const earth = topocentricPlace(frame, [0, 0, 0], EARTH_RADIUS_KM);
  const sunObscuredByEarth = discOverlapFraction(
    sun.angularDiameterDeg * 0.5,
    earth.angularDiameterDeg * 0.5,
    angularSeparationDeg(sun.dirIcrf, earth.dirIcrf),
  );
  return { sun, earth, sunObscuredByEarth };
}

/** Sky computation from any Solar System planet (Mercury..Neptune) using heliocentric vectors + IAU axis. */
function computePlanetSky(
  jdTT: number,
  jdUT: number,
  t: A.AstroTime,
  site: SiteCoord,
  worldId: Exclude<WorldId, 'moon' | 'orbit'>,
): SkyState {
  const fixedToIcrf = worldId === 'earth'
    ? earthFixedToIcrfMat(t)
    : axisFixedToIcrf(A.RotationAxis(AE_BODY[worldId], t));

  const phi = site.latDeg * DEG2RAD;
  const lam = site.lonDeg * DEG2RAD;
  const upFixed: Vec3 = [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)];
  const eastFixed: Vec3 = [-Math.sin(lam), Math.cos(lam), 0];
  const northFixed: Vec3 = [-Math.sin(phi) * Math.cos(lam), -Math.sin(phi) * Math.sin(lam), Math.cos(phi)];

  const U = mulMat3Vec(fixedToIcrf, upFixed);
  const E = mulMat3Vec(fixedToIcrf, eastFixed);
  const N = mulMat3Vec(fixedToIcrf, northFixed);
  const localFromIcrf: Mat3 = [E[0], E[1], E[2], U[0], U[1], U[2], -N[0], -N[1], -N[2]];

  const helioPos: Record<BodyId, Vec3> = {
    sun: [0, 0, 0],
    earth: (() => { const v = A.HelioVector(A.Body.Earth, t); return [v.x, v.y, v.z]; })(),
    mercury: (() => { const v = A.HelioVector(A.Body.Mercury, t); return [v.x, v.y, v.z]; })(),
    venus: (() => { const v = A.HelioVector(A.Body.Venus, t); return [v.x, v.y, v.z]; })(),
    mars: (() => { const v = A.HelioVector(A.Body.Mars, t); return [v.x, v.y, v.z]; })(),
    jupiter: (() => { const v = A.HelioVector(A.Body.Jupiter, t); return [v.x, v.y, v.z]; })(),
    saturn: (() => { const v = A.HelioVector(A.Body.Saturn, t); return [v.x, v.y, v.z]; })(),
    uranus: (() => { const v = A.HelioVector(A.Body.Uranus, t); return [v.x, v.y, v.z]; })(),
    neptune: (() => { const v = A.HelioVector(A.Body.Neptune, t); return [v.x, v.y, v.z]; })(),
  };

  const worldHelio = helioPos[worldId];
  const rObsAU = BODY_RADIUS_KM[worldId] / AU_KM;
  const obsHelio: Vec3 = [
    worldHelio[0] + U[0] * rObsAU,
    worldHelio[1] + U[1] * rObsAU,
    worldHelio[2] + U[2] * rObsAU,
  ];
  const sunDirIcrf = norm([-obsHelio[0], -obsHelio[1], -obsHelio[2]]);

  const buildFromHelio = (id: BodyId | 'moon', targetHelio: Vec3, radiusKm: number): BodyState => {
    if (id === worldId) {
      return {
        id, dirLocal: [0, -1, 0], dirIcrf: norm([-U[0], -U[1], -U[2]]),
        azDeg: 0, elDeg: -90, distanceKm: 0, distanceAU: 0,
        angularDiameterDeg: 0, magnitude: 99, illuminatedFraction: 1,
        lightTimeSec: 0, elongationDeg: 0,
      };
    }
    const rel: Vec3 = [
      targetHelio[0] - obsHelio[0],
      targetHelio[1] - obsHelio[1],
      targetHelio[2] - obsHelio[2],
    ];
    const distanceAU = Math.hypot(rel[0], rel[1], rel[2]);
    const distanceKm = distanceAU * AU_KM;
    const dirIcrf = norm(rel);
    const dirLocal = mulMat3Vec(localFromIcrf, dirIcrf);
    const { azDeg, elDeg } = azElFromDir(dirLocal);
    const angularDiameterDeg = 2 * Math.asin(Math.min(1, radiusKm / Math.max(distanceKm, radiusKm))) * RAD2DEG;
    const lightTimeSec = distanceKm / LIGHT_SPEED_KM_S;
    const elongationDeg = id === 'sun' ? 0 : angularSeparationDeg(dirIcrf, sunDirIcrf);

    let illuminatedFraction = 1;
    let magnitude = -26.74;
    if (id !== 'sun') {
      const rSunAU = Math.hypot(targetHelio[0], targetHelio[1], targetHelio[2]);
      const uSunBody = norm(targetHelio);
      const cosPhase = Math.max(-1, Math.min(1, dot(uSunBody, dirIcrf)));
      illuminatedFraction = 0.5 * (1 + cosPhase);
      if (id === 'moon') {
        // Full Moon at 1 AU from Sun & 384,400 km (0.00257 AU) from Earth is -12.74 mag -> H(1,0) ≈ +0.28
        magnitude = phaseMagnitude(0.28, rSunAU, distanceAU, Math.max(0.005, illuminatedFraction));
      } else {
        magnitude = phaseMagnitude(BODY_ABS_MAG[id], rSunAU, distanceAU, illuminatedFraction);
      }
    } else {
      magnitude = -26.74 + 5 * Math.log10(Math.max(distanceAU, 1e-4));
    }
    return {
      id: id === 'moon' ? 'earth' : id,
      dirLocal, dirIcrf, azDeg, elDeg, distanceKm, distanceAU,
      angularDiameterDeg, magnitude, illuminatedFraction, lightTimeSec, elongationDeg,
    };
  };

  const bodies = {} as Record<BodyId, BodyState>;
  for (const id of ['sun', 'earth', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] as const) {
    bodies[id] = buildFromHelio(id, helioPos[id], BODY_RADIUS_KM[id]);
  }

  const moonGeo = A.GeoMoon(t);
  const moonHelio: Vec3 = [
    helioPos.earth[0] + moonGeo.x,
    helioPos.earth[1] + moonGeo.y,
    helioPos.earth[2] + moonGeo.z,
  ];
  const moon = buildFromHelio('moon', moonHelio, MOON_RADIUS_KM);

  const efToIcrf = earthFixedToIcrfMat(t);
  const icrfToEf = transposeMat3(efToIcrf);
  const earthFixedToLocal = mulMat3(localFromIcrf, efToIcrf);
  const sunPosEarthFixedKm = mulMat3Vec(icrfToEf, [
    -helioPos.earth[0] * AU_KM, -helioPos.earth[1] * AU_KM, -helioPos.earth[2] * AU_KM,
  ]);
  const moonPosEarthFixedKm = mulMat3Vec(icrfToEf, [
    moonGeo.x * AU_KM, moonGeo.y * AU_KM, moonGeo.z * AU_KM,
  ]);

  return {
    jdTT,
    jdUT,
    site,
    localFromIcrf,
    bodies,
    moon,
    earthFixedToLocal,
    sunPosEarthFixedKm,
    moonPosEarthFixedKm,
    sunObscuredByEarth: 0,
    earthEclipseMax: 0,
    earthEclipsePoint: null,
    subEarth: { latDeg: 0, lonDeg: 0 },
    subSolar: { latDeg: 0, lonDeg: 0 },
    accuracy: accuracyTier(jdTT),
  };
}

// ─────────────────────────── transients (supernovae & comets) ───────────────────────────

/**
 * Template visual light curve for historical supernovae.
 * Note: generic astrophysical Type Ia / Type II templates anchored at `firstLight` and `peakMag`.
 */
export function supernovaMagnitude(def: SupernovaDef, jdTT: number): number {
  const t0 = jdTTFromCalendarUT(def.firstLight);
  const ageDays = jdTT - t0;
  if (ageDays < 0) return 99;

  if (def.snType === 'Ia') {
    const tPeak = 17;
    if (ageDays <= tPeak) {
      const x = 1 - ageDays / tPeak;
      return def.peakMag + 7.5 * x * x;
    }
    const dt = ageDays - tPeak;
    if (dt <= 15) return def.peakMag + (1.1 / 15) * dt;
    if (dt <= 60) return def.peakMag + 1.1 + 0.03 * (dt - 15);
    return Math.min(99, def.peakMag + 2.45 + 0.015 * (dt - 60));
  }

  // Type II (e.g. SN 1054 Crab): rapid rise (~10 d), plateau to day 85, drop, then Co-56 tail
  const tPeak = 10;
  if (ageDays <= tPeak) {
    const x = 1 - ageDays / tPeak;
    return def.peakMag + 7.0 * x * x;
  }
  const dt = ageDays - tPeak;
  if (dt <= 75) return def.peakMag + 0.012 * dt;
  if (dt <= 105) return def.peakMag + 0.9 + (1.8 / 30) * (dt - 75);
  return Math.min(99, def.peakMag + 2.7 + 0.0098 * (dt - 105));
}

/** Propagate heliocentric J2000-ecliptic orbital elements to heliocentric J2000 equatorial AU. */
function propagateCometHelioEqj(el: CometElements, jdTT: number): Vec3 {
  const dtDays = jdTT - el.tpJdTT;
  let rAU = el.q;
  let nu = 0;

  if (Math.abs(el.e - 1) < 1e-4) {
    // Barker's equation for parabolic orbit: W = 3*k / (sqrt(2) * q^(3/2)) * dt
    const w = (3 * GAUSS_K / (Math.SQRT2 * Math.pow(el.q, 1.5))) * dtDays;
    const y = Math.cbrt(w * 0.5 + Math.sqrt(w * w * 0.25 + 1));
    const s = y - 1 / y;
    nu = 2 * Math.atan(s);
    rAU = el.q * (1 + s * s);
  } else if (el.e < 1) {
    const a = el.q / (1 - el.e);
    const n = GAUSS_K / Math.pow(a, 1.5);
    let m = (n * dtDays) % (2 * Math.PI);
    if (m < -Math.PI) m += 2 * Math.PI;
    if (m > Math.PI) m -= 2 * Math.PI;
    let E = m;
    for (let iter = 0; iter < 12; iter++) {
      const f = E - el.e * Math.sin(E) - m;
      const fp = 1 - el.e * Math.cos(E);
      E -= f / fp;
      if (Math.abs(f) < 1e-9) break;
    }
    nu = 2 * Math.atan2(Math.sqrt(1 + el.e) * Math.sin(E * 0.5), Math.sqrt(1 - el.e) * Math.cos(E * 0.5));
    rAU = a * (1 - el.e * Math.cos(E));
  } else {
    const a = el.q / (el.e - 1);
    const n = GAUSS_K / Math.pow(a, 1.5);
    const m = n * dtDays;
    let H = Math.asinh(m / el.e);
    for (let iter = 0; iter < 12; iter++) {
      const f = el.e * Math.sinh(H) - H - m;
      const fp = el.e * Math.cosh(H) - 1;
      H -= f / fp;
      if (Math.abs(f) < 1e-9) break;
    }
    nu = 2 * Math.atan2(Math.sqrt(el.e + 1) * Math.sinh(H * 0.5), Math.sqrt(el.e - 1) * Math.cosh(H * 0.5));
    rAU = a * (el.e * Math.cosh(H) - 1);
  }

  // Orbital plane -> J2000 ecliptic
  const u = el.argPeriDeg * DEG2RAD + nu;
  const node = el.nodeDeg * DEG2RAD;
  const inc = el.iDeg * DEG2RAD;
  const cu = Math.cos(u);
  const su = Math.sin(u);
  const cn = Math.cos(node);
  const sn = Math.sin(node);
  const ci = Math.cos(inc);
  const si = Math.sin(inc);

  const xEcl = rAU * (cn * cu - sn * su * ci);
  const yEcl = rAU * (sn * cu + cn * su * ci);
  const zEcl = rAU * (su * si);

  // J2000 ecliptic -> J2000 equatorial (ICRF)
  const ce = Math.cos(J2000_OBLIQUITY_RAD);
  const se = Math.sin(J2000_OBLIQUITY_RAD);
  return [xEcl, yEcl * ce - zEcl * se, yEcl * se + zEcl * ce];
}

export function transientState(def: TransientDef, sky: SkyState, worldId: WorldId = 'moon'): TransientState {
  if (def.kind === 'supernova') {
    const t0 = jdTTFromCalendarUT(def.firstLight);
    const ageDays = sky.jdTT - t0;
    const dirLocal = dirLocalFromRaDec(sky, def.raDeg, def.decDeg);
    const { azDeg, elDeg } = azElFromDir(dirLocal);
    const magnitude = supernovaMagnitude(def, sky.jdTT);
    const totalDaysTo2026 = Math.max(1, jdTTFromCalendarUT({ year: 2026, month: 1, day: 1 }) - t0);
    const frac = Math.max(0, ageDays / totalDaysTo2026);
    const remnantDiameterDeg = (def.remnantDiameterArcmin / 60) * frac;
    return {
      id: def.id,
      kind: 'supernova',
      name: def.name,
      dirLocal,
      azDeg,
      elDeg,
      magnitude,
      ageDays,
      remnantDiameterDeg,
    };
  }

  // Comet
  return computeCometState(def, sky, worldId);
}

function computeCometState(def: CometDef, sky: SkyState, worldId: WorldId = 'moon'): TransientState {
  const t = astroTime(sky.jdTT);
  const helioComet = propagateCometHelioEqj(def.elements, sky.jdTT);
  const rSunAU = Math.hypot(helioComet[0], helioComet[1], helioComet[2]);

  let obsHelio: Vec3;
  if (worldId === 'moon' || worldId === 'orbit') {
    const earthHelio = A.HelioVector(A.Body.Earth, t);
    const moonGeo = A.GeoMoon(t);
    obsHelio = [earthHelio.x + moonGeo.x, earthHelio.y + moonGeo.y, earthHelio.z + moonGeo.z];
  } else if (worldId === 'earth') {
    const earthHelio = A.HelioVector(A.Body.Earth, t);
    obsHelio = [earthHelio.x, earthHelio.y, earthHelio.z];
  } else {
    const hv = A.HelioVector(AE_BODY[worldId], t);
    obsHelio = [hv.x, hv.y, hv.z];
  }
  const rel: Vec3 = [
    helioComet[0] - obsHelio[0],
    helioComet[1] - obsHelio[1],
    helioComet[2] - obsHelio[2],
  ];
  const distAU = Math.hypot(rel[0], rel[1], rel[2]);
  const dirIcrf = norm(rel);
  const dirLocal = mulMat3Vec(sky.localFromIcrf, dirIcrf);
  const { azDeg, elDeg } = azElFromDir(dirLocal);
  const ageDays = sky.jdTT - def.elements.tpJdTT;

  let magnitude = rSunAU > 6.5
    ? 99
    : def.absMag + 5 * Math.log10(Math.max(distAU, 0.01)) + def.slope * Math.log10(Math.max(rSunAU, 0.05));

  if (def.outburst && magnitude < 99) {
    const tPeak = jdTTFromCalendarUT(def.outburst.peak);
    const d = sky.jdTT - tPeak;
    if (d >= -def.outburst.riseDays && d <= 0) {
      const f = 1 + d / Math.max(0.1, def.outburst.riseDays);
      magnitude -= def.outburst.deltaMag * f;
    } else if (d > 0 && d <= def.outburst.decayDays * 4) {
      const f = Math.exp(-d / Math.max(0.5, def.outburst.decayDays));
      magnitude -= def.outburst.deltaMag * f;
    }
  }

  // Anti-solar vector in local frame, projected perpendicular to the line of sight
  const antiSolarIcrf = norm(helioComet);
  const antiSolarLocal = mulMat3Vec(sky.localFromIcrf, antiSolarIcrf);
  const radialComp = dot(antiSolarLocal, dirLocal);
  const tangentTail: Vec3 = [
    antiSolarLocal[0] - radialComp * dirLocal[0],
    antiSolarLocal[1] - radialComp * dirLocal[1],
    antiSolarLocal[2] - radialComp * dirLocal[2],
  ];
  const tailDirLocal = norm(tangentTail);
  const sinProj = Math.sqrt(Math.max(0.05, 1 - radialComp * radialComp));
  const physTailAU = Math.min(0.6, 0.25 / Math.max(0.15, rSunAU));
  const tailLengthDeg = Math.min(60, Math.atan2(physTailAU * sinProj, Math.max(0.05, distAU)) * RAD2DEG);
  const comaKm = 200_000 / Math.sqrt(Math.max(0.15, rSunAU));
  const comaDeg = Math.min(4, (comaKm / (distAU * AU_KM)) * RAD2DEG);

  return {
    id: def.id,
    kind: 'comet',
    name: def.name,
    dirLocal,
    azDeg,
    elDeg,
    magnitude,
    ageDays,
    tailDirLocal,
    tailLengthDeg,
    comaDeg,
    sunDistAU: rSunAU,
    distAU,
  };
}

// ─────────────────────────── body orientation for space views ───────────────────────────

export function bodyOrientation(
  body: 'moon' | 'mercury' | 'venus' | 'earth' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'sun',
  jdTT: number,
): BodyOrientation {
  const t = astroTime(jdTT);
  const aeBody = body === 'moon' ? A.Body.Moon : body === 'earth' ? A.Body.Earth : AE_BODY[body];

  const fixedToIcrf = body === 'earth'
    ? earthFixedToIcrfMat(t)
    : axisFixedToIcrf(A.RotationAxis(aeBody, t));
  const icrfToFixed = transposeMat3(fixedToIcrf);

  const earthHelio = A.HelioVector(A.Body.Earth, t);
  const moonGeo = A.GeoMoon(t);
  const moonHelio: Vec3 = [
    earthHelio.x + moonGeo.x,
    earthHelio.y + moonGeo.y,
    earthHelio.z + moonGeo.z,
  ];

  let bodyHelio: Vec3 = [0, 0, 0];
  if (body === 'moon') {
    bodyHelio = moonHelio;
  } else if (body === 'earth') {
    bodyHelio = [earthHelio.x, earthHelio.y, earthHelio.z];
  } else if (body !== 'sun') {
    const hv = A.HelioVector(aeBody, t);
    bodyHelio = [hv.x, hv.y, hv.z];
  }

  const toSunIcrf: Vec3 = body === 'sun'
    ? [1, 0, 0]
    : norm([-bodyHelio[0], -bodyHelio[1], -bodyHelio[2]]);
  const toObsVec: Vec3 = body === 'moon'
    ? [-moonGeo.x, -moonGeo.y, -moonGeo.z]
    : [moonHelio[0] - bodyHelio[0], moonHelio[1] - bodyHelio[1], moonHelio[2] - bodyHelio[2]];
  const distanceFromObserverAU = Math.hypot(toObsVec[0], toObsVec[1], toObsVec[2]);
  const distanceFromSunAU = Math.hypot(bodyHelio[0], bodyHelio[1], bodyHelio[2]);
  const toObsIcrf = norm(toObsVec);

  const sunDirFixed = norm(mulMat3Vec(icrfToFixed, toSunIcrf));
  const observerDirFixed = norm(mulMat3Vec(icrfToFixed, toObsIcrf));

  const subSolarLatDeg = Math.asin(Math.max(-1, Math.min(1, sunDirFixed[2]))) * RAD2DEG;
  const subSolarLonDeg = Math.atan2(sunDirFixed[1], sunDirFixed[0]) * RAD2DEG;
  const subObserverLatDeg = Math.asin(Math.max(-1, Math.min(1, observerDirFixed[2]))) * RAD2DEG;
  const subObserverLonDeg = Math.atan2(observerDirFixed[1], observerDirFixed[0]) * RAD2DEG;

  const radiusKm = body === 'moon' ? MOON_RADIUS_KM : BODY_RADIUS_KM[body];
  const distKm = Math.max(radiusKm * 1.1, distanceFromObserverAU * AU_KM);
  const angularDiameterArcsec = 2 * Math.asin(Math.min(1, radiusKm / distKm)) * RAD2DEG * 3600;
  const lightTimeSec = distKm / LIGHT_SPEED_KM_S;

  return {
    fixedToIcrf,
    sunDirFixed,
    observerDirFixed,
    subSolarLatDeg,
    subSolarLonDeg,
    subObserverLatDeg,
    subObserverLonDeg,
    distanceFromObserverAU,
    distanceFromSunAU,
    angularDiameterArcsec,
    lightTimeSec,
  };
}

export function targetAltAz(
  jdTT: number,
  site: SiteCoord,
  target: BodyId | { raDeg: number; decDeg: number },
  worldId: WorldId = 'moon',
): { azDeg: number; elDeg: number } {
  const sky = computeSky(jdTT, site, worldId);
  if (typeof target === 'string') {
    const b = sky.bodies[target];
    return { azDeg: b.azDeg, elDeg: b.elDeg };
  }
  const dir = dirLocalFromRaDec(sky, target.raDeg, target.decDeg);
  return azElFromDir(dir);
}

/** Where something is as seen from Earth's centre, in the plane of the planets. */
export interface GeocentricPlace {
  /** Ecliptic longitude and latitude, degrees. */
  lonDeg: number;
  latDeg: number;
  distanceAU: number;
}

/** The bodies `geocentricPlaces` gives a place for. */
export type GeocentricBody = Exclude<BodyId, 'earth'> | 'moon' | 'pluto';

/**
 * Geocentric ecliptic places of the Sun, the Moon, the other planets and Pluto at one moment: the layout of
 * the solar system around Earth, for maps drawn in the plane of the planets.
 */
export function geocentricPlaces(jdTT: number): Record<GeocentricBody, GeocentricPlace> {
  const t = astroTime(jdTT);
  const place = (v: A.Vector): GeocentricPlace => {
    const e = A.Ecliptic(v);
    return { lonDeg: e.elon, latDeg: e.elat, distanceAU: v.Length() };
  };
  return {
    moon: place(A.GeoMoon(t)),
    sun: place(A.GeoVector(A.Body.Sun, t, true)),
    mercury: place(A.GeoVector(A.Body.Mercury, t, true)),
    venus: place(A.GeoVector(A.Body.Venus, t, true)),
    mars: place(A.GeoVector(A.Body.Mars, t, true)),
    jupiter: place(A.GeoVector(A.Body.Jupiter, t, true)),
    saturn: place(A.GeoVector(A.Body.Saturn, t, true)),
    uranus: place(A.GeoVector(A.Body.Uranus, t, true)),
    neptune: place(A.GeoVector(A.Body.Neptune, t, true)),
    pluto: place(A.GeoVector(A.Body.Pluto, t, true)),
  };
}

/**
 * A point of such a map, given by its ecliptic longitude and its distance from Earth, as it is seen from
 * another world at the same moment: its direction (right ascension and declination, J2000 degrees) and its
 * distance from there, AU. `latDeg` is the point's ecliptic latitude: 0 for a place of the map itself, which
 * lies in the plane of the planets; a star's own for a point that stands for a star, which the map shows at
 * the star's longitude (see `eclipticOfRaDec`), so that the point is seen where the star is.
 */
export function mapPointSeenFrom(
  world: WorldId, jdTT: number, lonDeg: number, distanceAU: number, latDeg = 0,
): { raDeg: number; decDeg: number; distanceAU: number } {
  const t = astroTime(jdTT);
  const lon = lonDeg * DEG2RAD;
  const lat = latDeg * DEG2RAD;
  const inPlane = distanceAU * Math.cos(lat);
  // From Earth's centre, in equatorial axes.
  const point = rx(J2000_OBLIQUITY_RAD, [inPlane * Math.cos(lon), inPlane * Math.sin(lon), distanceAU * Math.sin(lat)]);
  let eye: Vec3 = [0, 0, 0];
  if (world === 'moon' || world === 'orbit') {
    const moon = A.GeoMoon(t);
    eye = [moon.x, moon.y, moon.z];
  } else if (world !== 'earth') {
    const earth = A.HelioVector(A.Body.Earth, t);
    const there = A.HelioVector(AE_BODY[world], t);
    eye = [there.x - earth.x, there.y - earth.y, there.z - earth.z];
  }
  const rel: Vec3 = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
  const far = Math.hypot(rel[0], rel[1], rel[2]);
  return {
    raDeg: ((Math.atan2(rel[1], rel[0]) * RAD2DEG) + 360) % 360,
    decDeg: Math.asin(Math.max(-1, Math.min(1, rel[2] / Math.max(far, 1e-12)))) * RAD2DEG,
    distanceAU: far,
  };
}

/** Ecliptic longitude and latitude (degrees, J2000) of a fixed direction given by right ascension and declination. */
export function eclipticOfRaDec(raDeg: number, decDeg: number): { lonDeg: number; latDeg: number } {
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const ecl = rx(-J2000_OBLIQUITY_RAD, [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]);
  return {
    lonDeg: ((Math.atan2(ecl[1], ecl[0]) * RAD2DEG) + 360) % 360,
    latDeg: Math.asin(Math.max(-1, Math.min(1, ecl[2]))) * RAD2DEG,
  };
}

// ─────────────────────────── navigator & horizon functions ───────────────────────────

export function horizonElevationAt(profile: Float32Array, azDeg: number): number {
  const n = profile.length;
  if (n === 0) return 0;
  const wrapped = ((azDeg % 360) + 360) % 360;
  const pos = (wrapped / 360) * n;
  const i0 = Math.floor(pos) % n;
  const i1 = (i0 + 1) % n;
  const frac = pos - Math.floor(pos);
  return profile[i0] * (1 - frac) + profile[i1] * frac;
}

export function discVisibleFraction(
  profile: Float32Array,
  azDeg: number,
  elDeg: number,
  angularRadiusDeg: number,
): number {
  const r = Math.max(0.01, angularRadiusDeg);
  const hDeg = horizonElevationAt(profile, azDeg);
  const dh = elDeg - hDeg;
  if (dh <= -r) return 0;
  if (dh >= r) return 1;
  // The part of the disc above the skyline, a horizontal chord dh below the disc's centre: the circular segment
  // r²·acos(−dh/r) + dh·√(r² − dh²).
  const u = Math.max(-1, Math.min(1, -dh / r));
  const visibleArea = r * r * Math.acos(u) + dh * Math.sqrt(Math.max(0, r * r - dh * dh));
  return Math.max(0, Math.min(1, visibleArea / (Math.PI * r * r)));
}

export function nextHorizonEvent(
  body: 'sun' | 'earth',
  jdTT: number,
  site: SiteCoord,
  profile: Float32Array,
  maxDays: number,
  worldId: WorldId = 'moon',
): HorizonEvent | null {
  const visAt = (j: number): boolean => {
    const { azDeg, elDeg } = targetAltAz(j, site, body, worldId);
    return discVisibleFraction(profile, azDeg, elDeg, HORIZON_DISC_RADIUS_DEG[body]) > VISIBLE_DISC_FRACTION;
  };
  const startVis = visAt(jdTT);
  const stepDays = (worldId === 'moon' || worldId === 'mercury' || worldId === 'venus'
    ? (body === 'sun' ? 2.0 : 1.0)
    : 0.35) / 24;
  const totalSteps = Math.ceil(maxDays / stepDays);
  let tPrev = jdTT;
  for (let s = 1; s <= totalSteps; s++) {
    const tCur = jdTT + Math.min(maxDays, s * stepDays);
    if (visAt(tCur) !== startVis) {
      let lo = tPrev;
      let hi = tCur;
      for (let i = 0; i < 10; i++) {
        const mid = 0.5 * (lo + hi);
        if (visAt(mid) === startVis) lo = mid;
        else hi = mid;
      }
      const eventJd = 0.5 * (lo + hi);
      return {
        kind: startVis ? 'set' : 'rise',
        inHours: (eventJd - jdTT) * 24,
      };
    }
    tPrev = tCur;
  }
  return null;
}

/** Angular radii (degrees) of the Sun and Earth used for rising and setting from the Moon: their mean sizes. */
export const HORIZON_DISC_RADIUS_DEG: Record<'sun' | 'earth', number> = { sun: 0.2666, earth: 0.95 };

/** A body counts as visible when more than this share of its disc stands above the skyline. */
export const VISIBLE_DISC_FRACTION = 0.05;

/** Share of the photovoltaic panel's incident sunlight it turns into electric power (the in-app panel). */
export const PANEL_EFFICIENCY = 0.30;

export function solarFluxWm2(distanceAU: number): number {
  return 1361.0 / Math.max(0.01, distanceAU * distanceAU);
}

/**
 * Instantaneous radiative-equilibrium surface temperature model (K), floored at 40 K in shadow.
 * Note: physical model for rapid site comparison, not direct LRO Diviner measurements.
 */
export function surfaceTemperatureK(
  sunElDeg: number,
  sunVisibleFraction: number,
  distanceAU: number,
  albedo: number,
): number {
  const sinEl = Math.max(0, Math.sin(sunElDeg * DEG2RAD));
  const absorbed = (1 - Math.max(0.04, Math.min(0.4, albedo))) * solarFluxWm2(distanceAU) * sinEl * Math.max(0, sunVisibleFraction);
  const sigma = 5.670374419e-8;
  const emissivity = 0.95;
  const tEq = Math.pow(absorbed / (emissivity * sigma), 0.25);
  return Math.max(40, tEq);
}

/**
 * Indicative ambient temperature model (K) for each Solar System world.
 * Vacuum worlds follow radiative equilibrium; atmospheric worlds reflect NASA planetary fact-sheet ranges.
 */
export function worldTemperatureK(
  worldId: WorldId,
  sunElDeg: number,
  sunVisibleFraction: number,
  distanceAU: number,
  albedo: number,
): number {
  const dayWeight = Math.max(0, Math.sin(Math.max(0, sunElDeg) * DEG2RAD)) * Math.max(0, sunVisibleFraction);
  switch (worldId) {
    case 'moon':
    case 'mercury':
      return Math.max(worldId === 'mercury' ? 100 : 40, surfaceTemperatureK(sunElDeg, sunVisibleFraction, distanceAU, albedo));
    case 'venus':
      return 737; // dense CO2 greenhouse keeps surface nearly isothermal day/night
    case 'earth':
      return 278 + 20 * dayWeight;
    case 'mars':
      return 155 + 130 * Math.pow(dayWeight, 0.7);
    case 'jupiter':
      return 165;
    case 'saturn':
      return 134;
    case 'uranus':
      return 76;
    case 'neptune':
      return 72;
    case 'orbit':
      return 2.7;
  }
}

export function illuminationStats(
  jdTT: number,
  site: SiteCoord,
  profile: Float32Array,
  stepHours = 2,
): { sunFraction: number; earthFraction: number; longestDarkHours: number } {
  const synodicDays = 29.530589;
  const stepDays = stepHours / 24;
  const nSteps = Math.max(1, Math.round(synodicDays / stepDays));
  let sunLitCount = 0;
  let earthLitCount = 0;
  let curDarkHours = 0;
  let longestDarkHours = 0;

  for (let i = 0; i < nSteps; i++) {
    const j = jdTT + i * stepDays;
    const sky = computeSky(j, site);
    const sunVis = discVisibleFraction(profile, sky.bodies.sun.azDeg, sky.bodies.sun.elDeg, 0.2666);
    const earthVis = discVisibleFraction(profile, sky.bodies.earth.azDeg, sky.bodies.earth.elDeg, 0.95);
    if (sunVis > 0.1) {
      sunLitCount += sunVis;
      curDarkHours = 0;
    } else {
      curDarkHours += stepHours;
      if (curDarkHours > longestDarkHours) longestDarkHours = curDarkHours;
    }
    if (earthVis > 0.1) earthLitCount += 1;
  }

  return {
    sunFraction: sunLitCount / nSteps,
    earthFraction: earthLitCount / nSteps,
    longestDarkHours,
  };
}
