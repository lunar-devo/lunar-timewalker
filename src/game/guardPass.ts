/**
 * Safety net in front of the bloom pass: turns NaN, infinite and negative pixels into valid ones.
 * A single NaN pixel (say, a pow() of a value a hair below zero) is otherwise smeared by the bloom mip
 * chain into black squares that flicker as the view moves.
 */
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** Largest radiance kept; well inside the half-float range so that sums in the bloom chain stay finite. */
const MAX_RADIANCE = 4000;

export function createGuardPass(): ShaderPass {
  return new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;

      // Written as selections, never as arithmetic: NaN times zero is still NaN.
      float sane(float x) {
        if (isnan(x) || isinf(x)) return x > 0.0 ? ${MAX_RADIANCE.toFixed(1)} : 0.0;
        if (!(x >= 0.0)) return 0.0;
        return x < ${MAX_RADIANCE.toFixed(1)} ? x : ${MAX_RADIANCE.toFixed(1)};
      }

      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        gl_FragColor = vec4(sane(c.r), sane(c.g), sane(c.b), 1.0);
      }
    `,
  });
}
