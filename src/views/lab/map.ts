/**
 * The lab's map: the plane of the planets seen from the north, the Sun at the centre, and how a real place
 * in that plane (AU from the Sun) goes to a place on the map (scene units) and back.
 *
 *   - Distance from the Sun is schematic and never turns back: the mean distances of Mercury … Neptune and
 *     Pluto stand one step apart, a distance between two of them goes between their rings along a smooth
 *     curve in its logarithm, inside Mercury's the scale is even, and beyond Pluto's one decade takes a
 *     fixed width out to 10,000 light years. Directions from the Sun are the real ones.
 *   - Earth's neighbourhood is magnified: within a fixed radius of Earth's place on the map, distances from
 *     Earth are stretched, ever more toward Earth, so that the Moon and an explosion as near as the Moon
 *     are drawn apart from Earth. At the edge of that circle the stretch is none.
 *
 * Neither step has a jump or a kink anywhere but at Earth's own centre, so a straight front stays a smooth
 * line on the map; and both can be undone, so a place on the map stands for exactly one real place.
 */
import type { LabBody } from '../../core/types';

export const LY_AU = 63_241.077;
/** Closest and farthest the explosion can be placed from Earth: the Moon's distance … 10,000 light years. */
export const LAB_MIN_AU = 0.00257;
export const LAB_MAX_AU = 10_000 * LY_AU;

/** A place in the plane of the planets: `x` toward ecliptic longitude 0, `z` toward longitude −90° (seen from the north, longitude runs anticlockwise). */
export interface MapPoint {
  x: number;
  z: number;
}

/** Mean distances from the Sun, AU, of Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune and Pluto: ring 1 … 9 of the map. */
export const LAB_ORBITS_AU = [0.387, 0.723, 1, 1.524, 5.203, 9.537, 19.19, 30.07, 39.48];
/** Scene units between two successive rings, and the width of a decade of distance beyond the last. */
export const LAB_ORBIT_STEP = 3.2;
const UNITS_PER_DECADE = 2.5;
const OUTER_AU = LAB_ORBITS_AU[LAB_ORBITS_AU.length - 1];
const OUTER_RADIUS = LAB_ORBITS_AU.length * LAB_ORBIT_STEP;
/**
 * Radius on the map of the magnified circle round Earth; the power by which distances from Earth are
 * stretched deep inside it; and how quickly the stretch sets in from the edge. With these the Moon's
 * 0.00257 AU, a sixtieth of a unit unmagnified, comes out about one unit from Earth.
 */
export const LAB_LENS_RADIUS = 1.9;
const LENS_POWER = 0.08;
const LENS_ONSET = 4;

/**
 * The rings as a curve: the logarithm of each planet's distance, and the slope of the map radius against
 * that logarithm there. Between two rings the radius follows the cubic through both with these slopes (a
 * monotone Hermite spline, Fritsch and Carlson 1980): it joins the even scale inside Mercury's ring and the
 * logarithmic one beyond Pluto's without a kink.
 */
const RING_LOG = LAB_ORBITS_AU.map((au) => Math.log(au));
const RING_SLOPE = RING_LOG.map((x, k) => {
  if (k === 0) return LAB_ORBIT_STEP;
  if (k === RING_LOG.length - 1) return UNITS_PER_DECADE / Math.LN10;
  const before = x - RING_LOG[k - 1];
  const after = RING_LOG[k + 1] - x;
  // The weighted harmonic mean of the slopes of the two straight stretches that meet here.
  return (3 * (before + after)) / ((2 * after + before) / (LAB_ORBIT_STEP / before) + (after + 2 * before) / (LAB_ORBIT_STEP / after));
});

/** Map radius at the share `t` (0 … 1) of the way, in the logarithm of distance, from ring `k` to ring `k + 1` (from 0). */
function betweenRings(k: number, t: number): number {
  const span = RING_LOG[k + 1] - RING_LOG[k];
  const t2 = t * t;
  const t3 = t2 * t;
  return (k + 1) * LAB_ORBIT_STEP * (2 * t3 - 3 * t2 + 1) + (k + 2) * LAB_ORBIT_STEP * (3 * t2 - 2 * t3)
    + span * (RING_SLOPE[k] * (t3 - 2 * t2 + t) + RING_SLOPE[k + 1] * (t3 - t2));
}

/** Map radius of a distance from the Sun, AU. */
export function labSunRadius(au: number): number {
  const r = Math.max(0, au);
  if (r <= LAB_ORBITS_AU[0]) return (LAB_ORBIT_STEP * r) / LAB_ORBITS_AU[0];
  if (r >= OUTER_AU) return OUTER_RADIUS + UNITS_PER_DECADE * Math.log10(r / OUTER_AU);
  let k = 0;
  while (LAB_ORBITS_AU[k + 1] < r) k++;
  return betweenRings(k, (Math.log(r) - RING_LOG[k]) / (RING_LOG[k + 1] - RING_LOG[k]));
}

