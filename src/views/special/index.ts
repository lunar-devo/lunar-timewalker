/**
 * Telescope close-up views that are not globes:
 *   1. createSunView: the Sun and the inner heliosphere with coronal mass ejections expanding at their NASA
 *      DONKI launch times, speeds, widths and directions. Mercury, Venus and Earth stand where they are on
 *      the date shown, in a frame turned so that Earth is on +X (Stonyhurst longitude 0, which the eruptions'
 *      directions are given from). Not to scale: the Sun is drawn ~25× larger than its true size at this
 *      distance scale, and the planets far larger still.
 *   2. createRemnantView: a supernova remnant growing from the explosion to the present day. The shape is
 *      schematic (a Crab-like pulsar wind nebula in its filaments, a shell of ejecta knots like Cassiopeia A,
 *      or a thin Type Ia shock shell); the growth follows free expansion, scaled to the remnant's present-day
 *      size.
 */
import * as THREE from 'three';
import * as A from 'astronomy-engine';
import type { CmeVisual, ISpaceView, L10n, SpaceViewOptions, SupernovaDef } from '../../core/types';
import { supernovaMagnitude } from '../../astro';
import { astroTime, jdTTFromCalendarUT, SECONDS_PER_DAY } from '../../core/time';

const DEG2RAD = Math.PI / 180;
const AU_KM = 149_597_870.7;
/** 1 AU in scene units in the heliosphere view. */
const HELIO_AU_UNITS = 22;
const SUN_RADIUS_UNITS = 2.4;
const CME_POOL = 24;

function attachOrbitControls(
  camera: THREE.PerspectiveCamera,
  initLon: number,
  initLat: number,
  initDist: number,
  minDist: number,
  maxDist: number,
) {
  let lon = initLon;
  let lat = initLat;
  let dist = initDist;
  let targetLon = initLon;
  let targetLat = initLat;
  let targetDist = initDist;
  let el: HTMLElement | null = null;
  let dragging = false;
  let sx = 0;
  let sy = 0;

  // On a touch screen the first finger turns the view; a second one only zooms (see core/pinch).
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !e.isPrimary) return;
    dragging = true;
    sx = e.clientX;
    sy = e.clientY;
  };
  const onMove = (e: PointerEvent): void => {
    if (!dragging || !e.isPrimary) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    sx = e.clientX;
    sy = e.clientY;
    targetLon -= dx * 0.005;
    targetLat = Math.max(-1.4, Math.min(1.4, targetLat + dy * 0.005));
  };
  const onUp = (e: PointerEvent): void => {
    if (e.isPrimary) dragging = false;
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    targetDist = Math.max(minDist, Math.min(maxDist, targetDist * (1 + e.deltaY * 0.001)));
  };

  return {
    /** Sets the closest distance the wheel can reach, and moves the view out to it when it is closer. */
    setMinDist(d: number): void {
      minDist = d;
      targetDist = Math.max(targetDist, d);
      dist = Math.max(dist, d);
    },
    reset(l0: number, p0: number, d0: number): void {
      lon = l0; lat = p0; dist = d0 * 1.45;
      targetLon = l0; targetLat = p0; targetDist = d0;
    },
    step(dt: number, idleSpin = 0.04): void {
      if (!dragging) targetLon += dt * idleSpin;
      const k = Math.min(1, dt * 7);
      lon += (targetLon - lon) * k;
      lat += (targetLat - lat) * k;
      dist += (targetDist - dist) * k;
      const cp = Math.cos(lat);
      camera.position.set(dist * cp * Math.cos(lon), dist * Math.sin(lat), dist * cp * Math.sin(lon));
      camera.lookAt(0, 0, 0);
    },
    attach(dom: HTMLElement): void {
      if (el === dom) return;
      this.detach();
      el = dom;
      dom.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      dom.addEventListener('wheel', onWheel, { passive: false });
    },
    detach(): void {
      if (!el) return;
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el = null;
      dragging = false;
    },
  };
}

/** Soft round sprite with a Gaussian falloff, for glows and nebula particles. */
function createSoftSprite(): THREE.CanvasTexture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(c);
}

