/**
 * Lunar terrain.
 *
 *  - Base relief: NASA LRO LOLA. Global SVS #4720 LDEM (16 px/deg, ~1.9 km) everywhere, plus PGDA 5 m/px
 *    measured DEMs at the south-pole sites. Resampled once per site into two node grids (wide: 200 m,
 *    near: 5 m) that the CPU and the GPU read identically.
 *  - Sub-resolution relief: the analytic crater field in ./field.ts (statistical, not measured).
 *  - Geometry: camera-centred clipmap rings displaced in the vertex shader; crater octaves fade out with
 *    distance once the vertex grid can no longer carry them, while per-pixel normals keep them all.
 *  - Lighting: lunar-Lambert regolith with the measured phase falloff and opposition surge, four cascaded
 *    sun shadow maps (terrain, rocks, astronaut, hardware) and analytic self-shadowing inside small craters.
 */
import * as THREE from 'three';
import type {
  Collider, ITerrain, LightingState, QualityProfile, SiteDef, TerrainLoadInfo, WorldId,
} from '../core/types';
import { assetUrl, fetchJson } from '../core/assets';
import { lf, tpl } from '../core/l10n';
import {
  type Dem, type DemMeta, demMeters, loadDem, loadDemLayer, MOON_RADIUS_M,
} from '../core/dem';
import {
  detailHeight, FIELD_GLSL, FIRST_NORMAL_ONLY_OCTAVE, type FieldConfig, type KnownCrater,
} from './field';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Wide node grid: 1025 × 1025 nodes at 200 m (±102 km around the site). */
const WIDE_NODES = 1025;
const WIDE_SPACING_M = 200;
/** Finest clipmap vertex spacing, metres. */
const FINEST_SPACING_M = 0.125;
/** Clipmap reach (half-extent of the outermost ring), metres. */
const CLIPMAP_REACH_M = 100_000;
/** Shadow cascade half-widths, metres. */
const CASCADE_RADII = [24, 160, 1400, 24000] as const;
/** Sun-side distance of the shadow cameras: occluders this far up-sun still cast. */
const SHADOW_SUN_DISTANCE_M = 110_000;
/** Cascades 0–1 only draw rings reaching this far; beyond it the far-horizon visibility takes over. */
const NEAR_CASCADE_REACH_M = 6000;
const FAR_HORIZON_START_M = 3000;
/** Real named craters near a site (positions approximate, from Apollo traverse maps). */
const SITE_FEATURES: Record<string, { flatRadiusM: number; known: KnownCrater[] }> = {
  apollo11: {
    flatRadiusM: 20,
    known: [
      { x: 60, z: 0, radiusM: 16.5, fresh: 0.75 },   // Little West crater, ~33 m wide, ~60 m east of Eagle
      { x: 430, z: -20, radiusM: 92, fresh: 0.9 },   // West crater, ~185 m wide, ~400 m east (Eagle overflew it)
    ],
  },
};

interface PackIndex {
  packs: Array<{ id: string; centerLatDeg: number; centerLonDeg: number; metersPerSample: number; sizeM: number }>;
}
interface PackMeta {
  id: string;
  centerLatDeg: number;
  centerLonDeg: number;
  layers: Array<DemMeta & { name: 'near'; file: string }>;
}

