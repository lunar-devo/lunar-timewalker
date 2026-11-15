/**
 * Camera lens flare for the Sun: a soft halo, a horizontal streak and a few ghost reflections strung along
 * the line from the Sun through the image centre. Drawn after the scene in screen space; it fades when the
 * Sun is behind terrain, covered by the glove, or out of view.
 */
import * as THREE from 'three';

interface Ghost {
  /** Position along the Sun → centre line: 0 = at the Sun, 1 = centre, 2 = mirrored across the centre. */
  t: number;
  size: number;
  color: THREE.Color;
}

const GHOSTS: Ghost[] = [
  { t: 0.55, size: 0.05, color: new THREE.Color(0.25, 0.45, 0.35) },
  { t: 1.25, size: 0.09, color: new THREE.Color(0.18, 0.25, 0.45) },
  { t: 1.55, size: 0.035, color: new THREE.Color(0.45, 0.3, 0.15) },
  { t: 1.9, size: 0.14, color: new THREE.Color(0.12, 0.2, 0.3) },
];

/** Time constant (ms) with which the flare follows changes of its strength. */
const FLARE_EASE_MS = 100;

function ringTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.25)');
    g.addColorStop(0.86, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }
  return new THREE.CanvasTexture(c);
}

function glowTexture(): THREE.CanvasTexture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.15, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }
  return new THREE.CanvasTexture(c);
}

export interface LensFlare {
  /** sunDir: world-space unit vector toward the Sun; strength: 0..1 visibility of the bare Sun. */
  update(sunDir: THREE.Vector3, camera: THREE.PerspectiveCamera, strength: number): void;
  /**
   * Draws the flare. `view` is the part of the full frame being rendered, in its NDC (tiled
   * high-resolution captures); omitted = the whole frame.
   */
  render(renderer: THREE.WebGLRenderer, view?: FlareView): void;
  dispose(): void;
}

/** Screen rectangle in the full frame's NDC. */
export interface FlareView {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function createLensFlare(): LensFlare {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const ring = ringTexture();
  const glow = glowTexture();
  const quad = new THREE.PlaneGeometry(1, 1);
  const material = (map: THREE.Texture, color: THREE.Color): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
    map, color, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
  });

  const halo = new THREE.Mesh(quad, material(glow, new THREE.Color(1.0, 0.9, 0.75)));
  const streak = new THREE.Mesh(quad, material(glow, new THREE.Color(0.6, 0.7, 1.0)));
  const ghosts = GHOSTS.map((g) => {
    const m = new THREE.Mesh(quad, material(ring, g.color.clone()));
    scene.add(m);
    return { def: g, mesh: m };
  });
  scene.add(halo, streak);
  let visible = false;
  /** The strength drawn, eased towards the asked one, and when it was last updated (ms). */
  let shown = 0;
  let lastMs = performance.now();
  const ndc = new THREE.Vector3();

  return {
    update(sunDir: THREE.Vector3, cam: THREE.PerspectiveCamera, strength: number): void {
      ndc.copy(sunDir).multiplyScalar(1000).add(cam.position).project(cam);
      const inFront = ndc.z < 1;
      // Fade out as the Sun leaves the frame (a little beyond the edge still scatters light into the lens).
      const edge = Math.max(Math.abs(ndc.x), Math.abs(ndc.y));
      const k = inFront ? strength * (1 - THREE.MathUtils.smoothstep(edge, 0.9, 1.4)) : 0;
      // The skyline the strength comes from is rebuilt in steps as the astronaut walks: easing over a tenth of a
      // second turns those steps into a fade, while the Sun setting behind a ridge is still followed closely.
      const nowMs = performance.now();
      shown += (k - shown) * (1 - Math.exp(-(nowMs - lastMs) / FLARE_EASE_MS));
      lastMs = nowMs;
      visible = shown > 0.005;
      if (!visible) return;
      const aspect = cam.aspect;
      const place = (mesh: THREE.Mesh, x: number, y: number, size: number, sx = 1): void => {
        mesh.position.set(x, y, 0);
        mesh.scale.set((size * sx) / aspect, size, 1);
      };
      place(halo, ndc.x, ndc.y, 0.55, 1);
      (halo.material as THREE.MeshBasicMaterial).opacity = 0.35 * shown;
      place(streak, ndc.x, ndc.y, 0.035, 22);
      (streak.material as THREE.MeshBasicMaterial).opacity = 0.25 * shown;
      for (const g of ghosts) {
        const t = g.def.t;
        place(g.mesh, ndc.x * (1 - t), ndc.y * (1 - t), g.def.size * 2, 1);
        (g.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 * shown;
      }
    },
    render(renderer: THREE.WebGLRenderer, view?: FlareView): void {
      if (!visible) return;
      camera.left = view?.left ?? -1;
      camera.right = view?.right ?? 1;
      camera.top = view?.top ?? 1;
      camera.bottom = view?.bottom ?? -1;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    },
    dispose(): void {
      quad.dispose();
      ring.dispose();
      glow.dispose();
    },
  };
}