const NOISE_GLSL = /* glsl */ `
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

/** Points along each orbit line of the Sun view. */
const ORBIT_POINTS = 256;

/** A closed line for a planet's orbit; the Sun view fills in its points (see `drawOrbits` there). */
function orbitLine(color: number, opacity: number): THREE.LineLoop {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ORBIT_POINTS * 3), 3));
  const line = new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  line.frustumCulled = false;
  return line;
}

function addBackgroundStars(scene: THREE.Scene, count = 1400, radius = 420): THREE.Points {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let seed = 42;
  const rand = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < count; i++) {
    const u = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = radius * (0.85 + 0.3 * rand());
    pos[i * 3] = r * s * Math.cos(a);
    pos[i * 3 + 1] = r * u;
    pos[i * 3 + 2] = r * s * Math.sin(a);
    const b = 0.25 + 0.75 * Math.pow(rand(), 2);
    const t = rand();
    col[i * 3] = b * (0.85 + 0.15 * t);
    col[i * 3 + 1] = b * (0.88 + 0.08 * t);
    col[i * 3 + 2] = b * (1.0 - 0.15 * t);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.15, vertexColors: true, transparent: true, opacity: 0.72, sizeAttenuation: false }));
  scene.add(pts);
  return pts;
}

// ─────────────────────────── 1. SUN & CME HELIOSPHERE VIEW ───────────────────────────

/** The planets drawn in the Sun view. */
export type SunViewBodyId = 'mercury' | 'venus' | 'earth';

/**
 * A planet's dot in the Sun view, for the HUD to name. The view writes the place every frame while it is on
 * show; the HUD reads it in its own frame loop.
 */
export interface SunViewLabel {
  id: SunViewBodyId;
  name: L10n;
  /** Where the dot is on the screen, as shares of the viewport's width and height from its top-left corner. */
  x: number;
  y: number;
  /** False while the dot is off the screen or behind the Sun, and while the view is not on show. */
  shown: boolean;
}

export const sunViewLabels: SunViewLabel[] = [
  { id: 'mercury', name: { tr: 'Merkür', en: 'Mercury' }, x: 0, y: 0, shown: false },
  { id: 'venus', name: { tr: 'Venüs', en: 'Venus' }, x: 0, y: 0, shown: false },
  { id: 'earth', name: { tr: 'Dünya', en: 'Earth' }, x: 0, y: 0, shown: false },
];

const SUN_VIEW_BODY: Record<SunViewBodyId, A.Body> = {
  mercury: A.Body.Mercury,
  venus: A.Body.Venus,
  earth: A.Body.Earth,
};

/** Days the clock may move before the planets are placed anew (Mercury moves about 0.1° in that time). */
const PLACE_EVERY_DAYS = 0.02;
/** Days the clock may move before the orbit lines are drawn anew: the orbits turn slowly over the centuries. */
const ORBITS_EVERY_DAYS = 36525 / 2;
/**
 * Active region AR 3664, the source of the May 2024 storm: the moment it crossed the middle of the disc as
 * seen from Earth (from the positions of its flares: S20W22 on 9 May, S17W44 on 11 May, S18W89 on 14 May),
 * its latitude, and how fast the Sun's turning carries a spot across the disc as seen from Earth.
 */
const AR3664_MERIDIAN_JD = jdTTFromCalendarUT({ year: 2024, month: 5, day: 7, hour: 17 });
const AR3664_LAT_DEG = -17;
const SPOT_DEG_PER_DAY = 13.2;

export function createSunView(_renderer: THREE.WebGLRenderer): ISpaceView {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 1000);
  const orbit = attachOrbitControls(camera, 0.55, 0.42, 46, 10, 90);
  const softSprite = createSoftSprite();

  // Photosphere: granulation and limb darkening, kept just above the bloom threshold at disc centre.
  // The spot's direction is in the view's frame (Earth on +X); uSpot is 0 while it is not on the near side.
  const sunUniforms = { uTime: { value: 0 }, uSpot: { value: 0 }, uSpotDir: { value: new THREE.Vector3(1, 0, 0) } };
  const sunMat = new THREE.ShaderMaterial({
    uniforms: sunUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      varying vec3 vNormalV;
      void main() {
        vPos = normalize(position);
        vNormalV = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform float uTime;
      uniform float uSpot;
      uniform vec3 uSpotDir;
      varying vec3 vPos;
      varying vec3 vNormalV;
      void main() {
        float mu = max(vNormalV.z, 0.0);
        float limb = 0.35 + 0.65 * pow(mu, 0.6);
        float gran = noise3(vPos * 38.0 + uTime * 0.05) * 0.6 + noise3(vPos * 90.0 - uTime * 0.08) * 0.4;
        float spot = uSpot * smoothstep(0.985, 0.995, dot(vPos, uSpotDir));
        vec3 col = vec3(1.9, 1.25, 0.6) * limb * (0.85 + 0.3 * gran) * (1.0 - 0.75 * spot);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(SUN_RADIUS_UNITS, 64, 48), sunMat);
  scene.add(sunMesh);
  addBackgroundStars(scene);
  const corona = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softSprite, color: new THREE.Color(1.0, 0.62, 0.28), transparent: true, opacity: 0.62,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  corona.scale.setScalar(SUN_RADIUS_UNITS * 5.2);
  scene.add(corona);

  // Coronal streamer rays around the solar equator
  const rayMat = new THREE.ShaderMaterial({
    uniforms: sunUniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float r = length(vUv);
        if (r > 1.0 || r < 0.18) discard;
        float a = atan(vUv.y, vUv.x);
        float rays = 0.4 + 0.6 * noise3(vec3(cos(a) * 4.5, sin(a) * 4.5, r * 2.0 - uTime * 0.15));
        float fade = pow(max(0.0, 1.0 - r), 2.2) * smoothstep(0.18, 0.30, r);
        vec3 c = vec3(1.0, 0.58, 0.22) * rays * fade * 0.75;
        gl_FragColor = vec4(c, fade * 0.8);
      }
    `,
  });
  const rayDisc = new THREE.Mesh(new THREE.PlaneGeometry(SUN_RADIUS_UNITS * 8.5, SUN_RADIUS_UNITS * 8.5), rayMat);
  rayDisc.rotation.x = Math.PI / 2;
  const rayDisc2 = rayDisc.clone();
  rayDisc2.rotation.set(0.35, 0.4, 0);
  scene.add(rayDisc, rayDisc2);

  // Everything in the plane of the planets (J2000 ecliptic: x to the equinox, scene y to its north pole), turned
  // as a whole about the pole so that Earth is on +X.
  const ecliptic = new THREE.Group();
  scene.add(ecliptic);
  const eqjToEcl = A.Rotation_EQJ_ECL();
  const mercury = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), new THREE.MeshBasicMaterial({ color: 0x9ca3af }));
  const venus = new THREE.Mesh(new THREE.SphereGeometry(0.38, 20, 14), new THREE.MeshBasicMaterial({ color: 0xfde68a }));

  // Earth, lit from the Sun's side, with the Moon beside it.
  const earthMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.52, 24, 16),
    new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `varying vec3 vN; void main() { vN = normalize((modelMatrix * vec4(normal, 0.0)).xyz); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `varying vec3 vN; void main() { float lit = smoothstep(-0.2, 0.6, -vN.x); gl_FragColor = vec4(mix(vec3(0.05, 0.1, 0.2), vec3(0.24, 0.64, 1.0), lit), 1.0); }`,
    }),
  );
  const moonDot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), new THREE.MeshBasicMaterial({ color: 0xcbd5e1 }));
  const earthHalo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softSprite, color: new THREE.Color(0.35, 0.95, 0.65), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  earthHalo.scale.setScalar(5);
  earthMarker.add(moonDot, earthHalo);

  const planetMesh: Record<SunViewBodyId, THREE.Mesh> = { mercury, venus, earth: earthMarker };
  const planets = sunViewLabels.map((label) => {
    const body = SUN_VIEW_BODY[label.id];
    const line = label.id === 'earth' ? orbitLine(0x38bdf8, 0.65) : orbitLine(0x64748b, 0.45);
    const mesh = planetMesh[label.id];
    ecliptic.add(line, mesh);
    return { label, body, periodDays: A.PlanetOrbitalPeriod(body), line, mesh };
  });
  const earth = planets[2];

  /** The clock's value the orbit lines were drawn for and the planets placed for. */
  let orbitsJd = Infinity;
  let placedJd = Infinity;
  /** Earth's distance from the Sun on the date shown, AU. */
  let earthAU = 1;

  /** Draws each orbit as the path the planet follows over one turn about the date given. */
  function drawOrbits(jdTT: number): void {
    orbitsJd = jdTT;
    for (const p of planets) {
      const at = p.line.geometry.getAttribute('position');
      for (let i = 0; i < ORBIT_POINTS; i++) {
        const v = A.RotateVector(eqjToEcl, A.HelioVector(p.body, astroTime(jdTT + (i / ORBIT_POINTS - 0.5) * p.periodDays)));
        at.setXYZ(i, v.x * HELIO_AU_UNITS, v.z * HELIO_AU_UNITS, -v.y * HELIO_AU_UNITS);
      }
      at.needsUpdate = true;
    }
  }

  /** Puts the planets and the Moon where they are on the date given, and turns the plane to bring Earth to +X. */
  function place(jdTT: number): void {
    placedJd = jdTT;
    if (Math.abs(jdTT - orbitsJd) > ORBITS_EVERY_DAYS) drawOrbits(jdTT);
    const t = astroTime(jdTT);
    for (const p of planets) {
      const v = A.RotateVector(eqjToEcl, A.HelioVector(p.body, t));
      p.mesh.position.set(v.x * HELIO_AU_UNITS, v.z * HELIO_AU_UNITS, -v.y * HELIO_AU_UNITS);
    }
    earthAU = earth.mesh.position.length() / HELIO_AU_UNITS;
    ecliptic.rotation.y = Math.atan2(earth.mesh.position.z, earth.mesh.position.x);
    // The Moon's direction from Earth is the real one; its distance is drawn some 150 times too large.
    const moon = A.RotateVector(eqjToEcl, A.GeoMoon(t));
    moonDot.position.set(moon.x, moon.z, -moon.y).setLength(1.05);
    ecliptic.updateMatrixWorld(true);
  }

  // CME shock waves: turbulent plasma arc with softened cone walls so stacked CMEs read as storms, not solid domes.
  const capGeo = new THREE.SphereGeometry(1, 56, 28, 0, Math.PI * 2, 0, Math.PI / 2);
  capGeo.rotateX(Math.PI / 2);
  const cmeMeshes: Array<THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>> = [];
  for (let i = 0; i < CME_POOL; i++) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uFade: { value: 0 }, uWidth: { value: 0.5 }, uTime: { value: 0 }, uSeed: { value: i * 1.7 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vView;
        varying vec3 vLocal;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vView = normalize(-mv.xyz);
          vLocal = position;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        uniform float uFade;
        uniform float uWidth;
        uniform float uTime;
        uniform float uSeed;
        varying vec3 vN;
        varying vec3 vView;
        varying vec3 vLocal;
        void main() {
          float rim = max(0.0, 1.0 - abs(dot(normalize(vN), normalize(vView))));
          float inCone = pow(max(0.0, smoothstep(uWidth - 0.14, uWidth + 0.16, vLocal.z)), 1.3);
          float fil = 0.45 + 0.75 * noise3(vLocal * 7.5 + vec3(uSeed, uTime * 0.12, -uTime * 0.25));
          float frontGlow = pow(rim, 2.4) * 0.52 + 0.035;
          float a = frontGlow * inCone * fil * uFade;
          vec3 col = mix(vec3(0.95, 0.38, 0.12), vec3(1.0, 0.80, 0.42), pow(rim, 1.6));
          gl_FragColor = vec4(col * a, a);
        }
      `,
    });
    const m = new THREE.Mesh(capGeo, mat);
    m.visible = false;
    scene.add(m);
    cmeMeshes.push(m);
  }

  let cmes: CmeVisual[] = [];
  const tmpDir = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();
  const toPlanet = new THREE.Vector3();

  return {
    scene,
    camera,

    async enter(opts: SpaceViewOptions): Promise<void> {
      cmes = [...(opts.cmes ?? [])].sort((a, b) => a.startJdTT - b.startJdTT);
      orbit.reset(0.55, 0.42, 46);
    },

    update(dt: number, jdTT: number): void {
      sunUniforms.uTime.value += dt;
      orbit.step(dt, 0.02);
      if (Math.abs(jdTT - placedJd) > PLACE_EVERY_DAYS) place(jdTT);

      // AR 3664 is carried across the near side by the Sun's turning, and is drawn for that one crossing only.
      const spotLon = (jdTT - AR3664_MERIDIAN_JD) * SPOT_DEG_PER_DAY * DEG2RAD;
      sunUniforms.uSpot.value = 1 - THREE.MathUtils.smoothstep(Math.abs(spotLon), 80 * DEG2RAD, 100 * DEG2RAD);
      if (sunUniforms.uSpot.value > 0) {
        const spotLat = AR3664_LAT_DEG * DEG2RAD;
        sunUniforms.uSpotDir.value.set(Math.cos(spotLat) * Math.cos(spotLon), Math.sin(spotLat), -Math.cos(spotLat) * Math.sin(spotLon));
      }

      let slot = 0;
      let earthHit = 0;
      for (const cme of cmes) {
        if (slot >= cmeMeshes.length) break;
        const elapsedSec = (jdTT - cme.startJdTT) * SECONDS_PER_DAY;
        const distAU = (elapsedSec * cme.speedKmS) / AU_KM;
        if (elapsedSec <= 0 || distAU > 1.3) continue;
        const mesh = cmeMeshes[slot++];
        mesh.visible = true;
        const r = SUN_RADIUS_UNITS + distAU * HELIO_AU_UNITS;
        mesh.scale.setScalar(r);
        const lat = cme.latDeg * DEG2RAD;
        const lon = cme.lonDeg * DEG2RAD;
        tmpDir.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
        mesh.lookAt(tmpDir);
        const half = Math.max(10, Math.min(60, cme.halfAngleDeg)) * DEG2RAD;
        mesh.material.uniforms.uWidth.value = Math.cos(half);
        mesh.material.uniforms.uTime.value = sunUniforms.uTime.value;
        mesh.material.uniforms.uFade.value = Math.min(1, elapsedSec / 7200) * (1 - Math.max(0, (distAU - 1) / 0.3));
        // Earth sits on +X: a front within the event's half-width of the Sun–Earth line reaches it at Earth's distance.
        const offAxis = Math.acos(Math.max(-1, Math.min(1, tmpDir.x)));
        if (Math.abs(distAU - earthAU) < 0.08 && offAxis < half) earthHit = 1;
      }
      (earthHalo.material as THREE.SpriteMaterial).opacity = earthHit * (0.6 + 0.3 * Math.sin(sunUniforms.uTime.value * 8));

      // Where each planet's dot is on the screen, for the HUD's names.
      camera.updateMatrixWorld();
      for (const p of planets) {
        tmpPos.setFromMatrixPosition(p.mesh.matrixWorld);
        // Behind the Sun when the line of sight to the planet passes through the Sun's ball on the way.
        toPlanet.subVectors(tmpPos, camera.position);
        const along = -camera.position.dot(toPlanet) / toPlanet.lengthSq();
        const behindSun = along > 0 && along < 1 && tmpDir.copy(camera.position).addScaledVector(toPlanet, along).length() < SUN_RADIUS_UNITS;
        tmpPos.project(camera);
        p.label.x = (tmpPos.x + 1) / 2;
        p.label.y = (1 - tmpPos.y) / 2;
        p.label.shown = !behindSun && Math.abs(tmpPos.x) < 1 && Math.abs(tmpPos.y) < 1 && tmpPos.z < 1;
      }
    },

    setMarkers(): void { /* this view has no markers */ },
    setSelection(): void { /* this view has no selection */ },
    setSelectedMarker(): void { /* this view has no markers */ },
    attach(el: HTMLElement): void { orbit.attach(el); },
    detach(): void {
      orbit.detach();
      for (const label of sunViewLabels) label.shown = false;
    },
    resize(w: number, h: number): void {
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    },
    dispose(): void {
      orbit.detach();
      for (const p of planets) p.line.geometry.dispose();
      sunMesh.geometry.dispose();
      sunMat.dispose();
      capGeo.dispose();
      for (const m of cmeMeshes) m.material.dispose();
      softSprite.dispose();
    },
  };
}

