/**
 * Galaxy close-up. Each galaxy is shown by a real picture (Hubble, GALEX, Spitzer, or a cut of the NASA star
 * map; sources and credits are in the asset manifest) and by a cloud of particles drawn from that picture's
 * own pixels and given depth:
 *   - a disc (M31, M33, M51, the Large Magellanic Cloud) lies in a plane tilted to the line of sight by the
 *     published inclination, about its published long axis and with its published near side towards the
 *     viewer (content/galaxies.ts), with a ball of particles for a bulge; the layer of particles follows a
 *     gentle relief, so that it has some depth of its own;
 *   - a ball (M87; the Sombrero's bulge and halo) has every particle set along the line of sight as a spheroid
 *     with the modified Hubble profile would have it;
 *   - a cloud (the Small Magellanic Cloud) is a thick layer with a stronger relief.
 * From the direction the view starts in, the particles line up into the picture, and the picture itself is
 * what is shown. Turned away from it only the particles remain. That turned view is a model: a picture holds
 * no depth, so where along the line of sight each bit of light is set follows the shapes above.
 */
import * as THREE from 'three';
import type { GalaxyDef, GalaxyPicture, ISpaceView, SpaceViewOptions } from '../../core/types';
import { assetUrl, hasAsset } from '../../core/assets';
import { frame } from '../../core/frame';

const DEG = Math.PI / 180;
/** Width of the picture, scene units. */
const PICTURE_WIDTH = 20;
/** Particles at the 'high' quality profile, and the most any profile gets. */
const PARTICLES = 170_000;
const MAX_PARTICLES = 260_000;
/** Pixels the picture is reduced to for the particles to be drawn from, whatever its shape. */
const SAMPLE_PIXELS = 720 * 540;
/** Radius of a particle in the bright parts of the picture, scene units. */
const PARTICLE_RADIUS = 0.05;
/**
 * Particles are spread as (light)^SPREAD and each carries (light)^(1 − SPREAD): together they add up to the
 * picture, with the faint parts less grainy than if every particle carried the same light.
 */
const SPREAD = 0.6;
const FOV_DEG = 10;
/** Angle from the picture's own direction at which the picture starts to give way to the particles, and is gone. */
const PICTURE_HOLDS_RAD = 2.5 * DEG;
const PICTURE_GONE_RAD = 12 * DEG;
/** Seconds the picture is held before the view starts to sway. */
const OPENING_HOLD_SEC = 3.5;
/** Seconds without input after which the view goes back to swaying by itself. */
const RESUME_SEC = 12;

/** The shape a galaxy's light is given depth by. Lengths are degrees on the sky, so that they hold for every picture of it. */
interface DepthModel {
  kind: 'disc' | 'ball' | 'cloud';
  /** disc: radius of the disc; what lies farther out stays out of the model. */
  reachDeg: number;
  /** disc: radius of the ball of particles that stands for the bulge (0: none). */
  bulgeDeg: number;
  /** disc, cloud: thickness of the layer of particles. */
  layerDeg: number;
  /** ball: short axis of the spheroid over its long one, as seen in the picture. */
  flattening: number;
  /** ball: radius of the bright core (see the depth of a ball below). */
  coreDeg: number;
  /** ball: dark ring of dust in the equatorial plane, inner and outer radius. */
  dustRingDeg: [number, number] | null;
  /** How far the view may be tipped up or down from the picture's own direction, degrees. */
  maxPitchDeg: number;
}

