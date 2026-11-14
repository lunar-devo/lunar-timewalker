/**
 * Shared contracts for every module. This file is the single source of truth for
 * cross-module types. Conventions (see also local contract doc):
 *
 *  SCENE FRAME (surface): right-handed, Y up, local tangent plane at the landing site.
 *      +X = East, +Y = Up, +Z = South  (so North is -Z). Units: meters.
 *      Azimuth is measured from North through East:  dir = (cos(el)·sin(az), sin(el), -cos(el)·cos(az)).
 *  LIGHTING: display-referred linear RGB. Sun-lit regolith should land around 0.3–0.9 before tone mapping.
 *      Materials output LINEAR colour with NO tone mapping / colour-space conversion (the composer's OutputPass does it).
 *  TIME: Julian Day in Terrestrial Time (jdTT) everywhere. Calendar dates are UT, astronomical year numbering
 *      (1 BC = year 0, 7 BC = -6), Julian calendar before 1582-10-15.
 */
import type * as THREE from 'three';

// ───────────────────────────── basics ─────────────────────────────
/** Texts are authored in Turkish and English; the other languages are translations of the English text. */
export type Lang = 'tr' | 'en' | 'de' | 'fr' | 'es' | 'it' | 'ru';
/** A value placed into a text: plain, itself localized, or formatted per language (numbers, dates). */
export type L10nArg = string | number | L10n | ((lang: Lang) => string);
export interface L10n {
  tr: string;
  en: string;
  /** Texts built from values (see `lf`): the English template with {0}, {1}… and the values to put in. */
  tpl?: string;
  args?: L10nArg[];
}
export type Vec3 = [number, number, number];
/** Row-major 3×3: v' = M·v  with  v'[r] = M[3r]·v0 + M[3r+1]·v1 + M[3r+2]·v2 */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export interface CalendarDate {
  year: number; month: number; day: number;
  hour?: number; minute?: number; second?: number;
}

export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export interface QualityProfile {
  id: Quality;
  /** Upper bound for renderer pixel ratio. */
  pixelRatioCap: number;
  /** Texture tier suffix used by `texUrl()`. */
  texTier: '2k' | '4k' | '8k';
  bloom: boolean;
  /** Terrain clipmap ring resolution: cells per side of each LOD level (must be divisible by 8). */
  terrainGrid: number;
  /** Side length of each sun shadow cascade map, texels. */
  shadowMapSize: number;
  /** Multiplier for particle counts (dust, supernova ejecta, comet tails). */
  particles: number;
  rocks: number;
}

// ───────────────────────────── sites ─────────────────────────────
/** Selenographic coordinates (mean-Earth/polar-axis), longitude east-positive in [-180, 180]. */
export interface SiteCoord { latDeg: number; lonDeg: number }

export interface SiteDef extends SiteCoord {
  id: string;                 // e.g. 'apollo11'; 'custom' for a free pick on the globe
  name: L10n;
  region: L10n;
  blurb: L10n;
  /** Folder under assets/dem/sites/<packId>/ holding a high-resolution DEM pack. */
  packId?: string;
  tags?: string[];            // 'apollo' | 'pole' | 'farside' | 'clps' | 'artemis' | ...
  spawnHeadingDeg?: number;
}

// ───────────────────────────── astronomy ─────────────────────────────
export type BodyId = 'sun' | 'earth' | 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune';
export const BODY_IDS: BodyId[] = ['sun', 'earth', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];

/** Model accuracy class for the current epoch (measured against JPL Horizons DE441). */
export type AccuracyTier = 'high' | 'medium' | 'low';

export interface BodyState {
  id: BodyId;
  /** Unit vector toward the body in the scene frame (geometric, light-time corrected). */
  dirLocal: Vec3;
  /** Unit vector toward the body in ICRF/J2000 equatorial axes. */
  dirIcrf: Vec3;
  azDeg: number;
  /** Geometric elevation above the ideal (spherical) horizon; no terrain, no refraction. */
  elDeg: number;
  distanceKm: number;
  distanceAU: number;
  angularDiameterDeg: number;
  /** Apparent visual magnitude as seen from the Moon. */
  magnitude: number;
  /** Illuminated fraction of the disc, 0..1. */
  illuminatedFraction: number;
  /** One-way light time in seconds. */
  lightTimeSec: number;
  /** Angular distance from the Sun, degrees (0 for the Sun itself). */
  elongationDeg: number;
}

export interface SkyState {
  jdTT: number;
  jdUT: number;
  site: SiteCoord;
  /** v_local = localFromIcrf · v_icrf */
  localFromIcrf: Mat3;
  bodies: Record<BodyId, BodyState>;
  /** Moon state when standing on another world (Earth, Mars, Mercury, etc.); undefined on the Moon itself. */
  moon?: BodyState;
  earthFixedToLocal: Mat3;
  /** Sun position relative to Earth's centre, Earth body-fixed axes, km. */
  sunPosEarthFixedKm: Vec3;
  /** Moon centre relative to Earth's centre, Earth body-fixed axes, km. */
  moonPosEarthFixedKm: Vec3;
  /** Fraction of the solar disc hidden by the Earth as seen from the site (lunar eclipse), 0..1. */
  sunObscuredByEarth: number;
  /** Largest fraction of the Sun hidden by the Moon anywhere on Earth right now (solar eclipse on Earth), 0..1. */
  earthEclipseMax: number;
  /** Geographic point of greatest eclipse on Earth, valid when earthEclipseMax > 0. */
  earthEclipsePoint: { latDeg: number; lonDeg: number } | null;
  /** Selenographic sub-Earth and sub-solar points (libration / lunar day phase). */
  subEarth: SiteCoord;
  subSolar: SiteCoord;
  accuracy: AccuracyTier;
}

/** Heliocentric J2000-ecliptic orbital elements. */
export interface CometElements {
  q: number;            // perihelion distance, AU
  e: number;            // eccentricity (1 = parabolic)
  iDeg: number;
  nodeDeg: number;      // longitude of ascending node Ω
  argPeriDeg: number;   // argument of perihelion ω
  tpJdTT: number;       // time of perihelion passage
}