// ─────────────────────────── 2. SUPERNOVA REMNANT TIME-LAPSE VIEW ───────────────────────────

const REMNANT_PARTICLES = 16000;
/** Scene radius of the remnant at its present-day size. */
const REMNANT_RADIUS_NOW = 9;
/** Closest the camera comes to the centre: this many times the cloud's farthest reach, and never less than the distance below. */
const CLOSEST_OVER_REACH = 1.9;
const CLOSEST_DISTANCE = 5;

/**
 * The schematic shapes a remnant is drawn in:
 *   - pulsarWind: filaments around a blue synchrotron nebula with jets, which a pulsar powers (the Crab);
 *   - ejectaShell: a shell of bright knots of ejecta inside a faint outer shock front, with nothing to see at
 *     its centre (Cassiopeia A, whose neutron star has no wind nebula);
 *   - shockShell: a thin shock front, bright at its limb, with no central object (Type Ia).
 */
type RemnantKind = 'pulsarWind' | 'ejectaShell' | 'shockShell';

interface RemnantLook {
  outer: THREE.Color;
  inner: THREE.Color;
  /** Strength of the thin shock front drawn round the cloud (0: none is drawn). */
  shockGain: number;
  /** Whether a pulsar keeps shining at the centre after the supernova has faded. */
  pulsar: boolean;
  /** How far the cloud is drawn out along x and along y. */
  stretch: readonly [number, number];
}