/** The distance from the Sun, AU, that a radius on the map stands for: the inverse of `labSunRadius`. */
export function labSunDistanceAU(radius: number): number {
  const steps = Math.max(0, radius) / LAB_ORBIT_STEP;
  if (steps <= 1) return steps * LAB_ORBITS_AU[0];
  if (radius >= OUTER_RADIUS) return OUTER_AU * 10 ** ((radius - OUTER_RADIUS) / UNITS_PER_DECADE);
  const k = Math.floor(steps) - 1;
  // Between two rings the radius only grows with the distance: halve the stretch until it is found.
  let low = 0;
  let high = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (betweenRings(k, mid) < radius) low = mid;
    else high = mid;
  }
  return Math.exp(RING_LOG[k] + ((low + high) / 2) * (RING_LOG[k + 1] - RING_LOG[k]));
}

/**
 * The magnified neighbourhood, with its radius as the unit: how far from Earth a place is drawn that the
 * distance scale alone puts the share `s` (0 … 1) of the way out. Deep inside it is a power law; at the
 * edge it is `s` itself, and so is its slope.
 */
function lensStretch(s: number): number {
  return s ** LENS_POWER * Math.exp(-((1 - LENS_POWER) * (1 - s ** LENS_ONSET)) / LENS_ONSET);
}

/** A real place as the schematic distance scale alone puts it on the map. */
function unmagnified(place: MapPoint): MapPoint {
  const r = Math.hypot(place.x, place.z);
  const scale = r > 0 ? labSunRadius(r) / r : 0;
  return { x: place.x * scale, z: place.z * scale };
}

/** Where a real place (AU from the Sun) is drawn on the map, scene units, with Earth at the real place `earth`. */
export function labProject(place: MapPoint, earth: MapPoint): MapPoint {
  const flat = unmagnified(place);
  const centre = unmagnified(earth);
  const dx = flat.x - centre.x;
  const dz = flat.z - centre.z;
  const t = Math.hypot(dx, dz);
  if (t >= LAB_LENS_RADIUS || t === 0) return flat;
  const stretch = (LAB_LENS_RADIUS * lensStretch(t / LAB_LENS_RADIUS)) / t;
  return { x: centre.x + dx * stretch, z: centre.z + dz * stretch };
}

/** The real place (AU from the Sun) that a place on the map stands for: the inverse of `labProject`. */
export function labUnproject(spot: MapPoint, earth: MapPoint): MapPoint {
  const centre = unmagnified(earth);
  const dx = spot.x - centre.x;
  const dz = spot.z - centre.z;
  const t = Math.hypot(dx, dz);
  let shrink = 1;
  if (t < LAB_LENS_RADIUS && t > 0) {
    // The stretch only grows with the distance: halve the range of the logarithm of the share until it is found.
    let low = Math.log(t / LAB_LENS_RADIUS) / LENS_POWER;
    let high = 0;
    for (let i = 0; i < 80; i++) {
      const mid = (low + high) / 2;
      if (lensStretch(Math.exp(mid)) < t / LAB_LENS_RADIUS) low = mid;
      else high = mid;
    }
    shrink = (LAB_LENS_RADIUS * Math.exp((low + high) / 2)) / t;
  }
  const flat = { x: centre.x + dx * shrink, z: centre.z + dz * shrink };
  const radius = Math.hypot(flat.x, flat.z);
  const scale = radius > 0 ? labSunDistanceAU(radius) / radius : 0;
  return { x: flat.x * scale, z: flat.z * scale };
}

/**
 * Earth's real place, AU from the Sun: opposite the Sun as Earth sees it. Without the Sun among `bodies`,
 * Earth is taken to be 1 AU from it toward longitude 0.
 */
export function labEarthPlace(bodies: LabBody[]): MapPoint {
  const sun = bodies.find((b) => b.id === 'sun');
  return sun ? { x: -Math.cos(sun.angleRad) * sun.distanceAU, z: -Math.sin(sun.angleRad) * sun.distanceAU } : { x: 1, z: 0 };
}

/** The real place, AU from the Sun, of what Earth sees in direction `angleRad` at `distanceAU`. */
export function labPlaceFromEarth(earth: MapPoint, angleRad: number, distanceAU: number): MapPoint {
  return { x: earth.x + Math.cos(angleRad) * distanceAU, z: earth.z + Math.sin(angleRad) * distanceAU };
}
