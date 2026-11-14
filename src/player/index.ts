/**
 * EVA astronaut: player controller under lunar gravity, the NASA Mark III suit as first-person body and
 * third-person character (one articulated rig each, see ./suit.ts), ballistic dust and bootprints.
 */
import * as THREE from 'three';
import type {
  Collider, GroundQuery, IPlayer, LightingState, PlayerEvent, PlayerFrameInput,
  PlayerGesture, PlayerState, WorldPhysics,
} from '../core/types';
import { WORLDS } from '../content';
import { softDotTexture } from '../core/sprites';
import { createSuitRig, poseSuit, type SuitPose, type SuitRig } from './suit';

const DEFAULT_EYE_HEIGHT = 1.68;
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const MAX_FOOTPRINTS = 180;
const DUST_COUNT = 600;
/** Small vertical kick of the Apollo "kangaroo hop" while running: ~0.15 m high, ~0.85 s per bound. */
const LOPE_HOP_SPEED = 0.7;
/** Body radius for walking into boulders and hardware. */
const BODY_RADIUS_M = 0.32;
/** How far behind the shoulders the follow camera rides, and how close it may come to something solid. */
const FOLLOW_DISTANCE_M = 3.6;
const FOLLOW_CLEAR_M = 0.45;
/** Uphill slopes steeper than this (tan ≈ 35°) can hardly be climbed in a pressurised suit. */
const MAX_CLIMB_TAN = 0.7;
/** Layer the main camera never renders: the first-person world body still casts its shadow from there. */
const SHADOW_ONLY_LAYER = 1;
/** How high above the ground a bootprint decal lies. */
const FOOTPRINT_LIFT_M = 0.012;
/** A teleport that sets the body down this close to where it stood (the world switch does) keeps the tracks. */
const KEEP_TRACKS_WITHIN_M = 1;
/** The raised glove covers the Sun fully while the view is within 45° of it, and not at all beyond 75°. */
const SHADE_FULL_COS = Math.cos(45 * DEG2RAD);
const SHADE_NONE_COS = Math.cos(75 * DEG2RAD);

function createScannerProp(): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.7 });
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x5fd4ff, emissive: 0x5fd4ff, emissiveIntensity: 1.2, roughness: 0.15 });
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.048, 0.14), bodyMat);
  head.position.set(0, 0.04, -0.06);
  g.add(head);
  const emitter = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.03, 14), glowMat);
  emitter.rotation.x = Math.PI / 2;
  emitter.position.set(0, 0.04, -0.14);
  g.add(emitter);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.048, 0.028), glowMat);
  screen.rotation.x = -0.5;
  screen.position.set(0, 0.066, -0.03);
  g.add(screen);
  g.visible = false;
  return g;
}

function createBootprintTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const c = canvas.getContext('2d');
  if (c) {
    c.fillStyle = 'rgba(15, 20, 28, 0.45)';
    c.beginPath();
    c.roundRect(24, 18, 80, 220, 36);
    c.fill();
    c.fillStyle = 'rgba(5, 8, 12, 0.6)';
    for (let y = 38; y < 220; y += 22) c.fillRect(30, y, 68, 9);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function attachScanner(rig: SuitRig): THREE.Group {
  const scanner = createScannerProp();
  const j = rig.joints;
  // The elbow sits halfway between shoulder and wrist, so the wrist is one more half-arm along the bind direction.
  scanner.position.copy(j.rElbow).sub(j.rShoulder);
  scanner.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), j.rArmDir);
  rig.rElbow.add(scanner);
  return scanner;
}