/** A square node grid: node (i, j) sits at centre + ((i, j)/(n−1) − 0.5)·size, row j = 0 at the north (−Z) edge. */
interface NodeGrid {
  data: Float32Array;
  n: number;
  cx: number;
  cz: number;
  size: number;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Bilinear node-grid lookup; identical to `fetchGrid` in FIELD_GLSL. */
function fetchGrid(g: NodeGrid, x: number, z: number): number {
  const n = g.n;
  const fx = Math.min(1, Math.max(0, (x - g.cx) / g.size + 0.5)) * (n - 1);
  const fz = Math.min(1, Math.max(0, (z - g.cz) / g.size + 0.5)) * (n - 1);
  const ix = Math.min(Math.floor(fx), n - 2);
  const iz = Math.min(Math.floor(fz), n - 2);
  const tx = fx - ix;
  const tz = fz - iz;
  const k = iz * n + ix;
  const d = g.data;
  return (d[k] * (1 - tx) + d[k + 1] * tx) * (1 - tz) + (d[k + n] * (1 - tx) + d[k + n + 1] * tx) * tz;
}

/** Site-local (east, south) metres → selenographic lat/lon, azimuthal equidistant about the site. */
function localToLatLon(eastM: number, southM: number, lat0Deg: number, lon0Deg: number, out: [number, number]): void {
  const northM = -southM;
  const dist = Math.hypot(eastM, northM);
  if (dist < 1e-6) {
    out[0] = lat0Deg;
    out[1] = lon0Deg;
    return;
  }
  const c = dist / MOON_RADIUS_M;
  const theta = Math.atan2(eastM, northM);
  const phi0 = lat0Deg * DEG2RAD;
  const sinC = Math.sin(c);
  const cosC = Math.cos(c);
  const sinLat = Math.max(-1, Math.min(1, Math.sin(phi0) * cosC + Math.cos(phi0) * sinC * Math.cos(theta)));
  const lat = Math.asin(sinLat);
  const lon = lon0Deg * DEG2RAD + Math.atan2(Math.sin(theta) * sinC * Math.cos(phi0), cosC - Math.sin(phi0) * sinLat);
  out[0] = lat * RAD2DEG;
  out[1] = ((lon * RAD2DEG + 540) % 360) - 180;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

/** Bicubic (Catmull–Rom) sample of the global equirectangular DEM, metres above the 1737.4 km sphere. */
function sampleGlobal(dem: Dem, latDeg: number, lonDeg: number): number {
  const w = dem.meta.width;
  const h = dem.meta.height;
  const u = ((lonDeg + 180) / 360) * w - 0.5;
  const v = ((90 - latDeg) / 180) * h - 0.5;
  const i0 = Math.floor(u);
  const j0 = Math.floor(v);
  const tu = u - i0;
  const tv = v - j0;
  const rows = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) {
    const j = j0 - 1 + r;
    const col = (k: number): number => demMeters(dem, (((i0 - 1 + k) % w) + w) % w, j);
    rows[r] = catmullRom(col(0), col(1), col(2), col(3), tu);
  }
  return catmullRom(rows[0], rows[1], rows[2], rows[3], tv);
}

/** Central-difference height gradient of a node grid, packed as half-float RG for linear filtering. */
function gradientTexture(g: NodeGrid): THREE.DataTexture {
  const n = g.n;
  const step = g.size / (n - 1);
  const out = new Uint16Array(n * n * 2);
  const d = g.data;
  for (let j = 0; j < n; j++) {
    const jm = Math.max(0, j - 1);
    const jp = Math.min(n - 1, j + 1);
    for (let i = 0; i < n; i++) {
      const im = Math.max(0, i - 1);
      const ip = Math.min(n - 1, i + 1);
      const k = (j * n + i) * 2;
      out[k] = THREE.DataUtils.toHalfFloat((d[j * n + ip] - d[j * n + im]) / ((ip - im) * step));
      out[k + 1] = THREE.DataUtils.toHalfFloat((d[jp * n + i] - d[jm * n + i]) / ((jp - jm) * step));
    }
  }
  const tex = new THREE.DataTexture(out, n, n, THREE.RGFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function heightTexture(g: NodeGrid): THREE.DataTexture {
  const tex = new THREE.DataTexture(g.data, g.n, g.n, THREE.RedFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function nextTask(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

/**
 * Grid of (n+1)² vertices at integer cell coordinates (−n/2..n/2) on the XZ plane. With a hole, cells whose
 * indices both lie in [n/4+1, 3n/4−2] are omitted: the next finer ring always covers them, whatever the
 * snapping of the two ring centres.
 */
function buildRingGeometry(n: number, hole: boolean, instances: number): THREE.InstancedBufferGeometry {
  const verts = n + 1;
  const pos = new Float32Array(verts * verts * 3);
  for (let j = 0; j < verts; j++) {
    for (let i = 0; i < verts; i++) {
      const k = (j * verts + i) * 3;
      pos[k] = i - n / 2;
      pos[k + 2] = j - n / 2;
    }
  }
  const lo = n / 4 + 1;
  const hi = (3 * n) / 4 - 2;
  const idx: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (hole && i >= lo && i <= hi && j >= lo && j <= hi) continue;
      const a = j * verts + i;
      const b = a + 1;
      const c = a + verts;
      const d = c + 1;
      // Counter-clockwise seen from +Y.
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const level = new THREE.InstancedBufferAttribute(new Float32Array(instances * 3), 3);
  level.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aLevel', level);
  geo.instanceCount = instances;
  return geo;
}

/** Faceted boulder: icosphere with hashed vertex displacement and a flattened base. */
function buildRockGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const pos = geo.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 3.1 + v.y * 1.7) * Math.cos(v.z * 2.9 - v.x * 1.3) + 0.5 * Math.sin(v.y * 7.3 + v.z * 5.1);
    v.multiplyScalar(1 + 0.22 * n);
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.25;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  // Polyhedron geometry is non-indexed; shared corners get the same displacement, so faces stay closed.
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  return geo;
}

const LIGHT_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uEarthDir;
uniform vec3 uEarthColor;
uniform float uEarthIntensity;
uniform vec3 uExtraDir;
uniform vec3 uExtraColor;
uniform float uExtraIntensity;
uniform float uAmbient;
uniform float uAdaptation;
uniform float uGain;
uniform float uHeadlampOn;
uniform vec3 uHeadlampPos;
uniform vec3 uHeadlampDir;
uniform float uShadowOn;
uniform float uFarSunVis;
uniform highp sampler2DShadow uShadow0;
uniform highp sampler2DShadow uShadow1;
uniform highp sampler2DShadow uShadow2;
uniform highp sampler2DShadow uShadow3;
uniform mat4 uShadowMat[4];
uniform vec4 uShadowTexel;
uniform vec4 uShadowBias;
uniform float uShadowMapSize;

float pcf(highp sampler2DShadow map, vec3 c) {
  float o = 0.5 / uShadowMapSize;
  return 0.25 * (texture(map, vec3(c.xy + vec2(-o, -o), c.z)) + texture(map, vec3(c.xy + vec2(o, -o), c.z))
               + texture(map, vec3(c.xy + vec2(-o, o), c.z)) + texture(map, vec3(c.xy + vec2(o, o), c.z)));
}

bool cascadeCoord(int i, vec3 wp, vec3 n, out vec3 c) {
  vec4 q = uShadowMat[i] * vec4(wp + n * (uShadowTexel[i] * 1.5), 1.0);
  c = q.xyz * 0.5 + 0.5;
  c.z -= uShadowBias[i];
  return all(greaterThan(c.xy, vec2(0.01))) && all(lessThan(c.xy, vec2(0.99))) && c.z < 1.0;
}

/** 0..1 sun visibility from the cascades (terrain, rocks, astronaut, hardware). */
float sunShadow(vec3 wp, vec3 n) {
  if (uShadowOn < 0.5) return 1.0;
  vec3 c;
  if (cascadeCoord(0, wp, n, c)) return pcf(uShadow0, c) * uFarSunVis;
  if (cascadeCoord(1, wp, n, c)) return pcf(uShadow1, c) * uFarSunVis;
  if (cascadeCoord(2, wp, n, c)) return pcf(uShadow2, c);
  if (cascadeCoord(3, wp, n, c)) return pcf(uShadow3, c);
  return 1.0;
}

/**
 * Lunar-Lambert reflectance (McEwen 1991 limb-darkening parameter) with a phase falloff and opposition surge.
 * The real falloff from 0° to 120° phase is about 8:1; it is compressed to about 3:1 here so that views
 * toward and away from the Sun both fit one display exposure.
 */
float regolith(vec3 N, vec3 V, vec3 L) {
  float mu0 = dot(N, L);
  if (mu0 <= 0.0) return 0.0;
  // Surface roughness keeps grazing views from brightening without bound.
  float mu = max(dot(N, V), 0.22);
  float a = degrees(acos(clamp(dot(V, L), -1.0, 1.0)));
  float limb = clamp(1.0 - 0.019 * a + 2.42e-4 * a * a - 1.46e-6 * a * a * a, 0.0, 1.0);
  float phase = (0.38 + 0.62 * exp(-a / 45.0)) * (1.0 + 0.30 * exp(-a / 3.8));
  return (2.0 * limb * mu0 / (mu0 + mu) + (1.0 - limb) * mu0) * phase;
}

/** Linear display-referred radiance of a regolith-like surface. */
vec3 shadeSurface(vec3 wp, vec3 N, vec3 Ngeo, vec3 V, float rho, float localSunVis) {
  float sunUp = smoothstep(-0.06, -0.03, uSunDir.y);
  // Global exposure already follows adaptation (engine); this extra lift keeps earthshine readable at night.
  float adapt = 1.0 + 2.0 * uAdaptation;
  float sun = uSunIntensity * sunUp * localSunVis * sunShadow(wp, Ngeo);
  vec3 col = uSunColor * (sun * regolith(N, V, uSunDir));
  col += uEarthColor * (uEarthIntensity * adapt * max(dot(N, uEarthDir), 0.0));
  col += uExtraColor * (uExtraIntensity * adapt * max(dot(N, uExtraDir), 0.0));
  // Light scattered by the surrounding sunlit ground into shadows.
  col += vec3(1.0, 0.98, 0.95) * (uSunIntensity * uAmbient * smoothstep(-0.02, 0.06, uSunDir.y) * (0.55 + 0.45 * N.y));
  // Starlight and zodiacal light: keeps the shape of the ground readable to dark-adapted eyes when Earth is down.
  col += vec3(0.8, 0.85, 1.0) * (0.006 * adapt * max(N.y, 0.2));
  if (uHeadlampOn > 0.5) {
    vec3 toP = wp - uHeadlampPos;
    float d = length(toP);
    vec3 dir = toP / max(d, 1e-3);
    float spot = smoothstep(0.80, 0.95, dot(dir, uHeadlampDir));
    col += vec3(0.95, 0.97, 1.0) * (1.6 * spot * max(dot(N, -dir), 0.0) / (1.0 + 0.08 * d * d));
  }
  return col * (rho * uGain);
}
`;

const TERRAIN_VERT = /* glsl */ `
${FIELD_GLSL}
attribute vec3 aLevel;
uniform vec2 uFocus;
uniform vec2 uGeoFade;
varying vec3 vWorld;

void main() {
  vec2 p = aLevel.xy + position.xz * aLevel.z;
  float nm = hiResMask(p);
  float h = baseHeight(p, nm);
  float dist = distance(p, uFocus);
  for (int o = 0; o < GEO_OCTAVES; o++) {
    float w = 1.0 - smoothstep(uGeoFade.x * CELL[o], uGeoFade.y * CELL[o], dist);
    if (w <= 0.0) continue;
    float a = octaveAmp(o, p, nm) * w;
    if (a > 0.0) h += craterOctave(p, o).x * a;
  }
  h += knownCraters(p).x;
  h -= dot(p, p) / (2.0 * MOON_RADIUS);
  vWorld = vec3(p.x, h, p.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const TERRAIN_FRAG = /* glsl */ `
${FIELD_GLSL}
${LIGHT_GLSL}
uniform sampler2D uWideG;
uniform sampler2D uNearG;
uniform float uAlbedo;
uniform vec3 uTint;
varying vec3 vWorld;

vec2 gridUv(vec4 rect, vec2 p) {
  vec2 f = clamp((p - rect.xy) / rect.z + 0.5, 0.0, 1.0);
  return (f * (rect.w - 1.0) + 0.5) / rect.w;
}

/** Value noise with analytic derivatives: (value, d/dx, d/dy). */
vec3 noised(vec2 x, uint seed) {
  vec2 i = floor(x);
  vec2 f = x - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  uvec2 c = uvec2(ivec2(i) + 1048576);
  float a = float(hash32(c.x, c.y, seed)) / 4294967295.0;
  float b = float(hash32(c.x + 1u, c.y, seed)) / 4294967295.0;
  float cc = float(hash32(c.x, c.y + 1u, seed)) / 4294967295.0;
  float d = float(hash32(c.x + 1u, c.y + 1u, seed)) / 4294967295.0;
  float k = a - b - cc + d;
  return vec3(a + (b - a) * u.x + (cc - a) * u.y + k * u.x * u.y,
              du * (vec2(b - a, cc - a) + k * u.yx));
}

/**
 * noised() on a grid turned by the angle whose (cosine, sine) is \`turn\`; the derivatives are given in the
 * unturned frame. Value noise shows its square grid: with every scale turned a different way the squares do
 * not line up, with each other or with the view, into a checker pattern (plain on slopes seen at a slant).
 */
vec3 noisedTurned(vec2 x, vec2 turn, uint seed) {
  vec3 n = noised(vec2(turn.x * x.x - turn.y * x.y, turn.y * x.x + turn.x * x.y), seed);
  return vec3(n.x, turn.x * n.y + turn.y * n.z, turn.x * n.z - turn.y * n.y);
}

/** Adds a crater's slope, its self-shadow on the sun side of the bowl, and fresh-ejecta brightening. */
void craterLight(vec2 d, float R, float fresh, float a, vec2 sunH, float tanEl,
                 inout vec2 g, inout float vis, inout float bright) {
  float d2 = dot(d, d);
  if (d2 >= 2.25 * R * R) return;
  g += craterShape(d, R, fresh).yz * a;
  float r2 = d2 / (R * R);
  if (r2 < 1.0) {
    float depth = 0.4 * R * fresh;
    float rim = 0.07 * R * fresh;
    float hp = -depth + (depth + rim) * r2;
    float du = dot(d, sunH);
    float exitDist = -du + sqrt(max(R * R - d2 + du * du, 0.0));
    float clearance = hp + tanEl * exitDist - rim;
    float w = 0.005 * exitDist + 0.01 * R;
    vis = min(vis, mix(1.0, smoothstep(-w, w, clearance), a));
  }
  bright += fresh * fresh * a * (1.0 - smoothstep(0.9, 1.45, sqrt(r2)));
}

void main() {
  vec2 p = vWorld.xz;
  float nm = hiResMask(p);
  vec2 g = texture(uWideG, gridUv(uWideRect, p)).rg;
  if (nm > 0.0) g = mix(g, texture(uNearG, gridUv(uNearRect, p)).rg, nm);
  g -= p / MOON_RADIUS;

  float sunHLen = length(uSunDir.xz);
  vec2 sunH = sunHLen > 1e-4 ? uSunDir.xz / sunHLen : vec2(0.0);
  float tanEl = uSunDir.y / max(sunHLen, 1e-4);

  float fp = max(length(dFdx(p)), length(dFdy(p)));
  float craterVis = 1.0;
  float bright = 0.0;
  for (int o = 0; o < OCTAVES; o++) {
    float cell = CELL[o];
    float fade = 1.0 - smoothstep(0.06 * cell, 0.2 * cell, fp);
    if (fade <= 0.0) break;
    float a = octaveAmp(o, p, nm) * fade;
    if (a <= 0.0) continue;
    float br = 0.0;
    vec2 b = floor(p / cell - 0.5);
    for (int j = 0; j < 2; j++) {
      for (int i = 0; i < 2; i++) {
        vec2 centre;
        float R;
        float fresh;
        if (craterAt(b + vec2(float(i), float(j)), o, centre, R, fresh)) {
          craterLight(p - centre, R, fresh, a, sunH, tanEl, g, craterVis, br);
        }
      }
    }
    if (cell < 60.0) bright += br;
  }
  for (int k = 0; k < 4; k++) {
    vec4 kc = uKnown[k];
    if (kc.z > 0.0) {
      float unused = 0.0;
      craterLight(p - kc.xy, kc.z, kc.w, 1.0, sunH, tanEl, g, craterVis, unused);
    }
  }
  vec3 Ngeo = normalize(vec3(-g.x, 1.0, -g.y));

  // Regolith texture: mesoscale ridges, hummocks, clods and fine grit, faded gently at the horizon. Hummocks
  // and clods each come at two sizes, and the hummocks' grids are pulled about by the ridges, so that they do
  // not read as rows of equal dimples.
  vec3 n0 = noisedTurned(p / 14.0, vec2(0.9744, 0.2250), 10u);
  vec2 pull = (n0.yz - 0.0) * 2.6;
  vec3 n1 = noisedTurned((p + pull) / 4.3, vec2(0.7986, 0.6018), 11u);
  vec3 n1b = noisedTurned((p - pull) / 1.9, vec2(0.1908, 0.9816), 16u);
  vec3 n2 = noisedTurned(p / 0.45, vec2(0.3256, 0.9455), 12u);
  vec3 n2b = noisedTurned(p / 0.74, vec2(0.5446, -0.8387), 15u);
  vec3 n3 = noisedTurned(p / 0.07, vec2(0.9455, 0.3256), 13u);
  g += n0.yz * 0.06 * (1.0 - smoothstep(1.5, 6.0, fp));
  g += (n1.yz * 0.055 + n1b.yz * 0.04) * (1.0 - smoothstep(0.4, 1.8, fp));
  g += (n2.yz * 0.08 + n2b.yz * 0.07) * (1.0 - smoothstep(0.06, 0.28, fp));
  g += n3.yz * 0.18 * (1.0 - smoothstep(0.01, 0.045, fp));
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));

  vec3 n4 = noised(p / 38.0, 14u);
  float rho = uAlbedo * (0.86 + 0.28 * n4.x) * (0.93 + 0.14 * n0.x) * (1.0 + 0.48 * clamp(bright, 0.0, 1.0)) * (0.92 + 0.16 * n2.x);
  vec3 V = normalize(cameraPosition - vWorld);
  // Shadowed crater floors still receive ~12 % of the sunlight bounced off the lit inner wall.
  vec3 col = shadeSurface(vWorld, N, Ngeo, V, rho, 0.12 + 0.88 * craterVis) * uTint;
  gl_FragColor = vec4(col, 1.0);
}
`;

const ROCK_VERT = /* glsl */ `
varying vec3 vWorld;
varying float vTone;
varying float vLocalY;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vLocalY = position.y;
  vTone = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ROCK_FRAG = /* glsl */ `
${LIGHT_GLSL}
uniform float uAlbedo;
uniform vec3 uTint;
varying vec3 vWorld;
varying float vTone;
varying float vLocalY;

float rHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float rNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rHash(i), rHash(i + vec3(1,0,0)), f.x), mix(rHash(i + vec3(0,1,0)), rHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(rHash(i + vec3(0,0,1)), rHash(i + vec3(1,0,1)), f.x), mix(rHash(i + vec3(0,1,1)), rHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

void main() {
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 V = normalize(cameraPosition - vWorld);
  if (dot(N, V) < 0.0) N = -N;
  float g1 = rNoise(vWorld * 9.0);
  float g2 = rNoise(vWorld * 24.0);
  vec3 grainN = normalize(N + 0.22 * vec3(g1 - 0.5, g2 - 0.5, (g1 + g2) * 0.5 - 0.5));
  // Dust settles around the buried base of each boulder.
  float dustCoat = 1.0 - smoothstep(-0.35, 0.15, vLocalY);
  float rho = uAlbedo * mix(0.85 + 0.38 * vTone, 1.02, dustCoat) * (0.86 + 0.28 * g1);
  gl_FragColor = vec4(shadeSurface(vWorld, grainN, N, V, rho, 1.0) * uTint, 1.0);
}
`;

const DEPTH_FRAG = /* glsl */ 'void main() {}';

const CASTER_DEPTH_VERT = /* glsl */ `
void main() {
  vec4 p = vec4(position, 1.0);
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
#endif
  gl_Position = projectionMatrix * modelViewMatrix * p;
}
`;

export function createTerrain(renderer: THREE.WebGLRenderer): ITerrain {
  const object3d = new THREE.Group();
  object3d.name = 'terrain';
  const shadowScene = new THREE.Scene();

  let globalDem: Dem | null = null;
  let packIndex: PackIndex | null = null;
  let quality: QualityProfile | null = null;

  const emptyGrid = (): NodeGrid => ({ data: new Float32Array(4), n: 2, cx: 0, cz: 0, size: 1 });
  let wide: NodeGrid = emptyGrid();
  let near: NodeGrid = emptyGrid();
  let hasHiRes = false;
  let originElevationM = 0;
  let albedo = 0.12;
  const siteTint = new THREE.Vector3(1, 1, 1);
  let activeWorld: WorldId = 'moon';

  const fieldCfg: FieldConfig = {
    firstHiResOctave: 4,
    hiResMask: (x, z) => {
      if (!hasHiRes) return 0;
      const dx = Math.abs(x - near.cx) / (0.5 * near.size);
      const dz = Math.abs(z - near.cz) / (0.5 * near.size);
      return smoothstep(0, 0.15, 1 - Math.max(dx, dz));
    },
    flatX: 0,
    flatZ: 0,
    flatRadiusM: 0,
    known: [],
  };

  const blank = (): THREE.DataTexture => heightTexture(emptyGrid());
  const fieldUniforms = {
    uNearH: { value: blank() },
    uWideH: { value: blank() },
    uNearRect: { value: new THREE.Vector4(0, 0, 1, 2) },
    uWideRect: { value: new THREE.Vector4(0, 0, 1, 2) },
    uHiRes: { value: 0 },
    uFirstHiResOctave: { value: fieldCfg.firstHiResOctave },
    uFlat: { value: new THREE.Vector3() },
    uKnown: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uFocus: { value: new THREE.Vector2() },
    uGeoFade: { value: new THREE.Vector2(3, 5.4) },
  };

  const shadowTargets: THREE.WebGLRenderTarget[] = [];
  const lightUniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Vector3(1, 1, 1) },
    uSunIntensity: { value: 0 },
    uEarthDir: { value: new THREE.Vector3(0, 1, 0) },
    uEarthColor: { value: new THREE.Vector3(0.4, 0.6, 1) },
    uEarthIntensity: { value: 0 },
    uExtraDir: { value: new THREE.Vector3(0, 1, 0) },
    uExtraColor: { value: new THREE.Vector3(1, 1, 1) },
    uExtraIntensity: { value: 0 },
    uAmbient: { value: 0.02 },
    uAdaptation: { value: 0 },
    // three's ACES applies exposure / 0.6; this gain keeps sunlit mare in the mid-tones and never white.
    uGain: { value: 2.9 },
    uHeadlampOn: { value: 0 },
    uHeadlampPos: { value: new THREE.Vector3() },
    uHeadlampDir: { value: new THREE.Vector3(0, 0, -1) },
    uShadowOn: { value: 0 },
    uFarSunVis: { value: 1 },
    uShadow0: { value: null as THREE.DepthTexture | null },
    uShadow1: { value: null as THREE.DepthTexture | null },
    uShadow2: { value: null as THREE.DepthTexture | null },
    uShadow3: { value: null as THREE.DepthTexture | null },
    uShadowMat: { value: [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()] },
    uShadowTexel: { value: new THREE.Vector4() },
    uShadowBias: { value: new THREE.Vector4() },
    uShadowMapSize: { value: 2048 },
  };
  const surfaceUniforms = {
    uAlbedo: { value: 0.12 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
  };

  const terrainMat = new THREE.ShaderMaterial({
    uniforms: {
      ...fieldUniforms,
      ...lightUniforms,
      ...surfaceUniforms,
      uWideG: { value: blank() as THREE.Texture },
      uNearG: { value: blank() as THREE.Texture },
    },
    vertexShader: TERRAIN_VERT,
    fragmentShader: TERRAIN_FRAG,
  });
  const terrainDepthMat = new THREE.ShaderMaterial({
    uniforms: fieldUniforms,
    vertexShader: TERRAIN_VERT,
    fragmentShader: DEPTH_FRAG,
    colorWrite: false,
  });
  const casterDepthMat = new THREE.ShaderMaterial({
    vertexShader: CASTER_DEPTH_VERT,
    fragmentShader: DEPTH_FRAG,
    colorWrite: false,
    side: THREE.DoubleSide,
  });
  const rockMat = new THREE.ShaderMaterial({
    uniforms: { ...lightUniforms, ...surfaceUniforms },
    vertexShader: ROCK_VERT,
    fragmentShader: ROCK_FRAG,
  });

  // ───────────── clipmap ─────────────
  let gridCells = 192;
  let levels = 1;
  let centreGeo = buildRingGeometry(gridCells, false, 1);
  let ringGeo = buildRingGeometry(gridCells, true, 1);
  const centreMesh = new THREE.Mesh(centreGeo, terrainMat);
  const ringMesh = new THREE.Mesh(ringGeo, terrainMat);
  const centreDepth = new THREE.Mesh(centreGeo, terrainDepthMat);
  const ringDepth = new THREE.Mesh(ringGeo, terrainDepthMat);
  for (const m of [centreMesh, ringMesh, centreDepth, ringDepth]) {
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
  }
  object3d.add(centreMesh, ringMesh);
  shadowScene.add(centreDepth, ringDepth);

  function configureClipmap(cells: number): void {
    gridCells = cells;
    levels = Math.ceil(Math.log2(CLIPMAP_REACH_M / (FINEST_SPACING_M * cells * 0.5))) + 1;
    centreGeo.dispose();
    ringGeo.dispose();
    centreGeo = buildRingGeometry(cells, false, 1);
    ringGeo = buildRingGeometry(cells, true, levels - 1);
    centreMesh.geometry = centreGeo;
    centreDepth.geometry = centreGeo;
    ringMesh.geometry = ringGeo;
    ringDepth.geometry = ringGeo;
    // Vertex spacing at distance d is at most ~4d/cells; keep a crater octave in the geometry while
    // its typical crater still spans a few vertices.
    fieldUniforms.uGeoFade.value.set(0.016 * cells, 0.028 * cells);
  }

  function placeRings(fx: number, fz: number): void {
    const c = centreGeo.getAttribute('aLevel') as THREE.InstancedBufferAttribute;
    const r = ringGeo.getAttribute('aLevel') as THREE.InstancedBufferAttribute;
    for (let l = 0; l < levels; l++) {
      const s = FINEST_SPACING_M * 2 ** l;
      const snap = 2 * s;
      const cx = Math.round(fx / snap) * snap;
      const cz = Math.round(fz / snap) * snap;
      if (l === 0) c.setXYZ(0, cx, cz, s);
      else r.setXYZ(l - 1, cx, cz, s);
    }
    c.needsUpdate = true;
    r.needsUpdate = true;
  }

  /** Number of ring instances whose reach is within `reachM` (for the near cascades). */
  function ringsWithin(reachM: number): number {
    let count = 0;
    for (let l = 1; l < levels; l++) {
      if (FINEST_SPACING_M * 2 ** l * gridCells * 0.25 > reachM) break;
      count++;
    }
    return count;
  }

  // ───────────── rocks ─────────────
  const MAX_ROCKS = 2000;
  const rockGeo = buildRockGeometry();
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, MAX_ROCKS);
  rocks.frustumCulled = false;
  rocks.count = 0;
  object3d.add(rocks);

  // The cloud tops of Jupiter, Saturn, Uranus and Neptune, far below the floating astronaut: a model (belts
  // of wind sliding past each other, swirls, storm tops catching the light), not a picture of any real place.
  const DECK_DEPTH_M = 1800;
  const DECK_HALF_M = 250_000;
  const HORIZON_GLOW_M = 14_000;
  const cloudUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.4, 0.5, 0.6).normalize() },
    uFocus: { value: new THREE.Vector2() },
    uBelt: { value: new THREE.Color() },
    uZone: { value: new THREE.Color() },
    uStorm: { value: new THREE.Color() },
    uHaze: { value: new THREE.Color() },
    uRelief: { value: 1 },
  };
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: cloudUniforms,
    vertexShader: /* glsl */ `
      uniform vec2 uFocus;
      varying vec3 vWorld;
      void main() {
        vWorld = vec3(position.x + uFocus.x, ${(-DECK_DEPTH_M).toFixed(1)}, position.z + uFocus.y);
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uBelt;
      uniform vec3 uZone;
      uniform vec3 uStorm;
      uniform vec3 uHaze;
      uniform float uRelief;
      varying vec3 vWorld;
      float h2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float n2(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), u.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm3(vec2 p) {
        float s = 0.0; float a = 0.5;
        for (int k = 0; k < 3; k++) { s += a * n2(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
        return s / 0.875;
      }
      float fbm5(vec2 p) {
        float s = 0.0; float a = 0.5;
        for (int k = 0; k < 5; k++) { s += a * n2(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
        return s / 0.96875;
      }
      // Height of the cloud tops, 0…1, at a point of the deck (kilometres). The wind blows along x in belts
      // stacked along y, each sliding past its neighbours, and a second pattern carries the first round in
      // swirls. \`fine\` (0…1) adds the small puffs, which only the clouds near the viewer are given: far off
      // they would be smaller than a pixel and shimmer.
      float tops(vec2 p, float fine) {
        vec2 q = vec2(p.x * 0.045 + uTime * 0.012 * sin(p.y * 0.21), p.y * 0.1);
        vec2 swirl = vec2(fbm3(q * 1.6 + vec2(3.1, 0.0)), fbm3(q * 1.6 + vec2(0.0, 7.3))) - 0.5;
        return fbm5(q + swirl * 1.3) + fine * 0.07 * (fbm3(p * vec2(0.9, 1.7) + swirl * 4.0) - 0.5);
      }
      void main() {
        vec2 p = vWorld.xz * 0.001;
        float fine = exp(-distance(vWorld, cameraPosition) / 14000.0);
        float here = tops(p, fine);
        // The slope of the cloud tops, from their height a little way along each side (they stand a few
        // kilometres tall).
        vec3 normal = normalize(vec3((here - tops(p + vec2(0.3, 0.0), fine)) * 5.0 * uRelief, 0.3, (here - tops(p + vec2(0.0, 0.3), fine)) * 5.0 * uRelief));
        float belt = 0.5 + 0.5 * sin(p.y * 0.055 + (here - 0.5) * 2.4);
        vec3 albedo = mix(uBelt, uZone, belt);
        albedo = mix(albedo, uStorm, smoothstep(0.66, 0.84, here) * 0.6);
        // The hollows between the cloud tops are in their shade.
        albedo *= mix(0.7, 1.0, smoothstep(0.25, 0.7, here));
        vec3 L = normalize(uSunDir);
        float day = smoothstep(-0.08, 0.1, L.y);
        float sun = clamp(dot(normal, L), 0.0, 1.0);
        vec3 col = albedo * (0.02 + day * (0.2 + 1.05 * sun));
        // The air between thins the far clouds out into the colour of the horizon.
        float haze = 1.0 - exp(-distance(vWorld, cameraPosition) / 110000.0);
        gl_FragColor = vec4(mix(col, uHaze * (0.02 + 0.75 * day), haze), 1.0);
      }
    `,
  });
  const cloudDeckGeo = new THREE.PlaneGeometry(DECK_HALF_M * 2, DECK_HALF_M * 2, 1, 1);
  cloudDeckGeo.rotateX(-Math.PI / 2);
  const cloudDeck = new THREE.Mesh(cloudDeckGeo, cloudMat);
  cloudDeck.frustumCulled = false;
  cloudDeck.visible = false;
  object3d.add(cloudDeck);
  // The glow of the air above the horizon, where the cloud deck ends against the sky.
  const horizonGlowMat = new THREE.ShaderMaterial({
    uniforms: { uSunDir: cloudUniforms.uSunDir, uHaze: cloudUniforms.uHaze },
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying float vUp;
      void main() {
        vUp = uv.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform vec3 uHaze;
      varying float vUp;
      void main() {
        float day = smoothstep(-0.08, 0.1, normalize(uSunDir).y);
        float thin = (1.0 - vUp) * (1.0 - vUp) * (1.0 - vUp);
        gl_FragColor = vec4(uHaze * (0.02 + 0.75 * day), thin);
      }
    `,
  });
  const horizonGlowGeo = new THREE.CylinderGeometry(DECK_HALF_M * 0.985, DECK_HALF_M * 0.985, HORIZON_GLOW_M, 96, 1, true);
  const horizonGlow = new THREE.Mesh(horizonGlowGeo, horizonGlowMat);
  horizonGlow.frustumCulled = false;
  horizonGlow.visible = false;
  object3d.add(horizonGlow);
  /** Colours of each giant's cloud tops: dark belt, light zone, storm tops, horizon haze; and how rugged they are. */
  const CLOUD_LOOK: Record<'jupiter' | 'saturn' | 'uranus' | 'neptune', { belt: number; zone: number; storm: number; haze: number; relief: number }> = {
    jupiter: { belt: 0x9b6a4a, zone: 0xf0e4cf, storm: 0xdc8f69, haze: 0xcdbba4, relief: 1 },
    saturn: { belt: 0xc7b187, zone: 0xf1e5c0, storm: 0xf7f0de, haze: 0xd6cba6, relief: 0.7 },
    uranus: { belt: 0x8fd0d6, zone: 0xbfe8ea, storm: 0xe2f6f7, haze: 0xa3d7dc, relief: 0.35 },
    neptune: { belt: 0x3a5fc0, zone: 0x6c9eea, storm: 0xe6f1ff, haze: 0x5e86d2, relief: 0.8 },
  };
  const ROCK_CELL_M = 2.5;
  const ROCK_RADIUS_CELLS = 36;
  const rockCellOrder: Array<[number, number]> = [];
  for (let j = -ROCK_RADIUS_CELLS; j <= ROCK_RADIUS_CELLS; j++) {
    for (let i = -ROCK_RADIUS_CELLS; i <= ROCK_RADIUS_CELLS; i++) {
      if (i * i + j * j <= ROCK_RADIUS_CELLS * ROCK_RADIUS_CELLS) rockCellOrder.push([i, j]);
    }
  }
  rockCellOrder.sort((a, b) => a[0] * a[0] + a[1] * a[1] - b[0] * b[0] - b[1] * b[1]);
  let rockLimit = 1200;
  const lastRockCentre = new THREE.Vector2(1e9, 1e9);

  function rand(i: number, j: number, k: number): number {
    let h = Math.imul(i + 4096, 0x27d4eb2d) ^ Math.imul(j + 4096, 0x165667b1) ^ Math.imul(k, 0x9e3779b9);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }

  const boulders: Collider[] = [];

  function scatterRocks(px: number, pz: number): void {
    lastRockCentre.set(px, pz);
    const bi = Math.floor(px / ROCK_CELL_M);
    const bj = Math.floor(pz / ROCK_CELL_M);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const t = new THREE.Vector3();
    let count = 0;
    boulders.length = 0;
    for (const [di, dj] of rockCellOrder) {
      if (count >= rockLimit) break;
      const i = bi + di;
      const j = bj + dj;
      if (rand(i, j, 1) > 0.42) continue;
      const x = (i + rand(i, j, 2)) * ROCK_CELL_M;
      const z = (j + rand(i, j, 3)) * ROCK_CELL_M;
      const padDist = fieldCfg.flatRadiusM > 0 ? Math.hypot(x - fieldCfg.flatX, z - fieldCfg.flatZ) : Infinity;
      if (padDist < 7) continue;
      const u = rand(i, j, 4);
      const boulder = rand(i, j, 5) < 0.025 && padDist > 3 * fieldCfg.flatRadiusM;
      const size = boulder ? 0.35 + 0.9 * u : 0.03 + 0.32 * u ** 5;
      const flat = 0.5 + 0.35 * rand(i, j, 6);
      e.set((rand(i, j, 7) - 0.5) * 0.5, rand(i, j, 8) * Math.PI * 2, (rand(i, j, 9) - 0.5) * 0.5);
      q.setFromEuler(e);
      s.set(size * (0.8 + 0.4 * rand(i, j, 10)), size * flat, size);
      // Ground the rock on the surface as drawn away from the player (finest octave excluded), a third buried.
      t.set(x, baseHeight(x, z) + detailHeight(x, z, fieldCfg, 0, FIRST_NORMAL_ONLY_OCTAVE - 2) - curvature(x, z) - size * flat * 0.3, z);
      m.compose(t, q, s);
      rocks.setMatrixAt(count++, m);
      // Only rocks taller than a boot step block walking; they can still be jumped over.
      if (size * flat > 0.25) boulders.push({ x, z, radius: size * 0.85, top: t.y + size * flat * 0.85 });
    }
    rocks.count = count;
    rocks.instanceMatrix.needsUpdate = true;
  }

  // ───────────── shadows ─────────────
  const shadowCams = CASCADE_RADII.map(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2));
  const cascadeState = CASCADE_RADII.map(() => ({ sun: new THREE.Vector3(0, -1, 0), centre: new THREE.Vector3(1e9, 0, 0), age: 99 }));
  const twins = new Map<THREE.Object3D, THREE.Mesh>();
  const tmpV = new THREE.Vector3();

  function buildShadowTargets(size: number): void {
    for (const t of shadowTargets) t.dispose();
    shadowTargets.length = 0;
    for (let i = 0; i < CASCADE_RADII.length; i++) {
      const depth = new THREE.DepthTexture(size, size, THREE.FloatType);
      depth.compareFunction = THREE.LessEqualCompare;
      depth.minFilter = THREE.LinearFilter;
      depth.magFilter = THREE.LinearFilter;
      shadowTargets.push(new THREE.WebGLRenderTarget(size, size, {
        format: THREE.RedFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: true,
        depthTexture: depth,
      }));
    }
    lightUniforms.uShadow0.value = shadowTargets[0].depthTexture;
    lightUniforms.uShadow1.value = shadowTargets[1].depthTexture;
    lightUniforms.uShadow2.value = shadowTargets[2].depthTexture;
    lightUniforms.uShadow3.value = shadowTargets[3].depthTexture;
    lightUniforms.uShadowMapSize.value = size;
    for (const c of cascadeState) c.age = 99;
    // Allocate and clear every map now: a shadow sampler bound to a never-rendered depth texture makes WebGL
    // reject the whole terrain draw (the ground vanished at night until the Sun had risen once).
    const prev = renderer.getRenderTarget();
    for (const t of shadowTargets) {
      renderer.setRenderTarget(t);
      renderer.clear(false, true, false);
    }
    renderer.setRenderTarget(prev);
  }

  function effectivelyVisible(o: THREE.Object3D): boolean {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }

  function twinFor(src: THREE.Mesh): THREE.Mesh {
    let twin = twins.get(src);
    if (!twin) {
      if (src instanceof THREE.InstancedMesh) {
        const inst = new THREE.InstancedMesh(src.geometry, casterDepthMat, src.instanceMatrix.count);
        inst.instanceMatrix = src.instanceMatrix;
        twin = inst;
      } else {
        twin = new THREE.Mesh(src.geometry, casterDepthMat);
      }
      twin.matrixAutoUpdate = false;
      twin.frustumCulled = false;
      shadowScene.add(twin);
      twins.set(src, twin);
    }
    return twin;
  }

  /** Mirrors every visible caster mesh into the shadow scene; twins of vanished meshes are dropped. */
  function syncTwins(roots: THREE.Object3D[]): void {
    const seen = new Set<THREE.Object3D>();
    for (const root of roots) {
      root.updateWorldMatrix(true, true);
      root.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || o.userData.noShadow) return;
        const twin = twinFor(o);
        seen.add(o);
        twin.visible = effectivelyVisible(o);
        twin.matrix.copy(o.matrixWorld);
        twin.matrixWorldNeedsUpdate = true;
        if (o instanceof THREE.InstancedMesh && twin instanceof THREE.InstancedMesh) twin.count = o.count;
      });
    }
    for (const [src, twin] of twins) {
      if (seen.has(src)) continue;
      shadowScene.remove(twin);
      twins.delete(src);
    }
  }

  function renderCascade(i: number, sun: THREE.Vector3, centre: THREE.Vector3, size: number): void {
    const r = CASCADE_RADII[i];
    const cam = shadowCams[i];
    const f = tmpV.copy(sun).negate();
    const up = Math.abs(f.y) > 0.99 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(f, up).normalize();
    const camUp = new THREE.Vector3().crossVectors(right, f).normalize();
    const texel = (2 * r) / size;
    const cr = Math.round(centre.dot(right) / texel) * texel;
    const cu = Math.round(centre.dot(camUp) / texel) * texel;
    const snapped = new THREE.Vector3()
      .addScaledVector(right, cr)
      .addScaledVector(camUp, cu)
      .addScaledVector(f, centre.dot(f));
    const sinEl = Math.max(0.02, sun.y);
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 1;
    cam.far = SHADOW_SUN_DISTANCE_M + r + Math.min(r / sinEl, 150_000) + 2000;
    cam.position.copy(snapped).addScaledVector(f, -SHADOW_SUN_DISTANCE_M);
    cam.up.copy(camUp);
    cam.lookAt(snapped);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    lightUniforms.uShadowMat.value[i].multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    lightUniforms.uShadowTexel.value.setComponent(i, texel);
    lightUniforms.uShadowBias.value.setComponent(i, (2 * texel) / (cam.far - cam.near));

    ringGeo.instanceCount = i < 2 ? ringsWithin(NEAR_CASCADE_REACH_M) : levels - 1;
    renderer.setRenderTarget(shadowTargets[i]);
    renderer.clear(false, true, false);
    renderer.render(shadowScene, cam);
    ringGeo.instanceCount = levels - 1;
  }

  // ───────────── heights ─────────────
  function baseHeight(x: number, z: number): number {
    const hw = fetchGrid(wide, x, z);
    const nm = fieldCfg.hiResMask(x, z);
    return nm > 0 ? hw + (fetchGrid(near, x, z) - hw) * nm : hw;
  }

  function curvature(x: number, z: number): number {
    return (x * x + z * z) / (2 * MOON_RADIUS_M);
  }

  function coarseHeight(x: number, z: number): number {
    return baseHeight(x, z) + detailHeight(x, z, fieldCfg, 0, 2) - curvature(x, z);
  }

  function heightAt(x: number, z: number): number {
    return baseHeight(x, z) + detailHeight(x, z, fieldCfg) - curvature(x, z);
  }

  /** 0..1 fraction of the solar disc above the terrain beyond FAR_HORIZON_START_M, seen from (x, z). */
  function farSunVisibility(x: number, z: number, sun: THREE.Vector3): number {
    const hLen = Math.hypot(sun.x, sun.z);
    const sunEl = Math.atan2(sun.y, hLen);
    if (hLen < 1e-4) return 1;
    const dx = sun.x / hLen;
    const dz = sun.z / hLen;
    const y0 = heightAt(x, z) + 1.7;
    let maxEl = -Math.PI / 2;
    for (let d = FAR_HORIZON_START_M; d < CLIPMAP_REACH_M; d *= 1.06) {
      const el = Math.atan2(coarseHeight(x + dx * d, z + dz * d) - y0, d);
      if (el > maxEl) maxEl = el;
    }
    const radius = 0.2666 * DEG2RAD;
    return smoothstep(-radius, radius, sunEl - maxEl);
  }

  // ───────────── site data ─────────────
  let moonColorImage: HTMLImageElement | null = null;

  async function siteAlbedo(site: SiteDef): Promise<{ albedo: number; tint: THREE.Vector3 }> {
    if (!moonColorImage) {
      const img = new Image();
      img.src = assetUrl('assets/tex/moon_color_2k.webp');
      await img.decode();
      moonColorImage = img;
    }
    const w = moonColorImage.naturalWidth;
    const h = moonColorImage.naturalHeight;
    const sx = Math.floor(((site.lonDeg + 180) / 360) * w);
    const sy = Math.min(h - 3, Math.max(0, Math.floor(((90 - site.latDeg) / 180) * h)));
    const canvas = document.createElement('canvas');
    canvas.width = 5;
    canvas.height = 5;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { albedo: 0.12, tint: new THREE.Vector3(1, 1, 1) };
    ctx.drawImage(moonColorImage, Math.max(0, sx - 2), Math.max(0, sy - 2), 5, 5, 0, 0, 5, 5);
    const px = ctx.getImageData(0, 0, 5, 5).data;
    const lin = [0, 0, 0];
    for (let k = 0; k < px.length; k += 4) {
      for (let c = 0; c < 3; c++) {
        const s = px[k + c] / 255;
        lin[c] += (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) / 25;
      }
    }
    const lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    const tint = new THREE.Vector3(lin[0], lin[1], lin[2]).divideScalar(Math.max(lum, 1e-4));
    tint.lerp(new THREE.Vector3(1, 1, 1), 0.65);
    // Normal albedo: dark mare ≈ 0.07–0.10, bright highlands ≈ 0.15–0.17.
    return { albedo: Math.min(0.17, Math.max(0.07, 0.06 + 0.3 * lum)), tint };
  }

  async function buildWideGrid(site: SiteDef, dem: Dem, onRow: (f: number) => void): Promise<NodeGrid> {
    const n = WIDE_NODES;
    const size = (n - 1) * WIDE_SPACING_M;
    const data = new Float32Array(n * n);
    const ll: [number, number] = [0, 0];
    for (let j = 0; j < n; j++) {
      const south = (j / (n - 1) - 0.5) * size;
      for (let i = 0; i < n; i++) {
        localToLatLon((i / (n - 1) - 0.5) * size, south, site.latDeg, site.lonDeg, ll);
        data[j * n + i] = sampleGlobal(dem, ll[0], ll[1]);
      }
      if ((j & 63) === 63) {
        onRow(j / n);
        await nextTask();
      }
    }
    return { data, n, cx: 0, cz: 0, size };
  }

  async function loadNearPack(site: SiteDef): Promise<{ grid: NodeGrid; label: string; mpp: number } | null> {
    if (!site.packId) return null;
    packIndex ??= await fetchJson<PackIndex>('assets/dem/sites/index.json');
    const entry = packIndex.packs.find((p) => p.id === site.packId);
    if (!entry) throw new Error(`DEM pack "${site.packId}" missing from assets/dem/sites/index.json`);
    const meta = await fetchJson<PackMeta>(`assets/dem/sites/${entry.id}/meta.json`);
    const layer = meta.layers.find((l) => l.name === 'near');
    if (!layer) throw new Error(`DEM pack "${entry.id}" has no near layer`);
    if (Math.abs(meta.centerLatDeg - site.latDeg) > 1e-6 || Math.abs(meta.centerLonDeg - site.lonDeg) > 1e-6) {
      throw new Error(`DEM pack "${entry.id}" is centred at ${meta.centerLatDeg}, ${meta.centerLonDeg}, not at the site`);
    }
    const dem = await loadDemLayer(layer, `assets/dem/sites/${entry.id}/${layer.file}`);
    const n = dem.meta.width;
    const data = new Float32Array(n * n);
    for (let k = 0; k < data.length; k++) data[k] = dem.meta.offset + dem.meta.scale * dem.data[k];
    const site5 = /Site\d+/.exec(layer.source)?.[0] ?? entry.id;
    return { grid: { data, n, cx: 0, cz: 0, size: layer.sizeM ?? entry.sizeM }, label: site5, mpp: layer.metersPerSample };
  }

  const api: ITerrain = {
    object3d,

    heightAt,

    normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
      const e = 0.3;
      return out.set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
    },

    async load(site, q, onProgress): Promise<TerrainLoadInfo> {
      onProgress?.(0.02, 'LOLA');
      globalDem ??= await loadDem('assets/dem/moon_global.json');
      const dem = globalDem;
      const pack = await loadNearPack(site);
      onProgress?.(0.3);

      const wideRaw = await buildWideGrid(site, dem, (f) => onProgress?.(0.3 + f * 0.5));
      hasHiRes = pack !== null;
      near = pack ? pack.grid : emptyGrid();
      originElevationM = hasHiRes ? fetchGrid(near, 0, 0) : fetchGrid(wideRaw, 0, 0);
      for (let k = 0; k < wideRaw.data.length; k++) wideRaw.data[k] -= originElevationM;
      if (hasHiRes) for (let k = 0; k < near.data.length; k++) near.data[k] -= originElevationM;
      wide = wideRaw;
      onProgress?.(0.85);

      const features = SITE_FEATURES[site.id];
      fieldCfg.flatRadiusM = features?.flatRadiusM ?? 0;
      fieldCfg.known = features?.known ?? [];
      fieldUniforms.uFlat.value.set(0, 0, fieldCfg.flatRadiusM);
      fieldUniforms.uKnown.value.forEach((v, k) => {
        const kc = fieldCfg.known[k];
        v.set(kc?.x ?? 0, kc?.z ?? 0, kc?.radiusM ?? 0, kc?.fresh ?? 0);
      });

      for (const u of [fieldUniforms.uNearH, fieldUniforms.uWideH, terrainMat.uniforms.uWideG, terrainMat.uniforms.uNearG]) {
        (u.value as THREE.Texture).dispose();
      }
      fieldUniforms.uWideH.value = heightTexture(wide);
      fieldUniforms.uNearH.value = heightTexture(near);
      terrainMat.uniforms.uWideG.value = gradientTexture(wide);
      terrainMat.uniforms.uNearG.value = gradientTexture(near);
      fieldUniforms.uWideRect.value.set(wide.cx, wide.cz, wide.size, wide.n);
      fieldUniforms.uNearRect.value.set(near.cx, near.cz, near.size, near.n);
      fieldUniforms.uHiRes.value = hasHiRes ? 1 : 0;

      const alb = await siteAlbedo(site).catch(() => ({ albedo: 0.12, tint: new THREE.Vector3(1, 1, 1) }));
      albedo = alb.albedo;
      siteTint.copy(alb.tint);
      if (activeWorld === 'moon') {
        surfaceUniforms.uAlbedo.value = albedo;
        surfaceUniforms.uTint.value.copy(siteTint);
      }

      api.setQuality(q);
      placeRings(0, 0);
      scatterRocks(0, 0);
      onProgress?.(1);

      const globalMpp = Math.round(dem.meta.metersPerSample);
      return {
        sourceLabel: hasHiRes && pack
          ? lf(
            tpl`LOLA ${pack.mpp.toFixed(0)} m/px ölçüm (PGDA ${pack.label}) + LOLA küresel ${globalMpp} m/px + istatistiksel kraterler`,
            tpl`LOLA ${pack.mpp.toFixed(0)} m/px measured (PGDA ${pack.label}) + LOLA global ${globalMpp} m/px + statistical craters`,
          )
          : lf(
            tpl`LOLA küresel ${globalMpp} m/px (SVS #4720) + istatistiksel kraterler`,
            tpl`LOLA global ${globalMpp} m/px (SVS #4720) + statistical craters`,
          ),
        dataResolutionM: hasHiRes && pack ? pack.mpp : dem.meta.metersPerSample,
        hasHiRes,
        originElevationM,
        albedo,
      };
    },

    update(dt: number, _camera: THREE.PerspectiveCamera, l: LightingState, playerPos: THREE.Vector3): void {
      cloudUniforms.uTime.value += dt;
      cloudUniforms.uFocus.value.set(playerPos.x, playerPos.z);
      cloudUniforms.uSunDir.value.set(l.sunDir[0], l.sunDir[1], l.sunDir[2]).normalize();
      horizonGlow.position.set(playerPos.x, HORIZON_GLOW_M / 2 - DECK_DEPTH_M, playerPos.z);
      fieldUniforms.uFocus.value.set(playerPos.x, playerPos.z);
      placeRings(playerPos.x, playerPos.z);
      if (Math.hypot(playerPos.x - lastRockCentre.x, playerPos.z - lastRockCentre.y) > 12) scatterRocks(playerPos.x, playerPos.z);
      const u = lightUniforms;
      u.uSunDir.value.set(l.sunDir[0], l.sunDir[1], l.sunDir[2]).normalize();
      u.uSunColor.value.set(l.sunColor[0], l.sunColor[1], l.sunColor[2]);
      u.uSunIntensity.value = l.sunIntensity;
      u.uEarthDir.value.set(l.earthDir[0], l.earthDir[1], l.earthDir[2]).normalize();
      u.uEarthColor.value.set(l.earthColor[0], l.earthColor[1], l.earthColor[2]);
      u.uEarthIntensity.value = l.earthIntensity;
      u.uExtraDir.value.set(l.extraDir[0], l.extraDir[1], l.extraDir[2]).normalize();
      u.uExtraColor.value.set(l.extraColor[0], l.extraColor[1], l.extraColor[2]);
      u.uExtraIntensity.value = l.extraIntensity;
      u.uAmbient.value = l.ambient;
      u.uAdaptation.value = l.adaptation;
      u.uHeadlampOn.value = l.headlamp.on ? 1 : 0;
      u.uHeadlampPos.value.set(l.headlamp.pos[0], l.headlamp.pos[1], l.headlamp.pos[2]);
      u.uHeadlampDir.value.set(l.headlamp.dir[0], l.headlamp.dir[1], l.headlamp.dir[2]).normalize();
      u.uFarSunVis.value = farSunVisibility(playerPos.x, playerPos.z, u.uSunDir.value);
    },

    renderCasterShadows(casters: THREE.Object3D[], l: LightingState, center: THREE.Vector3): void {
      const sun = lightUniforms.uSunDir.value;
      const on = sun.y > -0.05 && l.sunIntensity > 0.001 && shadowTargets.length > 0;
      lightUniforms.uShadowOn.value = on ? 1 : 0;
      if (!on || !quality) return;

      syncTwins([...casters, rocks]);
      const prevTarget = renderer.getRenderTarget();
      const size = quality.shadowMapSize;
      const focus = new THREE.Vector3(center.x, heightAt(center.x, center.z), center.z);
      for (let i = 0; i < CASCADE_RADII.length; i++) {
        const st = cascadeState[i];
        st.age++;
        const sunMovedDeg = Math.acos(Math.min(1, st.sun.dot(sun))) * RAD2DEG;
        const moved = st.centre.distanceTo(focus);
        const due = i < 2
          || (i === 2 && (st.age >= 4 || sunMovedDeg > 0.03 || moved > 4))
          || (i === 3 && (st.age >= 30 || sunMovedDeg > 0.1 || moved > 60));
        if (!due) continue;
        renderCascade(i, sun, focus, size);
        st.sun.copy(sun);
        st.centre.copy(focus);
        st.age = 0;
      }
      renderer.setRenderTarget(prevTarget);
    },

    collidersNear(x: number, z: number, range: number, out: Collider[]): void {
      for (const b of boulders) {
        if (Math.abs(b.x - x) < range && Math.abs(b.z - z) < range) out.push(b);
      }
    },

    horizonProfile(x: number, z: number, eyeHeightM: number, samples = 360): Float32Array {
      const profile = new Float32Array(samples);
      const y0 = heightAt(x, z) + eyeHeightM;
      for (let i = 0; i < samples; i++) {
        const az = (i * 360 / samples) * DEG2RAD;
        const dx = Math.sin(az);
        const dz = -Math.cos(az);
        let maxEl = -Math.PI / 2;
        for (let d = 3; d < CLIPMAP_REACH_M; d *= 1.08) {
          const sx = x + dx * d;
          const sz = z + dz * d;
          const h = d < 400 ? heightAt(sx, sz) : coarseHeight(sx, sz);
          const el = Math.atan2(h - y0, d);
          if (el > maxEl) maxEl = el;
        }
        profile[i] = maxEl * RAD2DEG;
      }
      return profile;
    },

    setQuality(q: QualityProfile): void {
      const changedGrid = !quality || quality.terrainGrid !== q.terrainGrid;
      const changedShadow = !quality || quality.shadowMapSize !== q.shadowMapSize;
      quality = q;
      if (changedGrid) configureClipmap(q.terrainGrid);
      if (changedShadow) buildShadowTargets(q.shadowMapSize);
      rockLimit = Math.min(MAX_ROCKS, q.rocks);
      lastRockCentre.set(1e9, 1e9);
    },

    setWorld(world: WorldId): void {
      activeWorld = world;
      const gas = world === 'jupiter' || world === 'saturn' || world === 'uranus' || world === 'neptune';
      centreMesh.visible = !gas;
      ringMesh.visible = !gas;
      rocks.visible = !gas;
      cloudDeck.visible = gas;
      horizonGlow.visible = gas;
      if (gas) {
        const look = CLOUD_LOOK[world];
        cloudUniforms.uBelt.value.setHex(look.belt);
        cloudUniforms.uZone.value.setHex(look.zone);
        cloudUniforms.uStorm.value.setHex(look.storm);
        cloudUniforms.uHaze.value.setHex(look.haze);
        cloudUniforms.uRelief.value = look.relief;
      }
      if (world === 'mercury') {
        surfaceUniforms.uAlbedo.value = 0.13;
        surfaceUniforms.uTint.value.set(0.92, 0.88, 0.83);
      } else if (world === 'venus') {
        surfaceUniforms.uAlbedo.value = 0.19;
        surfaceUniforms.uTint.value.set(1.12, 0.84, 0.48);
      } else if (world === 'mars') {
        surfaceUniforms.uAlbedo.value = 0.21;
        surfaceUniforms.uTint.value.set(1.22, 0.70, 0.45);
      } else if (world === 'earth') {
        surfaceUniforms.uAlbedo.value = 0.25;
        surfaceUniforms.uTint.value.set(0.62, 0.74, 0.54);
      } else {
        surfaceUniforms.uAlbedo.value = albedo;
        surfaceUniforms.uTint.value.copy(siteTint);
      }
    },

    dispose(): void {
      centreGeo.dispose();
      ringGeo.dispose();
      rockGeo.dispose();
      cloudDeckGeo.dispose();
      cloudMat.dispose();
      horizonGlowGeo.dispose();
      horizonGlowMat.dispose();
      for (const m of [terrainMat, terrainDepthMat, casterDepthMat, rockMat]) m.dispose();
      for (const t of shadowTargets) t.dispose();
      for (const u of [fieldUniforms.uNearH, fieldUniforms.uWideH, terrainMat.uniforms.uWideG, terrainMat.uniforms.uNearG]) {
        (u.value as THREE.Texture).dispose();
      }
      twins.clear();
    },
  };

  return api;
}
