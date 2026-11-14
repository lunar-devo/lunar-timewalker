/**
 * Articulated astronaut built from the NASA 3D Resources "Mark III Space Suit" model (ILC Dover / NASA JSC
 * prototype). The GLB is a single rigid pose with the arms reaching forward; at load time its triangles are
 * split into rigid segments (torso, helmet, upper arms, forearms + gloves, thighs, shins + boots) that pivot
 * at shoulders, elbows, hips and knees. Joint positions are measured from the mesh itself.
 */
import * as THREE from 'three';
import { loadGlb } from '../core/gltf';

type SegmentId =
  | 'torso' | 'helmet'
  | 'lUpper' | 'lFore' | 'rUpper' | 'rFore'
  | 'lThigh' | 'lShin' | 'rThigh' | 'rShin';

const SEGMENTS: SegmentId[] = ['torso', 'helmet', 'lUpper', 'lFore', 'rUpper', 'rFore', 'lThigh', 'lShin', 'rThigh', 'rShin'];

/** Mesh-name suffixes of the Mark III GLB (Mark_III_Spacesuit_<n>), see tools/build_assets.py. */
const PART = {
  visor: 5,
  hut: 6,          // hard upper torso, helmet shell, backpack
  softGoods: 10,   // fabric legs and arms
  gloves: 12,
  boots: [8, 9],
  ankleRings: 11,
} as const;

/** Joint frame of the model after recentring: feet on y = 0, torso centred on x = z = 0, facing −Z. */
export interface SuitJoints {
  lShoulder: THREE.Vector3;
  rShoulder: THREE.Vector3;
  lElbow: THREE.Vector3;
  rElbow: THREE.Vector3;
  lHip: THREE.Vector3;
  rHip: THREE.Vector3;
  lKnee: THREE.Vector3;
  rKnee: THREE.Vector3;
  /** Unit bind-pose direction shoulder → wrist. */
  lArmDir: THREE.Vector3;
  rArmDir: THREE.Vector3;
  /** Eye point inside the helmet. */
  eye: THREE.Vector3;
}

interface SuitSource {
  joints: SuitJoints;
  /** Per segment, one geometry per material (geometry already offset to the segment's pivot). */
  parts: Record<SegmentId, Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }>>;
}

export interface SuitRig {
  root: THREE.Group;
  joints: SuitJoints;
  helmet: THREE.Group;
  lShoulder: THREE.Group;
  rShoulder: THREE.Group;
  lElbow: THREE.Group;
  rElbow: THREE.Group;
  lHip: THREE.Group;
  rHip: THREE.Group;
  lKnee: THREE.Group;
  rKnee: THREE.Group;
}

/** Arm/leg angles in degrees. raise: 0 = arm hanging down, 90 = pointing forward; spread: outward from the body. */
export interface SuitPose {
  lRaise: number; lSpread: number; lElbow: number;
  rRaise: number; rSpread: number; rElbow: number;
  lHip: number; lKnee: number;
  rHip: number; rKnee: number;
}

const DEG2RAD = Math.PI / 180;
let sourcePromise: Promise<SuitSource> | null = null;

function meshIndex(mesh: THREE.Mesh): number {
  const m = /_(\d+)$/.exec(mesh.name);
  return m ? Number(m[1]) : -1;
}

/** Fabric stays matte; bearings and boots read as metal; the visor is a dark gold-tinted mirror. */
function convertMaterial(src: THREE.Material, index: number): THREE.Material {
  const s = src as THREE.MeshStandardMaterial;
  if (index === PART.visor) {
    return new THREE.MeshPhysicalMaterial({
      color: 0x2b2416, metalness: 1, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05,
    });
  }
  const color = s.color ? s.color.clone() : new THREE.Color(0xeeeeee);
  // Colours are linear: the white beta-cloth (#eaebf3) is ≈0.82, the grey bearings ≈0.4–0.56.
  const isFabric = color.r > 0.65 && color.g > 0.65 && color.b > 0.65;
  // Beta-cloth reflects ~75 % of sunlight, not the 92 % of the model's display colour.
  if (isFabric) color.multiplyScalar(0.8);
  if (isFabric) {
    // Woven cloth: almost no specular sheen, so sunlit sleeves never sparkle into the bloom.
    return new THREE.MeshPhysicalMaterial({ color, map: s.map ?? null, metalness: 0, roughness: 0.95, specularIntensity: 0.2 });
  }
  return new THREE.MeshStandardMaterial({
    color,
    map: s.map ?? null,
    metalness: s.map ? 0 : 0.75,
    roughness: 0.42,
  });
}