export function createPlayer(_renderer: THREE.WebGLRenderer): IPlayer {
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / Math.max(1, window.innerHeight), 0.3, 400_000);
  const worldObject = new THREE.Group();
  const nearObject = new THREE.Group();
  const bodyRoot = new THREE.Group();
  worldObject.add(bodyRoot);
  const shadowCasters: THREE.Object3D[] = [bodyRoot];

  let fpRig: SuitRig | null = null;
  let tpRig: SuitRig | null = null;
  let fpScanner: THREE.Group | null = null;
  let tpScanner: THREE.Group | null = null;
  let eyeOffset = new THREE.Vector3(0, DEFAULT_EYE_HEIGHT, 0);
  let followDist = FOLLOW_DISTANCE_M;

  // Bootprint instanced decals
  const footprintGeo = new THREE.PlaneGeometry(0.16, 0.33);
  footprintGeo.rotateX(-Math.PI / 2);
  const footprintMat = new THREE.MeshBasicMaterial({
    map: createBootprintTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  });
  const footprints = new THREE.InstancedMesh(footprintGeo, footprintMat, MAX_FOOTPRINTS);
  footprints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  footprints.frustumCulled = false;
  const zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < MAX_FOOTPRINTS; i++) footprints.setMatrixAt(i, zeroMat);
  worldObject.add(footprints);
  let footprintCursor = 0;
  let nextFootLeft = true;

  // Ballistic lunar dust particles
  const dustPositions = new Float32Array(DUST_COUNT * 3).fill(-9999);
  const dustVelocities = new Float32Array(DUST_COUNT * 3);
  const dustLife = new Float32Array(DUST_COUNT);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0x9ca3af, map: softDotTexture(), size: 0.05, transparent: true, opacity: 0.75, depthWrite: false,
  });
  const dustPoints = new THREE.Points(dustGeo, dustMat);
  dustPoints.frustumCulled = false;
  worldObject.add(dustPoints);
  let dustCursor = 0;

  const state: PlayerState = {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    onGround: true,
    headingDeg: 0,
    pitchDeg: 0,
    viewMode: 'first',
    jumpCount: 0,
    lastJumpHeightM: 0,
    lastAirTimeSec: 0,
    distanceWalkedM: 0,
    slopeDeg: 0,
  };
  const listeners: Record<PlayerEvent, Array<(val: number) => void>> = { jump: [], land: [], step: [] };

  let yawRad = 0; // 0 = North (−Z), positive clockwise (East +X)
  let pitchRad = 0;
  let gaitPhase = 0;
  let stepAccumulatorM = 0;
  let jumpStartY = 0;
  let currentJumpApexM = 0;
  let currentAirSec = 0;
  /** True while airborne from a running bound rather than a deliberate jump. */
  let hopping = false;
  /** Gait speed during a bound, rad/s: one stride lasts exactly one bound. */
  let hopGaitRate = 0;
  let worldPhysics: WorldPhysics = WORLDS.moon;
  let jumpBlend = 0;
  /** 0 walking or standing … 1 running. */
  let runBlend = 0;
  let shadeBlend = 0;
  let scanBlend = 0;
  let landingDip = 0;
  let shadeAmount = 0;

  const tmpNormal = new THREE.Vector3();
  const tmpQuat = new THREE.Quaternion();
  const tmpMat = new THREE.Matrix4();
  const tmpScale = new THREE.Vector3(1, 1, 1);
  const tmpPos = new THREE.Vector3();
  const upVec = new THREE.Vector3(0, 1, 0);
  const bodyQuat = new THREE.Quaternion();
  const leanQuat = new THREE.Quaternion();
  const rightAxis = new THREE.Vector3(1, 0, 0);

  function emit(ev: PlayerEvent, val: number): void {
    for (const cb of listeners[ev]) cb(val);
  }

  function spawnDust(origin: THREE.Vector3, count: number, speedScale: number): void {
    const n = Math.min(DUST_COUNT, count);
    for (let i = 0; i < n; i++) {
      const idx = dustCursor % DUST_COUNT;
      dustCursor++;
      const a = Math.random() * Math.PI * 2;
      const horiz = (0.35 + Math.random() * 1.1) * speedScale;
      dustPositions[idx * 3] = origin.x + Math.cos(a) * 0.18;
      dustPositions[idx * 3 + 1] = origin.y + 0.04;
      dustPositions[idx * 3 + 2] = origin.z + Math.sin(a) * 0.18;
      dustVelocities[idx * 3] = Math.cos(a) * horiz;
      dustVelocities[idx * 3 + 1] = (0.45 + Math.random() * 0.95) * speedScale;
      dustVelocities[idx * 3 + 2] = Math.sin(a) * horiz;
      dustLife[idx] = 1.6;
    }
  }

  function stampFootprint(ground: GroundQuery): void {
    const sideSign = nextFootLeft ? -1 : 1;
    nextFootLeft = !nextFootLeft;
    const fx = state.position.x + Math.cos(yawRad) * sideSign * 0.13;
    const fz = state.position.z + Math.sin(yawRad) * sideSign * 0.13;
    const fy = ground.heightAt(fx, fz) + FOOTPRINT_LIFT_M;
    ground.normalAt(fx, fz, tmpNormal);
    tmpQuat.setFromUnitVectors(upVec, tmpNormal).multiply(new THREE.Quaternion().setFromAxisAngle(upVec, -yawRad));
    tmpPos.set(fx, fy, fz);
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    footprints.setMatrixAt(footprintCursor % MAX_FOOTPRINTS, tmpMat);
    footprintCursor++;
    footprints.instanceMatrix.needsUpdate = true;
  }

  /** True while the newest bootprint still lies on the ground: false once another site has been loaded. */
  function tracksLieOn(ground: GroundQuery): boolean {
    if (footprintCursor === 0) return true;
    footprints.getMatrixAt((footprintCursor - 1) % MAX_FOOTPRINTS, tmpMat);
    tmpPos.setFromMatrixPosition(tmpMat);
    return Math.abs(ground.heightAt(tmpPos.x, tmpPos.z) + FOOTPRINT_LIFT_M - tmpPos.y) < 0.03;
  }

  /** Removes every bootprint and every dust grain: they belong to the place the astronaut has left. */
  function clearTracks(): void {
    for (let i = 0; i < MAX_FOOTPRINTS; i++) footprints.setMatrixAt(i, zeroMat);
    footprints.instanceMatrix.needsUpdate = true;
    footprintCursor = 0;
    stepAccumulatorM = 0;
    dustLife.fill(0);
    dustPositions.fill(-9999);
    dustGeo.getAttribute('position').needsUpdate = true;
  }

  /**
   * Body pose seen from outside (and as the shadow), in degrees. Each arm swings opposite the leg on its own
   * side. Running, the elbows bend and the arms are carried forward, as in the loping run of the Apollo crews;
   * only a deliberate jump (or floating) lifts the arms.
   */
  function worldPose(): SuitPose {
    const speedFrac = Math.min(1, Math.hypot(state.velocity.x, state.velocity.z) / Math.max(1, worldPhysics.runSpeedMs));
    const stride = Math.sin(gaitPhase) * speedFrac * (1 - jumpBlend * 0.6);
    const legSwing = stride * (26 + runBlend * 10);
    const armSwing = stride * (20 + runBlend * 12);
    const armLift = 8 + runBlend * 16 + jumpBlend * 55;
    const elbow = 18 + runBlend * 56 + jumpBlend * 25;
    return {
      lRaise: armLift - armSwing + shadeBlend * 120,
      lSpread: 9 + jumpBlend * 10,
      lElbow: elbow + shadeBlend * 30,
      rRaise: armLift + armSwing + scanBlend * 70,
      rSpread: 9 + jumpBlend * 10,
      rElbow: elbow + scanBlend * 15,
      lHip: legSwing + jumpBlend * 18,
      lKnee: Math.max(0, -legSwing) * 1.1 + runBlend * 12 + jumpBlend * 30 + landingDip * 120,
      rHip: -legSwing + jumpBlend * 10,
      rKnee: Math.max(0, legSwing) * 1.1 + runBlend * 12 + jumpBlend * 22 + landingDip * 120,
    };
  }

  /** First-person pose: arms low at rest, brought up into view while jumping, shading or scanning. */
  function firstPersonPose(): SuitPose {
    const speedFrac = Math.min(1, Math.hypot(state.velocity.x, state.velocity.z) / Math.max(1, worldPhysics.runSpeedMs));
    const swing = Math.sin(gaitPhase) * speedFrac * (10 + runBlend * 6) * (1 - jumpBlend);
    const pitchDeg = pitchRad * RAD2DEG;
    const base = worldPose();
    return {
      ...base,
      lRaise: 22 - swing + jumpBlend * 58 + shadeBlend * (95 + Math.max(0, pitchDeg) * 0.8),
      lSpread: 6 - jumpBlend * 12 - shadeBlend * 4,
      lElbow: 38 + runBlend * 16 - jumpBlend * 18 + shadeBlend * 20,
      rRaise: 22 + swing + jumpBlend * 58 + scanBlend * (52 + pitchDeg * 0.6),
      rSpread: 6 - jumpBlend * 12,
      rElbow: 38 + runBlend * 16 - jumpBlend * 18 - scanBlend * 10,
    };
  }

  function setLayer(root: THREE.Object3D, layer: number): void {
    root.traverse((o) => o.layers.set(layer));
  }

  return {
    camera,
    worldObject,
    nearObject,
    shadowCasters,
    state,

    get shadeAmount(): number {
      return shadeAmount;
    },

    async load(onProgress?: (fraction: number) => void): Promise<void> {
      if (fpRig && tpRig) return;
      onProgress?.(0.2);
      const [fp, tp] = await Promise.all([createSuitRig(true), createSuitRig(false)]);
      fpRig = fp;
      tpRig = tp;
      fpScanner = attachScanner(fp);
      tpScanner = attachScanner(tp);
      eyeOffset = fp.joints.eye.clone();
      nearObject.add(fp.root);
      bodyRoot.add(tp.root);
      setLayer(tp.root, state.viewMode === 'first' ? SHADOW_ONLY_LAYER : 0);
      onProgress?.(1);
    },

    teleport(x: number, z: number, headingDeg: number, ground: GroundQuery, pitchDeg = 0): void {
      // The tracks stay only when the body is set down where it stood, on the ground they were made on.
      const movedM = Math.hypot(x - state.position.x, z - state.position.z);
      if (movedM > KEEP_TRACKS_WITHIN_M || !tracksLieOn(ground)) clearTracks();
      const y = ground.heightAt(x, z);
      state.position.set(x, y, z);
      state.velocity.set(0, 0, 0);
      state.onGround = true;
      this.setLook(headingDeg, pitchDeg);
      jumpStartY = y;
      currentJumpApexM = 0;
      currentAirSec = 0;
    },

    setLook(headingDeg: number, pitchDeg: number): void {
      yawRad = (((headingDeg % 360) + 360) % 360) * DEG2RAD;
      pitchRad = Math.max(-88, Math.min(88, pitchDeg)) * DEG2RAD;
      state.headingDeg = yawRad * RAD2DEG;
      state.pitchDeg = pitchRad * RAD2DEG;
    },

    update(dt: number, input: PlayerFrameInput, ground: GroundQuery, lighting: LightingState, gesture: PlayerGesture, obstacles: Collider[]): void {
      const clampedDt = Math.min(0.1, Math.max(0.0001, dt));

      // 1. View orientation
      yawRad = (yawRad + input.lookYaw) % (Math.PI * 2);
      if (yawRad < 0) yawRad += Math.PI * 2;
      pitchRad = Math.max(-88 * DEG2RAD, Math.min(88 * DEG2RAD, pitchRad + input.lookPitch));
      state.headingDeg = yawRad * RAD2DEG;
      state.pitchDeg = pitchRad * RAD2DEG;

      // 2. Movement: either 3D zero-g EVA thrust or solid-ground physics under the world's gravity.
      const forwardX = Math.sin(yawRad);
      const forwardZ = -Math.cos(yawRad);
      const rightX = Math.cos(yawRad);
      const rightZ = Math.sin(yawRad);
      const lookDirX = Math.cos(pitchRad) * forwardX;
      const lookDirY = Math.sin(pitchRad);
      const lookDirZ = Math.cos(pitchRad) * forwardZ;

      if (worldPhysics.zeroG) {
        state.onGround = false;
        hopping = false;
        state.slopeDeg = 0;
        const thrustSpeed = input.run ? worldPhysics.runSpeedMs : worldPhysics.walkSpeedMs;
        let tx = rightX * input.moveX + lookDirX * input.moveZ;
        let ty = lookDirY * input.moveZ + (input.moveY ?? 0);
        let tz = rightZ * input.moveX + lookDirZ * input.moveZ;
        const tLen = Math.hypot(tx, ty, tz);
        if (tLen > 1) { tx /= tLen; ty /= tLen; tz /= tLen; }
        if (tLen > 0.01) {
          const accel = 3.2;
          state.velocity.x += (tx * thrustSpeed - state.velocity.x) * Math.min(1, accel * clampedDt);
          state.velocity.y += (ty * thrustSpeed - state.velocity.y) * Math.min(1, accel * clampedDt);
          state.velocity.z += (tz * thrustSpeed - state.velocity.z) * Math.min(1, accel * clampedDt);
        } else {
          // Gentle suit attitude stabilizer drag so teachers don't drift endlessly.
          const damp = Math.exp(-clampedDt * 1.4);
          state.velocity.multiplyScalar(damp);
        }
        state.position.addScaledVector(state.velocity, clampedDt);
        if (state.position.y < -35) {
          state.position.y = -35;
          state.velocity.y = Math.max(0, state.velocity.y);
        }
        state.distanceWalkedM += state.velocity.length() * clampedDt;
      } else {
        let wishX = rightX * input.moveX + forwardX * input.moveZ;
        let wishZ = rightZ * input.moveX + forwardZ * input.moveZ;
        const wishLen = Math.hypot(wishX, wishZ);
        if (wishLen > 1) {
          wishX /= wishLen;
          wishZ /= wishLen;
        }
        // Slopes: uphill costs speed and very steep slopes stop the climb; downhill is a little faster.
        const n = ground.normalAt(state.position.x, state.position.z, tmpNormal);
        state.slopeDeg = Math.acos(Math.min(1, n.y)) * RAD2DEG;
        let slopeFactor = 1;
        if (wishLen > 0.01) {
          const mag = Math.min(1, wishLen);
          const tanAlong = -(n.x * wishX + n.z * wishZ) / mag / Math.max(0.2, n.y);
          slopeFactor = tanAlong > MAX_CLIMB_TAN ? 0.1
            : tanAlong > 0 ? 1 / (1 + 2.2 * tanAlong)
            : 1 + 0.15 * Math.min(1, -tanAlong * 3);
        }
        const targetSpeed = (input.run ? worldPhysics.runSpeedMs : worldPhysics.walkSpeedMs) * slopeFactor;
        wishX *= targetSpeed;
        wishZ *= targetSpeed;

        if (input.jump && state.onGround) {
          state.velocity.y = worldPhysics.jumpSpeedMs;
          state.onGround = false;
          hopping = false;
          state.jumpCount++;
          jumpStartY = state.position.y;
          currentJumpApexM = 0;
          currentAirSec = 0;
          spawnDust(state.position, 24, 0.9);
          emit('jump', worldPhysics.jumpSpeedMs);
        } else if (
          worldPhysics.gravityMs2 <= 4.5 && input.run && state.onGround && wishLen > 0.3
          && Math.hypot(state.velocity.x, state.velocity.z) > worldPhysics.runSpeedMs * 0.55 * slopeFactor
        ) {
          // Low-gravity lope bounds (Moon & Mars only; Earth has normal footsteps).
          const hopScale = worldPhysics.id === 'moon' ? 1 : 0.65;
          state.velocity.y = LOPE_HOP_SPEED * hopScale;
          state.onGround = false;
          hopping = true;
          hopGaitRate = (Math.PI * worldPhysics.gravityMs2) / (2 * LOPE_HOP_SPEED * hopScale);
          jumpStartY = state.position.y;
          currentJumpApexM = 0;
          currentAirSec = 0;
          spawnDust(state.position, 8, 0.6);
        }

        const subSteps = Math.max(1, Math.ceil(clampedDt / (1 / 120)));
        const hDt = clampedDt / subSteps;
        for (let s = 0; s < subSteps; s++) {
          const accel = state.onGround ? 7.5 : hopping ? 2.6 : 1.6;
          state.velocity.x += (wishX - state.velocity.x) * Math.min(1, accel * hDt);
          state.velocity.z += (wishZ - state.velocity.z) * Math.min(1, accel * hDt);
          if (!state.onGround) {
            state.velocity.y -= worldPhysics.gravityMs2 * hDt;
            currentAirSec += hDt;
          }
          const prevX = state.position.x;
          const prevZ = state.position.z;
          state.position.x += state.velocity.x * hDt;
          state.position.z += state.velocity.z * hDt;
          state.position.y += state.velocity.y * hDt;
          const stepDist = Math.hypot(state.position.x - prevX, state.position.z - prevZ);
          state.distanceWalkedM += stepDist;
          if (state.onGround) stepAccumulatorM += stepDist;

          let groundY = ground.heightAt(state.position.x, state.position.z);
          for (const o of obstacles) {
            const dx = state.position.x - o.x;
            const dz = state.position.z - o.z;
            const d = Math.hypot(dx, dz);
            if (state.position.y >= o.top - 0.12) {
              if (d < o.radius * 0.6) groundY = Math.max(groundY, o.top);
              continue;
            }
            const minD = o.radius + BODY_RADIUS_M;
            if (d >= minD) continue;
            const nx = d > 1e-4 ? dx / d : 1;
            const nz = d > 1e-4 ? dz / d : 0;
            state.position.x = o.x + nx * minD;
            state.position.z = o.z + nz * minD;
            const into = state.velocity.x * nx + state.velocity.z * nz;
            if (into < 0) {
              state.velocity.x -= into * nx;
              state.velocity.z -= into * nz;
            }
          }
          if (!state.onGround) currentJumpApexM = Math.max(currentJumpApexM, state.position.y - jumpStartY);
          if (state.position.y <= groundY + 0.005 && state.velocity.y <= 0) {
            if (!state.onGround) {
              const impactSpeed = Math.abs(state.velocity.y);
              if (hopping) {
                landingDip = Math.min(0.06, impactSpeed * 0.05);
                spawnDust(state.position, 14, 0.7);
                emit('step', 0.8);
              } else {
                state.lastJumpHeightM = Math.max(0.05, currentJumpApexM);
                state.lastAirTimeSec = currentAirSec;
                landingDip = Math.min(0.18, impactSpeed * 0.065);
                spawnDust(state.position, Math.round(18 + impactSpeed * 16), Math.min(1.6, impactSpeed * 0.6));
                emit('land', impactSpeed);
              }
              stampFootprint(ground);
              hopping = false;
            }
            state.position.y = groundY;
            state.velocity.y = 0;
            state.onGround = true;
          } else if (state.position.y > groundY + 0.12) {
            state.onGround = false;
          } else if (state.onGround) {
            state.position.y = groundY;
          }
        }

        const strideLengthM = input.run ? 1.85 : 1.15;
        if (state.onGround && stepAccumulatorM >= strideLengthM) {
          stepAccumulatorM %= strideLengthM;
          const stepInt = Math.min(1, Math.hypot(state.velocity.x, state.velocity.z) / Math.max(1, worldPhysics.runSpeedMs));
          stampFootprint(ground);
          spawnDust(state.position, 10, 0.55 + stepInt * 0.45);
          emit('step', 0.4 + stepInt * 0.6);
        }
      }
      // 3. Animation blends. The limbs keep time with the ground covered; in a running bound one stride lasts
      // one bound. Only a deliberate jump, or floating, takes the airborne pose.
      const horizSpeed = Math.hypot(state.velocity.x, state.velocity.z);
      gaitPhase += clampedDt * (state.onGround ? horizSpeed * (input.run ? 3.2 : 3.9) : hopping ? hopGaitRate : 1.8);
      const targetAirBlend = worldPhysics.zeroG ? 0.55 : state.onGround || hopping ? 0 : 1;
      jumpBlend += (targetAirBlend - jumpBlend) * Math.min(1, clampedDt * 6);
      const running = !worldPhysics.zeroG && input.run && horizSpeed > worldPhysics.walkSpeedMs * 1.15;
      runBlend += ((running ? 1 : 0) - runBlend) * Math.min(1, clampedDt * 5);
      shadeBlend += ((gesture.shadeSun ? 1 : 0) - shadeBlend) * Math.min(1, clampedDt * 8);
      scanBlend += ((gesture.scan ? 1 : 0) - scanBlend) * Math.min(1, clampedDt * 9);
      landingDip = Math.max(0, landingDip - clampedDt * 0.55);

      // How completely the raised glove covers the Sun: the hand is up (F held) and the view is turned toward it.
      const cosSun = lookDirX * lighting.sunDir[0] + lookDirY * lighting.sunDir[1] + lookDirZ * lighting.sunDir[2];
      shadeAmount = shadeBlend * THREE.MathUtils.smoothstep(cosSun, SHADE_NONE_COS, SHADE_FULL_COS);

      // 4. Bodies
      bodyQuat.setFromAxisAngle(upVec, -yawRad);
      const dip = landingDip * 0.5;
      if (tpRig && fpRig) {
        tpRig.root.position.set(state.position.x, state.position.y - dip, state.position.z);
        // A runner leans into the run.
        tpRig.root.quaternion.copy(bodyQuat).multiply(leanQuat.setFromAxisAngle(rightAxis, -runBlend * 9 * DEG2RAD));
        poseSuit(tpRig, worldPose());
        if (tpScanner) tpScanner.visible = scanBlend > 0.15;

        fpRig.root.visible = state.viewMode === 'first' && !gesture.telescope;
        fpRig.root.position.copy(tpRig.root.position);
        fpRig.root.quaternion.copy(bodyQuat);
        poseSuit(fpRig, firstPersonPose());
        if (fpScanner) fpScanner.visible = scanBlend > 0.15;
      }

      // 5. Camera: inside the helmet, or a follow camera behind the shoulders
      const bob = state.onGround ? Math.sin(gaitPhase * 2) * 0.02 * Math.min(1, horizSpeed / worldPhysics.walkSpeedMs) : 0;
      tmpPos.copy(eyeOffset).applyQuaternion(bodyQuat);
      const eyeX = state.position.x + tmpPos.x;
      const eyeY = state.position.y + tmpPos.y + bob - dip;
      const eyeZ = state.position.z + tmpPos.z;
      camera.quaternion.setFromEuler(new THREE.Euler(pitchRad, -yawRad, 0, 'YXZ'));
      if (state.viewMode === 'first') {
        camera.position.set(eyeX, eyeY, eyeZ);
      } else {
        // The follow camera stays this side of anything solid behind the astronaut (a boulder, the lander):
        // it comes forward at once and eases back out.
        let room = FOLLOW_DISTANCE_M;
        const along = lookDirX * lookDirX + lookDirZ * lookDirZ;
        for (const o of obstacles) {
          const ox = o.x - eyeX;
          const oz = o.z - eyeZ;
          // The camera keeps clear of the obstacle by a margin, but by no more than the astronaut already
          // stands clear of it: something beside the astronaut is not in the camera's way.
          const reach = Math.min(o.radius + FOLLOW_CLEAR_M, Math.hypot(ox, oz) - 0.02);
          // Where the line back from the eyes first comes within `reach` of the obstacle's axis.
          const toward = -(ox * lookDirX + oz * lookDirZ);
          const root = toward * toward - along * (ox * ox + oz * oz - reach * reach);
          if (along < 1e-6 || root <= 0) continue;
          const hit = (toward - Math.sqrt(root)) / along;
          // Higher than the obstacle, the camera passes over it.
          if (hit < 0 || hit >= room || eyeY - lookDirY * hit + 0.4 > o.top + FOLLOW_CLEAR_M) continue;
          room = Math.max(0.5, hit);
        }
        followDist = room < followDist ? room : followDist + (room - followDist) * Math.min(1, clampedDt * 4);
        const camX = eyeX - lookDirX * followDist;
        const camZ = eyeZ - lookDirZ * followDist;
        const floorCam = worldPhysics.zeroG ? -1e6 : ground.heightAt(camX, camZ) + 0.45;
        // Pushed close, the camera rises to look over the helmet rather than into the backpack.
        const overHelmet = 0.4 + 0.75 * (1 - followDist / FOLLOW_DISTANCE_M);
        const camY = Math.max(floorCam, eyeY - lookDirY * followDist + overHelmet);
        camera.position.set(camX, camY, camZ);
      }

      // 6. Ballistic dust (pure parabolas in vacuum)
      let dustDirty = false;
      for (let i = 0; i < DUST_COUNT; i++) {
        if (dustLife[i] <= 0) continue;
        dustDirty = true;
        dustLife[i] -= clampedDt;
        if (dustLife[i] <= 0) {
          dustPositions[i * 3 + 1] = -9999;
          continue;
        }
        dustVelocities[i * 3 + 1] -= worldPhysics.gravityMs2 * clampedDt;
        dustPositions[i * 3] += dustVelocities[i * 3] * clampedDt;
        dustPositions[i * 3 + 1] += dustVelocities[i * 3 + 1] * clampedDt;
        dustPositions[i * 3 + 2] += dustVelocities[i * 3 + 2] * clampedDt;
      }
      if (dustDirty) (dustGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      const sunShade = Math.max(0.15, lighting.sunVisibility) * lighting.sunIntensity * 0.12;
      dustMat.color.setRGB(lighting.sunColor[0] * sunShade, lighting.sunColor[1] * sunShade, lighting.sunColor[2] * sunShade);
    },

    setViewMode(mode: 'first' | 'third'): void {
      state.viewMode = mode;
      if (tpRig) setLayer(tpRig.root, mode === 'first' ? SHADOW_ONLY_LAYER : 0);
      if (fpRig) fpRig.root.visible = mode === 'first';
    },

    setWorld(world: WorldPhysics): void {
      worldPhysics = world;
      state.velocity.set(0, 0, 0);
      if (world.zeroG) {
        state.onGround = false;
        state.position.y = Math.max(state.position.y, 12);
      }
      footprints.visible = world.solidSurface;
      dustPoints.visible = world.solidSurface;
    },

    setFov(fovDeg: number): void {
      const clamped = Math.max(0.05, Math.min(85, fovDeg));
      if (Math.abs(camera.fov - clamped) > 1e-4) {
        camera.fov = clamped;
        camera.updateProjectionMatrix();
      }
    },

    on(event: PlayerEvent, cb: (value: number) => void): void {
      listeners[event].push(cb);
    },

    dispose(): void {
      footprintGeo.dispose();
      footprintMat.dispose();
      dustGeo.dispose();
      dustMat.dispose();
    },
  };
}
