/**
 * Shared app state. The engine writes it (throttled), React reads it. UI-only state (open panels,
 * map selection) lives here too so the engine can react to it. Commands go through `game` (src/game/api.ts).
 */
import { create } from 'zustand';
import type {
  L10n, LabState, LightReading, PanelId, Phase, Quality, Settings, SiteDef, SkyTarget, StageStatus, Subtitle,
  Telemetry, TerrainLoadInfo, WorldId,
} from './types';
import { isLang } from './l10n';
import { QUALITY, detectQuality } from './quality';
import { jdTTNow } from './time';

// v2: the app starts in English. Settings saved as v1 carry the language that was guessed from the browser, so they are not read.
const SETTINGS_KEY = 'lunar-timewalker.settings.v2';

function defaultSettings(): Settings {
  return {
    // English until the visitor picks another language; the choice is then saved with the other settings.
    lang: 'en',
    quality: typeof navigator !== 'undefined' ? detectQuality() : 'medium',
    mouseSensitivity: 1,
    masterVolume: 0.7,
    soundOn: true,
    narration: false,
    reducedFlash: false,
    showLabels: true,
    showConstellations: false,
    invertY: false,
  };
}

/** The settings that are numbers, with the range each may have (see `Settings`). */
const NUMBER_RANGE: Record<'mouseSensitivity' | 'masterVolume', { min: number; max: number }> = {
  mouseSensitivity: { min: 0.2, max: 3 },
  masterVolume: { min: 0, max: 1 },
};

/** The settings that are switches. */
const SWITCHES = ['soundOn', 'narration', 'reducedFlash', 'showLabels', 'showConstellations', 'invertY'] as const;

function isQuality(value: unknown): value is Quality {
  return typeof value === 'string' && Object.hasOwn(QUALITY, value);
}

/**
 * Settings from whatever was found in storage: a saved value is taken only when it is of the kind its
 * setting needs (a known language or quality, a number inside the setting's range, a boolean); every
 * other setting keeps its default, and keys that are not settings are dropped.
 */
export function sanitiseSettings(saved: unknown, defaults: Settings): Settings {
  const settings = { ...defaults };
  if (typeof saved !== 'object' || saved === null) return settings;
  const found: Partial<Record<keyof Settings, unknown>> = saved;
  if (isLang(found.lang)) settings.lang = found.lang;
  if (isQuality(found.quality)) settings.quality = found.quality;
  for (const key of Object.keys(NUMBER_RANGE) as Array<keyof typeof NUMBER_RANGE>) {
    const value = found[key];
    // The comparisons also turn away NaN and the infinities.
    if (typeof value === 'number' && value >= NUMBER_RANGE[key].min && value <= NUMBER_RANGE[key].max) settings[key] = value;
  }
  for (const key of SWITCHES) {
    const value = found[key];
    if (typeof value === 'boolean') settings[key] = value;
  }
  return settings;
}

function loadSettings(): Settings {
  const defaults = defaultSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return sanitiseSettings(JSON.parse(raw), defaults);
  } catch { /* storage unavailable or not JSON: defaults are fine */ }
  return defaults;
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export interface Toast { id: number; text: L10n; kind: 'info' | 'success' | 'warn' }

export interface GameState {
  phase: Phase;
  loading: { fraction: number; label: L10n | null };
  /** Fatal start-up problem (missing assets, no WebGL2). */
  fatal: L10n | null;
  settings: Settings;

  /** Active event, null = free exploration. */
  activeEventId: string | null;
  /** Active world/physics environment for the astronaut ('moon' by default). */
  world: WorldId;
  /** World the next landing goes to, chosen on the map screen. */
  mapWorld: WorldId;
  /**
   * True while a sequence plays on a world other than the Moon: the seat is held under the same stars, as if
   * one frame were taken per rotation of the planet, so the sky does not wheel round during the time-lapse.
   */
  skyLocked: boolean;
  /** Landed site (terrain loaded). */
  site: SiteDef | null;
  /** Location currently highlighted on the map. */
  mapSelection: SiteDef | null;
  terrainInfo: TerrainLoadInfo | null;