const REMNANT_LOOKS: Record<RemnantKind, RemnantLook> = {
  // Crab: red/orange hydrogen filaments around a blue-white synchrotron nebula powered by the pulsar.
  pulsarWind: { outer: new THREE.Color(1.0, 0.36, 0.18), inner: new THREE.Color(0.45, 0.6, 1.0), shockGain: 0, pulsar: true, stretch: [1.25, 0.85] },
  // Cassiopeia A: the faint blue outer front of the blast wave, around knots of ejecta (see EJECTA_TINTS).
  ejectaShell: { outer: new THREE.Color(0.4, 0.55, 1.0), inner: new THREE.Color(0.6, 0.5, 1.0), shockGain: 0.4, pulsar: false, stretch: [1, 1] },
  // SN 1006 / Tycho: thin X-ray-bright shock shell, faint red H-alpha rims, no central object.
  shockShell: { outer: new THREE.Color(0.55, 0.75, 1.0), inner: new THREE.Color(1.0, 0.4, 0.3), shockGain: 1, pulsar: false, stretch: [1, 1] },
};

/** Of the core-collapse supernovae only SN 1054 left a pulsar wind nebula to see; the others are drawn as shells. */
const REMNANT_KIND_BY_ID: Record<string, RemnantKind> = { sn1054: 'pulsarWind' };
const REMNANT_KIND_BY_TYPE: Record<SupernovaDef['snType'], RemnantKind> = { II: 'ejectaShell', Ia: 'shockShell' };