function meanOf(points: THREE.Vector3[]): THREE.Vector3 {
  const m = new THREE.Vector3();
  for (const p of points) m.add(p);
  return m.divideScalar(Math.max(1, points.length));
}

/**
 * Labels every triangle of a triangle soup with the connected piece of surface it belongs to (triangles that
 * share a corner belong together).
 */
function surfacePieces(geo: THREE.BufferGeometry): Int32Array {
  const p = geo.getAttribute('position');
  const welded = new Int32Array(p.count);
  const firstAt = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
    const first = firstAt.get(key);
    if (first === undefined) firstAt.set(key, i);
    welded[i] = first ?? i;
  }
  const parent = Int32Array.from(welded, (_v, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const triCount = p.count / 3;
  for (let t = 0; t < triCount; t++) {
    const a = find(welded[3 * t]);
    parent[find(welded[3 * t + 1])] = a;
    parent[find(welded[3 * t + 2])] = a;
  }
  const pieces = new Int32Array(triCount);
  for (let t = 0; t < triCount; t++) pieces[t] = find(welded[3 * t]);
  return pieces;
}

async function buildSource(): Promise<SuitSource> {
  const scene = await loadGlb('mark3_suit.glb');
  scene.updateMatrixWorld(true);

  interface Src { index: number; geo: THREE.BufferGeometry; material: THREE.Material }
  const srcs: Src[] = [];
  scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()) as THREE.BufferGeometry;
    geo.applyMatrix4(o.matrixWorld);
    const index = meshIndex(o);
    srcs.push({ index, geo, material: convertMaterial(o.material as THREE.Material, index) });
  });

  // Recentre: feet on y = 0, hard upper torso centred on x = z = 0.
  const hut = srcs.find((s) => s.index === PART.hut);
  const boots = srcs.filter((s) => (PART.boots as readonly number[]).includes(s.index));
  if (!hut || boots.length === 0) throw new Error('mark3_suit.glb: expected torso and boot meshes');
  hut.geo.computeBoundingBox();
  const hutBox = hut.geo.boundingBox ?? new THREE.Box3();
  let feetY = Infinity;
  for (const b of boots) {
    b.geo.computeBoundingBox();
    feetY = Math.min(feetY, b.geo.boundingBox?.min.y ?? 0);
  }
  const shift = new THREE.Vector3(-(hutBox.min.x + hutBox.max.x) / 2, -feetY, -(hutBox.min.z + hutBox.max.z) / 2 - 0.05);
  for (const s of srcs) s.geo.translate(shift.x, shift.y, shift.z);

  const tri = (g: THREE.BufferGeometry, t: number, out: THREE.Vector3): THREE.Vector3 => {
    const p = g.getAttribute('position');
    return out.set(
      (p.getX(3 * t) + p.getX(3 * t + 1) + p.getX(3 * t + 2)) / 3,
      (p.getY(3 * t) + p.getY(3 * t + 1) + p.getY(3 * t + 2)) / 3,
      (p.getZ(3 * t) + p.getZ(3 * t + 1) + p.getZ(3 * t + 2)) / 3,
    );
  };
  const verts = (g: THREE.BufferGeometry, keep: (v: THREE.Vector3) => boolean): THREE.Vector3[] => {
    const p = g.getAttribute('position');
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
      if (keep(v)) out.push(v);
    }
    return out;
  };

  const soft = srcs.find((s) => s.index === PART.softGoods);
  const gloves = srcs.find((s) => s.index === PART.gloves);
  const visor = srcs.find((s) => s.index === PART.visor);
  if (!soft || !gloves || !visor) throw new Error('mark3_suit.glb: expected soft goods, gloves and visor meshes');
  // In the GLB the arms (y ≳ 1.1 m above the feet) and legs (≲ 0.82 m) of the fabric layer are disjoint.
  const ARM_LEG_SPLIT_Y = 0.95;

  // Arms: shoulder = the part of the sleeve closest to the body, wrist = glove cuff closest to the shoulder.
  const armJoints = (side: -1 | 1) => {
    const sleeve = verts(soft.geo, (v) => v.y > ARM_LEG_SPLIT_Y && Math.sign(v.x) === side);
    const maxZ = Math.max(...sleeve.map((v) => v.z));
    const shoulder = meanOf(sleeve.filter((v) => v.z > maxZ - 0.06));
    const glove = verts(gloves.geo, (v) => Math.sign(v.x) === side);
    glove.sort((a, b) => a.distanceTo(shoulder) - b.distanceTo(shoulder));
    const wrist = meanOf(glove.slice(0, Math.max(1, Math.floor(glove.length * 0.1))));
    const elbow = shoulder.clone().lerp(wrist, 0.5);
    return { shoulder, wrist, elbow, dir: wrist.clone().sub(shoulder).normalize() };
  };
  const la = armJoints(-1);
  const ra = armJoints(1);

  // Legs: hip = top of the trouser leg, knee = halfway down to the ankle rings.
  const legJoints = (side: -1 | 1) => {
    const leg = verts(soft.geo, (v) => v.y < ARM_LEG_SPLIT_Y && Math.sign(v.x) === side);
    const top = Math.max(...leg.map((v) => v.y));
    const hip = meanOf(leg.filter((v) => v.y > top - 0.04));
    const kneeY = (hip.y + 0.24) / 2;
    const knee = meanOf(leg.filter((v) => Math.abs(v.y - kneeY) < 0.03));
    knee.y = kneeY;
    return { hip, knee };
  };
  const ll = legJoints(-1);
  const rl = legJoints(1);

  visor.geo.computeBoundingBox();
  const helmetCentre = (visor.geo.boundingBox ?? new THREE.Box3()).getCenter(new THREE.Vector3());
  // Eyes sit toward the front of the helmet bubble; this keeps the shoulder joints behind the field of view.
  const eye = helmetCentre.clone().add(new THREE.Vector3(0, -0.01, -0.13));

  // Each trouser leg is its own piece of surface. Where the two meet, a triangle goes with the leg its piece
  // belongs to, not with the side of the body's midline it happens to lie on: split by the midline, the inner
  // thighs tore into shards in a long stride.
  const softPieces = surfacePieces(soft.geo);
  const pieceX = new Map<number, { sum: number; count: number }>();
  for (let t = 0; t < softPieces.length; t++) {
    const at = tri(soft.geo, t, new THREE.Vector3());
    if (at.y > ARM_LEG_SPLIT_Y) continue;
    const stat = pieceX.get(softPieces[t]) ?? { sum: 0, count: 0 };
    stat.sum += at.x;
    stat.count++;
    pieceX.set(softPieces[t], stat);
  }
  /** −1 / +1 for a triangle of a trouser leg that lies wholly on one side; 0 where its piece spans both. */
  const legSide = (t: number): -1 | 0 | 1 => {
    const stat = pieceX.get(softPieces[t]);
    const mean = stat ? stat.sum / stat.count : 0;
    return mean < -0.03 ? -1 : mean > 0.03 ? 1 : 0;
  };

  const classify = (s: Src, c: THREE.Vector3, t: number): SegmentId => {
    if (s.index === PART.visor) return 'helmet';
    if (s.index === PART.hut) {
      // The helmet shell, and the collar/shoulder top that would fill the view from inside the helmet.
      const inHelmet = c.distanceTo(helmetCentre) < 0.27 && c.y > helmetCentre.y - 0.17 && c.z < helmetCentre.z + 0.17;
      return inHelmet || c.y > eye.y - 0.3 ? 'helmet' : 'torso';
    }
    if (s.index === PART.gloves) return c.x < 0 ? 'lFore' : 'rFore';
    if (s.index === PART.softGoods && c.y > ARM_LEG_SPLIT_Y) {
      const a = c.x < 0 ? la : ra;
      const t = c.clone().sub(a.shoulder).dot(a.dir) / a.wrist.distanceTo(a.shoulder);
      if (c.x < 0) return t > 0.5 ? 'lFore' : 'lUpper';
      return t > 0.5 ? 'rFore' : 'rUpper';
    }
    if (s.index === PART.softGoods || (PART.boots as readonly number[]).includes(s.index) || s.index === PART.ankleRings) {
      const left = (s === soft ? legSide(t) || Math.sign(c.x) : Math.sign(c.x)) < 0;
      const l = left ? ll : rl;
      if (left) return c.y < l.knee.y ? 'lShin' : 'lThigh';
      return c.y < l.knee.y ? 'rShin' : 'rThigh';
    }
    return 'torso';
  };

  const pivot: Record<SegmentId, THREE.Vector3> = {
    torso: new THREE.Vector3(), helmet: new THREE.Vector3(),
    lUpper: la.shoulder, lFore: la.elbow, rUpper: ra.shoulder, rFore: ra.elbow,
    lThigh: ll.hip, lShin: ll.knee, rThigh: rl.hip, rShin: rl.knee,
  };

  const parts = Object.fromEntries(SEGMENTS.map((id) => [id, []])) as unknown as SuitSource['parts'];
  const c = new THREE.Vector3();
  for (const s of srcs) {
    const triCount = s.geo.getAttribute('position').count / 3;
    const buckets = new Map<SegmentId, number[]>();
    for (let t = 0; t < triCount; t++) {
      const id = classify(s, tri(s.geo, t, c), t);
      let b = buckets.get(id);
      if (!b) buckets.set(id, (b = []));
      b.push(t);
    }
    for (const [id, tris] of buckets) {
      const geo = new THREE.BufferGeometry();
      for (const name of Object.keys(s.geo.attributes)) {
        const src = s.geo.getAttribute(name) as THREE.BufferAttribute;
        const size = src.itemSize;
        const dst = new Float32Array(tris.length * 3 * size);
        let k = 0;
        for (const t of tris) {
          for (let v = 0; v < 3; v++) {
            for (let e = 0; e < size; e++) dst[k++] = src.getComponent(3 * t + v, e);
          }
        }
        geo.setAttribute(name, new THREE.BufferAttribute(dst, size));
      }
      const p = pivot[id];
      geo.translate(-p.x, -p.y, -p.z);
      geo.computeBoundingSphere();
      parts[id].push({ geometry: geo, material: s.material });
    }
    s.geo.dispose();
  }

  return {
    joints: {
      lShoulder: la.shoulder, rShoulder: ra.shoulder, lElbow: la.elbow, rElbow: ra.elbow,
      lHip: ll.hip, rHip: rl.hip, lKnee: ll.knee, rKnee: rl.knee,
      lArmDir: la.dir, rArmDir: ra.dir, eye,
    },
    parts,
  };
}

