/**
 * Hardware on the lunar surface ("silent witnesses") and the player's deployable beacon.
 *
 * Everything is driven by the simulation clock: each asset appears at its real arrival time, and the
 * Apollo 11 Lunar Module follows the mission timeline — final descent to touchdown (20 July 1969,
 * 20:17:40 UT), ascent-stage lift-off (21 July, 17:54:00 UT) and the flag blown over by the ascent
 * engine. Times are historical; the descent and ascent trajectories are simplified fits to the
 * mission's altitude/velocity call-outs, not reconstructed telemetry.
 */
import * as THREE from 'three';
import type {
  ArtifactInfo, ArtifactPlacement, ArtifactVisual, Collider, GroundQuery, IArtifacts,
  LightingState, SurfaceAsset,
} from '../core/types';
import { loadGlb } from '../core/gltf';
import { softDotTexture } from '../core/sprites';
import { jdTTFromCalendarUT, SECONDS_PER_DAY } from '../core/time';

const DEG2RAD = Math.PI / 180;
const MOON_G = 1.62;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Apollo 11 mission times, UT. */
const A11_TOUCHDOWN_JD = jdTTFromCalendarUT({ year: 1969, month: 7, day: 20, hour: 20, minute: 17, second: 40 });
const A11_LIFTOFF_JD = jdTTFromCalendarUT({ year: 1969, month: 7, day: 21, hour: 17, minute: 54, second: 0 });
/** Seconds before touchdown / after lift-off during which the vehicle is drawn (1.1 km out / 3 km up). */
const A11_APPROACH_SEC = 100;
const A11_CLIMB_SEC = 150;
/** Real LM: 9.4 m across the footpads (diagonal). */
const LM_PAD_SPAN_M = 9.4;
const DUST_COUNT = 1500;

interface ManagedArtifact {
  assetId: string;
  visual: ArtifactVisual;
  arrivalJdTT: number;
  root: THREE.Group;
  ring: THREE.Mesh;
  position: THREE.Vector3;
  focus: THREE.Vector3;
  radiusM: number;
  present: boolean;
}

/**
 * Walk-blocking footprint per hardware type: LM descent-stage body (wide enough to keep the eyes clear of its
 * corners and the gear folded out from its sides; the legs are open), instruments, flag pole.
 */
const COLLIDER_SHAPE: Record<ArtifactVisual, { radius: number; height: number }> = {
  apollo_lm_descent: { radius: 2.7, height: 3.2 },
  lrrr: { radius: 0.45, height: 0.6 },
  psep: { radius: 0.55, height: 0.9 },
  flag: { radius: 0.08, height: 2.0 },
  tv_camera: { radius: 0.25, height: 1.5 },
  bootprints: { radius: 0, height: 0 },
  plaque: { radius: 0, height: 0 },
  beacon: { radius: 0.4, height: 1.6 },
};

interface LunarModule {
  root: THREE.Group;
  vehicle: THREE.Group;
  ascent: THREE.Group;
  /** Height of the vehicle's centre above its footpads. */
  centreY: number;
}

interface FlagRig {
  pivot: THREE.Group;
}

interface BeaconRig {
  root: THREE.Group;
  solarPivot: THREE.Object3D;
  dishPivot: THREE.Object3D;
  lampMat: THREE.MeshStandardMaterial;
  deployProgress: number;
}

/** Final descent, τ seconds before touchdown: [metres east of the pad, metres above it]. */
function descentOffset(tau: number): [number, number] {
  // Fits the crew call-outs: 106 m up 76 s out, 30 m at 38 s, 12 m at 23 s; 14 m/s forward 69 s out.
  return [0.001 * tau ** 3, 0.4 * tau + 0.0131 * tau * tau];
}

/** Ascent stage t seconds after lift-off: [metres west of the pad, metres above its resting place, pitch toward west (rad)]. */
function ascentOffset(t: number): [number, number, number] {
  // ~1.7 m/s² net vertical for 10 s, then pitch-over toward the west along the orbital track.
  if (t <= 10) return [0, 0.85 * t * t, 0];
  const s = t - 10;
  return [1.2 * s * s, 85 + 17 * s + 0.3 * s * s, Math.min(0.9, 0.06 * s)];
}