/** Colours of the knots of an ejecta shell: the orange-red, green-yellow and pale pink of its glowing elements. */
const EJECTA_TINTS = [new THREE.Color(1.0, 0.42, 0.2), new THREE.Color(0.72, 0.9, 0.36), new THREE.Color(1.0, 0.7, 0.78)];

export function createRemnantView(_renderer: THREE.WebGLRenderer): ISpaceView {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 1000);
  const orbit = attachOrbitControls(camera, 0.25, 0.2, 30, CLOSEST_DISTANCE, 70);
  const softSprite = createSoftSprite();
  addBackgroundStars(scene);

  const unitPos = new Float32Array(REMNANT_PARTICLES * 3);
  const positions = new Float32Array(REMNANT_PARTICLES * 3);
  const colors = new Float32Array(REMNANT_PARTICLES * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    map: softSprite, size: 0.5, vertexColors: true, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const cloud = new THREE.Points(geo, mat);
  scene.add(cloud);

  // The star itself: the progenitor before the explosion, the flash at first light, the pulsar afterwards.
  const star = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softSprite, color: new THREE.Color(1, 1, 1), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  scene.add(star);

  // Shock front: limb-brightened, because the line of sight crosses the most shell material at the edge.
  const shellMat = new THREE.ShaderMaterial({
    uniforms: { uOuter: { value: new THREE.Color() }, uInner: { value: new THREE.Color() }, uGain: { value: 1 } },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vPos;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        vPos = position;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform vec3 uOuter;
      uniform vec3 uInner;
      uniform float uGain;
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vPos;
      void main() {
        float rim = max(0.0, 1.0 - abs(dot(normalize(vN), normalize(vView))));
        float n = noise3(vPos * 4.0) * 0.6 + noise3(vPos * 11.0) * 0.4;
        // Thin rippled X-ray rim, with patchy red H-alpha where the shock meets denser gas.
        float xray = pow(rim, 4.0) * (0.5 + 0.8 * n);
        float halpha = smoothstep(0.62, 0.8, n) * pow(rim, 2.0) * 0.6;
        gl_FragColor = vec4((uOuter * xray + uInner * halpha) * uGain, 1.0);
      }
    `,
  });
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 5), shellMat);
  scene.add(shell);

  let currentOpts: SpaceViewOptions | null = null;
  let builtFor = '';
  let look = REMNANT_LOOKS.shockShell;

  /** Deterministic layout: filaments as wandering arcs on a thick shell, knots on a shell, or a thin shell bright at its limb. */
  function build(sn: SupernovaDef): void {
    builtFor = sn.id;
    const kind = REMNANT_KIND_BY_ID[sn.id] ?? REMNANT_KIND_BY_TYPE[sn.snType];
    look = REMNANT_LOOKS[kind];
    const [stretchX, stretchY] = look.stretch;
    let seed = 1;
    for (const ch of sn.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const p = new THREE.Vector3();
    const step = new THREE.Vector3();
    const tint = new THREE.Color();
    let i = 0;
    while (i < REMNANT_PARTICLES) {
      if (kind === 'pulsarWind' && rand() < 0.72) {
        // Filament loop: a turbulent walk around the shell with Hubble-like orange/amber and teal variations.
        p.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
        step.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
        const len = 55 + Math.floor(rand() * 100);
        const r = 0.62 + 0.38 * rand();
        const teal = rand() < 0.28;
        for (let k = 0; k < len && i < REMNANT_PARTICLES; k++, i++) {
          step.add(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.65)).normalize();
          p.addScaledVector(step, 0.011).normalize();
          const rr = r * (1 + (rand() - 0.5) * 0.05);
          unitPos.set([p.x * rr * stretchX, p.y * rr * stretchY, p.z * rr], i * 3);
          const c = teal
            ? new THREE.Color(0.32, 0.82, 0.85).lerp(new THREE.Color(0.5, 0.9, 1.0), rand() * 0.4)
            : look.outer.clone().lerp(new THREE.Color(1.0, 0.82, 0.42), rand() * 0.55);
          colors.set([c.r, c.g, c.b], i * 3);
        }
      } else if (kind === 'ejectaShell' && rand() < 0.8) {
        // A knot of ejecta: a small clump on the bright shell, about two thirds of the way out to the shock front.
        p.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize().multiplyScalar(0.56 + 0.2 * rand());
        const spread = 0.02 + 0.06 * rand() ** 2;
        const len = 20 + Math.floor(rand() * 70);
        tint.copy(EJECTA_TINTS[Math.floor(rand() * EJECTA_TINTS.length)]).multiplyScalar(0.14 + 0.26 * rand());
        for (let k = 0; k < len && i < REMNANT_PARTICLES; k++, i++) {
          unitPos.set([
            p.x + (rand() + rand() + rand() - 1.5) * spread,
            p.y + (rand() + rand() + rand() - 1.5) * spread,
            p.z + (rand() + rand() + rand() - 1.5) * spread,
          ], i * 3);
          colors.set([tint.r, tint.g, tint.b], i * 3);
        }
      } else {
        p.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
        if (p.lengthSq() > 1 || p.lengthSq() < 1e-4) continue;
        let r: number;
        let c: THREE.Color;
        if (kind === 'pulsarWind') {
          // Pulsar-wind synchrotron core + faint equatorial torus + polar jets.
          if (rand() < 0.22) {
            const sign = rand() < 0.5 ? 1 : -1;
            const t = rand();
            p.set((rand() - 0.5) * 0.08, sign * (0.08 + t * 0.65), (rand() - 0.5) * 0.08);
            c = new THREE.Color(0.65, 0.85, 1.0).multiplyScalar(0.85 * (1 - t * 0.5));
          } else {
            r = 0.68 * Math.pow(rand(), 0.75);
            p.normalize().multiplyScalar(r);
            p.y *= 0.65;
            c = look.inner.clone().multiplyScalar(1.05 - r * 0.45);
          }
        } else {
          r = 0.93 + 0.07 * rand();
          p.normalize().multiplyScalar(r);
          c = (rand() < 0.2 ? look.inner : look.outer).clone().multiplyScalar(0.24);
        }
        unitPos.set([p.x * stretchX, p.y * stretchY, p.z], i * 3);
        colors.set([c.r, c.g, c.b], i * 3);
        i++;
      }
    }
    (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    shellMat.uniforms.uOuter.value.copy(look.outer);
    shellMat.uniforms.uInner.value.copy(look.inner);
  }

  return {
    scene,
    camera,

    async enter(opts: SpaceViewOptions): Promise<void> {
      currentOpts = opts;
      if (opts.supernova && opts.supernova.id !== builtFor) build(opts.supernova);
      orbit.setMinDist(CLOSEST_DISTANCE);
      orbit.reset(0.25, 0.2, 30);
    },

    update(dt: number, jdTT: number): void {
      const sn = currentOpts?.supernova;
      if (!sn) {
        orbit.step(dt, 0.05);
        return;
      }
      const t0 = jdTTFromCalendarUT(sn.firstLight);
      const ageDays = jdTT - t0;
      const nowDays = Math.max(1, jdTTFromCalendarUT({ year: 2026, month: 1, day: 1 }) - t0);
      // Free expansion slows as the ejecta sweep up gas: radius ∝ age^0.8, matched to today's size.
      const radius = ageDays > 0 ? REMNANT_RADIUS_NOW * Math.pow(Math.min(1.2, ageDays / nowDays), 0.8) : 0;
      // The camera stays outside the cloud however large it has grown.
      orbit.setMinDist(Math.max(CLOSEST_DISTANCE, radius * Math.max(1, look.stretch[0], look.stretch[1]) * 1.03 * CLOSEST_OVER_REACH));
      orbit.step(dt, 0.05);
      // The cloud starts small and faint and grows into its present look: its particles keep their size as a
      // share of the cloud, and its glow rises with its size. In its first years it is a few pixels across,
      // where a particle cannot be drawn smaller than a pixel: there the glow is held down further.
      const grown = radius / REMNANT_RADIUS_NOW;
      const glow = Math.min(1, 0.15 + 0.85 * Math.sqrt(grown)) * Math.min(1, (grown / 0.05) ** 2);
      cloud.visible = radius > 0.05;
      shell.visible = cloud.visible && look.shockGain > 0;
      shell.scale.setScalar(radius);
      shellMat.uniforms.uGain.value = 1.1 * look.shockGain * glow;
      if (cloud.visible) {
        for (let k = 0; k < positions.length; k++) positions[k] = unitPos[k] * radius;
        (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
        mat.opacity = 0.45 * glow;
        mat.size = 0.7 * grown;
      }
      const smat = star.material as THREE.SpriteMaterial;
      if (ageDays < 0) {
        // Before the explosion: an unremarkable star.
        smat.color.setRGB(1, 0.92, 0.8);
        star.scale.setScalar(0.8);
      } else {
        const mag = supernovaMagnitude(sn, jdTT);
        const flash = mag < 20 ? Math.min(6, Math.pow(10, -0.2 * (mag + 2))) : 0;
        const k = 0.5 * flash + (look.pulsar ? 0.6 : 0);
        smat.color.setRGB(0.8 * k, 0.9 * k, k);
        star.scale.setScalar(1.2 + flash * 0.6);
      }
    },

    setMarkers(): void { /* this view has no markers */ },
    setSelection(): void { /* this view has no selection */ },
    setSelectedMarker(): void { /* this view has no markers */ },
    attach(el: HTMLElement): void { orbit.attach(el); },
    detach(): void { orbit.detach(); },
    resize(w: number, h: number): void {
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    },
    dispose(): void {
      orbit.detach();
      geo.dispose();
      mat.dispose();
      softSprite.dispose();
    },
  };
}
