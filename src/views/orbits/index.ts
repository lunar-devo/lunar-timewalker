/**
 * The close-up view that explains a close approach of Mars: the inner solar system seen from above the plane
 * of Earth's orbit, with the Sun, the orbits of Earth and Mars, the two planets where they are on the date
 * shown and a straight line between them whose length is their distance. As the date runs, Earth, on the
 * inner and faster orbit, catches up with Mars and passes between it and the Sun; in August 2003 that
 * happened where Mars's orbit comes nearest to the Sun, which is marked on the orbit.
 *
 * Computed with astronomy-engine for the date shown: the two orbits, the places of the planets, the trails
 * behind them, the perihelion point, and the numbers in `orbitViewInfo`. Not to scale: the Sun is drawn about
 * 19 times and the planets about 1,400 times their true size at this distance scale (the two planets keep
 * their true size ratio), and the planets do not turn on their axes.
 */
import * as THREE from 'three';
import * as A from 'astronomy-engine';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { ISpaceView, L10n, QualityProfile, SpaceViewOptions } from '../../core/types';
import { texUrl } from '../../core/assets';
import { astroTime } from '../../core/time';

const DEG2RAD = Math.PI / 180;
const ARCSEC_PER_RAD = 648_000 / Math.PI;
const AU_KM = 149_597_870.7;
const LIGHT_KM_S = 299_792.458;
const MARS_EQUATORIAL_DIAMETER_KM = 6792.4;
/** 1 AU in scene units. */
const AU_UNITS = 10;
const SUN_RADIUS_UNITS = 0.9;

const FOV_DEG = 42;
/** The camera's height above the plane of the orbits when the view opens, as an angle seen from the middle. */
const OPENING_LAT = 62 * DEG2RAD;
/** Parts of the screen the HUD covers, CSS pixels: its card at the left (on screens at least as wide as below), its bars at the top and bottom. */
const HUD_CARD_PX = 360;
const HUD_CARD_FROM_WIDTH_PX = 720;
const HUD_TOP_PX = 56;
const HUD_BOTTOM_PX = 68;
/** Room left around Mars's orbit inside the free part of the screen, for the names: that part is taken as this much smaller. */
const FIT_MARGIN = 1.1;
/** How far the wheel zooms, as shares of the distance at which Mars's orbit fills the free part of the screen. */
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.5;

/** Segments along each orbit line. */
const ORBIT_SEGMENTS = 256;
/** The trail behind each planet: the days it covers and the points along it. */
const TRAIL_DAYS = 42;
const TRAIL_POINTS = 29;
/** Days the clock may move before the planets, their trails and the numbers are worked out anew. */
const PLACE_EVERY_DAYS = 0.02;
/** Days the clock may move before the orbits and the perihelion point are worked out anew: far less than half a turn of Mars. */
const ORBITS_EVERY_DAYS = 200;
/**
 * Distances between which the line from Earth to Mars goes from thin and faint to thick and bright, AU: the
 * near one is the distance of August 2003.
 */
const LINK_NEAR_AU = 0.373;
const LINK_FAR_AU = 1;

const EQJ_TO_ECL = A.Rotation_EQJ_ECL();

export type OrbitViewLabelId = 'sun' | 'earth' | 'mars' | 'perihelion';

/** A thing in the view for the HUD to name. */
export interface OrbitViewLabel {
  id: OrbitViewLabelId;
  name: L10n;
  /** Where it is on the screen, as shares of the viewport's width and height from its top-left corner. */
  x: number;
  y: number;
  /** False while it is off the screen, and while the view is not on show. */
  shown: boolean;
}

/**
 * What the view shows, for the HUD: the view writes it every frame while it is on show; the HUD reads it in
 * its own frame loop. The numbers are for the date shown, between the centres of Earth and Mars.
 */