function metal(color: number, roughness = 0.4, metalness = 0.7): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

/**
 * NASA 3D Resources "Apollo Lunar Module" split into its two stages. In the GLB, everything that starts
 * above the descent-stage deck belongs to the ascent stage, plus one propellant tank that reaches below it.
 */
async function buildLunarModule(): Promise<LunarModule> {
  const glb = await loadGlb('apollo_lm.glb');
  glb.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(glb);
  const scale = LM_PAD_SPAN_M / ((box.max.x - box.min.x) * Math.SQRT2);
  const deckY = box.min.y + 0.458 * (box.max.y - box.min.y);

  const ascentMeshes: THREE.Mesh[] = [];
  const meshBox = new THREE.Box3();
  glb.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    meshBox.setFromObject(o);
    if (meshBox.min.y >= deckY || o.name === 'pCylinde10') ascentMeshes.push(o);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const std = m as THREE.MeshStandardMaterial;
      // The GLB ships Blinn conversions with no metalness; Kapton foil and aluminium skin need some sheen.
      std.metalness = 0.55;
      std.roughness = 0.5;
    }
  });

  const vehicle = new THREE.Group();
  vehicle.add(glb);
  glb.scale.multiplyScalar(scale);
  glb.position.set(-(box.min.x + box.max.x) * 0.5 * scale, -box.min.y * scale, -(box.min.z + box.max.z) * 0.5 * scale);
  vehicle.updateMatrixWorld(true);
  const ascent = new THREE.Group();
  vehicle.add(ascent);
  for (const m of ascentMeshes) ascent.attach(m);

  const root = new THREE.Group();
  root.add(vehicle);
  return { root, vehicle, ascent, centreY: (box.max.y - box.min.y) * scale * 0.5 };
}

function createLrrrVisual(): THREE.Group {
  const g = new THREE.Group();
  const frameMat = metal(0xd8dde6, 0.45, 0.65);
  const prismMat = new THREE.MeshStandardMaterial({ color: 0x7fb6d8, roughness: 0.1, metalness: 0.9 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.12, 0.56), frameMat);
  base.position.y = 0.06;
  g.add(base);
  const tray = new THREE.Group();
  tray.position.set(0, 0.24, 0);
  tray.rotation.x = -0.45;
  tray.add(new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.05, 0.48), frameMat));
  // 10 × 10 fused-silica corner cubes in the real array; drawn here as a 6 × 6 grid.
  const cubeGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.02, 12);
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      const p = new THREE.Mesh(cubeGeo, prismMat);
      p.position.set((c - 2.5) * 0.068, 0.032, (r - 2.5) * 0.068);
      tray.add(p);
    }
  }
  g.add(tray);
  return g;
}

function createPsepVisual(): THREE.Group {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.28, 0.42, 16), metal(0xd49b2a, 0.35, 0.75));
  core.position.y = 0.21;
  g.add(core);
  const solarMat = new THREE.MeshStandardMaterial({ color: 0x16294a, roughness: 0.25, metalness: 0.8 });
  const wingGeo = new THREE.BoxGeometry(0.85, 0.025, 0.48);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeo, solarMat);
    wing.position.set(side * 0.62, 0.22, 0);
    wing.rotation.z = -side * 0.22;
    g.add(wing);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.95, 8), metal(0xe2e8f0));
  mast.position.y = 0.68;
  g.add(mast);
  return g;
}

function createFlagTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 190;
  c.height = 100;
  const ctx = c.getContext('2d');
  if (ctx) {
    for (let i = 0; i < 13; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#b22234' : '#f4f4f4';
      ctx.fillRect(0, (i * 100) / 13, 190, 100 / 13 + 1);
    }
    ctx.fillStyle = '#3c3b6e';
    ctx.fillRect(0, 0, 76, (7 * 100) / 13);
    ctx.fillStyle = '#f4f4f4';
    for (let r = 0; r < 9; r++) {
      for (let k = 0; k < (r % 2 === 0 ? 6 : 5); k++) {
        ctx.fillRect(6 + k * 12.4 + (r % 2) * 6.2, 4 + r * 5.6, 2.4, 2.4);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Flag on a pole with the horizontal crossbar that held it out in vacuum; `pivot` tips it over at the base. */
function createFlagVisual(): { group: THREE.Group; rig: FlagRig } {
  const group = new THREE.Group();
  const pivot = new THREE.Group();
  const poleMat = metal(0xd0d7e2, 0.4, 0.8);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 2.1, 10), poleMat);
  pole.position.y = 1.05;
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.45, 8), poleMat);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0.72, 2.08, 0);
  const cloth = new THREE.Mesh(
    new THREE.PlaneGeometry(1.45, 0.86, 10, 6),
    new THREE.MeshStandardMaterial({ map: createFlagTexture(), roughness: 0.9, metalness: 0, side: THREE.DoubleSide }),
  );
  // The flag hung with permanent wrinkles: it had been folded for the trip.
  const p = cloth.geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setZ(i, 0.025 * Math.sin(p.getX(i) * 9) * Math.cos(p.getY(i) * 5));
  cloth.geometry.computeVertexNormals();
  cloth.position.set(0.735, 1.64, 0);
  pivot.add(pole, bar, cloth);
  group.add(pivot);
  return { group, rig: { pivot } };
}

function createTvCameraVisual(): THREE.Group {
  const g = new THREE.Group();
  const body = metal(0xd8dee9, 0.35, 0.75);
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.012, 1.45, 8), body);
    leg.position.set(Math.cos(a) * 0.25, 0.66, Math.sin(a) * 0.25);
    leg.rotation.z = -Math.cos(a) * 0.32;
    leg.rotation.x = Math.sin(a) * 0.32;
    g.add(leg);
  }
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.42), body);
  housing.position.y = 1.36;
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 12), metal(0x1e2430, 0.5, 0.5));
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 1.36, 0.25);
  g.add(housing, lens);
  return g;
}

function createBootprintsVisual(): THREE.Group {
  const g = new THREE.Group();
  // Compacted regolith is darker than the loose surface around it.
  const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const steps: Array<[number, number, number]> = [
    [-0.9, -0.4, 0.2], [-0.45, -0.1, 0.25], [0.0, -0.35, 0.15],
    [0.45, 0.05, 0.1], [0.85, -0.2, 0.0], [1.25, 0.2, -0.15],
  ];
  const geo = new THREE.PlaneGeometry(0.15, 0.33);
  geo.rotateX(-Math.PI / 2);
  for (const [x, z, yaw] of steps) {
    const pad = new THREE.Mesh(geo, mat);
    pad.position.set(x, 0.012, z);
    pad.rotation.y = yaw;
    pad.userData.noShadow = true;
    g.add(pad);
  }
  return g;
}

function createHighlightRing(radiusM: number): THREE.Mesh {
  const r = Math.max(0.5, radiusM * 0.3);
  const geo = new THREE.RingGeometry(r, r + 0.035, 64);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: 0xffb454, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
  }));
  mesh.position.y = 0.05;
  mesh.userData.noShadow = true;
  return mesh;
}

function createBeaconRig(): BeaconRig {
  const root = new THREE.Group();
  const body = metal(0xe2e8f0, 0.35, 0.78);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x6ee7a8, emissive: 0x6ee7a8, emissiveIntensity: 1.4, roughness: 0.2 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.38, 0.48), metal(0xd99b26, 0.35, 0.8));
  box.position.y = 0.32;
  root.add(box);
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.85, 8), body);
    leg.position.set(Math.cos(a) * 0.38, 0.28, Math.sin(a) * 0.38);
    leg.rotation.z = -Math.cos(a) * 0.48;
    leg.rotation.x = Math.sin(a) * 0.48;
    root.add(leg);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.048, 2.4, 12), body);
  mast.position.y = 1.35;
  root.add(mast);
  const solarPivot = new THREE.Group();
  solarPivot.position.y = 1.65;
  solarPivot.add(new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 0.92, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x102a56, roughness: 0.22, metalness: 0.85 }),
  ));
  root.add(solarPivot);
  const dishPivot = new THREE.Group();
  dishPivot.position.y = 2.35;
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), body);
  dish.rotation.x = Math.PI / 2;
  dishPivot.add(dish);
  root.add(dishPivot);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 14), lampMat);
  lamp.position.y = 2.68;
  root.add(lamp);
  return { root, solarPivot, dishPivot, lampMat, deployProgress: 0 };
}

