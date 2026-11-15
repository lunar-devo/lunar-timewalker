/**
 * Analytic surface detail shared by the CPU (physics, horizon) and the GPU (vertex displacement,
 * per-pixel normals). Both sides evaluate the SAME crater field: an integer hash places at most one
 * bowl crater per grid cell in each octave, so boots land exactly on what is drawn.
 *
 * This detail is statistical, not measured: it stands in for relief below the DEM's resolution.
 */

/** Grid cell size of each crater octave, metres. Crater radius in an octave is 0.10–0.33 × cell. */
export const OCTAVE_CELLS = [900, 340, 130, 50, 19, 7.2, 2.7, 1.0, 0.4] as const;
export const OCTAVE_COUNT = OCTAVE_CELLS.length;
/** Octaves at or above this index are shaded per pixel only (too small for the finest vertex grid). */
export const FIRST_NORMAL_ONLY_OCTAVE = 8;
/** Octaves from this index on (cells of 50 m and less) hold the small craters: at most about 33 m across. */
export const FIRST_SMALL_OCTAVE = 3;
/** A cell holds a crater where its 3-bit roll (0–7) reaches this: half of the cells. */
export const CRATER_ROLL = 4;

/** Added to cell indices before hashing so they are non-negative on both CPU and GPU. */
const CELL_HASH_OFFSET = 1048576;

/** A crater placed by hand (real, named features near a site). */
export interface KnownCrater {
  x: number;
  z: number;
  radiusM: number;
  /** 0 = heavily degraded, 1 = fresh (depth/diameter ≈ 0.2). */
  fresh: number;
}

export interface FieldConfig {
  /** Octaves below this index are suppressed where measured high-resolution data exists. */
  firstHiResOctave: number;
  /** 0..1 coverage of measured high-resolution data at (x, z); 0 everywhere when there is none. */
  hiResMask: (x: number, z: number) => number;
  /** Craters with cells above 1.5 m fade out inside this disc (keeps a lander on level ground). */
  flatX: number;
  flatZ: number;
  flatRadiusM: number;
  known: KnownCrater[];
  /**
   * The roll a cell of the small octaves must reach to hold a crater: CRATER_ROLL as on the airless Moon; 7
   * leaves a quarter of them, as on Mars, whose air stops small impactors and whose wind fills small pits.
   */
  smallCraterRoll: number;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Same bit mixing as `hash32` in FIELD_GLSL. Returns an unsigned 32-bit integer. */
function hash32(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * Height of a bowl crater at normalized radius r = distance / R.
 * Inside: parabolic bowl rising to a sharp rim crest; outside: ejecta blanket falling to zero at 1.5 R.
 */
function craterProfile(r: number, radiusM: number, fresh: number): number {
  const depth = 0.4 * radiusM * fresh;
  const rim = 0.07 * radiusM * fresh;
  if (r < 1) return -depth + (depth + rim) * r * r;
  const t = (r - 1) * 2;
  return rim * (1 - t) * (1 - t) * (1 + 2 * t);
}

function octaveHeight(x: number, z: number, octave: number, smallCraterRoll: number): number {
  const cell = OCTAVE_CELLS[octave];
  const bx = Math.floor(x / cell - 0.5);
  const bz = Math.floor(z / cell - 0.5);
  let sum = 0;
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const cx = bx + i;
      const cz = bz + j;
      const h = hash32(cx + CELL_HASH_OFFSET, cz + CELL_HASH_OFFSET, octave);
      if ((h >>> 29) < (octave >= FIRST_SMALL_OCTAVE ? smallCraterRoll : CRATER_ROLL)) continue;
      const ox = (h & 255) / 255;
      const oz = ((h >>> 8) & 255) / 255;
      const rr = ((h >>> 16) & 255) / 255;
      const fr = ((h >>> 24) & 31) / 31;
      const radius = cell * (0.10 + 0.23 * rr * rr);
      const dx = x - (cx + ox) * cell;
      const dz = z - (cz + oz) * cell;
      const d2 = dx * dx + dz * dz;
      const extent = 1.5 * radius;
      if (d2 >= extent * extent) continue;
      sum += craterProfile(Math.sqrt(d2) / radius, radius, 0.12 + 0.88 * fr ** 4);
    }
  }
  return sum;
}