export interface OrbitViewInfo {
  shown: boolean;
  distanceKm: number;
  distanceAU: number;
  /** Seconds light takes from one planet to the other. */
  lightTimeSec: number;
  /** Mars's apparent diameter from Earth's centre: its equatorial diameter at the distance. */
  marsDiameterArcsec: number;
  labels: OrbitViewLabel[];
}

export const orbitViewInfo: OrbitViewInfo = {
  shown: false,
  distanceKm: 0,
  distanceAU: 0,
  lightTimeSec: 0,
  marsDiameterArcsec: 0,
  labels: [
    { id: 'sun', name: { tr: 'Güneş', en: 'Sun' }, x: 0, y: 0, shown: false },
    { id: 'earth', name: { tr: 'Dünya', en: 'Earth' }, x: 0, y: 0, shown: false },
    { id: 'mars', name: { tr: 'Mars', en: 'Mars' }, x: 0, y: 0, shown: false },
    { id: 'perihelion', name: { tr: 'Mars’ın günberi noktası', en: 'Mars’s perihelion' }, x: 0, y: 0, shown: false },
  ],
};

type OrbitViewPlanetId = 'earth' | 'mars';

interface PlanetLook {
  body: A.Body;
  radiusUnits: number;
  /** Colour of its orbit line and trail. */
  lineColor: number;
  /** Colour of its ball until its map has arrived. */
  ballColor: number;
  /** Map name for `texUrl`. */
  texName: string;
  /** Direction of its north pole, J2000 equatorial. */
  poleRaDeg: number;
  poleDecDeg: number;
}

const PLANET_LOOKS: Record<OrbitViewPlanetId, PlanetLook> = {
  earth: { body: A.Body.Earth, radiusUnits: 0.6, lineColor: 0x38bdf8, ballColor: 0x2f6fd0, texName: 'earth_day', poleRaDeg: 0, poleDecDeg: 90 },
  mars: { body: A.Body.Mars, radiusUnits: 0.319, lineColor: 0xfb7a3c, ballColor: 0xc1562f, texName: 'mars_color', poleRaDeg: 317.681, poleDecDeg: 52.887 },
};

/** A body's place about the Sun in the scene: J2000 ecliptic, x to the equinox, scene y to the ecliptic's north pole. */
function helioScene(out: THREE.Vector3, body: A.Body, time: A.AstroTime): THREE.Vector3 {
  const v = A.RotateVector(EQJ_TO_ECL, A.HelioVector(body, time));
  return out.set(v.x * AU_UNITS, v.z * AU_UNITS, -v.y * AU_UNITS);
}

/** A line of a set width on the screen through a row of points, and the buffer its points are written to. */
interface Path {
  line: Line2;
  points: number;
  /** Six numbers a segment: where it starts and where it ends. */
  ends: THREE.InterleavedBuffer;
}