/**
 * New astronaut instance (geometry shared). `firstPerson` drops the helmet and renders single-sided so the
 * camera can sit inside the suit.
 */
export async function createSuitRig(firstPerson: boolean): Promise<SuitRig> {
  sourcePromise ??= buildSource();
  const src = await sourcePromise;
  const j = src.joints;
  const group = (parent: THREE.Object3D, at: THREE.Vector3, from = new THREE.Vector3()): THREE.Group => {
    const g = new THREE.Group();
    g.position.copy(at).sub(from);
    parent.add(g);
    return g;
  };
  const root = new THREE.Group();
  root.name = firstPerson ? 'astronaut-fp' : 'astronaut';
  const helmet = group(root, new THREE.Vector3());
  const lShoulder = group(root, j.lShoulder);
  const rShoulder = group(root, j.rShoulder);
  const lElbow = group(lShoulder, j.lElbow, j.lShoulder);
  const rElbow = group(rShoulder, j.rElbow, j.rShoulder);
  const lHip = group(root, j.lHip);
  const rHip = group(root, j.rHip);
  const lKnee = group(lHip, j.lKnee, j.lHip);
  const rKnee = group(rHip, j.rKnee, j.rHip);
  const holder: Record<SegmentId, THREE.Object3D> = {
    torso: root, helmet, lUpper: lShoulder, lFore: lElbow, rUpper: rShoulder, rFore: rElbow,
    lThigh: lHip, lShin: lKnee, rThigh: rHip, rShin: rKnee,
  };
  const materials = new Map<THREE.Material, THREE.Material>();
  const materialFor = (m: THREE.Material): THREE.Material => {
    if (!firstPerson) return m;
    let fp = materials.get(m);
    if (!fp) {
      fp = m.clone();
      fp.side = THREE.FrontSide;
      materials.set(m, fp);
    }
    return fp;
  };
  for (const id of SEGMENTS) {
    for (const part of src.parts[id]) holder[id].add(new THREE.Mesh(part.geometry, materialFor(part.material)));
  }
  // Fabric covers so bent elbows and knees, and hips in a long stride, never show a gap.
  const fabric = src.parts.lUpper[0]?.material ?? new THREE.MeshStandardMaterial({ color: 0xeaebf3, roughness: 0.92 });
  const joint = new THREE.SphereGeometry(1, 16, 12);
  for (const [g, r] of [[lElbow, 0.055], [rElbow, 0.055], [lKnee, 0.075], [rKnee, 0.075], [lHip, 0.098], [rHip, 0.098]] as const) {
    const m = new THREE.Mesh(joint, materialFor(fabric));
    m.scale.setScalar(r);
    g.add(m);
  }
  helmet.visible = !firstPerson;
  return { root, joints: j, helmet, lShoulder, rShoulder, lElbow, rElbow, lHip, rHip, lKnee, rKnee };
}

