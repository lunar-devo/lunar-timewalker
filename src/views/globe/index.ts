/**
 * Interactive 3D Globe View for:
 *   - Moon landing-site map picker (click any crater/ridge or preset site marker to land)
 *   - Title/menu rotating Moon backdrop
 *   - Close-ups of the Moon and the planets from their real maps: Mars (with the 2018 global dust storm,
 *     rover markers and a 3D model showcase), Earth (with the Moon's shadow during a solar eclipse), Mercury,
 *     Jupiter, Saturn with its rings (their shadow on the globe and the globe's on them), Uranus and Neptune.
 *     Venus has no map of its cloud tops here and shows a modelled cloud deck.
 *
 * Uses a single analytical spherical coordinate convention across the fragment shader, marker pins,
 * and raycast click-picking so features and coordinates match to the pixel:
 *   pos = R * (cos(lat)*cos(lon), sin(lat), -cos(lat)*sin(lon))
 *   lat = asin(pos.y / R),  lon = atan2(-pos.z, pos.x)
 *   u   = fract((lon + PI) / (2*PI)),  v = 0.5 + lat / PI
 */
import * as THREE from 'three';
import type {
  GlobeMarker, ISpaceView, SiteCoord, SpaceViewOptions,
} from '../../core/types';
import { hasAsset, texUrl } from '../../core/assets';
import { loc } from '../../core/l10n';
import { fitModelToHeight, loadGlb } from '../../core/gltf';
import { calendarUTFromJdTT } from '../../core/time';
import { bodyOrientation, computeSky } from '../../astro';
import { cityLightsFor, earthImageryFor, marsDustState } from '../../content';
import { SATURN_RING_GLSL, SATURN_RING_INNER, SATURN_RING_OUTER } from '../rings';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const GLOBE_RADIUS = 10;

function latLonToLocalVec(latDeg: number, lonDeg: number, radius = GLOBE_RADIUS): THREE.Vector3 {
  const phi = latDeg * DEG2RAD;
  const lam = lonDeg * DEG2RAD;
  const cp = Math.cos(phi);
  return new THREE.Vector3(
    radius * cp * Math.cos(lam),
    radius * Math.sin(phi),
    -radius * cp * Math.sin(lam),
  );
}

function localVecToLatLon(p: THREE.Vector3): SiteCoord {
  const u = p.clone().normalize();
  const latDeg = Math.asin(Math.max(-1, Math.min(1, u.y))) * RAD2DEG;
  const lonDeg = Math.atan2(-u.z, u.x) * RAD2DEG;
  return { latDeg, lonDeg };
}