function createPath(points: number, material: LineMaterial): Path {
  const geometry = new LineGeometry();
  geometry.setPositions(new Float32Array(points * 3));
  const line = new Line2(geometry, material);
  line.frustumCulled = false;
  return { line, points, ends: (geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data };
}

/** Writes point `i` of a path: the end of the segment before it and the start of the one after it. */
function setPathPoint(path: Path, i: number, p: THREE.Vector3): void {
  if (i < path.points - 1) p.toArray(path.ends.array, i * 6);
  if (i > 0) p.toArray(path.ends.array, i * 6 - 3);
  path.ends.needsUpdate = true;
}

function disposePath(path: Path): void {
  path.line.geometry.dispose();
  path.line.material.dispose();
}

/**
 * Turns the camera about `pivot`: a drag turns it, the wheel zooms (a pinch arrives as wheel events, see
 * core/pinch). The distance is a share of the fit distance, so that a resize keeps the zoom.
 */
function attachTurnControls(camera: THREE.PerspectiveCamera, pivot: THREE.Vector3) {
  let lon = 0;
  let lat = OPENING_LAT;
  let zoom = 1;
  let targetLon = 0;
  let targetLat = OPENING_LAT;
  let targetZoom = 1;
  let fitDist = 50;
  let el: HTMLElement | null = null;
  let dragging = false;
  let sx = 0;
  let sy = 0;

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
    targetLat = Math.max(0.2, Math.min(1.5, targetLat + dy * 0.005));
  };
  const onUp = (e: PointerEvent): void => {
    if (e.isPrimary) dragging = false;
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    targetZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, targetZoom * (1 + e.deltaY * 0.001)));
  };

  return {
    /** Sets the distance at which the picture fits the screen. */
    setFit(dist: number): void {
      fitDist = dist;
    },
    /** Puts the camera at the opening height on the side given, a little far out, from where it glides in. */
    reset(lon0: number): void {
      lon = lon0; lat = OPENING_LAT; zoom = 1.35;
      targetLon = lon0; targetLat = OPENING_LAT; targetZoom = 1;
    },
    step(dt: number): void {
      const k = Math.min(1, dt * 7);
      lon += (targetLon - lon) * k;
      lat += (targetLat - lat) * k;
      zoom += (targetZoom - zoom) * k;
      const dist = fitDist * zoom;
      const cp = Math.cos(lat);
      camera.position.set(dist * cp * Math.cos(lon), dist * Math.sin(lat), dist * cp * Math.sin(lon)).add(pivot);
      camera.lookAt(pivot);
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

function createStars(count: number, radius: number): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let seed = 2003;
  const rand = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < count; i++) {
    const u = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = radius * s * Math.cos(a);
    pos[i * 3 + 1] = radius * u;
    pos[i * 3 + 2] = radius * s * Math.sin(a);
    const b = 0.2 + 0.6 * Math.pow(rand(), 2);
    col[i * 3] = b * 0.9;
    col[i * 3 + 1] = b * 0.93;
    col[i * 3 + 2] = b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ size: 1.1, vertexColors: true, transparent: true, opacity: 0.6, sizeAttenuation: false }));
}

/** A round glow for sprites: bright at the middle, falling off fast and then slowly to nothing at the rim. */
function createGlowTexture(): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.14, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.36, 'rgba(255,255,255,0.13)');
    g.addColorStop(0.68, 'rgba(255,255,255,0.03)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new THREE.CanvasTexture(c);
}

