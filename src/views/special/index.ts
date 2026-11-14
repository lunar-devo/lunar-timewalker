/**
 * Telescope close-up views that are not globes:
 *   1. createSunView: the Sun and the inner heliosphere (Mercury, Venus and Earth orbits) with coronal mass
 *      ejections expanding at their NASA DONKI launch times, speeds, widths and directions. Not to scale:
 *      the Sun is drawn ~25× larger than its true size at this distance scale.
 *   2. createRemnantView: a supernova remnant growing from the explosion to the present day. The shape is
 *      schematic (type-dependent: filamentary Crab-like pulsar wind nebula, or thin Type Ia shock shell); the
 *      growth follows free expansion, scaled to the remnant's present-day size.
 */
import * as THREE from 'three';
import type { CmeVisual, ISpaceView, SpaceViewOptions, SupernovaDef } from '../../core/types';
import { supernovaMagnitude } from '../../astro';
import { jdTTFromCalendarUT, SECONDS_PER_DAY } from '../../core/time';

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

  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    dragging = true;
    sx = e.clientX;
    sy = e.clientY;
  };
  const onMove = (e: PointerEvent): void => {
    if (!dragging) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    sx = e.clientX;
    sy = e.clientY;
    targetLon -= dx * 0.005;
    targetLat = Math.max(-1.4, Math.min(1.4, targetLat + dy * 0.005));
  };
  const onUp = (): void => { dragging = false; };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    targetDist = Math.max(minDist, Math.min(maxDist, targetDist * (1 + e.deltaY * 0.001)));
  };

  return {
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
      dom.addEventListener('wheel', onWheel, { passive: false });
    },
    detach(): void {
      if (!el) return;
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
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

function orbitLine(radius: number, color: number, opacity: number): THREE.LineLoop {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 256; i++) {
    const a = (i / 256) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, -Math.sin(a) * radius));
  }
  return new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
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

