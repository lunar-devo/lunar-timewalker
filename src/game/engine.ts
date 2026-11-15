/**
 * Central engine and GameAPI implementation.
 * Coordinates the simulation clock, astronomy engine, LOLA terrain, sky, astronaut, lunar hardware,
 * 3D globe and special views, event stagings and quotes, tutorial and spectator modes, telemetry, and
 * HDR post-processing (UnrealBloomPass + OutputPass).
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import type {
  BodyId, CmeVisual, Collider, EventDef, GameAPI, GlobeMarker, HorizonEvent, ISpaceView, L10n, LabBody, LabConfigPatch,
  LabExplosionKind, LabFate, LabFraming, LabImpactLevel, LabQuiz, LabSetup, LabState, Lang, LightingState,
  LightReading, PanelId, Settings, SiteCoord, SiteDef, SkyState, SkyTarget, StageDef, StagingDef, SupernovaDef,
  Telemetry, TerrainLoadInfo, TransientDef, TransientState, WorldId,
} from '../core/types';
import { loadManifest, setMaxTextureSize } from '../core/assets';
import { frame, type FrameProjection } from '../core/frame';
import { fmt, lf, loadDict, loc, tpl } from '../core/l10n';
import { Input, keyBelongsToControl } from '../core/input';
import { attachPinch } from '../core/pinch';
import { QUALITY } from '../core/quality';
import {
  getGame, saveSettings, setGame, showToast,
} from '../core/store';
import {
  calendarUTFromJdTT, jdTTFromCalendarUT, jdTTNow, SECONDS_PER_DAY,
} from '../core/time';
import {
  angularSeparationDeg, azElFromDir, bodyOrientation, computeSky, dirLocalFromRaDec,
  discVisibleFraction, horizonElevationAt, illuminationStats, mapPointSeenFrom, nextHorizonEvent, solarFluxWm2,
  targetAltAz, transientState, worldTemperatureK,
} from '../astro';
import { createArtifacts } from '../artifacts';
import { createAudio } from '../audio';
import {
  ARTIFACT_PLACEMENTS, BODY_NAMES, BODY_TOPICS, BRIGHT_STARS, EVENTS, GALAXIES, SITES,
  SURFACE_ASSETS, TRANSIENTS, TUTORIAL_DATE, TUTORIAL_SITE_ID, TUTORIAL_STEPS, WORLDS, type TutorialCheck,
} from '../content';
import { createNasa } from '../nasa';
import { createPlayer } from '../player';
import { createSky, OVERCAST_WORLDS } from '../sky';
import { createTerrain } from '../terrain';
import { createGlobeView } from '../views/globe';
import { createRemnantView, createSunView } from '../views/special';
import { createGalaxyView } from '../views/galaxy';
import {
  computeLabFates, computeLabImpact, createLabView, LAB_EXTRA_IDS, LAB_FIRST_YEAR, LAB_LAST_YEAR, LAB_MAX_AU, LAB_MIN_AU,
  LAB_QUESTIONS, labLandmarkLatitudeDeg, labLinkQuery, labRunSeconds, parseLabLink, type LabLink,
} from '../views/lab';
import { buildLabWatch, LAB_WATCH_EVENT_ID, LAB_WATCH_TARGET_ID } from '../views/lab/watch';
import { registerGame } from './api';
import {
  createDirector, type Director, momentJd, stagingEndJd, stagingSampleJds,
} from './director';
import { createLensFlare, type FlareView } from '../sky/flare';
import { createVisorPass } from './visorPass';
import { createGuardPass } from './guardPass';
import { downloadBlob } from '../core/download';
import { createResolutionGovernor } from './resolution';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
/** The fewest device pixels to a CSS pixel the resolution governor may bring the drawing down to. */
const MIN_PIXEL_RATIO = 0.75;

/** What the lab's model says of the explosion that is set: for Earth, for the other bodies, and how long the time-lapse runs. */
type LabResults = Pick<LabState, 'impact' | 'fates' | 'runSec'>;

/** The moments the lab's map can be set to: 1 January of the first year a link may name … 31 December of the last (UT). */
const LAB_FIRST_JD = jdTTFromCalendarUT({ year: LAB_FIRST_YEAR, month: 1, day: 1 });
const LAB_LAST_JD = jdTTFromCalendarUT({ year: LAB_LAST_YEAR, month: 12, day: 31, hour: 23, minute: 59, second: 59 });

/** The moments the clock can be set to and run to, as the time bar states them: 1 January 3000 BC … 31 December 2035 (UT). */
const CLOCK_FIRST_JD = jdTTFromCalendarUT({ year: -2999, month: 1, day: 1 });
const CLOCK_LAST_JD = jdTTFromCalendarUT({ year: 2035, month: 12, day: 31, hour: 23, minute: 59, second: 59 });

/**
 * Radiation dose rate measured on the surface, mSv per day; a world without a measurement has no value.
 * Moon: galactic-cosmic-ray background measured by Chang'e-4 LND (Zhang et al. 2020), ≈ 60 µSv/h ≈ 1.44 mSv/day.
 * Mars: MSL RAD in Gale crater (Hassler et al. 2014), 0.67 mSv/day. Solar particle events are not modelled,
 * so no storm value is invented.
 */
const SURFACE_RADIATION_MSV_DAY: Partial<Record<WorldId, number>> = { moon: 1.44, mars: 0.67 };

/** The tutorial steps that are done through the telescope; any other step begins with it down. */
const TELESCOPE_CHECKS: Partial<Record<TutorialCheck['kind'], true>> = { telescope: true, telescopeAim: true, enterView: true };

/** A rise or a set as a moment of the clock; what is left until then is counted from it (see `HorizonEvent`). */
interface HorizonMoment {
  kind: HorizonEvent['kind'];
  jdTT: number;
}

/** The lab scenario whose supernova is watched from the ground: what is needed to show it from any world. */
interface LabWatchSource {
  kind: 'sn2' | 'sn1a';
  distanceAU: number;
  angleRad: number;
  /** The body or star of the map the explosion was set at: a star's real place in the sky lies off the map's plane. */
  anchorId: string | null;
  jdTT: number;
  /** What the lab's model says becomes of Earth, and of the other bodies of its map. */
  earthSummary: L10n;
  fates: LabFate[];
}

/**
 * Whether the lab has a result to show for `id`: Earth always, the spacecraft near Earth in a solar eruption
 * that reaches them, and any other body that the model gives a fate.
 */
function labFocusValid(id: string, kind: LabExplosionKind, results: LabResults): boolean {
  if (id === 'earth') return true;
  if (id === 'satellites') return kind === 'cme' && results.impact.satellites.length > 0;
  return results.fates.some((f) => f.id === id);
}

/** The lab's scenario as the query of a link (see views/lab/link.ts). */
function labScenarioQuery(lab: LabState): string {
  const day = calendarUTFromJdTT(lab.jdTT);
  return labLinkQuery({
    kind: lab.kind,
    cmeStrength: lab.cmeStrength,
    distanceAU: lab.distanceAU,
    angleDeg: lab.angleRad * RAD2DEG,
    anchorId: lab.anchorId,
    date: `${String(day.year).padStart(4, '0')}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`,
    // The link names what differs from the map as the lab opens it: Europa, Titan and Pluto are off it then.
    off: lab.removed.filter((id) => !LAB_EXTRA_IDS.includes(id)),
    add: LAB_EXTRA_IDS.filter((id) => !lab.removed.includes(id)),
    focusId: lab.focusId,
    quiz: lab.quiz !== null,
  });
}

/** Custom EffectComposer pass that renders either the 3-layer lunar surface or the active SpaceView. */
class LayeredRenderPass extends Pass {
  constructor(private readonly renderFn: (renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget) => void) {
    super();
    this.needsSwap = false;
  }

  override render(
    renderer: THREE.WebGLRenderer,
    _writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    this.renderFn(renderer, readBuffer);
  }
}

void FullScreenQuad;

/**
 * Image-based light for metal and glossy parts (visor, LM foil): black sky above, regolith-grey ground below
 * with a slightly brighter horizon band. Scaled per frame by how much sunlit ground surrounds the player.
 */
function createLunarEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const envScene = new THREE.Scene();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          float y = normalize(vDir).y;
          float ground = 1.0 - smoothstep(-0.02, 0.02, y);
          float horizon = exp(-abs(y) * 18.0);
          gl_FragColor = vec4(vec3(0.16, 0.155, 0.15) * ground + vec3(0.08) * horizon, 1.0);
        }
      `,
    }),
  );
  envScene.add(dome);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();
  dome.geometry.dispose();
  return tex;
}

function createSceneLightRig(scene: THREE.Scene, environment: THREE.Texture) {
  const sun = new THREE.DirectionalLight(0xfffaf0, 2.4);
  const earth = new THREE.DirectionalLight(0x5ea8ff, 0.25);
  const extra = new THREE.DirectionalLight(0xc8e4ff, 0.0);
  const ambient = new THREE.AmbientLight(0xdbeafe, 0.14);
  const headlamp = new THREE.SpotLight(0xf8fafc, 0, 48, 34 * DEG2RAD, 0.45, 1.5);
  const headlampTarget = new THREE.Object3D();
  scene.add(sun, earth, extra, ambient, headlamp, headlampTarget);
  scene.environment = environment;
  headlamp.target = headlampTarget;

  return {
    sync(l: LightingState): void {
      scene.environmentIntensity = l.sunIntensity * THREE.MathUtils.smoothstep(l.sunDir[1], -0.03, 0.08) * 0.6 + l.earthIntensity * 2;
      sun.position.set(l.sunDir[0] * 100, l.sunDir[1] * 100, l.sunDir[2] * 100);
      sun.color.setRGB(l.sunColor[0], l.sunColor[1], l.sunColor[2]);
      sun.intensity = l.sunIntensity * Math.max(0.08, l.sunVisibility) * 1.1;

      earth.position.set(l.earthDir[0] * 100, l.earthDir[1] * 100, l.earthDir[2] * 100);
      earth.color.setRGB(l.earthColor[0], l.earthColor[1], l.earthColor[2]);
      earth.intensity = l.earthIntensity * (2.5 + l.adaptation * 2.0);

      extra.position.set(l.extraDir[0] * 100, l.extraDir[1] * 100, l.extraDir[2] * 100);
      extra.color.setRGB(l.extraColor[0], l.extraColor[1], l.extraColor[2]);
      extra.intensity = l.extraIntensity * (2.2 + l.adaptation * 3.0);

      ambient.intensity = 0.08 + l.adaptation * 0.08;

      headlamp.intensity = l.headlamp.on ? l.headlamp.intensity * 3.5 : 0;
      if (l.headlamp.on) {
        headlamp.position.set(l.headlamp.pos[0], l.headlamp.pos[1], l.headlamp.pos[2]);
        headlampTarget.position.set(
          l.headlamp.pos[0] + l.headlamp.dir[0] * 10,
          l.headlamp.pos[1] + l.headlamp.dir[1] * 10,
          l.headlamp.pos[2] + l.headlamp.dir[2] * 10,
        );
      }
    },
  };
}

export function startEngine(canvas: HTMLCanvasElement): GameAPI {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.autoClear = false;

  const mainScene = new THREE.Scene();
  const nearScene = new THREE.Scene();
  const lunarEnvironment = createLunarEnvironment(renderer);
  const mainLights = createSceneLightRig(mainScene, lunarEnvironment);
  const nearLights = createSceneLightRig(nearScene, lunarEnvironment);

  const skyCam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  const nearCam = new THREE.PerspectiveCamera(60, 1, 0.02, 20);

  const input = new Input(canvas);
  // Two fingers zoom wherever the wheel does: the telescope, the close-up views, the map, the lab.
  attachPinch(canvas);
  const audio = createAudio();
  // The stored settings reach the audio before its first use; later changes go through updateSettings.
  const storedSettings = getGame().settings;
  audio.setMasterVolume(storedSettings.masterVolume);
  audio.setMuted(!storedSettings.soundOn);
  audio.setNarrationEnabled(storedSettings.narration);
  const nasa = createNasa();
  const sky = createSky(renderer);
  const terrain = createTerrain(renderer);
  const player = createPlayer(renderer);
  const artifacts = createArtifacts();
  const globeView = createGlobeView(renderer);
  const sunView = createSunView(renderer);
  const remnantView = createRemnantView(renderer);
  const galaxyView = createGalaxyView(renderer);
  const labView = createLabView(renderer);
  labView.onPlace((angleRad, distanceAU, bodyId) => api.setLabConfig({ angleRad, distanceAU, anchorId: bodyId }, true));
  /** Wall time of the last notice that a run locks the map: it is not repeated for every click. */
  let lastLockedNoticeMs = -Infinity;
  labView.onLockedClick(() => {
    // In the class mode the place is the question's, with or without a run.
    if (getGame().lab?.quiz || performance.now() - lastLockedNoticeMs < 4000) return;
    lastLockedNoticeMs = performance.now();
    showToast({ tr: 'Yeri değiştirmek için önce “Sıfırla”ya basın.', en: 'Press “Reset” first to move the explosion.' });
  });
  let lastLabSyncMs = 0;
  mainScene.add(terrain.object3d, artifacts.object3d, player.worldObject);
  nearScene.add(player.nearObject);

  let activeSpaceView: ISpaceView = globeView;

  /**
   * Makes `view` the close-up view that is shown, at the window's present size: a view that was not shown
   * while the window was resized has not heard of it.
   */
  function showSpaceView(view: ISpaceView): void {
    activeSpaceView.detach();
    activeSpaceView = view;
    view.resize(window.innerWidth, Math.max(1, window.innerHeight));
  }
  let coreAssetsLoaded = false;

  // Hook player audio events
  player.on('step', (int) => audio.step(int));
  player.on('land', (spd) => audio.land(spd));
  player.on('jump', () => audio.cue('ui-click', 0.4));

  // Set up HDR EffectComposer + UnrealBloomPass + OutputPass
  const initQuality = QUALITY[getGame().settings.quality];
  const pr = Math.min(window.devicePixelRatio || 1, initQuality.pixelRatioCap);
  renderer.setPixelRatio(pr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  const rt = new THREE.WebGLRenderTarget(
    Math.max(1, Math.floor(window.innerWidth * pr)),
    Math.max(1, Math.floor(window.innerHeight * pr)),
    { type: THREE.HalfFloatType, format: THREE.RGBAFormat, samples: 4 },
  );
  const composer = new EffectComposer(renderer, rt);
  const governor = createResolutionGovernor();

  /** The pixel ratio the quality profile asks for on this screen. */
  function profilePixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, QUALITY[getGame().settings.quality].pixelRatioCap);
  }

  /** Sets everything that depends on it to the pixel ratio now wanted: the profile's, as far as the governor allows. */
  function applyPixelRatio(): void {
    const ratio = profilePixelRatio() * governor.scale;
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(ratio);
    composer.setSize(w, h);
    sky.setPixelRatio(ratio);
    activeSpaceView.resize(w, h);
    setGame((s) => ({ gpu: s.gpu ? { ...s.gpu, pixelRatio: ratio, width: w, height: h } : null }));
  }
  const lensFlare = createLensFlare();
  /** Scratch list of boulders and hardware near the astronaut, refilled every frame. */
  const obstacles: Collider[] = [];
  /** Part of the full frame being drawn during a tiled capture (NDC of the full frame); null otherwise. */
  let captureTile: FlareView | null = null;

  const layeredPass = new LayeredRenderPass((ren, target) => {
    const phase = getGame().phase;
    ren.setRenderTarget(target);
    ren.clear(true, true, true);

    if (phase === 'surface') {
      // 1. Sky dome & celestial objects
      // Cameras share the player's view offset too, so tiled high-resolution captures line up.
      const view = player.camera.view ? { ...player.camera.view } : null;
      skyCam.quaternion.copy(player.camera.quaternion);
      skyCam.fov = player.camera.fov;
      skyCam.aspect = player.camera.aspect;
      skyCam.view = view;
      skyCam.updateProjectionMatrix();
      ren.render(sky.scene, skyCam);

      // 2. Main surface scene (terrain, hardware, third-person suit, dust, footprints)
      ren.clearDepth();
      ren.render(mainScene, player.camera);

      // 3. First-person arms, gloves, and body in nearScene
      ren.clearDepth();
      nearCam.position.copy(player.camera.position);
      nearCam.quaternion.copy(player.camera.quaternion);
      nearCam.fov = player.camera.fov;
      nearCam.aspect = player.camera.aspect;
      nearCam.view = view ? { ...view } : null;
      nearCam.updateProjectionMatrix();
      ren.render(nearScene, nearCam);

      // 4. Lens flare from the Sun, in screen space over everything.
      lensFlare.render(ren, captureTile ?? undefined);
    } else if (phase === 'menu' || phase === 'title' || phase === 'map' || phase === 'space') {
      ren.render(activeSpaceView.scene, activeSpaceView.camera);
    }
  });

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.22,
    0.4,
    1.6,
  );
  bloomPass.enabled = initQuality.bloom;
  const guardPass = createGuardPass();
  const visorPass = createVisorPass();
  const outputPass = new OutputPass();

  composer.addPass(layeredPass);
  composer.addPass(guardPass);
  composer.addPass(bloomPass);
  composer.addPass(visorPass);
  composer.addPass(outputPass);

  // Record GPU info
  const gl = renderer.getContext();
  const dbgInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const gpuName = dbgInfo ? String(gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL)) : 'WebGL2 GPU';
  const maxTex = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
  setMaxTextureSize(maxTex);
  setGame({
    gpu: {
      renderer: gpuName,
      maxTextureSize: maxTex,
      pixelRatio: pr,
      width: window.innerWidth,
      height: window.innerHeight,
    },
  });

  // ─────────────────────────── Captions ───────────────────────────

  /** Timed cues already shown; a replayed staging clears its own cues so they show again. */
  const firedCueIds = new Set<string>();
  let subtitleSeq = 1;
  let subtitleClearTimer: number | null = null;

  let cachedHorizonProfile: Float32Array = new Float32Array(360);
  let lastHorizonPos = new THREE.Vector3(1e9, 0, 1e9);
  let lastTelemClockMs = 0;
  /** The next rise or set of the Sun and of Earth, and the wall time and the clock moment they were worked out at. */
  let sunEventAt: HorizonMoment | null = null;
  let earthEventAt: HorizonMoment | null = null;
  let lastEventCalcMs = -99999;
  let lastEventCalcJd = 0;
  let adaptation = 0;
  let surfaceExposure = 1;
  let currentSky: SkyState | null = null;
  let currentTransients: TransientState[] = [];
  let cachedCmes: CmeVisual[] = [];

  // ─────────────────────────── The lab's supernova, watched from the ground ───────────────────────────

  /** The lab scenario being watched from the ground; the event and the new star made from it for the world it is watched from. */
  let labWatchSource: LabWatchSource | null = null;
  let labEvent: EventDef | null = null;
  let labTransient: SupernovaDef | null = null;

  /** An event by its id: one of the chapters, or the lab's supernova while it is watched from the ground. */
  function eventById(id: string | null): EventDef | undefined {
    return labEvent?.id === id ? labEvent : EVENTS.find((e) => e.id === id);
  }

  /** A supernova or comet of the sky by its id: one of the historical ones, or the lab's. */
  function transientById(id: string): TransientDef | undefined {
    return labTransient?.id === id ? labTransient : TRANSIENTS.find((t) => t.id === id);
  }

  /**
   * Makes the lab's supernova and its event as they are seen from `world`, with what the lab's model says
   * becomes of that world.
   */
  function showLabWatchFrom(world: WorldId): void {
    const src = labWatchSource;
    if (!src) return;
    // The map's angle is minus the ecliptic longitude.
    const seen = mapPointSeenFrom(world, src.jdTT, -src.angleRad * RAD2DEG, src.distanceAU, labLandmarkLatitudeDeg(src.anchorId));
    const skyThere = computeSky(src.jdTT, SITES[0], world);
    const sunGapDeg = angularSeparationDeg(skyThere.bodies.sun.dirLocal, dirLocalFromRaDec(skyThere, seen.raDeg, seen.decDeg));
    // Lunar orbit shares the Moon's fate; a world that was off the lab's map has none, and Earth's is told
    // instead. Only the first sentence of a fate: texts in other languages are looked up by the whole English
    // text, so sentences cannot be joined.
    const bodyId = world === 'orbit' ? 'moon' : world;
    const aftermath = (bodyId === 'earth' ? undefined : src.fates.find((f) => f.id === bodyId)?.summary[0]) ?? src.earthSummary;
    const watch = buildLabWatch(src.kind, src.distanceAU, src.jdTT, seen, sunGapDeg, aftermath);
    labEvent = watch.event;
    labTransient = watch.transient;
  }

  /** Takes the lab's supernova out of the sky again. */
  function leaveLabWatch(): void {
    labWatchSource = null;
    labEvent = null;
    labTransient = null;
  }

  // ─────────────────────────── Staging director ("before → event → after") ───────────────────────────

  let director: Director | null = null;
  /** Sequences already played for this event, keyed `${eventId}:${where}`; relocating does not replay them. */
  const playedStagings = new Set<string>();
  let stageShade = false;
  /** Field of view imposed by the running step (telescope or cinematic zoom); null when the player controls it. */
  let stageFov: number | null = null;
  let lastManualLookSec = -99;
  /** Smooth camera turn started by clicking a target in the compass/data panel. */
  let lookTargetId: string | null = null;
  let lastClockJd = 0;
  /** Set when a step begins: the view snaps to the step's focus once this frame's sky is known. */
  let pendingSnap = false;
  /** A sequence that has just been skipped: the view goes where it shows last once the sky of its end is known. */
  let skippedStaging: StagingDef | null = null;
  /** Where the astronaut stands on a world other than the Moon; null = the landed site's own coordinates. */
  let seat: SiteCoord | null = null;
  /** While a sequence plays on another world: the direction in space that the seat's zenith is held to. */
  let seatZenithIcrf: THREE.Vector3 | null = null;

  /**
   * What a sequence about `id` looks at from `world`. Standing on the target itself, the view turns to the
   * other planet of the pair (Jupiter and Saturn) or to Earth.
   */
  function focusFrom(world: WorldId, id: string): string {
    if (id !== world) return id;
    return world === 'jupiter' ? 'saturn' : world === 'saturn' ? 'jupiter' : 'earth';
  }

  function stageStatusOf(staging: StagingDef, index: number, playing: boolean) {
    const step = staging.stages[index];
    const focus = step.focusId ?? staging.focusId ?? null;
    return {
      where: staging.where,
      steps: staging.stages.map((s) => ({ id: s.id, kind: s.kind, label: s.label })),
      index,
      caption: step.caption,
      playing,
      focusId: focus === null || focus === 'none' ? null : staging.where === 'surface' ? focusFrom(getGame().world, focus) : focus,
    };
  }

  /**
   * Plays `staging` from step `index` (0 = from its first moment). A sequence in the sky is not played on a
   * world whose clouds hide the sky: a warning says so, and time runs on at the sequence's resting rate.
   */
  function startStaging(ev: EventDef, staging: StagingDef, index = 0): void {
    const st = getGame();
    if (staging.where === 'surface' && OVERCAST_WORLDS[st.world]) {
      setGame({ stage: null, clock: { ...st.clock, rate: staging.endRate, paused: false } });
      showToast(lf(
        tpl`${WORLDS[st.world].name} bulutlarla kaplı: gökyüzü görünmüyor, “${ev.title}” buradan izlenemez.`,
        tpl`${WORLDS[st.world].name} is covered in clouds: the sky cannot be seen, and “${ev.title}” cannot be watched from here.`,
      ), 'warn');
      return;
    }
    director = createDirector(staging, index);
    // The sequence steers the view: a turn asked for before it began is dropped.
    lookTargetId = null;
    playedStagings.add(`${ev.id}:${staging.where}`);
    const startJd = momentJd(staging.stages[index].from);
    lastClockJd = startJd;
    // Quotes tied to clock moments are part of the sequence and replay with it.
    for (const cue of ev.cues ?? []) firedCueIds.delete(cue.id);
    // On another world the sequence is watched from a seat chosen for it and held under the same stars. On
    // the Moon the astronaut stands at a real place and sees its sky; only a sequence that runs through many
    // of the Moon's rotations is held, under the stars that are over the place at its first moment.
    seatZenithIcrf = null;
    if (staging.where === 'surface' && st.site && st.world !== 'orbit') {
      if (st.world !== 'moon') {
        const picked = staging.focusId ? pickSeat(st.world, startJd, focusFrom(st.world, staging.focusId)) : null;
        seat = picked ?? seat ?? { latDeg: st.site.latDeg, lonDeg: st.site.lonDeg };
        seatZenithIcrf = zenithIcrf(st.world, startJd, seat);
      } else if (staging.heldToStars) {
        seatZenithIcrf = zenithIcrf('moon', momentJd(staging.stages[0].from), st.site);
      }
    }
    // A sequence started while time is paused (Pause, then Replay) runs: the director only advances unpaused.
    setGame({
      stage: stageStatusOf(staging, index, true),
      skyLocked: seatZenithIcrf !== null,
      clock: { jdTT: startJd, rate: st.clock.rate, paused: false },
    });
  }

  /**
   * Stops the director. `finished` jumps the clock to the end of the sequence; an interrupted sequence stays
   * at its moment. Either way time returns to the sequence's resting rate instead of its time-lapse rate.
   */
  function endStaging(finished: boolean): void {
    skippedStaging = null;
    if (!director) return;
    const staging = director.staging;
    director = null;
    stageShade = false;
    seatZenithIcrf = null;
    frame.stageFade = 0;
    frame.stageProgress = finished ? 1 : frame.stageProgress;
    releaseStageFov();
    const st = getGame();
    // On the Moon the sky is the landed place's own again once nothing holds it.
    if (st.world === 'moon') seat = null;
    setGame({
      stage: st.stage ? (finished ? stageStatusOf(staging, staging.stages.length - 1, false) : { ...st.stage, playing: false }) : null,
      skyLocked: false,
    });
    setGame({ clock: { jdTT: finished ? stagingEndJd(staging) : st.clock.jdTT, rate: staging.endRate, paused: false } });
  }

  function releaseStageFov(): void {
    if (stageFov === null) return;
    stageFov = null;
    player.setFov(60);
    setGame({ telescope: { active: false, fovDeg: 60 } });
  }

  function applyStageEntry(stage: StageDef, index: number, staging: StagingDef): void {
    setGame({ stage: stageStatusOf(staging, index, true) });
    // With narration on, each step's caption is read aloud as it begins.
    const lang = getGame().settings.lang;
    audio.narrate(loc(stage.caption, lang), lang);
    stageShade = Boolean(stage.shadeSun);
    const fov = stage.telescopeFovDeg ?? stage.zoomFovDeg;
    if (fov === undefined) {
      releaseStageFov();
    } else {
      stageFov = fov;
      player.setFov(fov);
      setGame({ telescope: { active: stage.telescopeFovDeg !== undefined, fovDeg: fov } });
    }
    if (stage.standAt && staging.where === 'surface') {
      player.teleport(stage.standAt.x, stage.standAt.z, stage.standAt.headingDeg, terrain, 0);
      lastHorizonPos.set(1e9, 0, 1e9);
    }
    lastManualLookSec = -99;
  }

  /** Direction from the eye to a sky target or surface asset, or null when it is unknown here. */
  function focusDirection(id: string, ground: boolean): THREE.Vector3 | null {
    if (!currentSky) return null;
    if (id === 'moon' && currentSky.moon) return new THREE.Vector3(...currentSky.moon.dirLocal);
    if (id in currentSky.bodies) return new THREE.Vector3(...currentSky.bodies[id as BodyId].dirLocal);
    const tr = currentTransients.find((t) => t.id === id);
    if (tr) return new THREE.Vector3(...tr.dirLocal);
    const gal = GALAXIES.find((g) => g.id === id);
    if (gal) return new THREE.Vector3(...dirLocalFromRaDec(currentSky, gal.raDeg, gal.decDeg));
    const art = artifacts.list().find((a) => a.assetId === id);
    if (!art) return null;
    const p = ground ? art.position.clone().setY(art.position.y + 1) : art.focus.clone();
    return p.sub(player.camera.position).normalize();
  }

  /**
   * Turns the view to what `stage` of a surface sequence shows, framed for a field of view of `fovDeg`: at
   * once when `snap`, otherwise eased, and not while the player is looking around.
   */
  function steerView(staging: StagingDef, stage: StageDef, fovDeg: number, dt: number, snap: boolean): void {
    if (staging.where !== 'surface') return;
    const named = stage.focusId ?? staging.focusId;
    if (!named || named === 'none') return;
    const id = focusFrom(getGame().world, named);
    if (!snap && frame.time - lastManualLookSec < 2.5) return;
    const d = focusDirection(id, Boolean(stage.focusGround));
    if (!d) return;
    const heading = (Math.atan2(d.x, -d.z) * RAD2DEG + 360) % 360;
    const el = Math.asin(Math.max(-1, Math.min(1, d.y))) * RAD2DEG;
    // Narrow views centre the target; wider views lift it a little above the centre so low targets keep the
    // horizon in frame, without ever pushing it up under the stage panel.
    const pitch = fovDeg < 20 ? el : el - Math.min(Math.max(el, 0) * 0.6, fovDeg * 0.15);
    if (snap) {
      player.setLook(heading, pitch);
      return;
    }
    const k = 1 - Math.exp(-dt * 2.5);
    const dh = ((heading - player.state.headingDeg + 540) % 360) - 180;
    player.setLook(player.state.headingDeg + dh * k, player.state.pitchDeg + (pitch - player.state.pitchDeg) * k);
  }

  function fireClockCues(fromJd: number, toJd: number): void {
    // Long jumps (dragging the year slider) skip the cues instead of showing them all at once.
    if (toJd <= fromJd || toJd - fromJd > 1) return;
    const ev = eventById(getGame().activeEventId);
    if (!ev) return;
    for (const cue of ev.cues ?? []) {
      if (firedCueIds.has(cue.id)) continue;
      const at = momentJd(cue.at);
      if (at > fromJd && at <= toJd) {
        firedCueIds.add(cue.id);
        pushSubtitle(cue.speaker ?? null, cue.text);
      }
    }
  }

  /** Elevation of a target above the ideal horizon at a site, using a sky already computed for the same moment. */
  function elevationAt(dirIcrf: THREE.Vector3, moonFixedFromIcrf: THREE.Matrix3, site: SiteCoord): number {
    const f = dirIcrf.clone().applyMatrix3(moonFixedFromIcrf);
    const lat = site.latDeg * DEG2RAD;
    const lon = site.lonDeg * DEG2RAD;
    const up = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
    return Math.asin(Math.max(-1, Math.min(1, up.dot(f)))) * RAD2DEG;
  }

  /**
   * Elevation of the skyline at an azimuth from where the astronaut stands: the terrain's on solid ground,
   * the cloud tops a little below eye level over a giant.
   */
  function skylineDeg(azDeg: number): number {
    return WORLDS[getGame().world].solidSurface ? horizonElevationAt(cachedHorizonProfile, azDeg) : -2;
  }

  /** The next rise or set of `body` after `jdTT` as seen from `here`; null when there is none within 15 days. */
  function nextHorizonMoment(body: 'sun' | 'earth', jdTT: number, here: SiteCoord, world: WorldId): HorizonMoment | null {
    const next = nextHorizonEvent(body, jdTT, here, cachedHorizonProfile, 15, world);
    return next && { kind: next.kind, jdTT: jdTT + next.inHours / 24 };
  }

  /** What is left at `jdTT` until `moment`; null once the clock is no longer between its working-out and it. */
  function timeUntil(moment: HorizonMoment | null, jdTT: number): HorizonEvent | null {
    return moment && jdTT >= lastEventCalcJd && jdTT < moment.jdTT
      ? { kind: moment.kind, inHours: (moment.jdTT - jdTT) * 24 }
      : null;
  }

  /** A place on the Moon that is no named site, made up for watching an event from. */
  function viewingSpot(at: SiteCoord): SiteDef {
    return {
      id: 'custom',
      latDeg: at.latDeg,
      lonDeg: at.lonDeg,
      name: lf(tpl`Gözlem noktası (${at.latDeg}°, ${at.lonDeg}°)`, tpl`Viewing spot (${at.latDeg}°, ${at.lonDeg}°)`),
      region: { tr: 'Bu olay için seçilen gözlem yeri', en: 'Viewing spot chosen for this event' },
      blurb: {
        tr: 'Olay boyunca gök cismi ufkun epey üzerinde kalır; başlangıçta gökyüzü karanlıktır.',
        en: 'The object stays well above the horizon throughout the event, and the sky is dark at the start.',
      },
    };
  }

  /**
   * Best place to watch a staged sky event: the target stays well above the horizon for every moment of the
   * sequence, ideally in a dark sky at its start. Named sites win ties; otherwise an observing spot is made up.
   * A sequence that is held under the same stars is seen as its first moment shows it: its place is chosen
   * as a seat on another world is.
   */
  function pickVantage(staging: StagingDef, targetId: string): SiteDef | null {
    if (staging.heldToStars) {
      const seatAt = pickSeat('moon', momentJd(staging.stages[0].from), targetId);
      return seatAt && viewingSpot(seatAt);
    }
    const ref = SITES[0];
    const trDef = transientById(targetId);
    const valid: Array<{ target: THREE.Vector3; sun: THREE.Vector3; moonFixedFromIcrf: THREE.Matrix3 }> = [];
    for (const jd of stagingSampleJds(staging)) {
      const sky = computeSky(jd, ref);
      const local = targetId in sky.bodies ? sky.bodies[targetId as BodyId].dirLocal : trDef ? transientState(trDef, sky).dirLocal : null;
      if (!local) return null;
      // Mat3 is row-major and Matrix3.fromArray reads column-major: loading M yields its transpose (= inverse rotation).
      const icrfFromLocal = new THREE.Matrix3().fromArray(sky.localFromIcrf);
      valid.push({
        target: new THREE.Vector3(...local).applyMatrix3(icrfFromLocal),
        sun: new THREE.Vector3(...sky.bodies.sun.dirLocal).applyMatrix3(icrfFromLocal),
        moonFixedFromIcrf: new THREE.Matrix3().fromArray(bodyOrientation('moon', jd).fixedToIcrf),
      });
    }
    const score = (site: SiteCoord, named: boolean): number => {
      let minEl = 90;
      let maxEl = -90;
      for (const s of valid) {
        const el = elevationAt(s.target, s.moonFixedFromIcrf, site);
        minEl = Math.min(minEl, el);
        maxEl = Math.max(maxEl, el);
      }
      const dark = elevationAt(valid[0].sun, valid[0].moonFixedFromIcrf, site) < -6 ? 12 : 0;
      return (minEl < 12 ? minEl * 4 : Math.min(minEl, 35)) - Math.max(0, maxEl - 70) * 0.5 + dark + (named ? 8 : 0);
    };
    let best: { site: SiteDef; score: number } | null = null;
    for (const s of SITES) {
      const v = score(s, true);
      if (!best || v > best.score) best = { site: s, score: v };
    }
    for (let lat = -35; lat <= 35; lat += 5) {
      for (let lon = -180; lon < 180; lon += 5) {
        const v = score({ latDeg: lat, lonDeg: lon }, false);
        if (best && v <= best.score) continue;
        best = { score: v, site: viewingSpot({ latDeg: lat, lonDeg: lon }) };
      }
    }
    return best?.site ?? null;
  }

  /**
   * Seat for watching a staged sky event under held stars: the target high in a dark sky as the sequence
   * begins. The seat is then held under the same stars while the sequence plays (see `holdSeatToStars`).
   */
  function pickSeat(world: Exclude<WorldId, 'orbit'>, jdTT: number, targetId: string): SiteCoord | null {
    const sky = computeSky(jdTT, SITES[0], world);
    const trDef = transientById(targetId);
    const local = targetId in sky.bodies ? sky.bodies[targetId as BodyId].dirLocal : trDef ? transientState(trDef, sky, world).dirLocal : null;
    if (!local || targetId === world) return null;
    // Loading a row-major Mat3 with Matrix3.fromArray yields its transpose (see pickVantage).
    const icrfFromLocal = new THREE.Matrix3().fromArray(sky.localFromIcrf);
    const fixedFromIcrf = new THREE.Matrix3().fromArray(bodyOrientation(world, jdTT).fixedToIcrf);
    const target = new THREE.Vector3(...local).applyMatrix3(icrfFromLocal);
    const sun = new THREE.Vector3(...sky.bodies.sun.dirLocal).applyMatrix3(icrfFromLocal);
    let best: { coord: SiteCoord; score: number } | null = null;
    for (let lat = -60; lat <= 60; lat += 5) {
      for (let lon = -180; lon < 180; lon += 5) {
        const coord: SiteCoord = { latDeg: lat, lonDeg: lon };
        const el = elevationAt(target, fixedFromIcrf, coord);
        const sunEl = elevationAt(sun, fixedFromIcrf, coord);
        // First the target clear of the horizon, about 30° up so that the ground shares the view; then the
        // Sun below the horizon (beyond −18° the sky is as dark as it gets).
        const height = el < 8 ? (el - 8) * 6 : Math.min(el, 30) - Math.max(0, el - 36);
        const score = height - Math.max(-18, Math.min(sunEl, 20)) * 0.8;
        if (!best || score > best.score) best = { coord, score };
      }
    }
    return best?.coord ?? null;
  }

  /**
   * Seat on another world for free exploration: where it is day now, so that what is there can be seen on
   * arrival. On solid ground the Sun is well up but not overhead (the ground, the colour of the sky, the
   * shadows); over the cloud tops of the giants it is low, where its light picks out their relief.
   */
  function pickFreeSeat(world: Exclude<WorldId, 'moon' | 'orbit'>, jdTT: number): SiteCoord {
    const wantedSunEl = WORLDS[world].solidSurface ? 38 : 16;
    const sky = computeSky(jdTT, SITES[0], world);
    const icrfFromLocal = new THREE.Matrix3().fromArray(sky.localFromIcrf);
    const fixedFromIcrf = new THREE.Matrix3().fromArray(bodyOrientation(world, jdTT).fixedToIcrf);
    const sun = new THREE.Vector3(...sky.bodies.sun.dirLocal).applyMatrix3(icrfFromLocal);
    let best: SiteCoord = { latDeg: 0, lonDeg: 0 };
    let bestMiss = Infinity;
    for (let lat = -40; lat <= 40; lat += 5) {
      for (let lon = -180; lon < 180; lon += 5) {
        const coord: SiteCoord = { latDeg: lat, lonDeg: lon };
        const miss = Math.abs(elevationAt(sun, fixedFromIcrf, coord) - wantedSunEl) + Math.abs(lat) * 0.05;
        if (miss < bestMiss) {
          bestMiss = miss;
          best = coord;
        }
      }
    }
    return best;
  }

  /** Direction in space of the zenith of a place on `world` at `jdTT`. */
  function zenithIcrf(world: Exclude<WorldId, 'orbit'>, jdTT: number, at: SiteCoord): THREE.Vector3 {
    const lat = at.latDeg * DEG2RAD;
    const lon = at.lonDeg * DEG2RAD;
    const icrfFromFixed = new THREE.Matrix3().fromArray(bodyOrientation(world, jdTT).fixedToIcrf).transpose();
    return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)).applyMatrix3(icrfFromFixed);
  }

  /**
   * Moves the seat so that its zenith keeps pointing at the same stars as the world turns: the sky is shown
   * as in a time-lapse that takes one frame per rotation, instead of wheeling round many times a second.
   */
  function holdSeatToStars(world: WorldId, jdTT: number): void {
    if (!seatZenithIcrf || world === 'orbit') return;
    const f = seatZenithIcrf.clone().applyMatrix3(new THREE.Matrix3().fromArray(bodyOrientation(world, jdTT).fixedToIcrf));
    seat = { latDeg: Math.asin(Math.max(-1, Math.min(1, f.z))) * RAD2DEG, lonDeg: Math.atan2(f.y, f.x) * RAD2DEG };
  }

  /**
   * Puts the astronaut's surroundings (ground, sky, gravity) on `world`. Free exploration of another world
   * begins at a seat chosen for it; a chapter's sequence picks its own seat when it starts.
   */
  function applyWorld(world: WorldId): void {
    terrain.setWorld(world);
    sky.setWorld(world);
    player.setWorld(WORLDS[world]);
    artifacts.object3d.visible = world === 'moon';
    const st = getGame();
    seat = world === 'moon' || world === 'orbit' || st.activeEventId ? null : pickFreeSeat(world, st.clock.jdTT);
    lastEventCalcMs = 0;
  }

  /**
   * Starts the active event where the astronaut now stands: its surface sequence, or, for an event that
   * plays in a close-up view (the Mars dust storm, the solar storm), that view.
   */
  function beginEventHere(): void {
    const st = getGame();
    const ev = eventById(st.activeEventId);
    if (!ev) return;
    if (ev.seenFrom === 'moon' && st.world !== 'moon') {
      setGame({ stage: null });
      showToast(lf(
        tpl`“${ev.title}” yalnızca Ay’dan izlenir. İzlemek için üstteki listeden Ay’ı seçin.`,
        tpl`“${ev.title}” can only be watched from the Moon. Choose the Moon in the list above to watch it.`,
      ), 'warn');
      return;
    }
    const surface = ev.staging?.find((s) => s.where === 'surface');
    const view = ev.staging?.find((s) => s.where !== 'surface');
    if (surface) {
      if (!playedStagings.has(`${ev.id}:surface:${st.world}`)) {
        playedStagings.add(`${ev.id}:surface:${st.world}`);
        startStaging(ev, surface);
      }
    } else if (view && !playedStagings.has(`${ev.id}:${view.where}`)) {
      api.enterSpaceView(view.where);
    }
  }

  /** Shows a subtitle; quotes (with a speaker) get the Apollo radio tone, narration does not. */
  function pushSubtitle(speaker: L10n | null, text: L10n): void {
    if (subtitleClearTimer !== null) window.clearTimeout(subtitleClearTimer);
    if (speaker) audio.cue('radio-on', 0.6);
    setGame({ subtitle: { id: subtitleSeq++, speaker, text } });
    audio.narrate(loc(text, getGame().settings.lang), getGame().settings.lang);
    subtitleClearTimer = window.setTimeout(() => {
      setGame({ subtitle: null });
    }, 7500);
  }

  /**
   * Counts the pages entered. A landing whose data is still loading when another page is entered must not
   * arrive after all: it compares the count it started with.
   */
  let journey = 0;
  /** The loads of the landing begun last, finished or not: the next landing waits for them. */
  let landingLoads: Promise<unknown> = Promise.resolve();
  /** The picture the galaxy view shows now (null until the first has arrived): a choice that fails goes back to it. */
  let galaxyShownId: string | null = null;

  /**
   * What belonged to the page being left must not show on the next: the hardware card, the open panels (the
   * data panel is a preference and stays), the caption with its speech, the toast. A landing still under
   * way for the page being left is void.
   */
  function clearPageState(): void {
    journey += 1;
    if (subtitleClearTimer !== null) window.clearTimeout(subtitleClearTimer);
    subtitleClearTimer = null;
    audio.stopNarration();
    setGame((s) => ({
      focusAssetId: null,
      subtitle: null,
      toast: null,
      panels: { ...s.panels, info: false, about: false, settings: false, help: false, credits: false, pause: false },
    }));
  }

  // ─────────────────────────── Map Globe Setup ───────────────────────────

  async function enterMapGlobe(jdTT: number, selectedSite: SiteDef): Promise<void> {
    const st = getGame();
    const markers: GlobeMarker[] = SITES.map((s) => ({
      id: s.id,
      latDeg: s.latDeg,
      lonDeg: s.lonDeg,
      label: s.name,
      kind: 'site',
      color: s.id === selectedSite.id ? '#ffb454' : '#5fd4ff',
    }));

    showSpaceView(globeView);
    await globeView.enter({
      targetId: 'moon',
      jdTT,
      lang: st.settings.lang,
      quality: QUALITY[st.settings.quality],
      mode: 'picker',
      markers,
      onPick: (latDeg, lonDeg) => {
        audio.cue('ui-click');
        const customSite: SiteDef = {
          id: 'custom',
          latDeg,
          lonDeg,
          name: lf(
            tpl`Özel Nokta (${(l: Lang) => fmt(latDeg, 1, l)}°, ${(l: Lang) => fmt(lonDeg, 1, l)}°)`,
            tpl`Custom Site (${(l: Lang) => fmt(latDeg, 1, l)}°, ${(l: Lang) => fmt(lonDeg, 1, l)}°)`,
          ),
          region: { tr: 'Serbest Seçim Koordinatı', en: 'Custom Selenographic Coordinate' },
          blurb: {
            tr: '3B Ay küresi üzerinden doğrudan seçtiğiniz özel iniş koordinatı.',
            en: 'Custom lunar coordinates picked directly on the 3D Moon globe.',
          },
        };
        setGame({ mapSelection: customSite });
        globeView.setSelection(customSite, false);
      },
      onMarker: (markerId) => {
        const found = SITES.find((s) => s.id === markerId);
        if (found) {
          audio.cue('ui-click');
          setGame({ mapSelection: found });
          globeView.setSelection(found, true);
        }
      },
    });
    // The player may have moved on (landed, back to menu) while the textures loaded.
    if (getGame().phase !== 'map') return;
    globeView.setSelection(selectedSite, true);
    globeView.attach(canvas);
  }

  /**
   * Makes `eventId` the active chapter (null = free exploration): its start time, rate and best site. Free
   * exploration starts at `freeJd`: today, unless it follows from something that showed another date.
   */
  function prepareEvent(eventId: string | null, freeJd = jdTTNow()): SiteDef {
    endStaging(false);
    playedStagings.clear();
    // Any other chapter takes the lab's supernova out of the sky, and with it the way back to the lab.
    if (eventId !== LAB_WATCH_EVENT_ID) {
      leaveLabWatch();
      setGame({ labReturn: null });
    }
    const ev = eventById(eventId);
    const surfaceStaging = ev?.staging?.find((s) => s.where === 'surface');
    // A staged chapter opens on its "before" moment; the event itself is still the card's date.
    const jdTT = surfaceStaging
      ? momentJd(surfaceStaging.stages[0].from)
      : ev ? jdTTFromCalendarUT(ev.date) : freeJd;
    let defaultSite = SITES.find((s) => s.id === (ev?.defaultSiteId ?? 'apollo11')) ?? SITES[0];
    if (!ev) {
      // The first listed place where the Sun is up then, so that the visit does not open in the dark.
      defaultSite = SITES.find((s) => computeSky(jdTT, s).bodies.sun.elDeg > 8) ?? defaultSite;
    } else if (surfaceStaging?.autoSeat && surfaceStaging.focusId) {
      defaultSite = pickVantage(surfaceStaging, surfaceStaging.focusId) ?? defaultSite;
    } else if (ev?.primaryTargetId && !surfaceStaging) {
      // Unstaged chapters: the recommended site where the target stands highest.
      let bestEl = -90;
      for (const sid of ev.recommendedSiteIds) {
        const cand = SITES.find((s) => s.id === sid);
        if (!cand) continue;
        const sk = computeSky(jdTT, cand);
        const trDef = transientById(ev.primaryTargetId);
        const el = ev.primaryTargetId in sk.bodies
          ? sk.bodies[ev.primaryTargetId as BodyId].elDeg
          : trDef ? transientState(trDef, sk).elDeg : -90;
        if (el > bestEl) {
          bestEl = el;
          defaultSite = cand;
        }
      }
    }
    setGame({
      activeEventId: eventId,
      mapSelection: defaultSite,
      mapWorld: 'moon',
      stage: null,
      clock: { jdTT, rate: surfaceStaging ? 0 : ev?.startRate ?? 1, paused: false },
      toast: null,
      subtitle: null,
    });
    return defaultSite;
  }

  // ─────────────────────────── Tutorial & spectator modes ───────────────────────────

  const tutorialTrack = { lookDeg: 0, lastHeading: 0, runM: 0, shadeSec: 0, walk0: 0, jumps0: 0, doneAt: -1 };
  /** Bumped whenever a spectator event starts or the tour stops; stale async landings check it. */
  let spectatorToken = 0;
  /** Real time (frame.time) when the tour moves on after a finished sequence; -1 while one plays. */
  let spectatorNextAt = -1;
  let spectatorEventStartSec = 0;
  const SPECTATOR_HOLD_SEC = 6;
  /** Events whose sequence never starts (should not happen) still move on after this long. */
  const SPECTATOR_MAX_SEC = 240;

  function enterTutorialStep(index: number): void {
    tutorialTrack.lookDeg = 0;
    tutorialTrack.lastHeading = player.state.headingDeg;
    tutorialTrack.runM = 0;
    tutorialTrack.shadeSec = 0;
    tutorialTrack.walk0 = player.state.distanceWalkedM;
    tutorialTrack.jumps0 = player.state.jumpCount;
    tutorialTrack.doneAt = -1;
    const finished = index >= TUTORIAL_STEPS.length;
    setGame({ tutorial: { index: Math.min(index, TUTORIAL_STEPS.length - 1), progress: finished ? 1 : 0, finished } });
    // The step before may have left the telescope up.
    if (!finished && !TELESCOPE_CHECKS[TUTORIAL_STEPS[index].check.kind] && getGame().telescope.active) api.setTelescope(false);
    if (finished) audio.cue('complete');
  }

  function evaluateTutorial(dt: number): void {
    const st = getGame();
    const tut = st.tutorial;
    if (!tut || tut.finished) return;
    if (tutorialTrack.doneAt >= 0) {
      if (frame.time - tutorialTrack.doneAt > 1.2) enterTutorialStep(tut.index + 1);
      return;
    }
    const dh = ((player.state.headingDeg - tutorialTrack.lastHeading + 540) % 360) - 180;
    tutorialTrack.lastHeading = player.state.headingDeg;
    if (st.phase === 'surface') {
      tutorialTrack.lookDeg += Math.abs(dh);
      const speed = Math.hypot(player.state.velocity.x, player.state.velocity.z);
      if (speed > 2.4) tutorialTrack.runM += speed * dt;
      if (player.shadeAmount > 0.25) tutorialTrack.shadeSec += dt;
    }
    const c = TUTORIAL_STEPS[tut.index].check;
    let progress = 0;
    switch (c.kind) {
      case 'look': progress = tutorialTrack.lookDeg / c.degrees; break;
      case 'walk': progress = (player.state.distanceWalkedM - tutorialTrack.walk0) / c.meters; break;
      case 'run': progress = tutorialTrack.runM / c.meters; break;
      case 'jump': progress = (player.state.jumpCount - tutorialTrack.jumps0) / c.count; break;
      case 'viewMode': progress = st.viewMode === c.mode ? 1 : 0; break;
      case 'shade': progress = tutorialTrack.shadeSec / c.seconds; break;
      case 'info': progress = st.focusAssetId === c.targetId ? 1 : 0; break;
      case 'telescope': progress = st.telescope.active ? 1 : 0; break;
      case 'telescopeAim': {
        const aimed = st.telescope.active && st.reticleId === c.targetId;
        const zoom = Math.min(1, (35 - st.telescope.fovDeg) / (35 - c.maxFovDeg));
        progress = !aimed ? 0 : st.telescope.fovDeg <= c.maxFovDeg ? 1 : 0.2 + 0.75 * Math.max(0, zoom);
        break;
      }
      case 'enterView': progress = st.phase === 'space' && st.spaceView?.targetId === c.targetId ? 1 : 0; break;
      case 'surface': progress = st.phase === 'surface' ? 1 : 0; break;
      case 'timeRate': progress = Math.abs(st.clock.rate) >= c.minRate && !st.clock.paused ? 1 : 0; break;
    }
    progress = Math.max(0, Math.min(1, progress));
    if (progress >= 1) {
      tutorialTrack.doneAt = frame.time;
      audio.cue('confirm');
    }
    if (Math.abs(progress - tut.progress) > 0.01 || progress >= 1) setGame({ tutorial: { ...tut, progress } });
  }

  async function playSpectatorEvent(index: number): Promise<void> {
    const n = EVENTS.length;
    const i = ((index % n) + n) % n;
    const ev = EVENTS[i];
    const token = ++spectatorToken;
    spectatorNextAt = -1;
    setGame({ spectator: { index: i, paused: false }, tutorial: null });
    if (getGame().phase === 'space') {
      activeSpaceView.detach();
      setGame({ spaceView: null });
    }
    const site = prepareEvent(ev.id);
    await api.landAt(site);
    if (token !== spectatorToken || !getGame().spectator) return;
    // Hands off: no walking or hotkeys; the director frames every moment.
    input.enabled = false;
    input.exitLock();
    if (getGame().viewMode !== 'first') api.setViewMode('first');
    spectatorEventStartSec = frame.time;
  }

  /** Advances the spectator tour once an event's sequence has finished and been held on screen. */
  function updateSpectator(): void {
    const st = getGame();
    if (!st.spectator || st.spectator.paused || st.clock.paused) return;
    if (st.phase !== 'surface' && st.phase !== 'space') return;
    const overdue = frame.time - spectatorEventStartSec > SPECTATOR_MAX_SEC;
    if (director && !overdue) {
      spectatorNextAt = -1;
      return;
    }
    if (spectatorNextAt < 0) {
      spectatorNextAt = frame.time + SPECTATOR_HOLD_SEC;
    } else if (frame.time >= spectatorNextAt) {
      spectatorNextAt = -1;
      playSpectatorEvent(st.spectator.index + 1).catch(() => undefined);
    }
  }

  /** Leaves tutorial and spectator modes; normal controls come back on the surface. */
  function leaveModes(): void {
    const st = getGame();
    if (!st.tutorial && !st.spectator) return;
    spectatorToken++;
    spectatorNextAt = -1;
    setGame({ tutorial: null, spectator: null });
    if (st.phase === 'surface') input.enabled = true;
  }

  // ─────────────────────────── Explosion Lab ───────────────────────────

  /** The lab as it stood when the class mode began: the scenario to put back when the mode ends. */
  let labBeforeQuiz: LabState | null = null;

  /**
   * Works out what the explosion of `setup` does, to Earth and to the bodies that are on the map, and gives
   * it to the lab's view.
   */
  function labResults(setup: LabSetup, bodies: LabBody[], removed: string[]): LabResults {
    const impact = computeLabImpact(setup);
    const fates = computeLabFates(setup, bodies, removed);
    labView.setResults(impact, fates);
    return { impact, fates, runSec: labRunSeconds(impact, fates) };
  }

  /**
   * Sets the lab up for question `index` of the class mode and waits for the prediction: the map as the lab
   * opens it, the question's explosion at its place, the body it asks about in focus, and the rings that
   * would give the answer away hidden. `rounds`: the questions answered so far.
   */
  function askLabQuestion(index: number, rounds: LabQuiz['rounds']): void {
    const prev = getGame().lab;
    const q = LAB_QUESTIONS[index];
    if (!prev || !q) return;
    const removed = [...LAB_EXTRA_IDS];
    // At a body or a star of the map (a solar eruption: where the Sun is), or at a distance in the direction
    // the explosion is in now.
    const anchorId = 'anchorId' in q.place ? q.place.anchorId : null;
    const anchor = prev.bodies.find((b) => b.id === anchorId);
    const angleRad = anchor ? (q.kind === 'cme' ? anchor.angleRad : anchor.spotRad) : prev.angleRad;
    const distanceAU = anchor?.distanceAU ?? ('distanceAU' in q.place ? q.place.distanceAU : prev.distanceAU);
    const setup: LabSetup = { kind: q.kind, angleRad, distanceAU, cmeStrength: q.cmeStrength };
    labView.configure(q.kind, angleRad, distanceAU, false);
    labView.setRemoved(removed);
    const results = labResults(setup, prev.bodies, removed);
    labView.resetExplosion();
    labView.setPaused(false);
    labView.setEvaMode(false);
    labView.setFocus(q.bodyId, false);
    labView.setFraming('orbit');
    labView.setConcealed(true);
    setGame({
      lab: {
        ...prev,
        ...setup,
        ...results,
        anchorId: anchor?.id ?? null,
        removed,
        focusId: q.bodyId,
        playing: false,
        paused: false,
        elapsedSec: 0,
        evaMode: false,
        quiz: { index, count: LAB_QUESTIONS.length, phase: 'ask', question: q.question, picked: null, rounds },
      },
    });
  }

  /**
   * The class mode as it stands `elapsedSec` into the lab's time-lapse. While a question's explosion plays:
   * once everything that happens to the body it asks about has been shown, and a moment more, the rings come
   * back and the model's answer is noted beside the prediction.
   */
  function labQuizAfter(lab: LabState, elapsedSec: number): LabQuiz | null {
    const quiz = lab.quiz;
    if (!quiz || quiz.phase !== 'run' || quiz.picked === null) return quiz;
    const bodyId = LAB_QUESTIONS[quiz.index].bodyId;
    const fate = lab.fates.find((f) => f.id === bodyId);
    const steps = bodyId === 'earth' ? lab.impact.steps : fate?.steps ?? [];
    if (elapsedSec < Math.max(4, ...steps.map((s) => s.atSec)) + 1.5) return quiz;
    labView.setConcealed(false);
    const answer = bodyId === 'earth' || !fate ? lab.impact.level : fate.level;
    return { ...quiz, phase: 'reveal', rounds: [...quiz.rounds, { question: quiz.question, picked: quiz.picked, answer }] };
  }

  /**
   * Opens the lab with `preset` as its explosion and the map of the moment `at`; null: today when the lab is
   * opened from the menu, otherwise the moment of the visit it is opened from.
   */
  function openLab(preset: LabExplosionKind, at: number | null): void {
    audio.cue('teleport');
    audio.setScene('space');
    input.exitLock();
    leaveModes();
    endStaging(false);
    clearPageState();
    showSpaceView(labView);
    const st = getGame();
    // The map shows the solar system as it stands around Earth.
    const jdTT = at ?? (st.phase === 'menu' ? jdTTNow() : st.clock.jdTT);
    const bodies = labView.layoutFor(jdTT);
    const sun = bodies.find((b) => b.id === 'sun');
    // A solar eruption starts at the Sun. A supernova starts close enough to show its full effect, in the
    // direction that is farthest from the Sun, the Moon and the inner planets, so that nothing hides it.
    const near = bodies.filter((b) => b.distanceAU < 3);
    let clearAngle = 0;
    let clearGap = -1;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const gap = Math.min(...near.map((b) => Math.abs(Math.atan2(Math.sin(a - b.angleRad), Math.cos(a - b.angleRad)))));
      if (gap > clearGap) {
        clearGap = gap;
        clearAngle = a;
      }
    }
    const angleRad = preset === 'cme' ? sun?.angleRad ?? 0 : clearAngle;
    const distanceAU = preset === 'cme' ? sun?.distanceAU ?? 1 : 0.3;
    const setup: LabSetup = { kind: preset, angleRad, distanceAU, cmeStrength: 'may2024' };
    // Europa, Titan and Pluto are off the map until they are added.
    const removed = [...LAB_EXTRA_IDS];
    labView.configure(preset, angleRad, distanceAU, false);
    labView.setRemoved(removed);
    const results = labResults(setup, bodies, removed);
    labView.resetExplosion();
    labView.setPaused(false);
    labView.setConcealed(false);
    labView.setEvaMode(false);
    labView.enter({
      targetId: 'lab',
      jdTT,
      lang: st.settings.lang,
      quality: QUALITY[st.settings.quality],
      mode: 'explore',
    }).catch(() => undefined);
    labView.attach(canvas);
    input.enabled = true;
    // The lab is a page of its own: a watch of its supernova from the ground ends, and no event or sequence
    // of the visit before follows into it.
    leaveLabWatch();
    setGame({
      phase: 'space',
      spaceView: { targetId: 'lab', selectedMarkerId: null, galaxyPictureId: null },
      activeEventId: null,
      stage: null,
      labReturn: null,
      lab: {
        ...setup,
        ...results,
        anchorId: preset === 'cme' ? 'sun' : null,
        playing: false,
        paused: false,
        elapsedSec: 0,
        evaMode: false,
        jdTT,
        bodies,
        removed,
        focusId: 'earth',
        quiz: null,
      },
    });
  }

  /**
   * Opens the lab with the scenario of a link (see views/lab/link.ts). `at`: the exact moment of the map,
   * for a scenario that is being returned to; a link itself names only the day, which is shown at noon.
   */
  function openLabLink(link: LabLink, at: number | null = null): void {
    let jdTT = at;
    if (jdTT === null && link.date) {
      const [year, month, day] = link.date.split('-').map(Number);
      jdTT = jdTTFromCalendarUT({ year, month, day, hour: 12 });
    }
    openLab(link.kind, jdTT);
    for (const id of link.off) api.setLabBodyOnMap(id, false);
    for (const id of link.add) api.setLabBodyOnMap(id, true);
    const lab = getGame().lab;
    if (!lab) return;
    // An anchor that is not on the map is ignored: the place is then the link's own direction and distance.
    const anchor = lab.bodies.find((b) => b.id === link.anchorId && !lab.removed.includes(b.id));
    // A solar eruption stays in the Sun's direction: only how far the Sun is from Earth can be set.
    const sun = link.kind === 'cme' && link.anchorId === 'sun' ? anchor : undefined;
    // A link without a distance leaves the lab's own.
    const freeAU = link.distanceAU > 0 ? link.distanceAU : lab.distanceAU;
    const place: LabConfigPatch = link.kind === 'cme'
      ? { cmeStrength: link.cmeStrength, distanceAU: sun?.distanceAU ?? freeAU, anchorId: sun ? 'sun' : null }
      : anchor
        ? { angleRad: anchor.spotRad, distanceAU: anchor.distanceAU, anchorId: anchor.id }
        : { angleRad: link.angleDeg * DEG2RAD, distanceAU: freeAU, anchorId: null };
    api.setLabConfig(place);
    if (link.focusId !== 'earth') api.setLabFocus(link.focusId);
    if (link.quiz) api.startLabQuiz();
  }

  // ─────────────────────────── GameAPI Implementation ───────────────────────────

  const api: GameAPI = {
    start(): void {
      audio.unlock();
      audio.setScene('menu');
      // The clock is today from the first menu on: what is opened from it starts today.
      setGame({ phase: 'menu', clock: { jdTT: jdTTNow(), rate: 1, paused: false } });
    },

    openMenu(): void {
      audio.unlock();
      audio.cue('ui-open');
      audio.setScene('menu');
      // Before the keys are taken away: leaving a mode on the ground gives them back.
      leaveModes();
      input.enabled = false;
      input.exitLock();
      showSpaceView(globeView);
      const st = getGame();
      // The menu ends what was being watched: whatever is opened from it starts on its own, today, and leads
      // back to the menu, not to the scene, the event or the date of the visit before.
      const jdTT = jdTTNow();
      globeView.enter({
        targetId: 'moon',
        jdTT,
        lang: st.settings.lang,
        quality: QUALITY[st.settings.quality],
        mode: 'backdrop',
      }).catch(() => undefined);
      leaveLabWatch();
      endStaging(false);
      clearPageState();
      artifacts.removeBeacon();
      setGame({
        phase: 'menu',
        spaceView: null,
        lab: null,
        labReturn: null,
        cleanMode: false,
        site: null,
        activeEventId: null,
        stage: null,
        lightReading: null,
        clock: { jdTT, rate: 1, paused: false },
      });
    },

    selectEvent(eventId: string | null): void {
      audio.unlock();
      audio.cue('ui-open');
      // Before the keys are taken away: leaving a mode on the ground gives them back.
      leaveModes();
      input.enabled = false;
      input.exitLock();
      const site = prepareEvent(eventId);
      clearPageState();
      // A new chapter has to be landed: the map's back button leads to the menu, not to the old scene.
      setGame({ phase: 'map', site: null });
      enterMapGlobe(getGame().clock.jdTT, site).catch(() => undefined);
    },

    openMap(): void {
      audio.cue('ui-open');
      input.enabled = false;
      input.exitLock();
      clearPageState();
      const st = getGame();
      const sel = st.site ?? st.mapSelection ?? SITES[0];
      // Choosing another place does not change the world the astronaut is on.
      setGame({ mapSelection: sel, mapWorld: st.world, phase: 'map' });
      enterMapGlobe(st.clock.jdTT, sel).catch(() => undefined);
    },

    closeMap(): void {
      const st = getGame();
      if (!st.site) {
        this.openMenu();
        return;
      }
      audio.cue('ui-close');
      activeSpaceView.detach();
      audio.setScene('surface');
      input.enabled = true;
      setGame({ phase: 'surface' });
    },

    previewSite(site: SiteDef): void {
      audio.cue('ui-click');
      setGame({ mapSelection: site });
      globeView.setSelection(site, true);
    },

    async landAt(site: SiteDef): Promise<void> {
      audio.unlock();
      audio.cue('teleport');
      clearPageState();
      // This landing is the page now being entered: it is void once another page is.
      const mine = journey;
      activeSpaceView.detach();
      input.enabled = false;
      endStaging(false);
      const st = getGame();
      const q = QUALITY[st.settings.quality];
      // The world chosen on the map; events that belong to the Moon are always watched from it.
      const world: WorldId = eventById(st.activeEventId)?.seenFrom === 'moon' ? 'moon' : st.mapWorld;
      // On another world the Moon site only lends its ground: what is being loaded is that world.
      const placeName = world === 'moon' ? site.name : WORLDS[world].name;

      setGame({
        phase: 'loading',
        loading: {
          fraction: 0.05,
          label: lf(tpl`${placeName} yükleniyor…`, tpl`Loading ${placeName}…`),
        },
      });

      // One landing loads at a time (the sky, the terrain and the hardware hold a single site): this one
      // waits for the loads of the one before, and does not start its own if it has been overtaken by then.
      const before = landingLoads;
      const loads = (async (): Promise<TerrainLoadInfo | null> => {
        await before.catch(() => undefined);
        if (mine !== journey) return null;
        if (!coreAssetsLoaded) {
          // Both are waited for, also when one has failed: the next landing must not start the same loads
          // while they are still under way.
          const core = await Promise.allSettled([
            sky.load(q, (f) => {
              if (mine === journey) setGame({ loading: { fraction: 0.05 + f * 0.25, label: placeName } });
            }),
            player.load(),
          ]);
          for (const result of core) {
            if (result.status === 'rejected') throw result.reason;
          }
          coreAssetsLoaded = true;
        }
        const info = await terrain.load(site, q, (f, lbl) => {
          if (mine === journey) setGame({ loading: { fraction: 0.3 + f * 0.55, label: lbl ? { tr: lbl, en: lbl } : placeName } });
        });
        await artifacts.load(ARTIFACT_PLACEMENTS.filter((p) => p.siteId === site.id), SURFACE_ASSETS, terrain);
        artifacts.removeBeacon();
        return info;
      })();
      landingLoads = loads;
      let terrainInfo: TerrainLoadInfo | null;
      try {
        terrainInfo = await loads;
      } catch (err) {
        if (mine !== journey) return;
        // The terrain, a model or a picture did not load: back to the menu, saying why, instead of a
        // loading screen that never ends. Nothing is being loaded any more.
        const reason = err instanceof Error ? err.message : String(err);
        api.openMenu();
        setGame({ loading: { fraction: 1, label: null } });
        showToast(lf(tpl`${placeName} yüklenemedi: ${reason}`, tpl`${placeName} could not be loaded: ${reason}`), 'warn');
        return;
      }
      if (terrainInfo === null || mine !== journey) return;

      // Compute initial sky state so we can orient the astronaut toward the chapter's primary target
      const sky0 = computeSky(st.clock.jdTT, site);
      const ev = eventById(st.activeEventId);
      let headingDeg = site.spawnHeadingDeg ?? 0;
      let pitchDeg = 0;
      if (ev?.primaryTargetId) {
        if (ev.primaryTargetId in sky0.bodies) {
          const b = sky0.bodies[ev.primaryTargetId as BodyId];
          headingDeg = b.azDeg;
          if (b.elDeg > 2) pitchDeg = Math.min(55, b.elDeg * 0.9);
        } else {
          const trDef = transientById(ev.primaryTargetId);
          if (trDef) {
            const ts = transientState(trDef, sky0);
            headingDeg = ts.azDeg;
            if (ts.elDeg > 2) pitchDeg = Math.min(55, ts.elDeg * 0.9);
          }
        }
      }

      // Polar ridge sites: spawn on the highest local crest within ±150 m.
      let spawnX = site.id === 'apollo11' ? -6.5 : 0;
      let spawnZ = site.id === 'apollo11' ? 9.5 : 0;
      if (site.id === 'shackleton' || site.id === 'connecting_ridge') {
        let bestH = -1e9;
        for (let gz = -150; gz <= 150; gz += 30) {
          for (let gx = -150; gx <= 150; gx += 30) {
            const h = terrain.heightAt(gx, gz);
            if (h > bestH) {
              bestH = h;
              spawnX = gx;
              spawnZ = gz;
            }
          }
        }
      }
      if (site.id === 'apollo11' && ev?.id === 'apollo11') {
        // 110 m south of the pad: Eagle approaches from the east out of the low Sun; from here it separates
        // from the solar glare during the last minute and touches down in plain view.
        spawnX = 20;
        spawnZ = 110;
        headingDeg = (Math.atan2(-spawnX, spawnZ) * RAD2DEG + 360) % 360;
        pitchDeg = 0;
      } else if (site.id === 'apollo11' && !ev) {
        headingDeg = 34;
        pitchDeg = 0;
      }
      player.teleport(spawnX, spawnZ, headingDeg, terrain, pitchDeg);
      lastHorizonPos.set(1e9, 0, 1e9);

      applyWorld(world);
      setGame({
        world,
        site,
        mapSelection: site,
        terrainInfo,
        phase: 'surface',
        telescope: { active: false, fovDeg: 60 },
        loading: { fraction: 1, label: null },
        lightReading: null,
        spaceView: null,
        lab: null,
      });
      player.setFov(60);

      audio.setScene('surface');
      input.enabled = true;
      beginEventHere();
    },

    setMapWorld(world: WorldId): void {
      audio.cue('ui-click');
      setGame({ mapWorld: world });
    },

    setPaused(paused: boolean): void {
      setGame((s) => ({ clock: { ...s.clock, paused } }));
    },

    setTime(jdTT: number): void {
      endStaging(false);
      setGame((s) => ({ clock: { ...s.clock, jdTT: Math.max(CLOCK_FIRST_JD, Math.min(CLOCK_LAST_JD, jdTT)) } }));
    },

    setRate(rate: number): void {
      endStaging(false);
      setGame((s) => ({ clock: { ...s.clock, rate, paused: rate === 0 } }));
    },

    replayStaging(fromStep = 0): void {
      const st = getGame();
      const ev = eventById(st.activeEventId);
      const where = st.phase === 'space' ? st.spaceView?.targetId : 'surface';
      const staging = ev?.staging?.find((s) => s.where === where);
      if (!ev || !staging) return;
      endStaging(false);
      audio.cue('ui-click');
      startStaging(ev, staging, Math.max(0, Math.min(staging.stages.length - 1, fromStep)));
    },

    skipStaging(): void {
      if (!director) return;
      const staging = director.staging;
      const st = getGame();
      // What the steps not played would have left: the seat under the same stars at the last moment, the
      // astronaut where the last change of viewpoint puts it and, once that moment's sky is known, the view
      // on what the sequence shows last.
      holdSeatToStars(st.world, stagingEndJd(staging));
      const stand = staging.where === 'surface'
        ? staging.stages.slice((st.stage?.index ?? 0) + 1).findLast((s) => s.standAt)?.standAt
        : undefined;
      if (stand) {
        player.teleport(stand.x, stand.z, stand.headingDeg, terrain, 0);
        lastHorizonPos.set(1e9, 0, 1e9);
      }
      endStaging(true);
      skippedStaging = staging;
    },

    resetEventTime(): void {
      const st = getGame();
      const ev = eventById(st.activeEventId);
      if (!ev) return;
      const where = st.phase === 'space' ? st.spaceView?.targetId : 'surface';
      if (ev.staging?.some((s) => s.where === where) && (st.world === 'moon' || ev.seenFrom !== 'moon' || where !== 'surface')) {
        this.replayStaging();
        return;
      }
      // An event that plays in a close-up view is replayed there, wherever the astronaut stands.
      const view = st.phase === 'surface' ? ev.staging?.find((s) => s.where !== 'surface') : undefined;
      if (view && !ev.staging?.some((s) => s.where === 'surface')) {
        playedStagings.delete(`${ev.id}:${view.where}`);
        this.enterSpaceView(view.where);
        return;
      }
      setGame({ clock: { jdTT: jdTTFromCalendarUT(ev.date), rate: ev.startRate, paused: false } });
    },

    setTelescope(on: boolean): void {
      audio.cue(on ? 'ui-open' : 'ui-close');
      stageFov = null;
      const fov = on ? 6.0 : 60.0;
      player.setFov(fov);
      setGame({ telescope: { active: on, fovDeg: fov } });
    },

    setViewMode(mode: 'first' | 'third'): void {
      audio.cue('ui-click');
      player.setViewMode(mode);
      setGame({ viewMode: mode });
    },

    enterSpaceView(targetId: string): void {
      // Only what has a close-up view: the Sun, the remnant of a supernova, a galaxy, or a globe (the Moon,
      // Earth, a planet). A comet has none.
      const transient = TRANSIENTS.find((t) => t.id === targetId);
      const supernova = transient?.kind === 'supernova' ? transient : undefined;
      const galaxy = GALAXIES.find((g) => g.id === targetId);
      if (targetId !== 'sun' && !supernova && !galaxy && targetId !== 'moon' && !(targetId in BODY_NAMES)) return;
      audio.cue('teleport');
      audio.setScene('space');
      clearPageState();
      input.enabled = false;
      input.exitLock();

      const st = getGame();
      const q = QUALITY[st.settings.quality];

      if (targetId === 'sun') {
        showSpaceView(sunView);
        sunView.enter({
          targetId: 'sun',
          jdTT: st.clock.jdTT,
          lang: st.settings.lang,
          quality: q,
          mode: 'explore',
          cmes: cachedCmes,
        }).catch(() => undefined);
        sunView.attach(canvas);
        if (cachedCmes.length === 0) {
          nasa.donki('2024-05-07', '2024-05-15').then((res) => {
            cachedCmes = res.events
              .filter((e) => e.type === 'CME' && e.speedKmS)
              .map((e) => {
                const d = new Date(e.time);
                const jd = Number.isFinite(d.getTime())
                  ? jdTTFromCalendarUT({
                    year: d.getUTCFullYear(),
                    month: d.getUTCMonth() + 1,
                    day: d.getUTCDate(),
                    hour: d.getUTCHours(),
                    minute: d.getUTCMinutes(),
                  })
                  : st.clock.jdTT - 0.5;
                return {
                  id: e.id,
                  startJdTT: jd,
                  speedKmS: e.speedKmS ?? 900,
                  halfAngleDeg: e.halfAngleDeg ?? 40,
                  latDeg: e.latDeg ?? 0,
                  lonDeg: e.lonDeg ?? 0,
                  note: e.note,
                };
              });
            if (getGame().spaceView?.targetId === 'sun') {
              sunView.enter({
                targetId: 'sun',
                jdTT: getGame().clock.jdTT,
                lang: getGame().settings.lang,
                quality: q,
                mode: 'explore',
                cmes: cachedCmes,
              }).catch(() => undefined);
            }
          }).catch(() => undefined);
        }
      } else if (supernova) {
        showSpaceView(remnantView);
        remnantView.enter({
          targetId,
          jdTT: st.clock.jdTT,
          lang: st.settings.lang,
          quality: q,
          mode: 'explore',
          supernova,
        }).catch(() => undefined);
        remnantView.attach(canvas);
      } else if (galaxy) {
        showSpaceView(galaxyView);
        const mine = journey;
        galaxyShownId = null;
        galaxyView.enter({
          targetId,
          jdTT: st.clock.jdTT,
          lang: st.settings.lang,
          quality: q,
          mode: 'explore',
          galaxy,
        }).then(() => {
          if (mine === journey && galaxy) galaxyShownId = galaxy.pictures[0].id;
        }, () => {
          // The view is empty without its picture: say why, unless the page has been left meanwhile.
          if (mine === journey && galaxy) showToast(lf(tpl`${galaxy.name} görüntüsü yüklenemedi.`, tpl`The picture of ${galaxy.name} could not be loaded.`), 'warn');
        });
        galaxyView.attach(canvas);
      } else {
        showSpaceView(globeView);
        // Hardware in orbit has no place on the ground: it gets no pin.
        const markers: GlobeMarker[] = targetId === 'mars'
          ? SURFACE_ASSETS.filter((a) => a.body === 'mars' && a.kind !== 'orbiter').map((a) => ({
            id: a.id,
            latDeg: a.latDeg,
            lonDeg: a.lonDeg,
            label: a.name,
            kind: a.kind === 'helicopter' ? 'helicopter' : a.kind === 'rover' ? 'rover' : 'lander',
            color: a.stillActive ? '#6ee7a8' : '#ffb454',
            modelFile: a.modelFile,
          }))
          : [];
        globeView.enter({
          targetId,
          jdTT: st.clock.jdTT,
          lang: st.settings.lang,
          quality: q,
          mode: 'explore',
          markers,
          // Mars dust follows the clock inside the view (see content/marsDust.ts).
          onMarker: (markerId) => {
            this.selectMarker(markerId);
            setGame({ focusAssetId: markerId });
          },
        }).catch(() => undefined);
        globeView.attach(canvas);
      }

      setGame({
        phase: 'space',
        spaceView: { targetId, selectedMarkerId: null, galaxyPictureId: galaxy?.pictures[0].id ?? null },
        lab: null,
      });

      // A close-up view with its own "before → event → after" sequence takes over the clock.
      endStaging(false);
      const ev = eventById(st.activeEventId);
      const viewStaging = ev?.staging?.find((s) => s.where === targetId);
      if (ev && viewStaging && !playedStagings.has(`${ev.id}:${targetId}`)) startStaging(ev, viewStaging);
      else setGame({ stage: viewStaging ? stageStatusOf(viewStaging, viewStaging.stages.length - 1, false) : null });
    },

    setGalaxyPicture(pictureId: string): void {
      const st = getGame();
      const galaxy = GALAXIES.find((g) => g.id === st.spaceView?.targetId);
      if (!galaxy || !st.spaceView || st.spaceView.galaxyPictureId === pictureId) return;
      audio.cue('ui-click');
      const mine = journey;
      galaxyView.enter({
        targetId: galaxy.id,
        jdTT: st.clock.jdTT,
        lang: st.settings.lang,
        quality: QUALITY[st.settings.quality],
        mode: 'explore',
        galaxy,
        galaxyPictureId: pictureId,
      }).then(() => {
        // A choice overtaken by a later one resolves too, without having been shown.
        if (mine === journey && getGame().spaceView?.galaxyPictureId === pictureId) galaxyShownId = pictureId;
      }, () => {
        if (mine !== journey) return;
        // The picture shown before is still on the screen: the choice goes back to it, unless another was
        // made meanwhile.
        const now = getGame().spaceView;
        if (now?.galaxyPictureId === pictureId) setGame({ spaceView: { ...now, galaxyPictureId: galaxyShownId ?? galaxy.pictures[0].id } });
        showToast({ tr: 'Bu görüntü yüklenemedi; önceki gösteriliyor.', en: 'This picture could not be loaded; the previous one is still shown.' }, 'warn');
      });
      setGame({ spaceView: { ...st.spaceView, galaxyPictureId: pictureId } });
    },

    exitSpaceView(): void {
      const st = getGame();
      if (!st.site) {
        this.openMenu();
        return;
      }
      audio.cue('ui-close');
      clearPageState();
      activeSpaceView.detach();
      audio.setScene('surface');
      input.enabled = true;
      endStaging(false);
      const ev = eventById(st.activeEventId);
      const surf = ev?.staging?.find((s) => s.where === 'surface');
      setGame({
        phase: 'surface',
        spaceView: null,
        lab: null,
        stage: surf ? stageStatusOf(surf, surf.stages.length - 1, false) : null,
      });
    },

    selectMarker(markerId: string | null): void {
      audio.cue('ui-click');
      activeSpaceView.setSelectedMarker(markerId);
      setGame((s) => ({
        spaceView: s.spaceView ? { ...s.spaceView, selectedMarkerId: markerId } : null,
      }));
    },

    togglePanel(panel: PanelId, open?: boolean): void {
      const cur = getGame().panels[panel];
      const next = open ?? !cur;
      audio.cue(next ? 'ui-open' : 'ui-close');
      if (next && getGame().phase === 'surface') {
        input.exitLock();
      }
      setGame((s) => ({ panels: { ...s.panels, [panel]: next } }));
    },

    openArchive(topicId?: string): void {
      setGame({ infoTopicId: topicId ?? null });
      api.togglePanel('info', true);
    },

    async capture(kind: 'screen' | '4k' | '8k'): Promise<Blob> {
      audio.cue('shutter');
      const st = getGame();
      // A photo has the profile's resolution, whatever the governor has the screen drawn at.
      const fullW = kind === '8k' ? 7680 : kind === '4k' ? 3840 : Math.round(window.innerWidth * profilePixelRatio());
      const fullH = kind === '8k' ? 4320 : kind === '4k' ? 2160 : Math.round(window.innerHeight * profilePixelRatio());
      // Rendered in tiles no larger than 1920 x 1080, so 4K and 8K need no more GPU memory than normal use.
      // Each tile is drawn with a margin and cropped, so bloom does not seam at tile edges.
      const cols = Math.ceil(fullW / 1920);
      const rows = Math.ceil(fullH / 1080);
      const tileW = Math.ceil(fullW / cols);
      const tileH = Math.ceil(fullH / rows);
      const margin = cols * rows > 1 ? 96 : 0;
      const renderW = tileW + 2 * margin;
      const renderH = tileH + 2 * margin;

      const out = document.createElement('canvas');
      out.width = fullW;
      out.height = fullH;
      const ctx = out.getContext('2d');
      const cam = st.phase === 'surface' ? player.camera : activeSpaceView.camera;
      const visorWas = visorPass.enabled;
      // A photo is the camera's view, not the inside of the helmet.
      visorPass.enabled = false;
      sky.setDetailBoost(true);
      renderer.setPixelRatio(1);
      renderer.setSize(renderW, renderH, false);
      composer.setPixelRatio(1);
      composer.setSize(renderW, renderH);
      cam.aspect = fullW / fullH;
      try {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const x = c * tileW;
            const y = r * tileH;
            cam.setViewOffset(fullW, fullH, x - margin, y - margin, renderW, renderH);
            captureTile = {
              left: ((x - margin) / fullW) * 2 - 1,
              right: ((x - margin + renderW) / fullW) * 2 - 1,
              top: 1 - ((y - margin) / fullH) * 2,
              bottom: 1 - ((y - margin + renderH) / fullH) * 2,
            };
            composer.render();
            ctx?.drawImage(renderer.domElement, margin, margin, tileW, tileH, x, y, tileW, tileH);
          }
        }
      } finally {
        captureTile = null;
        cam.clearViewOffset();
        visorPass.enabled = visorWas;
        sky.setDetailBoost(false);
        cam.aspect = window.innerWidth / Math.max(1, window.innerHeight);
        cam.updateProjectionMatrix();
        applyPixelRatio();
      }

      const { promise, resolve } = Promise.withResolvers<Blob>();
      out.toBlob((b) => resolve(b ?? new Blob()), 'image/png');
      const blob = await promise;
      const label = kind === 'screen' ? '' : `${kind.toUpperCase()} `;
      showToast(lf(tpl`${label}Fotoğraf kaydedildi (${fullW}×${fullH})`, tpl`${label}Photo saved (${fullW}×${fullH})`), 'success');
      return blob;
    },

    updateSettings(patch: Partial<Settings>): void {
      const next = { ...getGame().settings, ...patch };
      saveSettings(next);
      setGame({ settings: next });

      audio.setMasterVolume(next.masterVolume);
      audio.setMuted(!next.soundOn);
      audio.setNarrationEnabled(next.narration);

      if (patch.quality) {
        const q = QUALITY[next.quality];
        governor.reset();
        applyPixelRatio();
        bloomPass.enabled = q.bloom;
        sky.setQuality(q);
        terrain.setQuality(q);
      }
      // The language's dictionary is fetched if it is not in yet; the screen follows when it arrives, and texts
      // drawn into textures (map labels) are redrawn then.
      if (patch.lang) {
        loadDict(next.lang).then(() => {
          const lang = getGame().settings.lang;
          labView.setLang(lang);
          globeView.setLang(lang);
        });
      }
    },

    requestPointerLock(): void {
      audio.unlock();
      input.requestLock();
    },

    pressKey(code: string, down: boolean): void {
      audio.unlock();
      input.setKey(code, down);
    },

    async startTutorial(): Promise<void> {
      audio.unlock();
      leaveModes();
      const site = SITES.find((s) => s.id === TUTORIAL_SITE_ID) ?? SITES[0];
      prepareEvent(null);
      setGame({
        mapSelection: site,
        clock: { jdTT: jdTTFromCalendarUT(TUTORIAL_DATE), rate: 1, paused: false },
        viewMode: 'first',
      });
      player.setViewMode('first');
      await api.landAt(site);
      // Only where the landing arrived: the menu or another page may have been opened while it loaded.
      if (getGame().phase === 'surface' && getGame().site?.id === site.id) enterTutorialStep(0);
    },

    skipTutorialStep(): void {
      const tut = getGame().tutorial;
      if (!tut) return;
      audio.cue('ui-click');
      if (tut.finished) leaveModes();
      else enterTutorialStep(tut.index + 1);
    },

    async startSpectator(index = 0): Promise<void> {
      audio.unlock();
      await playSpectatorEvent(index);
    },

    spectatorStep(delta: number): void {
      const sp = getGame().spectator;
      if (!sp) return;
      audio.cue('ui-click');
      playSpectatorEvent(sp.index + delta).catch(() => undefined);
    },

    stopModes(): void {
      leaveModes();
    },

    lookAtTarget(targetId: string): void {
      // A sequence steers the view itself: a click made while it plays must not turn the view once it ends.
      if (director) return;
      lookTargetId = targetId;
      const target = getGame().targets.find((t) => t.id === targetId);
      if (target && target.elDeg < skylineDeg(target.azDeg)) {
        showToast(lf(tpl`${target.name} şu anda ufkun altında.`, tpl`${target.name}: below the horizon right now.`));
      }
    },

    toggleCleanMode(on?: boolean): void {
      const next = on ?? !getGame().cleanMode;
      audio.cue('ui-click');
      setGame({ cleanMode: next });
    },

    setWorld(world: WorldId): void {
      const st = getGame();
      if (eventById(st.activeEventId)?.seenFrom === 'moon' && world !== 'moon') {
        showToast({ tr: 'Bu olay Ay’da geçer; yalnızca Ay’dan izlenir.', en: 'This event takes place on the Moon and can only be watched from there.' }, 'warn');
        return;
      }
      audio.cue('teleport');
      const apply = (): void => {
        const prevZeroG = WORLDS[getGame().world]?.zeroG ?? false;
        // A sequence under way (on the old world, or in the close-up view being left) ends here, and so does
        // what was read or said there: the mast's measurement belongs to the world it was taken on.
        endStaging(false);
        clearPageState();
        artifacts.removeBeacon();
        applyWorld(world);
        if (!WORLDS[world].zeroG && (prevZeroG || player.state.position.y > terrain.heightAt(player.state.position.x, player.state.position.z) + 12)) {
          player.teleport(player.state.position.x, player.state.position.z, player.state.headingDeg, terrain, player.state.pitchDeg);
        }
        // The map follows: a new place chosen there is landed on this world, not back on the Moon.
        setGame({ world, mapWorld: world, stage: null, lightReading: null });
        if (getGame().phase === 'space') {
          activeSpaceView.detach();
          audio.setScene('surface');
          input.enabled = true;
          setGame({ phase: 'surface', spaceView: null, lab: null });
        }
        // The lab's supernova stands elsewhere in the new world's sky, and does something else to that world.
        if (getGame().activeEventId === LAB_WATCH_EVENT_ID) showLabWatchFrom(world);
        // The active event plays again as seen from the new world.
        const ev = eventById(getGame().activeEventId);
        if (ev?.staging?.some((s) => s.where === 'surface')) {
          playedStagings.delete(`${ev.id}:surface:${world}`);
          beginEventHere();
        }
      };
      if (!st.site) {
        // From the menu, or from a close-up view opened from it: a free visit, loaded as this world from the
        // start, at the moment the view showed.
        leaveModes();
        const site = prepareEvent(null, st.phase === 'space' ? st.clock.jdTT : jdTTNow());
        setGame({ mapWorld: world });
        this.landAt(site).catch(() => undefined);
      } else {
        apply();
      }
    },

    openSpaceLab(preset: LabExplosionKind = 'sn2'): void {
      openLab(preset, null);
    },

    setLabConfig(patch, keepView = false): void {
      const prev = getGame().lab;
      if (!prev) return;
      // In the class mode the explosion is the question's: only the astronaut's view can be switched.
      const set: LabConfigPatch = prev.quiz ? { evaMode: patch.evaMode } : patch;
      const kind = set.kind ?? prev.kind;
      const cmeStrength = set.cmeStrength ?? prev.cmeStrength;
      // A solar eruption comes from the Sun and is always in the Sun's direction: only its distance can be
      // set, and it has no meaning beyond the planets. Switching to it goes to where the Sun is; switching
      // away from it steps aside, so that the star does not sit on the Sun.
      const toSun = kind === 'cme' && prev.kind !== 'cme';
      const fromSun = kind !== 'cme' && prev.kind === 'cme';
      const sun = kind === 'cme' ? prev.bodies.find((b) => b.id === 'sun') : undefined;
      const angleRad = sun ? sun.angleRad : set.angleRad ?? prev.angleRad + (fromSun ? 0.4 : 0);
      const wantedAU = set.distanceAU ?? (toSun ? sun?.distanceAU : undefined) ?? prev.distanceAU;
      const distanceAU = Math.min(kind === 'cme' ? 2 : LAB_MAX_AU, Math.max(LAB_MIN_AU, wantedAU));
      const placed = angleRad !== prev.angleRad || distanceAU !== prev.distanceAU;
      // The body the place was taken from: a place set by hand belongs to none, a solar eruption is at a
      // body only when that body is the Sun, and a body that is off the map holds nothing.
      const named = toSun ? 'sun' : fromSun ? null : set.anchorId !== undefined ? set.anchorId : placed ? null : prev.anchorId;
      const anchorId = named === null || (kind === 'cme' && named !== 'sun') || prev.removed.includes(named) ? null : named;
      const evaMode = set.evaMode ?? prev.evaMode;
      const moved = placed || kind !== prev.kind || cmeStrength !== prev.cmeStrength;
      const setup: LabSetup = { kind, angleRad, distanceAU, cmeStrength };
      let results: LabResults = prev;
      if (moved) {
        // Changing the explosion starts over: what was shown belonged to the old one.
        labView.configure(kind, angleRad, distanceAU, keepView);
        results = labResults(setup, prev.bodies, prev.removed);
        labView.resetExplosion();
        labView.setPaused(false);
      }
      // The body in focus may have no result of its own under the new explosion: the Sun, when it is what erupts.
      const focusId = labFocusValid(prev.focusId, kind, results) ? prev.focusId : 'earth';
      if (focusId !== prev.focusId) labView.setFocus(focusId, false);
      if (set.evaMode !== undefined) labView.setEvaMode(evaMode);
      setGame({
        lab: {
          ...prev,
          ...setup,
          anchorId,
          evaMode,
          playing: moved ? false : prev.playing,
          paused: moved ? false : prev.paused,
          elapsedSec: moved ? 0 : prev.elapsedSec,
          impact: results.impact,
          fates: results.fates,
          runSec: results.runSec,
          focusId,
        },
      });
    },

    setLabDate(jdTT: number): void {
      const prev = getGame().lab;
      // In the class mode the map is the question's.
      if (!prev || prev.quiz || !Number.isFinite(jdTT)) return;
      const at = Math.min(LAB_LAST_JD, Math.max(LAB_FIRST_JD, jdTT));
      // The map is set by the day: a moment of the day it already shows changes nothing, and a run is not
      // started over for it ("Today", pressed today).
      const day = calendarUTFromJdTT(at);
      const shown = calendarUTFromJdTT(prev.jdTT);
      if (day.year === shown.year && day.month === shown.month && day.day === shown.day) return;
      const bodies = labView.layoutFor(at);
      // An explosion set at a body goes with it, as far as the map's nearest and farthest places allow. A
      // solar eruption stays in the Sun's direction, and at the Sun's distance if it was there.
      const sun = bodies.find((b) => b.id === 'sun');
      const anchor = bodies.find((b) => b.id === prev.anchorId);
      const angleRad = (prev.kind === 'cme' ? sun?.angleRad : anchor?.spotRad) ?? prev.angleRad;
      const distanceAU = Math.min(prev.kind === 'cme' ? 2 : LAB_MAX_AU, Math.max(LAB_MIN_AU, anchor?.distanceAU ?? prev.distanceAU));
      labView.configure(prev.kind, angleRad, distanceAU, true);
      labView.setRemoved(prev.removed);
      const results = labResults({ kind: prev.kind, angleRad, distanceAU, cmeStrength: prev.cmeStrength }, bodies, prev.removed);
      labView.resetExplosion();
      labView.setPaused(false);
      const focusId = labFocusValid(prev.focusId, prev.kind, results) ? prev.focusId : 'earth';
      if (focusId !== prev.focusId) labView.setFocus(focusId, false);
      setGame({
        lab: {
          ...prev,
          ...results,
          jdTT: at,
          bodies,
          angleRad,
          distanceAU,
          focusId,
          playing: false,
          paused: false,
          elapsedSec: 0,
        },
      });
    },

    setLabFocus(bodyId: string): void {
      const prev = getGame().lab;
      if (!prev || !labFocusValid(bodyId, prev.kind, prev)) return;
      audio.cue('ui-click');
      labView.setFocus(bodyId, true);
      setGame({ lab: { ...prev, focusId: bodyId } });
    },

    setLabBodyOnMap(bodyId: string, onMap: boolean): void {
      const prev = getGame().lab;
      // Only moons and planets can go: Earth is the middle of the map, and the Sun lights it. In the class
      // mode the map is the question's.
      const body = prev?.bodies.find((b) => b.id === bodyId);
      if (!prev || prev.quiz || !body || (body.kind !== 'moon' && body.kind !== 'planet')) return;
      // Already there or already gone: a link can name the same body thousands of times.
      if (prev.removed.includes(bodyId) !== onMap) return;
      const others = prev.removed.filter((id) => id !== bodyId);
      const removed = onMap ? others : [...others, bodyId];
      const focusId = prev.focusId === bodyId && !onMap ? 'earth' : prev.focusId;
      // An explosion set at the body that goes stays where it is, tied to nothing.
      const anchorId = prev.anchorId === bodyId && !onMap ? null : prev.anchorId;
      audio.cue('ui-click');
      labView.setRemoved(removed);
      const results = labResults(prev, prev.bodies, removed);
      if (focusId !== prev.focusId) labView.setFocus(focusId, false);
      setGame({ lab: { ...prev, ...results, removed, focusId, anchorId } });
    },

    detonateLab(): void {
      const prev = getGame().lab;
      // In the class mode the explosion goes off with the prediction (see answerLabQuiz).
      if (!prev || prev.quiz?.phase === 'ask') return;
      audio.cue('supernova');
      labView.detonate();
      labView.setPaused(false);
      setGame({ lab: { ...prev, playing: true, paused: false, elapsedSec: 0 } });
    },

    resetLab(): void {
      const prev = getGame().lab;
      if (!prev) return;
      audio.cue('ui-click');
      labView.resetExplosion();
      labView.setPaused(false);
      // A question of the class mode whose explosion was playing waits for its prediction again.
      const quiz: LabQuiz | null = prev.quiz?.phase === 'run' ? { ...prev.quiz, phase: 'ask', picked: null } : prev.quiz;
      setGame({ lab: { ...prev, playing: false, paused: false, elapsedSec: 0, quiz } });
    },

    setLabPaused(paused: boolean): void {
      const prev = getGame().lab;
      if (!prev?.playing) return;
      labView.setPaused(paused);
      setGame({ lab: { ...prev, paused } });
    },

    seekLab(elapsedSec: number): void {
      const prev = getGame().lab;
      if (!prev?.playing || !Number.isFinite(elapsedSec)) return;
      const at = Math.min(prev.runSec, Math.max(0, elapsedSec));
      labView.seek(at);
      labView.setPaused(true);
      setGame({ lab: { ...prev, paused: true, elapsedSec: at } });
    },

    setLabView(framing: LabFraming): void {
      if (!getGame().lab) return;
      audio.cue('ui-click');
      labView.setFraming(framing);
    },

    setLabInsets(leftPx: number, rightPx: number): void {
      labView.setInsets(leftPx, rightPx);
    },

    labLink(): string {
      const lab = getGame().lab;
      return lab ? `${window.location.origin}${window.location.pathname}?${labScenarioQuery(lab)}` : '';
    },

    startLabQuiz(): void {
      const lab = getGame().lab;
      if (!lab || lab.quiz) return;
      audio.cue('ui-click');
      labBeforeQuiz = lab;
      askLabQuestion(0, []);
    },

    stopLabQuiz(): void {
      const prev = getGame().lab;
      if (!prev?.quiz) return;
      audio.cue('ui-click');
      // The scenario the class mode replaced comes back as it was set; nothing of a question stays, a run of
      // its explosion included.
      const kept = labBeforeQuiz ?? prev;
      labBeforeQuiz = null;
      const setup: LabSetup = { kind: kept.kind, angleRad: kept.angleRad, distanceAU: kept.distanceAU, cmeStrength: kept.cmeStrength };
      labView.configure(setup.kind, setup.angleRad, setup.distanceAU, false);
      labView.setRemoved(kept.removed);
      const results = labResults(setup, prev.bodies, kept.removed);
      labView.resetExplosion();
      labView.setPaused(false);
      labView.setFocus(kept.focusId, false);
      labView.setConcealed(false);
      setGame({
        lab: {
          ...prev,
          ...setup,
          ...results,
          anchorId: kept.anchorId,
          removed: kept.removed,
          focusId: kept.focusId,
          playing: false,
          paused: false,
          elapsedSec: 0,
          quiz: null,
        },
      });
    },

    answerLabQuiz(level: LabImpactLevel): void {
      const prev = getGame().lab;
      const quiz = prev?.quiz;
      if (!prev || quiz?.phase !== 'ask') return;
      const running: LabQuiz = { ...quiz, picked: level, phase: 'run' };
      setGame({ lab: { ...prev, quiz: running } });
      this.detonateLab();
    },

    nextLabQuiz(): void {
      const prev = getGame().lab;
      const quiz = prev?.quiz;
      if (!prev || !quiz || (quiz.phase !== 'reveal' && quiz.phase !== 'done')) return;
      audio.cue('ui-click');
      if (quiz.phase === 'done') {
        askLabQuestion(0, []);
      } else if (quiz.index + 1 < LAB_QUESTIONS.length) {
        askLabQuestion(quiz.index + 1, quiz.rounds);
      } else {
        const done: LabQuiz = { ...quiz, phase: 'done' };
        setGame({ lab: { ...prev, quiz: done } });
      }
    },

    async watchLabFromGround(): Promise<void> {
      const lab = getGame().lab;
      if (!lab || (lab.kind !== 'sn2' && lab.kind !== 'sn1a')) return;
      // On the body in focus where that can be stood on; otherwise (the Sun, a moon, the spacecraft) on the Moon.
      const world: WorldId = lab.focusId in WORLDS && lab.focusId !== 'orbit' ? (lab.focusId as WorldId) : 'moon';
      labWatchSource = {
        kind: lab.kind,
        distanceAU: lab.distanceAU,
        angleRad: lab.angleRad,
        anchorId: lab.anchorId,
        jdTT: lab.jdTT,
        earthSummary: lab.impact.summary,
        fates: lab.fates,
      };
      showLabWatchFrom(world);
      const query = labScenarioQuery(lab);
      const site = prepareEvent(LAB_WATCH_EVENT_ID);
      setGame({ mapWorld: world, labReturn: query });
      await this.landAt(site);
    },

    returnToLab(): void {
      const st = getGame();
      const link = st.labReturn === null ? null : parseLabLink(`?${st.labReturn}`);
      if (!link) return;
      // The lab comes back as it was left: at the exact moment of its map, and as a page opened from the
      // menu. The visit made for the watch ends here: nothing of it (its place, its date, its running
      // clock) is left to go back to.
      const jdTT = labWatchSource?.jdTT ?? null;
      setGame({
        activeEventId: null,
        labReturn: null,
        stage: null,
        site: null,
        clock: { jdTT: jdTT ?? st.clock.jdTT, rate: 1, paused: false },
      });
      openLabLink(link, jdTT);
    },
  };

  registerGame(api);

  // ─────────────────────────── Global Key Shortcuts & Resize ───────────────────────────

  window.addEventListener('resize', () => {
    // Through the pixel ratio: the window may have moved to a screen of another density, or the page's zoom changed.
    applyPixelRatio();
    player.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    player.camera.updateProjectionMatrix();
  });

  // A lost WebGL context (a driver reset, the tab starved of memory) stops the picture: time and the sequences
  // wait for it, and what existed only on the graphics card is made again when it comes back.
  let contextLost = false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    contextLost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    const environment = createLunarEnvironment(renderer);
    mainScene.environment = environment;
    nearScene.environment = environment;
    contextLost = false;
  });

  window.addEventListener('keydown', (e) => {
    // Escape closes what is open from any control; the other keys belong to a field or a list in use.
    if (e.code !== 'Escape' && keyBelongsToControl(e)) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    // Space and Enter on a button, a link or a fold belong to that control.
    if ((tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') && (e.code === 'Space' || e.code === 'Enter')) return;
    const st = getGame();
    // A card or a panel over the page: Tab moves through its controls instead of grabbing the pointer.
    const covered = st.focusAssetId !== null || st.panels.info || st.panels.about || st.panels.settings
      || st.panels.help || st.panels.credits || st.panels.pause;
    if (e.code === 'KeyK' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Sound on / off, in every phase.
      const soundOn = !st.settings.soundOn;
      api.updateSettings({ soundOn });
      showToast(soundOn ? { tr: 'Ses açık', en: 'Sound on' } : { tr: 'Ses kapalı', en: 'Sound off' });
      return;
    }
    if (st.spectator && (st.phase === 'surface' || st.phase === 'space')) {
      // Spectator remote: ←/→ events, Space pause, Esc back to the menu.
      if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        e.preventDefault();
        api.spectatorStep(e.code === 'ArrowRight' ? 1 : -1);
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        const paused = !st.spectator.paused;
        setGame({ spectator: { ...st.spectator, paused } });
        api.setPaused(paused);
        return;
      }
      if (e.code === 'Escape' && !st.focusAssetId && !st.panels.info && !st.panels.about) {
        api.openMenu();
        return;
      }
    }
    if (e.code === 'Escape') {
      if (st.focusAssetId) {
        setGame({ focusAssetId: null });
        return;
      }
      for (const p of ['info', 'about', 'settings', 'help', 'credits', 'pause'] as const) {
        if (st.panels[p]) {
          api.togglePanel(p, false);
          return;
        }
      }
      if (st.phase === 'space') {
        // A selected marker goes first; the view is left only with nothing selected in it.
        if (st.spaceView?.selectedMarkerId) api.selectMarker(null);
        else api.exitSpaceView();
        return;
      }
      if (st.phase === 'map') {
        api.closeMap();
        return;
      }
      if (st.phase === 'surface') {
        api.togglePanel('pause', true);
      }
    } else if (e.code === 'KeyU' && (st.phase === 'surface' || st.phase === 'space') && !st.spectator) {
      api.toggleCleanMode();
    } else if (e.code === 'KeyI' && st.phase === 'space' && !st.spectator) {
      // The archive, as the bar of the close-up views says; on the ground the surface hotkeys handle it.
      if (st.panels.info) api.togglePanel('info', false);
      else api.openArchive();
    } else if (e.code === 'KeyR' && st.phase === 'space' && !st.spectator && !covered && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Replays the event from its start, as on the ground (there the surface hotkeys handle it).
      api.resetEventTime();
    } else if (e.code === 'Tab' && st.phase === 'surface' && !covered) {
      e.preventDefault();
      if (input.locked) input.exitLock();
      else input.requestLock();
    }
  });

  // ─────────────────────────── Main Frame Loop ───────────────────────────

  let lastFrameMs = performance.now();
  let fpsSmooth = 60;
  let handCursor = false;

  /**
   * The sky target or piece of hardware at a screen point, if any: its disc or the dot that marks it, else its
   * name (the label by the dot, or the block under the crosshair). During a staged sequence only the object
   * being shown can be picked.
   */
  function pickAt(x: number, y: number): FrameProjection | null {
    const st = getGame();
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    const only = st.stage?.playing ? st.stage.focusId : null;
    let best: FrameProjection | null = null;
    let bestScore = 1;
    for (const p of frame.projections) {
      if (!p.inFront || !p.visible || (only && p.id !== only)) continue;
      const discDeg = p.kind === 'sky' ? st.targets.find((t) => t.id === p.id)?.angularDiameterDeg ?? 0 : 0;
      const reach = Math.max(14, (discDeg / 2 / player.camera.fov) * h + 4);
      const score = Math.hypot(x - p.x * w, y - p.y * h) / reach;
      if (score <= bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best) return best;
    const underCrosshair = st.reticleId !== null && Math.abs(x - w / 2) <= 140 && y >= h / 2 + 22 && y <= h / 2 + 84;
    const namedId = underCrosshair
      ? st.reticleId
      : frame.labelBoxes.find((b) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2)?.id;
    if (!namedId) return null;
    return frame.projections.find((p) => p.id === namedId && p.inFront && p.visible && (!only || p.id === only)) ?? null;
  }

  /** The hand cursor shows that a click here opens something. */
  function setHandCursor(on: boolean): void {
    if (on === handCursor) return;
    handCursor = on;
    canvas.style.cursor = on ? 'pointer' : '';
  }

  function tick(nowMs: number): void {
    if (contextLost) {
      lastFrameMs = nowMs;
      window.requestAnimationFrame(tick);
      return;
    }
    const dt = Math.min(0.1, Math.max(0.0005, (nowMs - lastFrameMs) / 1000));
    lastFrameMs = nowMs;
    fpsSmooth = fpsSmooth * 0.92 + (1 / dt) * 0.08;
    frame.time += dt;

    const st = getGame();
    // Nothing is learnt about a scene's speed from a hidden tab, or from a photo being drawn tile by tile.
    const scene = `${st.phase}|${st.world}|${st.spaceView?.targetId ?? ''}`;
    if (!document.hidden && !captureTile && governor.frame(dt, fpsSmooth, scene, Math.min(1, MIN_PIXEL_RATIO / profilePixelRatio()))) applyPixelRatio();

    // Advance the simulation clock: the staging director owns it while a sequence plays.
    let jdTT = st.clock.jdTT;
    const live = st.phase === 'surface' || st.phase === 'space';
    if (director && live && !st.clock.paused) {
      const f = director.step(dt);
      if (f) {
        jdTT = f.jdTT;
        frame.stageProgress = f.progress;
        frame.stageFade = f.fade;
        if (f.entered) {
          applyStageEntry(f.stage, f.index, director.staging);
          pendingSnap = true;
        }
        setGame({ clock: { jdTT, rate: f.rate, paused: false } });
      } else {
        endStaging(true);
        jdTT = getGame().clock.jdTT;
      }
    } else if (!st.clock.paused && st.clock.rate !== 0 && live) {
      const next = jdTT + (dt * st.clock.rate) / SECONDS_PER_DAY;
      jdTT = Math.max(CLOCK_FIRST_JD, Math.min(CLOCK_LAST_JD, next));
      // At either end of its range the clock stops.
      setGame({ clock: { ...st.clock, jdTT, paused: jdTT !== next } });
    }
    if (live) {
      fireClockCues(lastClockJd, jdTT);
      evaluateTutorial(dt);
      updateSpectator();
    }
    lastClockJd = jdTT;
    frame.jdTT = jdTT;
    frame.rate = st.clock.paused ? 0 : getGame().clock.rate;

    if (st.phase === 'surface' && st.site) {
      // A card or a panel over the scene takes the keys: under it only the key that closes it acts (and Esc,
      // in the key listener); nothing is toggled, photographed or walked behind it.
      const covered = st.focusAssetId !== null || st.panels.info || st.panels.about || st.panels.settings
        || st.panels.help || st.panels.credits || st.panels.pause;
      // 1. Handle surface mode hotkeys
      if (input.wasPressed('KeyI')) {
        if (st.panels.info) api.togglePanel('info', false);
        else if (!covered) api.openArchive();
      }
      if (input.wasPressed('KeyH') && (!covered || st.panels.help)) api.togglePanel('help');
      if (!covered) {
        if (input.wasPressed('KeyT')) api.setTelescope(!st.telescope.active);
        if (input.wasPressed('KeyV')) api.setViewMode(st.viewMode === 'first' ? 'third' : 'first');
        if (input.wasPressed('KeyG')) {
          audio.cue('ui-click');
          setGame({ headlamp: !st.headlamp });
        }
        if (input.wasPressed('KeyM')) api.openMap();
        if (input.wasPressed('KeyN')) api.togglePanel('telemetry');
        if (input.wasPressed('KeyC')) api.updateSettings({ showConstellations: !st.settings.showConstellations });
        if (input.wasPressed('KeyP')) {
          api.capture('8k').then((b) => downloadBlob(b, `lunar-timewalker-8k-${Date.now()}.png`)).catch(() => undefined);
        }
        if (input.wasPressed('KeyR')) api.resetEventTime();
        if (input.wasPressed('Digit1')) api.setPaused(!st.clock.paused);
        if (input.wasPressed('Digit2')) api.setRate(1);
        if (input.wasPressed('Digit3')) api.setRate(60);
        if (input.wasPressed('Digit4')) api.setRate(3600);
        if (input.wasPressed('Digit5')) api.setRate(86400);
        if (input.wasPressed('Digit6')) api.setRate(864000);
      }

      // [B] places (or moves) the measuring mast: Sun and Earth visibility here over the next lunar day.
      if (!covered && input.wasPressed('KeyB')) {
        audio.cue('confirm');
        const fwdX = Math.sin(player.state.headingDeg * DEG2RAD);
        const fwdZ = -Math.cos(player.state.headingDeg * DEG2RAD);
        const bx = player.state.position.x + fwdX * 2.6;
        const bz = player.state.position.z + fwdZ * 2.6;
        artifacts.placeBeacon(bx, bz, terrain);

        const bProfile = terrain.horizonProfile(bx, bz, 2.2, 180);
        const stats = illuminationStats(jdTT, st.site, bProfile, 4);
        const nVec = terrain.normalAt(bx, bz);
        const reading: LightReading = {
          sunFraction: stats.sunFraction,
          earthFraction: stats.earthFraction,
          slopeDeg: Math.acos(Math.max(-1, Math.min(1, nVec.y))) * RAD2DEG,
          longestDarkHours: stats.longestDarkHours,
        };
        setGame({ lightReading: reading });
        const sun = Math.round(stats.sunFraction * 100);
        const earth = Math.round(stats.earthFraction * 100);
        showToast(lf(
          tpl`Ölçüm direği kuruldu. Önümüzdeki 29,5 gün için görünme oranı: Güneş %${sun}, Dünya %${earth}.`,
          tpl`Measuring mast placed. Share of the next 29.5 days visible from here: Sun ${sun}%, Earth ${earth}%.`,
        ), 'success');
      }

      // Telescope zoom: wheel, or the plus and minus characters (see core/input) and PageUp/PageDown held
      // down (about ×3 per second).
      const wheel = input.consumeWheel();
      const zoomKeys = (input.isDown('ZoomIn') || input.isDown('PageUp') ? -1 : 0)
        + (input.isDown('ZoomOut') || input.isDown('PageDown') ? 1 : 0);
      if (st.telescope.active && (wheel !== 0 || zoomKeys !== 0)) {
        // Exponential, so a burst of wheel events (trackpads) never flips the factor's sign.
        const factor = Math.exp(wheel * 0.0012 + zoomKeys * dt * 1.1);
        const nextFov = Math.max(0.25, Math.min(35, st.telescope.fovDeg * factor));
        player.setFov(nextFov);
        setGame({ telescope: { active: true, fovDeg: nextFov } });
      }

      // A click with the free pointer acts on what the pointer is over: a sky object opens its close-up view
      // (or the view turns to it, if it has none), hardware opens its card. A click with the locked pointer acts
      // on what is under the crosshair. Enter, and a click on empty sky, do so only while the telescope is up.
      const click = input.consumeClicks();
      const enterPressed = input.wasPressed('Enter');
      if ((click.count > 0 || enterPressed) && !st.spectator) {
        const picked = click.at ? pickAt(click.at.x, click.at.y) : null;
        const pointed = picked !== null || (click.count > 0 && click.at === null);
        const hitId = picked?.id ?? st.reticleId;
        const hitKind = picked?.kind ?? st.reticleKind;
        if (hitId && hitKind === 'sky' && (pointed || st.telescope.active)) {
          const tgt = st.targets.find((t) => t.id === hitId);
          if (tgt?.hasSpaceView) {
            setHandCursor(false);
            api.enterSpaceView(tgt.id);
            input.endFrame();
            composer.render();
            window.requestAnimationFrame(tick);
            return;
          }
          if (picked) api.lookAtTarget(hitId);
        } else if (click.count > 0 && hitId && hitKind === 'artifact') {
          audio.cue('ui-open');
          input.exitLock();
          setGame({ focusAssetId: hitId });
        }
      }

      // 2. Astronomy & horizon profile
      holdSeatToStars(st.world, jdTT);
      const here: SiteCoord = seat ?? st.site;
      currentSky = computeSky(jdTT, here, st.world);
      currentTransients = (labTransient ? [...TRANSIENTS, labTransient] : TRANSIENTS).map((d) => transientState(d, currentSky!, st.world));

      if (player.state.position.distanceTo(lastHorizonPos) > 12) {
        lastHorizonPos.copy(player.state.position);
        cachedHorizonProfile = terrain.horizonProfile(player.state.position.x, player.state.position.z, 1.62, 180);
      }

      const isSolid = WORLDS[st.world].solidSurface;
      const sunBody = currentSky.bodies.sun;
      const earthBody = currentSky.bodies.earth;
      const sunHorizonDeg = skylineDeg(sunBody.azDeg);
      const earthHorizonDeg = skylineDeg(earthBody.azDeg);
      const sunVis = (isSolid
        ? discVisibleFraction(cachedHorizonProfile, sunBody.azDeg, sunBody.elDeg, sunBody.angularDiameterDeg * 0.5)
        : (sunBody.elDeg > -2 ? 1 : 0))
        * (1 - currentSky.sunObscuredByEarth * 0.95);
      const earthVis = st.world !== 'earth' && (isSolid
        ? discVisibleFraction(cachedHorizonProfile, earthBody.azDeg, earthBody.elDeg, earthBody.angularDiameterDeg * 0.5) > 0.05
        : earthBody.elDeg > -2);
      // Brightest active supernova extra light (e.g. SN 1006 / SN 1054)
      let brightestSn: TransientState | null = null;
      for (const tr of currentTransients) {
        if (tr.kind === 'supernova' && tr.elDeg > 0 && tr.magnitude < -2) {
          if (!brightestSn || tr.magnitude < brightestSn.magnitude) brightestSn = tr;
        }
      }
      // Its light against sunlight at Earth (the Sun: magnitude −26.74). For the supernovae of history that is
      // about a hundred-millionth; one set off close by in the lab can light the ground as the Sun does, and more.
      const snFluxVsSun = brightestSn ? 10 ** (-0.4 * (brightestSn.magnitude + 26.74)) : 0;
      const extraInt = brightestSn
        ? Math.max(Math.min(0.18, Math.pow(10, -0.25 * (brightestSn.magnitude + 6)) * 0.04), 2.2 * Math.min(snFluxVsSun, 2.5))
        : 0;
      // A supernova that bright spoils dark adaptation and stops the exposure down the way the Sun does.
      const snVis = Math.min(1, snFluxVsSun);
      const highSn = brightestSn ? Math.max(0, brightestSn.dirLocal[1] - 0.15) * snVis : 0;

      // Eye dark adaptation + solar glare
      const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(player.camera.quaternion);
      const sunVec = new THREE.Vector3(sunBody.dirLocal[0], sunBody.dirLocal[1], sunBody.dirLocal[2]);
      const sunAngleDeg = Math.acos(Math.max(-1, Math.min(1, lookDir.dot(sunVec)))) * RAD2DEG;
      const lookingNearSun = Math.max(0, 1 - sunAngleDeg / 48);
      const unshadedSunGlare = sunVis * (0.35 + 0.65 * lookingNearSun) * (1 - player.shadeAmount * 0.95);
      // Dark adaptation: full at night; partial at polar sunrise/sunset, where most of the view lies in shadow.
      const grazing = 0.55 * (1 - THREE.MathUtils.smoothstep(sunBody.elDeg - sunHorizonDeg, 0, 5));
      // Looking toward even a sliver of the Sun keeps the eyes light-adapted unless the glove blocks it.
      const sunInView = lookingNearSun * THREE.MathUtils.smoothstep(sunVis, 0, 0.05) * (1 - player.shadeAmount);
      const targetAdaptation = (sunVis < 0.05 ? 1.0 : Math.max(player.shadeAmount * 0.85, grazing)) * (1 - sunInView) * (1 - snVis);
      adaptation += (targetAdaptation - adaptation) * Math.min(1, dt * 3.5);
      // Eyes adapted to sunlit regolith see only the brightest stars; dark adaptation (night, glove over the Sun) reveals the sky.
      const dayStars = 0.1 * (1 - 0.8 * lookingNearSun * sunVis);
      const starVisibility = dayStars + (1 - dayStars) * adaptation;
      const highSun = Math.max(0, sunBody.dirLocal[1] - 0.15) * sunVis;
      surfaceExposure = (1 + 0.8 * adaptation) / (1 + 2.5 * highSun + 2.5 * highSn);

      const lighting: LightingState = {
        sunDir: sunBody.dirLocal,
        sunColor: [1.0, 0.98, 0.94],
        sunIntensity: 2.2 * (1 - currentSky.sunObscuredByEarth * 0.92),
        sunVisibility: sunVis,
        earthDir: earthBody.dirLocal,
        // Earthshine is sunlight reflected by clouds and oceans: slightly blue, not saturated.
        earthColor: [0.78, 0.86, 1.0],
        earthIntensity: earthVis ? 0.065 * earthBody.illuminatedFraction : 0,
        extraDir: brightestSn ? brightestSn.dirLocal : [0, 1, 0],
        extraColor: [0.75, 0.88, 1.0],
        extraIntensity: extraInt,
        ambient: 0.022,
        adaptation,
        headlamp: {
          on: st.headlamp,
          pos: [player.camera.position.x, player.camera.position.y - 0.1, player.camera.position.z],
          dir: [lookDir.x, lookDir.y, lookDir.z],
          intensity: 1.0,
        },
      };

      // 3. Hardware first (the director may aim at a moving vehicle), then the player's view and movement.
      artifacts.update(dt, jdTT, lighting, player.camera);
      const look = input.consumeLook();
      if (look.dx !== 0 || look.dy !== 0) {
        lastManualLookSec = frame.time;
        lookTargetId = null;
      }
      if (director) {
        steerView(director.staging, director.staging.stages[getGame().stage?.index ?? 0], player.camera.fov, dt, pendingSnap);
      } else if (skippedStaging) {
        // The last step that steers the view, framed for the field of view that step has.
        const staging = skippedStaging;
        const last = staging.stages.findLast((s) => (s.focusId ?? staging.focusId ?? 'none') !== 'none');
        if (last) steerView(staging, last, last.telescopeFovDeg ?? last.zoomFovDeg ?? player.camera.fov, dt, true);
      }
      pendingSnap = false;
      skippedStaging = null;
      if (lookTargetId) {
        const dir = focusDirection(lookTargetId, false);
        if (dir) {
          const heading = (Math.atan2(dir.x, -dir.z) * RAD2DEG + 360) % 360;
          // A body under the skyline is faced along the skyline, not followed into the ground.
          const pitch = Math.max(Math.asin(Math.max(-1, Math.min(1, dir.y))) * RAD2DEG, skylineDeg(heading));
          const k = 1 - Math.exp(-dt * 6);
          const dh = ((heading - player.state.headingDeg + 540) % 360) - 180;
          const dp = pitch - player.state.pitchDeg;
          player.setLook(player.state.headingDeg + dh * k, player.state.pitchDeg + dp * k);
          if (Math.hypot(dh, dp) < 0.25) lookTargetId = null;
        } else {
          lookTargetId = null;
        }
      }
      const zoomScale = player.camera.fov / 60;
      const sens = 0.0022 * st.settings.mouseSensitivity * zoomScale;
      const moveX = covered ? 0 : (input.isDown('KeyD') || input.isDown('ArrowRight') ? 1 : 0)
        - (input.isDown('KeyA') || input.isDown('ArrowLeft') ? 1 : 0);
      const moveZ = covered ? 0 : (input.isDown('KeyW') || input.isDown('ArrowUp') ? 1 : 0)
        - (input.isDown('KeyS') || input.isDown('ArrowDown') ? 1 : 0);
      const run = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
      const jump = !covered && input.wasPressed('Space');
      const moveY = covered ? 0 : (input.isDown('Space') ? 1 : 0) - (input.isDown('KeyQ') ? 1 : 0);
      const shadeHold = (!covered && input.isDown('KeyF')) || stageShade;
      const scanHold = !covered && input.isDown('KeyE');

      obstacles.length = 0;
      terrain.collidersNear(player.state.position.x, player.state.position.z, 8, obstacles);
      artifacts.colliders(obstacles);
      player.update(
        dt,
        {
          moveX,
          moveZ,
          moveY,
          run,
          jump,
          lookYaw: look.dx * sens,
          lookPitch: -look.dy * sens * (st.settings.invertY ? -1 : 1),
        },
        terrain,
        lighting,
        { shadeSun: shadeHold, scan: scanHold, telescope: st.telescope.active || stageFov !== null },
        obstacles,
      );

      audio.setExertion(Math.min(1, Math.hypot(player.state.velocity.x, player.state.velocity.z) / 3.8));

      // 4. Update terrain, caster shadows, artifacts, lights, and sky
      terrain.update(dt, player.camera, lighting, player.state.position);
      const allCasters = [...player.shadowCasters, ...artifacts.shadowCasters];
      terrain.renderCasterShadows(allCasters, lighting, player.state.position);
      mainLights.sync(lighting);
      nearLights.sync(lighting);

      const calYear = calendarUTFromJdTT(jdTT).year;
      sky.update(
        {
          sky: currentSky,
          transients: currentTransients,
          starVisibility,
          sunGlare: unshadedSunGlare,
          adaptation,
          fovDeg: player.camera.fov,
          showConstellations: st.settings.showConstellations,
          highlightId: st.reticleId,
          year: calYear,
          reducedFlash: st.settings.reducedFlash,
          clockRate: frame.rate,
        },
        player.camera,
        dt,
      );
      player.camera.updateMatrixWorld();
      // No flare through the telescope: its tube blocks off-axis light.
      const flareStrength = sunVis * (1 - player.shadeAmount) * (st.settings.reducedFlash ? 0.35 : 1)
        * THREE.MathUtils.smoothstep(player.camera.fov, 6, 20);
      lensFlare.update(sunVec, player.camera, flareStrength);

      // 5. Project targets & artifacts to screen + determine crosshair reticle target
      frame.headingDeg = player.state.headingDeg;
      frame.pitchDeg = player.state.pitchDeg;
      frame.fovDeg = player.camera.fov;
      frame.speedMs = Math.hypot(player.state.velocity.x, player.state.velocity.z);
      frame.heightAboveGroundM = Math.max(0, player.state.position.y - terrain.heightAt(player.state.position.x, player.state.position.z));
      frame.shade = player.shadeAmount;
      frame.adaptation = adaptation;
      frame.projections.length = 0;

      player.camera.updateMatrixWorld();
      const pickConeDeg = Math.max(1.2, player.camera.fov * 0.11);
      let bestReticleId: string | null = null;
      let bestReticleKind: 'sky' | 'artifact' | null = null;
      let bestScore = 1e9;

      // Check surface artifacts first when close
      const tmpV = new THREE.Vector3();
      for (const art of (st.world === 'moon' ? artifacts.list() : [])) {
        if (!art.present) continue;
        tmpV.copy(art.position).add(new THREE.Vector3(0, 0.8, 0));
        const dirToArt = tmpV.clone().sub(player.camera.position).normalize();
        // The astronaut's distance, not the camera's: in third person the camera stands some metres behind.
        const distM = art.position.distanceTo(player.state.position);
        // Aim test along the object's height (ground to 1.6 m), so low hardware such as the
        // laser reflector is picked when the crosshair sits on it, not only on a point above it.
        let offDeg = 180;
        for (const h of [0.15, 0.5, 0.8, 1.2, 1.6]) {
          const probe = art.position.clone().setY(art.position.y + h).sub(player.camera.position).normalize();
          offDeg = Math.min(offDeg, Math.acos(Math.max(-1, Math.min(1, lookDir.dot(probe)))) * RAD2DEG);
        }
        const inFront = lookDir.dot(dirToArt) > 0.1;
        tmpV.project(player.camera);

        if (distM < 85) {
          frame.projections.push({
            id: art.assetId,
            kind: 'artifact',
            x: (tmpV.x + 1) * 0.5,
            y: (1 - tmpV.y) * 0.5,
            inFront,
            visible: true,
            offAxisDeg: offDeg,
            distanceM: distM,
          });
        }
        if (distM < 18 && offDeg < 14 && offDeg < bestScore) {
          bestScore = offDeg;
          bestReticleId = art.assetId;
          bestReticleKind = 'artifact';
        }
      }

      // Sky targets (bodies + Moon when on another world + active transients + galaxies). Under an overcast
      // sky only the Sun can be made out.
      const overcast = OVERCAST_WORLDS[st.world] === true;
      const skyTargetsList: SkyTarget[] = [];
      for (const bid of ['sun', 'earth', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] as const) {
        if (bid === st.world) continue;
        const b = currentSky.bodies[bid];
        const hDeg = skylineDeg(b.azDeg);
        const vis = (bid === 'sun' || !overcast) && b.elDeg > hDeg - 0.3;
        skyTargetsList.push({
          id: bid,
          kind: bid === 'sun' ? 'sun' : bid === 'earth' ? 'earth' : 'planet',
          name: BODY_NAMES[bid],
          azDeg: b.azDeg,
          elDeg: b.elDeg,
          magnitude: b.magnitude,
          angularDiameterDeg: b.angularDiameterDeg,
          visible: vis,
          hasSpaceView: true,
          lightTimeSec: b.lightTimeSec,
        });
      }
      if (currentSky.moon && st.world !== 'moon') {
        const mb = currentSky.moon;
        const hDeg = skylineDeg(mb.azDeg);
        skyTargetsList.push({
          id: 'moon',
          kind: 'planet',
          name: { tr: 'Ay', en: 'Moon' },
          azDeg: mb.azDeg,
          elDeg: mb.elDeg,
          magnitude: mb.magnitude,
          angularDiameterDeg: mb.angularDiameterDeg,
          visible: !overcast && mb.elDeg > hDeg - 0.3,
          hasSpaceView: true,
          lightTimeSec: mb.lightTimeSec,
        });
      }
      for (const tr of currentTransients) {
        if (tr.magnitude > 9 && tr.kind === 'comet') continue;
        if (tr.ageDays < -1 && tr.kind === 'supernova') continue;
        const hDeg = skylineDeg(tr.azDeg);
        const vis = !overcast && tr.elDeg > hDeg - 0.3;
        skyTargetsList.push({
          id: tr.id,
          kind: tr.kind,
          name: tr.name,
          azDeg: tr.azDeg,
          elDeg: tr.elDeg,
          magnitude: tr.magnitude,
          angularDiameterDeg: tr.remnantDiameterDeg ?? tr.comaDeg ?? 0.05,
          visible: vis,
          // The lab's supernova has no remnant to visit.
          hasSpaceView: tr.kind === 'supernova' && tr.id !== LAB_WATCH_TARGET_ID,
        });
      }
      for (const g of GALAXIES) {
        const dir = dirLocalFromRaDec(currentSky, g.raDeg, g.decDeg);
        const alt = azElFromDir(dir);
        const hDeg = skylineDeg(alt.azDeg);
        const vis = !overcast && alt.elDeg > hDeg - 0.5;
        skyTargetsList.push({
          id: g.id,
          kind: 'galaxy',
          name: g.name,
          azDeg: alt.azDeg,
          elDeg: alt.elDeg,
          magnitude: g.magnitude,
          angularDiameterDeg: g.apparentDeg,
          visible: vis,
          hasSpaceView: true,
        });
      }

      for (const stgt of skyTargetsList) {
        let dir: [number, number, number];
        if (stgt.id === 'moon' && currentSky.moon) {
          dir = currentSky.moon.dirLocal;
        } else if (stgt.id in currentSky.bodies) {
          dir = currentSky.bodies[stgt.id as BodyId].dirLocal;
        } else {
          const tr = currentTransients.find((t) => t.id === stgt.id);
          if (tr) {
            dir = tr.dirLocal;
          } else {
            const gal = GALAXIES.find((g) => g.id === stgt.id);
            if (gal) {
              dir = dirLocalFromRaDec(currentSky, gal.raDeg, gal.decDeg);
            } else {
              dir = [0, 1, 0];
            }
          }
        }
        const dVec = new THREE.Vector3(dir[0], dir[1], dir[2]);
        const offDeg = angularSeparationDeg([lookDir.x, lookDir.y, lookDir.z], dir);
        const inFront = lookDir.dot(dVec) > 0.1;
        tmpV.copy(player.camera.position).addScaledVector(dVec, 100).project(player.camera);

        if (stgt.visible) {
          frame.projections.push({
            id: stgt.id,
            kind: 'sky',
            x: (tmpV.x + 1) * 0.5,
            y: (1 - tmpV.y) * 0.5,
            inFront,
            visible: stgt.visible,
            offAxisDeg: offDeg,
            distanceM: 0,
          });
          if (bestReticleKind !== 'artifact' && offDeg < pickConeDeg && offDeg < bestScore) {
            bestScore = offDeg;
            bestReticleId = stgt.id;
            bestReticleKind = 'sky';
          }
        }
      }

      // Bright star labels for Sky Guide [C]
      frame.starLabels.length = 0;
      if (st.settings.showConstellations && !overcast) {
        for (const bs of BRIGHT_STARS) {
          const dir = dirLocalFromRaDec(currentSky, bs.raDeg, bs.decDeg);
          const alt = azElFromDir(dir);
          if (alt.elDeg < 2) continue;
          const dVec = new THREE.Vector3(dir[0], dir[1], dir[2]);
          if (lookDir.dot(dVec) < 0.25) continue;
          tmpV.copy(player.camera.position).addScaledVector(dVec, 100).project(player.camera);
          const sx = (tmpV.x + 1) * 0.5;
          const sy = (1 - tmpV.y) * 0.5;
          if (sx > 0.05 && sx < 0.95 && sy > 0.08 && sy < 0.88) {
            frame.starLabels.push({ id: bs.id, name: loc(bs.name, st.settings.lang), x: sx, y: sy });
          }
        }
      }
      artifacts.setHighlight(bestReticleKind === 'artifact' ? bestReticleId : null);

      // 6. [E] opens the information about whatever is under the crosshair.
      if (!covered && input.wasPressed('KeyE') && bestReticleId) {
        audio.cue('ui-open');
        if (bestReticleKind === 'artifact') {
          input.exitLock();
          setGame({ focusAssetId: bestReticleId });
        } else {
          const topic = bestReticleId === 'moon'
            ? 'moon'
            : bestReticleId in BODY_TOPICS
              ? BODY_TOPICS[bestReticleId as BodyId]
              : transientById(bestReticleId)?.topicId ?? GALAXIES.find((g) => g.id === bestReticleId)?.topicId;
          if (topic) api.openArchive(topic);
        }
      }

      if (bestReticleId !== st.reticleId || bestReticleKind !== st.reticleKind) {
        setGame({ reticleId: bestReticleId, reticleKind: bestReticleKind });
      }

      const hoverAt = input.hoverPoint;
      setHandCursor(hoverAt !== null && !st.spectator && pickAt(hoverAt.x, hoverAt.y) !== null);

      // 7. Throttled Telemetry & Store update (~5 Hz)
      if (nowMs - lastTelemClockMs > 200) {
        lastTelemClockMs = nowMs;
        // The moments hold while the clock runs towards them. They are worked out again every few seconds
        // (the astronaut walks and the skyline changes) and, at most once a second, when the clock has left
        // the stretch they hold for: a jump in time, or a clock fast enough to pass them. "None within 15
        // days" holds for a day.
        const sinceCalcMs = nowMs - lastEventCalcMs;
        const sinceCalcDays = jdTT - lastEventCalcJd;
        const outdated = sinceCalcDays < 0
          || [sunEventAt, earthEventAt].some((moment) => (moment ? jdTT >= moment.jdTT : sinceCalcDays > 1));
        if (sinceCalcMs > 6000 || (outdated && sinceCalcMs > 1000)) {
          lastEventCalcMs = nowMs;
          lastEventCalcJd = jdTT;
          sunEventAt = nextHorizonMoment('sun', jdTT, here, st.world);
          earthEventAt = st.world === 'earth' ? null : nextHorizonMoment('earth', jdTT, here, st.world);
        }

        const nVec = terrain.normalAt(player.state.position.x, player.state.position.z);
        const slopeDeg = isSolid ? Math.acos(Math.max(-1, Math.min(1, nVec.y))) * RAD2DEG : 0;
        const flux = solarFluxWm2(sunBody.distanceAU);
        const panelPowerW = flux * 0.30 * sunVis;
        const tempK = worldTemperatureK(st.world, sunBody.elDeg, sunVis, sunBody.distanceAU, st.terrainInfo?.albedo ?? 0.12);

        const telem: Telemetry = {
          latDeg: st.site.latDeg - (player.state.position.z / 1_737_400) * RAD2DEG,
          lonDeg: st.site.lonDeg + (player.state.position.x / (1_737_400 * Math.max(0.05, Math.cos(st.site.latDeg * DEG2RAD)))) * RAD2DEG,
          elevationM: (st.terrainInfo?.originElevationM ?? 0) + player.state.position.y,
          headingDeg: player.state.headingDeg,
          pitchDeg: player.state.pitchDeg,
          speedMs: frame.speedMs,
          slopeDeg,
          sunAzDeg: sunBody.azDeg,
          sunElDeg: sunBody.elDeg,
          sunHorizonDeg,
          sunVisibleFraction: sunVis,
          sunEvent: timeUntil(sunEventAt, jdTT),
          solarFluxWm2: flux,
          panelPowerW,
          earthAzDeg: earthBody.azDeg,
          earthElDeg: earthBody.elDeg,
          earthHorizonDeg,
          earthVisible: earthVis,
          earthEvent: timeUntil(earthEventAt, jdTT),
          earthPhase: earthBody.illuminatedFraction,
          dteLink: earthVis && earthBody.elDeg > earthHorizonDeg + 0.5,
          lightTimeSec: earthBody.lightTimeSec,
          surfaceTempK: tempK,
          radiationMsvDay: SURFACE_RADIATION_MSV_DAY[st.world] ?? null,
          accuracy: currentSky.accuracy,
          terrainSource: st.terrainInfo?.sourceLabel ?? { tr: 'LOLA DEM', en: 'LOLA DEM' },
          terrainResolutionM: st.terrainInfo?.dataResolutionM ?? 240,
        };

        setGame({
          telemetry: telem,
          targets: skyTargetsList,
          fps: Math.round(fpsSmooth),
        });
      }
    } else if (st.phase === 'menu' || st.phase === 'title' || st.phase === 'map' || st.phase === 'space') {
      // Clicks made here belong to this screen; none of them may act on the surface later.
      input.consumeClicks();
      setHandCursor(false);
      if (st.phase === 'space' && st.spaceView?.targetId === 'lab' && st.lab?.evaMode) {
        const mx = (input.isDown('KeyD') || input.isDown('ArrowRight') ? 1 : 0) - (input.isDown('KeyA') || input.isDown('ArrowLeft') ? 1 : 0);
        const mz = (input.isDown('KeyW') || input.isDown('ArrowUp') ? 1 : 0) - (input.isDown('KeyS') || input.isDown('ArrowDown') ? 1 : 0);
        const my = (input.isDown('Space') ? 1 : 0) - (input.isDown('KeyQ') ? 1 : 0);
        labView.setEvaKeys(mx, mz, my, input.isDown('ShiftLeft') || input.isDown('ShiftRight'));
      }
      activeSpaceView.update(dt, jdTT);
      // The lab's timeline in the panel follows the time-lapse, and the class mode with it. At the end of the
      // run the time-lapse is paused there, and nothing more is written until something changes.
      if (st.lab?.playing && !st.lab.paused && nowMs - lastLabSyncMs > 120) {
        lastLabSyncMs = nowMs;
        const elapsedSec = labView.elapsedSec();
        const ended = elapsedSec >= st.lab.runSec;
        if (ended) labView.setPaused(true);
        const quiz = labQuizAfter(st.lab, elapsedSec);
        if (ended || elapsedSec !== st.lab.elapsedSec || quiz !== st.lab.quiz) setGame({ lab: { ...st.lab, elapsedSec, paused: ended, quiz } });
      }
    }

    input.endFrame();
    // Surface exposure works like the eye: up to 1.8× after dark adaptation, and stopped down under a high Sun
    // so sunlit highlands stay grey instead of white. Space views use a fixed exposure.
    renderer.toneMappingExposure = st.phase === 'surface' ? surfaceExposure : 1;
    visorPass.enabled = st.phase === 'surface' && st.viewMode === 'first' && !getGame().telescope.active;
    visorPass.uniforms.uStrength.value = 1;
    visorPass.uniforms.uTime.value = frame.time % 100;
    visorPass.uniforms.uAspect.value = window.innerWidth / Math.max(1, window.innerHeight);
    composer.render();
    window.requestAnimationFrame(tick);
  }

  // Boot sequence: load manifests, enter the 3D Moon backdrop, and open the events menu immediately
  (async () => {
    try {
      setGame({ loading: { fraction: 0.3, label: { tr: 'NASA veri dosyaları denetleniyor…', en: 'Checking NASA data files…' } } });
      await loadManifest();
      setGame({ loading: { fraction: 0.8, label: { tr: 'Ay küresi hazırlanıyor…', en: 'Preparing the Moon globe…' } } });
      const st = getGame();
      await globeView.enter({
        targetId: 'moon',
        jdTT: st.clock.jdTT,
        lang: st.settings.lang,
        quality: QUALITY[st.settings.quality],
        mode: 'backdrop',
      });
      setGame({ phase: 'menu', loading: { fraction: 1, label: null } });
      if (import.meta.env.DEV) {
        // Dev-only: `?chapter=<eventId>&site=<siteId>` lands directly; `window.__lt` exposes internals for tests.
        Object.assign(window, { __lt: { api, player, terrain, getGame, setGame, sky, artifacts, renderer, mainScene, composer, guardPass, getSpaceView: () => activeSpaceView } });
        const params = new URLSearchParams(window.location.search);
        const chapter = params.get('chapter');
        if (chapter) {
          api.selectEvent(chapter === 'free' ? null : chapter);
          const site = SITES.find((s) => s.id === params.get('site')) ?? getGame().mapSelection;
          if (site) await api.landAt(site);
        }
      }
      // A link to a lab scenario (`?lab=…`, see views/lab/link.ts) opens the lab with it.
      const link = parseLabLink(window.location.search);
      if (link) openLabLink(link);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setGame({ fatal: lf(tpl`Başlatılamadı: ${msg}`, tpl`Could not start: ${msg}`) });
    }
  })();

  window.requestAnimationFrame(tick);
  return api;
}
