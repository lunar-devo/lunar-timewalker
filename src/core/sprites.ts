/** Shared round particle sprite: points drawn with it read as soft grains instead of squares. */
import * as THREE from 'three';

let dot: THREE.CanvasTexture | null = null;

export function softDotTexture(): THREE.CanvasTexture {
  if (dot) return dot;
  const s = 32;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }
  dot = new THREE.CanvasTexture(c);
  return dot;
}
