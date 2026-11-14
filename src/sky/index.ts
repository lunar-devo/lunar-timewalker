/**
 * Lunar sky renderer:
 *   - ICRF/J2000 star dome + constellation figures (SVS #4851) sampled seamlessly by direction
 *   - 5,080 real bright stars from NASA HEASARC BSC5P with B-V colour temperatures
 *   - HDR Sun disc + limb darkening + glare/corona sprite
 *   - Earth sphere in true Earth-fixed orientation with day/night, Rayleigh limb, and per-fragment
 *     solar/lunar eclipse shadow computed directly from sunPosEarthFixedKm & moonPosEarthFixedKm
 *   - Five naked-eye planets (point beacons + resolved lit spheres & Saturn rings in telescope)
 *   - Historical supernovae (HDR diffraction starburst + expanding remnant shell) & comets (coma + ion/dust tails)
 */
import * as THREE from 'three';
import type {
  BodyId, ISky, QualityProfile, SkyFrame, TransientState, Vec3, WorldId,
} from '../core/types';
import { assetUrl, fetchJson, hasAsset, texUrl } from '../core/assets';
import { GALAXIES, cityLightsFor, earthImageryFor } from '../content';
const DEG2RAD = Math.PI / 180;
const SKY_RADIUS = 100;
/** Sky taken in by one pixel of the finest star map (8192 pixels round), degrees. */
const STAR_MAP_DEG_PER_PIXEL = 360 / 8192;
/** How long to wait before asking again for a picture that failed to load. */
const TEXTURE_RETRY_SEC = 5;

interface BrightStarsPayload {
  columns: string[];
  stars: Array<[number, number, number, number]>;
}

const PLANET_IDS: Array<Exclude<BodyId, 'sun' | 'earth'>> = [
  'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune',
];

const PLANET_TINT: Record<Exclude<BodyId, 'sun' | 'earth'>, THREE.Color> = {
  mercury: new THREE.Color(0xd6d3d1),
  venus: new THREE.Color(0xfef3c7),
  mars: new THREE.Color(0xf97316),
  jupiter: new THREE.Color(0xfde68a),
  saturn: new THREE.Color(0xfcd34d),
  uranus: new THREE.Color(0x7dd3fc),
  neptune: new THREE.Color(0x60a5fa),
};

function bvToRgb(bv: number): [number, number, number] {
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  // Approximate blackbody RGB (linear)
  const tk = Math.max(2500, Math.min(25000, t)) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (tk <= 66) {
    r = 1;
    g = Math.max(0, Math.min(1, (99.4708 * Math.log(tk) - 161.1196) / 255));
    b = tk <= 19 ? 0 : Math.max(0, Math.min(1, (138.5177 * Math.log(tk - 10) - 305.0448) / 255));
  } else {
    r = Math.max(0, Math.min(1, (329.6987 * Math.pow(tk - 60, -0.1332)) / 255));
    g = Math.max(0, Math.min(1, (288.1222 * Math.pow(tk - 60, -0.0755)) / 255));
    b = 1;
  }
  return [r, g, b];
}

