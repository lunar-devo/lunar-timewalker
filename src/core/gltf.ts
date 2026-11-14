/**
 * Shared GLB loading. NASA 3D Resources models are Draco-compressed with WebP textures; the Draco
 * decoder is served from public/libs/draco/. Each call returns an independent clone.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { assetUrl } from './assets';

let loader: GLTFLoader | null = null;
const cache = new Map<string, Promise<THREE.Group>>();

/**
 * Load `public/assets/models/<file>` and return a clone of its scene.
 * Geometry and textures are shared between clones; materials are cloned so callers may tint them.
 */
export async function loadGlb(file: string): Promise<THREE.Group> {
  if (!loader) {
    const draco = new DRACOLoader();
    draco.setDecoderPath(assetUrl('libs/draco/'));
    loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
  }
  let pending = cache.get(file);
  if (!pending) {
    pending = loader.loadAsync(assetUrl('assets/models/' + file)).then((gltf) => gltf.scene);
    cache.set(file, pending);
  }
  const original = await pending;
  const clone = original.clone(true);
  clone.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone();
    }
  });
  return clone;
}

/** Scale and recentre a model so its bounding box has the given height (meters) and sits on y = 0. */
export function fitModelToHeight(model: THREE.Object3D, heightM: number): void {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = heightM / Math.max(size.y, 1e-6);
  model.scale.multiplyScalar(scale);
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;
}
