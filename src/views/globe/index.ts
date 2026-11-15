/**
 * Interactive 3D Globe View for:
 *   - Moon landing-site map picker (click any crater/ridge or preset site marker to land)
 *   - Title/menu rotating Moon backdrop
 *   - Close-ups of the Moon and the planets from their real maps: Mars (with the 2018 global dust storm,
 *     rover markers and a 3D model showcase), Earth (with the Moon's shadow during a solar eclipse), Mercury,
 *     Jupiter, Saturn with its rings (their shadow on the globe and the globe's on them), Uranus and Neptune.
 *     Venus has no map of its cloud tops here and shows a modelled cloud deck.
 *
 * Uses a single analytical spherical coordinate convention across the fragment shader, marker pins,
 * and raycast click-picking so features and coordinates match to the pixel:
 *   pos = R * (cos(lat)*cos(lon), sin(lat), -cos(lat)*sin(lon))
 *   lat = asin(pos.y / R),  lon = atan2(-pos.z, pos.x)
 *   u   = fract((lon + PI) / (2*PI)),  v = 0.5 + lat / PI
 */
import * as THREE from 'three';
import type {
  GlobeMarker, ISpaceView, Lang, QualityProfile, SiteCoord, SpaceViewOptions,
} from '../../core/types';
import { hasAsset, texUrl } from '../../core/assets';
import { loc } from '../../core/l10n';
import { fitModelToHeight, loadGlb } from '../../core/gltf';
import { calendarUTFromJdTT } from '../../core/time';
import { bodyOrientation, computeSky } from '../../astro';
import { cityLightsFor, earthImageryFor, marsDustState } from '../../content';
import { SATURN_RING_GLSL, SATURN_RING_INNER, SATURN_RING_OUTER } from '../rings';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const GLOBE_RADIUS = 10;
/** How long the date must stay with another picture of Earth before it is loaded: a date being dragged across
 * the months, or a fast clock, does not load one picture after another. */
const EARTH_PICTURE_SETTLE_SEC = 0.4;
/** How long to wait before asking again for a picture of Earth that failed to load. */
const EARTH_PICTURE_RETRY_SEC = 5;
/** The camera's vertical field of view, and the tangent of half of it. */
const FOV_DEG = 42;
const TAN_HALF_FOV = Math.tan((FOV_DEG / 2) * DEG2RAD);
/** Heights of the HUD's top bar and time bar, CSS pixels: a close-up keeps its subject clear of both. */
const TOP_BAR_PX = 56;
const BOTTOM_BAR_PX = 68;
/** The share of the free part of the window that a close-up's subject fills. */
const FIT_FILL = 0.95;
/** The picker shows the Moon larger than a close-up does, from this distance, and lets the wheel go this far. */
const PICKER_DIST = 26;
const PICKER_FARTHEST = 62;
/** How many times the distance it opens at the wheel may take a close-up away. */
const FARTHEST_FACTOR = 1.8;
/** The wheel never brings the camera nearer to the globe's centre than this, however fine the map. */
const NEAREST_DIST = 13.5;
/** The most CSS pixels one pixel of the map may cover in the middle of the globe: nearer than that the map
 * shows blur and blocks, not detail. */
const MAX_TEXEL_PX = 4;
/**
 * Maps that hold less detail than their file has pixels across, with the width their detail amounts to. The
 * Hubble maps of Jupiter and Saturn are enlarged (reduced to these widths they lose about 3% of their
 * contrast); Neptune's 720-pixel map is itself built of square blocks, about 208 across its width.
 */
const MAP_DETAIL_PX: Partial<Record<string, number>> = { jupiter: 1400, saturn: 1000, neptune: 208 };
/** Outer edge of Uranus's ε ring as drawn, planet radii. */
const URANUS_RING_OUTER = 2.06;
/** Outer radius of the rings of the planets shown with them, planet radii. */
const RING_OUTER: Partial<Record<string, number>> = { saturn: SATURN_RING_OUTER, uranus: URANUS_RING_OUTER };
/** A clock running faster than this many times real time is a time-lapse; a jump of the date counts as one too. */
const FAST_CLOCK_RATE = 3000;
/** How long the clock must run slowly again before a close-up turns to the day side: a date being dragged or
 * stepped does not swing the globe at every step. */
const CLOCK_SETTLE_SEC = 0.3;
/** How far east of the Sun's meridian the camera of a close-up stands: most of the disc is in daylight, and
 * the terminator with its long shadows is in view. */
const DAY_SIDE_LEAD_RAD = 0.6;
/** Radius of a marker's pin and of the outer edge of the selection ring, scene units. */
const PIN_RADIUS = 0.19;
const SEL_RING_OUTER = 0.46;
/** Room kept between a label and its own pin or ring (scene units), and round everything else it must not
 * touch (CSS pixels). */
const LABEL_GAP = 0.1;
const LABEL_PAD_PX = 3;
/** Pixels of a label's picture per scene unit at scale 1. */
const LABEL_PX_PER_UNIT = 160;
/** Where a label may sit round its pin, in order of preference: above, below, right, left. */
const LABEL_SLOTS: readonly (readonly [number, number])[] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
/** The showcased model floats this far in front of the camera, nearer than the globe ever comes. */
const SHOWCASE_DEPTH = 2;
/** Room between the showcased model and the window's edge, the time bar and the globe, CSS pixels. */
const SHOWCASE_MARGIN_PX = 12;
/** The least and the most the showcased model's half size may be, CSS pixels. */
const SHOWCASE_MIN_PX = 56;
const SHOWCASE_MAX_PX = 180;

/** A rectangle on the screen: centre and half size, CSS pixels from the middle of the window, y upwards. */
interface ScreenBox {
  x: number;
  y: number;
  hw: number;
  hh: number;
}

/** True when two rectangles come nearer to each other than `pad` pixels. */
function boxesOverlap(a: ScreenBox, b: ScreenBox, pad: number): boolean {
  return Math.abs(a.x - b.x) < a.hw + b.hw + pad && Math.abs(a.y - b.y) < a.hh + b.hh + pad;
}

/** The globe view, with what the engine tells it beyond the common close-up view. */
export interface GlobeController extends ISpaceView {
  /** Rewrites the marker labels in another language; called when the language changes while the view is open. */
  setLang(lang: Lang): void;
}

function latLonToLocalVec(latDeg: number, lonDeg: number, radius = GLOBE_RADIUS): THREE.Vector3 {
  const phi = latDeg * DEG2RAD;
  const lam = lonDeg * DEG2RAD;
  const cp = Math.cos(phi);
  return new THREE.Vector3(
    radius * cp * Math.cos(lam),
    radius * Math.sin(phi),
    -radius * cp * Math.sin(lam),
  );
}

function localVecToLatLon(p: THREE.Vector3): SiteCoord {
  const u = p.clone().normalize();
  const latDeg = Math.asin(Math.max(-1, Math.min(1, u.y))) * RAD2DEG;
  const lonDeg = Math.atan2(-u.z, u.x) * RAD2DEG;
  return { latDeg, lonDeg };
}