export interface SupernovaDef {
  kind: 'supernova';
  id: string;
  name: L10n;
  raDeg: number;        // J2000
  decDeg: number;
  /** First light as seen from the Earth–Moon system (UT). */
  firstLight: CalendarDate;
  peakMag: number;
  snType: 'Ia' | 'II';
  distanceLy: number;
  remnantName: L10n;
  /** Present-day angular diameter of the remnant, arcminutes. */
  remnantDiameterArcmin: number;
  /** Key into NASA image topics (see INasa.getTopic). */
  topicId: string;
}

export interface CometDef {
  kind: 'comet';
  id: string;
  name: L10n;
  elements: CometElements;
  /** Total magnitude model m = absMag + 5·log10(Δ) + slope·log10(r). */
  absMag: number;
  slope: number;
  /**
   * Optional brightening on top of the standard law (e.g. the 44 BC comet's reported daylight visibility):
   * magnitude is reduced by up to `deltaMag`, rising linearly over `riseDays` before `peak` and decaying over `decayDays` after.
   */
  outburst?: { peak: CalendarDate; deltaMag: number; riseDays: number; decayDays: number };
  topicId?: string;
}

export type TransientDef = SupernovaDef | CometDef;

/**
 * One of the pictures a galaxy is shown with: public/assets/tex/galaxy_<galaxy id>_<picture id>.webp in its
 * close-up and a small copy, ..._sky.webp, in the sky (source and credit are in the asset manifest). The
 * numbers are measured by tools/measure_galaxies.py: centre and axis from the picture itself, its place on
 * the sky by matching it with a north-up survey image from NASA SkyView.
 */
export interface GalaxyPicture {
  /** The kind of light; names the picture among the galaxy's and in its files. */
  id: 'visible' | 'infrared' | 'ultraviolet';
  /** Telescope and kind of light. */
  caption: L10n;
  /** The galaxy's centre in the picture, as shares of its width and height from the top left. */
  centre: [number, number];
  /** Width of the picture on the sky, degrees. */
  fieldDeg: number;
  /** Where on the sky the middle of the picture is: right ascension and declination, J2000 degrees. */
  skyCentre: [number, number];
  /** How far the picture has to be turned, degrees anticlockwise as it is seen in the sky, for its top to point north. */
  northUpDeg: number;
  /**
   * True for a picture cut from the star map the sky itself is drawn with: in the sky it is needed only once
   * the view is magnified past the map's own sharpness.
   */
  fromStarMap: boolean;
}

export interface GalaxyDef {
  id: string;
  catalogCode: string;
  name: L10n;
  typeLabel: L10n;
  raDeg: number;
  decDeg: number;
  distanceMly: number;
  /** Apparent major-axis diameter in degrees. */
  apparentDeg: number;
  /** Integrated visual magnitude. */
  magnitude: number;
  /** Tilt of the galactic disc relative to line of sight, degrees (0 = face-on, 90 = edge-on). */
  tiltDeg: number;
  /** Position angle of the long axis on the sky, degrees from north through east; a disc is tilted about it. */
  majorAxisPaDeg: number;
  /**
   * Position angle of the direction from the centre to the side that is nearer to us (majorAxisPaDeg ± 90);
   * null where there is no disc. See content/galaxies.ts for where each comes from.
   */
  nearSidePaDeg: number | null;
  /** The galaxy's pictures; the first is the one shown first, and the one in the sky. */
  pictures: GalaxyPicture[];
  summary: L10n;
  facts: L10n[];
  topicId: string;
}

/** Per-frame state of a transient, computed by astro and consumed by the sky renderer and HUD. */
export interface TransientState {
  id: string;
  kind: 'supernova' | 'comet';
  name: L10n;
  dirLocal: Vec3;
  azDeg: number;
  elDeg: number;
  /** Apparent magnitude now; +99 when not visible at all (before first light / far from perihelion). */
  magnitude: number;
  /** Supernova: days since first light (negative before). Comet: days since perihelion. */
  ageDays: number;
  /** Supernova: remnant angular diameter now (deg), growing linearly from 0 to the present-day value at year 2026. */
  remnantDiameterDeg?: number;
  /** Comet: unit vector on the sky pointing along the anti-solar (ion tail) direction, scene frame. */
  tailDirLocal?: Vec3;
  /** Comet: apparent ion-tail length in degrees. */
  tailLengthDeg?: number;
  /** Comet: coma angular diameter in degrees. */
  comaDeg?: number;
  /** Comet distances in AU. */
  sunDistAU?: number;
  distAU?: number;
}

/** Orientation and illumination of a body for the close-up "space view". */
export interface BodyOrientation {
  /** Body-fixed (x → lon 0 on equator, z → north pole) to ICRF. */
  fixedToIcrf: Mat3;
  /** Unit vector toward the Sun in body-fixed axes. */
  sunDirFixed: Vec3;
  /** Unit vector toward the observer (the Moon) in body-fixed axes. */
  observerDirFixed: Vec3;
  subSolarLatDeg: number; subSolarLonDeg: number;
  subObserverLatDeg: number; subObserverLonDeg: number;
  distanceFromObserverAU: number;
  distanceFromSunAU: number;
  angularDiameterArcsec: number;
  lightTimeSec: number;
}

// ───────────────────────────── lighting ─────────────────────────────
export interface LightingState {
  /** Unit vector toward the Sun, scene frame. */
  sunDir: Vec3;
  sunColor: Vec3;
  /** Un-occluded sun strength (includes eclipse dimming, NOT terrain shadowing). ~2.2 in full sun. */
  sunIntensity: number;
  /** 0..1 fraction of the solar disc visible from the player's position (terrain horizon aware). */
  sunVisibility: number;
  earthDir: Vec3;
  earthColor: Vec3;
  /** Earthshine strength (0 when Earth is below the horizon). ~0.0–0.08. */
  earthIntensity: number;
  /** Extra directional light: brightest transient (e.g. a supernova). */
  extraDir: Vec3;
  extraColor: Vec3;
  extraIntensity: number;
  /** Small isotropic fill standing in for light scattered by lit terrain. */
  ambient: number;
  /** 0 = eyes adapted to daylight, 1 = fully dark adapted. */
  adaptation: number;
  headlamp: { on: boolean; pos: Vec3; dir: Vec3; intensity: number };
}