export function createOrbitsView(_renderer: THREE.WebGLRenderer): ISpaceView {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV_DEG, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 1000);
  /** The middle of Mars's orbit, which the camera turns about, and half the orbit's length. */
  const pivot = new THREE.Vector3();
  let fitRadius = 1.524 * AU_UNITS;
  const controls = attachTurnControls(camera, pivot);
  const glowTex = createGlowTexture();
  const texLoader = new THREE.TextureLoader();
  let mapsAsked = false;
  let disposed = false;

  const stars = createStars(900, 400);
  scene.add(stars);

  // The Sun: a limb-darkened ball bright enough to bloom, and a glow around it.
  const sunMat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `varying vec3 vNormalV; void main() { vNormalV = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `varying vec3 vNormalV; void main() { float limb = 0.4 + 0.6 * pow(max(vNormalV.z, 0.0), 0.6); gl_FragColor = vec4(vec3(2.1, 1.45, 0.72) * limb, 1.0); }`,
  });
  const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(SUN_RADIUS_UNITS, 48, 32), sunMat);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: new THREE.Color(1.0, 0.62, 0.28), transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  sunGlow.scale.setScalar(SUN_RADIUS_UNITS * 12);
  scene.add(sunMesh, sunGlow);

  const ballGeo = new THREE.SphereGeometry(1, 40, 28);
  const poleEqj = new A.Vector(0, 0, 1, astroTime(2451545));
  const up = new THREE.Vector3(0, 1, 0);
  const pole = new THREE.Vector3();

  /** A planet's ball, lit from the Sun's side, with a glow that keeps it readable from afar, its orbit line and its trail. */
  function createPlanet(id: OrbitViewPlanetId) {
    const look = PLANET_LOOKS[id];
    const uniforms = {
      uMap: { value: null as THREE.Texture | null },
      uHasMap: { value: 0 },
      uColor: { value: new THREE.Color(look.ballColor) },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec2 vUv;
        void main() {
          vN = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uHasMap;
        uniform vec3 uColor;
        uniform vec3 uSunDir;
        varying vec3 vN;
        varying vec2 vUv;
        void main() {
          float lit = smoothstep(-0.12, 0.5, dot(normalize(vN), uSunDir));
          vec3 base = mix(uColor, texture2D(uMap, vUv).rgb, uHasMap);
          gl_FragColor = vec4(base * (0.05 + 1.25 * lit), 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(ballGeo, material);
    mesh.scale.setScalar(look.radiusUnits);
    const dec = look.poleDecDeg * DEG2RAD;
    const ra = look.poleRaDeg * DEG2RAD;
    poleEqj.x = Math.cos(dec) * Math.cos(ra);
    poleEqj.y = Math.cos(dec) * Math.sin(ra);
    poleEqj.z = Math.sin(dec);
    const p = A.RotateVector(EQJ_TO_ECL, poleEqj);
    mesh.quaternion.setFromUnitVectors(up, pole.set(p.x, p.z, -p.y));

    const lineColor = new THREE.Color(look.lineColor);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: lineColor, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.setScalar(look.radiusUnits * 8);

    const orbit = createPath(ORBIT_SEGMENTS + 1, new LineMaterial({
      color: look.lineColor, linewidth: 1.6, transparent: true, opacity: 0.5, depthWrite: false,
    }));
    // The trail fades to black, the colour of space, at its far end. It is not see-through, so it is drawn before the orbit line, which shows over it.
    const trail = createPath(TRAIL_POINTS, new LineMaterial({ linewidth: 4, vertexColors: true, depthWrite: false }));
    const fade = new Float32Array(TRAIL_POINTS * 3);
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const f = 1.5 * Math.pow(i / (TRAIL_POINTS - 1), 1.5);
      fade[i * 3] = lineColor.r * f;
      fade[i * 3 + 1] = lineColor.g * f;
      fade[i * 3 + 2] = lineColor.b * f;
    }
    trail.line.geometry.setColors(fade);

    scene.add(orbit.line, trail.line, mesh, glow);
    return { look, periodDays: A.PlanetOrbitalPeriod(look.body), mesh, material, uniforms, glow, orbit, trail };
  }
  const earth = createPlanet('earth');
  const mars = createPlanet('mars');
  const planets = [earth, mars];

  // The line from Earth to Mars, and a faint one from the Sun to Mars that Earth crosses as it passes between them.
  const link = createPath(2, new LineMaterial({ color: 0xffffff, linewidth: 2, transparent: true, depthWrite: false }));
  const sunToMars = createPath(2, new LineMaterial({ color: 0xfbbf24, linewidth: 1, transparent: true, opacity: 0.22, depthWrite: false }));
  scene.add(link.line, sunToMars.line);

  // Mars's perihelion: a ring lying in the plane, around the point of its orbit nearest to the Sun.
  const perihelion = new THREE.Vector3();
  const perihelionRing = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 0.86, 64),
    new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
  );
  perihelionRing.rotation.x = -Math.PI / 2;
  scene.add(perihelionRing);

  const labelPlace: Record<OrbitViewLabelId, THREE.Vector3> = {
    sun: sunMesh.position,
    earth: earth.mesh.position,
    mars: mars.mesh.position,
    perihelion,
  };

  /** The clock's value the orbits were drawn for and the planets placed for. */
  let orbitsJd = Infinity;
  let placedJd = Infinity;
  /** The size of the screen, as last heard. */
  let viewW = window.innerWidth;
  let viewH = Math.max(1, window.innerHeight);
  const tmp = new THREE.Vector3();

  /**
   * Frames the view as it opens: the whole of Mars's orbit in the part of the screen the HUD leaves free. The
   * orbit is taken as a circle about the pivot seen from the opening height: its nearer half looks larger than
   * its farther half, so the picture is also moved up by half the difference.
   */
  function fit(): void {
    const tanHalf = Math.tan((FOV_DEG * DEG2RAD) / 2);
    const cardPx = viewW >= HUD_CARD_FROM_WIDTH_PX ? HUD_CARD_PX : 0;
    const freeTan = (tanHalf * (Math.max(1, viewH - HUD_TOP_PX - HUD_BOTTOM_PX) / viewH)) / FIT_MARGIN;
    const s = fitRadius * Math.sin(OPENING_LAT);
    const c = fitRadius * Math.cos(OPENING_LAT);
    // From the distance d the circle's nearest point is s / (d − c) below the middle and its farthest s / (d + c) above it, as tangents.
    const forHeight = (s + Math.hypot(s, 2 * freeTan * c)) / (2 * freeTan);
    const forWidth = (fitRadius * FIT_MARGIN) / (tanHalf * ((viewW - cardPx) / viewH));
    const dist = Math.max(forWidth, forHeight);
    controls.setFit(dist);
    const sagPx = ((s * c) / (dist * dist - c * c) / tanHalf) * (viewH / 2);
    camera.setViewOffset(viewW, viewH, -cardPx / 2, (HUD_BOTTOM_PX - HUD_TOP_PX) / 2 + sagPx, viewW, viewH);
  }

  /**
   * Draws each orbit as the path the planet follows over one turn about the date given, and finds Mars's
   * perihelion of that turn and the middle of its orbit.
   */
  function drawOrbits(jdTT: number): void {
    orbitsJd = jdTT;
    for (const p of planets) {
      for (let i = 0; i < ORBIT_SEGMENTS; i++) {
        setPathPoint(p.orbit, i, helioScene(tmp, p.look.body, astroTime(jdTT + (i / ORBIT_SEGMENTS - 0.5) * p.periodDays)));
      }
      // One turn later the planet is back within a hair of where the line starts; the line is closed there.
      setPathPoint(p.orbit, ORBIT_SEGMENTS, helioScene(tmp, p.look.body, astroTime(jdTT - 0.5 * p.periodDays)));
    }
    let apsis = A.SearchPlanetApsis(A.Body.Mars, astroTime(jdTT - mars.periodDays / 2));
    if (apsis.kind !== A.ApsisKind.Pericenter) apsis = A.NextPlanetApsis(A.Body.Mars, apsis);
    helioScene(perihelion, A.Body.Mars, apsis.time);
    perihelionRing.position.copy(perihelion);
    const aphelion = helioScene(tmp, A.Body.Mars, A.NextPlanetApsis(A.Body.Mars, apsis).time);
    fitRadius = aphelion.distanceTo(perihelion) / 2;
    pivot.addVectors(perihelion, aphelion).multiplyScalar(0.5);
    fit();
  }

  /** Puts the planets, their trails and the lines where they are on the date given, and works out the numbers. */
  function place(jdTT: number): void {
    placedJd = jdTT;
    if (Math.abs(jdTT - orbitsJd) > ORBITS_EVERY_DAYS) drawOrbits(jdTT);
    for (const p of planets) {
      for (let i = 0; i < TRAIL_POINTS - 1; i++) {
        setPathPoint(p.trail, i, helioScene(tmp, p.look.body, astroTime(jdTT - TRAIL_DAYS * (1 - i / (TRAIL_POINTS - 1)))));
      }
      helioScene(p.mesh.position, p.look.body, astroTime(jdTT));
      setPathPoint(p.trail, TRAIL_POINTS - 1, p.mesh.position);
      p.glow.position.copy(p.mesh.position);
      p.uniforms.uSunDir.value.copy(p.mesh.position).normalize().negate();
    }
    setPathPoint(link, 0, earth.mesh.position);
    setPathPoint(link, 1, mars.mesh.position);
    setPathPoint(sunToMars, 0, sunMesh.position);
    setPathPoint(sunToMars, 1, mars.mesh.position);

    const distanceAU = earth.mesh.position.distanceTo(mars.mesh.position) / AU_UNITS;
    orbitViewInfo.distanceAU = distanceAU;
    orbitViewInfo.distanceKm = distanceAU * AU_KM;
    orbitViewInfo.lightTimeSec = orbitViewInfo.distanceKm / LIGHT_KM_S;
    orbitViewInfo.marsDiameterArcsec = 2 * Math.atan(MARS_EQUATORIAL_DIAMETER_KM / 2 / orbitViewInfo.distanceKm) * ARCSEC_PER_RAD;

    // The closer the planets, the thicker and brighter the line.
    const near = Math.pow(1 - THREE.MathUtils.smoothstep(distanceAU, LINK_NEAR_AU, LINK_FAR_AU), 2);
    link.line.material.linewidth = 1.2 + 2.8 * near;
    link.line.material.opacity = 0.35 + 0.65 * near;
    link.line.material.color.setRGB(1, 0.93, 0.8).multiplyScalar(0.7 + 0.7 * near);
  }

  /** Asks once for the planets' maps, at the smallest size there is: the balls are a few dozen pixels across at most. */
  function loadMaps(quality: QualityProfile): void {
    if (mapsAsked) return;
    mapsAsked = true;
    const smallest: QualityProfile = { ...quality, texTier: '2k' };
    for (const p of planets) {
      const url = texUrl(p.look.texName, smallest);
      if (!url) continue;
      texLoader.loadAsync(url).then((map) => {
        if (disposed) {
          map.dispose();
          return;
        }
        map.colorSpace = THREE.SRGBColorSpace;
        p.uniforms.uMap.value = map;
        p.uniforms.uHasMap.value = 1;
      }).catch(() => undefined);
    }
  }

  return {
    scene,
    camera,

    async enter(opts: SpaceViewOptions): Promise<void> {
      loadMaps(opts.quality);
      drawOrbits(opts.jdTT);
      place(opts.jdTT);
      // The camera stands a quarter turn on from the perihelion, which puts it at the right of the picture, away from the HUD's card.
      controls.reset(Math.atan2(perihelion.z - pivot.z, perihelion.x - pivot.x) + Math.PI / 2);
    },

    update(dt: number, jdTT: number): void {
      controls.step(dt);
      if (Math.abs(jdTT - placedJd) > PLACE_EVERY_DAYS) place(jdTT);

      // Where each named thing is on the screen, for the HUD.
      orbitViewInfo.shown = true;
      camera.updateMatrixWorld();
      for (const label of orbitViewInfo.labels) {
        tmp.copy(labelPlace[label.id]).project(camera);
        label.x = (tmp.x + 1) / 2;
        label.y = (1 - tmp.y) / 2;
        label.shown = Math.abs(tmp.x) < 1 && Math.abs(tmp.y) < 1 && tmp.z < 1;
      }
    },

    setMarkers(): void { /* this view has no markers */ },
    setSelection(): void { /* this view has no selection */ },
    setSelectedMarker(): void { /* this view has no markers */ },
    attach(el: HTMLElement): void { controls.attach(el); },
    detach(): void {
      controls.detach();
      orbitViewInfo.shown = false;
      for (const label of orbitViewInfo.labels) label.shown = false;
    },
    resize(w: number, h: number): void {
      viewW = w;
      viewH = Math.max(1, h);
      fit();
    },
    dispose(): void {
      disposed = true;
      controls.detach();
      for (const p of planets) {
        disposePath(p.orbit);
        disposePath(p.trail);
        p.material.dispose();
        p.glow.material.dispose();
        p.uniforms.uMap.value?.dispose();
      }
      disposePath(link);
      disposePath(sunToMars);
      ballGeo.dispose();
      sunMesh.geometry.dispose();
      sunMat.dispose();
      sunGlow.material.dispose();
      glowTex.dispose();
      perihelionRing.geometry.dispose();
      perihelionRing.material.dispose();
      stars.geometry.dispose();
      stars.material.dispose();
    },
  };
}