const DEPTH: Record<string, DepthModel> = {
  m31: { kind: 'disc', reachDeg: 1.75, bulgeDeg: 0.156, layerDeg: 0.02, flattening: 1, coreDeg: 0, dustRingDeg: null, maxPitchDeg: 80 },
  m33: { kind: 'disc', reachDeg: 0.5, bulgeDeg: 0.018, layerDeg: 0.0095, flattening: 1, coreDeg: 0, dustRingDeg: null, maxPitchDeg: 80 },
  // Wide enough to take in the companion, NGC 5195.
  m51: { kind: 'disc', reachDeg: 0.087, bulgeDeg: 0.0033, layerDeg: 0.0013, flattening: 1, coreDeg: 0, dustRingDeg: null, maxPitchDeg: 80 },
  lmc: { kind: 'disc', reachDeg: 3.67, bulgeDeg: 0, layerDeg: 0.18, flattening: 1, coreDeg: 0, dustRingDeg: null, maxPitchDeg: 80 },
  // The Sombrero's thin disc cannot be told from its bulge in the picture's light and ends up spread through
  // the ball's equatorial plane: the model is only good for looking at nearly edge-on, as the picture does.
  m104: { kind: 'ball', reachDeg: 0, bulgeDeg: 0, layerDeg: 0, flattening: 0.6, coreDeg: 0.0164, dustRingDeg: [0.0457, 0.0621], maxPitchDeg: 7 },
  m87: { kind: 'ball', reachDeg: 0, bulgeDeg: 0, layerDeg: 0, flattening: 0.9, coreDeg: 0.0017, dustRingDeg: null, maxPitchDeg: 80 },
  smc: { kind: 'cloud', reachDeg: 0, bulgeDeg: 0, layerDeg: 0.26, flattening: 1, coreDeg: 0, dustRingDeg: null, maxPitchDeg: 80 },
};

interface Companion {
  raDeg: number;
  decDeg: number;
  radiusDeg: number;
}

/**
 * Round galaxies that show beside a disc in its pictures. Each is kept together as a ball of its own, where
 * laying it into the tilted disc would draw it out into a streak. How far in front of the disc or behind it
 * a companion lies is not known: the ball is set level with the galaxy's centre.
 */
const COMPANIONS: Record<string, Companion[]> = {
  // M32
  m31: [{ raDeg: 10.6743, decDeg: 40.8652, radiusDeg: 0.07 }],
};

/**
 * Direction in the picture, radians anticlockwise from its right, of a direction on the sky given by its
 * position angle (degrees from north through east).
 */
function inPicture(positionAngleDeg: number, picture: GalaxyPicture): number {
  return (90 + positionAngleDeg - picture.northUpDeg) * DEG;
}

/** Half the side, in sampled pixels, of the box a pixel is compared with to tell a star from the galaxy's glow. */
const STAR_BOX = 5;
/** Side, in sampled pixels, of the cells within which a star's light is all set at one depth. */
const STAR_CELL = 12;
/** Width, in sampled pixels, of the hills of the relief a layer of particles follows. */
const RELIEF_CELL = 56;

/**
 * Share of the way from the picture's middle to its edge at which it starts to fade. A cut of the star map
 * is full of field stars to its very edge, and has to thin out over a longer way for no frame to show.
 */
function edgeStart(shot: GalaxyPicture): number {
  return shot.fromStarMap ? 0.5 : 0.8;
}

/** 0 at the picture's rounded edge, 1 inside it: `u`, `v` are shares of the picture's width and height. */
function insideEdge(u: number, v: number, from: number): number {
  const fromMiddle = (Math.abs(u * 2 - 1) ** 3 + Math.abs(v * 2 - 1) ** 3) ** (1 / 3);
  return 1 - THREE.MathUtils.smoothstep(fromMiddle, from, 1);
}

/**
 * Fills the particle buffers from the picture, so that the particles add up to the picture when each is
 * drawn as exp(−4 d²/radius²). Positions are in scene units about the picture's middle (x right, y up, z
 * towards the viewer of the picture).
 */