// ───────────────────────────── module interfaces ─────────────────────────────
export interface GroundQuery {
  /** World Y of the rendered ground under (x, z). */
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number, out?: THREE.Vector3): THREE.Vector3;
}

/** Vertical cylinder the astronaut cannot walk through (boulders, hardware). */
export interface Collider {
  x: number;
  z: number;
  radius: number;
  /** World Y of the top: the astronaut clears it when the feet are above. */
  top: number;
}

export interface TerrainLoadInfo {
  /** Human readable data provenance for the HUD, e.g. "LOLA 5 m/px (PGDA Site04)". */
  sourceLabel: L10n;
  /** Best real-data ground resolution under the spawn point, meters per sample. */
  dataResolutionM: number;
  hasHiRes: boolean;
  /** Elevation of the spawn point above the 1737.4 km reference sphere, meters. */
  originElevationM: number;
  /** Representative normal albedo of the site (0..1). */
  albedo: number;
}

export interface ITerrain extends GroundQuery {
  readonly object3d: THREE.Object3D;
  load(site: SiteDef, quality: QualityProfile, onProgress?: (fraction: number, label?: string) => void): Promise<TerrainLoadInfo>;
  /** Call once per frame before rendering: re-centres the clipmap on the player, updates lighting, re-scatters rocks. */
  update(dt: number, camera: THREE.PerspectiveCamera, lighting: LightingState, playerPos: THREE.Vector3): void;
  /** Renders the cascaded sun shadow maps (terrain, rocks and the given casters) around `center`. */
  renderCasterShadows(casters: THREE.Object3D[], lighting: LightingState, center: THREE.Vector3): void;
  /**
   * Terrain horizon as seen from (x, z) at eyeHeight: elevation angle in degrees for `samples` azimuths
   * (index i ↔ azimuth i·360/samples, North through East). Includes lunar curvature.
   */
  horizonProfile(x: number, z: number, eyeHeightM: number, samples?: number): Float32Array;
  /** Appends boulders within `range` metres of (x, z) that block walking. */
  collidersNear(x: number, z: number, range: number, out: Collider[]): void;
  setQuality(quality: QualityProfile): void;
  /** Adjusts ground colour/visibility for Moon, Mars, Earth or gas-giant upper cloud deck. */
  setWorld(world: WorldId): void;
  dispose(): void;
}

export interface SkyFrame {
  sky: SkyState;
  transients: TransientState[];
  /** 0..1 display-referred visibility of stars/planets/Milky Way (eye adaptation + glare). */
  starVisibility: number;
  /** 0..1 strength of the solar glare/flare sprite (terrain and hand occlusion already applied). */
  sunGlare: number;
  adaptation: number;
  fovDeg: number;
  showConstellations: boolean;
  /** Sky target currently highlighted (reticle / objective), or null. */
  highlightId: string | null;
  /** Calendar year (for city lights on Earth's night side etc.). */
  year: number;
  /** When true, bright flashes are softened (photosensitivity setting). */
  reducedFlash: boolean;
}

export interface ISky {
  /** Rendered first each frame with a camera at the origin sharing the player camera's orientation and FOV. */
  readonly scene: THREE.Scene;
  load(quality: QualityProfile, onProgress?: (fraction: number) => void): Promise<void>;
  update(frame: SkyFrame, camera: THREE.PerspectiveCamera, dt: number): void;
  setQuality(quality: QualityProfile): void;
  /** Full-resolution star map while a high-resolution capture renders (the next update() restores it). */
  setDetailBoost(on: boolean): void;
  /** The scene is now drawn at another pixel ratio: star points are sized in drawn pixels. */
  setPixelRatio(ratio: number): void;
  /** Adds Mars/Earth atmospheric sky or Saturn's sky rings when the astronaut is on another world. */
  setWorld(world: WorldId): void;
  dispose(): void;
}

export interface PlayerFrameInput {
  /** Strafe (-1 left .. +1 right) and forward (-1 back .. +1 forward). */
  moveX: number;
  moveZ: number;
  /** Vertical thrust in zero-g EVA (+1 Space up, −1 C down). */
  moveY?: number;
  run: boolean;
  /** True on the frame the jump key went down. */
  jump: boolean;
  /** Look deltas in radians (already scaled by sensitivity / telescope zoom). */
  lookYaw: number;
  lookPitch: number;
}

export interface PlayerState {
  /** Feet position in the scene frame. */
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  onGround: boolean;
  /** Compass heading of the view, degrees (0 = North, 90 = East). */
  headingDeg: number;
  /** View pitch, degrees (+ up). */
  pitchDeg: number;
  viewMode: 'first' | 'third';
  jumpCount: number;
  lastJumpHeightM: number;
  lastAirTimeSec: number;
  distanceWalkedM: number;
  /** Ground slope under the feet, degrees. */
  slopeDeg: number;
}

export interface PlayerGesture {
  /** Raise a glove to cover the Sun. */
  shadeSun: boolean;
  /** Raise the hand scanner toward the scan direction. */
  scan: boolean;
  /** Telescope engaged (first-person arms should get out of the way). */
  telescope: boolean;
}

export type PlayerEvent = 'jump' | 'land' | 'step';

export interface IPlayer {
  /** Eye camera. The engine owns FOV changes through setFov(). near/far are set by the engine. */
  readonly camera: THREE.PerspectiveCamera;
  /** Third-person body, dust, footprints. Lives in the main scene. */
  readonly worldObject: THREE.Object3D;
  /** First-person arms, gloves, torso, boots and their own lights. Lives in the near scene (rendered after a depth clear). */
  readonly nearObject: THREE.Object3D;
  /** Objects that should cast shadows onto the ground. */
  readonly shadowCasters: THREE.Object3D[];
  readonly state: PlayerState;
  /** 0..1: how completely the raised glove currently covers the Sun. */
  readonly shadeAmount: number;
  load(onProgress?: (fraction: number) => void): Promise<void>;
  teleport(x: number, z: number, headingDeg: number, ground: GroundQuery, pitchDeg?: number): void;
  /** Turns the view without moving the body (used by the staging director to keep an event in frame). */
  setLook(headingDeg: number, pitchDeg: number): void;
  /** `obstacles`: boulders and hardware near the astronaut that it cannot walk through. */
  update(dt: number, input: PlayerFrameInput, ground: GroundQuery, lighting: LightingState, gesture: PlayerGesture, obstacles: Collider[]): void;
  setViewMode(mode: 'first' | 'third'): void;
  setWorld(world: WorldPhysics): void;
  setFov(fovDeg: number): void;
  on(event: PlayerEvent, cb: (value: number) => void): void;
  dispose(): void;
}