export function createArtifacts(): IArtifacts {
  const object3d = new THREE.Group();
  const shadowCasters: THREE.Object3D[] = [];
  const managed: ManagedArtifact[] = [];
  let highlightId: string | null = null;
  let beacon: BeaconRig | null = null;
  let lm: LunarModule | null = null;
  let flag: FlagRig | null = null;
  let groundY = 0;
  let pulseClock = 0;

  // Regolith thrown out by the descent / ascent engine: ballistic, no air to slow or hang it.
  const dustPos = new Float32Array(DUST_COUNT * 3).fill(-9999);
  const dustVel = new Float32Array(DUST_COUNT * 3);
  const dustLife = new Float32Array(DUST_COUNT);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0x777777, map: softDotTexture(), size: 0.35, transparent: true, opacity: 0.6, depthWrite: false,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  let dustCursor = 0;
  let dustDebt = 0;

  function syncShadowCasters(): void {
    shadowCasters.length = 0;
    for (const m of managed) if (m.root.visible) shadowCasters.push(m.root);
    if (beacon) shadowCasters.push(beacon.root);
  }

  function emitDust(cx: number, cz: number, perSecond: number, dt: number): void {
    dustDebt += perSecond * dt;
    while (dustDebt >= 1) {
      dustDebt -= 1;
      const i = dustCursor++ % DUST_COUNT;
      const a = Math.random() * Math.PI * 2;
      const speed = 18 + Math.random() * 45;
      const r = 1 + Math.random() * 2.5;
      dustPos[i * 3] = cx + Math.cos(a) * r;
      dustPos[i * 3 + 1] = groundY + 0.05;
      dustPos[i * 3 + 2] = cz + Math.sin(a) * r;
      dustVel[i * 3] = Math.cos(a) * speed;
      dustVel[i * 3 + 1] = 0.5 + Math.random() * 3.5;
      dustVel[i * 3 + 2] = Math.sin(a) * speed;
      dustLife[i] = 1.2 + Math.random() * 2.2;
    }
  }

  function stepDust(dt: number): void {
    let dirty = false;
    for (let i = 0; i < DUST_COUNT; i++) {
      if (dustLife[i] <= 0) continue;
      dirty = true;
      dustLife[i] -= dt;
      if (dustLife[i] <= 0) {
        dustPos[i * 3 + 1] = -9999;
        continue;
      }
      dustVel[i * 3 + 1] -= MOON_G * dt;
      dustPos[i * 3] += dustVel[i * 3] * dt;
      dustPos[i * 3 + 1] = Math.max(groundY + 0.03, dustPos[i * 3 + 1] + dustVel[i * 3 + 1] * dt);
      dustPos[i * 3 + 2] += dustVel[i * 3 + 2] * dt;
    }
    if (dirty) (dustGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
  /** Places the two LM stages for the given clock and reports whether the descent stage stands on the pad. */
  function updateLunarModule(m: ManagedArtifact, jdTT: number, dt: number): boolean {
    if (!lm) return false;
    const tau = (A11_TOUCHDOWN_JD - jdTT) * SECONDS_PER_DAY;
    const sinceLiftoff = (jdTT - A11_LIFTOFF_JD) * SECONDS_PER_DAY;
    const pad = m.position;
    const toLocal = -m.root.rotation.y;
    m.root.visible = tau <= A11_APPROACH_SEC;
    lm.vehicle.position.set(0, 0, 0);
    lm.vehicle.rotation.set(0, 0, 0);
    lm.ascent.position.set(0, 0, 0);
    lm.ascent.rotation.set(0, 0, 0);
    lm.ascent.visible = sinceLiftoff < A11_CLIMB_SEC;
    m.focus.set(pad.x, pad.y + lm.centreY, pad.z);

    if (tau > 0) {
      if (tau > A11_APPROACH_SEC) return false;
      // Final approach from the east, braking: pitched back a few degrees until the last seconds.
      const [east, up] = descentOffset(tau);
      lm.vehicle.position.set(east, up, 0).applyAxisAngle(Y_AXIS, toLocal);
      lm.vehicle.rotation.x = -Math.min(0.2, 0.004 * tau);
      m.focus.set(pad.x + east, pad.y + up + lm.centreY, pad.z);
      if (up < 20 && dt > 0) emitDust(pad.x + east, pad.z, 500 * (1 - up / 20), dt);
      return false;
    }
    if (sinceLiftoff >= 0 && sinceLiftoff < A11_CLIMB_SEC) {
      const [west, up, pitch] = ascentOffset(sinceLiftoff);
      lm.ascent.position.set(-west, up, 0).applyAxisAngle(Y_AXIS, toLocal);
      // The model's +Z (hatch side) faces west after the placement heading; pitch the nose toward it.
      lm.ascent.rotation.x = pitch;
      m.focus.set(pad.x - west, pad.y + up + lm.centreY * 1.4, pad.z);
      if (sinceLiftoff < 2.5 && dt > 0) emitDust(pad.x, pad.z, 220, dt);
    }
    return true;
  }

  function updateFlag(jdTT: number): void {
    if (!flag) return;
    // Blown over by the ascent engine exhaust (reported by Aldrin as they lifted off).
    const t = (jdTT - A11_LIFTOFF_JD) * SECONDS_PER_DAY;
    const k = Math.min(1, Math.max(0, (t - 0.6) / 1.4));
    flag.pivot.rotation.z = -(Math.PI / 2 - 0.05) * (k * k * (3 - 2 * k));
  }

  async function buildVisual(visual: ArtifactVisual): Promise<THREE.Object3D> {
    if (visual === 'apollo_lm_descent') {
      lm = await buildLunarModule();
      return lm.root;
    }
    if (visual === 'flag') {
      const f = createFlagVisual();
      flag = f.rig;
      return f.group;
    }
    if (visual === 'psep') return createPsepVisual();
    if (visual === 'tv_camera') return createTvCameraVisual();
    if (visual === 'bootprints') return createBootprintsVisual();
    return createLrrrVisual();
  }

  return {
    object3d,
    shadowCasters,

    async load(placements: ArtifactPlacement[], assets: SurfaceAsset[], ground: GroundQuery): Promise<void> {
      object3d.clear();
      managed.length = 0;
      lm = null;
      flag = null;
      dustLife.fill(0);
      dustPos.fill(-9999);
      object3d.add(dust);
      if (beacon) object3d.add(beacon.root);

      for (const pl of placements) {
        const asset = assets.find((a) => a.id === pl.assetId);
        const root = new THREE.Group();
        const y = ground.heightAt(pl.eastM, pl.southM);
        root.position.set(pl.eastM, y, pl.southM);
        root.rotation.y = -pl.headingDeg * DEG2RAD;
        root.add(await buildVisual(pl.visual));
        const ring = createHighlightRing(pl.radiusM);
        root.add(ring);
        object3d.add(root);
        if (pl.visual === 'apollo_lm_descent') groundY = y;
        managed.push({
          assetId: pl.assetId,
          visual: pl.visual,
          arrivalJdTT: asset ? jdTTFromCalendarUT(asset.arrival) : 0,
          root,
          ring,
          position: root.position,
          focus: root.position.clone(),
          radiusM: pl.radiusM,
          present: false,
        });
      }
      syncShadowCasters();
    },

    update(dt: number, jdTT: number, lighting: LightingState, _camera: THREE.PerspectiveCamera): void {
      pulseClock += dt;
      let changed = false;
      for (const m of managed) {
        const wasVisible = m.root.visible;
        if (m.visual === 'apollo_lm_descent') {
          m.present = updateLunarModule(m, jdTT, dt);
        } else {
          m.present = jdTT >= m.arrivalJdTT;
          m.root.visible = m.present;
          m.focus.copy(m.position);
        }
        changed ||= wasVisible !== m.root.visible;
        const ringMat = m.ring.material as THREE.MeshBasicMaterial;
        ringMat.opacity = m.present && m.assetId === highlightId ? 0.55 + 0.25 * Math.sin(pulseClock * 5) : 0;
        m.ring.visible = ringMat.opacity > 0;
      }
      updateFlag(jdTT);
      stepDust(dt);
      const sun = Math.max(0.1, lighting.sunVisibility) * lighting.sunIntensity * 0.11;
      dustMat.color.setRGB(sun, sun * 0.98, sun * 0.95);

      if (beacon) {
        beacon.deployProgress = Math.min(1, beacon.deployProgress + dt * 1.2);
        beacon.root.scale.set(1, 0.2 + 0.8 * beacon.deployProgress, 1);
        beacon.solarPivot.rotation.y = Math.atan2(lighting.sunDir[0], lighting.sunDir[2]);
        beacon.dishPivot.rotation.y = Math.atan2(lighting.earthDir[0], lighting.earthDir[2]);
        const sunOk = lighting.sunVisibility > 0.2;
        const earthOk = lighting.earthIntensity > 0.001;
        const hex = sunOk && earthOk ? 0x6ee7a8 : (sunOk || earthOk ? 0xffcc66 : 0xff6b6b);
        beacon.lampMat.color.setHex(hex);
        beacon.lampMat.emissive.setHex(hex);
      }
      if (changed) syncShadowCasters();
    },

    list(): ArtifactInfo[] {
      return managed.map((m) => ({
        assetId: m.assetId,
        position: m.position,
        focus: m.focus,
        radiusM: m.radiusM,
        present: m.present,
      }));
    },

    colliders(out: Collider[]): void {
      for (const m of managed) {
        const shape = COLLIDER_SHAPE[m.visual];
        if (!m.present || !m.root.visible || shape.radius <= 0) continue;
        out.push({ x: m.position.x, z: m.position.z, radius: shape.radius, top: m.position.y + shape.height });
        if (m.visual === 'apollo_lm_descent') {
          // Four legs along the model axes: the footpad and the lower strut, which runs from the body to the pad.
          for (let k = 0; k < 4; k++) {
            const a = m.root.rotation.y + (k * Math.PI) / 2;
            for (const [r, radius, height] of [[LM_PAD_SPAN_M / 2, 0.5, 0.5], [3.4, 0.3, 1.8]] as const) {
              out.push({ x: m.position.x + Math.sin(a) * r, z: m.position.z + Math.cos(a) * r, radius, top: m.position.y + height });
            }
          }
        }
      }
      if (beacon) {
        const p = beacon.root.position;
        out.push({ x: p.x, z: p.z, radius: COLLIDER_SHAPE.beacon.radius, top: p.y + COLLIDER_SHAPE.beacon.height });
      }
    },

    setHighlight(assetId: string | null): void {
      highlightId = assetId;
    },

    placeBeacon(x: number, z: number, ground: GroundQuery): void {
      if (!beacon) {
        beacon = createBeaconRig();
        object3d.add(beacon.root);
      }
      beacon.deployProgress = 0;
      beacon.root.position.set(x, ground.heightAt(x, z), z);
      syncShadowCasters();
    },

    removeBeacon(): void {
      if (!beacon) return;
      object3d.remove(beacon.root);
      beacon = null;
      syncShadowCasters();
    },

    dispose(): void {
      object3d.clear();
      managed.length = 0;
      shadowCasters.length = 0;
      dustGeo.dispose();
      dustMat.dispose();
    },
  };
}