/** Draws a marker's label. The picture is no larger than the label's box, so the sprite's size is the label's. */
function makeMarkerLabelTexture(text: string, colorHex: string, dimmed: boolean): THREE.CanvasTexture {
  const font = '600 28px "Exo 2 Variable", system-ui, sans-serif';
  const canvas = document.createElement('canvas');
  const c = canvas.getContext('2d')!;
  c.font = font;
  const boxW = Math.min(496, Math.max(120, Math.ceil(c.measureText(text).width) + 44));
  // Sizing the canvas clears its settings, the font among them.
  canvas.width = boxW + 6;
  canvas.height = 62;
  c.font = font;

  c.fillStyle = dimmed ? 'rgba(8, 12, 20, 0.65)' : 'rgba(8, 14, 24, 0.86)';
  c.strokeStyle = dimmed ? 'rgba(142, 163, 189, 0.4)' : colorHex;
  c.lineWidth = 3;
  c.beginPath();
  c.roundRect(3, 3, boxW, 56, 14);
  c.fill();
  c.stroke();

  c.fillStyle = dimmed ? '#94a3b8' : '#f1f5f9';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, canvas.width / 2, 32, boxW - 24);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export function createGlobeView(_renderer: THREE.WebGLRenderer): GlobeController {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV_DEG, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 2000);
  const texLoader = new THREE.TextureLoader();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  /** Most recently used last. 8K maps are ~170 MB of GPU memory each, so only a few stay resident. */
  const textureCache = new Map<string, Promise<THREE.Texture<HTMLImageElement>>>();
  const MAX_CACHED_TEXTURES = 5;

  function cachedTexture(url: string, srgb: boolean): Promise<THREE.Texture<HTMLImageElement>> {
    let pending = textureCache.get(url);
    if (pending) {
      textureCache.delete(url);
    } else {
      pending = texLoader.loadAsync(url).then((t) => {
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        return t;
      });
      pending.catch(() => textureCache.delete(url));
    }
    textureCache.set(url, pending);
    while (textureCache.size > MAX_CACHED_TEXTURES) {
      const [oldUrl, oldTex] = textureCache.entries().next().value as [string, Promise<THREE.Texture>];
      textureCache.delete(oldUrl);
      oldTex.then((t) => {
        const inUse = [globeUniforms.uMap.value, globeUniforms.uRelief.value, globeUniforms.uNight.value, bgDomeMat.map];
        if (!inUse.includes(t)) t.dispose();
      }).catch(() => undefined);
    }
    return pending;
  }

  // Background star dome
  const bgDomeMat = new THREE.MeshBasicMaterial({
    color: 0x2a3344,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const bgDome = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 20), bgDomeMat);
  scene.add(bgDome);

  // Main globe mesh + shader
  const globeUniforms = {
    uMap: { value: new THREE.Texture() },
    uHasMap: { value: 0.0 },
    uTargetKind: { value: 0.0 }, // 0=moon, 1=mars, 2=earth, 3=jupiter, 4=saturn
    uSunDir: { value: new THREE.Vector3(1, 0.2, 0.3).normalize() },
    uAmbient: { value: 0.22 },
    uShowGrid: { value: 0.0 },
    uDustStorm: { value: 0.0 },
    /** Storm origin (unit vector, globe local) and angular radius of the dusty region, radians. */
    uDustOrigin: { value: new THREE.Vector3(0, 1, 0) },
    uDustRadius: { value: 0.0 },
    uTime: { value: 0.0 },
    uSunPosEfKm: { value: new THREE.Vector3(149_597_870, 0, 0) },
    uMoonPosEfKm: { value: new THREE.Vector3(384_400, 0, 0) },
    /** Tangent-space normal map (x east, y north) from LOLA, for the Moon. */
    uRelief: { value: new THREE.Texture() },
    uHasRelief: { value: 0.0 },
    /** City lights for Earth's night side, and their strength for the shown year. */
    uNight: { value: new THREE.Texture() },
    uCity: { value: 0.0 },
    /** The smallest step of the map's u that holds detail of its own; 0 when the file's pixels do. */
    uMapGrain: { value: 0.0 },
  };

  const globeMat = new THREE.ShaderMaterial({
    uniforms: globeUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vLocalPos;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      void main() {
        vLocalPos = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uHasMap;
      uniform float uTargetKind;
      uniform vec3 uSunDir;
      uniform float uAmbient;
      uniform float uShowGrid;
      ${SATURN_RING_GLSL}
      uniform float uDustStorm;
      uniform vec3 uDustOrigin;
      uniform float uDustRadius;
      uniform float uTime;
      uniform vec3 uSunPosEfKm;
      uniform vec3 uMoonPosEfKm;
      uniform sampler2D uRelief;
      uniform float uHasRelief;
      uniform sampler2D uNight;
      uniform float uCity;
      uniform float uMapGrain;

      varying vec3 vLocalPos;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;

      const float PI = 3.141592653589793;

      vec3 srgbToLinear(vec3 c) {
        return pow(max(c, vec3(0.0)), vec3(2.2));
      }

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      // Value noise that repeats after a whole number of cells in x: laid along the longitude, with that many
      // cells round the globe, it has no seam on the 180° meridian.
      float vnoise(vec2 p, float cellsRound) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float x0 = mod(i.x, cellsRound);
        float x1 = mod(i.x + 1.0, cellsRound);
        return mix(
          mix(hash21(vec2(x0, i.y)), hash21(vec2(x1, i.y)), u.x),
          mix(hash21(vec2(x0, i.y + 1.0)), hash21(vec2(x1, i.y + 1.0)), u.x),
          u.y
        );
      }
      float h3(vec3 p) {
        p = fract(p * vec3(443.897, 441.423, 437.195));
        p += dot(p, p.yzx + 19.19);
        return fract((p.x + p.y) * p.z);
      }
      float n3(vec3 p) {
        vec3 i = floor(p); vec3 f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(h3(i), h3(i + vec3(1,0,0)), u.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), u.x), u.y),
          mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), u.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), u.x), u.y),
          u.z
        );
      }
      float fbm3(vec3 p) {
        float s = 0.0; float a = 0.5;
        for (int k = 0; k < 5; k++) { s += a * n3(p); p *= 2.07; a *= 0.5; }
        return s;
      }
      float discOverlap(float r1, float r2, float d) {
        if (d >= r1 + r2) return 0.0;
        if (d <= abs(r1 - r2)) {
          float rm = min(r1, r2);
          return clamp((rm * rm) / max(1e-7, r1 * r1), 0.0, 1.0);
        }
        float r1Sq = r1 * r1;
        float r2Sq = r2 * r2;
        float a = acos(clamp((d * d + r1Sq - r2Sq) / (2.0 * d * r1), -1.0, 1.0));
        float b = acos(clamp((d * d + r2Sq - r1Sq) / (2.0 * d * r2), -1.0, 1.0));
        float area = r1Sq * a + r2Sq * b
          - 0.5 * sqrt(max(0.0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
        return clamp(area / (PI * r1Sq), 0.0, 1.0);
      }

      void main() {
        vec3 n = normalize(vLocalPos);
        float lat = asin(clamp(n.y, -1.0, 1.0));
        float lon = atan(-n.z, n.x);
        vec2 uv = vec2(fract((lon + PI) / (2.0 * PI)), 0.5 + lat / PI);
        // The maps are read with the slope of the longitude itself, which runs smoothly round the globe. The
        // slope of uv.x jumps on the 180° meridian, and would pick the coarsest copy of a map along it.
        vec3 nDx = dFdx(n);
        vec3 nDy = dFdy(n);
        float lonSlope = 1.0 / (2.0 * PI * max(dot(n.xz, n.xz), 1e-6));
        vec2 uvDx = vec2((n.z * nDx.x - n.x * nDx.z) * lonSlope, dFdx(uv.y));
        vec2 uvDy = vec2((n.z * nDy.x - n.x * nDy.z) * lonSlope, dFdy(uv.y));
        vec3 albedo = vec3(0.25);
        if (uHasMap > 0.5) {
          // sRGB textures are decoded to linear by the GPU. A map enlarged from a coarser picture is read no
          // finer than that picture, so that the edges of its blocks blend instead of showing as steps.
          float reach = max(length(vec2(uvDx.x, 0.5 * uvDx.y)), length(vec2(uvDy.x, 0.5 * uvDy.y)));
          float widen = max(1.0, uMapGrain / max(reach, 1e-7));
          albedo = textureGrad(uMap, uv, uvDx * widen, uvDy * widen).rgb;
        } else if (uTargetKind > 5.5 && uTargetKind < 6.5) {
          // Venus: creamy golden-ochre sulfuric-acid cloud chevrons
          float chev = sin(lat * 8.0 + abs(lat) * 2.2 + sin(lon * 2.0 - uTime * 0.12) * 0.8);
          float swirl = fbm3(n * 4.5 - vec3(uTime * 0.03, 0.0, 0.0));
          albedo = mix(vec3(0.68, 0.50, 0.24), vec3(0.94, 0.82, 0.54), 0.5 + 0.34 * chev + 0.22 * (swirl - 0.5));
        }
        // Earth's seas. On the map open water is nearly black and far bluer than land, ice or cloud, which
        // is how it is told from them. Seen from space the sunlit sea is a dark blue, with the light of the
        // sky on it: that light is a model added here, it is not in the map.
        float water = 0.0;
        if (uTargetKind > 1.5 && uTargetKind < 2.5 && uHasMap > 0.5) {
          water = smoothstep(0.42, 0.58, albedo.b / (albedo.r + albedo.g + albedo.b + 1e-4));
          albedo += vec3(0.007, 0.021, 0.050) * water;
        }
        // Mars 2018 dust storm: a veil spreading from Acidalia Planitia, with a brighter churning front.
        if (uTargetKind > 0.5 && uTargetKind < 1.5 && uDustStorm > 0.001) {
          float band = vnoise(vec2(lon * 16.0 / (2.0 * PI) + uTime * 0.05 + sin(lat * 4.0) * 0.8, lat * 9.0), 16.0);
          float eddy = vnoise(vec2(lon * 47.0 / (2.0 * PI) - uTime * 0.11, lat * 15.0), 47.0);
          float swirl = band * 0.62 + eddy * 0.38;
          float dist = acos(clamp(dot(n, uDustOrigin), -1.0, 1.0)) + (swirl - 0.5) * 0.32;
          float cover = 1.0 - smoothstep(uDustRadius - 0.35, uDustRadius + 0.08, dist);
          float front = smoothstep(uDustRadius - 0.40, uDustRadius - 0.05, dist) * cover;
          vec3 darkSand = vec3(0.48, 0.27, 0.13);
          vec3 brightDust = vec3(0.84, 0.56, 0.30);
          vec3 dustCol = mix(darkSand, brightDust, swirl) * (1.0 + 0.28 * front);
          albedo = mix(albedo, dustCol, clamp(uDustStorm * cover * (0.76 + 0.22 * swirl), 0.0, 0.96));
        }

        vec3 L = normalize(uSunDir);
        vec3 V = normalize(cameraPosition - vWorldPos);
        // Surface normal: the LOLA relief map on the Moon, the plain sphere elsewhere.
        vec3 N = n;
        if (uHasRelief > 0.5) {
          vec3 t = textureGrad(uRelief, uv, uvDx, uvDy).rgb * 2.0 - 1.0;
          // The map's relief is four times the Moon's, so its steepest walls would turn their backs on a
          // high Sun and show as black blots on sunlit ground: the tilt is held below 50°.
          vec2 slope = t.xy / max(t.z, 0.05);
          slope /= sqrt(1.0 + dot(slope, slope) / 1.44);
          vec3 east = vec3(-sin(lon), 0.0, -cos(lon));
          vec3 north = vec3(-sin(lat) * cos(lon), cos(lat), sin(lat) * sin(lon));
          N = normalize(east * slope.x + north * slope.y + n);
        }
        // The globe is not rotated, so local normals are world normals; V is in world space.
        float ndl = dot(n, L);
        // A slope that faces away from a Sun standing high over it still gets the light of the ground round
        // it: it is dim, not black. Near the terminator this light fades and shadows stay crisp.
        float mu0 = max(dot(N, L), 0.15 * max(ndl, 0.0));
        float mu = max(dot(N, V), 0.05);
        // Moon: Lommel–Seeliger (flat-looking full Moon, crisp relief at the terminator); others: soft Lambert.
        float diff = uTargetKind < 0.5
          ? 2.0 * mu0 / (mu0 + mu) * smoothstep(-0.02, 0.06, ndl)
          : smoothstep(-0.08, 0.88, ndl) * (0.6 + 0.4 * mu0 / max(ndl, 0.05));

        // Earth solar eclipse shadow
        float eclipseFactor = 1.0;
        if (uTargetKind > 1.5 && uTargetKind < 2.5) {
          // Convert globe local (x, y, z) to Earth-fixed (x, -z, y)
          vec3 nEf = vec3(n.x, -n.z, n.y);
          vec3 surfKm = nEf * 6371.0;
          vec3 toSun = uSunPosEfKm - surfKm;
          vec3 toMoon = uMoonPosEfKm - surfKm;
          float dSun = length(toSun);
          float dMoon = length(toMoon);
          float rSun = asin(695700.0 / dSun);
          float rMoon = asin(1737.4 / dMoon);
          float sep = acos(clamp(dot(toSun / dSun, toMoon / dMoon), -1.0, 1.0));
          float cov = discOverlap(rSun, rMoon, sep);
          eclipseFactor = 1.0 - smoothstep(0.0, 0.98, cov) * 0.92;
        }

        // Clamped: N·V a hair above 1 at the disc centre would make pow() return NaN (black squares after bloom).
        float rim = clamp(1.0 - dot(normalize(vWorldNormal), V), 0.0, 1.0);
        vec3 atmo = vec3(0.0);
        if (uTargetKind > 0.5 && uTargetKind < 1.5) {
          atmo = vec3(0.92, 0.48, 0.22) * pow(rim, 3.2) * 0.42 * smoothstep(-0.3, 0.3, ndl);
        } else if (uTargetKind > 1.5 && uTargetKind < 2.5) {
          vec3 sky = mix(vec3(0.24, 0.6, 1.0), vec3(1.0, 0.45, 0.2), 1.0 - smoothstep(-0.05, 0.3, ndl));
          atmo = sky * pow(rim, 3.0) * 0.7 * smoothstep(-0.3, 0.25, ndl);
        } else if (uTargetKind > 5.5 && uTargetKind < 6.5) {
          atmo = vec3(0.98, 0.78, 0.38) * pow(rim, 2.8) * 0.55 * smoothstep(-0.3, 0.3, ndl);
        } else if (uTargetKind > 6.5 && uTargetKind < 7.5) {
          atmo = vec3(0.45, 0.86, 0.90) * pow(rim, 3.0) * 0.50 * smoothstep(-0.3, 0.3, ndl);
        } else if (uTargetKind > 7.5) {
          atmo = vec3(0.26, 0.52, 0.98) * pow(rim, 3.0) * 0.55 * smoothstep(-0.3, 0.3, ndl);
        }
        vec3 gridCol = vec3(0.0);
        if (uShowGrid > 0.5) {
          float latDeg = lat * 180.0 / PI;
          float lonDeg = lon * 180.0 / PI;
          float gLat = abs(fract(latDeg / 30.0 + 0.5) - 0.5) * 30.0;
          float gLon = abs(fract(lonDeg / 30.0 + 0.5) - 0.5) * 30.0 * max(0.15, cos(lat));
          float line = 1.0 - smoothstep(0.15, 0.55, min(gLat, gLon));
          gridCol = vec3(0.25, 0.68, 0.95) * line * 0.16;
        }

        // Saturn: the shadow of the rings on the globe. The rings lie in the plane of the equator, so the
        // way from a point of the globe to the Sun crosses them at a known distance from the centre.
        float ringShade = 1.0;
        if (uTargetKind > 3.5 && uTargetKind < 4.5 && abs(L.y) > 1e-4) {
          float toPlane = -n.y / L.y;
          if (toPlane > 0.0) ringShade = 1.0 - 0.85 * saturnRing(length((n + toPlane * L).xz)).y;
        }
        // Picking needs the whole globe readable: a soft light from the viewer shows relief on the night side.
        // It gives way to the Sun's light smoothly (a plain max() leaves a crease along the terminator).
        float viewLight = uAmbient * (0.35 + 0.65 * max(dot(N, V), 0.0));
        float sunLight = diff * (uTargetKind < 2.5 ? 1.35 : 1.15) * eclipseFactor * ringShade;
        float lightTerm = 0.5 * (viewLight + sunLight + sqrt((viewLight - sunLight) * (viewLight - sunLight) + 0.0009));
        vec3 col = albedo * lightTerm + atmo + gridCol;
        if (uTargetKind > 1.5 && uTargetKind < 2.5) {
          // The Sun's glint on the sea: the light thrown back by waves tilted the right way, which grow
          // rarer the more tilt it takes (a bright core and a wide faint skirt). Then the city lights.
          vec3 H = normalize(L + V + vec3(0.0, 1e-5, 0.0));
          float nh = max(dot(n, H), 1e-3);
          float tilt2 = (1.0 - nh * nh) / (nh * nh);
          float glint = (0.42 * exp(-tilt2 / 0.009) + 0.07 * exp(-tilt2 / 0.06)) * smoothstep(0.0, 0.15, ndl);
          col += vec3(1.0, 0.95, 0.85) * glint * water * eclipseFactor;
          col += textureGrad(uNight, uv, uvDx, uvDy).rgb * vec3(1.0, 0.8, 0.55) * 0.7 * uCity * (1.0 - smoothstep(-0.12, 0.04, ndl));
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const globeMesh = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_RADIUS, 72, 54), globeMat);
  scene.add(globeMesh);

  // Saturn's rings, in the plane of the globe's equator.
  const saturnRingGeo = new THREE.RingGeometry(GLOBE_RADIUS * SATURN_RING_INNER, GLOBE_RADIUS * SATURN_RING_OUTER, 160, 1);
  saturnRingGeo.rotateX(Math.PI / 2);
  const ringVert = /* glsl */ `
    varying vec3 vPos;
    void main() {
      vPos = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const saturnRingMat = new THREE.ShaderMaterial({
    uniforms: { uSunDir: globeUniforms.uSunDir },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: ringVert,
    fragmentShader: /* glsl */ `
      ${SATURN_RING_GLSL}
      uniform vec3 uSunDir;
      varying vec3 vPos;
      void main() {
        vec2 ring = saturnRing(length(vPos.xz) / ${GLOBE_RADIUS.toFixed(1)});
        vec3 L = normalize(uSunDir);
        // The globe's shadow across the rings: where the way to the Sun passes through the globe.
        float towardSun = dot(vPos, L);
        float miss = length(vPos - towardSun * L) / ${GLOBE_RADIUS.toFixed(1)};
        float shadow = towardSun < 0.0 ? smoothstep(0.97, 1.03, miss) : 1.0;
        // From the side the Sun lights, the rings shine with what they scatter back; from the other side,
        // with what gets through them, which is most where they are thin.
        float sameSide = step(0.0, L.y * (cameraPosition.y - vPos.y));
        float face = mix((1.0 - ring.y) * 0.5 + 0.03, 1.0, sameSide);
        // A Sun low over the ring plane lights the rings less.
        float sunHeight = 0.4 + 0.6 * smoothstep(0.0, 0.3, abs(L.y));
        vec3 col = saturnRingColour(ring.x) * ring.x * face * sunHeight * (0.05 + 0.95 * shadow) * 1.15;
        gl_FragColor = vec4(col, ring.y);
      }
    `,
  });
  const saturnRing = new THREE.Mesh(saturnRingGeo, saturnRingMat);
  saturnRing.visible = false;
  scene.add(saturnRing);

  // Uranus's rings, also equatorial: narrow and dark. Radii in planet radii: 6, 5 and 4, α, β, η, γ, δ, and
  // the brightest and widest, ε. They are drawn wider and brighter than they are, or they would not show.
  const uranusRingGeo = new THREE.RingGeometry(GLOBE_RADIUS * 1.6, GLOBE_RADIUS * URANUS_RING_OUTER, 160, 1);
  uranusRingGeo.rotateX(Math.PI / 2);
  const uranusRingMat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: ringVert,
    fragmentShader: /* glsl */ `
      varying vec3 vPos;
      float ringlet(float r, float at, float width) {
        float d = (r - at) / width;
        return exp(-d * d);
      }
      void main() {
        float r = length(vPos.xz) / ${GLOBE_RADIUS.toFixed(1)};
        float thin = ringlet(r, 1.637, 0.004) + ringlet(r, 1.652, 0.004) + ringlet(r, 1.666, 0.004)
          + ringlet(r, 1.750, 0.005) + ringlet(r, 1.786, 0.005) + ringlet(r, 1.846, 0.004)
          + ringlet(r, 1.863, 0.005) + ringlet(r, 1.890, 0.005);
        float epsilon = ringlet(r, 2.001, 0.012);
        gl_FragColor = vec4(vec3(0.62, 0.66, 0.7), clamp(thin * 0.32 + epsilon * 0.6, 0.0, 1.0));
      }
    `,
  });
  const uranusRing = new THREE.Mesh(uranusRingGeo, uranusRingMat);
  uranusRing.visible = false;
  scene.add(uranusRing);

  // Selection reticle ring on the globe
  const selGroup = new THREE.Group();
  const selRingGeo = new THREE.RingGeometry(0.32, SEL_RING_OUTER, 32);
  const selRingMat = new THREE.MeshBasicMaterial({
    color: 0xffb454,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  const selRing = new THREE.Mesh(selRingGeo, selRingMat);
  const selDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 14, 14),
    new THREE.MeshBasicMaterial({ color: 0xffb454, depthTest: false }),
  );
  selGroup.add(selRing, selDot);
  selGroup.visible = false;
  scene.add(selGroup);

  // Markers container
  const markersGroup = new THREE.Group();
  scene.add(markersGroup);

  // The model of the selected marker's hardware, floating in the free lower right corner of the window.
  const showcaseGroup = new THREE.Group();
  const showcaseLight1 = new THREE.DirectionalLight(0xffffff, 2.6);
  showcaseLight1.position.set(5, 8, 6);
  const showcaseLight2 = new THREE.AmbientLight(0x8bb8ff, 0.75);
  scene.add(showcaseGroup, showcaseLight1, showcaseLight2);
  let showcaseModel: THREE.Object3D | null = null;
  /** Radius of the ball round the showcased model that it stays inside as it turns, in its group's units. */
  let showcaseRadius = 1;
  /** The square of the window the showcased model takes this frame. */
  const showcaseBox: ScreenBox = { x: 0, y: 0, hw: 0, hh: 0 };

  interface MarkerVisual {
    data: GlobeMarker;
    pin: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
    label: THREE.Sprite;
    surfaceNormal: THREE.Vector3;
    /** Size of the label at scale 1, scene units. */
    labelW: number;
    labelH: number;
    /** CSS pixels per scene unit at the pin's distance from the camera this frame. */
    pxPerUnit: number;
    /** Where the pin and the label are on the screen this frame. */
    pinBox: ScreenBox;
    labelBox: ScreenBox;
  }
  const markerVisuals: MarkerVisual[] = [];
  /** The markers in the order their labels are given room: the selected one, then the others as listed, greyed ones last. */
  const labelOrder: MarkerVisual[] = [];
  /** One sphere serves every marker pin. */
  const pinGeo = new THREE.SphereGeometry(PIN_RADIUS, 14, 14);
  /** Where the selection ring is on the screen this frame. */
  const ringBox: ScreenBox = { x: 0, y: 0, hw: 0, hh: 0 };
  /** True while a place is selected; the ring itself is hidden when that place is behind the globe. */
  let hasSelection = false;
  /** Scratch vectors of the frame loop. */
  const scratchA = new THREE.Vector3();
  const scratchB = new THREE.Vector3();
  const scratchC = new THREE.Vector3();

  let currentOpts: SpaceViewOptions | null = null;
  /** The language the marker labels are written in. */
  let labelLang: Lang = 'en';
  /** Counts the calls of enter(): a call that finds a newer one after waiting for a texture changes nothing more. */
  let enterSeq = 0;
  /** Earth's day picture on the globe, the one the date now asks for, and for how long it has asked. */
  let earthMapKey: string | null = null;
  let earthAskedKey: string | null = null;
  let earthAskedSec = 0;
  let earthMapLoading = false;
  /** True once Earth's night picture is on the globe: the strength of the city lights then follows the year. */
  let cityLightsReady = false;
  let camLonRad = 0.35;
  let camLatRad = 0.15;
  let targetLonRad = 0.35;
  let targetLatRad = 0.15;
  let camDist = 28;
  let targetDist = 28;
  /** The size of the canvas, CSS pixels. */
  let viewWidthPx = window.innerWidth;
  let viewHeightPx = Math.max(1, window.innerHeight);
  /** The distance and the latitude the view opens at, and the nearest and farthest the wheel may take it. */
  let homeDist = 28;
  let homeLatRad = 0.15;
  let nearest = NEAREST_DIST;
  let farthest = 62;
  /** True once the wheel has been used: a window that changes size then keeps the user's distance. */
  let zoomedByUser = false;
  /** Width of the map on the globe, pixels; 0 while there is none. */
  let mapWidthPx = 0;
  let attachedEl: HTMLElement | null = null;
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragMoved = 0;
  let selectedMarkerId: string | null = null;
  let lastJd = 0;
  /** 0 at real-time rates, 1 when the clock runs many rotations per second (time-lapse). */
  let fastness = 0;
  /** Longitude of the meridian under the true Sun, and whether the Sun stands north of the equator. */
  let sunLonRad = 0;
  let sunNorth = true;
  /** True from the clock running fast, or jumping, until it has run slowly for CLOCK_SETTLE_SEC. */
  let clockUnsettled = false;
  let calmSec = 0;
  /** The turn in longitude still owed to bring the day side in front of the camera; 0 when none is. */
  let aimLeftRad = 0;
  /** True once the user has chosen what to look at under the true Sun, by turning the globe or by going to a
   * place: the view then no longer turns itself to the day side. A turn made in a time-lapse does not count,
   * its light follows the camera and says nothing of day and night. */
  let aimedByUser = false;

  /**
   * The distance from which the whole subject fits the part of the window the bars leave free: the globe, and
   * for a ringed planet its rings as they open when seen from the given latitude.
   */
  function fitDistance(tid: string, latRad: number): number {
    // The subject stays in the middle of the window, so the taller bar counts above and below.
    const freeY = Math.max(0.25, 1 - (2 * Math.max(TOP_BAR_PX, BOTTOM_BAR_PX)) / viewHeightPx);
    const tanY = TAN_HALF_FOV * freeY * FIT_FILL;
    const tanX = TAN_HALF_FOV * camera.aspect * FIT_FILL;
    const tanGlobe = Math.min(tanX, tanY);
    let dist = GLOBE_RADIUS * Math.sqrt(1 + 1 / (tanGlobe * tanGlobe));
    const ringOuter = RING_OUTER[tid];
    if (ringOuter !== undefined) {
      // The rings reach farthest sideways a little in front of the planet, and farthest up or down at
      // their near edge, which the perspective enlarges.
      const r = GLOBE_RADIUS * ringOuter;
      const c = Math.cos(latRad);
      dist = Math.max(dist, r * Math.sqrt(1 / (tanX * tanX) + c * c), r * (Math.abs(Math.sin(latRad)) / tanY + c));
    }
    return dist;
  }

  /**
   * Sets the distance the view opens at and the limits of the wheel for the window and the map in use, and
   * moves the camera to the opening distance unless the user has chosen another.
   */
  function fitToWindow(): void {
    if (!currentOpts || currentOpts.mode === 'backdrop') return;
    const explore = currentOpts.mode === 'explore';
    homeDist = explore ? fitDistance(currentOpts.targetId, homeLatRad) : PICKER_DIST;
    farthest = explore ? homeDist * FARTHEST_FACTOR : PICKER_FARTHEST;
    const detailPx = Math.min(mapWidthPx, MAP_DETAIL_PX[currentOpts.targetId] ?? mapWidthPx);
    const texelDist = detailPx > 0
      ? GLOBE_RADIUS + ((2 * Math.PI * GLOBE_RADIUS) / detailPx) * (viewHeightPx / (2 * TAN_HALF_FOV)) / MAX_TEXEL_PX
      : 0;
    nearest = Math.min(homeDist, Math.max(NEAREST_DIST, texelDist));
    targetDist = zoomedByUser ? Math.max(nearest, Math.min(farthest, targetDist)) : homeDist;
  }

  function syncLightingFromAstro(jdTT: number): void {
    if (!currentOpts) return;
    const tid = currentOpts.targetId;
    if (tid === 'moon' || tid === 'mercury' || tid === 'venus' || tid === 'earth' || tid === 'mars' || tid === 'jupiter' || tid === 'saturn' || tid === 'uranus' || tid === 'neptune') {
      const ori = bodyOrientation(tid, jdTT);
      // Convert body-fixed (x=lon0, y=lon90E, z=north) to globe local (x=lon0, y=north, z=-lon90E)
      const sun = globeUniforms.uSunDir.value.set(ori.sunDirFixed[0], ori.sunDirFixed[2], -ori.sunDirFixed[1]).normalize();
      sunLonRad = Math.atan2(-sun.z, sun.x);
      sunNorth = sun.y >= 0;
      if (fastness > 0) {
        // In a time-lapse the true terminator would spin several times a second; light the side facing the
        // camera from the upper left instead, so the change being shown (e.g. dust spreading) stays readable.
        const steady = scratchA.copy(camera.position).normalize();
        const side = scratchB.set(0, 1, 0).cross(steady).normalize();
        steady.multiplyScalar(0.75).addScaledVector(side, -0.55);
        steady.y += 0.3;
        sun.lerp(steady.normalize(), fastness).normalize();
      }
    }
    if (tid === 'mars') {
      const dust = marsDustState(jdTT);
      globeUniforms.uDustStorm.value = dust.opacity;
      globeUniforms.uDustRadius.value = dust.radiusDeg * DEG2RAD;
      globeUniforms.uDustOrigin.value.copy(latLonToLocalVec(dust.originLatDeg, dust.originLonDeg, 1)).normalize();
    }
    if (tid === 'earth') {
      const sky = computeSky(jdTT, { latDeg: 0, lonDeg: 0 });
      globeUniforms.uSunPosEfKm.value.set(
        sky.sunPosEarthFixedKm[0],
        sky.sunPosEarthFixedKm[1],
        sky.sunPosEarthFixedKm[2],
      );
      globeUniforms.uMoonPosEfKm.value.set(
        sky.moonPosEarthFixedKm[0],
        sky.moonPosEarthFixedKm[1],
        sky.moonPosEarthFixedKm[2],
      );
    }
  }

  /** Takes the pins and labels off the globe and frees the materials and label pictures made for them. */
  function clearMarkers(): void {
    for (const mv of markerVisuals) {
      mv.pin.material.dispose();
      mv.label.material.map?.dispose();
      mv.label.material.dispose();
    }
    markersGroup.clear();
    markerVisuals.length = 0;
    labelOrder.length = 0;
  }

  function rebuildMarkers(markers: GlobeMarker[]): void {
    clearMarkers();
    if (!currentOpts) return;

    for (const m of markers) {
      const pos = latLonToLocalVec(m.latDeg, m.lonDeg, GLOBE_RADIUS * 1.008);
      const normal = pos.clone().normalize();
      const isSel = m.id === selectedMarkerId;
      const colHex = isSel ? '#ffb454' : (m.color ?? (m.dimmed ? '#64748b' : '#5fd4ff'));

      const pinMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(colHex),
        depthTest: true,
      });
      const pin = new THREE.Mesh(pinGeo, pinMat);
      pin.position.copy(pos);
      pin.userData = { markerId: m.id };
      markersGroup.add(pin);

      const tex = makeMarkerLabelTexture(loc(m.label, labelLang), colHex, Boolean(m.dimmed));
      const spriteMat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      // The label is given its place and size each frame (see layoutMarkers).
      const label = new THREE.Sprite(spriteMat);
      label.visible = false;
      label.userData = { markerId: m.id };
      markersGroup.add(label);

      markerVisuals.push({
        data: m,
        pin,
        label,
        surfaceNormal: normal,
        labelW: tex.image.width / LABEL_PX_PER_UNIT,
        labelH: tex.image.height / LABEL_PX_PER_UNIT,
        pxPerUnit: 0,
        pinBox: { x: 0, y: 0, hw: 0, hh: 0 },
        labelBox: { x: 0, y: 0, hw: 0, hh: 0 },
      });
    }
    for (const mv of markerVisuals) if (mv.data.id === selectedMarkerId) labelOrder.push(mv);
    for (const mv of markerVisuals) if (mv.data.id !== selectedMarkerId && !mv.data.dimmed) labelOrder.push(mv);
    for (const mv of markerVisuals) if (mv.data.id !== selectedMarkerId && mv.data.dimmed) labelOrder.push(mv);
  }

  /**
   * Shows the pins on the side of the globe that faces the camera and gives their labels places on the
   * screen. A label sits above its pin, or below or beside it when that place is taken; one that finds no
   * free place stays hidden until its marker is selected (the selected label is placed first). Labels keep
   * clear of each other, of other pins, of the selection ring and of the showcased model.
   */
  function layoutMarkers(): void {
    const focalPx = viewHeightPx / (2 * TAN_HALF_FOV);
    const labelScale = Math.max(0.45, Math.min(1.3, camDist / 26));
    const camRight = scratchA.setFromMatrixColumn(camera.matrixWorld, 0);
    const camUp = scratchB.setFromMatrixColumn(camera.matrixWorld, 1);

    // A point of the globe is in view when the camera is above the plane that touches the globe there.
    selGroup.visible = hasSelection && camera.position.dot(selGroup.position) > GLOBE_RADIUS * selGroup.position.length() * 1.02;
    if (selGroup.visible) {
      const p = scratchC.copy(selGroup.position).applyMatrix4(camera.matrixWorldInverse);
      const px = focalPx / -p.z;
      ringBox.x = p.x * px;
      ringBox.y = p.y * px;
      ringBox.hw = SEL_RING_OUTER * px;
      ringBox.hh = SEL_RING_OUTER * px;
      // The ring is drawn over everything, so it is not drawn where the model is.
      if (showcaseModel && boxesOverlap(ringBox, showcaseBox, 0)) selGroup.visible = false;
    }

    for (const mv of markerVisuals) {
      mv.pin.visible = camera.position.dot(mv.surfaceNormal) > GLOBE_RADIUS * 1.02;
      mv.label.visible = false;
      if (!mv.pin.visible) continue;
      const p = scratchC.copy(mv.pin.position).applyMatrix4(camera.matrixWorldInverse);
      mv.pxPerUnit = focalPx / -p.z;
      mv.pinBox.x = p.x * mv.pxPerUnit;
      mv.pinBox.y = p.y * mv.pxPerUnit;
      mv.pinBox.hw = PIN_RADIUS * mv.pxPerUnit;
      mv.pinBox.hh = PIN_RADIUS * mv.pxPerUnit;
    }

    for (const mv of labelOrder) {
      if (!mv.pin.visible) continue;
      const px = mv.pxPerUnit;
      const box = mv.labelBox;
      box.hw = (mv.labelW * labelScale * px) / 2;
      box.hh = (mv.labelH * labelScale * px) / 2;
      // The label of the pin inside the selection ring starts outside the ring.
      const ringed = selGroup.visible && mv.pin.position.distanceToSquared(selGroup.position) < SEL_RING_OUTER * SEL_RING_OUTER;
      const clear = ((ringed ? SEL_RING_OUTER : PIN_RADIUS) + LABEL_GAP) * px;
      for (const slot of LABEL_SLOTS) {
        box.x = mv.pinBox.x + slot[0] * (clear + box.hw);
        box.y = mv.pinBox.y + slot[1] * (clear + box.hh);
        let free = !(showcaseModel && boxesOverlap(box, showcaseBox, LABEL_PAD_PX))
          && !(selGroup.visible && !ringed && boxesOverlap(box, ringBox, LABEL_PAD_PX));
        for (let i = 0; free && i < markerVisuals.length; i++) {
          const other = markerVisuals[i];
          if (other === mv || !other.pin.visible) continue;
          free = !boxesOverlap(box, other.pinBox, LABEL_PAD_PX) && !(other.label.visible && boxesOverlap(box, other.labelBox, LABEL_PAD_PX));
        }
        if (!free) continue;
        mv.label.visible = true;
        mv.label.scale.set(mv.labelW * labelScale, mv.labelH * labelScale, 1);
        mv.label.position.copy(mv.pin.position)
          .addScaledVector(camRight, (box.x - mv.pinBox.x) / px)
          .addScaledVector(camUp, (box.y - mv.pinBox.y) / px);
        break;
      }
    }
  }

  /**
   * Puts the showcased model in the lower right corner of the window, as large as the corner left free by the
   * time bar, the top bar and the globe at its opening distance allows, and turns it.
   */
  function placeShowcase(dt: number): void {
    if (!showcaseModel) return;
    const focalPx = viewHeightPx / (2 * TAN_HALF_FOV);
    // The corner the model's square is pushed into, and the globe's radius on the screen with room round it.
    const cornerX = viewWidthPx / 2 - SHOWCASE_MARGIN_PX;
    const cornerY = viewHeightPx / 2 - BOTTOM_BAR_PX - SHOWCASE_MARGIN_PX;
    const globePx = (focalPx * GLOBE_RADIUS) / Math.sqrt(homeDist * homeDist - GLOBE_RADIUS * GLOBE_RADIUS) + SHOWCASE_MARGIN_PX;
    // The largest circle that touches both sides of the corner and the globe's disc.
    const reach = cornerX + cornerY + globePx;
    const freePx = reach - Math.sqrt(reach * reach - (cornerX * cornerX + cornerY * cornerY - globePx * globePx));
    const betweenBarsPx = (viewHeightPx - TOP_BAR_PX - BOTTOM_BAR_PX) / 2 - SHOWCASE_MARGIN_PX;
    const halfPx = Math.max(SHOWCASE_MIN_PX, Math.min(SHOWCASE_MAX_PX, betweenBarsPx, freePx));
    showcaseBox.x = cornerX - halfPx;
    showcaseBox.y = halfPx - cornerY;
    showcaseBox.hw = halfPx;
    showcaseBox.hh = halfPx;

    const unitsPerPx = SHOWCASE_DEPTH / focalPx;
    showcaseGroup.position.copy(camera.position)
      .addScaledVector(scratchA.setFromMatrixColumn(camera.matrixWorld, 2), -SHOWCASE_DEPTH)
      .addScaledVector(scratchA.setFromMatrixColumn(camera.matrixWorld, 0), showcaseBox.x * unitsPerPx)
      .addScaledVector(scratchA.setFromMatrixColumn(camera.matrixWorld, 1), showcaseBox.y * unitsPerPx);
    // Away from the middle of the picture a ball is drawn stretched; the model is made smaller by as much.
    const offAxis = focalPx / Math.hypot(focalPx, showcaseBox.x, showcaseBox.y);
    showcaseGroup.scale.setScalar((halfPx * unitsPerPx * offAxis) / showcaseRadius);
    showcaseModel.rotation.y += dt * 0.55;
  }

  /** Counts the changes of the showcased model: one that finishes loading for an older choice is dropped. */
  let showcaseSeq = 0;
  async function updateShowcaseForSelectedMarker(): Promise<void> {
    showcaseSeq += 1;
    const seq = showcaseSeq;
    showcaseGroup.clear();
    // The model is a clone with materials of its own; its geometry and textures belong to the model cache.
    showcaseModel?.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const own: THREE.Material[] = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of own) m.dispose();
    });
    showcaseModel = null;
    if (!selectedMarkerId) return;
    const mv = markerVisuals.find((v) => v.data.id === selectedMarkerId);
    const modelFile = mv?.data.modelFile;
    if (!modelFile || !hasAsset(`models/${modelFile}`)) return;
    try {
      const glb = await loadGlb(modelFile);
      if (seq !== showcaseSeq) return;
      // The model turns about the middle of its box, which is put at the group's origin; its size on the
      // screen is set each frame (see placeShowcase).
      fitModelToHeight(glb, 1);
      const size = new THREE.Box3().setFromObject(glb).getSize(new THREE.Vector3());
      glb.position.y -= size.y / 2;
      showcaseRadius = size.length() / 2;
      showcaseGroup.add(glb);
      showcaseModel = glb;
    } catch {
      // Ignore model load error
    }
  }

  /**
   * Keeps Earth's picture and the strength of its city lights with the date shown. One picture is loaded at a
   * time, and one that arrives after the date has moved on to another is not put on the globe.
   */
  function followEarthDate(dt: number, jdTT: number, quality: QualityProfile): void {
    if (cityLightsReady) globeUniforms.uCity.value = cityLightsFor(calendarUTFromJdTT(jdTT).year);
    const key = earthImageryFor(jdTT).texName;
    if (key !== earthAskedKey) {
      earthAskedKey = key;
      earthAskedSec = 0;
    }
    if (key === earthMapKey || earthMapLoading) return;
    earthAskedSec += dt;
    if (earthAskedSec < EARTH_PICTURE_SETTLE_SEC) return;
    const url = texUrl(key, quality) ?? texUrl('earth_day', quality);
    if (!url) return;
    earthMapLoading = true;
    const seq = enterSeq;
    cachedTexture(url, true).then((tex) => {
      if (seq !== enterSeq) return;
      earthMapLoading = false;
      if (key !== earthAskedKey) return;
      globeUniforms.uMap.value = tex;
      globeUniforms.uHasMap.value = 1.0;
      mapWidthPx = tex.image.width;
      fitToWindow();
      earthMapKey = key;
    }, () => {
      if (seq !== enterSeq) return;
      earthMapLoading = false;
      earthAskedSec = -EARTH_PICTURE_RETRY_SEC;
    });
  }

  // On a touch screen the first finger turns the globe and taps; a second one only zooms (see core/pinch).
  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || !e.isPrimary || currentOpts?.mode === 'backdrop') return;
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragMoved = 0;
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging || !e.isPrimary) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragMoved += Math.hypot(dx, dy);

    const sens = 0.0045 * (camDist / 28);
    targetLonRad -= dx * sens;
    targetLatRad = Math.max(-1.48, Math.min(1.48, targetLatRad + dy * sens));
    // A press that hardly moves is a click (see onPointerUp), not a turn of the globe.
    if (dragMoved <= (e.pointerType === 'touch' ? 12 : 6)) return;
    aimLeftRad = 0;
    if (fastness < 0.5) aimedByUser = true;
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragging || !e.isPrimary) return;
    dragging = false;
    // A press that hardly moved is a click; a finger is less steady than a mouse. A gesture the browser
    // took over (pointercancel) is never one.
    const slop = e.pointerType === 'touch' ? 12 : 6;
    if (e.type !== 'pointerup' || dragMoved > slop || !attachedEl || !currentOpts) return;

    const rect = attachedEl.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);

    // 1. Check marker pins/labels first
    const visibleMarkerObjs: THREE.Object3D[] = [];
    for (const mv of markerVisuals) {
      if (mv.pin.visible) visibleMarkerObjs.push(mv.pin);
      if (mv.label.visible) visibleMarkerObjs.push(mv.label);
    }
    const markerHits = raycaster.intersectObjects(visibleMarkerObjs, false);
    if (markerHits.length > 0) {
      const hitId = markerHits[0].object.userData?.markerId as string | undefined;
      if (hitId) {
        currentOpts.onMarker?.(hitId);
        return;
      }
    }

    // 2. In picker mode, clicking the globe picks (latDeg, lonDeg)
    if (currentOpts.mode === 'picker') {
      const hits = raycaster.intersectObject(globeMesh, false);
      if (hits.length > 0) {
        const pt = hits[0].point;
        const coord = localVecToLatLon(pt);
        currentOpts.onPick?.(coord.latDeg, coord.lonDeg);
      }
    }
  }

  function onWheel(e: WheelEvent): void {
    if (currentOpts?.mode === 'backdrop') return;
    e.preventDefault();
    targetDist = Math.max(nearest, Math.min(farthest, targetDist * (1 + e.deltaY * 0.001)));
    zoomedByUser = true;
  }

  return {
    scene,
    camera,

    async enter(opts: SpaceViewOptions): Promise<void> {
      enterSeq += 1;
      const seq = enterSeq;
      currentOpts = opts;
      labelLang = opts.lang;
      selectedMarkerId = null;
      lastJd = opts.jdTT;
      fastness = 0;
      clockUnsettled = false;
      calmSec = 0;
      aimLeftRad = 0;
      aimedByUser = false;
      mapWidthPx = 0;
      const mapDetailPx = MAP_DETAIL_PX[opts.targetId];
      globeUniforms.uMapGrain.value = mapDetailPx === undefined ? 0 : 1 / mapDetailPx;
      // The model of a marker chosen on the globe shown before does not follow into this one.
      updateShowcaseForSelectedMarker().catch(() => undefined);
      const tid = opts.targetId;

      globeUniforms.uTargetKind.value =
        tid === 'moon' ? 0
        : tid === 'mars' ? 1
        : tid === 'earth' ? 2
        : tid === 'jupiter' ? 3
        : tid === 'saturn' ? 4
        : tid === 'mercury' ? 5
        : tid === 'venus' ? 6
        : tid === 'uranus' ? 7
        : 8;
      // Outside the picker, the night side keeps just enough of the viewer's light to show that it is there
      // (a little more on the worlds that have places to find).
      globeUniforms.uAmbient.value = opts.mode === 'picker' ? 0.34 : tid === 'moon' ? 0.1 : tid === 'mars' || tid === 'earth' || tid === 'mercury' ? 0.06 : 0.035;
      globeUniforms.uShowGrid.value = opts.mode === 'picker' ? 1.0 : 0.0;
      globeUniforms.uDustStorm.value = 0;
      saturnRing.visible = tid === 'saturn';
      uranusRing.visible = tid === 'uranus';
      hasSelection = false;
      selGroup.visible = false;

      // Textures are cached: the menu, map and telescope views reopen the same 8K images often.
      const texKey = tid === 'earth' ? earthImageryFor(opts.jdTT).texName : `${tid}_color`;
      const url = texUrl(texKey, opts.quality) ?? (tid === 'earth' ? texUrl('earth_day', opts.quality) : null);
      globeUniforms.uHasMap.value = 0.0;
      earthMapKey = null;
      earthAskedKey = null;
      earthAskedSec = 0;
      cityLightsReady = false;
      // While this call waits for Earth's picture, update() does not ask for it too.
      earthMapLoading = tid === 'earth' && url !== null;
      if (url) {
        const tex = await cachedTexture(url, true).catch(() => null);
        // A newer call has taken the view over: nothing more is changed here.
        if (seq !== enterSeq) return;
        earthMapLoading = false;
        if (tex) {
          globeUniforms.uMap.value = tex;
          globeUniforms.uHasMap.value = 1.0;
          mapWidthPx = tex.image.width;
          if (tid === 'earth') earthMapKey = texKey;
        }
      }
      const reliefUrl = tid === 'moon' ? texUrl('moon_relief', opts.quality) : null;
      globeUniforms.uHasRelief.value = 0.0;
      if (reliefUrl) {
        cachedTexture(reliefUrl, false).then((t) => {
          if (seq !== enterSeq) return;
          globeUniforms.uRelief.value = t;
          globeUniforms.uHasRelief.value = 1.0;
        }).catch(() => undefined);
      }
      const nightUrl = tid === 'earth' ? texUrl('earth_night', opts.quality) : null;
      globeUniforms.uCity.value = 0.0;
      if (nightUrl) {
        cachedTexture(nightUrl, true).then((t) => {
          if (seq !== enterSeq) return;
          globeUniforms.uNight.value = t;
          globeUniforms.uCity.value = cityLightsFor(calendarUTFromJdTT(opts.jdTT).year);
          cityLightsReady = true;
        }).catch(() => undefined);
      }

      const starsUrl = texUrl('stars', opts.quality);
      if (starsUrl) {
        cachedTexture(starsUrl, true).then((st) => {
          if (seq !== enterSeq) return;
          bgDomeMat.map = st;
          bgDomeMat.color.setHex(0x55606f);
          bgDomeMat.needsUpdate = true;
        }).catch(() => undefined);
      }

      // The clock may have moved on while the map was loading.
      syncLightingFromAstro(lastJd);
      rebuildMarkers(opts.markers ?? []);

      // Initial camera framing + cinematic fly-in
      if (opts.mode === 'backdrop') {
        camDist = 27;
        targetDist = 27;
        camLatRad = 0.12;
        targetLatRad = 0.12;
      } else {
        // A close-up shows the whole subject (a ringed planet with its rings) in the part of the window the
        // bars leave free, from where most of it is in daylight and from the side of its equator that the
        // Sun lights (for a ringed planet, the bright face of the rings). The picker shows the globe larger,
        // from over the prime meridian.
        const sunSide = sunNorth ? 1 : -1;
        homeLatRad = tid === 'saturn' ? 0.34 * sunSide : tid === 'uranus' ? 0.5 * sunSide : 0.18;
        zoomedByUser = false;
        fitToWindow();
        camDist = targetDist * 1.6;
        targetLatRad = homeLatRad;
        camLatRad = targetLatRad + 0.04;
        targetLonRad = opts.mode === 'picker' ? 0.35 : sunLonRad + DAY_SIDE_LEAD_RAD;
        camLonRad = targetLonRad;
      }
    },

    update(dt: number, jdTT: number): void {
      if (!currentOpts) return;
      globeUniforms.uTime.value += dt;
      const rate = dt > 0 ? (Math.abs(jdTT - lastJd) * 86400) / dt : 0;
      lastJd = jdTT;
      const fast = rate > FAST_CLOCK_RATE;
      if (fast) {
        clockUnsettled = true;
        calmSec = 0;
      } else if (clockUnsettled) {
        calmSec += dt;
      }
      // A close-up turns itself only while the user leaves the globe alone.
      const selfAimed = currentOpts.mode === 'explore' && !dragging && !aimedByUser;
      // While the view waits to turn to the day side, and while it turns, the time-lapse's light stays on:
      // the turn is not made in the dark.
      const turning = (selfAimed && clockUnsettled && !fast) || Math.abs(aimLeftRad) > 0.1;
      const target = rate > 1e7 || turning ? fastness : Math.min(1, Math.max(0, (rate - FAST_CLOCK_RATE) / 30000));
      fastness += (target - fastness) * Math.min(1, dt * 3);
      syncLightingFromAstro(jdTT);
      if (clockUnsettled && calmSec >= CLOCK_SETTLE_SEC) {
        // A fast clock has slowed down, or the date has jumped: the Sun now lights another side of the globe,
        // and the camera goes there the shorter way round.
        clockUnsettled = false;
        const turn = sunLonRad + DAY_SIDE_LEAD_RAD - targetLonRad;
        if (selfAimed) aimLeftRad = turn - 2 * Math.PI * Math.round(turn / (2 * Math.PI));
      }
      if (aimLeftRad !== 0) {
        const step = Math.abs(aimLeftRad) < 0.002 ? aimLeftRad : aimLeftRad * Math.min(1, dt * 2);
        targetLonRad += step;
        aimLeftRad -= step;
      }
      if (currentOpts.targetId === 'earth') followEarthDate(dt, jdTT, currentOpts.quality);

      if (currentOpts.mode === 'backdrop') {
        targetLonRad += dt * 0.08;
      }

      const k = Math.min(1, dt * 7);
      camLonRad += (targetLonRad - camLonRad) * k;
      camLatRad += (targetLatRad - camLatRad) * k;
      camDist += (targetDist - camDist) * k;

      const cp = Math.cos(camLatRad);
      camera.position.set(
        camDist * cp * Math.cos(camLonRad),
        camDist * Math.sin(camLatRad),
        -camDist * cp * Math.sin(camLonRad),
      );

      if (currentOpts.mode === 'backdrop') {
        // Offset lookAt so the Moon sits gracefully on the right side behind the menu
        camera.lookAt(-5.5, 0.5, 0);
      } else {
        camera.lookAt(0, 0, 0);
      }
      camera.updateMatrixWorld();

      placeShowcase(dt);
      layoutMarkers();
    },

    setMarkers(markers: GlobeMarker[]): void {
      rebuildMarkers(markers);
    },

    setLang(lang: Lang): void {
      labelLang = lang;
      rebuildMarkers(markerVisuals.map((v) => v.data));
    },

    setSelection(sel: SiteCoord | null, flyTo = false): void {
      hasSelection = sel !== null;
      if (!sel) return;
      const pos = latLonToLocalVec(sel.latDeg, sel.lonDeg, GLOBE_RADIUS * 1.012);
      selGroup.position.copy(pos);
      selGroup.lookAt(pos.clone().multiplyScalar(2));

      if (flyTo) {
        targetLatRad = Math.max(-1.42, Math.min(1.42, sel.latDeg * DEG2RAD));
        targetLonRad = sel.lonDeg * DEG2RAD;
        aimLeftRad = 0;
        aimedByUser = true;
      }
    },

    setSelectedMarker(markerId: string | null): void {
      selectedMarkerId = markerId;
      if (currentOpts?.markers) {
        rebuildMarkers(currentOpts.markers);
      }
      const mv = markerVisuals.find((v) => v.data.id === markerId);
      if (mv) {
        this.setSelection({ latDeg: mv.data.latDeg, lonDeg: mv.data.lonDeg }, true);
      }
      updateShowcaseForSelectedMarker().catch(() => undefined);
    },

    attach(el: HTMLElement): void {
      if (attachedEl === el) return;
      this.detach();
      attachedEl = el;
      el.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
      el.addEventListener('wheel', onWheel, { passive: false });
    },

    detach(): void {
      if (!attachedEl) return;
      attachedEl.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      attachedEl.removeEventListener('wheel', onWheel);
      attachedEl = null;
      dragging = false;
    },

    resize(width: number, height: number): void {
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      viewWidthPx = width;
      viewHeightPx = Math.max(1, height);
      fitToWindow();
    },

    dispose(): void {
      this.detach();
      clearMarkers();
      pinGeo.dispose();
      globeMesh.geometry.dispose();
      globeMat.dispose();
      saturnRingGeo.dispose();
      saturnRingMat.dispose();
      uranusRingGeo.dispose();
      uranusRingMat.dispose();
      bgDome.geometry.dispose();
      bgDomeMat.dispose();
    },
  };
}