export type WorldId = 'moon' | 'mercury' | 'venus' | 'earth' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'orbit';

export interface WorldPhysics {
  id: WorldId;
  name: L10n;
  /** Surface gravity in m/s² (0 in orbital zero-g EVA). */
  gravityMs2: number;
  jumpSpeedMs: number;
  walkSpeedMs: number;
  runSpeedMs: number;
  /** True when floating in zero-g / orbital EVA instead of walking on solid ground. */
  zeroG: boolean;
  /** True when the body has solid terrain (false for gas giants and open orbit). */
  solidSurface: boolean;
  note: L10n;
}

/** Hardware left on the Moon or Mars: lander, rover, instrument, flag, orbiter, footprints. */
export interface SurfaceAsset {
  id: string;
  body: 'moon' | 'mars';
  name: L10n;
  kind: 'lander' | 'rover' | 'helicopter' | 'instrument' | 'flag' | 'orbiter' | 'stage' | 'trace';
  mission: L10n;
  agency: string;
  latDeg: number;
  lonDeg: number;
  /** Date the hardware arrived (UT). The object does not exist before it. */
  arrival: CalendarDate;
  /** Last contact / end of operations, if it has gone silent. */
  lastContact?: CalendarDate;
  /** True when still operating or still used (e.g. laser retroreflectors). */
  stillActive: boolean;
  /** One line: what state it is in now. */
  status: L10n;
  /** What it did, in plain words. */
  history: L10n[];
  facts: L10n[];
  /** GLB under assets/models/, if any. */
  modelFile?: string;
  topicId?: string;
}

export type ArtifactVisual =
  | 'apollo_lm_descent' | 'lrrr' | 'psep' | 'flag' | 'tv_camera' | 'bootprints' | 'plaque' | 'beacon';

/** Placement of a SurfaceAsset on a walkable lunar site, offsets from the site origin. */
export interface ArtifactPlacement {
  assetId: string;
  siteId: string;
  eastM: number;
  southM: number;
  headingDeg: number;
  visual: ArtifactVisual;
  /** Radius of the highlight ring. */
  radiusM: number;
}

export interface ArtifactInfo {
  assetId: string;
  /** Where the hardware rests on the ground. */
  position: THREE.Vector3;
  /** Where the hardware is right now: differs from `position` while a vehicle is descending or climbing. */
  focus: THREE.Vector3;
  radiusM: number;
  /** False when the current date is before the asset's arrival. */
  present: boolean;
}

export interface IArtifacts {
  readonly object3d: THREE.Object3D;
  readonly shadowCasters: THREE.Object3D[];
  load(placements: ArtifactPlacement[], assets: SurfaceAsset[], ground: GroundQuery): Promise<void>;
  update(dt: number, jdTT: number, lighting: LightingState, camera: THREE.PerspectiveCamera): void;
  list(): ArtifactInfo[];
  /** Appends the footprints of hardware currently standing on the ground. */
  colliders(out: Collider[]): void;
  setHighlight(assetId: string | null): void;
  /** Deploys (or moves) the player's solar/comm beacon at a ground position. */
  placeBeacon(x: number, z: number, ground: GroundQuery): void;
  removeBeacon(): void;
  dispose(): void;
}

// ───────────────────────────── space views (telescope close-ups, map globe) ─────────────────────────────
export interface GlobeMarker {
  id: string;
  latDeg: number;
  lonDeg: number;
  label: L10n;
  kind: 'site' | 'lander' | 'rover' | 'helicopter' | 'orbiter' | 'custom' | 'event';
  /** Greyed out (e.g. target below horizon at that site, or hardware not yet arrived). */
  dimmed?: boolean;
  /** CSS colour. */
  color?: string;
  modelFile?: string;
}

export interface CmeVisual {
  id: string;
  /** Launch time, jdTT. */
  startJdTT: number;
  speedKmS: number;
  halfAngleDeg: number;
  /** Heliographic (Stonyhurst) direction. */
  latDeg: number;
  lonDeg: number;
  note?: string;
}

export interface SpaceViewOptions {
  /** 'moon' | 'mars' | 'earth' | 'jupiter' | 'saturn' | 'sun' | a supernova id. */
  targetId: string;
  jdTT: number;
  lang: Lang;
  quality: QualityProfile;
  /** picker: click anywhere to choose coordinates. explore: orbit + markers. backdrop: slow auto-rotation, no input. */
  mode: 'picker' | 'explore' | 'backdrop';
  markers?: GlobeMarker[];
  cmes?: CmeVisual[];
  supernova?: SupernovaDef;
  galaxy?: GalaxyDef;
  /** Which of the galaxy's pictures (GalaxyPicture.id); the first when left out. */
  galaxyPictureId?: string;
  /** NASA image to cross-fade to for a remnant view. */
  imageUrl?: string;
  onPick?: (latDeg: number, lonDeg: number) => void;
  onMarker?: (markerId: string) => void;
}