function drawParticles(
  image: HTMLImageElement, def: GalaxyDef, shot: GalaxyPicture, depth: DepthModel, count: number,
  position: Float32Array, tint: Float32Array, radius: Float32Array,
): void {
  const w = Math.round(Math.sqrt((SAMPLE_PIXELS * image.naturalWidth) / image.naturalHeight));
  const h = Math.max(1, Math.round((w * image.naturalHeight) / image.naturalWidth));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(image, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;

  const unit = PICTURE_WIDTH / w;
  const height = h * unit;
  const perDeg = PICTURE_WIDTH / shot.fieldDeg;
  // The galaxy's centre and long axis in the picture.
  const cx = (shot.centre[0] - 0.5) * PICTURE_WIDTH;
  const cy = -(shot.centre[1] - 0.5) * height;
  const axis = inPicture(def.majorAxisPaDeg, shot);
  const ax = Math.cos(axis);
  const ay = Math.sin(axis);
  const tilt = depth.kind === 'disc' ? def.tiltDeg * DEG : 0;
  // `across` below is counted towards the side a quarter turn anticlockwise of the long axis (position angle
  // majorAxisPaDeg + 90): +1 when that is the near side.
  const nearAcross = def.nearSidePaDeg !== null && Math.sin((def.nearSidePaDeg - def.majorAxisPaDeg) * DEG) < 0 ? -1 : 1;
  const core = depth.coreDeg * perDeg;
  const reach = depth.reachDeg * perDeg;
  const bulge = depth.bulgeDeg * perDeg;
  const layer = depth.layerDeg * perDeg;
  // The balls within a disc, about the galaxy's centre (x right, y up): its bulge, and its companions.
  const balls = (COMPANIONS[def.id] ?? []).map((c) => {
    const east = (c.raDeg - def.raDeg) * Math.cos(def.decDeg * DEG);
    const north = c.decDeg - def.decDeg;
    const towards = inPicture(Math.atan2(east, north) / DEG, shot);
    const far = Math.hypot(east, north) * perDeg;
    return { x: Math.cos(towards) * far, y: Math.sin(towards) * far, radius: c.radiusDeg * perDeg };
  });
  if (bulge > 0) balls.push({ x: 0, y: 0, radius: bulge });

  // How much of every pixel's light goes into the model, as a running total to draw from; and the light
  // itself as a summed-area table, which gives the mean light round any pixel.
  const running = new Float32Array(w * h);
  const table = new Float64Array((w + 1) * (h + 1));
  let total = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const o = (j * w + i) * 4;
      const light = (Math.max(px[o], px[o + 1], px[o + 2]) / 255) ** 2.2;
      table[(j + 1) * (w + 1) + i + 1] = light + table[j * (w + 1) + i + 1] + table[(j + 1) * (w + 1) + i] - table[j * (w + 1) + i];
      // The picture's own edge is not an edge of the galaxy.
      let keep = insideEdge((i + 0.5) / w, (j + 0.5) / h, edgeStart(shot));
      if (depth.kind === 'disc') {
        const x = (i + 0.5) * unit - PICTURE_WIDTH / 2 - cx;
        const y = height / 2 - (j + 0.5) * unit - cy;
        // Distance from the centre within the tilted disc.
        const inDisc = Math.hypot(x * ax + y * ay, (-x * ay + y * ax) / Math.cos(tilt));
        keep *= Math.max(1 - THREE.MathUtils.smoothstep(inDisc, reach * 0.85, reach * 1.15), 1 - THREE.MathUtils.smoothstep(Math.hypot(x, y), bulge * 1.5, bulge * 2.5));
      }
      total += keep * light ** SPREAD;
      running[j * w + i] = total;
    }
  }
  if (total <= 0) return;

  let seed = 7;
  for (const ch of def.id) seed = (seed * 33 + ch.charCodeAt(0)) >>> 0;
  const cornerSeed = seed;
  const rand = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Close to a normal deviate.
  const gauss = (): number => (rand() + rand() + rand() + rand() - 2) * 1.732;
  // One random number, −1…1, for every corner of a grid.
  const corner = (ix: number, iy: number): number => {
    let bits = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ cornerSeed;
    bits = Math.imul(bits ^ (bits >>> 13), 1274126177);
    return (((bits ^ (bits >>> 16)) >>> 0) / 4294967295) * 2 - 1;
  };
  // A smooth relief over the picture, −1…1, with hills `cell` pixels across.
  const relief = (pi: number, pj: number, cell: number): number => {
    const x0 = Math.floor(pi / cell);
    const y0 = Math.floor(pj / cell);
    const fx = pi / cell - x0;
    const fy = pj / cell - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const top = corner(x0, y0) + (corner(x0 + 1, y0) - corner(x0, y0)) * sx;
    const bottom = corner(x0, y0 + 1) + (corner(x0 + 1, y0 + 1) - corner(x0, y0 + 1)) * sx;
    return top + (bottom - top) * sy;
  };
  // Light of one particle of unit weight, for the particles to add up to the picture: a particle of radius R
  // drawn as exp(−4 d²/R²) covers π R²/4.
  const share = (total * unit * unit) / (count * Math.PI * (PARTICLE_RADIUS / 2) ** 2);

  for (let n = 0; n < count; n++) {
    const want = rand() * total;
    let lo = 0;
    let hi = w * h - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (running[mid] < want) lo = mid + 1;
      else hi = mid;
    }
    const i = lo % w;
    const j = (lo - i) / w;
    const r = (px[lo * 4] / 255) ** 2.2;
    const g = (px[lo * 4 + 1] / 255) ** 2.2;
    const b = (px[lo * 4 + 2] / 255) ** 2.2;
    const light = Math.max(r, g, b, 1e-5);
    const x = (i + rand()) * unit - PICTURE_WIDTH / 2;
    const y = height / 2 - (j + rand()) * unit;
    const gx = x - cx;
    const gy = y - cy;
    const along = gx * ax + gy * ay;
    const across = -gx * ay + gy * ax;
    // A star is a point: all of its light goes to one depth (one random number, −1…1, for the cell it is
    // in), where the galaxy's glow is spread through the depth particle by particle. Otherwise every star
    // would be drawn out into a streak along the line of sight.
    const i0 = Math.max(0, i - STAR_BOX);
    const i1 = Math.min(w, i + STAR_BOX + 1);
    const j0 = Math.max(0, j - STAR_BOX);
    const j1 = Math.min(h, j + STAR_BOX + 1);
    const around = (table[j1 * (w + 1) + i1] - table[j0 * (w + 1) + i1] - table[j1 * (w + 1) + i0] + table[j0 * (w + 1) + i0]) / ((i1 - i0) * (j1 - j0));
    const star = light > 2.5 * around + 0.01;
    const spot = star ? corner(Math.floor(i / STAR_CELL) + 7919, Math.floor(j / STAR_CELL)) : rand() * 2 - 1;
    // A layer follows a smooth relief: what is close together in the picture stays together in depth, so
    // the layer has depth without smearing the picture when the view turns. It is given some thickness; a
    // cloud more of it, or the folds of its strong relief would show as bright seams from the side.
    const lie = relief(i, j, RELIEF_CELL) + 0.4 * relief(i + 311, j + 173, RELIEF_CELL * 0.4);
    const scatter = star ? spot : gauss();
    let z = layer * (depth.kind === 'cloud' ? 0.6 * lie + 0.8 * scatter : 1.2 * lie + 0.45 * scatter);
    if (depth.kind === 'disc') {
      const ball = balls.find((s) => rand() < Math.exp(-((gx - s.x) ** 2 + (gy - s.y) ** 2) / (s.radius * s.radius)));
      z = ball ? gauss() * ball.radius * 0.6 : nearAcross * across * Math.tan(tilt) + z;
    } else if (depth.kind === 'ball') {
      // Along the line of sight through a spheroid with the modified Hubble profile, the classic model of an
      // elliptical galaxy or a bulge: density (1 + r²/core²)^(−3/2). At distance R from the centre in the
      // picture, the depth is then √(R² + core²)·tan θ with sin θ spread evenly. Blue light is not the
      // galaxy's stars but M87's jet, which stays where the picture shows it.
      const radial = Math.hypot(along, across / depth.flattening, core);
      z = b > r * 1.08 ? gauss() * 0.01 * PICTURE_WIDTH : radial * Math.tan(Math.asin(0.93 * spot));
    }
    // Faint parts are drawn with larger, fainter particles, so that they glow rather than speckle; and a
    // ball of old stars has no detail to keep, so all of its glow is.
    const grow = THREE.MathUtils.clamp((0.2 / light) ** 0.4, 1, 4) * (depth.kind === 'ball' && !star ? 2.6 : 1);
    const carry = (share * light ** (1 - SPREAD)) / (grow * grow) / light;
    position[n * 3] = x;
    position[n * 3 + 1] = y;
    position[n * 3 + 2] = z;
    tint[n * 3] = r * carry;
    tint[n * 3 + 1] = g * carry;
    tint[n * 3 + 2] = b * carry;
    radius[n] = PARTICLE_RADIUS * grow;
  }
}