export function createSunView(_renderer: THREE.WebGLRenderer): ISpaceView {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 1000);
  const orbit = attachOrbitControls(camera, 0.55, 0.42, 46, 10, 90);
  const softSprite = createSoftSprite();

  // Photosphere: granulation and limb darkening, kept just above the bloom threshold at disc centre.
  const sunUniforms = { uTime: { value: 0 } };
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
      varying vec3 vPos;
      varying vec3 vNormalV;
      void main() {
        float mu = max(vNormalV.z, 0.0);
        float limb = 0.35 + 0.65 * pow(mu, 0.6);
        float gran = noise3(vPos * 38.0 + uTime * 0.05) * 0.6 + noise3(vPos * 90.0 - uTime * 0.08) * 0.4;
        // Active region AR 3664 sat south of the equator on the Earth-facing side (+X) in May 2024.
        float spot = smoothstep(0.985, 0.995, dot(vPos, normalize(vec3(0.95, -0.3, 0.0))));
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

  scene.add(orbitLine(0.387 * HELIO_AU_UNITS, 0x64748b, 0.45));
  scene.add(orbitLine(0.723 * HELIO_AU_UNITS, 0x64748b, 0.45));
  scene.add(orbitLine(HELIO_AU_UNITS, 0x38bdf8, 0.65));

  // Inner planets (Mercury, Venus, Earth + Moon) lit from the central Sun
  const mercury = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), new THREE.MeshBasicMaterial({ color: 0x9ca3af }));
  mercury.position.set(0.387 * HELIO_AU_UNITS * Math.cos(0.9), 0, 0.387 * HELIO_AU_UNITS * Math.sin(0.9));
  const venus = new THREE.Mesh(new THREE.SphereGeometry(0.38, 20, 14), new THREE.MeshBasicMaterial({ color: 0xfde68a }));
  venus.position.set(0.723 * HELIO_AU_UNITS * Math.cos(-1.1), 0, 0.723 * HELIO_AU_UNITS * Math.sin(-1.1));
  scene.add(mercury, venus);

  // Earth (and the Moon with it) at 1 AU on +X: Stonyhurst longitude 0 points at Earth.
  const earthMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.52, 24, 16),
    new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `varying vec3 vN; void main() { vN = normalize((modelMatrix * vec4(normal, 0.0)).xyz); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `varying vec3 vN; void main() { float lit = smoothstep(-0.2, 0.6, -vN.x); gl_FragColor = vec4(mix(vec3(0.05, 0.1, 0.2), vec3(0.24, 0.64, 1.0), lit), 1.0); }`,
    }),
  );
  earthMarker.position.set(HELIO_AU_UNITS, 0, 0);
  const moonDot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), new THREE.MeshBasicMaterial({ color: 0xcbd5e1 }));
  moonDot.position.set(0.5, 0.15, 0.9);
  earthMarker.add(moonDot);
  const earthHalo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softSprite, color: new THREE.Color(0.35, 0.95, 0.65), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  earthHalo.scale.setScalar(5);
  earthMarker.add(earthHalo);
  scene.add(earthMarker);

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
        // Earth sits on +X: a front within the event's half-width of the Sun–Earth line reaches it near 1 AU.
        const offAxis = Math.acos(Math.max(-1, Math.min(1, tmpDir.x)));
        if (Math.abs(distAU - 1) < 0.08 && offAxis < half) earthHit = 1;
      }
      for (let i = slot; i < cmeMeshes.length; i++) cmeMeshes[i].visible = false;
      (earthHalo.material as THREE.SpriteMaterial).opacity = earthHit * (0.6 + 0.3 * Math.sin(sunUniforms.uTime.value * 8));
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

interface RemnantLook {
  /** Filament particles (Crab-like) or a thin limb-brightened shell (Type Ia). */
  filamentary: boolean;
  outer: THREE.Color;
  inner: THREE.Color;
}

const REMNANT_LOOKS: Record<SupernovaDef['snType'], RemnantLook> = {
  // Crab: red/orange hydrogen filaments around a blue-white synchrotron nebula powered by the pulsar.
  II: { filamentary: true, outer: new THREE.Color(1.0, 0.36, 0.18), inner: new THREE.Color(0.45, 0.6, 1.0) },
  // SN 1006 / Tycho: thin X-ray-bright shock shell, faint red H-alpha rims, no central object.
  Ia: { filamentary: false, outer: new THREE.Color(0.55, 0.75, 1.0), inner: new THREE.Color(1.0, 0.4, 0.3) },
};

export function createRemnantView(_renderer: THREE.WebGLRenderer): ISpaceView {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 1000);
  const orbit = attachOrbitControls(camera, 0.25, 0.2, 30, 8, 70);
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

  /** Deterministic layout: filaments as wandering arcs on a thick shell, or a thin shell bright at its limb. */
  function build(sn: SupernovaDef): void {
    builtFor = sn.id;
    const look = REMNANT_LOOKS[sn.snType];
    let seed = 1;
    for (const ch of sn.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rand = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const p = new THREE.Vector3();
    const step = new THREE.Vector3();
    let i = 0;
    while (i < REMNANT_PARTICLES) {
      if (look.filamentary && rand() < 0.72) {
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
          unitPos.set([p.x * rr * 1.25, p.y * rr * 0.85, p.z * rr], i * 3);
          const c = teal
            ? new THREE.Color(0.32, 0.82, 0.85).lerp(new THREE.Color(0.5, 0.9, 1.0), rand() * 0.4)
            : look.outer.clone().lerp(new THREE.Color(1.0, 0.82, 0.42), rand() * 0.55);
          colors.set([c.r, c.g, c.b], i * 3);
        }
      } else {
        p.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
        if (p.lengthSq() > 1 || p.lengthSq() < 1e-4) continue;
        let r: number;
        let c: THREE.Color;
        if (look.filamentary) {
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
        unitPos.set([p.x * (look.filamentary ? 1.25 : 1), p.y * (look.filamentary ? 0.85 : 1), p.z], i * 3);
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
      orbit.reset(0.25, 0.2, 30);
    },

    update(dt: number, jdTT: number): void {
      orbit.step(dt, 0.05);
      const sn = currentOpts?.supernova;
      if (!sn) return;
      const t0 = jdTTFromCalendarUT(sn.firstLight);
      const ageDays = jdTT - t0;
      const nowDays = Math.max(1, jdTTFromCalendarUT({ year: 2026, month: 1, day: 1 }) - t0);
      // Free expansion slows as the ejecta sweep up gas: radius ∝ age^0.8, matched to today's size.
      const radius = ageDays > 0 ? REMNANT_RADIUS_NOW * Math.pow(Math.min(1.2, ageDays / nowDays), 0.8) : 0;
      cloud.visible = radius > 0.05;
      // Core-collapse remnants like the Crab show filaments, not a bright shock shell.
      shell.visible = cloud.visible && !REMNANT_LOOKS[sn.snType].filamentary;
      shell.scale.setScalar(radius);
      shellMat.uniforms.uGain.value = 1.1 + 1.5 * Math.exp(-ageDays / 3650);
      if (cloud.visible) {
        for (let k = 0; k < positions.length; k++) positions[k] = unitPos[k] * radius;
        (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
        // Young remnants are hot and bright; the glow settles within the first decades.
        mat.opacity = 0.45 + 0.4 * Math.exp(-ageDays / 3650);
        mat.size = 0.25 + radius * 0.05;
      }
      const smat = star.material as THREE.SpriteMaterial;
      if (ageDays < 0) {
        // Before the explosion: an unremarkable star.
        smat.color.setRGB(1, 0.92, 0.8);
        star.scale.setScalar(0.8);
      } else {
        const mag = supernovaMagnitude(sn, jdTT);
        const flash = mag < 20 ? Math.min(6, Math.pow(10, -0.2 * (mag + 2))) : 0;
        const pulsar = REMNANT_LOOKS[sn.snType].filamentary ? 0.6 : 0;
        const k = 0.5 * flash + pulsar;
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