export interface ISpaceView {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  enter(opts: SpaceViewOptions): Promise<void>;
  /** Advance animations; jdTT lets the view keep orientation / lighting / growth in sync with the clock. */
  update(dt: number, jdTT: number): void;
  setMarkers(markers: GlobeMarker[]): void;
  /** Highlights a picked coordinate (picker mode) and optionally rotates the globe toward it. */
  setSelection(sel: SiteCoord | null, flyTo?: boolean): void;
  setSelectedMarker(markerId: string | null): void;
  /** Start / stop listening to pointer + wheel on the canvas. */
  attach(el: HTMLElement): void;
  detach(): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

// ───────────────────────────── audio / NASA data ─────────────────────────────
export type AudioScene = 'silent' | 'menu' | 'surface' | 'space';
export type AudioCue =
  | 'ui-click' | 'ui-open' | 'ui-close' | 'beep' | 'radio-on' | 'radio-off'
  | 'confirm' | 'complete' | 'supernova' | 'teleport' | 'shutter' | 'warn';

export interface IAudio {
  /** Must be called from a user gesture; safe to call repeatedly. */
  unlock(): void;
  setScene(scene: AudioScene): void;
  setMasterVolume(v: number): void;
  setMuted(m: boolean): void;
  cue(cue: AudioCue, intensity?: number): void;
  /** Footstep / landing thumps conducted through the suit. */
  step(intensity: number): void;
  land(impactSpeedMs: number): void;
  /** Breathing rate follows exertion 0..1. */
  setExertion(x: number): void;
  /** Optional spoken narration through the Web Speech API. */
  narrate(text: string, lang: Lang): void;
  stopNarration(): void;
  setNarrationEnabled(on: boolean): void;
}

export interface NasaImage {
  nasaId: string;
  title: string;
  description: string;
  date: string;
  center?: string;
  thumbUrl: string;
  /** Largest reasonable rendition (≤ ~2000 px) for the lightbox. */
  imageUrl: string;
  /** Page on images.nasa.gov. */
  pageUrl: string;
  credit: string;
}

export interface NasaTopicResult {
  topicId: string;
  /** 'live' when fetched from the API in this session, 'archive' when served from the bundled snapshot. */
  source: 'live' | 'archive';
  images: NasaImage[];
}

export interface DonkiEvent {
  id: string;
  type: 'CME' | 'GST' | 'SEP' | 'FLR';
  /** ISO 8601 UTC. */
  time: string;
  /** CME only. */
  speedKmS?: number;
  halfAngleDeg?: number;
  latDeg?: number;
  lonDeg?: number;
  /** GST only: peak Kp. */
  kp?: number;
  /** FLR only: class like "X5.8". */
  classType?: string;
  note?: string;
  link?: string;
}

export interface DonkiResult {
  source: 'live' | 'archive';
  events: DonkiEvent[];
}

export interface INasa {
  getTopic(topicId: string): Promise<NasaTopicResult>;
  search(query: string, limit?: number): Promise<NasaTopicResult>;
  /** Space-weather events between two ISO dates (YYYY-MM-DD). */
  donki(startDate: string, endDate: string): Promise<DonkiResult>;
}

// ───────────────────────────── event content ─────────────────────────────
export type EventCategory = 'supernova' | 'comet' | 'conjunction' | 'eclipse' | 'mission' | 'solar' | 'mars' | 'future';

/** A moment in UT, optionally shifted by a number of days (whole lunar rotations keep the stars in place). */
export interface StageMoment { date: CalendarDate; offsetDays?: number }

/** A subtitle shown when the simulation clock passes `at` (replayed when the staging is replayed). */
export interface TimedCue {
  id: string;
  at: StageMoment;
  /** Who said it, for historical quotes; omitted for narration. */
  speaker?: L10n;
  text: L10n;
}

/** One step of a chapter's "before → event → after" sequence. The director drives the clock through it. */
export interface StageDef {
  id: string;
  kind: 'before' | 'event' | 'after';
  /** Short chip text, e.g. "ÖNCE" / "BEFORE". */
  label: L10n;
  /** What is on screen; shown while the stage plays and read aloud when narration is on. */
  caption: L10n;
  from: StageMoment;
  /** Omitted: the clock simply runs at 1× from `from` for the stage's duration. */
  to?: StageMoment;
  /** Real seconds the stage lasts. */
  seconds: number;
  /** Start with a dip to black: a cut to another moment instead of a continuous run. */
  cut?: boolean;
  /** Overrides the staging's focus for this stage; 'none' leaves the view alone. */
  focusId?: string;
  /** Aim at where the focused hardware rests rather than at the moving vehicle. */
  focusGround?: boolean;
  /** Move the astronaut here (site metres) when the step begins: a change of viewpoint, so pair it with `cut`. */
  standAt?: { x: number; z: number; headingDeg: number };
  /** Engage the helmet telescope at this field of view while the stage plays. */
  telescopeFovDeg?: number;
  /** Narrow the plain view to this field of view (a cinematic close-up without the telescope mask). */
  zoomFovDeg?: number;
  /** The astronaut raises a glove over the Sun while the stage plays. */
  shadeSun?: boolean;
}

export interface StagingDef {
  /** 'surface', or the target id of the close-up view the sequence plays in ('mars', 'sun', ...). */
  where: string;
  /** Sky target or surface asset the view is steered toward while the stages run. */
  focusId?: string;
  /** Surface sequences: land at the best seat for watching `focusId` instead of the chapter's default site. */
  autoSeat?: boolean;
  stages: StageDef[];
  /** Simulated seconds per real second once the sequence has finished. */
  endRate: number;
}

/** HUD state of the running (or finished) staging sequence. Progress within a stage lives in `frame`. */
export interface StageStatus {
  where: string;
  steps: Array<{ id: string; kind: StageDef['kind']; label: L10n }>;
  index: number;
  caption: L10n;
  /** Sky target or asset the current step is about: its marker stays on screen while the sequence plays. */
  focusId: string | null;
  playing: boolean;
}

export interface EventDef {
  id: string;
  order: number;
  category: EventCategory;
  title: L10n;
  /** Date line, e.g. "4 Temmuz 1054" / "4 July 1054". */
  dateLabel: L10n;
  /** One or two sentences for the event card. */
  summary: L10n;
  /** What happened and why it matters, for the map screen and the "about this event" panel. */
  about: L10n[];
  /** The moment of the event, UT (event card, map visibility; scene start when there is no staging). */
  date: CalendarDate;
  /** Simulated seconds per real second at scene start when there is no staging. */
  startRate: number;
  /**
   * "Before → event → after" sequences: at most one for the surface (plays on landing) and one per
   * close-up view (plays when the close-up view is opened during the event).
   */
  staging?: StagingDef[];
  /** Historical quotes or narration tied to moments of the staging. */
  cues?: TimedCue[];
  defaultSiteId: string;
  recommendedSiteIds: string[];
  /**
   * Where the event can be watched from. 'moon': it happens on the Moon or shows only from there.
   * 'earthMoon': an arrangement in the sky of Earth and the Moon; other worlds see the same moment differently.
   * 'anywhere': it looks the same from every world of the Solar System, or plays in a close-up view.
   */
  seenFrom: 'moon' | 'earthMoon' | 'anywhere';
  /** Sky target the view faces at the start; also drives map visibility badges. */
  primaryTargetId?: string;
  /** What is measured or recorded and what is a model in this scene. */
  notes: L10n[];
  infoTopicIds: string[];
  /** Markers shown when the Mars view is opened during this event (SurfaceAsset ids). */
  marsFocusAssetIds?: string[];
  /** CSS colour used for the card. */
  accent: string;
  /** NASA image id used as card art (served through INasa / bundled snapshot), optional. */
  cardTopicId?: string;
}

// ───────────────────────────── telemetry / HUD ─────────────────────────────
export interface HorizonEvent { kind: 'rise' | 'set'; inHours: number }

export interface Telemetry {
  // position
  latDeg: number; lonDeg: number; elevationM: number; headingDeg: number; pitchDeg: number;
  speedMs: number; slopeDeg: number;
  // Sun
  sunAzDeg: number; sunElDeg: number;
  /** Terrain horizon elevation at the Sun's azimuth, degrees. */
  sunHorizonDeg: number;
  sunVisibleFraction: number;
  sunEvent: HorizonEvent | null;
  solarFluxWm2: number;
  /** Output of a 1 m² sun-tracking array at 30 % efficiency, W. */
  panelPowerW: number;
  // Earth / comms
  earthAzDeg: number; earthElDeg: number;
  earthHorizonDeg: number;
  earthVisible: boolean;
  earthEvent: HorizonEvent | null;
  earthPhase: number;
  dteLink: boolean;
  lightTimeSec: number;
  // environment (models)
  surfaceTempK: number;
  radiationMsvDay: number;
  // provenance
  accuracy: AccuracyTier;
  terrainSource: L10n;
  terrainResolutionM: number;
}

export interface SkyTarget {
  id: string;
  kind: 'sun' | 'earth' | 'planet' | 'supernova' | 'comet' | 'galaxy';
  name: L10n;
  azDeg: number;
  elDeg: number;
  magnitude: number;
  angularDiameterDeg: number;
  /** Above the local terrain horizon. */
  visible: boolean;
  /** Has a close-up view reachable through the telescope. */
  hasSpaceView: boolean;
  distanceText?: L10n;
  lightTimeSec?: number;
}

export interface Subtitle {
  id: number;
  /** Who is speaking, for quotes; null for narration. */
  speaker: L10n | null;
  text: L10n;
}

export type Phase = 'boot' | 'title' | 'menu' | 'map' | 'loading' | 'surface' | 'space';
export type PanelId = 'telemetry' | 'info' | 'about' | 'settings' | 'help' | 'pause' | 'credits';

export interface Settings {
  lang: Lang;
  quality: Quality;
  mouseSensitivity: number;   // 0.2 .. 3, default 1
  masterVolume: number;       // 0..1
  /** Sound as a whole (the score, the suit's sounds, the cues); off silences everything and the volume keeps its value. */
  soundOn: boolean;
  narration: boolean;
  reducedFlash: boolean;
  showLabels: boolean;
  showConstellations: boolean;
  invertY: boolean;
}

/** Sun and Earth visibility over the next lunar day at a point marked with the measuring mast [B]. */
export interface LightReading {
  sunFraction: number;    // fraction of the next lunar day with the Sun visible
  earthFraction: number;  // fraction with the Earth visible (direct radio contact possible)
  slopeDeg: number;
  longestDarkHours: number;
}

/** What explodes: a supernova of either kind, a gamma-ray burst, or a solar eruption. */
export type LabExplosionKind = 'sn2' | 'sn1a' | 'grb' | 'cme';
/** How strong a solar eruption is: an ordinary one, the storm of May 2024, or one of the class of the 1859 Carrington event. */
export type LabCmeStrength = 'ordinary' | 'may2024' | 'carrington';
export type LabImpactLevel = 'safe' | 'caution' | 'danger' | 'extreme';
/** Lab camera framings: the whole orbit the explosion sits on, the whole map, or the body in focus up close. */
export type LabFraming = 'orbit' | 'map' | 'close';

/** What explodes and where: all that the lab's model needs to know of the explosion. */
export interface LabSetup {
  kind: LabExplosionKind;
  /** Direction of the explosion from Earth in the plane of the planets, radians. */
  angleRad: number;
  /** Distance of the explosion from Earth, AU (0.00257 = the Moon's distance … 6.3×10^8 = 10,000 light years). */
  distanceAU: number;
  /** Solar eruptions only. */
  cmeStrength: LabCmeStrength;
}

/** Something drawn on the lab's map at its real direction and distance from Earth on the map's date. */
export interface LabBody {
  id: string;
  name: L10n;
  kind: 'moon' | 'sun' | 'planet' | 'star' | 'nebula';
  /** Direction on the map, radians, and distance from Earth, AU. */
  angleRad: number;
  distanceAU: number;
  /**
   * Its real direction, radians. The map moves a token aside by a few degrees when it would hide another;
   * what the explosion does to the body is worked out from where the body really is.
   */
  skyAngleRad: number;
  /**
   * Direction, radians, at which an explosion set at this body stands: beside a body of the solar system
   * (clear of its token), on the spot for a star, which is itself what explodes.
   */
  spotRad: number;
}

/** What the lab's model takes a body for: rock or ice, with or without air; a giant of gas or ice; a star. */
export type LabBodyClass = 'rocky' | 'icy' | 'giant' | 'star';

/** 0..1 strength of each visible consequence on one of the bodies of the map other than Earth. */
export interface LabFateOutcome {
  /** Display brightness of the explosion's light on the side facing it. */
  flash: number;
  scorch: number;
  /** Air blown off a body of rock or ice, or the outer layers torn off a giant or a star. */
  air: number;
  /** Crust of rock or shell of ice melted (not for giants and stars). */
  melt: number;
  breakup: number;
  /** How far the blast pushes the body (or what is left of it). */
  kick: number;
  /** Solar eruption: how hard the cloud strikes (0 where it misses). */
  storm: number;
}

/** What the explosion does to one of the bodies of the map other than Earth. All values are models (views/lab/physics.ts). */
export interface LabFate {
  /** LabBody id. */
  id: string;
  bodyClass: LabBodyClass;
  /** From the explosion to the body. */
  distanceLabel: L10n;
  /**
   * How long the light takes to reach the body, and then what follows it: the blast wave or the plasma cloud.
   * A gamma-ray burst is its own light: both then name the travel time of the rays.
   */
  lightTimeText: L10n;
  shockTimeText: L10n;
  /**
   * Supernova: its light there relative to the sunlight the body normally gets, and the temperature while it
   * lasts, K. Gamma-ray burst: the same ratio during the ten seconds of the burst; the temperature is the
   * body's usual one.
   */
  fluxLocal: number;
  tempK: number;
  /** Gamma-ray burst: energy of the rays through each square metre at the body, J (0 where the beam misses it). */
  fluenceJm2: number;
  /** Energy striking the body, J, and the speed the blast gives it, km/s. */
  energyJ: number;
  kickKmS: number;
  /**
   * Solar eruption: ram pressure at the body, nPa (0 where the cloud misses it), and where the sunward edge
   * of its magnetosphere ends up, in the body's own radii (0 for a body without a global magnetic field).
   */
  pressureNPa: number;
  standoffRadii: number;
  level: LabImpactLevel;
  /** Sentences, read one after the other. */
  summary: L10n[];
  outcome: LabFateOutcome;
  /** Damage bars: what each stands for and how far it is reached, 0..1. */
  meters: Array<{ label: L10n; value: number }>;
  /**
   * Seconds after detonation, in the lab's time-lapse, at which the light and what follows it (null: it
   * never does) reach the body's token on the map.
   */
  lightAtSec: number;
  shockAtSec: number | null;
  /**
   * Consequences in the order they happen; `atSec` as above. The step with id 'shock' is the arrival of the
   * blast wave, the plasma cloud or the beam.
   */
  steps: Array<{ id: string; atSec: number; text: L10n }>;
}

/** Spacecraft near Earth in a solar eruption: where they fly and how the squeezed magnetosphere leaves them. */
export interface LabSatellite {
  id: 'l1' | 'geo' | 'gps' | 'iss';
  name: L10n;
  /** Distance from Earth's centre, Earth radii. */
  orbitRe: number;
  /** Inside the magnetosphere, at its edge, or outside it in the solar wind (where the L1 sentinels always are). */
  state: 'inside' | 'edge' | 'outside';
  note: L10n;
}

/** 0..1 strength of each visible consequence on Earth. */
export interface LabOutcome {
  /** Display brightness of the explosion's light on the side of Earth facing it. */
  flash: number;
  scorch: number;
  /** Share of the ozone layer lost. */
  ozone: number;
  atmosphere: number;
  oceans: number;
  crust: number;
  breakup: number;
  aurora: number;
  /** City lights and satellites lost. */
  blackout: number;
  /** How far the blast pushes Earth (or what is left of it). */
  kick: number;
}

/** What the explosion does to Earth from the chosen distance. All values are models (views/lab/physics.ts). */
export interface LabImpact {
  distanceLabel: L10n;
  apparentMag: number;
  /**
   * Light from the explosion relative to sunlight at Earth (1 = as bright as the Sun); for a gamma-ray burst,
   * the power of the rays during the ten seconds of the burst relative to sunlight.
   */
  fluxSolar: number;
  /** How long the light, and then the blast wave, plasma cloud or beam, take to reach Earth. */
  lightTimeText: L10n;
  shockTimeText: L10n;
  /** Mean surface temperature while the flash lasts, K (radiative balance). */
  surfaceTempK: number;
  ozoneLoss: number;
  /** Gamma-ray burst: energy of the rays through each square metre at Earth, J, and how wide the beam is there. */
  fluenceJm2: number;
  beamWidthLabel: L10n | null;
  /** Energy striking Earth (supernova, gamma-ray burst) or its magnetosphere (CME), J. */
  energyJ: number;
  /** Speed the blast gives to Earth, km/s. */
  kickKmS: number;
  /** CME: ram pressure at Earth, nPa, and where the magnetosphere's sunward edge ends up, Earth radii. */
  pressureNPa: number;
  standoffRe: number;
  /** Lowest latitude at which auroras are seen, degrees. */
  auroraLatDeg: number;
  /** CME: how the spacecraft near Earth fare, the nearest to the Sun first, and the worst of it as a level. */
  satellites: LabSatellite[];
  satellitesLevel: LabImpactLevel;
  level: LabImpactLevel;
  summary: L10n;
  outcome: LabOutcome;
  /**
   * Consequences in the order they happen; `atSec` is seconds after detonation in the lab's time-lapse. The
   * step with id 'shock' is the arrival of the blast wave, the plasma cloud or the beam.
   */
  steps: Array<{ id: string; atSec: number; text: L10n }>;
}

/** The lab's class mode: predict how a body fares, set the explosion off, compare with the model. */
export interface LabQuiz {
  /** Which question is on, from 0, of how many. */
  index: number;
  count: number;
  /** 'ask': waiting for a prediction; 'run': the explosion plays; 'reveal': the model's answer; 'done': the score. */
  phase: 'ask' | 'run' | 'reveal' | 'done';
  question: L10n;
  /** The prediction for the question that is on (null until it is made). */
  picked: LabImpactLevel | null;
  /** Every question answered so far: what was predicted and what the model says. */
  rounds: Array<{ question: L10n; picked: LabImpactLevel; answer: LabImpactLevel }>;
}

export interface LabState extends LabSetup {
  /**
   * The body of the map the explosion was set at and follows when the map's date changes (a solar eruption:
   * 'sun' while the Sun is at its real place); null for a place picked freely.
   */
  anchorId: string | null;
  playing: boolean;
  /** The time-lapse stands still (it can still be moved by hand). */
  paused: boolean;
  /** Seconds since detonation, and the second by which the last consequence has happened. */
  elapsedSec: number;
  runSec: number;
  /** True when flying around Earth and the explosion as the weightless astronaut. */
  evaMode: boolean;
  impact: LabImpact;
  /** The moment the map shows: the Sun, Moon and planets stand where they were as seen from Earth then. */
  jdTT: number;
  /**
   * Everything the map can show, nearest first; `removed` lists the ids of those that are off it (Pluto,
   * Titan and Europa are, until they are added).
   */
  bodies: LabBody[];
  removed: string[];
  /** What happens to the Moon, the Sun and the other bodies that are on the map. */
  fates: LabFate[];
  /**
   * What the result is shown for and the close view goes to: 'earth', a LabBody id, or 'satellites' (the
   * spacecraft near Earth, in a solar eruption).
   */
  focusId: string;
  /** The class mode, while it is on. */
  quiz: LabQuiz | null;
}

// ───────────────────────────── UI → engine commands ─────────────────────────────
export interface GameAPI {
  /** Title → menu. Also unlocks audio. */
  start(): void;
  openMenu(): void;
  /** Choose an event (null = free exploration). Sets the clock and opens the map. */
  selectEvent(eventId: string | null): void;
  /** Open the Moon map from the surface to relocate (time and event are kept). */
  openMap(): void;
  /** Leave the map without relocating (only valid when a site is loaded). */
  closeMap(): void;
  /** Highlight a location on the map globe. */
  previewSite(site: SiteDef): void;
  /** Load terrain for the site and drop the player there. */
  landAt(site: SiteDef): Promise<void>;
  /** Pausing also holds a running staging sequence. */
  setPaused(paused: boolean): void;
  /** Manual time travel; takes the clock away from a running staging sequence. */
  setTime(jdTT: number): void;
  /** Simulated seconds per real second (0 pauses the clock but not the player). Ends a running staging sequence. */
  setRate(rate: number): void;
  /**
   * Play the event's "before → event → after" sequence again: from its first moment, or from step
   * `fromStep` of it (the Before / Event / After buttons).
   */
  replayStaging(fromStep?: number): void;
  /** Jump to the end of the running staging sequence. */
  skipStaging(): void;
  /** Back to the event's start: replays its staging sequence, or returns the clock to the event moment. */
  resetEventTime(): void;
  setTelescope(on: boolean): void;
  setViewMode(mode: 'first' | 'third'): void;
  /** Open the close-up view of a sky target id ('mars', 'earth', 'sun', 'sn1054', ...). */
  enterSpaceView(targetId: string): void;
  /** Shows another of the galaxy's pictures (GalaxyPicture.id) in its close-up. */
  setGalaxyPicture(pictureId: string): void;
  exitSpaceView(): void;
  selectMarker(markerId: string | null): void;
  togglePanel(panel: PanelId, open?: boolean): void;
  /** Renders a still at the requested size and returns a PNG blob. */
  capture(kind: 'screen' | '4k' | '8k'): Promise<Blob>;
  updateSettings(patch: Partial<Settings>): void;
  /** Grab / release the pointer for mouse look. */
  requestPointerLock(): void;
  /** Guided walk through the controls at the Apollo 11 site. */
  startTutorial(): Promise<void>;
  /** Skips the current tutorial step (or advances past a finished tutorial). */
  skipTutorialStep(): void;
  /** Hands-free tour that plays every event's staging in turn. */
  startSpectator(index?: number): Promise<void>;
  /** Next (+1) or previous (−1) event of the spectator tour. */
  spectatorStep(delta: number): void;
  /** Leaves tutorial or spectator mode (stays where the player is). */
  stopModes(): void;
  /** Smoothly turns the surface camera toward a sky target or artifact. */
  lookAtTarget(targetId: string): void;
  /** Hides all HUD chrome for classroom projector viewing. */
  toggleCleanMode(on?: boolean): void;
  /** Switches the astronaut's current world/gravity environment (Moon, Mars, Earth, gas giant orbit, 0g). */
  setWorld(world: WorldId): void;
  /** Chooses the world the next landing is watched from (map screen). */
  setMapWorld(world: WorldId): void;
  /**
   * Opens the Explosion Lab, where a supernova, a gamma-ray burst or a solar eruption can be set off at any
   * distance from Earth.
   */
  openSpaceLab(kind?: LabExplosionKind): void;
  /**
   * Changes the kind of explosion, the strength of a solar eruption, where the explosion is, or the
   * weightless-astronaut view. `anchorId` names the body of the map the place was taken from (null: a place
   * picked freely). `keepView` leaves the camera where it is (a place picked on the map is already in view).
   */
  setLabConfig(patch: LabConfigPatch, keepView?: boolean): void;
  /** Sets the lab's map to another moment: the Sun, the Moon and the planets go to where they stood then. */
  setLabDate(jdTT: number): void;
  /**
   * Shows what happens to another body ('earth', a LabBody id, or 'satellites' in a solar eruption) and takes
   * the camera close to it.
   */
  setLabFocus(bodyId: string): void;
  /** Takes the Moon, a planet or another moon off the lab's map, or puts it on. */
  setLabBodyOnMap(bodyId: string, onMap: boolean): void;
  detonateLab(): void;
  resetLab(): void;
  /** Halts the lab's time-lapse, or lets it run on. */
  setLabPaused(paused: boolean): void;
  /** Moves the lab's time-lapse to a moment, seconds after detonation, and halts it there. */
  seekLab(elapsedSec: number): void;
  /** Points the lab camera at the whole orbit of the explosion, the whole map, or the body in focus up close. */
  setLabView(framing: LabFraming): void;
  /** Tells the lab how many pixels its panels cover at the left and right, so the map is framed between them. */
  setLabInsets(leftPx: number, rightPx: number): void;
  /** The address that opens the app in the lab with the scenario that is set now. */
  labLink(): string;
  /** Starts the lab's class mode at its first question. */
  startLabQuiz(): void;
  /** Leaves the class mode; the lab stays as the last question set it. */
  stopLabQuiz(): void;
  /** Takes the prediction for the question that is on, and sets the explosion off. */
  answerLabQuiz(level: LabImpactLevel): void;
  /** Goes on to the next question, or to the score after the last. */
  nextLabQuiz(): void;
  /**
   * Goes to the ground to watch the lab's supernova come up in the sky: on the body in focus where that can
   * be stood on, otherwise on the Moon.
   */
  watchLabFromGround(): Promise<void>;
  /** Back to the lab, with the scenario that was being watched from the ground. */
  returnToLab(): void;
}

/** What `setLabConfig` can change. */
export interface LabConfigPatch {
  kind?: LabExplosionKind;
  cmeStrength?: LabCmeStrength;
  angleRad?: number;
  distanceAU?: number;
  anchorId?: string | null;
  evaMode?: boolean;
}