function createStarburstTexture(): THREE.CanvasTexture {
  const sz = 256;
  const c = document.createElement('canvas');
  c.width = sz;
  c.height = sz;
  const ctx = c.getContext('2d')!;
  const half = sz / 2;

  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.12, 'rgba(220,240,255,0.85)');
  grad.addColorStop(0.38, 'rgba(130,190,255,0.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, sz, sz);

  // Diffraction spikes
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2.0;
  for (const ang of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(ang);
    const len = ang === 0 || ang === Math.PI / 2 ? half * 0.95 : half * 0.55;
    const lg = ctx.createLinearGradient(-len, 0, len, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = lg;
    ctx.beginPath();
    ctx.moveTo(-len, 0);
    ctx.lineTo(len, 0);
    ctx.stroke();
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Apparent magnitude → linear display intensity (true flux ratio, 2.512× per magnitude).
 * Mag 0 → 2.5 (just above the bloom threshold), mag 3 → 0.16, mag 6 → 0.01. Capped so nothing whites out the frame.
 */
function magnitudeToIntensity(mag: number): number {
  if (mag >= 20) return 0;
  return Math.min(12, 2.5 * Math.pow(10, -0.4 * mag));
}

export function createSky(_renderer: THREE.WebGLRenderer): ISky {
  const scene = new THREE.Scene();
  const texLoader = new THREE.TextureLoader();
  const burstTex = createStarburstTexture();

  // 1. Celestial group in ICRF/J2000 coordinates, rotated each frame by frame.sky.localFromIcrf
  const celestialGroup = new THREE.Group();
  scene.add(celestialGroup);

  const domeUniforms = {
    uStarsMap: { value: new THREE.Texture() },
    uConstMap: { value: new THREE.Texture() },
    uHasConst: { value: 0.0 },
    uStarVis: { value: 1.0 },
    uConstOpacity: { value: 0.0 },
    uTexWidth: { value: 4096 },
    /** Mip level: log2 of texels per screen pixel. Set per frame from the field of view. */
    uLod: { value: 0.0 },
  };

  const domeMat = new THREE.ShaderMaterial({
    uniforms: domeUniforms,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vIcrfDir;
      void main() {
        vIcrfDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uStarsMap;
      uniform sampler2D uConstMap;
      uniform float uHasConst;
      uniform float uStarVis;
      uniform float uConstOpacity;
      uniform float uLod;
      varying vec3 vIcrfDir;
      const float PI = 3.141592653589793;

      vec3 srgbToLinear(vec3 c) {
        return pow(max(c, vec3(0.0)), vec3(2.2));
      }

      void main() {
        vec3 d = normalize(vIcrfDir);
        float ra = atan(d.y, d.x);
        float dec = asin(clamp(d.z, -1.0, 1.0));
        // SVS #4851 convention: RA 0h at u=0.5, RA increasing to the LEFT; +90 Dec at top (v=1 with flipY)
        vec2 uv = vec2(fract(0.5 - ra / (2.0 * PI)), 0.5 + dec / PI);
        // An explicit level avoids the derivative jump (and visible seam) where u wraps around.
        vec3 starTex = srgbToLinear(textureLod(uStarsMap, uv, uLod).rgb);
        // Diffuse galactic light stays a faint veil even to dark-adapted eyes; bright stars come from the catalogue.
        vec3 col = starTex * (0.25 * uStarVis);

        if (uHasConst > 0.5 && uConstOpacity > 0.001) {
          vec3 cLine = textureLod(uConstMap, uv, max(uLod - 0.5, 0.0)).rgb;
          col += cLine * vec3(0.28, 0.58, 0.95) * uConstOpacity * uStarVis;
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const domeMesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS * 0.98, 48, 32), domeMat);
  domeMesh.renderOrder = 1;
  domeMesh.frustumCulled = false;
  celestialGroup.add(domeMesh);

  // 2. HEASARC BSC5P bright star points cloud
  const starPointUniforms = {
    uStarVis: { value: 1.0 },
    uFovScale: { value: 1.0 },
    uPixelRatio: { value: Math.min(2, window.devicePixelRatio || 1) },
  };
  const starPointsGeo = new THREE.BufferGeometry();
  const starPointsMat = new THREE.ShaderMaterial({
    uniforms: starPointUniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aMag;
      attribute vec3 aColor;
      uniform float uStarVis;
      uniform float uFovScale;
      uniform float uPixelRatio;
      varying vec3 vColor;

      void main() {
        vColor = aColor * min(2.5 * pow(10.0, -0.4 * aMag), 4.0) * uStarVis;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        float baseSize = clamp(1.5 + (2.5 - aMag) * 0.45, 1.4, 4.0);
        gl_PointSize = baseSize * uPixelRatio * uFovScale;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(p, p);
        if (r2 > 1.0) discard;
        float core = exp(-r2 * 4.5);
        gl_FragColor = vec4(vColor * core, core);
      }
    `,
  });
  const starPoints = new THREE.Points(starPointsGeo, starPointsMat);
  starPoints.renderOrder = 2;
  starPoints.frustumCulled = false;
  celestialGroup.add(starPoints);

  // 2b. Ecliptic plane arc (tilted 23.439° from the J2000 equator), faded in with Sky Guide [C].
  const eclPts: THREE.Vector3[] = [];
  const obl = 23.4392911 * DEG2RAD;
  const eclR = SKY_RADIUS * 0.96;
  for (let i = 0; i < 256; i++) {
    const lon = (i / 256) * Math.PI * 2;
    const x = Math.cos(lon) * eclR;
    const y0 = Math.sin(lon) * eclR;
    eclPts.push(new THREE.Vector3(x, y0 * Math.cos(obl), y0 * Math.sin(obl)));
  }
  const eclipticMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  const eclipticLine = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(eclPts), eclipticMat);
  eclipticLine.renderOrder = 2;
  celestialGroup.add(eclipticLine);

  // 2c. Real galaxies (Andromeda, M33, Whirlpool, Sombrero, M87, LMC, SMC), drawn with the first of the real
  // pictures of their close-ups, each at the place, width and rotation measured for it (content/galaxies.ts).
  const galaxyQuadGeo = new THREE.PlaneGeometry(1, 1);
  const galaxyMeshes = GALAXIES.map((g) => {
    const shot = g.pictures[0];
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: new THREE.Texture() },
        uAlpha: { value: 0 },
        uColour: { value: 0 },
        // A cut of the star map is full of field stars to its very edge: it thins out over a longer way.
        uEdgeStart: { value: shot.fromStarMap ? 0.4 : 0.75 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uAlpha;
        uniform float uColour;
        uniform float uEdgeStart;
        varying vec2 vUv;
        void main() {
          // A rounded edge, so that no frame shows against the sky.
          vec2 q = abs(vUv * 2.0 - 1.0);
          float fade = 1.0 - smoothstep(uEdgeStart, 1.0, pow(q.x * q.x * q.x + q.y * q.y * q.y, 1.0 / 3.0));
          vec3 col = texture2D(uMap, vUv).rgb;
          // Small in the view, a galaxy is a pale smudge, as to the eye; its picture's colours (some of them
          // false colours, of light the eye does not see) come in as it is magnified.
          col = mix(vec3(max(col.r, max(col.g, col.b))) * vec3(0.82, 0.9, 1.0), col, uColour);
          gl_FragColor = vec4(col * fade * uAlpha, 1.0);
        }
      `,
    });
    // The holder stands at the place of the picture's middle with x to the west, y to the north and z towards
    // the viewer: seen from inside the sky, that is a picture with north up and east to the left.
    const ra = shot.skyCentre[0] * DEG2RAD;
    const dec = shot.skyCentre[1] * DEG2RAD;
    const place = new THREE.Vector3(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
    const west = new THREE.Vector3(Math.sin(ra), -Math.cos(ra), 0);
    const north = new THREE.Vector3(-Math.sin(dec) * Math.cos(ra), -Math.sin(dec) * Math.sin(ra), Math.cos(dec));
    const holder = new THREE.Group();
    holder.position.copy(place).multiplyScalar(SKY_RADIUS * 0.87);
    holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(west, north, place.clone().negate()));
    const turned = new THREE.Group();
    turned.rotation.z = shot.northUpDeg * DEG2RAD;
    const mesh = new THREE.Mesh(galaxyQuadGeo, mat);
    mesh.renderOrder = 3;
    turned.add(mesh);
    holder.add(turned);
    holder.visible = false;
    celestialGroup.add(holder);
    return { def: g, shot, holder, mesh, mat, loaded: false, loading: false };
  });
  /** When the galaxies still without their picture are next asked for it, on the clock of `animTime`. */
  let galaxyPicturesDueAt = 0;

  // 2d. World atmosphere dome (Mars, Earth, Venus amber clouds, Uranus/Neptune haze) + sky rings.
  let activeWorld: WorldId = 'moon';
  const atmoUniforms = {
    uMode: { value: 0.0 }, // 0=vacuum, 1=mars, 2=earth, 3=venus, 4=uranus, 5=neptune
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  };
  const atmoDome = new THREE.Mesh(
    new THREE.SphereGeometry(SKY_RADIUS * 0.94, 32, 24),
    new THREE.ShaderMaterial({
      uniforms: atmoUniforms,
      side: THREE.BackSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float uMode;
        uniform vec3 uSunDir;
        varying vec3 vDir;
        void main() {
          if (uMode < 0.5) discard;
          float sunEl = uSunDir.y;
          float day = smoothstep(-0.14, 0.18, sunEl);
          float twi = smoothstep(-0.22, -0.02, sunEl) * (1.0 - smoothstep(-0.02, 0.20, sunEl));
          float y = clamp(vDir.y, 0.0, 1.0);
          float sunGlow = pow(max(0.0, dot(vDir, uSunDir)), 6.0);
          if (uMode < 1.5) {
            // Mars: dusty butterscotch sky with cool blue glow near the Sun at low elevation
            vec3 marsDay = mix(vec3(0.82, 0.54, 0.36), vec3(0.46, 0.28, 0.20), pow(y, 0.55));
            vec3 marsSun = mix(marsDay, vec3(0.60, 0.72, 0.88), sunGlow * (0.4 + 0.5 * twi));
            float a = clamp(day * 0.88 + twi * 0.55, 0.0, 0.92);
            gl_FragColor = vec4(marsSun * (day * 0.9 + twi * 0.45), a);
          } else if (uMode < 2.5) {
            // Earth: Rayleigh blue sky + sunset warm horizon
            vec3 zenith = vec3(0.10, 0.32, 0.78);
            vec3 horiz = mix(vec3(0.45, 0.68, 0.96), vec3(0.95, 0.46, 0.20), twi * (0.5 + 0.5 * sunGlow));
            vec3 skyCol = mix(horiz, zenith, pow(y, 0.52)) + vec3(1.0, 0.88, 0.70) * sunGlow * 0.25 * day;
            float a = clamp(day * 0.96 + twi * 0.65, 0.0, 0.98);
            gl_FragColor = vec4(skyCol * (day + twi * 0.5), a);
          } else if (uMode < 3.5) {
            // Venus: dense opaque sulfuric-amber cloud deck (stars hidden, Sun is a soft diffuse patch)
            float cloudBand = 0.92 + 0.08 * sin(vDir.y * 14.0 + vDir.x * 4.0);
            vec3 venusCol = mix(vec3(0.72, 0.44, 0.16), vec3(0.88, 0.64, 0.28), pow(1.0 - y, 0.7)) * cloudBand;
            venusCol += vec3(1.0, 0.82, 0.45) * sunGlow * 0.35 * (0.3 + 0.7 * day);
            float lit = 0.24 + 0.76 * day + 0.25 * twi;
            gl_FragColor = vec4(venusCol * lit, 0.97);
          } else if (uMode < 4.5) {
            // Uranus: pale cyan methane upper-atmosphere glow
            vec3 urCol = mix(vec3(0.24, 0.54, 0.60), vec3(0.08, 0.22, 0.30), pow(y, 0.6));
            float a = clamp((day * 0.52 + twi * 0.25) * (1.0 - y * 0.4), 0.0, 0.58);
            gl_FragColor = vec4(urCol * (0.3 + 0.7 * day), a);
          } else {
            // Neptune: deep cobalt upper-atmosphere scatter
            vec3 neCol = mix(vec3(0.10, 0.24, 0.58), vec3(0.03, 0.08, 0.24), pow(y, 0.6));
            float a = clamp((day * 0.48 + twi * 0.22) * (1.0 - y * 0.4), 0.0, 0.54);
            gl_FragColor = vec4(neCol * (0.3 + 0.7 * day), a);
          }
        }
      `,
    }),
  );
  atmoDome.renderOrder = 14;
  atmoDome.frustumCulled = false;
  atmoDome.visible = false;
  scene.add(atmoDome);

  // Saturn & Uranus sky ring arches when floating above their clouds
  const saturnSkyRingGeo = new THREE.RingGeometry(SKY_RADIUS * 0.62, SKY_RADIUS * 0.90, 96);
  const saturnSkyRingMat = new THREE.MeshBasicMaterial({
    color: 0xf4e3c1, side: THREE.DoubleSide, transparent: true, opacity: 0.62, depthTest: false, depthWrite: false,
  });
  const saturnSkyRing = new THREE.Mesh(saturnSkyRingGeo, saturnSkyRingMat);
  saturnSkyRing.rotation.set(Math.PI * 0.42, 0.15, 0.12);
  saturnSkyRing.renderOrder = 4;
  saturnSkyRing.visible = false;
  scene.add(saturnSkyRing);

  const uranusSkyRingGeo = new THREE.RingGeometry(SKY_RADIUS * 0.78, SKY_RADIUS * 0.85, 96);
  const uranusSkyRingMat = new THREE.MeshBasicMaterial({
    color: 0xa5d8e8, side: THREE.DoubleSide, transparent: true, opacity: 0.34, depthTest: false, depthWrite: false,
  });
  const uranusSkyRing = new THREE.Mesh(uranusSkyRingGeo, uranusSkyRingMat);
  uranusSkyRing.rotation.set(Math.PI * 0.10, 0.48, 0.05);
  uranusSkyRing.renderOrder = 4;
  uranusSkyRing.visible = false;
  scene.add(uranusSkyRing);
  // 3. Sun disc + glare sprite
  const sunGroup = new THREE.Group();
  scene.add(sunGroup);
  const sunDiscMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(24, 22.5, 20),
    depthTest: false,
    depthWrite: false,
  });
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 36), sunDiscMat);
  sunDisc.renderOrder = 5;
  sunGroup.add(sunDisc);

  const sunGlareMat = new THREE.SpriteMaterial({
    map: burstTex,
    color: new THREE.Color(1.4, 1.25, 1.0),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const sunGlareSprite = new THREE.Sprite(sunGlareMat);
  sunGlareSprite.renderOrder = 6;
  sunGroup.add(sunGlareSprite);

  // 4. Earth sphere in Earth-fixed coordinates with real-time per-fragment solar & lunar eclipse shader
  const earthUniforms = {
    uDayMap: { value: new THREE.Texture() },
    uNightMap: { value: new THREE.Texture() },
    uCityLights: { value: 0.0 },
    uSunPosEfKm: { value: new THREE.Vector3(149_597_870, 0, 0) },
    uMoonPosEfKm: { value: new THREE.Vector3(384_400, 0, 0) },
    uLunarEclipse: { value: 0.0 },
  };
  const earthMat = new THREE.ShaderMaterial({
    uniforms: earthUniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vBodyFixedDir;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      void main() {
        vBodyFixedDir = normalize(position);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * position);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uDayMap;
      uniform sampler2D uNightMap;
      uniform float uCityLights;
      uniform vec3 uSunPosEfKm;
      uniform vec3 uMoonPosEfKm;
      uniform float uLunarEclipse;
      varying vec3 vBodyFixedDir;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;

      const float PI = 3.141592653589793;
      const float R_EARTH_KM = 6371.0;
      const float R_SUN_KM = 695700.0;
      const float R_MOON_KM = 1737.4;

      float discOverlap(float r1, float r2, float d) {
        if (d >= r1 + r2) return 0.0;
        if (d <= abs(r1 - r2)) {
          float rm = min(r1, r2);
          return clamp((rm * rm) / max(1e-7, r1 * r1), 0.0, 1.0);
        }
        float r1Sq = r1 * r1;
        float r2Sq = r2 * r2;
        float a = acos(clamp((d * d + r1Sq - r2Sq) / (2.0 * d * r1), -1.0, 1.0));
        float b = acos(clamp((d * d + r2Sq - r1Sq) / (2.0 * d * r2), -1.0, 1.0));
        float area = r1Sq * a + r2Sq * b
          - 0.5 * sqrt(max(0.0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
        return clamp(area / (PI * r1Sq), 0.0, 1.0);
      }

      void main() {
        vec3 nEf = normalize(vBodyFixedDir);
        float lon = atan(nEf.y, nEf.x);
        float lat = asin(clamp(nEf.z, -1.0, 1.0));
        vec2 uv = vec2(fract((lon + PI) / (2.0 * PI)), 0.5 + lat / PI);

        // sRGB textures are decoded to linear by the GPU.
        vec3 dayAlbedo = texture2D(uDayMap, uv).rgb;
        vec3 sunDirEf = normalize(uSunPosEfKm);
        float ndl = dot(nEf, sunDirEf);
        float diff = smoothstep(-0.06, 0.85, ndl);

        // Per-fragment solar eclipse on Earth (Moon's umbra/penumbra cone intersection!)
        vec3 surfKm = nEf * R_EARTH_KM;
        vec3 toSun = uSunPosEfKm - surfKm;
        vec3 toMoon = uMoonPosEfKm - surfKm;
        float dSun = length(toSun);
        float dMoon = length(toMoon);
        float rSun = asin(R_SUN_KM / dSun);
        float rMoon = asin(R_MOON_KM / dMoon);
        float sep = acos(clamp(dot(toSun / dSun, toMoon / dMoon), -1.0, 1.0));
        float eclipseCover = ndl > -0.02 ? discOverlap(rSun, rMoon, sep) : 0.0;
        // Darken sharply inside umbra (cover > 0.92) and smoothly across penumbra
        float eclipseShadow = 1.0 - smoothstep(0.0, 0.98, eclipseCover) * 0.94;

        // Ocean specular glint (dark, blue pixels; clouds are bright and grey)
        vec3 viewDir = normalize(-vWorldPos);
        float isOcean = step(dayAlbedo.r + 0.01, dayAlbedo.b) * (1.0 - smoothstep(0.08, 0.2, dayAlbedo.g));
        vec3 moonDirEf = normalize(uMoonPosEfKm - surfKm);
        vec3 halfVec = normalize(sunDirEf + moonDirEf);
        float spec = pow(max(0.0, dot(nEf, halfVec)), 60.0) * isOcean * 0.5;

        // Rayleigh limb: blue on the day side, reddening toward the terminator.
        float rim = clamp(1.0 - dot(normalize(vWorldNormal), viewDir), 0.0, 1.0);
        float atmo = pow(rim, 3.0);
        vec3 atmoCol = mix(vec3(0.25, 0.55, 1.0), vec3(1.0, 0.45, 0.2), 1.0 - smoothstep(-0.05, 0.25, ndl));
        atmoCol = mix(atmoCol, vec3(1.0, 0.32, 0.12), uLunarEclipse);

        vec3 lit = (dayAlbedo * 1.6 * diff + vec3(1.0, 0.95, 0.85) * spec) * eclipseShadow;
        // City lights on the night side, faded where twilight still outshines them.
        vec3 lights = texture2D(uNightMap, uv).rgb * vec3(1.0, 0.8, 0.55) * 0.6 * uCityLights * (1.0 - smoothstep(-0.12, 0.04, ndl));
        float atmoLit = smoothstep(-0.25, 0.35, ndl);
        vec3 col = lit + lights + atmoCol * atmo * (0.8 * atmoLit + uLunarEclipse * 0.9);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const earthMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 36), earthMat);
  earthMesh.renderOrder = 12;
  earthMesh.frustumCulled = false;
  scene.add(earthMesh);

  // Moon sphere visible when standing on Earth, Mars, Mercury, etc.
  const moonSkyUniforms = {
    uMap: { value: new THREE.Texture() },
    uHasMap: { value: 0.0 },
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
  };
  const moonSkyMat = new THREE.ShaderMaterial({
    uniforms: moonSkyUniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      void main() {
        vUv = uv;
        vN = normalize(mat3(modelMatrix) * position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uHasMap;
      uniform vec3 uSunDir;
      varying vec2 vUv;
      varying vec3 vN;
      void main() {
        vec3 albedo = uHasMap > 0.5 ? texture2D(uMap, vUv).rgb : vec3(0.45);
        float ndl = max(0.0, dot(normalize(vN), normalize(uSunDir)));
        float lit = pow(ndl, 0.72) * 1.15 + 0.02;
        gl_FragColor = vec4(albedo * lit, 1.0);
      }
    `,
  });
  const moonSkyMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), moonSkyMat);
  moonSkyMesh.renderOrder = 11;
  moonSkyMesh.frustumCulled = false;
  moonSkyMesh.visible = false;
  scene.add(moonSkyMesh);

  // 5. Planets (point sprite + resolved sphere for telescope zoom)
  interface PlanetVisual {
    id: Exclude<BodyId, 'sun' | 'earth'>;
    group: THREE.Group;
    sprite: THREE.Sprite;
    spriteMat: THREE.SpriteMaterial;
    sphere: THREE.Mesh;
    sphereMat: THREE.MeshBasicMaterial;
    ring?: THREE.Mesh;
  }
  const planets: PlanetVisual[] = [];
  for (const pid of PLANET_IDS) {
    const group = new THREE.Group();
    const spriteMat = new THREE.SpriteMaterial({
      map: burstTex,
      color: PLANET_TINT[pid].clone(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.renderOrder = 8;
    group.add(sprite);

    const sphereMat = new THREE.MeshBasicMaterial({
      color: PLANET_TINT[pid].clone(),
      depthTest: false,
      depthWrite: false,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), sphereMat);
    sphere.renderOrder = 9;
    group.add(sphere);

    let ring: THREE.Mesh | undefined;
    if (pid === 'saturn' || pid === 'uranus') {
      const ringGeo = pid === 'saturn'
        ? new THREE.RingGeometry(1.35, 2.35, 48)
        : new THREE.RingGeometry(1.35, 1.65, 48);
      ringGeo.rotateX(pid === 'saturn' ? Math.PI / 2 - 0.42 : 0.15);
      const ringMat = new THREE.MeshBasicMaterial({
        color: pid === 'saturn' ? 0xe7cba0 : 0x99d5e8,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: pid === 'saturn' ? 0.78 : 0.42,
        depthTest: false,
        depthWrite: false,
      });
      ring = new THREE.Mesh(ringGeo, ringMat);
      ring.renderOrder = 9;
      sphere.add(ring);
    }
    scene.add(group);
    planets.push({ id: pid, group, sprite, spriteMat, sphere, sphereMat, ring });
  }

  // 6. Transients (Supernovae & Comets)
  interface TransientVisual {
    group: THREE.Group;
    starSprite: THREE.Sprite;
    starMat: THREE.SpriteMaterial;
    remnantMesh: THREE.Mesh;
    remnantMat: THREE.ShaderMaterial;
    ionTail: THREE.Mesh;
    ionMat: THREE.ShaderMaterial;
    dustTail: THREE.Mesh;
    dustMat: THREE.ShaderMaterial;
  }
  const transientMap = new Map<string, TransientVisual>();

  function getOrCreateTransientVisual(id: string): TransientVisual {
    const existing = transientMap.get(id);
    if (existing) return existing;

    const group = new THREE.Group();
    const starMat = new THREE.SpriteMaterial({
      map: burstTex,
      color: new THREE.Color(1, 1, 1),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const starSprite = new THREE.Sprite(starMat);
    starSprite.renderOrder = 10;
    group.add(starSprite);

    // Expanding supernova remnant filament ring (visible in telescope zoom)
    const remnantMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uTint: { value: new THREE.Color(0.45, 0.85, 1.0) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uTint;
        varying vec2 vUv;
        void main() {
          float r = length(vUv);
          if (r > 1.0) discard;
          float ang = atan(vUv.y, vUv.x);
          float fil = 0.55 + 0.45 * sin(ang * 14.0 + r * 9.0 + uTime * 0.4) * cos(ang * 9.0 - r * 7.0);
          float shell = smoothstep(0.15, 0.82, r) * (1.0 - smoothstep(0.82, 1.0, r));
          vec3 col = mix(vec3(1.0, 0.42, 0.25), uTint, r) * (shell * 1.6 + (1.0 - r) * 0.45) * fil;
          gl_FragColor = vec4(col, shell * 0.9);
        }
      `,
    });
    const remnantMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), remnantMat);
    remnantMesh.renderOrder = 10;
    group.add(remnantMesh);

    // Comet ion & dust tail ribbons (origin at 0, extending along +Y of local mesh)
    const makeTailMat = (r: number, g: number, b: number): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(r, g, b) }, uAlpha: { value: 1 } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uAlpha;
          varying vec2 vUv;
          void main() {
            float x = abs(vUv.x * 2.0 - 1.0);
            float core = pow(max(0.0, 1.0 - x), 2.2);
            float along = pow(max(0.0, 1.0 - vUv.y), 1.45) * smoothstep(0.0, 0.08, vUv.y);
            float a = core * along * uAlpha;
            gl_FragColor = vec4(uColor * a * 2.2, a);
          }
        `,
      });

    const tailGeo = new THREE.PlaneGeometry(1, 1);
    tailGeo.translate(0, 0.5, 0);
    const ionMat = makeTailMat(0.38, 0.78, 1.0);
    const ionTail = new THREE.Mesh(tailGeo, ionMat);
    ionTail.renderOrder = 9;
    const dustMat = makeTailMat(1.0, 0.88, 0.62);
    const dustTail = new THREE.Mesh(tailGeo, dustMat);
    dustTail.renderOrder = 9;
    group.add(ionTail, dustTail);

    scene.add(group);
    const vis: TransientVisual = {
      group, starSprite, starMat, remnantMesh, remnantMat, ionTail, ionMat, dustTail, dustMat,
    };
    transientMap.set(id, vis);
    return vis;
  }

  const icrfMat4 = new THREE.Matrix4();
  const earthMat4 = new THREE.Matrix4();
  let animTime = 0;

  let currentQuality: QualityProfile | null = null;
  /** Counts the changes of quality: a texture that arrives for an older one is thrown away. */
  let qualitySeq = 0;
  /** The Earth picture on the globe and the one being loaded (empty: none), and the count of such loads. */
  let earthTexName = '';
  let earthTexLoading = '';
  let earthTexSeq = 0;
  /** After a failed load, Earth's picture is not asked for again before this, on the clock of `animTime`. */
  let earthTexRetryAt = 0;

  /** Swaps in the Earth picture for a date (that day's clouds where available); no-op when already shown. */
  function showEarthImagery(name: string): void {
    if (!currentQuality || name === earthTexName || name === earthTexLoading || animTime < earthTexRetryAt) return;
    const url = texUrl(name, currentQuality) ?? texUrl('earth_day', currentQuality);
    if (!url) return;
    earthTexLoading = name;
    earthTexSeq += 1;
    const seq = earthTexSeq;
    texLoader.loadAsync(url).then((tex) => {
      if (seq !== earthTexSeq) {
        tex.dispose();
        return;
      }
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      const old = earthUniforms.uDayMap.value;
      earthUniforms.uDayMap.value = tex;
      old.dispose();
      earthTexName = name;
      earthTexLoading = '';
    }, () => {
      if (seq !== earthTexSeq) return;
      earthTexLoading = '';
      earthTexRetryAt = animTime + TEXTURE_RETRY_SEC;
    });
  }

  /** Asks for the sky picture of every galaxy that has none yet; one that fails is asked for again later. */
  function loadGalaxyPictures(): void {
    galaxyPicturesDueAt = animTime + TEXTURE_RETRY_SEC;
    for (const gm of galaxyMeshes) {
      const rel = `tex/galaxy_${gm.def.id}_${gm.shot.id}_sky.webp`;
      if (gm.loaded || gm.loading || !hasAsset(rel)) continue;
      gm.loading = true;
      texLoader.loadAsync(assetUrl(`assets/${rel}`)).then((gt) => {
        gt.colorSpace = THREE.SRGBColorSpace;
        gm.mat.uniforms.uMap.value.dispose();
        gm.mat.uniforms.uMap.value = gt;
        // The holder's unit is the picture's width.
        gm.mesh.scale.set(1, gt.image.height / gt.image.width, 1);
        gm.loaded = true;
        gm.loading = false;
      }, () => {
        gm.loading = false;
      });
    }
  }

  async function loadTexturesForQuality(quality: QualityProfile): Promise<void> {
    qualitySeq += 1;
    const seq = qualitySeq;
    currentQuality = quality;
    // Earth's picture is loaded again at the new size; one still on its way at the old size is thrown away.
    earthTexName = '';
    earthTexLoading = '';
    earthTexSeq += 1;
    earthTexRetryAt = 0;
    const starsUrl = texUrl('stars', quality);
    const nightUrl = texUrl('earth_night', quality);
    // Mars is a few dozen pixels wide even at the telescope's narrowest field: 2K is plenty there.
    const marsUrl = texUrl('mars_color', { ...quality, texTier: '2k' });
    const constUrl = texUrl('constellations', quality);
    if (!starsUrl || !marsUrl) throw new Error('Star or Mars texture missing from the asset manifest');

    const [starsTex, marsTex] = await Promise.all([texLoader.loadAsync(starsUrl), texLoader.loadAsync(marsUrl)]);
    if (seq !== qualitySeq) {
      starsTex.dispose();
      marsTex.dispose();
      return;
    }
    // Mip levels are picked explicitly in the shader (see uLod), which also avoids a seam at RA 0h.
    starsTex.minFilter = THREE.LinearMipmapLinearFilter;
    starsTex.magFilter = THREE.LinearFilter;
    domeUniforms.uStarsMap.value.dispose();
    domeUniforms.uStarsMap.value = starsTex;
    domeUniforms.uTexWidth.value = starsTex.image.width;

    marsTex.colorSpace = THREE.SRGBColorSpace;
    marsTex.anisotropy = 8;
    const marsPlanet = planets.find((p) => p.id === 'mars');
    if (marsPlanet) {
      marsPlanet.sphereMat.map?.dispose();
      marsPlanet.sphereMat.map = marsTex;
      marsPlanet.sphereMat.color.setHex(0xffffff);
      marsPlanet.sphereMat.needsUpdate = true;
    }

    const moonUrl = texUrl('moon_color', { ...quality, texTier: '2k' });
    if (moonUrl) {
      texLoader.loadAsync(moonUrl).then((mt) => {
        if (seq !== qualitySeq) {
          mt.dispose();
          return;
        }
        mt.colorSpace = THREE.SRGBColorSpace;
        moonSkyUniforms.uMap.value.dispose();
        moonSkyUniforms.uMap.value = mt;
        moonSkyUniforms.uHasMap.value = 1.0;
      }).catch(() => undefined);
    }
    if (nightUrl) {
      texLoader.loadAsync(nightUrl).then((nt) => {
        if (seq !== qualitySeq) {
          nt.dispose();
          return;
        }
        nt.colorSpace = THREE.SRGBColorSpace;
        earthUniforms.uNightMap.value.dispose();
        earthUniforms.uNightMap.value = nt;
      }).catch(() => undefined);
    }
    if (constUrl) {
      texLoader.loadAsync(constUrl).then((ct) => {
        if (seq !== qualitySeq) {
          ct.dispose();
          return;
        }
        ct.minFilter = THREE.LinearMipmapLinearFilter;
        ct.magFilter = THREE.LinearFilter;
        domeUniforms.uConstMap.value.dispose();
        domeUniforms.uConstMap.value = ct;
        domeUniforms.uHasConst.value = 1.0;
      }).catch(() => undefined);
    }
    loadGalaxyPictures();
  }

  return {
    scene,

    async load(quality: QualityProfile, onProgress?: (fraction: number) => void): Promise<void> {
      onProgress?.(0.1);
      await loadTexturesForQuality(quality);
      onProgress?.(0.65);

      // Load 5,080 bright stars from NASA HEASARC BSC5P
      try {
        const bsc = await fetchJson<BrightStarsPayload>('assets/data/bright_stars.json');
        const rows = bsc.stars;
        const count = rows.length;
        const positions = new Float32Array(count * 3);
        const mags = new Float32Array(count);
        const colors = new Float32Array(count * 3);
        const r = SKY_RADIUS * 0.96;

        for (let i = 0; i < count; i++) {
          const [raDeg, decDeg, vmag, bv] = rows[i];
          const ra = raDeg * DEG2RAD;
          const dec = decDeg * DEG2RAD;
          const cd = Math.cos(dec);
          positions[i * 3 + 0] = r * cd * Math.cos(ra);
          positions[i * 3 + 1] = r * cd * Math.sin(ra);
          positions[i * 3 + 2] = r * Math.sin(dec);
          mags[i] = vmag;
          const [cr, cg, cb] = bvToRgb(bv);
          colors[i * 3 + 0] = cr;
          colors[i * 3 + 1] = cg;
          colors[i * 3 + 2] = cb;
        }
        starPointsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        starPointsGeo.setAttribute('aMag', new THREE.BufferAttribute(mags, 1));
        starPointsGeo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
      } catch {
        // Star texture dome remains active even if catalog fetch fails
      }
      onProgress?.(1);
    },

    update(frame: SkyFrame, camera: THREE.PerspectiveCamera, dt: number): void {
      animTime += dt;
      const { sky } = frame;

      // 1. Rotate celestial sphere & bright stars by localFromIcrf
      const m = sky.localFromIcrf;
      icrfMat4.set(
        m[0], m[1], m[2], 0,
        m[3], m[4], m[5], 0,
        m[6], m[7], m[8], 0,
        0, 0, 0, 1,
      );
      celestialGroup.quaternion.setFromRotationMatrix(icrfMat4);

      // The star map resolves ~23 px per degree at 8K: in narrow fields it only shows blur, so the catalogue stars take over.
      const texPerDeg = domeUniforms.uTexWidth.value / 360;
      domeUniforms.uStarVis.value = frame.starVisibility * THREE.MathUtils.smoothstep(frame.fovDeg, 2048 / texPerDeg / 40, 2048 / texPerDeg / 12);
      const screenPx = Math.max(400, window.innerHeight * Math.min(2, window.devicePixelRatio || 1));
      domeUniforms.uLod.value = Math.max(0, Math.log2((texPerDeg * frame.fovDeg) / screenPx));
      const targetConst = frame.showConstellations ? 0.42 : 0;
      domeUniforms.uConstOpacity.value += (targetConst - domeUniforms.uConstOpacity.value) * Math.min(1, dt * 6);
      eclipticMat.opacity = (domeUniforms.uConstOpacity.value / 0.42) * 0.28;
      eclipticLine.visible = eclipticMat.opacity > 0.01;

      // World atmosphere + galaxies
      atmoUniforms.uSunDir.value.set(sky.bodies.sun.dirLocal[0], sky.bodies.sun.dirLocal[1], sky.bodies.sun.dirLocal[2]).normalize();
      const atmoCover = activeWorld === 'venus'
        ? 0.96
        : activeWorld === 'earth'
          ? THREE.MathUtils.smoothstep(sky.bodies.sun.elDeg, -8, 12) * 0.92
          : activeWorld === 'mars'
            ? THREE.MathUtils.smoothstep(sky.bodies.sun.elDeg, -8, 12) * 0.72
            : activeWorld === 'uranus' || activeWorld === 'neptune'
              ? THREE.MathUtils.smoothstep(sky.bodies.sun.elDeg, -10, 15) * 0.36
              : 0;
      const starFactor = Math.max(0.03, 1 - atmoCover);
      domeUniforms.uStarVis.value *= starFactor;
      starPointUniforms.uStarVis.value = frame.starVisibility * starFactor;
      const degPerPixel = frame.fovDeg / Math.max(400, window.innerHeight);
      for (const gm of galaxyMeshes) {
        const diskPx = gm.def.apparentDeg / degPerPixel;
        // A picture has its true size on the sky, unless that would leave what it shows of the galaxy under
        // two dozen pixels: then it is enlarged, so that the galaxy can still be found.
        const enlarge = Math.max(1, (degPerPixel * 24) / Math.min(gm.def.apparentDeg, gm.shot.fieldDeg * 0.7));
        gm.holder.scale.setScalar(2 * SKY_RADIUS * 0.87 * Math.tan(gm.shot.fieldDeg * enlarge * 0.5 * DEG2RAD));
        const faintZoom = gm.def.magnitude > 4.5 ? THREE.MathUtils.smoothstep(diskPx, 10, 40) : 1;
        // A cut of the star map is already in the sky: it comes in as the view is magnified past the map's
        // own pixels, to keep the galaxy sharp.
        const sharpens = gm.shot.fromStarMap ? THREE.MathUtils.smoothstep(STAR_MAP_DEG_PER_PIXEL / degPerPixel, 1, 2.5) : 1;
        gm.mat.uniforms.uAlpha.value = Math.max(0.18, frame.starVisibility) * starFactor * faintZoom * sharpens * (gm.def.magnitude < 4.5 ? 0.55 : 0.85);
        gm.mat.uniforms.uColour.value = THREE.MathUtils.smoothstep(diskPx, 70, 220);
        gm.holder.visible = gm.loaded && gm.mat.uniforms.uAlpha.value > 0.02;
      }
      // Once the sky's own textures have been asked for, a galaxy picture that failed is asked for again.
      if (currentQuality && animTime >= galaxyPicturesDueAt) loadGalaxyPictures();

      starPointUniforms.uFovScale.value = Math.max(0.7, Math.min(1.2, Math.sqrt(60 / Math.max(0.2, frame.fovDeg))));

      // 2. Sun disc + glare (true angular radius: ~2.5x larger on Mercury, ~0.35° on Mars, tiny pinpoint at outer giants)
      const sunState = sky.bodies.sun;
      const sunDist = SKY_RADIUS * 0.92;
      sunGroup.position.set(
        sunState.dirLocal[0] * sunDist,
        sunState.dirLocal[1] * sunDist,
        sunState.dirLocal[2] * sunDist,
      );
      sunGroup.lookAt(0, 0, 0);
      const sunRadiusWorld = sunDist * Math.tan(Math.max(0.06, sunState.angularDiameterDeg * 0.5) * DEG2RAD);
      sunDisc.scale.setScalar(sunRadiusWorld);
      const glareScale = Math.max(sunDist * 0.015, sunRadiusWorld * (5 + 5 * frame.sunGlare));
      sunGlareSprite.scale.setScalar(glareScale);
      const glareStrength = Math.max(0, frame.sunGlare * (1 - sky.sunObscuredByEarth * 0.92))
        * (activeWorld === 'venus' ? 0.25 : 1);
      sunGlareMat.opacity = glareStrength;
      // 3. Earth sphere (true angular size at narrow FOV, slight minimum floor at wide 60° FOV so continents read crisply)
      const earthState = sky.bodies.earth;
      const earthDist = SKY_RADIUS * 0.85;
      earthMesh.visible = activeWorld !== 'earth';
      earthMesh.position.set(
        earthState.dirLocal[0] * earthDist,
        earthState.dirLocal[1] * earthDist,
        earthState.dirLocal[2] * earthDist,
      );
      const trueEarthRadDeg = earthState.angularDiameterDeg * 0.5;
      const visualEarthRadDeg = frame.fovDeg > 20 ? Math.max(trueEarthRadDeg, 1.35) : trueEarthRadDeg;
      const earthRadiusWorld = earthDist * Math.tan(visualEarthRadDeg * DEG2RAD);

      const em = sky.earthFixedToLocal;
      earthMat4.set(
        em[0], em[1], em[2], 0,
        em[3], em[4], em[5], 0,
        em[6], em[7], em[8], 0,
        0, 0, 0, 1,
      );
      earthMesh.quaternion.setFromRotationMatrix(earthMat4);
      earthMesh.scale.setScalar(earthRadiusWorld);

      earthUniforms.uSunPosEfKm.value.set(
        sky.sunPosEarthFixedKm[0],
        sky.sunPosEarthFixedKm[1],
        sky.sunPosEarthFixedKm[2],
      );
      earthUniforms.uMoonPosEfKm.value.set(
        sky.moonPosEarthFixedKm[0],
        sky.moonPosEarthFixedKm[1],
        sky.moonPosEarthFixedKm[2],
      );
      earthUniforms.uLunarEclipse.value = sky.sunObscuredByEarth;
      earthUniforms.uCityLights.value = cityLightsFor(frame.year);
      showEarthImagery(earthImageryFor(sky.jdTT).texName);

      // 3b. Moon sphere when viewing the sky from Earth, Mars, Mercury, etc.
      const moonBody = sky.moon;
      moonSkyMesh.visible = activeWorld !== 'moon' && !!moonBody && activeWorld !== 'venus';
      if (moonSkyMesh.visible && moonBody) {
        const mDist = SKY_RADIUS * 0.86;
        moonSkyMesh.position.set(moonBody.dirLocal[0] * mDist, moonBody.dirLocal[1] * mDist, moonBody.dirLocal[2] * mDist);
        const trueMoonRad = moonBody.angularDiameterDeg * 0.5;
        const visMoonRad = frame.fovDeg > 20 ? Math.max(trueMoonRad, 0.55) : trueMoonRad;
        moonSkyMesh.scale.setScalar(mDist * Math.tan(visMoonRad * DEG2RAD));
        moonSkyUniforms.uSunDir.value.set(sunState.dirLocal[0], sunState.dirLocal[1], sunState.dirLocal[2]).normalize();
      }

      // 4. Planets
      for (const pv of planets) {
        if (pv.id === activeWorld) {
          pv.group.visible = false;
          continue;
        }
        pv.group.visible = true;
        const b = sky.bodies[pv.id];
        const pDist = SKY_RADIUS * 0.9;
        pv.group.position.set(b.dirLocal[0] * pDist, b.dirLocal[1] * pDist, b.dirLocal[2] * pDist);
        const vis = (b.magnitude < -3.2 ? Math.max(0.15, frame.starVisibility) : frame.starVisibility) * (b.magnitude < -3.5 ? Math.max(0.25, starFactor) : starFactor);
        const diskPx = b.angularDiameterDeg / degPerPixel;
        // A point of light until the telescope resolves the disc, then the textured sphere takes over.
        const pointFade = 1 - THREE.MathUtils.smoothstep(diskPx, 3, 12);
        const inten = magnitudeToIntensity(b.magnitude) * vis * pointFade;
        const baseCol = PLANET_TINT[pv.id];
        pv.spriteMat.color.setRGB(baseCol.r * inten, baseCol.g * inten, baseCol.b * inten);
        pv.sprite.visible = pointFade > 0.01;
        pv.sprite.scale.setScalar(pDist * Math.tan(degPerPixel * 8 * DEG2RAD));

        // The disc is drawn at its true angular size (no magnified stand-in).
        pv.sphere.visible = diskPx > 3;
        if (pv.sphere.visible) pv.sphere.scale.setScalar(pDist * Math.tan(b.angularDiameterDeg * 0.5 * DEG2RAD));
      }

      // 5. Transients (Supernovae & Comets)
      for (const [, vis] of transientMap) {
        vis.group.visible = false;
      }

      for (const tr of frame.transients) {
        const vis = getOrCreateTransientVisual(tr.id);
        const tDist = SKY_RADIUS * 0.88;
        vis.group.position.set(tr.dirLocal[0] * tDist, tr.dirLocal[1] * tDist, tr.dirLocal[2] * tDist);

        if (tr.kind === 'supernova') {
          vis.ionTail.visible = false;
          vis.dustTail.visible = false;

          const remDeg = tr.remnantDiameterDeg ?? 0;
          const remPx = remDeg / degPerPixel;
          const showStar = tr.magnitude < 11;
          const showRemnant = tr.ageDays > 30 && remPx > 6;
          vis.group.visible = showStar || showRemnant;
          if (!vis.group.visible) continue;

          // Bright supernovae (< -3.5 mag) remain visible even in the daytime lunar sky!
          const daylightVis = tr.magnitude < -3.5
            ? Math.max(0.5, frame.starVisibility)
            : frame.starVisibility;
          const flashCap = frame.reducedFlash ? 6 : 12;
          const inten = Math.min(flashCap, magnitudeToIntensity(tr.magnitude)) * daylightVis;

          vis.starSprite.visible = showStar && inten > 0.01;
          if (vis.starSprite.visible) {
            vis.starMat.color.setRGB(inten * 0.95, inten * 0.98, inten * 1.15);
            const starAngDeg = Math.max(degPerPixel * (10 + Math.max(0, -tr.magnitude) * 2.5), 0.2);
            vis.starSprite.scale.setScalar(tDist * Math.tan(starAngDeg * DEG2RAD));
          }

          vis.remnantMesh.visible = showRemnant;
          if (showRemnant) {
            vis.remnantMesh.lookAt(0, 0, 0);
            const rWorld = tDist * Math.tan(remDeg * 0.5 * DEG2RAD);
            vis.remnantMesh.scale.setScalar(rWorld);
            vis.remnantMat.uniforms.uTime.value = animTime;
          }
        } else {
          // Comet
          vis.remnantMesh.visible = false;
          if (tr.magnitude > 7.5) {
            vis.group.visible = false;
            continue;
          }
          vis.group.visible = true;
          const daylightVis = tr.magnitude < -2.5
            ? Math.max(0.55, frame.starVisibility)
            : frame.starVisibility;
          const inten = magnitudeToIntensity(tr.magnitude) * daylightVis;
          vis.starSprite.visible = inten > 0.01;
          vis.starMat.color.setRGB(inten * 0.9, inten * 1.0, inten * 1.1);
          const comaDeg = Math.max(tr.comaDeg ?? 0.6, degPerPixel * 16);
          vis.starSprite.scale.setScalar(tDist * Math.tan(comaDeg * DEG2RAD));

          const tailLenDeg = tr.tailLengthDeg ?? 18;
          const tailDir: Vec3 = tr.tailDirLocal ?? [0, 1, 0];
          const tailLenWorld = tDist * Math.tan(Math.min(45, tailLenDeg) * DEG2RAD);
          const tailWidthWorld = Math.max(1.2, tailLenWorld * 0.09);

          vis.ionTail.visible = daylightVis > 0.03;
          vis.dustTail.visible = daylightVis > 0.03;
          if (vis.ionTail.visible) {
            // Orient ribbon plane in group local space so +Y aligns with tailDir and +Z faces origin
            const zAxis = new THREE.Vector3(-tr.dirLocal[0], -tr.dirLocal[1], -tr.dirLocal[2]).normalize();
            const yAxis = new THREE.Vector3(tailDir[0], tailDir[1], tailDir[2]).normalize();
            const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
            const rotM = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);

            vis.ionTail.quaternion.setFromRotationMatrix(rotM);
            vis.ionTail.scale.set(tailWidthWorld, tailLenWorld, 1);
            vis.ionMat.uniforms.uAlpha.value = Math.min(1, inten * 0.35);

            // Slightly shorter, curved-angle dust tail
            const dustRot = rotM.clone().multiply(new THREE.Matrix4().makeRotationZ(0.18));
            vis.dustTail.quaternion.setFromRotationMatrix(dustRot);
            vis.dustTail.scale.set(tailWidthWorld * 1.9, tailLenWorld * 0.78, 1);
            vis.dustMat.uniforms.uAlpha.value = Math.min(1, inten * 0.32);
          }
        }
      }

      void camera;
    },

    setQuality(quality: QualityProfile): void {
      loadTexturesForQuality(quality).catch(() => undefined);
    },

    setDetailBoost(on: boolean): void {
      if (on) domeUniforms.uLod.value = 0;
    },

    setPixelRatio(ratio: number): void {
      starPointUniforms.uPixelRatio.value = Math.min(2, ratio);
    },

    setWorld(world: WorldId): void {
      activeWorld = world;
      atmoUniforms.uMode.value = world === 'mars' ? 1
        : world === 'earth' ? 2
        : world === 'venus' ? 3
        : world === 'uranus' ? 4
        : world === 'neptune' ? 5
        : 0;
      atmoDome.visible = atmoUniforms.uMode.value > 0.5;
      saturnSkyRing.visible = world === 'saturn';
      uranusSkyRing.visible = world === 'uranus';
    },

    dispose(): void {
      domeMesh.geometry.dispose();
      domeMat.dispose();
      starPointsGeo.dispose();
      starPointsMat.dispose();
      sunDisc.geometry.dispose();
      sunDiscMat.dispose();
      earthMesh.geometry.dispose();
      earthMat.dispose();
      moonSkyMesh.geometry.dispose();
      moonSkyMat.dispose();
      moonSkyUniforms.uMap.value.dispose();
      burstTex.dispose();
      eclipticLine.geometry.dispose();
      eclipticMat.dispose();
      galaxyQuadGeo.dispose();
      for (const gm of galaxyMeshes) {
        gm.mat.uniforms.uMap.value.dispose();
        gm.mat.dispose();
      }
      atmoDome.geometry.dispose();
      saturnSkyRingGeo.dispose();
      saturnSkyRingMat.dispose();
      uranusSkyRingGeo.dispose();
      uranusSkyRingMat.dispose();
    },
  };
}