export function createGalaxyView(renderer: THREE.WebGLRenderer): ISpaceView {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV_DEG, window.innerWidth / Math.max(1, window.innerHeight), 1, 2000);
  scene.add(camera);

  // Faint stars behind everything, fixed to the camera: the long lens sees too little sky for a star sphere.
  const backdropCount = 520;
  const backdropPos = new Float32Array(backdropCount * 3);
  const backdropCol = new Float32Array(backdropCount * 3);
  let backdropSeed = 101;
  const backdropRand = (): number => {
    backdropSeed = (Math.imul(backdropSeed, 1664525) + 1013904223) >>> 0;
    return backdropSeed / 4294967296;
  };
  const backdropHalf = Math.tan((FOV_DEG / 2) * DEG) * 1500;
  for (let i = 0; i < backdropCount; i++) {
    backdropPos[i * 3] = (backdropRand() * 2 - 1) * backdropHalf * 3.4;
    backdropPos[i * 3 + 1] = (backdropRand() * 2 - 1) * backdropHalf * 1.1;
    backdropPos[i * 3 + 2] = -1500;
    const light = 0.08 + 0.5 * backdropRand() ** 3;
    backdropCol[i * 3] = light;
    backdropCol[i * 3 + 1] = light;
    backdropCol[i * 3 + 2] = light * 1.08;
  }
  const backdropGeo = new THREE.BufferGeometry();
  backdropGeo.setAttribute('position', new THREE.BufferAttribute(backdropPos, 3));
  backdropGeo.setAttribute('color', new THREE.BufferAttribute(backdropCol, 3));
  const backdropMat = new THREE.PointsMaterial({ size: 1.3, vertexColors: true, transparent: true, sizeAttenuation: false, depthTest: false, depthWrite: false });
  const backdrop = new THREE.Points(backdropGeo, backdropMat);
  backdrop.frustumCulled = false;
  backdrop.renderOrder = 0;
  camera.add(backdrop);

  // The picture itself, with its edges faded so that no frame shows against the sky.
  const pictureUniforms = { uMap: { value: new THREE.Texture() }, uShow: { value: 0 }, uEdgeStart: { value: 0.8 } };
  const pictureMat = new THREE.ShaderMaterial({
    uniforms: pictureUniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uShow;
      uniform float uEdgeStart;
      varying vec2 vUv;
      void main() {
        // The same rounded edge as the particles are drawn within (insideEdge).
        vec2 q = abs(vUv * 2.0 - 1.0);
        float fade = 1.0 - smoothstep(uEdgeStart, 1.0, pow(q.x * q.x * q.x + q.y * q.y * q.y, 1.0 / 3.0));
        gl_FragColor = vec4(texture2D(uMap, vUv).rgb * fade * uShow, 1.0);
      }
    `,
  });
  const pictureGeo = new THREE.PlaneGeometry(1, 1);
  const picture = new THREE.Mesh(pictureGeo, pictureMat);
  picture.renderOrder = 1;
  picture.visible = false;
  scene.add(picture);

  // The particles. Their light is set so that, drawn at full strength, they add up to the picture.
  const position = new Float32Array(MAX_PARTICLES * 3);
  const tint = new Float32Array(MAX_PARTICLES * 3);
  const radius = new Float32Array(MAX_PARTICLES);
  const cloudGeo = new THREE.BufferGeometry();
  cloudGeo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  cloudGeo.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  cloudGeo.setAttribute('radius', new THREE.BufferAttribute(radius, 1));
  const cloudUniforms = { uGain: { value: 0 }, uViewportHeight: { value: 1 } };
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: cloudUniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec3 tint;
      attribute float radius;
      uniform float uGain;
      uniform float uViewportHeight;
      varying vec3 vTint;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float px = radius * projectionMatrix[1][1] * uViewportHeight * 0.5 / max(0.01, -mv.z);
        // A particle smaller than a pixel is drawn a pixel wide with its light kept the same.
        float shown = max(px, 0.75);
        vTint = tint * uGain * (px * px) / (shown * shown);
        gl_PointSize = 2.0 * shown;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vTint;
      void main() {
        vec2 d = gl_PointCoord * 2.0 - 1.0;
        gl_FragColor = vec4(vTint * exp(-4.0 * dot(d, d)), 1.0);
      }
    `,
  });
  const cloud = new THREE.Points(cloudGeo, cloudMat);
  cloud.frustumCulled = false;
  cloud.renderOrder = 2;
  cloud.visible = false;
  scene.add(cloud);

  // The Sombrero's ring of dust: dark, and seen only where it passes in front of the galaxy's middle.
  const ringUniforms = { uShow: { value: 0 }, uRing: { value: new THREE.Vector2(1, 2) } };
  const ringMat = new THREE.ShaderMaterial({
    uniforms: ringUniforms,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying float vRadius;
      varying float vNearer;
      void main() {
        vRadius = length(position.xy);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // How much nearer to the viewer than the galaxy's centre.
        vNearer = mv.z - (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uShow;
      uniform vec2 uRing;
      varying float vRadius;
      varying float vNearer;
      void main() {
        float band = smoothstep(uRing.x, mix(uRing.x, uRing.y, 0.3), vRadius) * (1.0 - smoothstep(mix(uRing.x, uRing.y, 0.7), uRing.y, vRadius));
        float front = smoothstep(-0.2, 0.5, vNearer);
        gl_FragColor = vec4(0.03, 0.02, 0.015, band * front * 0.88 * uShow);
      }
    `,
  });
  const ringGeo = new THREE.RingGeometry(0.5, 1, 128, 1);
  const dustRing = new THREE.Mesh(ringGeo, ringMat);
  dustRing.renderOrder = 3;
  dustRing.visible = false;
  scene.add(dustRing);

  const imageLoader = new THREE.ImageLoader();
  /** The picture that is on show, and the one last asked for (it may still be on its way): `<galaxy id>_<picture id>`. */
  let shownKey = '';
  let wantedKey = '';
  let pictureHeight = PICTURE_WIDTH;
  /** Scene units to one degree of sky in the picture on show. */
  let unitsPerDeg = 1;
  /** How far the view may be tipped from the picture's own direction, radians. */
  let maxPitch = 1.4;

  function show(def: GalaxyDef, shot: GalaxyPicture, depth: DepthModel, image: HTMLImageElement, count: number): void {
    pictureUniforms.uMap.value.dispose();
    const map = new THREE.Texture(image);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    map.needsUpdate = true;
    pictureUniforms.uMap.value = map;
    pictureUniforms.uEdgeStart.value = edgeStart(shot);
    pictureHeight = (PICTURE_WIDTH * image.naturalHeight) / image.naturalWidth;
    picture.scale.set(PICTURE_WIDTH, pictureHeight, 1);
    picture.visible = true;

    drawParticles(image, def, shot, depth, count, position, tint, radius);
    for (const name of ['position', 'tint', 'radius']) cloudGeo.getAttribute(name).needsUpdate = true;
    cloudGeo.setDrawRange(0, count);
    cloud.visible = true;

    dustRing.visible = depth.dustRingDeg !== null;
    if (depth.dustRingDeg) {
      const perDeg = PICTURE_WIDTH / shot.fieldDeg;
      ringUniforms.uRing.value.set(depth.dustRingDeg[0] * perDeg, depth.dustRingDeg[1] * perDeg);
      dustRing.scale.setScalar(depth.dustRingDeg[1] * perDeg);
      // The ring's plane holds the long axis and leans by the inclination, its near side towards the viewer
      // (the Sombrero's lane crosses in front of the bulge south of the nucleus).
      const axis = inPicture(def.majorAxisPaDeg, shot);
      const near = inPicture(def.nearSidePaDeg ?? def.majorAxisPaDeg + 90, shot);
      const incl = def.tiltDeg * DEG;
      const major = new THREE.Vector3(Math.cos(axis), Math.sin(axis), 0);
      const nearSide = new THREE.Vector3(Math.cos(near) * Math.cos(incl), Math.sin(near) * Math.cos(incl), Math.sin(incl));
      dustRing.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(major, nearSide, new THREE.Vector3().crossVectors(major, nearSide)));
      dustRing.position.set((shot.centre[0] - 0.5) * PICTURE_WIDTH, -(shot.centre[1] - 0.5) * pictureHeight, 0);
    }
    maxPitch = depth.maxPitchDeg * DEG;
    unitsPerDeg = PICTURE_WIDTH / shot.fieldDeg;
    shownKey = `${def.id}_${shot.id}`;
    fitPicture();
  }

  // The view: turned from the picture's own direction by `yaw` and `pitch`, radians.
  let yaw = 0;
  let pitch = 0;
  let zoom = 1;
  let tYaw = 0;
  let tPitch = 0;
  let tZoom = 1;
  /** While true the view sways by itself, through the picture's own direction and out to either side. */
  let swaying = true;
  let swayClock = 0;
  let idleSec = 0;
  let viewW = window.innerWidth;
  let viewH = window.innerHeight;
  /** Distance at which the picture fills the space the info card leaves free, and that space's offset, pixels. */
  let fitDistance = 100;
  let cardInset = 0;
  const dir = new THREE.Vector3();
  const right = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const bufferSize = new THREE.Vector2();

  function fitPicture(): void {
    // The galaxy's card takes the left of the screen on all but narrow windows.
    cardInset = viewW >= 720 ? Math.min(356, viewW * 0.32 + 16) + 12 : 0;
    const pxPerUnit = Math.min(((viewW - cardInset) * 0.92) / PICTURE_WIDTH, ((viewH - 150) * 0.92) / pictureHeight);
    fitDistance = viewH / (2 * Math.tan((FOV_DEG / 2) * DEG) * Math.max(1, pxPerUnit));
  }

  let el: HTMLElement | null = null;
  let drag = false;
  let sx = 0;
  let sy = 0;
  // On a touch screen the first finger turns the view; a second one only zooms (see core/pinch).
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !e.isPrimary) return;
    drag = true;
    sx = e.clientX;
    sy = e.clientY;
  };
  const onMove = (e: PointerEvent): void => {
    if (!drag || !e.isPrimary) return;
    swaying = false;
    idleSec = 0;
    tYaw -= (e.clientX - sx) * 0.005;
    tPitch = THREE.MathUtils.clamp(tPitch + (e.clientY - sy) * 0.005, -maxPitch, maxPitch);
    sx = e.clientX;
    sy = e.clientY;
  };
  const onUp = (e: PointerEvent): void => {
    if (e.isPrimary) drag = false;
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    tZoom = THREE.MathUtils.clamp(tZoom * Math.exp(e.deltaY * 0.001), 0.3, 1.8);
    idleSec = 0;
  };
  /** Back to the picture as it was taken. */
  const onDoubleClick = (): void => {
    swaying = false;
    idleSec = 0;
    // The shorter way round.
    tYaw = Math.round(yaw / (Math.PI * 2)) * Math.PI * 2;
    tPitch = 0;
    tZoom = 1;
  };

  return {
    scene,
    camera,

    async enter(opts: SpaceViewOptions): Promise<void> {
      const def = opts.galaxy;
      if (!def) return;
      const shot = def.pictures.find((p) => p.id === opts.galaxyPictureId) ?? def.pictures[0];
      yaw = 0;
      pitch = 0;
      tYaw = 0;
      tPitch = 0;
      zoom = 1.25;
      tZoom = 1;
      swaying = true;
      swayClock = 0;
      const key = `${def.id}_${shot.id}`;
      wantedKey = key;
      if (key === shownKey) return;
      picture.visible = false;
      cloud.visible = false;
      dustRing.visible = false;
      shownKey = '';
      const rel = `tex/galaxy_${key}.webp`;
      const depth = DEPTH[def.id];
      if (!depth || !hasAsset(rel)) return;
      const image = await imageLoader.loadAsync(assetUrl(`assets/${rel}`));
      // Another picture may have been chosen while this one was on its way.
      if (wantedKey !== key) return;
      show(def, shot, depth, image, Math.min(MAX_PARTICLES, Math.round(PARTICLES * opts.quality.particles)));
    },

    update(dt: number): void {
      if (swaying) {
        swayClock += dt;
        // The picture is held for a moment first; then out to one side, back through the picture's own
        // direction (where the view dwells), and out to the other.
        const wave = Math.sin(Math.max(0, swayClock - OPENING_HOLD_SEC) * 0.3);
        const out = Math.sign(wave) * THREE.MathUtils.smoothstep(Math.abs(wave), 0.42, 1);
        tYaw = out * 0.5;
        tPitch = out * Math.min(0.24, maxPitch) * Math.cos(swayClock * 0.13);
      } else if (!drag) {
        idleSec += dt;
        if (idleSec > RESUME_SEC) {
          swaying = true;
          swayClock = 0;
          yaw -= Math.round(yaw / (Math.PI * 2)) * Math.PI * 2;
        }
      }
      const k = Math.min(1, dt * (drag ? 12 : 2.4));
      yaw += (tYaw - yaw) * k;
      pitch += (tPitch - pitch) * k;
      zoom += (tZoom - zoom) * Math.min(1, dt * 6);

      const cp = Math.cos(pitch);
      dir.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
      right.set(Math.cos(yaw), 0, -Math.sin(yaw));
      const distance = fitDistance * zoom;
      frame.closeUpPxPerDeg = shownKey ? (viewH / (2 * Math.tan((FOV_DEG / 2) * DEG) * distance)) * unitsPerDeg : 0;
      // The galaxy stands in the middle of the space the card leaves free.
      const shift = (cardInset / 2) * ((2 * Math.tan((FOV_DEG / 2) * DEG) * distance) / viewH);
      lookAt.copy(right).multiplyScalar(-shift);
      camera.position.copy(dir).multiplyScalar(distance).add(lookAt);
      camera.lookAt(lookAt);

      // Near its own direction the picture is shown; turned away, the particles take over.
      const turned = THREE.MathUtils.smoothstep(Math.acos(THREE.MathUtils.clamp(Math.cos(yaw) * cp, -1, 1)), PICTURE_HOLDS_RAD, PICTURE_GONE_RAD);
      pictureUniforms.uShow.value = 1 - turned;
      cloudUniforms.uGain.value = 0.1 + 0.95 * turned;
      ringUniforms.uShow.value = turned;
      cloudUniforms.uViewportHeight.value = renderer.getDrawingBufferSize(bufferSize).y;
    },

    setMarkers(): void { /* no markers */ },
    setSelection(): void { /* no selection */ },
    setSelectedMarker(): void { /* no markers */ },
    attach(dom: HTMLElement): void {
      if (el === dom) return;
      this.detach();
      el = dom;
      dom.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      dom.addEventListener('wheel', onWheel, { passive: false });
      dom.addEventListener('dblclick', onDoubleClick);
    },
    detach(): void {
      if (!el) return;
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onDoubleClick);
      el = null;
      drag = false;
    },
    resize(w: number, h: number): void {
      viewW = w;
      viewH = Math.max(1, h);
      camera.aspect = w / viewH;
      camera.updateProjectionMatrix();
      fitPicture();
    },
    dispose(): void {
      this.detach();
      for (const g of [backdropGeo, pictureGeo, cloudGeo, ringGeo]) g.dispose();
      for (const m of [backdropMat, pictureMat, cloudMat, ringMat]) m.dispose();
      pictureUniforms.uMap.value.dispose();
    },
  };
}
