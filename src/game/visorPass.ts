/**
 * Helmet visor look for the first-person view: rounded vignette from the helmet rim, a touch of radial
 * chromatic aberration from the curved visor, and very faint sensor grain. Runs on linear HDR colour,
 * before tone mapping.
 */
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export function createVisorPass(): ShaderPass {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uStrength: { value: 0 },
      uTime: { value: 0 },
      uAspect: { value: 16 / 9 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uStrength;
      uniform float uTime;
      uniform float uAspect;
      varying vec2 vUv;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      }

      void main() {
        vec2 c = vUv - 0.5;
        float r = length(c * vec2(uAspect, 1.0)) / length(vec2(uAspect, 1.0) * 0.5);
        // Lateral colour from the curved visor grows toward the rim.
        vec2 shift = c * 0.004 * uStrength * r * r;
        vec3 col;
        col.r = texture2D(tDiffuse, vUv - shift).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv + shift).b;
        // Helmet rim: a soft, slightly squared falloff.
        vec2 q = abs(c) * 2.0;
        float rim = pow(pow(q.x, 4.0) + pow(q.y, 4.0), 0.25);
        float vignette = 1.0 - uStrength * 0.55 * smoothstep(0.62, 1.12, rim);
        float grain = (hash(vUv * 1000.0 + uTime) - 0.5) * 0.012 * uStrength;
        gl_FragColor = vec4(col * vignette + grain * (col + 0.02), 1.0);
      }
    `,
  });
}