const tmpDir = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const xAxis = new THREE.Vector3(1, 0, 0);

function aimArm(shoulder: THREE.Group, elbow: THREE.Group, bindDir: THREE.Vector3, side: -1 | 1, raiseDeg: number, spreadDeg: number, elbowDeg: number): void {
  const a = raiseDeg * DEG2RAD;
  const b = spreadDeg * DEG2RAD;
  tmpDir.set(side * Math.sin(b), -Math.cos(a) * Math.cos(b), -Math.sin(a) * Math.cos(b)).normalize();
  shoulder.quaternion.setFromUnitVectors(bindDir, tmpDir);
  // Bind arms lie close to the body's YZ plane, so flexing about the shoulder-local X axis bends the elbow upward.
  elbow.quaternion.copy(tmpQ.setFromAxisAngle(xAxis, elbowDeg * DEG2RAD));
}

export function poseSuit(rig: SuitRig, p: SuitPose): void {
  aimArm(rig.lShoulder, rig.lElbow, rig.joints.lArmDir, -1, p.lRaise, p.lSpread, p.lElbow);
  aimArm(rig.rShoulder, rig.rElbow, rig.joints.rArmDir, 1, p.rRaise, p.rSpread, p.rElbow);
  rig.lHip.rotation.set(p.lHip * DEG2RAD, 0, 0);
  rig.rHip.rotation.set(p.rHip * DEG2RAD, 0, 0);
  rig.lKnee.rotation.set(-p.lKnee * DEG2RAD, 0, 0);
  rig.rKnee.rotation.set(-p.rKnee * DEG2RAD, 0, 0);
}