/**
 * Detail height (metres) at (x, z) with octaves `firstOctave..lastOctave` at full strength — what is rendered
 * right under the player. Normal-only octaves are excluded by default.
 */
export function detailHeight(
  x: number, z: number, cfg: FieldConfig,
  firstOctave = 0, lastOctave = FIRST_NORMAL_ONLY_OCTAVE - 1,
): number {
  const hiRes = cfg.hiResMask(x, z);
  const flat = cfg.flatRadiusM > 0
    ? smoothstep(cfg.flatRadiusM, cfg.flatRadiusM * 2, Math.hypot(x - cfg.flatX, z - cfg.flatZ))
    : 1;
  let sum = 0;
  for (let o = firstOctave; o <= lastOctave; o++) {
    let amp = o < cfg.firstHiResOctave ? 1 - hiRes : 1;
    if (OCTAVE_CELLS[o] > 1.5) amp *= flat;
    if (amp > 0) sum += octaveHeight(x, z, o, cfg.smallCraterRoll) * amp;
  }
  for (const k of cfg.known) {
    const d = Math.hypot(x - k.x, z - k.z);
    if (d < 1.5 * k.radiusM) sum += craterProfile(d / k.radiusM, k.radiusM, k.fresh);
  }
  return sum;
}

/**
 * GLSL (ES 3.00) twin of the functions above. Requires these uniforms:
 *   highp sampler2D uNearH, uWideH (R32F node grids), vec4 uNearRect / uWideRect (centreX, centreZ, sizeM, nodes),
 *   float uHiRes, int uFirstHiResOctave, vec3 uFlat (x, z, radius), vec4 uKnown[4] (x, z, radius, fresh),
 *   float uBodyRadius (mean radius of the site's body, metres), uint uSmallCraterRoll (FieldConfig.smallCraterRoll).
 */