function makeMarkerLabelTexture(text: string, colorHex: string, dimmed: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const c = canvas.getContext('2d')!;
  c.clearRect(0, 0, 512, 96);

  c.font = '600 28px "Exo 2 Variable", system-ui, sans-serif';
  const metrics = c.measureText(text);
  const boxW = Math.min(496, Math.max(120, metrics.width + 44));
  const x0 = (512 - boxW) * 0.5;

  c.fillStyle = dimmed ? 'rgba(8, 12, 20, 0.65)' : 'rgba(8, 14, 24, 0.86)';
  c.strokeStyle = dimmed ? 'rgba(142, 163, 189, 0.4)' : colorHex;
  c.lineWidth = 3;
  c.beginPath();
  c.roundRect(x0, 16, boxW, 56, 14);
  c.fill();
  c.stroke();

  c.fillStyle = dimmed ? '#94a3b8' : '#f1f5f9';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, 256, 45, boxW - 24);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export function createGlobeView(_renderer: THREE.WebGLRenderer): ISpaceView {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 2000);
  const texLoader = new THREE.TextureLoader();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  /** Most recently used last. 8K maps are ~170 MB of GPU memory each, so only a few stay resident. */
  const textureCache = new Map<string, Promise<THREE.Texture>>();
  const MAX_CACHED_TEXTURES = 5;

  function cachedTexture(url: string, srgb: boolean): Promise<THREE.Texture> {
    let pending = textureCache.get(url);
    if (pending) {
      textureCache.delete(url);
    } else {
      pending = texLoader.loadAsync(url).then((t) => {
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        return t;
      });
      pending.catch(() => textureCache.delete(url));
    }
    textureCache.set(url, pending);
    while (textureCache.size > MAX_CACHED_TEXTURES) {
      const [oldUrl, oldTex] = textureCache.entries().next().value as [string, Promise<THREE.Texture>];
      textureCache.delete(oldUrl);
      oldTex.then((t) => {
        const inUse = [globeUniforms.uMap.value, globeUniforms.uRelief.value, globeUniforms.uNight.value, bgDomeMat.map];
        if (!inUse.includes(t)) t.dispose();
      }).catch(() => undefined);
    }
    return pending;
  }

  // Background star dome
  const bgDomeMat = new THREE.MeshBasicMaterial({
    color: 0x2a3344,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const bgDome = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 20), bgDomeMat);
  scene.add(bgDome);

  // Main globe mesh + shader
  const globeUniforms = {
    uMap: { value: new THREE.Texture() },
    uHasMap: { value: 0.0 },
    uTargetKind: { value: 0.0 }, // 0=moon, 1=mars, 2=earth, 3=jupiter, 4=saturn
    uSunDir: { value: new THREE.Vector3(1, 0.2, 0.3).normalize() },
    uAmbient: { value: 0.22 },
    uShowGrid: { value: 0.0 },
    uDustStorm: { value: 0.0 },
    /** Storm origin (unit vector, globe local) and angular radius of the dusty region, radians. */
    uDustOrigin: { value: new THREE.Vector3(0, 1, 0) },
    uDustRadius: { value: 0.0 },
    uTime: { value: 0.0 },
    uSunPosEfKm: { value: new THREE.Vector3(149_597_870, 0, 0) },
    uMoonPosEfKm: { value: new THREE.Vector3(384_400, 0, 0) },
    /** Tangent-space normal map (x east, y north) from LOLA, for the Moon. */
    uRelief: { value: new THREE.Texture() },
    uHasRelief: { value: 0.0 },
    /** City lights for Earth's night side, and their strength for the shown year. */
    uNight: { value: new THREE.Texture() },
    uCity: { value: 0.0 },
  };

  const globeMat = new THREE.ShaderMaterial({
    uniforms: globeUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vLocalPos;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      void main() {
        vLocalPos = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uHasMap;
      uniform float uTargetKind;
      uniform vec3 uSunDir;
      uniform float uAmbient;
      uniform float uShowGrid;
      ${SATURN_RING_GLSL}
      uniform float uDustStorm;
      uniform vec3 uDustOrigin;
      uniform float uDustRadius;
      uniform float uTime;
      uniform vec3 uSunPosEfKm;
      uniform vec3 uMoonPosEfKm;
      uniform sampler2D uRelief;
      uniform float uHasRelief;
      uniform sampler2D uNight;
      uniform float uCity;

      varying vec3 vLocalPos;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;

      const float PI = 3.141592653589793;

      vec3 srgbToLinear(vec3 c) {
        return pow(max(c, vec3(0.0)), vec3(2.2));
      }

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
          mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }
      float h3(vec3 p) {
        p = fract(p * vec3(443.897, 441.423, 437.195));
        p += dot(p, p.yzx + 19.19);
        return fract((p.x + p.y) * p.z);
      }
      float n3(vec3 p) {
        vec3 i = floor(p); vec3 f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(h3(i), h3(i + vec3(1,0,0)), u.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), u.x), u.y),
          mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), u.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), u.x), u.y),
          u.z
        );
      }
      float fbm3(vec3 p) {
        float s = 0.0; float a = 0.5;
        for (int k = 0; k < 5; k++) { s += a * n3(p); p *= 2.07; a *= 0.5; }
        return s;
      }
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
        vec3 n = normalize(vLocalPos);
        float lat = asin(clamp(n.y, -1.0, 1.0));
        float lon = atan(-n.z, n.x);
        vec2 uv = vec2(fract((lon + PI) / (2.0 * PI)), 0.5 + lat / PI);
        vec3 albedo = vec3(0.25);
        if (uHasMap > 0.5) {
          // sRGB textures are decoded to linear by the GPU.
          albedo = texture2D(uMap, uv).rgb;
        } else if (uTargetKind > 5.5 && uTargetKind < 6.5) {
          // Venus: creamy golden-ochre sulfuric-acid cloud chevrons
          float chev = sin(lat * 8.0 + abs(lat) * 2.2 + sin(lon * 2.0 - uTime * 0.12) * 0.8);
          float swirl = fbm3(n * 4.5 - vec3(uTime * 0.03, 0.0, 0.0));
          albedo = mix(vec3(0.68, 0.50, 0.24), vec3(0.94, 0.82, 0.54), 0.5 + 0.34 * chev + 0.22 * (swirl - 0.5));
        }
        // Mars 2018 dust storm: a veil spreading from Acidalia Planitia, with a brighter churning front.
        if (uTargetKind > 0.5 && uTargetKind < 1.5 && uDustStorm > 0.001) {
          float band = vnoise(vec2(lon * 2.5 + uTime * 0.05 + sin(lat * 4.0) * 0.8, lat * 9.0));
          float eddy = vnoise(vec2(lon * 7.5 - uTime * 0.11, lat * 15.0));
          float swirl = band * 0.62 + eddy * 0.38;
          float dist = acos(clamp(dot(n, uDustOrigin), -1.0, 1.0)) + (swirl - 0.5) * 0.32;
          float cover = 1.0 - smoothstep(uDustRadius - 0.35, uDustRadius + 0.08, dist);
          float front = smoothstep(uDustRadius - 0.40, uDustRadius - 0.05, dist) * cover;
          vec3 darkSand = vec3(0.48, 0.27, 0.13);
          vec3 brightDust = vec3(0.84, 0.56, 0.30);
          vec3 dustCol = mix(darkSand, brightDust, swirl) * (1.0 + 0.28 * front);
          albedo = mix(albedo, dustCol, clamp(uDustStorm * cover * (0.76 + 0.22 * swirl), 0.0, 0.96));
        }

        vec3 L = normalize(uSunDir);
        vec3 V = normalize(cameraPosition - vWorldPos);
        // Surface normal: the LOLA relief map on the Moon, the plain sphere elsewhere.
        vec3 N = n;
        if (uHasRelief > 0.5) {
          vec3 t = texture2D(uRelief, uv).rgb * 2.0 - 1.0;
          vec3 east = vec3(-sin(lon), 0.0, -cos(lon));
          vec3 north = vec3(-sin(lat) * cos(lon), cos(lat), sin(lat) * sin(lon));
          N = normalize(east * t.x + north * t.y + n * t.z);
        }
        // The globe is not rotated, so local normals are world normals; V is in world space.
        float ndl = dot(n, L);
        float mu0 = max(dot(N, L), 0.0);
        float mu = max(dot(N, V), 0.05);
        // Moon: Lommel–Seeliger (flat-looking full Moon, crisp relief at the terminator); others: soft Lambert.
        float diff = uTargetKind < 0.5
          ? 2.0 * mu0 / (mu0 + mu) * smoothstep(-0.02, 0.06, ndl)
          : smoothstep(-0.08, 0.88, ndl) * (0.6 + 0.4 * mu0 / max(ndl, 0.05));

        // Earth solar eclipse shadow
        float eclipseFactor = 1.0;
        if (uTargetKind > 1.5 && uTargetKind < 2.5) {
          // Convert globe local (x, y, z) to Earth-fixed (x, -z, y)
          vec3 nEf = vec3(n.x, -n.z, n.y);
          vec3 surfKm = nEf * 6371.0;
          vec3 toSun = uSunPosEfKm - surfKm;
          vec3 toMoon = uMoonPosEfKm - surfKm;
          float dSun = length(toSun);
          float dMoon = length(toMoon);
          float rSun = asin(695700.0 / dSun);
          float rMoon = asin(1737.4 / dMoon);
          float sep = acos(clamp(dot(toSun / dSun, toMoon / dMoon), -1.0, 1.0));
          float cov = discOverlap(rSun, rMoon, sep);
          eclipseFactor = 1.0 - smoothstep(0.0, 0.98, cov) * 0.92;
        }

        // Clamped: N·V a hair above 1 at the disc centre would make pow() return NaN (black squares after bloom).
        float rim = clamp(1.0 - dot(normalize(vWorldNormal), V), 0.0, 1.0);
        vec3 atmo = vec3(0.0);
        if (uTargetKind > 0.5 && uTargetKind < 1.5) {
          atmo = vec3(0.92, 0.48, 0.22) * pow(rim, 3.2) * 0.42 * smoothstep(-0.3, 0.3, ndl);
        } else if (uTargetKind > 1.5 && uTargetKind < 2.5) {
          vec3 sky = mix(vec3(0.24, 0.6, 1.0), vec3(1.0, 0.45, 0.2), 1.0 - smoothstep(-0.05, 0.3, ndl));
          atmo = sky * pow(rim, 3.0) * 0.7 * smoothstep(-0.3, 0.25, ndl);
        } else if (uTargetKind > 5.5 && uTargetKind < 6.5) {
          atmo = vec3(0.98, 0.78, 0.38) * pow(rim, 2.8) * 0.55 * smoothstep(-0.3, 0.3, ndl);
        } else if (uTargetKind > 6.5 && uTargetKind < 7.5) {
          atmo = vec3(0.45, 0.86, 0.90) * pow(rim, 3.0) * 0.50 * smoothstep(-0.3, 0.3, ndl);
        } else if (uTargetKind > 7.5) {
          atmo = vec3(0.26, 0.52, 0.98) * pow(rim, 3.0) * 0.55 * smoothstep(-0.3, 0.3, ndl);
        }
        vec3 gridCol = vec3(0.0);
        if (uShowGrid > 0.5) {
          float latDeg = lat * 180.0 / PI;
          float lonDeg = lon * 180.0 / PI;
          float gLat = abs(fract(latDeg / 30.0 + 0.5) - 0.5) * 30.0;
          float gLon = abs(fract(lonDeg / 30.0 + 0.5) - 0.5) * 30.0 * max(0.15, cos(lat));
          float line = 1.0 - smoothstep(0.15, 0.55, min(gLat, gLon));
          gridCol = vec3(0.25, 0.68, 0.95) * line * 0.16;
        }

        // Saturn: the shadow of the rings on the globe. The rings lie in the plane of the equator, so the
        // way from a point of the globe to the Sun crosses them at a known distance from the centre.
        float ringShade = 1.0;
        if (uTargetKind > 3.5 && uTargetKind < 4.5 && abs(L.y) > 1e-4) {
          float toPlane = -n.y / L.y;
          if (toPlane > 0.0) ringShade = 1.0 - 0.85 * saturnRing(length((n + toPlane * L).xz)).y;
        }
        // Picking needs the whole globe readable: a soft light from the viewer shows relief on the night side.
        // It gives way to the Sun's light smoothly (a plain max() leaves a crease along the terminator).
        float viewLight = uAmbient * (0.35 + 0.65 * max(dot(N, V), 0.0));
        float sunLight = diff * (uTargetKind < 2.5 ? 1.35 : 1.15) * eclipseFactor * ringShade;
        float lightTerm = 0.5 * (viewLight + sunLight + sqrt((viewLight - sunLight) * (viewLight - sunLight) + 0.0009));
        vec3 col = albedo * lightTerm + atmo + gridCol;
        if (uTargetKind > 1.5 && uTargetKind < 2.5) {
          // Ocean glint and city lights.
          vec3 H = normalize(L + V + vec3(0.0, 1e-5, 0.0));
          float ocean = step(albedo.r + 0.01, albedo.b) * (1.0 - smoothstep(0.08, 0.2, albedo.g));
          col += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, H), 0.0), 80.0) * ocean * 0.6 * eclipseFactor;
          col += texture2D(uNight, uv).rgb * vec3(1.0, 0.8, 0.55) * 0.7 * uCity * (1.0 - smoothstep(-0.12, 0.04, ndl));
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const globeMesh = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_RADIUS, 72, 54), globeMat);
  scene.add(globeMesh);

  // Saturn's rings, in the plane of the globe's equator.
  const saturnRingGeo = new THREE.RingGeometry(GLOBE_RADIUS * SATURN_RING_INNER, GLOBE_RADIUS * SATURN_RING_OUTER, 160, 1);
  saturnRingGeo.rotateX(Math.PI / 2);
  const ringVert = /* glsl */ `
    varying vec3 vPos;
    void main() {
      vPos = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const saturnRingMat = new THREE.ShaderMaterial({
    uniforms: { uSunDir: globeUniforms.uSunDir },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: ringVert,
    fragmentShader: /* glsl */ `
      ${SATURN_RING_GLSL}
      uniform vec3 uSunDir;
      varying vec3 vPos;
      void main() {
        vec2 ring = saturnRing(length(vPos.xz) / ${GLOBE_RADIUS.toFixed(1)});
        vec3 L = normalize(uSunDir);
        // The globe's shadow across the rings: where the way to the Sun passes through the globe.
        float towardSun = dot(vPos, L);
        float miss = length(vPos - towardSun * L) / ${GLOBE_RADIUS.toFixed(1)};
        float shadow = towardSun < 0.0 ? smoothstep(0.97, 1.03, miss) : 1.0;
        // From the side the Sun lights, the rings shine with what they scatter back; from the other side,
        // with what gets through them, which is most where they are thin.
        float sameSide = step(0.0, L.y * (cameraPosition.y - vPos.y));
        float face = mix((1.0 - ring.y) * 0.5 + 0.03, 1.0, sameSide);
        // A Sun low over the ring plane lights the rings less.
        float sunHeight = 0.4 + 0.6 * smoothstep(0.0, 0.3, abs(L.y));
        vec3 col = saturnRingColour(ring.x) * ring.x * face * sunHeight * (0.05 + 0.95 * shadow) * 1.15;
        gl_FragColor = vec4(col, ring.y);
      }
    `,
  });
  const saturnRing = new THREE.Mesh(saturnRingGeo, saturnRingMat);
  saturnRing.visible = false;
  scene.add(saturnRing);

  // Uranus's rings, also equatorial: narrow and dark. Radii in planet radii: 6, 5 and 4, α, β, η, γ, δ, and
  // the brightest and widest, ε. They are drawn wider and brighter than they are, or they would not show.
  const uranusRingGeo = new THREE.RingGeometry(GLOBE_RADIUS * 1.6, GLOBE_RADIUS * 2.06, 160, 1);
  uranusRingGeo.rotateX(Math.PI / 2);
  const uranusRingMat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: ringVert,
    fragmentShader: /* glsl */ `
      varying vec3 vPos;
      float ringlet(float r, float at, float width) {
        float d = (r - at) / width;
        return exp(-d * d);
      }
      void main() {
        float r = length(vPos.xz) / ${GLOBE_RADIUS.toFixed(1)};
        float thin = ringlet(r, 1.637, 0.004) + ringlet(r, 1.652, 0.004) + ringlet(r, 1.666, 0.004)
          + ringlet(r, 1.750, 0.005) + ringlet(r, 1.786, 0.005) + ringlet(r, 1.846, 0.004)
          + ringlet(r, 1.863, 0.005) + ringlet(r, 1.890, 0.005);
        float epsilon = ringlet(r, 2.001, 0.012);
        gl_FragColor = vec4(vec3(0.62, 0.66, 0.7), clamp(thin * 0.32 + epsilon * 0.6, 0.0, 1.0));
      }
    `,
  });
  const uranusRing = new THREE.Mesh(uranusRingGeo, uranusRingMat);
  uranusRing.visible = false;
  scene.add(uranusRing);

  // Selection reticle ring on the globe
  const selGroup = new THREE.Group();
  const selRingGeo = new THREE.RingGeometry(0.32, 0.46, 32);
  const selRingMat = new THREE.MeshBasicMaterial({
    color: 0xffb454,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  const selRing = new THREE.Mesh(selRingGeo, selRingMat);
  const selDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 14, 14),
    new THREE.MeshBasicMaterial({ color: 0xffb454, depthTest: false }),
  );
  selGroup.add(selRing, selDot);
  selGroup.visible = false;
  scene.add(selGroup);

  // Markers container
  const markersGroup = new THREE.Group();
  scene.add(markersGroup);

  // 3D hardware showcase (floating in bottom-left when a Mars/Moon hardware marker with modelFile is selected)
  const showcaseGroup = new THREE.Group();
  const showcaseLight1 = new THREE.DirectionalLight(0xffffff, 2.6);
  showcaseLight1.position.set(5, 8, 6);
  const showcaseLight2 = new THREE.AmbientLight(0x8bb8ff, 0.75);
  scene.add(showcaseGroup, showcaseLight1, showcaseLight2);
  let showcaseModel: THREE.Object3D | null = null;

  interface MarkerVisual {
    data: GlobeMarker;
    pin: THREE.Mesh;
    label: THREE.Sprite;
    surfaceNormal: THREE.Vector3;
  }
  const markerVisuals: MarkerVisual[] = [];

  let currentOpts: SpaceViewOptions | null = null;
  let camLonRad = 0.35;
  let camLatRad = 0.15;
  let targetLonRad = 0.35;
  let targetLatRad = 0.15;
  let camDist = 28;
  let targetDist = 28;
  /** The farthest the wheel may take the view. */
  let farthest = 62;
  let attachedEl: HTMLElement | null = null;
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragMoved = 0;
  let selectedMarkerId: string | null = null;
  let lastJd = 0;
  /** 0 at real-time rates, 1 when the clock runs many rotations per second (time-lapse). */
  let fastness = 0;

  function syncLightingFromAstro(jdTT: number): void {
    if (!currentOpts) return;
    const tid = currentOpts.targetId;
    if (tid === 'moon' || tid === 'mercury' || tid === 'venus' || tid === 'earth' || tid === 'mars' || tid === 'jupiter' || tid === 'saturn' || tid === 'uranus' || tid === 'neptune') {
      const ori = bodyOrientation(tid, jdTT);
      // Convert body-fixed (x=lon0, y=lon90E, z=north) to globe local (x=lon0, y=north, z=-lon90E)
      const sun = new THREE.Vector3(ori.sunDirFixed[0], ori.sunDirFixed[2], -ori.sunDirFixed[1]).normalize();
      if (fastness > 0) {
        // In a time-lapse the true terminator would spin several times a second; light the side facing the
        // camera from the upper left instead, so the change being shown (e.g. dust spreading) stays readable.
        const camDir = camera.position.clone().normalize();
        const side = new THREE.Vector3(0, 1, 0).cross(camDir).normalize();
        const steady = camDir.multiplyScalar(0.75).addScaledVector(side, -0.55).add(new THREE.Vector3(0, 0.3, 0)).normalize();
        sun.lerp(steady, fastness).normalize();
      }
      globeUniforms.uSunDir.value.copy(sun);
    }
    if (tid === 'mars') {
      const dust = marsDustState(jdTT);
      globeUniforms.uDustStorm.value = dust.opacity;
      globeUniforms.uDustRadius.value = dust.radiusDeg * DEG2RAD;
      globeUniforms.uDustOrigin.value.copy(latLonToLocalVec(dust.originLatDeg, dust.originLonDeg, 1)).normalize();
    }
    if (tid === 'earth') {
      const sky = computeSky(jdTT, { latDeg: 0, lonDeg: 0 });
      globeUniforms.uSunPosEfKm.value.set(
        sky.sunPosEarthFixedKm[0],
        sky.sunPosEarthFixedKm[1],
        sky.sunPosEarthFixedKm[2],
      );
      globeUniforms.uMoonPosEfKm.value.set(
        sky.moonPosEarthFixedKm[0],
        sky.moonPosEarthFixedKm[1],
        sky.moonPosEarthFixedKm[2],
      );
    }
  }

  function rebuildMarkers(markers: GlobeMarker[]): void {
    while (markersGroup.children.length > 0) {
      markersGroup.remove(markersGroup.children[0]);
    }
    markerVisuals.length = 0;
    if (!currentOpts) return;

    const lang = currentOpts.lang;
    const pinGeo = new THREE.SphereGeometry(0.19, 14, 14);

    for (const m of markers) {
      const pos = latLonToLocalVec(m.latDeg, m.lonDeg, GLOBE_RADIUS * 1.008);
      const normal = pos.clone().normalize();
      const isSel = m.id === selectedMarkerId;
      const colHex = isSel ? '#ffb454' : (m.color ?? (m.dimmed ? '#64748b' : '#5fd4ff'));

      const pinMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(colHex),
        depthTest: true,
      });
      const pin = new THREE.Mesh(pinGeo, pinMat);
      pin.position.copy(pos);
      pin.userData = { markerId: m.id };
      markersGroup.add(pin);

      const tex = makeMarkerLabelTexture(loc(m.label, lang), colHex, Boolean(m.dimmed));
      const spriteMat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const label = new THREE.Sprite(spriteMat);
      label.position.copy(pos).addScaledVector(normal, 0.72);
      label.scale.set(3.2, 0.6, 1);
      label.userData = { markerId: m.id };
      markersGroup.add(label);

      markerVisuals.push({ data: m, pin, label, surfaceNormal: normal });
    }
  }

  async function updateShowcaseForSelectedMarker(): Promise<void> {
    while (showcaseGroup.children.length > 0) {
      showcaseGroup.remove(showcaseGroup.children[0]);
    }
    showcaseModel = null;
    if (!selectedMarkerId) return;
    const mv = markerVisuals.find((v) => v.data.id === selectedMarkerId);
    const modelFile = mv?.data.modelFile;
    if (!modelFile || !hasAsset(`models/${modelFile}`)) return;
    try {
      const glb = await loadGlb(modelFile);
      fitModelToHeight(glb, 2.6);
      showcaseGroup.add(glb);
      showcaseModel = glb;
    } catch {
      // Ignore model load error
    }
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || currentOpts?.mode === 'backdrop') return;
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragMoved = 0;
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragMoved += Math.hypot(dx, dy);

    const sens = 0.0045 * (camDist / 28);
    targetLonRad -= dx * sens;
    targetLatRad = Math.max(-1.48, Math.min(1.48, targetLatRad + dy * sens));
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    if (dragMoved > 6 || !attachedEl || !currentOpts) return;

    const rect = attachedEl.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);

    // 1. Check marker pins/labels first
    const visibleMarkerObjs: THREE.Object3D[] = [];
    for (const mv of markerVisuals) {
      if (mv.pin.visible) {
        visibleMarkerObjs.push(mv.pin, mv.label);
      }
    }
    const markerHits = raycaster.intersectObjects(visibleMarkerObjs, false);
    if (markerHits.length > 0) {
      const hitId = markerHits[0].object.userData?.markerId as string | undefined;
      if (hitId) {
        currentOpts.onMarker?.(hitId);
        return;
      }
    }

    // 2. In picker mode, clicking the globe picks (latDeg, lonDeg)
    if (currentOpts.mode === 'picker') {
      const hits = raycaster.intersectObject(globeMesh, false);
      if (hits.length > 0) {
        const pt = hits[0].point;
        const coord = localVecToLatLon(pt);
        currentOpts.onPick?.(coord.latDeg, coord.lonDeg);
      }
    }
  }

  function onWheel(e: WheelEvent): void {
    if (currentOpts?.mode === 'backdrop') return;
    e.preventDefault();
    targetDist = Math.max(13.5, Math.min(farthest, targetDist * (1 + e.deltaY * 0.001)));
  }

  return {
    scene,
    camera,

    async enter(opts: SpaceViewOptions): Promise<void> {
      currentOpts = opts;
      selectedMarkerId = null;
      const tid = opts.targetId;

      globeUniforms.uTargetKind.value =
        tid === 'moon' ? 0
        : tid === 'mars' ? 1
        : tid === 'earth' ? 2
        : tid === 'jupiter' ? 3
        : tid === 'saturn' ? 4
        : tid === 'mercury' ? 5
        : tid === 'venus' ? 6
        : tid === 'uranus' ? 7
        : 8;
      // Outside the picker, the night side keeps just enough of the viewer's light to show that it is there
      // (a little more on the worlds that have places to find).
      globeUniforms.uAmbient.value = opts.mode === 'picker' ? 0.34 : tid === 'moon' ? 0.1 : tid === 'mars' || tid === 'earth' || tid === 'mercury' ? 0.06 : 0.035;
      globeUniforms.uShowGrid.value = opts.mode === 'picker' ? 1.0 : 0.0;
      globeUniforms.uDustStorm.value = 0;
      saturnRing.visible = tid === 'saturn';
      uranusRing.visible = tid === 'uranus';
      selGroup.visible = false;

      // Textures are cached: the menu, map and telescope views reopen the same 8K images often.
      const texKey = tid === 'earth' ? earthImageryFor(opts.jdTT).texName : `${tid}_color`;
      const url = texUrl(texKey, opts.quality) ?? (tid === 'earth' ? texUrl('earth_day', opts.quality) : null);
      globeUniforms.uHasMap.value = 0.0;
      if (url) {
        const tex = await cachedTexture(url, true).catch(() => null);
        if (tex && currentOpts === opts) {
          globeUniforms.uMap.value = tex;
          globeUniforms.uHasMap.value = 1.0;
        }
      }
      const reliefUrl = tid === 'moon' ? texUrl('moon_relief', opts.quality) : null;
      globeUniforms.uHasRelief.value = 0.0;
      if (reliefUrl) {
        cachedTexture(reliefUrl, false).then((t) => {
          if (currentOpts !== opts) return;
          globeUniforms.uRelief.value = t;
          globeUniforms.uHasRelief.value = 1.0;
        }).catch(() => undefined);
      }
      const nightUrl = tid === 'earth' ? texUrl('earth_night', opts.quality) : null;
      globeUniforms.uCity.value = 0.0;
      if (nightUrl) {
        cachedTexture(nightUrl, true).then((t) => {
          if (currentOpts !== opts) return;
          globeUniforms.uNight.value = t;
          globeUniforms.uCity.value = cityLightsFor(calendarUTFromJdTT(opts.jdTT).year);
        }).catch(() => undefined);
      }

      const starsUrl = texUrl('stars', opts.quality);
      if (starsUrl) {
        cachedTexture(starsUrl, true).then((st) => {
          bgDomeMat.map = st;
          bgDomeMat.color.setHex(0x55606f);
          bgDomeMat.needsUpdate = true;
        }).catch(() => undefined);
      }

      syncLightingFromAstro(opts.jdTT);
      rebuildMarkers(opts.markers ?? []);

      // Initial camera framing + cinematic fly-in
      if (opts.mode === 'backdrop') {
        camDist = 27;
        targetDist = 27;
        camLatRad = 0.12;
        targetLatRad = 0.12;
      } else {
        // A close-up shows the whole globe with room round it (Saturn with its rings), from where most of it
        // is in daylight and from the side of its equator that the Sun lights (for a ringed planet, the
        // bright face of the rings). The picker shows the globe larger, from over the prime meridian.
        const sun = globeUniforms.uSunDir.value;
        const sunSide = sun.y >= 0 ? 1 : -1;
        farthest = tid === 'saturn' ? 84 : 62;
        targetDist = opts.mode === 'picker' ? 26 : tid === 'saturn' ? 46 : 35;
        camDist = targetDist * 1.6;
        targetLatRad = tid === 'saturn' ? 0.34 * sunSide : tid === 'uranus' ? 0.5 * sunSide : 0.18;
        camLatRad = targetLatRad + 0.04;
        targetLonRad = opts.mode === 'picker' ? 0.35 : Math.atan2(-sun.z, sun.x) + 0.6;
        camLonRad = targetLonRad;
      }
    },

    update(dt: number, jdTT: number): void {
      if (!currentOpts) return;
      globeUniforms.uTime.value += dt;
      const rate = dt > 0 ? (Math.abs(jdTT - lastJd) * 86400) / dt : 0;
      lastJd = jdTT;
      const target = rate > 1e7 ? fastness : Math.min(1, Math.max(0, (rate - 3000) / 30000));
      fastness += (target - fastness) * Math.min(1, dt * 3);
      syncLightingFromAstro(jdTT);

      if (currentOpts.mode === 'backdrop') {
        targetLonRad += dt * 0.08;
      }

      const k = Math.min(1, dt * 7);
      camLonRad += (targetLonRad - camLonRad) * k;
      camLatRad += (targetLatRad - camLatRad) * k;
      camDist += (targetDist - camDist) * k;

      const cp = Math.cos(camLatRad);
      const camPos = new THREE.Vector3(
        camDist * cp * Math.cos(camLonRad),
        camDist * Math.sin(camLatRad),
        -camDist * cp * Math.sin(camLonRad),
      );
      camera.position.copy(camPos);

      if (currentOpts.mode === 'backdrop') {
        // Offset lookAt so the Moon sits gracefully on the right side behind the menu
        camera.lookAt(-5.5, 0.5, 0);
      } else {
        camera.lookAt(0, 0, 0);
      }

      // Hide markers on the back hemisphere relative to camera
      const camDir = camPos.clone().normalize();
      const labelScale = Math.max(0.45, Math.min(1.3, camDist / 26));
      for (const mv of markerVisuals) {
        const front = mv.surfaceNormal.dot(camDir) > 0.08;
        mv.pin.visible = front;
        mv.label.visible = front;
        if (front) {
          mv.label.scale.set(3.2 * labelScale, 0.6 * labelScale, 1);
        }
      }

      // Position & spin floating 3D hardware showcase in the lower-left of camera view
      if (showcaseModel) {
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        showcaseGroup.position.copy(camera.position)
          .addScaledVector(forward, 9.5)
          .addScaledVector(right, -3.2)
          .addScaledVector(up, -1.6);
        showcaseModel.rotation.y += dt * 0.55;
      }
    },

    setMarkers(markers: GlobeMarker[]): void {
      rebuildMarkers(markers);
    },

    setSelection(sel: SiteCoord | null, flyTo = false): void {
      if (!sel) {
        selGroup.visible = false;
        return;
      }
      selGroup.visible = true;
      const pos = latLonToLocalVec(sel.latDeg, sel.lonDeg, GLOBE_RADIUS * 1.012);
      selGroup.position.copy(pos);
      selGroup.lookAt(pos.clone().multiplyScalar(2));

      if (flyTo) {
        targetLatRad = Math.max(-1.42, Math.min(1.42, sel.latDeg * DEG2RAD));
        targetLonRad = sel.lonDeg * DEG2RAD;
      }
    },

    setSelectedMarker(markerId: string | null): void {
      selectedMarkerId = markerId;
      if (currentOpts?.markers) {
        rebuildMarkers(currentOpts.markers);
      }
      const mv = markerVisuals.find((v) => v.data.id === markerId);
      if (mv) {
        this.setSelection({ latDeg: mv.data.latDeg, lonDeg: mv.data.lonDeg }, true);
      }
      updateShowcaseForSelectedMarker().catch(() => undefined);
    },

    attach(el: HTMLElement): void {
      if (attachedEl === el) return;
      this.detach();
      attachedEl = el;
      el.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      el.addEventListener('wheel', onWheel, { passive: false });
    },

    detach(): void {
      if (!attachedEl) return;
      attachedEl.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      attachedEl.removeEventListener('wheel', onWheel);
      attachedEl = null;
      dragging = false;
    },

    resize(width: number, height: number): void {
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    },

    dispose(): void {
      this.detach();
      globeMesh.geometry.dispose();
      globeMat.dispose();
      saturnRingGeo.dispose();
      saturnRingMat.dispose();
      uranusRingGeo.dispose();
      uranusRingMat.dispose();
      bgDome.geometry.dispose();
      bgDomeMat.dispose();
    },
  };
}