  clock: { jdTT: number; rate: number; paused: boolean };
  telemetry: Telemetry | null;
  /** Sky objects for compass markers, telescope read-outs, map badges. Updated ~5 Hz. */
  targets: SkyTarget[];
  /** Sky target id or artifact asset id under the crosshair, if any. */
  reticleId: string | null;
  reticleKind: 'sky' | 'artifact' | null;
  telescope: { active: boolean; fovDeg: number };
  viewMode: 'first' | 'third';
  pointerLocked: boolean;
  /** The last input came from a touch screen: the surface shows its on-screen pad for walking. */
  touchInput: boolean;
  shadingSun: boolean;
  headlamp: boolean;

  /** "Before → event → after" sequence of the active event; null when the event has none here. */
  stage: StageStatus | null;
  subtitle: Subtitle | null;
  toast: Toast | null;
  panels: Record<PanelId, boolean>;
  /** Topic the info panel should show (set when opened from a target / artifact). */
  infoTopicId: string | null;
  /** Hardware card shown after pressing E on it or clicking its marker (SurfaceAsset id). */
  focusAssetId: string | null;

  /** Close-up view state when phase === 'space'. `galaxyPictureId` names the picture a galaxy is shown with. */
  spaceView: { targetId: string; selectedMarkerId: string | null; galaxyPictureId: string | null } | null;
  /** Space Explosion Lab state when open. */
  lab: LabState | null;
  /** The lab scenario (a link query) to go back to while its supernova is watched from the ground. */
  labReturn: string | null;
  /** Classroom projector mode: hides HUD panels and toolbars. */
  cleanMode: boolean;

  /** Guided tutorial: current step (index into TUTORIAL_STEPS) and its progress; null when off. */
  tutorial: { index: number; progress: number; finished: boolean } | null;
  /** Spectator tour: event index into EVENTS being shown; null when off. */
  spectator: { index: number; paused: boolean } | null;

  /** Result of the measuring mast [B], if one has been placed here. */
  lightReading: LightReading | null;

  fps: number;
  /** Renderer facts for the settings panel. */
  gpu: { renderer: string; maxTextureSize: number; pixelRatio: number; width: number; height: number } | null;
}

export const useGame = create<GameState>(() => ({
  phase: 'boot',
  loading: { fraction: 0, label: null },
  fatal: null,
  settings: loadSettings(),

  activeEventId: null,
  world: 'moon',
  mapWorld: 'moon',
  skyLocked: false,
  site: null,
  mapSelection: null,
  terrainInfo: null,

  // The moment the page is opened: the clock never shows a date nobody chose.
  clock: { jdTT: jdTTNow(), rate: 1, paused: false },
  telemetry: null,
  targets: [],
  reticleId: null,
  reticleKind: null,
  telescope: { active: false, fovDeg: 60 },
  viewMode: 'first',
  pointerLocked: false,
  touchInput: false,
  shadingSun: false,
  headlamp: false,

  stage: null,
  subtitle: null,
  toast: null,
  panels: {
    telemetry: true, info: false, about: false, settings: false, help: false, pause: false, credits: false,
  },
  infoTopicId: null,
  focusAssetId: null,

  spaceView: null,
  lab: null,
  labReturn: null,
  cleanMode: false,
  tutorial: null,
  spectator: null,

  lightReading: null,

  fps: 0,
  gpu: null,
}));

/** Non-React access for the engine. */
export const getGame = useGame.getState;
export const setGame = useGame.setState;

/** A toast leaves by itself after this long, ms. */
const TOAST_MS = 2600;
let toastSeq = 1;
export function showToast(text: L10n, kind: Toast['kind'] = 'info'): void {
  const id = toastSeq++;
  setGame({ toast: { id, text, kind } });
  // Unless a newer one has taken its place by then.
  setTimeout(() => {
    if (getGame().toast?.id === id) setGame({ toast: null });
  }, TOAST_MS);
}