export const FIELD_GLSL = /* glsl */ `
uniform highp sampler2D uNearH;
uniform highp sampler2D uWideH;
uniform vec4 uNearRect;
uniform vec4 uWideRect;
uniform float uHiRes;
uniform int uFirstHiResOctave;
uniform vec3 uFlat;
uniform vec4 uKnown[4];
uniform float uBodyRadius;
uniform uint uSmallCraterRoll;

const int OCTAVES = ${OCTAVE_COUNT};
const int GEO_OCTAVES = ${FIRST_NORMAL_ONLY_OCTAVE};
const float CELL[${OCTAVE_COUNT}] = float[${OCTAVE_COUNT}](${OCTAVE_CELLS.map((c) => c.toFixed(1)).join(', ')});

uint hash32(uint ix, uint iz, uint seed) {
  uint h = (ix * 0x27d4eb2dU) ^ (iz * 0x165667b1U) ^ (seed * 0x9e3779b9U);
  h ^= h >> 15;
  h *= 0x2c1b3c6dU;
  h ^= h >> 12;
  h *= 0x297a2d39U;
  h ^= h >> 15;
  return h;
}

float fetchGrid(highp sampler2D grid, vec4 rect, vec2 p) {
  float n = rect.w;
  vec2 f = clamp((p - rect.xy) / rect.z + 0.5, 0.0, 1.0) * (n - 1.0);
  vec2 i0 = min(floor(f), vec2(n - 2.0));
  vec2 fr = f - i0;
  ivec2 i = ivec2(i0);
  float h00 = texelFetch(grid, i, 0).r;
  float h10 = texelFetch(grid, i + ivec2(1, 0), 0).r;
  float h01 = texelFetch(grid, i + ivec2(0, 1), 0).r;
  float h11 = texelFetch(grid, i + ivec2(1, 1), 0).r;
  return mix(mix(h00, h10, fr.x), mix(h01, h11, fr.x), fr.y);
}

/** 1 well inside the measured high-resolution grid, 0 at its edge and wherever there is none. */
float hiResMask(vec2 p) {
  if (uHiRes < 0.5) return 0.0;
  vec2 d = abs(p - uNearRect.xy) / (0.5 * uNearRect.z);
  return smoothstep(0.0, 0.15, 1.0 - max(d.x, d.y));
}

float baseHeight(vec2 p, float nm) {
  float hw = fetchGrid(uWideH, uWideRect, p);
  if (nm <= 0.0) return hw;
  return mix(hw, fetchGrid(uNearH, uNearRect, p), nm);
}

/** Decodes the crater (if any) of cell c in octave o. */
bool craterAt(vec2 c, int o, out vec2 centre, out float R, out float fresh) {
  uint h = hash32(uint(int(c.x) + ${CELL_HASH_OFFSET}), uint(int(c.y) + ${CELL_HASH_OFFSET}), uint(o));
  if ((h >> 29) < (o >= ${FIRST_SMALL_OCTAVE} ? uSmallCraterRoll : ${CRATER_ROLL}u)) return false;
  float cell = CELL[o];
  centre = (c + vec2(float(h & 255u), float((h >> 8) & 255u)) / 255.0) * cell;
  float rr = float((h >> 16) & 255u) / 255.0;
  float fr = float((h >> 24) & 31u) / 31.0;
  R = cell * (0.10 + 0.23 * rr * rr);
  fresh = 0.12 + 0.88 * fr * fr * fr * fr;
  return true;
}

/** (height, dh/dx, dh/dz) of a bowl crater of radius R at offset d from its centre. */
vec3 craterShape(vec2 d, float R, float fresh) {
  float dist = length(d);
  float r = dist / R;
  float depth = 0.4 * R * fresh;
  float rim = 0.07 * R * fresh;
  float h;
  float dhdr;
  if (r < 1.0) {
    h = -depth + (depth + rim) * r * r;
    dhdr = 2.0 * (depth + rim) * r;
  } else {
    float t = (r - 1.0) * 2.0;
    h = rim * (1.0 - t) * (1.0 - t) * (1.0 + 2.0 * t);
    dhdr = -12.0 * rim * t * (1.0 - t);
  }
  vec2 g = dist > 1e-5 ? d / dist * (dhdr / R) : vec2(0.0);
  return vec3(h, g);
}

/** Sum of (height, gradient) of the craters of octave o around p. */
vec3 craterOctave(vec2 p, int o) {
  vec2 b = floor(p / CELL[o] - 0.5);
  vec3 acc = vec3(0.0);
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 centre;
      float R;
      float fresh;
      if (!craterAt(b + vec2(float(i), float(j)), o, centre, R, fresh)) continue;
      vec2 d = p - centre;
      if (dot(d, d) >= 2.25 * R * R) continue;
      acc += craterShape(d, R, fresh);
    }
  }
  return acc;
}

/** Amplitude of an octave at p: suppressed over measured high-resolution data and on the landing pad. */
float octaveAmp(int o, vec2 p, float nm) {
  float a = o < uFirstHiResOctave ? 1.0 - nm : 1.0;
  if (uFlat.z > 0.0 && CELL[o] > 1.5) a *= smoothstep(uFlat.z, uFlat.z * 2.0, distance(p, uFlat.xy));
  return a;
}

vec3 knownCraters(vec2 p) {
  vec3 acc = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    vec4 kc = uKnown[k];
    if (kc.z <= 0.0) continue;
    vec2 d = p - kc.xy;
    if (dot(d, d) < 2.25 * kc.z * kc.z) acc += craterShape(d, kc.z, kc.w);
  }
  return acc;
}
`;
