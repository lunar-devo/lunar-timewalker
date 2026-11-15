/**
 * Explosion Lab: set off a supernova (core collapse or Type Ia), a gamma-ray burst or a solar eruption (CME)
 * at any distance from Earth, from the Moon's orbit out to 10,000 light years, and watch what it reaches,
 * in which order, and what it does to each body.
 *
 *   - The map lies in the plane of the planets with the Sun at its centre (./map.ts). The planets stand on
 *     their orbits at their real places round the Sun for the map's date (astronomy-engine), the Moon on a
 *     small ring round Earth, whose neighbourhood is magnified; Alpha Centauri, Sirius, Betelgeuse and the
 *     Crab Nebula mark the far rings at their real ecliptic longitudes; the star map behind is the real
 *     sky, turned the same way. Bodies are tokens: none is to scale, and they are drawn larger when the view
 *     is far out.
 *   - After detonation the fronts cross the map: the light first, then the blast wave (or plasma cloud); a
 *     gamma-ray burst is a front of rays inside two opposite beams, and nothing else. They are the real
 *     fronts carried through the map's projection, so each is at a body's token at the moment the model has
 *     it reach that body, and the bodies are reached in their real order. The pace is a time-lapse of its
 *     own (./physics.ts sets its clock); the real travel times are shown in the panel. It can be halted and
 *     moved by hand: everything drawn follows from the time since detonation. It stops at its last second
 *     and holds that picture; until the explosion is reset, a click on the map moves nothing.
 *   - The explosion's own light is shown dimmed (FLASH_DIM): the glare round it, its fireball and the light
 *     it casts on the bodies are a fraction of what the scene could draw, so that the fronts and the bodies
 *     stay readable through the flash. A display choice: the model and the timing do not know of it.
 *   - What happens to Earth follows ./physics.ts: the flash lights and scorches the facing side, the ozone
 *     layer thins, the blast strips the air, boils the oceans, melts the crust or takes the planet apart and
 *     pushes what is left away; a CME squeezes the magnetosphere and drives the auroras toward the equator,
 *     and the spacecraft near Earth end up inside the magnetosphere or outside it.
 *   - The Moon, the Sun and the other planets answer the same explosion from where each of them stands
 *     (./physics.ts again): the flash lights and heats them, the blast strips air or outer layers, melts
 *     rock or ice, takes them apart and carries them off; a CME squeezes the magnetospheres it reaches, drags
 *     gas off the bodies that have air but no global field, and misses what lies outside its cloud. A ring
 *     round each body shows in a colour how badly it fares. The Moon and the planets can be taken off the
 *     map and put back; Pluto, Titan and Europa can be added to it.
 *   - The scene can also be flown through as the weightless astronaut.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type {
  ISpaceView, L10n, LabBody, LabClock, LabExplosionKind, LabFate, LabFateOutcome, LabFraming, LabImpact, LabImpactLevel, LabSatellite,
  LabSetup, Lang, QualityProfile, SpaceViewOptions,
} from '../../core/types';
import { eclipticOfRaDec, geocentricPlaces, type GeocentricBody } from '../../astro';
import { BODY_NAMES, BRIGHT_STARS, TRANSIENTS } from '../../content';
import { texUrl } from '../../core/assets';
import { loc } from '../../core/l10n';
import { softDotTexture } from '../../core/sprites';
import { createSuitRig, poseSuit, type SuitRig } from '../../player/suit';
import { SATURN_RING_GLSL, SATURN_RING_INNER, SATURN_RING_OUTER } from '../rings';
import {
  LAB_LENS_RADIUS, LAB_MAX_AU, LAB_MIN_AU, labPlaceFromEarth, labProject, labSunRadius, labUnproject, LY_AU, type MapPoint,
} from './map';
import {
  BURST_HALF_WIDTH_RAD, CME_HALF_WIDTH_RAD, computeLabResults, LAB_BREAKUP_AT, labBlastPlace, labClockRealSec, labFrontsAU, type LabResults,
} from './physics';

export { LAB_MAX_AU, LAB_MIN_AU, labEarthPlace, labPlaceFromEarth, labProject, labSunRadius, labUnproject, LY_AU, type MapPoint } from './map';
export {
  computeLabResults, distanceText, LAB_BREAKUP_AT, LAB_EXTRA_IDS, labBlastPlace, labClockRealSec, labClockSec, labFrontsAU, labRunLines,
  type LabResults, type LabRunLine,
} from './physics';
export { LAB_FIRST_YEAR, LAB_LAST_YEAR, labLinkQuery, parseLabLink, type LabLink } from './link';
export { LAB_QUESTIONS } from './quiz';

const EJECTA_PARTICLES = 4200;
const DEBRIS_CHUNKS = 260;
const DEBRIS_DUST = 1800;
const AIR_PARTICLES = 2200;
/** The same for the Moon's, the Sun's and each planet's own wreckage: fewer than Earth's, enough to read as a tail and a cloud from close by. */
const TOKEN_AIR = 1400;
const TOKEN_CHUNKS = 96;
const TOKEN_DUST = 900;
/** Seconds after the blast arrives at which a doomed body starts to come apart. */
const BREAKUP_DELAY_SEC = 3.6;
/**
 * How far the blast carries a body at most, in radii of its own token: far enough to show, near enough for
 * the body to stay in its part of the map.
 */
const KICK_RADII = 5.5;
/**
 * Earth's globe, air and wreckage are built with this radius, scene units, and drawn at this share of it:
 * Earth is a token among the others, a little larger than its neighbours.
 */
const LAB_EARTH_R = 2;
const EARTH_SCALE = 0.3;
const EARTH_TOKEN_R = LAB_EARTH_R * EARTH_SCALE;
/** The exploding star, its fireball and its flash are drawn at this share of the size they are built with. */
const BLAST_SCALE = 0.45;
/** Where the weightless astronaut starts, from Earth's centre: beside Earth, toward the camera as the lab opens. */
const EVA_OFFSET = new THREE.Vector3(-1.4, 0.5, 2.1);
/** Scene units a second that a passing blast front adds to the astronaut's speed, away from the explosion. */
const EVA_SHOVE = 3;
/** Camera distance of the close view of a body with a radius of 2 scene units; of another, in proportion to its radius. */
const CLOSE_DIST = 21;
/** Share of their glow that a burst's fronts lose in the close view, so that the bodies show through them. */
const BURST_CLOSE_THIN = 0.7;
/**
 * How much of the explosion's own light is drawn, with the "reduce flashes" setting off and on. `glare`: the
 * soft glow that spreads from the explosion over the view (at full strength it whites out a close view);
 * `light`: the fireball, and the light of the flash on the bodies. The fronts are not light of this kind
 * and keep their brightness: they are what the dimming is for.
 */
const FLASH_DIM: Record<'usual' | 'reduced', { glare: number; light: number }> = {
  usual: { glare: 0.1, light: 0.35 },
  reduced: { glare: 0.05, light: 0.2 },
};
/** Seconds after the last arrival over which the fronts fade out. */
const FRONT_FADE_SEC = 5;
/**
 * A front drawn on the map: the most corners along it, its height above the plane of the map (scene units),
 * the width of its line as a share of the camera's distance, and the most that the veil behind the line of
 * a blast or a burst reaches back on the map (scene units), so that it never lies over the whole system.
 */
const FRONT_POINTS = 900;
const FRONT_LIFT = 0.06;
const FRONT_LINE_WIDTH = 0.006;
const FRONT_VEIL_REACH = 2.5;

/** Map radius that takes in the outermost ring and its label. */
const MAP_RADIUS = labSunRadius(LAB_MAX_AU) + 2.5;
/** Map radius that takes in every planet out to Neptune, which is never farther than 30.4 AU from the Sun. */
const PLANETS_RADIUS = labSunRadius(30.4) + 2;
/** Radius of the Sun's token, scene units. */
const SUN_TOKEN_R = 0.85;
/** Height of a name tag, as a share of the view's focal length. */
const TAG_HEIGHT = 0.026;
/** A name tag reaches this many pixels into its body's token: its text sits in the middle of the tag. */
const TAG_TUCK = 3;
/** Pixels between a body's token and a name that stands to its right or left. */
const TAG_SIDE_GAP = 4;
/**
 * Where a name can stand by its body, in the order tried, and which way each lies from the body across and
 * down the screen (−1, 0 or 1).
 */
type TagSide = 'above' | 'below' | 'right' | 'left' | 'aboveRight' | 'aboveLeft' | 'belowRight' | 'belowLeft';
const TAG_SIDES: TagSide[] = ['above', 'below', 'right', 'left', 'aboveRight', 'aboveLeft', 'belowRight', 'belowLeft'];
const TAG_OFFSETS: Record<TagSide, { across: number; down: number }> = {
  above: { across: 0, down: -1 },
  below: { across: 0, down: 1 },
  right: { across: 1, down: 0 },
  left: { across: -1, down: 0 },
  aboveRight: { across: 1, down: -1 },
  aboveLeft: { across: -1, down: -1 },
  belowRight: { across: 1, down: 1 },
  belowLeft: { across: -1, down: 1 },
};
/** Places a ring label tries, radians along its ring from the side facing the camera: the middle first. */
const RING_LABEL_TURNS = [0, 0.2, -0.2, 0.4, -0.4, 0.6, -0.6];

const RING_GREY = 0x7b8aa0;
const RING_HAZARD = 0xf87171;
/** The far rings of the map, round the Sun. `hazard`: the kinds of explosion whose hazard limit the ring is, and its label then. */
const RINGS: Array<{ au: number; label: L10n; color: number; hazard?: { kinds: LabExplosionKind[]; label: L10n } }> = [
  { au: LY_AU, label: { tr: '1 ışık yılı', en: '1 light year' }, color: RING_GREY },
  {
    au: 26 * LY_AU, label: { tr: '26 ışık yılı', en: '26 light years' }, color: RING_GREY,
    hazard: { kinds: ['sn2', 'sn1a'], label: { tr: '26 ışık yılı · tehlike sınırı', en: '26 light years · hazard limit' } },
  },
  { au: 550 * LY_AU, label: { tr: '550 ışık yılı', en: '550 light years' }, color: RING_GREY },
  {
    au: 6500 * LY_AU, label: { tr: '6.500 ışık yılı', en: '6,500 light years' }, color: RING_GREY,
    hazard: { kinds: ['grb'], label: { tr: '6.500 ışık yılı · tehlike sınırı', en: '6,500 light years · hazard limit' } },
  },
];

type TokenId = 'moon' | 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'europa' | 'titan' | 'pluto';
/** A body whose place around Earth the astronomy gives; the Sun is not a token. */
type PlaceId = Exclude<GeocentricBody, 'sun'>;

/** The Moon, a planet, a moon of another planet or Pluto as a map token. */
interface TokenDef {
  id: TokenId;
  name: L10n;
  /** Radius in scene units (Earth is 2; nothing is to scale), and how far the token reaches from its centre in radii (Saturn's rings). */
  radius: number;
  reach: number;
  /** Colour used until the body's map has loaded (Venus and Titan have none: they show their cloud decks). */
  color: number;
  /** The smallest radius in pixels it is drawn at, however far out the view is. */
  minPx: number;
  /** Tilt of its axis to its orbit, degrees: it sets how the globe and Saturn's rings lean on the map. */
  tiltDeg: number;
  /** A giant of gas or ice: nothing solid to melt or to break into chunks. */
  giant: boolean;
  /** Its ground is ice: molten, it turns to steam instead of glowing, and it breaks into pale chunks. */
  icy: boolean;
  /** Colour of the gas a blast tears off it: its air, or a giant's upper layers. Null where there is none. */
  gas: number | null;
  /** What is seen of it is a deck of clouds, which goes when its air does. */
  cloudDeck: boolean;
  /** Whose place in space it has: its own, or for a moon of another planet that planet's, beside whose token it stands. */
  place: PlaceId;
  host: TokenId | null;
}

const TOKENS: TokenDef[] = [
  { id: 'moon', name: { tr: 'Ay', en: 'Moon' }, radius: 0.2, reach: 1, color: 0x9ca3af, minPx: 3.2, tiltDeg: 0, giant: false, icy: false, gas: null, cloudDeck: false, place: 'moon', host: null },
  { id: 'mercury', name: BODY_NAMES.mercury, radius: 0.36, reach: 1, color: 0x8f8a84, minPx: 5, tiltDeg: 0, giant: false, icy: false, gas: null, cloudDeck: false, place: 'mercury', host: null },
  { id: 'venus', name: BODY_NAMES.venus, radius: 0.56, reach: 1, color: 0xe3cf9e, minPx: 6, tiltDeg: 3, giant: false, icy: false, gas: 0xf2dfa8, cloudDeck: true, place: 'venus', host: null },
  { id: 'mars', name: BODY_NAMES.mars, radius: 0.46, reach: 1, color: 0xb9603a, minPx: 5.5, tiltDeg: 25.2, giant: false, icy: false, gas: 0xe8a27a, cloudDeck: false, place: 'mars', host: null },
  { id: 'jupiter', name: BODY_NAMES.jupiter, radius: 1.05, reach: 1, color: 0xc7a781, minPx: 9, tiltDeg: 3.1, giant: true, icy: false, gas: 0xe6c9a0, cloudDeck: false, place: 'jupiter', host: null },
  { id: 'saturn', name: BODY_NAMES.saturn, radius: 0.9, reach: 1.8, color: 0xd9c595, minPx: 8, tiltDeg: 26.7, giant: true, icy: false, gas: 0xecd9a8, cloudDeck: false, place: 'saturn', host: null },
  { id: 'uranus', name: BODY_NAMES.uranus, radius: 0.64, reach: 1, color: 0xa6dde2, minPx: 6.5, tiltDeg: 82.2, giant: true, icy: false, gas: 0xb8eef2, cloudDeck: false, place: 'uranus', host: null },
  { id: 'neptune', name: BODY_NAMES.neptune, radius: 0.62, reach: 1, color: 0x4a6fd6, minPx: 6.5, tiltDeg: 28.3, giant: true, icy: false, gas: 0x7fa0ff, cloudDeck: false, place: 'neptune', host: null },
  // Off the map until they are added. A moon is listed after the planet it goes round.
  { id: 'europa', name: { tr: 'Europa', en: 'Europa' }, radius: 0.24, reach: 1, color: 0xcfc8bb, minPx: 3.4, tiltDeg: 0, giant: false, icy: true, gas: null, cloudDeck: false, place: 'jupiter', host: 'jupiter' },
  { id: 'titan', name: { tr: 'Titan', en: 'Titan' }, radius: 0.32, reach: 1, color: 0xd9a548, minPx: 3.6, tiltDeg: 0, giant: false, icy: true, gas: 0xe8b860, cloudDeck: true, place: 'saturn', host: 'saturn' },
  { id: 'pluto', name: { tr: 'Plüton', en: 'Pluto' }, radius: 0.28, reach: 1, color: 0xc9b29b, minPx: 4, tiltDeg: 57, giant: false, icy: true, gas: null, cloudDeck: false, place: 'pluto', host: null },
];

/** Colour of the ring round a body, by how badly it fares. */
const LEVEL_COLOUR: Record<LabImpactLevel, number> = { safe: 0x6ee7a8, caution: 0xfbbf24, danger: 0xfb923c, extreme: 0xf87171 };
/** A body the explosion does nothing to: one that is off the map, or the Sun when it is itself what erupts. */
const UNTOUCHED: LabFateOutcome = { flash: 0, scorch: 0, air: 0, melt: 0, breakup: 0, kick: 0, storm: 0 };

/**
 * What a blast tears off a body: its air (or a giant's upper layers) streaming away in a tail, and the body
 * itself coming apart into molten chunks and incandescent dust. Lengths are in radii of the body: the group
 * is scaled to it.
 */
interface Wreckage {
  group: THREE.Group;
  /** Sets every grain and chunk out again for a blast that passes the body in direction `away` (unit vector). */
  seed(away: THREE.Vector3): void;
  /**
   * `airLost`: share of the air gone, 0..1; `sinceShock`, `sinceBreakup`: seconds since the blast arrived and
   * since the body began to come apart (negative: not yet); `radius`: the body's radius now, scene units.
   */
  update(airLost: number, sinceShock: number, sinceBreakup: number, radius: number): void;
  dispose(): void;
}

/** What the close view has to know of the body it goes to. */
interface FocusBody {
  /** Where it is now and where it stood before the blast, and the way the blast passes it (unit vector). */
  at: THREE.Vector3;
  home: THREE.Vector3;
  away: THREE.Vector3;
  /** Its radius on the map, scene units, and how far the blast has carried it. */
  radius: number;
  push: number;
  /** Seconds since the blast reached it (negative: not yet), and how hard that shakes the view. */
  since: number;
  jolt: number;
}

/** A body other than Earth: what is to become of it, what the blast tears off it, and the ring that shows how it fares. */
interface Affected extends FocusBody {
  id: string;
  fate: LabFate | null;
  wreck: Wreckage;
  mark: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

/** The Moon or a planet on the map. */
interface Token extends Affected {
  def: TokenDef;
  holder: THREE.Group;
  globe: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /** Saturn's rings. */
  ring: THREE.Mesh | null;
  tag: NameTag;
  /** False once it has been taken off the map. */
  onMap: boolean;
}

/** A group of spacecraft drawn near Earth in the picture of the magnetosphere. */
interface SatMark {
  id: LabSatellite['id'];
  label: L10n;
  /** Distance from Earth's centre, Earth radii. */
  orbitRe: number;
  /** Tilt of the orbit to the plane of the magnetic equator in the picture, radians, and the craft drawn on it. */
  tiltRad: number;
  craft: number;
  /** Where its name is tied, on the orbit taken as a unit circle in its own plane. */
  tagAt: THREE.Vector3;
}

const SAT_MARKS: SatMark[] = [
  { id: 'l1', label: { tr: 'L1 gözcüleri', en: 'L1 sentinels' }, orbitRe: 235, tiltRad: 0, craft: 1, tagAt: new THREE.Vector3(1, 0, 0) },
  { id: 'geo', label: { tr: 'Yer sabit uydular', en: 'Geostationary satellites' }, orbitRe: 6.62, tiltRad: 0, craft: 5, tagAt: new THREE.Vector3(0, 0, 1) },
  { id: 'gps', label: { tr: 'GPS', en: 'GPS' }, orbitRe: 4.17, tiltRad: 0.96, craft: 5, tagAt: new THREE.Vector3(0, 0, -1) },
  { id: 'iss', label: { tr: 'Uzay İstasyonu', en: 'Space Station' }, orbitRe: 1.07, tiltRad: 0.9, craft: 1, tagAt: new THREE.Vector3(-0.7, 0, 0.7) },
];
/** Where the L1 sentinels are drawn, scene units sunward of Earth's centre: just outside the picture of the magnetosphere. */
const L1_MARK_RADIUS = 5.3;
/** Colour of a spacecraft by where the squeezed magnetosphere leaves it. */
const SAT_COLOUR: Record<LabSatellite['state'], number> = { inside: 0x67e8f9, edge: 0xfbbf24, outside: 0xf87171 };

interface SatMarker {
  def: SatMark;
  holder: THREE.Group;
  craft: THREE.Points;
  line: THREE.LineBasicMaterial;
  dots: THREE.PointsMaterial;
  state: LabSatellite['state'];
  /** False when the model has nothing to say of it (the L1 sentinels, with the Sun moved to inside their orbit). */
  present: boolean;
  tag: NameTag;
  at: THREE.Vector3;
}

/** Stars that mark the far rings: the distance the lab uses for each, light years, and the star's colour. */
const LANDMARK_STARS: Array<{ id: string; lightYears: number; color: number }> = [
  { id: 'alpha_cen', lightYears: 4.37, color: 0xfff0cf },
  { id: 'sirius', lightYears: 8.6, color: 0xcfe1ff },
  { id: 'betelgeuse', lightYears: 550, color: 0xff8648 },
];
const CRAB_LIGHT_YEARS = 6500;

/**
 * A star or nebula that marks a far ring: its place in the sky (ecliptic longitude and latitude, J2000
 * degrees), the distance the lab uses for it, light years, and its colour.
 */
interface Landmark {
  id: string;
  name: L10n;
  kind: 'star' | 'nebula';
  lonDeg: number;
  latDeg: number;
  lightYears: number;
  color: number;
}
const CRAB = TRANSIENTS.find((t) => t.id === 'sn1054');
const LANDMARKS: Landmark[] = [
  ...LANDMARK_STARS.flatMap((s) => {
    const star = BRIGHT_STARS.find((b) => b.id === s.id);
    return star ? [{ id: s.id, name: star.name, kind: 'star' as const, ...eclipticOfRaDec(star.raDeg, star.decDeg), lightYears: s.lightYears, color: s.color }] : [];
  }),
  ...(CRAB && CRAB.kind === 'supernova'
    ? [{ id: 'crab', name: { tr: 'Yengeç Bulutsusu', en: 'Crab Nebula' }, kind: 'nebula' as const, ...eclipticOfRaDec(CRAB.raDeg, CRAB.decDeg), lightYears: CRAB_LIGHT_YEARS, color: 0xffa64d }]
    : []),
];

/**
 * Ecliptic latitude, degrees, of a star or nebula of the map. The map lies in the plane of the planets and
 * shows such a body at its longitude only: its real direction in the sky is that longitude with this
 * latitude. 0 for every other body, and for none.
 */
export function labLandmarkLatitudeDeg(bodyId: string | null): number {
  return LANDMARKS.find((mark) => mark.id === bodyId)?.latDeg ?? 0;
}

/** What the name tag at the explosion says. A solar eruption comes from the Sun itself. */
const KIND_TAG: Record<LabExplosionKind, L10n> = {
  sn2: { tr: 'Tip II süpernova', en: 'Type II supernova' },
  sn1a: { tr: 'Tip Ia süpernova', en: 'Type Ia supernova' },
  grb: { tr: 'Gama ışını patlaması', en: 'Gamma-ray burst' },
  cme: { tr: 'Güneş', en: 'Sun' },
};

interface LabelItem {
  sprite: THREE.Sprite;
  label: L10n;
  /** Text centred on the sprite (name tags) instead of starting at its left edge (ring labels). */
  centered: boolean;
  /** Share of the sprite's width that the text takes; known once the label has been drawn. */
  widthShare: number;
}

/**
 * The name of a body on the map. Each frame says where the body is on the screen and how big (pixels), and how
 * visible its name should be; the names are then set out so that none is written over a body or over another
 * name.
 */
interface NameTag extends LabelItem {
  at: THREE.Vector3;
  x: number;
  y: number;
  radiusPx: number;
  show: number;
  /** The side of its body the name stands on, and whether it stands a tag's height farther out than usual (1) or not (0). */
  side: TagSide;
  lift: number;
  /** The name is on the screen this frame, in the box that follows (pixels). */
  written: boolean;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface KindLook {
  /** Hot and cool colours of the fireball and the ejecta. */
  hot: THREE.Color;
  cool: THREE.Color;
  /** Colour of the light it casts on Earth. */
  light: THREE.Color;
  starA: THREE.Color;
  starB: THREE.Color;
  starRadius: number;
}

const LOOK: Record<LabExplosionKind, KindLook> = {
  // Core collapse of a red supergiant: hydrogen-rich ejecta glow red, oxygen knots blue-green.
  sn2: {
    hot: new THREE.Color(0.55, 0.95, 1.0), cool: new THREE.Color(1.0, 0.28, 0.14), light: new THREE.Color(1.0, 0.9, 0.82),
    starA: new THREE.Color(1.6, 0.42, 0.12), starB: new THREE.Color(2.2, 0.95, 0.35), starRadius: 1.25,
  },
  // Thermonuclear explosion of a white dwarf: brighter and bluer, no hydrogen.
  sn1a: {
    hot: new THREE.Color(0.75, 0.88, 1.0), cool: new THREE.Color(1.0, 0.62, 0.25), light: new THREE.Color(0.86, 0.92, 1.0),
    starA: new THREE.Color(1.4, 1.7, 2.4), starB: new THREE.Color(2.4, 2.4, 2.6), starRadius: 0.34,
  },
  // Collapse of a massive, fast-spinning star stripped of its hydrogen: a blue-white star, violet rays.
  grb: {
    hot: new THREE.Color(0.85, 0.9, 1.0), cool: new THREE.Color(0.62, 0.42, 1.0), light: new THREE.Color(0.82, 0.86, 1.0),
    starA: new THREE.Color(1.1, 1.4, 2.4), starB: new THREE.Color(2.2, 2.4, 2.9), starRadius: 0.7,
  },
  cme: {
    hot: new THREE.Color(1.0, 0.86, 0.45), cool: new THREE.Color(1.0, 0.42, 0.12), light: new THREE.Color(1.0, 0.8, 0.5),
    starA: new THREE.Color(2.0, 1.25, 0.45), starB: new THREE.Color(2.6, 2.1, 1.1), starRadius: SUN_TOKEN_R / BLAST_SCALE,
  },
};

const NOISE_GLSL = /* glsl */ `
  float h3(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }
  float n3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(h3(i), h3(i + vec3(1.0, 0.0, 0.0)), u.x), mix(h3(i + vec3(0.0, 1.0, 0.0)), h3(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
      mix(mix(h3(i + vec3(0.0, 0.0, 1.0)), h3(i + vec3(1.0, 0.0, 1.0)), u.x), mix(h3(i + vec3(0.0, 1.0, 1.0)), h3(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
      u.z
    );
  }
  float fbm3(vec3 p) {
    float s = 0.0;
    float a = 0.5;
    for (int k = 0; k < 5; k++) { s += a * n3(p); p *= 2.07; a *= 0.5; }
    return s;
  }
`;

/** Shared vertex stage: object-space direction, world normal and world position. */
const SHELL_VERT = /* glsl */ `
  varying vec3 vDir;
  varying vec3 vWorldN;
  varying vec3 vWorldPos;
  void main() {
    vDir = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

/** Chunks of a body that has come apart. Per chunk, in its instance colour: how hot it still is (red) and a number of its own (green). */
const CHUNK_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vObj;
  varying vec2 vHeat;
  void main() {
    vObj = position;
    vHeat = instanceColor.rg;
    mat4 m = modelMatrix * instanceMatrix;
    vN = normalize(mat3(m) * normal);
    gl_Position = projectionMatrix * viewMatrix * m * vec4(position, 1.0);
  }
`;
const CHUNK_FRAG = /* glsl */ `
  ${NOISE_GLSL}
  uniform vec3 uLightDir;
  uniform vec3 uLightCol;
  uniform float uIcy;
  varying vec3 vN;
  varying vec3 vObj;
  varying vec2 vHeat;
  void main() {
    vec3 N = normalize(vN);
    float grain = fbm3(vObj * 1.9 + vHeat.y * 31.0);
    vec3 rock = mix(vec3(0.21, 0.15, 0.12), vec3(0.62, 0.68, 0.74), uIcy) * (0.55 + 0.9 * grain);
    float lit = 0.1 + 0.9 * max(dot(N, uLightDir), 0.0);
    // Molten where it was torn from the interior; the glow retreats into the cracks as it cools. Ice does not glow.
    float cracks = 1.0 - abs(grain * 2.0 - 1.0);
    float heat = clamp(vHeat.x * 1.8 - (1.0 - cracks) * 0.9, 0.0, 1.0) * (1.0 - uIcy);
    vec3 glow = mix(vec3(0.9, 0.12, 0.02), vec3(1.6, 0.8, 0.25), heat) * (0.3 + 1.0 * heat) * heat;
    gl_FragColor = vec4(rock * lit * uLightCol + glow, 1.0);
  }
`;

function labelTexture(text: string, centered: boolean): { map: THREE.CanvasTexture; widthShare: number } {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 64;
  const ctx = c.getContext('2d');
  let widthShare = 1;
  if (ctx) {
    // Long names (some languages) are set smaller rather than cut off at the edges.
    ctx.font = '600 30px "Exo 2 Variable", system-ui, sans-serif';
    const size = Math.min(30, Math.floor((30 * (c.width - 20)) / Math.max(1, ctx.measureText(text).width)));
    ctx.font = `600 ${size}px "Exo 2 Variable", system-ui, sans-serif`;
    widthShare = Math.min(1, (ctx.measureText(text).width + 12) / c.width);
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = centered ? 'center' : 'left';
    ctx.fillText(text, centered ? c.width / 2 : 6, 34);
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, widthShare };
}

/** A faceted boulder: an icosphere with every corner pulled in or pushed out. */
function rockGeometry(): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(1, 1);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  // Corners shared between faces have to move together.
  const welded = mergeVertices(ico, 1e-3);
  const pos = welded.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const k = 0.7 + 0.55 * Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  const rock = welded.toNonIndexed();
  rock.computeVertexNormals();
  ico.dispose();
  welded.dispose();
  return rock;
}

export interface LabController extends ISpaceView {
  /**
   * Sets the map to one moment: the planets go to their places round the Sun at `jdTT`, the Moon to its
   * place round Earth. Returns everything the map can show with its direction and distance from Earth,
   * nearest first.
   */
  layoutFor(jdTT: number): LabBody[];
  /**
   * What explodes and where. `keepView` leaves the camera where it is (a place picked on the map is already
   * in view).
   */
  configure(setup: LabSetup, keepView: boolean): void;
  /**
   * What the explosion now set does: to Earth, to the Moon, the Sun and the other bodies on the map, and
   * the clock of its time-lapse. Call it after every `configure`.
   */
  setResults(results: LabResults): void;
  detonate(): void;
  resetExplosion(): void;
  /** Halts the time-lapse where it is, or lets it run on. */
  setPaused(paused: boolean): void;
  /** Puts the time-lapse at a moment, seconds after detonation. */
  seek(elapsedSec: number): void;
  /**
   * Seconds since detonation (0 when idle): never more than the run's length (`labRunSeconds` of the results
   * last set), where the time-lapse stops and holds its picture until `resetExplosion` or `detonate`.
   */
  elapsedSec(): number;
  setEvaMode(on: boolean): void;
  setEvaKeys(moveX: number, moveZ: number, moveY: number, boost: boolean): void;
  /**
   * Called when the map is clicked while no run is under way: the direction and distance of the clicked
   * place, and the id of the body of the map it was taken from (null for a place on the map itself).
   */
  onPlace(cb: (angleRad: number, distanceAU: number, bodyId: string | null) => void): void;
  /**
   * Called when a click on the map is ignored because a run is under way (from detonation until the
   * explosion is reset, the held final picture included): once for each such click, never for a drag.
   */
  onLockedClick(cb: () => void): void;
  /** Shows the whole orbit of the explosion, the whole map, or the body in focus up close; the view then stays as chosen. */
  setFraming(framing: LabFraming): void;
  /**
   * Puts another body in focus: 'earth', 'sun', the id of a token, or 'satellites' (which are seen at Earth).
   * `goClose` takes the camera close to it; otherwise the view keeps its framing.
   */
  setFocus(bodyId: string, goClose: boolean): void;
  /** The ids of the bodies that are off the map. */
  setRemoved(ids: string[]): void;
  /** Hides the rings that show how each body fares (the class mode asks for a prediction first). */
  setConcealed(on: boolean): void;
  /** Width in pixels that panels cover at the left and right of the screen; the map is framed between them. */
  setInsets(leftPx: number, rightPx: number): void;
  setLang(lang: Lang): void;
  /** The "reduce flashes" setting: the explosion's light, shown dimmed as it is, is dimmed further, and nothing flickers. */
  setReducedFlash(on: boolean): void;
}

export function createLabView(renderer: THREE.WebGLRenderer): LabController {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 1500);
  const texLoader = new THREE.TextureLoader();
  const sprite = softDotTexture();
  let seed = 313;
  const rand = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const randomDir = (out: THREE.Vector3): THREE.Vector3 => {
    const u = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    return out.set(s * Math.cos(a), u, s * Math.sin(a));
  };
  const tmp = new THREE.Vector3();

  // ───────────── backdrop: stars and the logarithmic distance map ─────────────
  const starCount = 2200;
  const sPos = new Float32Array(starCount * 3);
  const sCol = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    randomDir(tmp).multiplyScalar(520 + rand() * 120);
    sPos.set([tmp.x, tmp.y, tmp.z], i * 3);
    const b = 0.2 + 0.8 * rand() ** 2.5;
    const warm = rand();
    sCol.set([b * (0.85 + 0.15 * warm), b * 0.92, b * (1.05 - 0.2 * warm)], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
  const starMat = new THREE.PointsMaterial({ size: 1.3, vertexColors: true, transparent: true, opacity: 0.8, sizeAttenuation: false });
  const starPoints = new THREE.Points(starGeo, starMat);
  scene.add(starPoints);

  // The real sky behind the map, turned so that the map's plane is the ecliptic: the Milky Way and the
  // constellations lie in the directions of the stars marked on the far rings. It replaces the scattered
  // points once its map has loaded.
  const skyUniforms = { uStars: { value: new THREE.Texture() }, uGain: { value: 0.6 } };
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uStars;
      uniform float uGain;
      varying vec3 vDir;
      const float PI = 3.141592653589793;
      void main() {
        vec3 d = normalize(vDir);
        // Map axes (x: ecliptic longitude 0, y: north, z: longitude 270°) → ecliptic → equatorial J2000.
        vec3 e = vec3(d.x, -d.z, d.y);
        vec3 q = vec3(e.x, e.y * 0.9174821 - e.z * 0.3977772, e.y * 0.3977772 + e.z * 0.9174821);
        // SVS Deep Star Maps: right ascension 0h at the middle of the picture, increasing to the left.
        vec2 uv = vec2(fract(0.5 - atan(q.y, q.x) / (2.0 * PI)), 0.5 + asin(clamp(q.z, -1.0, 1.0)) / PI);
        gl_FragColor = vec4(textureLod(uStars, uv, 0.0).rgb * uGain, 1.0);
      }
    `,
  });
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 32), skyMat);
  skyDome.frustumCulled = false;
  skyDome.renderOrder = -10;
  skyDome.visible = false;
  scene.add(skyDome);

  const ringGeos: THREE.BufferGeometry[] = [];
  const labelSprites: LabelItem[] = [];
  /**
   * Ring labels ride on the side of their ring that faces the camera, where they are clear of the panels;
   * `turn` is how far along the ring (radians) a label has stepped to get out of the way of a body.
   */
  const ringLabels: Array<{ item: LabelItem; radius: number; turn: number }> = [];
  /** Per ring of RINGS: its line and its label, which change when the ring is a hazard limit. */
  const ringLooks: Array<{ line: THREE.LineBasicMaterial; item: LabelItem }> = [];
  for (const ring of RINGS) {
    const r = labSunRadius(ring.au);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    ringGeos.push(geo);
    const line = new THREE.LineBasicMaterial({ color: ring.color, transparent: true, opacity: 0.3 });
    scene.add(new THREE.LineLoop(geo, line));
    const label = new THREE.Sprite(new THREE.SpriteMaterial({
      color: ring.color, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, sizeAttenuation: false,
    }));
    label.center.set(0.5, 1.05);
    label.scale.set(0.26, 0.026, 1);
    label.position.set(0, 0.05, r);
    label.renderOrder = 20;
    scene.add(label);
    const item: LabelItem = { sprite: label, label: ring.label, centered: true, widthShare: 1 };
    labelSprites.push(item);
    ringLabels.push({ item, radius: r, turn: 0 });
    ringLooks.push({ line, item });
  }

  let labelLang: Lang = 'tr';
  function drawLabel(item: LabelItem): void {
    const mat = item.sprite.material;
    const drawn = labelTexture(loc(item.label, labelLang), item.centered);
    mat.map?.dispose();
    mat.map = drawn.map;
    mat.needsUpdate = true;
    item.widthShare = drawn.widthShare;
  }

  /**
   * Gives every ring its look: the hazard limit of the kind of explosion now set is red and says so. Not
   * while the class mode waits for a prediction: the mark would give the answer away.
   */
  function styleRings(): void {
    RINGS.forEach((ring, i) => {
      const { line, item } = ringLooks[i];
      const limit = !concealed && ring.hazard?.kinds.includes(setup.kind) ? ring.hazard : undefined;
      const color = limit ? RING_HAZARD : ring.color;
      line.color.setHex(color);
      line.opacity = color === RING_GREY ? 0.3 : 0.5;
      item.sprite.material.color.setHex(color === RING_GREY ? 0xb8c4d6 : color);
      const label = limit?.label ?? ring.label;
      if (item.label !== label) {
        item.label = label;
        drawLabel(item);
      }
    });
  }

  function setLabels(lang: Lang): void {
    labelLang = lang;
    for (const item of labelSprites) drawLabel(item);
  }

  // Name tags of the bodies, in order of precedence: seen from far out most bodies are only a few pixels wide.
  const nameTags: NameTag[] = [];
  const makeTag = (color: number, label: L10n): NameTag => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      color, transparent: true, opacity: 0, depthTest: false, depthWrite: false, sizeAttenuation: false,
    }));
    sprite.scale.set(TAG_HEIGHT * 10, TAG_HEIGHT, 1);
    sprite.renderOrder = 21;
    scene.add(sprite);
    const tag: NameTag = {
      sprite, label, centered: true, widthShare: 1,
      at: new THREE.Vector3(), x: 0, y: 0, radiusPx: 0, show: 0, side: 'above', lift: 0, written: false, left: 0, right: 0, top: 0, bottom: 0,
    };
    labelSprites.push(tag);
    nameTags.push(tag);
    return tag;
  };

  /**
   * Puts a name's box on one side of its body: above or below it, tucked a little into the token; beside it;
   * or at one of its corners, where the token's edge is 0.7 of its radius away along each axis. `lift` moves
   * it that many tag heights (and a third) farther out. The text sits in the middle of a tag `tagH` pixels high.
   */
  function setNameBox(tag: NameTag, side: TagSide, lift: number, tagH: number): void {
    const halfW = tag.widthShare * tagH * 5;
    const { across, down } = TAG_OFFSETS[side];
    const reach = tag.radiusPx * (across !== 0 && down !== 0 ? 0.7 : 1) + lift * tagH * 1.3;
    const midX = tag.x + across * (reach + TAG_SIDE_GAP + halfW);
    const midY = tag.y + down * (reach + tagH * 0.5 - (across === 0 ? TAG_TUCK : 0));
    tag.left = midX - halfW;
    tag.right = midX + halfW;
    tag.top = midY - tagH * 0.3;
    tag.bottom = midY + tagH * 0.3;
  }

  /** What a name's box lies over: 2 for a name of higher precedence, 1 for a body, 0 for nothing. */
  function nameClash(index: number): number {
    const tag = nameTags[index];
    let clash = 0;
    for (let j = 0; j < nameTags.length; j++) {
      if (j === index) continue;
      const other = nameTags[j];
      if (j < index && other.written && tag.left < other.right && tag.right > other.left && tag.top < other.bottom && tag.bottom > other.top) return 2;
      const dx = other.x - THREE.MathUtils.clamp(other.x, tag.left, tag.right);
      const dy = other.y - THREE.MathUtils.clamp(other.y, tag.top, tag.bottom);
      if (dx * dx + dy * dy < other.radiusPx * other.radiusPx) clash = 1;
    }
    return clash;
  }
  const earthTag = makeTag(0x7dd3fc, { tr: 'Dünya', en: 'Earth' });
  const blastTag = makeTag(0xffd9a0, KIND_TAG.sn2);
  /** The name of the ring that marks where Earth stood before the blast carried it off. */
  const originTag = makeTag(0x67e8f9, { tr: 'Dünya’nın ilk konumu', en: 'Where Earth started' });

  // ───────────── the Sun, Earth and the Moon ─────────────
  const starVert = /* glsl */ `
    varying vec3 vPos;
    varying vec3 vWorldN;
    varying vec3 vWorldPos;
    void main() {
      vPos = position;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vWorldN = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;
  const starFrag = /* glsl */ `
    ${NOISE_GLSL}
    uniform vec3 uColA;
    uniform vec3 uColB;
    uniform float uTime;
    uniform float uGain;
    uniform float uHeat;
    uniform vec3 uHeatDir;
    varying vec3 vPos;
    varying vec3 vWorldN;
    varying vec3 vWorldPos;
    void main() {
      vec3 V = normalize(cameraPosition - vWorldPos);
      vec3 N = normalize(vWorldN);
      float mu = clamp(dot(N, V), 0.0, 1.0);
      float cells = fbm3(normalize(vPos) * 5.0 + vec3(0.0, uTime * 0.07, 0.0));
      vec3 col = mix(uColA, uColB, smoothstep(0.3, 0.75, cells)) * (0.4 + 0.6 * sqrt(mu));
      // Heated from one side: that side turns brighter and whiter.
      col = mix(col, vec3(2.6, 2.7, 3.0), uHeat * max(dot(N, uHeatDir), 0.0));
      gl_FragColor = vec4(col * uGain, 1.0);
    }
  `;
  /** A star's surface. `uHeat`, `uHeatDir`: how far (0..1) and from which side an explosion's light overheats it. */
  const makeStarMaterial = (a: THREE.Color, b: THREE.Color): THREE.ShaderMaterial => new THREE.ShaderMaterial({
    uniforms: {
      uColA: { value: a.clone() }, uColB: { value: b.clone() }, uTime: { value: 0 }, uGain: { value: 1 },
      uHeat: { value: 0 }, uHeatDir: { value: new THREE.Vector3(1, 0, 0) },
    },
    vertexShader: starVert,
    fragmentShader: starFrag,
  });
  const unitSphere = new THREE.SphereGeometry(1, 48, 32);
  const glowMaterial = (color: THREE.Color, opacity: number): THREE.SpriteMaterial => new THREE.SpriteMaterial({
    map: sprite, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  /** Additive grains at most `maxPx` wide however close they pass, so a cloud never turns into a wall of discs. */
  const grainMaterials: Array<{ mat: THREE.ShaderMaterial; maxPx: number }> = [];
  const grainMaterial = (tint: THREE.Color, size: number, maxPx: number, perGrainColour: boolean): THREE.ShaderMaterial => {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: sprite }, uTint: { value: tint }, uOpacity: { value: 0 }, uSize: { value: size },
        uScale: { value: 400 }, uMaxPx: { value: maxPx },
      },
      vertexColors: perGrainColour,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform vec3 uTint;
        uniform float uSize;
        uniform float uScale;
        uniform float uMaxPx;
        varying vec3 vCol;
        void main() {
          vCol = uTint;
          #ifdef USE_COLOR
            vCol *= color;
          #endif
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(uSize * uScale / max(0.1, -mv.z), 1.0, uMaxPx);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uOpacity;
        varying vec3 vCol;
        void main() {
          gl_FragColor = vec4(vCol * texture2D(uMap, gl_PointCoord).a * uOpacity, 1.0);
        }
      `,
    });
    grainMaterials.push({ mat, maxPx });
    return mat;
  };
  function sizeGrains(viewHeightPx: number): void {
    const pr = renderer.getPixelRatio();
    for (const g of grainMaterials) {
      g.mat.uniforms.uScale.value = (viewHeightPx * pr) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      g.mat.uniforms.uMaxPx.value = g.maxPx * pr;
    }
  }

  // ───────────── what a blast tears off a body ─────────────
  /** Colour of the explosion's light, on everything it falls on. */
  const blastCol = { value: new THREE.Color(1, 1, 1) };
  const debrisGeo = rockGeometry();
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const scaleV = new THREE.Vector3();
  const axisV = new THREE.Vector3();
  const chunkColor = new THREE.Color();

  /**
   * Makes the wreckage of one body. `counts`: grains of air, chunks (none for a body of gas) and grains of
   * dust; `airTint`, `dustTint`: their colours; `maxPx`: the largest a grain is drawn; `icy`: the chunks are
   * of ice, pale and without glow.
   */
  function createWreckage(counts: { air: number; chunks: number; dust: number }, airTint: THREE.Color, dustTint: THREE.Color, maxPx: number, icy: boolean): Wreckage {
    const group = new THREE.Group();
    const airStart = new Float32Array(counts.air * 3);
    const airVel = new Float32Array(counts.air * 3);
    const airPhase = new Float32Array(counts.air);
    const airPos = new Float32Array(counts.air * 3);
    const airGeo = new THREE.BufferGeometry();
    airGeo.setAttribute('position', new THREE.BufferAttribute(airPos, 3));
    const airMat = grainMaterial(airTint, 0.11, maxPx, false);
    const airPoints = new THREE.Points(airGeo, airMat);
    airPoints.frustumCulled = false;
    airPoints.visible = false;
    group.add(airPoints);

    // Per chunk: where it starts, the way it flies, the axis it tumbles about and its size.
    const chunkBase = new Float32Array(counts.chunks * 3);
    const chunkVel = new Float32Array(counts.chunks * 3);
    const chunkAxis = new Float32Array(counts.chunks * 3);
    const chunkSize = new Float32Array(counts.chunks);
    /** Where the explosion's light comes from: against the way the blast passes the body. */
    const lightDir = { value: new THREE.Vector3(1, 0, 0) };
    const chunkMat = new THREE.ShaderMaterial({
      uniforms: { uLightDir: lightDir, uLightCol: blastCol, uIcy: { value: icy ? 1 : 0 } },
      vertexShader: CHUNK_VERT,
      fragmentShader: CHUNK_FRAG,
    });
    const chunks = new THREE.InstancedMesh(debrisGeo, chunkMat, Math.max(1, counts.chunks));
    // Per chunk: how hot it still is (red) and a number that makes it differ from its neighbours (green).
    chunks.setColorAt(0, new THREE.Color(0, 0, 0));
    chunks.count = counts.chunks;
    chunks.frustumCulled = false;
    chunks.visible = false;
    group.add(chunks);

    const dustBase = new Float32Array(counts.dust * 3);
    const dustVel = new Float32Array(counts.dust * 3);
    const dustPos = new Float32Array(counts.dust * 3);
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dustMat = grainMaterial(dustTint, 0.1, maxPx, false);
    const dustPoints = new THREE.Points(dustGeo, dustMat);
    dustPoints.frustumCulled = false;
    dustPoints.visible = false;
    group.add(dustPoints);
    const flash = new THREE.Sprite(glowMaterial(icy ? new THREE.Color(0.75, 0.88, 1.0) : new THREE.Color(1.0, 0.8, 0.5), 0));
    flash.visible = false;
    group.add(flash);

    return {
      group,

      seed(awayDir: THREE.Vector3): void {
        lightDir.value.copy(awayDir).negate();
        for (let i = 0; i < counts.air; i++) {
          randomDir(tmp);
          airStart.set([tmp.x * 1.04, tmp.y * 1.04, tmp.z * 1.04], i * 3);
          const speed = 0.7 + rand() * 1.6;
          airVel.set([awayDir.x * speed + tmp.x * 0.35, awayDir.y * speed + tmp.y * 0.35, awayDir.z * speed + tmp.z * 0.35], i * 3);
          airPhase[i] = rand();
        }
        for (let i = 0; i < counts.chunks; i++) {
          randomDir(tmp).multiplyScalar(0.93 * Math.cbrt(rand()));
          chunkBase.set([tmp.x, tmp.y, tmp.z], i * 3);
          const out = 0.4 + rand() * 0.8;
          const along = 0.15 + rand() * 0.45;
          chunkVel.set([tmp.x * out + awayDir.x * along, tmp.y * out + awayDir.y * along, tmp.z * out + awayDir.z * along], i * 3);
          randomDir(tmp);
          chunkAxis.set([tmp.x, tmp.y, tmp.z], i * 3);
          chunkSize[i] = 0.05 + 0.18 * rand() ** 2;
        }
        for (let i = 0; i < counts.dust; i++) {
          randomDir(tmp).multiplyScalar(Math.cbrt(rand()));
          dustBase.set([tmp.x, tmp.y, tmp.z], i * 3);
          const out = 0.5 + rand() * 1.3;
          const along = 0.2 + rand() * 0.7;
          dustVel.set([tmp.x * out + awayDir.x * along, tmp.y * out + awayDir.y * along, tmp.z * out + awayDir.z * along], i * 3);
        }
      },

      update(airLost: number, sinceShock: number, sinceBreakup: number, radius: number): void {
        // Air torn off into a tail.
        const stripping = airLost > 0.01 && sinceShock < 14;
        airPoints.visible = stripping;
        if (stripping) {
          const flow = sinceShock * 0.3;
          for (let i = 0; i < counts.air; i++) {
            const life = (airPhase[i] + flow) % 1;
            airPos[i * 3] = airStart[i * 3] + airVel[i * 3] * life * 5;
            airPos[i * 3 + 1] = airStart[i * 3 + 1] + airVel[i * 3 + 1] * life * 5;
            airPos[i * 3 + 2] = airStart[i * 3 + 2] + airVel[i * 3 + 2] * life * 5;
          }
          (airGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
          airMat.uniforms.uOpacity.value = 0.6 * Math.min(1, airLost * 2) * Math.max(0, 1 - Math.max(0, sinceShock - 6) / 8);
          airMat.uniforms.uSize.value = 0.11 * radius;
        }

        // The body coming apart.
        const broken = sinceBreakup >= 0;
        chunks.visible = broken;
        dustPoints.visible = broken;
        flash.visible = broken && sinceBreakup < 4;
        if (!broken) return;
        const cooling = Math.exp(-sinceBreakup * 0.16);
        // Thrown apart at once, then coasting: the wreckage stays a cloud around where the body was.
        const spread = 3.2 * (1 - Math.exp(-sinceBreakup * 0.4)) + sinceBreakup * 0.12;
        for (let i = 0; i < counts.chunks; i++) {
          tmp.fromArray(chunkBase, i * 3).addScaledVector(axisV.fromArray(chunkVel, i * 3), spread);
          quat.setFromAxisAngle(axisV.fromArray(chunkAxis, i * 3), sinceBreakup * (0.6 + (i % 7) * 0.25));
          scaleV.setScalar(chunkSize[i]);
          chunks.setMatrixAt(i, matrix.compose(tmp, quat, scaleV));
          chunks.setColorAt(i, chunkColor.setRGB(cooling * (0.35 + 0.65 * ((i * 37) % 100) / 100), ((i * 61) % 100) / 100, 0));
        }
        chunks.instanceMatrix.needsUpdate = true;
        if (chunks.instanceColor) chunks.instanceColor.needsUpdate = true;
        for (let i = 0; i < counts.dust * 3; i++) dustPos[i] = dustBase[i] + dustVel[i] * spread * 1.25;
        (dustGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
        dustMat.uniforms.uOpacity.value = 0.85 * Math.max(0, 1 - sinceBreakup / 16);
        dustMat.uniforms.uSize.value = 0.1 * radius;
        flash.scale.setScalar(2 + 11 * Math.exp(-sinceBreakup * 1.4));
        flash.material.opacity = Math.exp(-sinceBreakup * 1.1);
      },

      dispose(): void {
        airGeo.dispose();
        dustGeo.dispose();
        chunks.dispose();
        for (const m of [airMat, dustMat, chunkMat, flash.material]) m.dispose();
      },
    };
  }

  const sunMat = makeStarMaterial(LOOK.cme.starA, LOOK.cme.starB);
  const sunMesh = new THREE.Mesh(unitSphere, sunMat);
  sunMesh.scale.setScalar(SUN_TOKEN_R);
  const sunGlow = new THREE.Sprite(glowMaterial(new THREE.Color(1, 0.7, 0.3), 0.5));
  sunGlow.scale.setScalar(4.4);
  sunMesh.add(sunGlow);
  scene.add(sunMesh);
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
  scene.add(sunLight);
  scene.add(new THREE.HemisphereLight(0xa5d8ff, 0x334155, 0.5));

  const earthGroup = new THREE.Group();
  earthGroup.scale.setScalar(EARTH_SCALE);
  scene.add(earthGroup);
  const earthUniforms = {
    uDay: { value: new THREE.Texture() },
    uNight: { value: new THREE.Texture() },
    uHasTex: { value: 0 },
    uSunDir: { value: new THREE.Vector3(-1, 0, 0) },
    uBlastDir: { value: new THREE.Vector3(1, 0, 0) },
    uBlastCol: blastCol,
    uFlash: { value: 0 },
    uScorch: { value: 0 },
    uOceans: { value: 0 },
    uCrust: { value: 0 },
    uAurora: { value: 0 },
    uAuroraLat: { value: 1.13 },
    uBlackout: { value: 0 },
    uShockGlow: { value: 0 },
    uTime: { value: 0 },
  };
  const earthMat = new THREE.ShaderMaterial({
    uniforms: earthUniforms,
    vertexShader: SHELL_VERT,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform sampler2D uDay;
      uniform sampler2D uNight;
      uniform float uHasTex;
      uniform vec3 uSunDir;
      uniform vec3 uBlastDir;
      uniform vec3 uBlastCol;
      uniform float uFlash;
      uniform float uScorch;
      uniform float uOceans;
      uniform float uCrust;
      uniform float uAurora;
      uniform float uAuroraLat;
      uniform float uBlackout;
      uniform float uShockGlow;
      uniform float uTime;
      varying vec3 vDir;
      varying vec3 vWorldN;
      varying vec3 vWorldPos;
      const float PI = 3.141592653589793;

      void main() {
        vec3 n = normalize(vDir);
        vec3 N = normalize(vWorldN);
        float lat = asin(clamp(n.y, -1.0, 1.0));
        float lon = atan(-n.z, n.x);
        vec2 uv = vec2(fract((lon + PI) / (2.0 * PI)), 0.5 + lat / PI);
        vec3 day = uHasTex > 0.5 ? texture2D(uDay, uv).rgb : vec3(0.1, 0.25, 0.5);
        vec3 night = uHasTex > 0.5 ? texture2D(uNight, uv).rgb : vec3(0.0);
        float ocean = step(day.r + 0.01, day.b) * (1.0 - smoothstep(0.08, 0.2, day.g));
        float facing = max(dot(N, uBlastDir), 0.0);

        // Oceans: steam while they boil, then the dry sea floor.
        float steam = uOceans * (1.0 - uOceans) * 4.0;
        vec3 basin = vec3(0.24, 0.17, 0.12) * (0.65 + 0.7 * fbm3(n * 6.0));
        vec3 surf = mix(day, basin, ocean * smoothstep(0.35, 1.0, uOceans));
        // Radiant heat chars the land, the side facing the explosion first.
        float burn = clamp(uScorch * (0.3 + 0.7 * facing) + uCrust * 0.6, 0.0, 1.0);
        surf = mix(surf, vec3(0.09, 0.065, 0.05), burn * 0.85);
        float cloud = fbm3(n * 3.0 + vec3(0.0, uTime * 0.05, 0.0));
        surf = mix(surf, vec3(0.9), clamp(steam * smoothstep(0.3, 0.7, cloud), 0.0, 1.0) * 0.9);

        float ndl = dot(N, uSunDir);
        vec3 col = surf * (0.05 + smoothstep(-0.08, 0.65, ndl) * 1.15);
        // The explosion lights the side facing it like a second Sun.
        col += surf * uBlastCol * facing * uFlash;

        // City lights: lost region by region as the grids fail, washed out where the explosion shines.
        float gridAlive = step(uBlackout, 0.02 + 0.98 * n3(n * 9.0));
        float nightSide = (1.0 - smoothstep(-0.1, 0.1, ndl)) * (1.0 - clamp(facing * uFlash * 2.0, 0.0, 1.0));
        col += night * vec3(1.0, 0.8, 0.55) * 0.65 * nightSide * gridAlive * (1.0 - clamp(uCrust * 3.0, 0.0, 1.0));

        // Molten crust: glowing cracks spread into a magma ocean.
        float cracks = 1.0 - abs(fbm3(n * 5.0 + 3.1) * 2.0 - 1.0);
        float heat = clamp(uCrust * 1.6 - (1.0 - cracks) * 0.9, 0.0, 1.0);
        vec3 magma = mix(vec3(0.9, 0.12, 0.02), vec3(1.7, 0.95, 0.3), heat) * (0.5 + 1.9 * heat);
        col = mix(col, col * 0.25, uCrust * 0.8) + magma * heat;
        col += vec3(1.3, 0.28, 0.05) * pow(facing, 1.5) * uScorch * uScorch;

        // Auroras: ovals whose equatorward edge moves toward the equator in strong storms (red at low latitudes).
        float alat = abs(lat);
        float edgeD = (alat - uAuroraLat - 0.05) * 9.0;
        float oval = exp(-edgeD * edgeD);
        float cap = smoothstep(uAuroraLat, uAuroraLat + 0.12, alat) * (1.0 - smoothstep(1.3, 1.45, alat));
        float curtain = 0.55 + 0.45 * sin(lon * 11.0 + uTime * 2.6 + fbm3(n * 4.0) * 6.0);
        vec3 auroraCol = mix(vec3(1.0, 0.22, 0.4), vec3(0.2, 1.0, 0.5), smoothstep(0.35, 0.95, alat));
        col += auroraCol * (oval * 1.5 + cap * 0.3) * curtain * uAurora;

        // The blast wave striking the facing side.
        col += uBlastCol * sqrt(facing) * uShockGlow * 1.3;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const earthMesh = new THREE.Mesh(new THREE.SphereGeometry(LAB_EARTH_R, 64, 48), earthMat);
  earthGroup.add(earthMesh);

  const atmoUniforms = {
    uSunDir: earthUniforms.uSunDir,
    uBlastDir: earthUniforms.uBlastDir,
    uBlastCol: earthUniforms.uBlastCol,
    uFlash: earthUniforms.uFlash,
    uAmount: { value: 1 },
    uHeat: { value: 0 },
    uAurora: earthUniforms.uAurora,
  };
  const atmoMat = new THREE.ShaderMaterial({
    uniforms: atmoUniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexShader: SHELL_VERT,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform vec3 uBlastDir;
      uniform vec3 uBlastCol;
      uniform float uFlash;
      uniform float uAmount;
      uniform float uHeat;
      uniform float uAurora;
      varying vec3 vWorldN;
      varying vec3 vWorldPos;
      void main() {
        vec3 N = normalize(vWorldN);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float rim = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 2.2);
        float sun = smoothstep(-0.35, 0.3, dot(N, uSunDir));
        float blast = max(dot(N, uBlastDir), 0.0) * min(uFlash, 2.0);
        vec3 air = mix(vec3(0.25, 0.6, 1.0), vec3(1.0, 0.45, 0.15), clamp(uHeat, 0.0, 1.0));
        vec3 col = air * rim * (sun * 0.9 + 0.06) + uBlastCol * rim * blast * 0.8;
        col += vec3(0.2, 1.0, 0.55) * rim * uAurora * 0.35;
        gl_FragColor = vec4(col * uAmount, 1.0);
      }
    `,
  });
  const atmoMesh = new THREE.Mesh(unitSphere, atmoMat);
  atmoMesh.scale.setScalar(LAB_EARTH_R * 1.05);
  earthGroup.add(atmoMesh);

  // Ozone layer, drawn as a thin green shell that opens in holes as it is destroyed.
  const ozoneUniforms = { uLoss: { value: 0 }, uShow: { value: 0 }, uBlastDir: earthUniforms.uBlastDir };
  const ozoneMat = new THREE.ShaderMaterial({
    uniforms: ozoneUniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexShader: SHELL_VERT,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform float uLoss;
      uniform float uShow;
      uniform vec3 uBlastDir;
      varying vec3 vDir;
      varying vec3 vWorldN;
      varying vec3 vWorldPos;
      void main() {
        vec3 N = normalize(vWorldN);
        vec3 V = normalize(cameraPosition - vWorldPos);
        float rim = pow(clamp(1.0 - dot(N, V), 0.0, 1.0), 1.5);
        // The side facing the explosion goes first.
        float hold = clamp(fbm3(normalize(vDir) * 2.4) * 0.75 + 0.25 * (0.5 - 0.5 * dot(N, uBlastDir)) + 0.02, 0.0, 1.0);
        float keep = smoothstep(uLoss - 0.03, uLoss + 0.03, hold);
        gl_FragColor = vec4(vec3(0.3, 1.0, 0.7) * (0.015 + 0.22 * rim * rim) * keep * uShow, 1.0);
      }
    `,
  });
  const ozoneMesh = new THREE.Mesh(unitSphere, ozoneMat);
  ozoneMesh.scale.setScalar(LAB_EARTH_R * 1.11);
  earthGroup.add(ozoneMesh);

  // What the blast tears off Earth: its air, and the planet itself.
  const earthWreck = createWreckage(
    { air: AIR_PARTICLES, chunks: DEBRIS_CHUNKS, dust: DEBRIS_DUST }, new THREE.Color(0.55, 0.78, 1.0), new THREE.Color(1.6, 0.6, 0.18), 5, false,
  );
  earthWreck.group.scale.setScalar(LAB_EARTH_R);
  earthGroup.add(earthWreck.group);
  // The Sun's outer layers, torn off by a supernova close by.
  const sunWreck = createWreckage({ air: TOKEN_AIR, chunks: 0, dust: TOKEN_DUST }, new THREE.Color(1.0, 0.62, 0.25), new THREE.Color(1.6, 0.9, 0.35), 4, false);
  scene.add(sunWreck.group);

  /** A ring round a body in the colour of what is to become of it; it shows while the body comes to harm. */
  const markGeo = new THREE.RingGeometry(1.34, 1.44, 64);
  markGeo.rotateX(Math.PI / 2);
  const makeMark = (): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> => {
    const mark = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>(markGeo, new THREE.MeshBasicMaterial({
      color: LEVEL_COLOUR.safe, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false,
    }));
    mark.visible = false;
    scene.add(mark);
    return mark;
  };
  const earthMark = makeMark();
  earthMark.scale.setScalar(EARTH_TOKEN_R);
  // Lines from where the Moon, the planets and the Sun stood to where the blast has carried them.
  const carriedGeo = new THREE.BufferGeometry();
  carriedGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((TOKENS.length + 1) * 6), 3));
  const carriedMat = new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.4 });
  const carriedLines = new THREE.LineSegments(carriedGeo, carriedMat);
  carriedLines.frustumCulled = false;
  scene.add(carriedLines);

  const moonTag = makeTag(0xcbd5e1, { tr: 'Ay', en: 'Moon' });
  const sunTag = makeTag(0xfde68a, BODY_NAMES.sun);

  // ───────────── the Moon and the other planets, and the stars that give the far rings their names ─────────────
  /** Where the Sun and the explosion are, for every token's lighting. */
  const sunPosUniform = { value: new THREE.Vector3(-10, 0, 0) };
  const blastPosUniform = { value: new THREE.Vector3(10, 0, 0) };
  const planetVert = /* glsl */ `
    varying vec2 vUv;
    varying vec3 vDir;
    varying vec3 vWorldN;
    varying vec3 vWorldPos;
    void main() {
      vUv = uv;
      vDir = normalize(position);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vWorldN = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;
  const planetFrag = /* glsl */ `
    ${NOISE_GLSL}
    uniform sampler2D uMap;
    uniform float uHasMap;
    uniform vec3 uColor;
    uniform vec3 uSunPos;
    uniform vec3 uBlastPos;
    uniform vec3 uBlastCol;
    uniform float uFlash;
    uniform float uScorch;
    uniform float uMelt;
    uniform float uBare;
    uniform float uShock;
    uniform float uAurora;
    uniform float uGiant;
    uniform float uIcy;
    uniform float uTime;
    varying vec2 vUv;
    varying vec3 vDir;
    varying vec3 vWorldN;
    varying vec3 vWorldPos;
    void main() {
      vec3 n = normalize(vDir);
      vec3 N = normalize(vWorldN);
      // Without a map (Venus): a cloud deck in the planet's colour, with soft streaks along the latitudes.
      vec3 albedo = uColor * (0.88 + 0.2 * fbm3(vec3(n.x * 2.0, n.y * 7.0, n.z * 2.0)));
      if (uHasMap > 0.5) albedo = texture2D(uMap, vUv).rgb;
      // A cloud deck goes with the air: the rock under it shows.
      albedo = mix(albedo, vec3(0.34, 0.27, 0.21) * (0.6 + 0.8 * fbm3(n * 6.0)), uBare);
      float facing = max(dot(N, normalize(uBlastPos - vWorldPos)), 0.0);
      // Radiant heat chars rock, the side facing the explosion first; a giant's clouds turn a dull, hot red.
      float burn = clamp(uScorch * (0.3 + 0.7 * facing) + uMelt * 0.6, 0.0, 1.0);
      albedo = mix(albedo, mix(vec3(0.09, 0.065, 0.05), albedo * vec3(0.8, 0.4, 0.28), uGiant), burn * 0.85);
      float sun = smoothstep(-0.15, 0.75, dot(N, normalize(uSunPos - vWorldPos)));
      // A token has to be readable from every side: its night side is only dimmed, and its limb darkens so that
      // it still reads as a globe.
      float limb = 0.6 + 0.4 * sqrt(max(dot(N, normalize(cameraPosition - vWorldPos)), 0.0));
      vec3 col = albedo * (0.24 + 0.95 * sun) * limb;
      // The explosion's light, once it has got this far.
      col += albedo * uBlastCol * facing * uFlash;
      // Molten crust: glowing cracks spread into a magma ocean. Ice does not glow: it goes up in a pall of steam.
      float cracks = 1.0 - abs(fbm3(n * 5.0 + 3.1) * 2.0 - 1.0);
      float heat = clamp(uMelt * 1.6 - (1.0 - cracks) * 0.9, 0.0, 1.0);
      vec3 magma = mix(vec3(0.9, 0.12, 0.02), vec3(1.7, 0.95, 0.3), heat) * (0.5 + 1.9 * heat);
      vec3 molten = mix(col, col * 0.25, uMelt * 0.8) + magma * heat;
      float billow = 0.55 + 0.45 * fbm3(n * 3.0 + vec3(0.0, uTime * 0.05, 0.0));
      vec3 steam = mix(col, vec3(0.86, 0.92, 1.0) * billow * (0.3 + 0.9 * sun + facing * min(uFlash, 1.5)), uMelt * 0.9);
      col = mix(molten, steam, uIcy);
      col += vec3(1.3, 0.28, 0.05) * pow(facing, 1.5) * uScorch * uScorch;
      // Auroras of a magnetosphere struck by a solar eruption: ovals round the two poles of the axis.
      float edge = (abs(n.y) - 0.86) * 14.0;
      float curtain = 0.6 + 0.4 * sin(atan(n.z, n.x) * 9.0 + uTime * 2.6);
      col += vec3(0.25, 1.0, 0.6) * exp(-edge * edge) * curtain * uAurora * 1.6;
      // The blast wave striking the facing side.
      col += uBlastCol * sqrt(facing) * uShock * 1.3;
      gl_FragColor = vec4(col, 1.0);
    }
  `;
  /** Saturn's rings thin out as the planet's upper layers are torn off. */
  const ringUniforms = { uFade: { value: 1 } };
  const ringMat = new THREE.ShaderMaterial({
    uniforms: ringUniforms,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vRing;
      void main() {
        vRing = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${SATURN_RING_GLSL}
      uniform float uFade;
      varying vec2 vRing;
      void main() {
        vec2 ring = saturnRing(length(vRing));
        gl_FragColor = vec4(saturnRingColour(ring.x) * 0.9, ring.y * uFade);
      }
    `,
  });
  const ringGeo = new THREE.RingGeometry(SATURN_RING_INNER, SATURN_RING_OUTER, 96, 1);
  const tokens: Token[] = TOKENS.map((def) => {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: new THREE.Texture() },
        uHasMap: { value: 0 },
        uColor: { value: new THREE.Color(def.color) },
        uSunPos: sunPosUniform,
        uBlastPos: blastPosUniform,
        uBlastCol: blastCol,
        uFlash: { value: 0 },
        uScorch: { value: 0 },
        uMelt: { value: 0 },
        uBare: { value: 0 },
        uShock: { value: 0 },
        uAurora: { value: 0 },
        uGiant: { value: def.giant ? 1 : 0 },
        uIcy: { value: def.icy ? 1 : 0 },
        uTime: { value: 0 },
      },
      vertexShader: planetVert,
      fragmentShader: planetFrag,
    });
    // The holder carries the place, the size and the tilt of the axis; the globe turns inside it.
    const holder = new THREE.Group();
    holder.rotation.z = THREE.MathUtils.degToRad(def.tiltDeg);
    const globe = new THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>(unitSphere, material);
    holder.add(globe);
    let ring: THREE.Mesh | null = null;
    if (def.id === 'saturn') {
      ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      holder.add(ring);
    }
    scene.add(holder);
    // What the blast tears off it: gas in its own colour, and from a body of rock glowing chunks (of ice, pale ones).
    const dustTint = def.giant ? new THREE.Color(def.color).multiplyScalar(1.6) : def.icy ? new THREE.Color(0.8, 0.9, 1.0) : new THREE.Color(1.6, 0.6, 0.18);
    const wreck = createWreckage(
      { air: def.gas === null ? 0 : TOKEN_AIR, chunks: def.giant ? 0 : TOKEN_CHUNKS, dust: TOKEN_DUST }, new THREE.Color(def.gas ?? 0xffffff), dustTint, 4, def.icy,
    );
    scene.add(wreck.group);
    return {
      id: def.id, def, holder, globe, ring, wreck, mark: makeMark(),
      tag: def.id === 'moon' ? moonTag : makeTag(0xcbd5e1, def.name),
      at: holder.position, home: new THREE.Vector3(), away: new THREE.Vector3(1, 0, 0), radius: def.radius, push: 0, since: -1, jolt: 0,
      fate: null, onMap: true,
    };
  });

  const landmarks = LANDMARKS.map((def) => {
    // So far off, its direction from the Sun is its direction from Earth.
    const angle = -THREE.MathUtils.degToRad(def.lonDeg);
    const position = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(labSunRadius(def.lightYears * LY_AU));
    const glow = new THREE.Sprite(glowMaterial(new THREE.Color(def.color), def.kind === 'nebula' ? 0.55 : 0.8));
    const core = new THREE.Sprite(glowMaterial(def.kind === 'nebula' ? new THREE.Color(0.55, 0.8, 1) : new THREE.Color(1, 1, 1), 0.9));
    glow.position.copy(position);
    core.position.copy(position);
    scene.add(glow, core);
    // A star of the map is itself what explodes there.
    const body: LabBody = { id: def.id, name: def.name, kind: def.kind, angleRad: angle, distanceAU: def.lightYears * LY_AU };
    return { body, position, glow, core, tag: makeTag(def.color, def.name) };
  });

  // The orbits: a circle round the Sun through Earth's place and through each planet's, the Moon's way round
  // Earth as the magnified neighbourhood shows it, and the edge of that neighbourhood.
  const circlePts: THREE.Vector3[] = [];
  for (let i = 0; i < 160; i++) circlePts.push(new THREE.Vector3(Math.cos((i / 160) * Math.PI * 2), 0, Math.sin((i / 160) * Math.PI * 2)));
  const circleGeo = new THREE.BufferGeometry().setFromPoints(circlePts);
  const orbitMat = new THREE.LineBasicMaterial({ color: RING_GREY, transparent: true, opacity: 0.38 });
  const earthOrbitMat = new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.5 });
  const lensMat = new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.16 });
  const earthOrbit = new THREE.LineLoop(circleGeo, earthOrbitMat);
  const lensEdge = new THREE.LineLoop(circleGeo, lensMat);
  lensEdge.scale.setScalar(LAB_LENS_RADIUS);
  const moonOrbitGeo = new THREE.BufferGeometry();
  moonOrbitGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(97 * 3), 3));
  const moonOrbit = new THREE.Line(moonOrbitGeo, orbitMat);
  moonOrbit.frustumCulled = false;
  scene.add(earthOrbit, lensEdge, moonOrbit);
  /** Per token, in the order of `tokens`: its orbit round the Sun; null for a moon. */
  const orbits = tokens.map((p) => {
    if (p.def.id === 'moon' || p.def.host !== null) return null;
    const orbit = new THREE.LineLoop(circleGeo, orbitMat);
    scene.add(orbit);
    return orbit;
  });

  /** Sets out every body's wreckage again for the explosion as it now stands. */
  function seedWreckage(): void {
    earthWreck.seed(away);
    for (const body of [sunBody, ...tokens]) body.wreck.seed(body.away);
  }

  // Where Earth started, and a line to where the blast has carried it.
  const originPts: THREE.Vector3[] = [];
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    originPts.push(new THREE.Vector3(Math.cos(a) * LAB_EARTH_R, 0, Math.sin(a) * LAB_EARTH_R));
  }
  const originGeo = new THREE.BufferGeometry().setFromPoints(originPts);
  const driftGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
  const originMat = new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.6 });
  const originRing = new THREE.LineLoop(originGeo, originMat);
  originRing.scale.setScalar(EARTH_SCALE);
  const driftLine = new THREE.Line(driftGeo, originMat);
  driftLine.frustumCulled = false;
  for (const marker of [originRing, driftLine]) {
    marker.visible = false;
    scene.add(marker);
  }

  // ───────────── magnetosphere (shown for solar eruptions) ─────────────
  // Local frame: +X toward the incoming cloud, +Y the magnetic axis. Not to scale with the distance map.
  const magGroup = new THREE.Group();
  magGroup.visible = false;
  earthGroup.add(magGroup);
  const fieldBase: number[] = [];
  for (const shell of [1.28, 1.42, 1.56]) {
    for (let m = 0; m < 8; m++) {
      const phi = (m / 8) * Math.PI * 2;
      const latMax = Math.acos(Math.sqrt(1 / shell));
      let prev: THREE.Vector3 | null = null;
      for (let s = 0; s <= 28; s++) {
        const latitude = -latMax + (2 * latMax * s) / 28;
        const r = shell * Math.cos(latitude) ** 2 * LAB_EARTH_R;
        const p = new THREE.Vector3(r * Math.cos(latitude) * Math.cos(phi), r * Math.sin(latitude), r * Math.cos(latitude) * Math.sin(phi));
        if (prev) fieldBase.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        prev = p;
      }
    }
  }
  const fieldPos = new Float32Array(fieldBase.length);
  const fieldGeo = new THREE.BufferGeometry();
  fieldGeo.setAttribute('position', new THREE.BufferAttribute(fieldPos, 3));
  const fieldMat = new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });
  const fieldLines = new THREE.LineSegments(fieldGeo, fieldMat);
  fieldLines.frustumCulled = false;
  magGroup.add(fieldLines);
  let fieldSqueeze = -1;

  /** `squeeze`: 1 = quiet magnetosphere, smaller = sunward side pushed in (and the tail stretched). */
  function shapeField(squeeze: number): void {
    if (Math.abs(squeeze - fieldSqueeze) < 0.002) return;
    fieldSqueeze = squeeze;
    const tail = 1.7 + (1 - squeeze) * 2.4;
    for (let i = 0; i < fieldBase.length; i += 3) {
      const x = fieldBase[i];
      const dayside = x > 0;
      fieldPos[i] = dayside ? x * squeeze : x * tail;
      const pinch = dayside ? 0.72 + 0.28 * squeeze : 1;
      fieldPos[i + 1] = fieldBase[i + 1] * pinch;
      fieldPos[i + 2] = fieldBase[i + 2] * pinch;
    }
    (fieldGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
  shapeField(1);

  const bowPoints: THREE.Vector2[] = [];
  for (let s = 0; s <= 24; s++) {
    const rho = (s / 24) * 5.4;
    bowPoints.push(new THREE.Vector2(rho, 3.9 - (rho * rho) / 4.6));
  }
  const bowGeo = new THREE.LatheGeometry(bowPoints, 48);
  bowGeo.rotateZ(-Math.PI / 2);
  const bowUniforms = { uGlow: { value: 0 }, uColor: { value: new THREE.Color(0.35, 0.75, 1.0) } };
  const bowMat = new THREE.ShaderMaterial({
    uniforms: bowUniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: SHELL_VERT,
    fragmentShader: /* glsl */ `
      uniform float uGlow;
      uniform vec3 uColor;
      varying vec3 vWorldN;
      varying vec3 vWorldPos;
      void main() {
        vec3 V = normalize(cameraPosition - vWorldPos);
        float rim = pow(clamp(1.0 - abs(dot(normalize(vWorldN), V)), 0.0, 1.0), 2.0);
        gl_FragColor = vec4(mix(uColor, vec3(1.0, 0.6, 0.25), clamp(uGlow, 0.0, 1.0)) * rim * (0.16 + 0.9 * uGlow), 1.0);
      }
    `,
  });
  const bowShock = new THREE.Mesh(bowGeo, bowMat);
  bowShock.frustumCulled = false;
  magGroup.add(bowShock);

  // Spacecraft near Earth, on the scale of this picture: the quiet edge of the magnetosphere, 10.5 Earth radii
  // out, is drawn 3.9 units from Earth's centre. (The sentinels at L1 are far outside it: they stand sunward
  // at a fixed place, off that scale.)
  /** Scene units from Earth's centre that `re` Earth radii come to in the picture of the magnetosphere. */
  const magRadius = (re: number): number => LAB_EARTH_R + ((re - 1) * (3.9 - LAB_EARTH_R)) / 9.5;
  const orbitPts: THREE.Vector3[] = [];
  for (let i = 0; i < 96; i++) orbitPts.push(new THREE.Vector3(Math.cos((i / 96) * Math.PI * 2), 0, Math.sin((i / 96) * Math.PI * 2)));
  const orbitGeo = new THREE.BufferGeometry().setFromPoints(orbitPts);
  const craftGeo = new THREE.BufferGeometry().setFromPoints([0, 1, 2, 3, 4].map((i) => new THREE.Vector3(Math.cos(i * 1.2566), 0, Math.sin(i * 1.2566))));
  const oneCraftGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(1, 0, 0)]);
  const satMarkers: SatMarker[] = SAT_MARKS.map((def) => {
    const holder = new THREE.Group();
    holder.rotation.x = def.tiltRad;
    holder.scale.setScalar(def.id === 'l1' ? L1_MARK_RADIUS : magRadius(def.orbitRe) * (def.id === 'iss' ? 1.03 : 1));
    holder.visible = false;
    const line = new THREE.LineBasicMaterial({ color: SAT_COLOUR.inside, transparent: true, opacity: 0.45, depthWrite: false });
    const dots = new THREE.PointsMaterial({ color: SAT_COLOUR.inside, size: 5, sizeAttenuation: false, transparent: true, depthWrite: false });
    const craft = new THREE.Points(def.craft > 1 ? craftGeo : oneCraftGeo, dots);
    if (def.id !== 'l1') holder.add(new THREE.LineLoop(orbitGeo, line));
    holder.add(craft);
    magGroup.add(holder);
    return { def, holder, craft, line, dots, state: 'inside', present: false, tag: makeTag(0xa5f3fc, def.label), at: new THREE.Vector3() };
  });

  // ───────────── the explosion ─────────────
  const blastGroup = new THREE.Group();
  blastGroup.scale.setScalar(BLAST_SCALE);
  scene.add(blastGroup);
  const linkGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
  const linkLine = new THREE.Line(linkGeo, new THREE.LineBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0.35 }));
  linkLine.frustumCulled = false;
  scene.add(linkLine);
  const markerRing = new THREE.Mesh(
    new THREE.RingGeometry(1.7, 1.82, 64),
    new THREE.MeshBasicMaterial({ color: 0xffb454, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }),
  );
  markerRing.rotation.x = Math.PI / 2;
  blastGroup.add(markerRing);

  // What explodes: a red supergiant, a white dwarf fed by a companion, or the Sun.
  const starMat2 = makeStarMaterial(LOOK.sn2.starA, LOOK.sn2.starB);
  const progenitor = new THREE.Mesh(unitSphere, starMat2);
  blastGroup.add(progenitor);
  const progenitorGlow = new THREE.Sprite(glowMaterial(new THREE.Color(1, 0.5, 0.2), 0.55));
  blastGroup.add(progenitorGlow);
  const companionMat = makeStarMaterial(new THREE.Color(1.5, 0.7, 0.25), new THREE.Color(2.0, 1.2, 0.5));
  const companion = new THREE.Mesh(unitSphere, companionMat);
  companion.scale.setScalar(0.62);
  blastGroup.add(companion);
  const discGeo = new THREE.RingGeometry(0.42, 0.95, 64);
  const discMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 1.1, 1.6), side: THREE.DoubleSide, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.rotation.x = Math.PI / 2 - 0.35;
  blastGroup.add(disc);

  const flashSprite = new THREE.Sprite(glowMaterial(new THREE.Color(1, 1, 1), 0));
  flashSprite.renderOrder = 15;
  blastGroup.add(flashSprite);

  const shellFrag = /* glsl */ `
    ${NOISE_GLSL}
    uniform vec3 uColA;
    uniform vec3 uColB;
    uniform float uAlpha;
    uniform float uSeed;
    uniform float uClump;
    uniform float uFill;
    uniform float uCore;
    varying vec3 vDir;
    varying vec3 vWorldN;
    varying vec3 vWorldPos;
    void main() {
      vec3 V = normalize(cameraPosition - vWorldPos);
      float rim = clamp(1.0 - abs(dot(normalize(vWorldN), V)), 0.0, 1.0);
      vec3 d = normalize(vDir);
      float ridge = 1.0 - abs(fbm3(d * uClump + uSeed) * 2.0 - 1.0);
      float filaments = smoothstep(0.7, 0.95, ridge);
      float knots = smoothstep(0.6, 0.85, fbm3(d * uClump * 2.3 - uSeed));
      float tex = (filaments * 0.6 + knots * 0.7) * uFill;
      // A thin shell is bright along its edge and nearly clear across its face (the display's gamma makes
      // even a few percent read as fog); only the fireball glows all over.
      float edge = rim * rim * rim * rim * sqrt(rim);
      vec3 col = mix(uColA, uColB, knots) * (edge * 1.4 + tex * mix(0.02 + 0.98 * rim * rim * rim, 1.0, uCore));
      gl_FragColor = vec4(col * uAlpha, 1.0);
    }
  `;
  const makeShell = (clump: number, fill: number, shellSeed: number, core = 0): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> => {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColA: { value: new THREE.Color() }, uColB: { value: new THREE.Color() }, uAlpha: { value: 0 },
        uSeed: { value: shellSeed }, uClump: { value: clump }, uFill: { value: fill }, uCore: { value: core },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: SHELL_VERT,
      fragmentShader: shellFrag,
    });
    const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>(unitSphere, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    blastGroup.add(mesh);
    return mesh;
  };
  /** The hot bubble at the explosion's own place. */
  const fireball = makeShell(3.0, 1.6, 12.9, 1);

  // The fronts on the map. Each is the line where the real front (a circle round the explosion, or the part
  // of it inside a cloud or a beam) lies once carried through the map's projection: it is at a body's token
  // at the moment the model has the front reach that body. The line is a ribbon of constant width; the veil
  // behind it is a second ribbon. Along a ribbon a corner on the leading edge alternates with one on the
  // trailing edge, where the glow ends.
  const frontIndex: number[] = [];
  for (let i = 0; i < FRONT_POINTS - 1; i++) frontIndex.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  const frontEdge = new Float32Array(FRONT_POINTS * 2);
  for (let i = 0; i < FRONT_POINTS; i++) frontEdge[i * 2] = 1;
  /** `power`: how fast the glow falls off behind the leading edge. */
  const makeFront = (power: number): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FRONT_POINTS * 6), 3));
    geometry.setAttribute('aEdge', new THREE.BufferAttribute(frontEdge, 1));
    geometry.setIndex(frontIndex);
    const material = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Color() }, uAlpha: { value: 0 }, uPower: { value: power } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute float aEdge;
        varying float vEdge;
        void main() {
          vEdge = aEdge;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uCol;
        uniform float uAlpha;
        uniform float uPower;
        varying float vEdge;
        void main() {
          gl_FragColor = vec4(uCol * uAlpha * pow(vEdge, uPower), 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>(geometry, material);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  };
  /**
   * The line of the light front; then the line of what follows it and the veil behind that line, each
   * twice: a supernova's blast and a solar eruption's cloud use the first of each, a burst both (its beam
   * toward Earth and the one the opposite way).
   */
  const lightBand = makeFront(2);
  const edgeBands = [makeFront(2), makeFront(2)];
  const glowBands = [makeFront(1.4), makeFront(1.4)];
  /**
   * The corners of the front last traced, in order along it: the direction of each from the explosion,
   * radians, and its place on the map. Two sets, swapped as the corners are refined.
   */
  let traceRad = new Float64Array(FRONT_POINTS);
  let traceX = new Float64Array(FRONT_POINTS);
  let traceZ = new Float64Array(FRONT_POINTS);
  let nextRad = new Float64Array(FRONT_POINTS);
  let nextX = new Float64Array(FRONT_POINTS);
  let nextZ = new Float64Array(FRONT_POINTS);

  /** Per grain of ejecta: its direction round the explosion's axis toward Earth and out of the plane, radians, and its share of the front's speed. */
  const ejectaTurn = new Float32Array(EJECTA_PARTICLES);
  const ejectaLift = new Float32Array(EJECTA_PARTICLES);

  const ejectaSpeed = new Float32Array(EJECTA_PARTICLES);
  const ejectaPos = new Float32Array(EJECTA_PARTICLES * 3);
  const ejectaCol = new Float32Array(EJECTA_PARTICLES * 3);
  const ejectaGeo = new THREE.BufferGeometry();
  ejectaGeo.setAttribute('position', new THREE.BufferAttribute(ejectaPos, 3));
  ejectaGeo.setAttribute('color', new THREE.BufferAttribute(ejectaCol, 3));
  const ejectaMat = grainMaterial(new THREE.Color(1, 1, 1), 0.24, 3.5, true);
  const ejectaPoints = new THREE.Points(ejectaGeo, ejectaMat);
  ejectaPoints.frustumCulled = false;
  ejectaPoints.visible = false;
  scene.add(ejectaPoints);

  // Left behind by a core collapse: a pulsar sweeping two beams.
  const pulsar = new THREE.Group();
  pulsar.visible = false;
  blastGroup.add(pulsar);
  const pulsarGlow = new THREE.Sprite(glowMaterial(new THREE.Color(0.7, 0.85, 1.0), 0.9));
  pulsarGlow.scale.setScalar(0.9);
  pulsar.add(pulsarGlow);
  const beamGeo = new THREE.CylinderGeometry(0.3, 0.015, 4.5, 16, 1, true);
  beamGeo.translate(0, 2.25, 0);
  // Soft-edged and fading along its length: a beam of light, not a rod.
  const beamMat = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying float vAlong;
      varying vec3 vWorldN;
      varying vec3 vWorldPos;
      void main() {
        vAlong = position.y / 4.5;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlong;
      varying vec3 vWorldN;
      varying vec3 vWorldPos;
      void main() {
        vec3 V = normalize(cameraPosition - vWorldPos);
        float face = abs(dot(normalize(vWorldN), V));
        float fade = (1.0 - vAlong) * (1.0 - vAlong);
        gl_FragColor = vec4(vec3(0.4, 0.65, 1.2) * face * face * fade * 0.45, 1.0);
      }
    `,
  });
  const beamA = new THREE.Mesh(beamGeo, beamMat);
  const beamB = new THREE.Mesh(beamGeo, beamMat);
  beamB.rotation.z = Math.PI;
  pulsar.add(beamA, beamB);
  pulsar.rotation.z = 0.5;

  // ───────────── state ─────────────
  let setup: LabSetup = { kind: 'sn2', angleRad: 0.4, distanceAU: 0.3, cmeStrength: 'may2024', anchorId: null };
  /** Everything the map shows, as `layoutFor` last laid it out, and Earth's and the explosion's real places, AU from the Sun. */
  let laidOut: LabBody[] = [];
  let earthReal: MapPoint = { x: 1, z: 0 };
  let srcReal: MapPoint = labBlastPlace(setup, laidOut);
  /**
   * What the explosion does to Earth, the second at which the time-lapse stops and holds its last picture,
   * and the clock of the time-lapse; the engine sets them with every change (see `setResults`).
   */
  let { impact, runSec, clock }: { impact: LabImpact; runSec: number; clock: LabClock } = computeLabResults(setup, laidOut, []);
  let playing = false;
  /** The time-lapse stands still: `elapsed` then moves only when it is set by hand. */
  let paused = false;
  let elapsed = 0;
  /** How far the blast front (a burst's rays) had grown at the last frame, AU: the astronaut is shoved as it passes. */
  let frontWasAU = 0;
  /** The rings that show how each body fares are hidden (the class mode asks for a prediction first). */
  let concealed = false;
  let reducedFlash = false;
  let time = 0;
  let texturesLoaded = false;
  /** The maps loaded for this view: it disposes them with itself, and one that arrives after that is dropped at once. */
  const maps: THREE.Texture[] = [];
  let disposed = false;
  function loadMap(url: string, use: (map: THREE.Texture) => void): void {
    texLoader.loadAsync(url).then((map) => {
      if (disposed) {
        map.dispose();
        return;
      }
      map.colorSpace = THREE.SRGBColorSpace;
      maps.push(map);
      use(map);
    }).catch(() => undefined);
  }
  const srcPos = new THREE.Vector3();
  /** Where the exploding star is drawn: at the explosion's place, or beside the token of the body it is set at. */
  const starPos = new THREE.Vector3();
  const away = new THREE.Vector3(-1, 0, 0);
  const sunPos = new THREE.Vector3();
  /** Where Earth stands on the map before any blast carries it off. */
  const earthHome = new THREE.Vector3(labSunRadius(1), 0, 0);
  const earthBody: FocusBody = { at: earthGroup.position, home: earthHome, away, radius: EARTH_TOKEN_R, push: 0, since: -1, jolt: 0 };
  /** The Sun: `home` is the middle of the map (for a solar eruption it is drawn at the chosen spot). */
  const sunBody: Affected = {
    id: 'sun', at: sunPos, home: new THREE.Vector3(), away: new THREE.Vector3(-1, 0, 0), radius: SUN_TOKEN_R, push: 0, since: -1, jolt: 0,
    fate: null, wreck: sunWreck, mark: makeMark(),
  };
  /** The body the result panel is about and the close view goes to: 'earth', 'sun' or a token's id. */
  let focusId = 'earth';
  const up = new THREE.Vector3(0, 1, 0);
  const camFwd = new THREE.Vector3();
  const scratchA = new THREE.Vector3();
  const scratchB = new THREE.Vector3();

  // Optional weightless astronaut flying through the scene.
  let suit: SuitRig | null = null;
  const evaPos = new THREE.Vector3();
  const evaVel = new THREE.Vector3();
  /** Puts the astronaut back beside Earth, at rest. */
  function homeAstronaut(): void {
    evaPos.copy(earthHome).add(EVA_OFFSET);
    evaVel.set(0, 0, 0);
  }
  const evaInput = { mx: 0, mz: 0, my: 0, boost: false };
  let evaMode = false;
  let suitPromise: Promise<void> | null = null;

  // Orbit camera and click-to-place on the map plane.
  let lon = 0.9;
  let lat = 0.6;
  let dist = 26;
  let tLon = 0.9;
  let tLat = 0.6;
  let tDist = 26;
  /** 0 = overview centred on the Sun; 1 = close on the body in focus, following it as it is carried off. */
  let close = 0;
  let tClose = 0;
  /** The framing the camera last took, by itself or because it was asked to. */
  let framing: LabFraming = 'orbit';
  let viewW = window.innerWidth;
  let viewH = window.innerHeight;
  /** Pixels the panels cover at the left and right edges of the screen. */
  let insetL = 0;
  let insetR = 0;
  /** How quickly the camera settles: gently for its own moves, at once under the user's hand. */
  let ease = 2.4;
  /** The framing picked with a view button; it is kept through every change until the lab is opened again. */
  let chosen: LabFraming | null = null;
  /** Set when the user turns or zooms the view by hand; the camera then leaves it alone until the next framing. */
  let manual = false;
  let el: HTMLElement | null = null;
  let drag = false;
  let moved = 0;
  let sx = 0;
  let sy = 0;
  let placeCb: ((angleRad: number, distanceAU: number, bodyId: string | null) => void) | null = null;
  let lockedCb: (() => void) | null = null;
  /** The bodies of the map with their names on the screen, for clicks: set by `layoutFor`. */
  let clickable: Array<{ tag: NameTag; body: LabBody }> = [];
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const mapPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPt = new THREE.Vector3();

  /** The Sun or the token in focus; null when Earth is. */
  function focusAffected(): Affected | null {
    return focusId === 'sun' ? sunBody : tokens.find((p) => p.id === focusId && p.onMap) ?? null;
  }

  function focusBody(): FocusBody {
    return focusAffected() ?? earthBody;
  }

  function seedEjecta(): void {
    const look = LOOK[setup.kind];
    const cone = setup.kind === 'cme';
    for (let i = 0; i < EJECTA_PARTICLES; i++) {
      // A cloud's grains stay within its half width of the axis; a blast's go all round.
      ejectaTurn[i] = (rand() * 2 - 1) * (cone ? CME_HALF_WIDTH_RAD : Math.PI);
      ejectaLift[i] = cone ? (rand() * 2 - 1) * CME_HALF_WIDTH_RAD : Math.asin(rand() * 2 - 1);
      // Most of the mass lags the front: slow, cool, red; the fastest material is hot.
      const s = 0.45 + 0.57 * rand() ** 0.6;
      ejectaSpeed[i] = s;
      const c = look.cool.clone().lerp(look.hot, THREE.MathUtils.smoothstep(s, 0.6, 1.0)).multiplyScalar(0.5 + rand() * 0.9);
      ejectaCol.set([c.r, c.g, c.b], i * 3);
    }
    (ejectaGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  /**
   * Traces the real front of radius `au` round the explosion, within `halfRad` of the direction `axisRad`
   * from it (π: all round), on the map: fills `traceRad`, `traceX`, `traceZ` and returns the number of
   * corners. The map bends the front most near the Sun and near Earth, where a front set off far away
   * crosses all the planets within a millionth of a turn: the trace starts from evenly spaced directions
   * and those toward the Sun and Earth, and halves every stretch that is long on the map (longer than a
   * share of its distance from the Sun, where the tokens stand close together) until the line is smooth.
   */
  function traceFront(au: number, axisRad: number, halfRad: number): number {
    const from = axisRad - halfRad;
    const seeds: number[] = [];
    for (let i = 0; i <= 96; i++) seeds.push(from + (2 * halfRad * i) / 96);
    for (const target of [{ x: 0, z: 0 }, earthReal]) {
      const toward = Math.atan2(target.z - srcReal.z, target.x - srcReal.x);
      // The same direction, brought to within a turn above the start of the arc.
      const along = from + ((((toward - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
      if (along <= axisRad + halfRad) seeds.push(along);
    }
    seeds.sort((a, b) => a - b);
    let count = seeds.length;
    for (let i = 0; i < count; i++) {
      const spot = labProject({ x: srcReal.x + Math.cos(seeds[i]) * au, z: srcReal.z + Math.sin(seeds[i]) * au }, earthReal);
      traceRad[i] = seeds[i];
      traceX[i] = spot.x;
      traceZ[i] = spot.z;
    }
    for (let pass = 0; pass < 40; pass++) {
      let filled = 0;
      let halved = false;
      for (let i = 0; i < count; i++) {
        nextRad[filled] = traceRad[i];
        nextX[filled] = traceX[i];
        nextZ[filled] = traceZ[i];
        filled++;
        if (i === count - 1) break;
        const stretch = Math.hypot(traceX[i + 1] - traceX[i], traceZ[i + 1] - traceZ[i]);
        const fromSun = Math.min(Math.hypot(traceX[i], traceZ[i]), Math.hypot(traceX[i + 1], traceZ[i + 1]));
        // Room is kept for the corners still to be copied.
        if (stretch > Math.max(0.25, 0.05 * fromSun) && filled + (count - i) < FRONT_POINTS) {
          const mid = (traceRad[i] + traceRad[i + 1]) / 2;
          const spot = labProject({ x: srcReal.x + Math.cos(mid) * au, z: srcReal.z + Math.sin(mid) * au }, earthReal);
          nextRad[filled] = mid;
          nextX[filled] = spot.x;
          nextZ[filled] = spot.z;
          filled++;
          halved = true;
        }
      }
      [traceRad, nextRad] = [nextRad, traceRad];
      [traceX, nextX] = [nextX, traceX];
      [traceZ, nextZ] = [nextZ, traceZ];
      count = filled;
      if (!halved) break;
    }
    return count;
  }

  /**
   * Lays a ribbon along the front last traced (`count` corners). `innerAU` null: the line of the front, a
   * ribbon `reach` scene units wide on the side of the explosion. Otherwise the veil behind the line: it
   * reaches back toward the real radius `innerAU` round the explosion, `reach` scene units at most.
   */
  function layRibbon(band: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>, count: number, innerAU: number | null, reach: number): void {
    const position = band.geometry.getAttribute('position') as THREE.BufferAttribute;
    // A front all round ends where it starts: there its neighbours are those across the join.
    const closed = Math.hypot(traceX[count - 1] - traceX[0], traceZ[count - 1] - traceZ[0]) < 1e-9;
    for (let i = 0; i < count; i++) {
      const before = i > 0 ? i - 1 : closed ? count - 2 : 0;
      const after = i < count - 1 ? i + 1 : closed ? 1 : count - 1;
      let backX = -(traceZ[after] - traceZ[before]);
      let backZ = traceX[after] - traceX[before];
      let most = reach;
      if (innerAU !== null) {
        const inner = labProject({ x: srcReal.x + Math.cos(traceRad[i]) * innerAU, z: srcReal.z + Math.sin(traceRad[i]) * innerAU }, earthReal);
        backX = inner.x - traceX[i];
        backZ = inner.z - traceZ[i];
        most = Math.min(reach, Math.hypot(backX, backZ));
      }
      // The map keeps the sense of a turn: seen along the front, the explosion is on the same side as on the real front.
      const scale = most / Math.max(Math.hypot(backX, backZ), 1e-12);
      position.setXYZ(i * 2, traceX[i], FRONT_LIFT, traceZ[i]);
      position.setXYZ(i * 2 + 1, traceX[i] + backX * scale, FRONT_LIFT, traceZ[i] + backZ * scale);
    }
    position.needsUpdate = true;
    band.geometry.setDrawRange(0, (count - 1) * 6);
  }

  function applyConfig(): void {
    const look = LOOK[setup.kind];
    srcReal = labBlastPlace(setup, laidOut);
    const spot = labProject(srcReal, earthReal);
    srcPos.set(spot.x, 0, spot.z);
    // The blast passes every body straight away from the explosion. One set at a body stands beyond that
    // body as Earth sees it: it pushes the body toward Earth.
    for (const body of [earthBody, sunBody, ...tokens]) {
      body.away.copy(body.home).sub(srcPos);
      if (body.away.lengthSq() < 1e-6) body.away.copy(earthHome).sub(body.home);
      if (body.away.lengthSq() < 1e-6) body.away.set(1, 0, 0);
      body.away.normalize();
    }
    // The star is drawn at the explosion's place. Set at a body it is three of that body's radii away, far
    // less than a token is wide: it is drawn beside the token, on the side away from Earth, where it is.
    const anchorToken = tokens.find((p) => p.id === setup.anchorId);
    const anchorRadius = setup.kind === 'cme' ? 0 : anchorToken ? anchorToken.def.radius * anchorToken.def.reach : setup.anchorId === 'sun' ? SUN_TOKEN_R : 0;
    starPos.copy(srcPos);
    if (anchorRadius > 0) starPos.addScaledVector(scratchA.copy(srcPos).sub(earthHome).normalize(), anchorRadius + look.starRadius * BLAST_SCALE + 0.15);
    blastGroup.position.copy(starPos);
    styleRings();

    // A solar eruption comes from the Sun: for it the Sun itself sits at the chosen spot.
    sunPos.copy(setup.kind === 'cme' ? srcPos : sunBody.home);
    sunMesh.position.copy(sunPos);
    sunMesh.visible = setup.kind !== 'cme';
    sunLight.position.copy(sunPos);
    sunPosUniform.value.copy(sunPos);
    blastPosUniform.value.copy(starPos);
    earthUniforms.uSunDir.value.copy(sunPos).sub(earthHome).normalize();
    earthUniforms.uBlastCol.value.copy(look.light);

    progenitor.material.uniforms.uColA.value.copy(look.starA);
    progenitor.material.uniforms.uColB.value.copy(look.starB);
    progenitor.scale.setScalar(look.starRadius);
    progenitorGlow.material.color.copy(look.starA).multiplyScalar(0.5);
    progenitorGlow.scale.setScalar(look.starRadius * 5);
    companion.position.set(1.25, 0, 0.2);
    fireball.material.uniforms.uColA.value.copy(look.cool);
    fireball.material.uniforms.uColB.value.copy(look.hot);
    lightBand.material.uniforms.uCol.value.set(1, 1, 1);
    for (const band of edgeBands) band.material.uniforms.uCol.value.copy(look.hot);
    for (const band of glowBands) band.material.uniforms.uCol.value.copy(look.cool);
    magGroup.visible = setup.kind === 'cme';
    // The picture of the magnetosphere faces the incoming cloud.
    magGroup.rotation.y = -Math.atan2(srcPos.z - earthHome.z, srcPos.x - earthHome.x);
    ozoneUniforms.uShow.value = setup.kind === 'cme' ? 0 : 0.8;
    linkGeo.setFromPoints([earthHome, srcPos]);
    if (blastTag.label !== KIND_TAG[setup.kind]) {
      blastTag.label = KIND_TAG[setup.kind];
      drawLabel(blastTag);
    }
  }

  function ensureSuit(): void {
    if (suit || suitPromise) return;
    suitPromise = createSuitRig(false).then((rig) => {
      suit = rig;
      rig.root.scale.setScalar(0.55 * EARTH_SCALE);
      rig.root.visible = evaMode;
      scene.add(rig.root);
    }).catch(() => undefined);
  }

  // On a touch screen the first finger turns the map and taps; a second one only zooms (see core/pinch).
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !e.isPrimary) return;
    drag = true;
    moved = 0;
    sx = e.clientX;
    sy = e.clientY;
  };
  const onMove = (e: PointerEvent): void => {
    if (!drag || !e.isPrimary) return;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    moved += Math.hypot(dx, dy);
    manual = true;
    ease = 7;
    tLon += dx * 0.0055;
    tLat = Math.max(0.08, Math.min(1.5, tLat + dy * 0.0055));
    sx = e.clientX;
    sy = e.clientY;
  };
  const onUp = (e: PointerEvent): void => {
    if (!drag || !e.isPrimary) return;
    drag = false;
    // A press that hardly moved is a click; a finger is less steady than a mouse. A gesture the browser
    // took over (pointercancel) is never one.
    const slop = e.pointerType === 'touch' ? 12 : 5;
    if (e.type !== 'pointerup' || moved >= slop || !el || !placeCb || evaMode) return;
    // From detonation until the explosion is reset the map is the picture of that run: a click moves
    // nothing, and the view's owner is told that one was made.
    if (playing) {
      lockedCb?.();
      return;
    }
    const rect = el.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    // A click on a body or on its name sets the explosion at that body, as its chip does. (The erupting Sun
    // is the explosion itself.)
    for (const { tag, body } of clickable) {
      if (tag.radiusPx <= 0 || (setup.kind === 'cme' && body.kind === 'sun')) continue;
      const onBody = Math.hypot(tag.x - cx, tag.y - cy) <= Math.max(12, tag.radiusPx);
      const onName = tag.written && cx >= tag.left && cx <= tag.right && cy >= tag.top && cy <= tag.bottom;
      if (onBody || onName) {
        placeCb(body.angleRad, body.distanceAU, body.id);
        return;
      }
    }
    // Nothing can be set at Earth itself: a click on its globe or on its name is no place.
    if (Math.hypot(earthTag.x - cx, earthTag.y - cy) <= earthTag.radiusPx) return;
    if (earthTag.written && cx >= earthTag.left && cx <= earthTag.right && cy >= earthTag.top && cy <= earthTag.bottom) return;
    ndc.set((cx / rect.width) * 2 - 1, -(cy / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(mapPlane, hitPt) || Math.hypot(hitPt.x, hitPt.z) > MAP_RADIUS) return;
    // The real place under the pointer, as Earth sees it.
    const place = labUnproject({ x: hitPt.x, z: hitPt.z }, earthReal);
    const distance = Math.hypot(place.x - earthReal.x, place.z - earthReal.z);
    placeCb(Math.atan2(place.z - earthReal.z, place.x - earthReal.x), Math.min(LAB_MAX_AU, Math.max(LAB_MIN_AU, distance)), null);
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // Never nearer than three radii of what the view is centred on: the Sun, or the body in focus when close.
    const nearest = 3 * (SUN_TOKEN_R + (focusBody().radius - SUN_TOKEN_R) * tClose);
    tDist = Math.max(nearest, Math.min(fitDistance(MAP_RADIUS, 1.05) * 1.25, tDist * Math.exp(e.deltaY * 0.001)));
    manual = true;
    ease = 7;
  };

  const ramp = (t: number, duration: number): number => Math.min(1, Math.max(0, t / duration));

  /**
   * Camera distance from which a circle of radius `r` on the map, centred on the Sun and seen from elevation
   * `elev`, fits in the part of the screen that the panels and bars leave free.
   */
  function fitDistance(r: number, elev: number): number {
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const freeW = Math.max(0.12, 1 - (2 * Math.max(insetL, insetR)) / viewW);
    const freeH = Math.max(0.5, 1 - 130 / viewH);
    const byWidth = r / (tanV * camera.aspect * freeW);
    const byHeight = r * Math.cos(elev) + (r * Math.sin(elev)) / (tanV * freeH);
    return Math.max(byWidth, byHeight) * 1.06;
  }

  /**
   * Aims the camera for one of the three framings. The two overviews look at the map from the north with
   * ecliptic longitude 0 to the right, so that the planets go round anticlockwise; close, the explosion
   * ends up to the right of the body in focus.
   */
  function applyFraming(next: LabFraming): void {
    framing = next;
    manual = false;
    const body = focusBody();
    const aimLon = next === 'close' ? Math.atan2(srcPos.z - body.home.z, srcPos.x - body.home.x) + Math.PI / 2 - 0.25 : Math.PI / 2;
    const turn = aimLon - lon;
    tLon = lon + Math.atan2(Math.sin(turn), Math.cos(turn));
    if (next === 'close') {
      tLat = 0.6;
      tDist = (CLOSE_DIST * body.radius) / LAB_EARTH_R;
      tClose = 1;
      return;
    }
    tLat = next === 'map' ? 1.05 : 0.95;
    // All the planets, and the explosion's place when it lies beyond them.
    tDist = fitDistance(next === 'map' ? MAP_RADIUS : Math.max(srcPos.length() + 3.5, PLANETS_RADIUS), tLat);
    tClose = 0;
  }

  /** The framing the user picked, or the camera's own: all the planets, the Sun at the centre. */
  function frameView(): void {
    applyFraming(chosen ?? 'orbit');
    ease = 2.4;
  }

  /** Takes the framing at once, without the camera travelling there. */
  function snapView(): void {
    lon = tLon;
    lat = tLat;
    dist = tDist;
    close = tClose;
  }

  sizeGrains(window.innerHeight);

  applyConfig();
  seedEjecta();
  seedWreckage();

  return {
    scene,
    camera,

    async enter(opts: SpaceViewOptions): Promise<void> {
      setLabels(opts.lang);
      if (!texturesLoaded) {
        texturesLoaded = true;
        const dayUrl = texUrl('earth_day', opts.quality);
        const nightUrl = texUrl('earth_night', opts.quality);
        if (dayUrl) {
          loadMap(dayUrl, (map) => {
            map.anisotropy = 8;
            earthUniforms.uDay.value = map;
            earthUniforms.uHasTex.value = 1;
          });
        }
        if (nightUrl) {
          loadMap(nightUrl, (map) => {
            earthUniforms.uNight.value = map;
          });
        }
        // The tokens need no more than the smallest maps.
        const tokenQuality: QualityProfile = { ...opts.quality, texTier: '2k' };
        for (const p of tokens) {
          const url = texUrl(`${p.def.id}_color`, tokenQuality);
          if (!url) continue;
          loadMap(url, (map) => {
            map.anisotropy = 4;
            p.globe.material.uniforms.uMap.value = map;
            p.globe.material.uniforms.uHasMap.value = 1;
          });
        }
        const starsUrl = texUrl('stars', { ...opts.quality, texTier: '4k' });
        if (starsUrl) {
          loadMap(starsUrl, (map) => {
            map.generateMipmaps = false;
            map.minFilter = THREE.LinearFilter;
            skyUniforms.uStars.value = map;
            skyDome.visible = true;
            starPoints.visible = false;
          });
        }
      }
      // Start already framed, in the camera's own framing and with Earth in focus, instead of swinging in.
      chosen = null;
      focusId = 'earth';
      homeAstronaut();
      this.resize(window.innerWidth, window.innerHeight);
      frameView();
      snapView();
    },

    update(dt: number): void {
      // While the time-lapse is paused the scene holds still (rotation, flicker, shake); the camera still moves.
      const flow = playing && paused ? 0 : dt;
      time += flow;
      // The time-lapse stops at its last second and holds that picture.
      if (playing) elapsed = Math.min(runSec, elapsed + flow);
      const running = playing && elapsed < runSec;
      const o = impact.outcome;
      const look = LOOK[setup.kind];
      // A solar eruption sends a cloud one way, a burst two thin fronts of rays, a supernova a blast all round.
      const solar = setup.kind === 'cme';
      const burst = setup.kind === 'grb';
      // A burst's rays are its light: nothing runs ahead of its front.
      const sinceLight = playing ? elapsed - impact.lightAtSec : -1;
      const sinceShock = playing && impact.shockAtSec !== null ? elapsed - impact.shockAtSec : -1;
      const doomed = o.breakup >= LAB_BREAKUP_AT;
      const sinceBreakup = doomed ? sinceShock - BREAKUP_DELAY_SEC : -1;

      // What explodes, before and after.
      for (const m of [sunMat, starMat2, companionMat]) m.uniforms.uTime.value = time;
      const intact = !playing || solar;
      progenitor.visible = intact;
      progenitorGlow.visible = intact;
      markerRing.visible = !playing;
      linkLine.visible = !playing;
      const binary = setup.kind === 'sn1a';
      disc.visible = binary && !playing;
      companion.visible = binary;
      disc.rotation.z = time * 0.6;
      // The companion of a Type Ia survives and flies off at its orbital speed.
      if (binary && playing) companion.position.set(1.25 + elapsed * 0.25, 0, 0.2 + elapsed * 0.9);
      progenitor.material.uniforms.uGain.value = setup.kind === 'sn2' ? 0.9 + 0.1 * Math.sin(time * 1.3) : 1;

      // Detonation flash.
      const flashT = playing ? elapsed : -1;
      const dim = FLASH_DIM[reducedFlash ? 'reduced' : 'usual'];
      const flashPower = (solar ? 0.3 : 1) * dim.glare;
      flashSprite.visible = flashT >= 0 && flashT < 6;
      if (flashSprite.visible) {
        flashSprite.scale.setScalar((6 + 46 * Math.exp(-flashT * 2.6)) * (solar ? 0.4 : burst ? 0.6 : 1));
        flashSprite.material.opacity = Math.exp(-flashT * 1.5) * flashPower;
        flashSprite.material.color.copy(look.light);
      }

      // The fronts, at the real size they have at this second of the time-lapse: the light all round, and
      // what follows it: a blast all round, a cloud toward Earth, or (a burst) the rays in the beam toward
      // Earth and in the one the opposite way. Once the last body has been reached they run on and fade.
      const fronts = labFrontsAU(setup, playing ? labClockRealSec(clock, elapsed) : 0);
      const lastArrivalSec = clock.knots[clock.knots.length - 1]?.sec ?? 0;
      const fade = playing ? THREE.MathUtils.clamp(1 - (elapsed - lastArrivalSec - 1) / FRONT_FADE_SEC, 0, 1) : 0;
      const toEarth = Math.atan2(earthReal.z - srcReal.z, earthReal.x - srcReal.x);
      const frontAU = burst ? fronts.lightAU : fronts.blastAU ?? 0;
      const halfRad = burst ? BURST_HALF_WIDTH_RAD : solar ? CME_HALF_WIDTH_RAD : Math.PI;
      const thin = burst ? 1 - BURST_CLOSE_THIN * close : 1;
      const lineWidth = FRONT_LINE_WIDTH * dist;
      lightBand.visible = !burst && fade > 0.004;
      if (lightBand.visible) {
        layRibbon(lightBand, traceFront(fronts.lightAU, toEarth, Math.PI), null, lineWidth);
        lightBand.material.uniforms.uAlpha.value = (solar ? 0.3 : 0.6) * fade;
      }
      edgeBands.forEach((edge, i) => {
        const glow = glowBands[i];
        edge.visible = fade > 0.004 && frontAU > 0 && (i === 0 || burst);
        glow.visible = edge.visible;
        if (!edge.visible) return;
        const count = traceFront(frontAU, toEarth + i * Math.PI, halfRad);
        layRibbon(edge, count, null, lineWidth * 1.4);
        // A cloud's veil fills the cloud back to the Sun. A burst's lies in the cone its rays have swept and
        // a blast's in the shell of ejecta behind the shock, neither farther back than a short way on the map.
        layRibbon(glow, count, burst || solar ? 0 : frontAU * 0.8, solar ? Infinity : FRONT_VEIL_REACH);
        edge.material.uniforms.uAlpha.value = fade * thin;
        glow.material.uniforms.uAlpha.value = (solar ? 0.3 : 0.2) * fade * thin;
      });

      // The hot bubble at the explosion's own place.
      fireball.visible = !solar && playing && elapsed < 14;
      fireball.scale.setScalar((0.5 + 2.4 * (1 - Math.exp(-elapsed * 0.9))) * (burst ? 0.45 : 1));
      fireball.material.uniforms.uAlpha.value = playing ? 1.6 * dim.light * Math.exp(-elapsed * 0.32) : 0;
      fireball.material.uniforms.uSeed.value = 12.9 + elapsed * 0.25;
      fireball.rotation.y = elapsed * 0.3;

      ejectaPoints.visible = !burst && fade > 0.004 && frontAU > 0;
      if (ejectaPoints.visible) {
        for (let i = 0; i < EJECTA_PARTICLES; i++) {
          const a = toEarth + ejectaTurn[i];
          const r = frontAU * ejectaSpeed[i] * Math.cos(ejectaLift[i]);
          const spot = labProject({ x: srcReal.x + Math.cos(a) * r, z: srcReal.z + Math.sin(a) * r }, earthReal);
          ejectaPos[i * 3] = spot.x;
          // Out of the plane a grain rises by a share of the way it has come on the map.
          ejectaPos[i * 3 + 1] = Math.sin(ejectaLift[i]) * 0.35 * Math.hypot(spot.x - srcPos.x, spot.z - srcPos.z);
          ejectaPos[i * 3 + 2] = spot.z;
        }
        (ejectaGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
        ejectaMat.uniforms.uOpacity.value = Math.min(0.55, fade);
        ejectaMat.uniforms.uSize.value = 0.25;
      }

      pulsar.visible = setup.kind === 'sn2' && playing && elapsed > 2.2;
      if (pulsar.visible) {
        pulsar.rotation.y = time * 5;
        pulsarGlow.material.opacity = reducedFlash ? 0.6 : 0.55 + 0.45 * Math.sin(time * 30);
      }

      // ── Earth's response ──
      // The light curve: bright at once, fading slowly.
      const curve = (since: number): number => (since >= 0 ? ramp(since, 0.3) * (0.35 + 0.65 * Math.exp(-since * 0.1)) : 0);
      earthUniforms.uTime.value = time;
      earthUniforms.uBlastDir.value.copy(srcPos).sub(earthGroup.position).normalize();
      earthUniforms.uFlash.value = o.flash * dim.light * curve(sinceLight);
      earthUniforms.uScorch.value = o.scorch * ramp(sinceLight - 0.3, 1.5);
      ozoneUniforms.uLoss.value = o.ozone * ramp(sinceLight - 0.8, 2.6);
      const airLost = o.atmosphere * ramp(sinceShock - 0.2, 2.2);
      earthUniforms.uOceans.value = o.oceans * ramp(sinceShock - 1.0, 2.6);
      earthUniforms.uCrust.value = o.crust * ramp(sinceShock - 2.0, 3.0);
      earthUniforms.uShockGlow.value = sinceShock >= 0 ? Math.exp(-sinceShock * 1.6) * (0.25 + o.atmosphere) : 0;
      atmoUniforms.uAmount.value = 1 - airLost;
      atmoUniforms.uHeat.value = Math.max(o.scorch * ramp(sinceLight, 1.5), airLost);
      ozoneMesh.visible = ozoneUniforms.uShow.value > 0 && airLost < 0.6;

      // Auroras and the power grid.
      const storm = solar ? ramp(sinceShock - 0.6, 2.2) : ramp(sinceShock, 1.5);
      earthUniforms.uAurora.value = (solar ? 0.22 : 0) + o.aurora * storm * (1 - o.breakup);
      const quietLat = 65;
      earthUniforms.uAuroraLat.value = THREE.MathUtils.degToRad(quietLat + (impact.auroraLatDeg - quietLat) * storm);
      earthUniforms.uBlackout.value = o.blackout * ramp(sinceShock - 2.0, 1.6);

      // Magnetosphere squeezed by the cloud, with a rebound as the front passes.
      if (magGroup.visible) {
        const target = Math.max(0.42, Math.min(1, impact.standoffRe / 10.5));
        const hit = ramp(sinceShock, 0.8);
        const ring = sinceShock > 0 ? Math.exp(-sinceShock * 1.2) * Math.sin(sinceShock * 7) * 0.05 : 0;
        const squeeze = 1 + (target - 1) * hit + ring;
        shapeField(squeeze);
        // Its edge is drawn where the model puts it, on the scale the spacecraft are drawn on.
        const edgeRe = Math.max(1, 10.5 + (impact.standoffRe - 10.5) * hit + ring * 10.5);
        bowShock.scale.setScalar(magRadius(edgeRe) / 3.9);
        // Lit while the front passes; stays aglow in proportion to how far it has been pushed in.
        bowUniforms.uGlow.value = sinceShock >= 0 ? Math.min(1, (1 - target) * 1.2 + 0.8 * Math.exp(-sinceShock * 0.8)) : 0;
        fieldMat.opacity = 0.32 + 0.4 * Math.min(1, bowUniforms.uGlow.value);
        // Spacecraft take the colour of how they fare once the cloud is on them: the sentinels at L1 a moment
        // before Earth.
        for (const sat of satMarkers) {
          sat.holder.visible = sat.present;
          if (sat.def.id !== 'l1') sat.craft.rotation.y = time * (sat.def.id === 'iss' ? 1.4 : 0.1);
          const colour = SAT_COLOUR[sinceShock >= (sat.def.id === 'l1' ? -0.6 : 0.3) ? sat.state : 'inside'];
          sat.line.color.setHex(colour);
          sat.dots.color.setHex(colour);
        }
      }

      // Air torn off into a tail, and the planet coming apart. A close view leaves out what has been torn off the
      // bodies larger than the one in focus: the tokens are not to scale with one another, and the wreckage of a
      // large one would bury its small neighbours.
      const body = focusBody();
      const wreckShows = (of: FocusBody): boolean => close < 0.5 || of.radius <= body.radius;
      const broken = sinceBreakup >= 0;
      earthWreck.group.visible = wreckShows(earthBody);
      earthWreck.update(airLost, sinceShock, sinceBreakup, EARTH_TOKEN_R);
      earthMesh.visible = !broken || sinceBreakup < 0.7;
      atmoMesh.visible = !broken;
      earthMesh.scale.setScalar(broken ? Math.max(0.01, 1 - sinceBreakup / 0.7) : 1);

      // The blast pushes Earth (or its remains) away from the explosion.
      const push = sinceShock >= 0 ? o.kick * KICK_RADII * EARTH_TOKEN_R * (1 - Math.exp(-sinceShock * 0.22)) : 0;
      earthGroup.position.copy(earthHome).addScaledVector(away, push);
      earthBody.push = push;
      earthBody.since = sinceShock;
      earthBody.jolt = 0.15 + o.atmosphere + o.breakup;
      const carried = push > 0.5 * EARTH_SCALE;
      originRing.visible = carried;
      driftLine.visible = carried;
      if (carried) {
        const ends = driftGeo.getAttribute('position') as THREE.BufferAttribute;
        ends.setXYZ(0, earthHome.x, 0, earthHome.z);
        ends.setXYZ(1, earthGroup.position.x, 0, earthGroup.position.z);
        ends.needsUpdate = true;
      }
      earthOrbit.visible = !carried;
      tokens.forEach((p, n) => {
        const orbit = orbits[n];
        if (orbit) orbit.visible = p.onMap;
        if (p.def.id === 'moon') moonOrbit.visible = p.onMap && !carried;
      });
      earthMesh.rotation.y += flow * 0.08;

      // Every named body says where it is on the screen and how big; the names are set out after that.
      const focal = viewH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      const tagH = TAG_HEIGHT * focal;
      camera.getWorldDirection(camFwd);
      const pxAt = (p: THREE.Vector3): number => focal / Math.max(1, scratchA.copy(p).sub(camera.position).dot(camFwd));
      const name = (tag: NameTag, at: THREE.Vector3, radiusPx: number, show: number): void => {
        scratchA.copy(at).project(camera);
        // A body behind the camera is off the screen and in nobody's way.
        const ahead = scratchA.z <= 1;
        tag.at.copy(at);
        tag.x = ahead ? (0.5 + scratchA.x * 0.5) * viewW : -1e6;
        tag.y = (0.5 - scratchA.y * 0.5) * viewH;
        tag.radiusPx = radiusPx;
        tag.show = ahead ? show : 0;
      };
      /** Whether Earth stands between the camera and a point. */
      const behindEarth = (at: THREE.Vector3): boolean => {
        scratchA.copy(at).sub(camera.position);
        const depth = scratchA.length();
        const along = scratchB.copy(earthGroup.position).sub(camera.position).dot(scratchA) / depth;
        return along > 0 && along < depth && scratchB.lengthSq() - along * along < LAB_EARTH_R * LAB_EARTH_R;
      };
      /** How clearly a body's level ring shows: in full from far out, gone once the body itself is large in the view. */
      const markOpacity = (radiusPx: number): number => 0.85 * (1 - THREE.MathUtils.smoothstep(radiusPx, 30, 70));
      const carriedEnds = carriedGeo.getAttribute('position') as THREE.BufferAttribute;

      // ── the Moon and the other planets: each answers the explosion from where it stands ──
      tokens.forEach((p, n) => {
        const fate = p.onMap ? p.fate : null;
        const out = fate?.outcome ?? UNTOUCHED;
        const sinceLit = playing && fate ? elapsed - fate.lightAtSec : -1;
        const sinceHit = playing && fate && fate.shockAtSec !== null ? elapsed - fate.shockAtSec : -1;
        const sinceGone = out.breakup >= LAB_BREAKUP_AT ? sinceHit - BREAKUP_DELAY_SEC : -1;
        const gone = sinceGone >= 0;
        const lost = out.air * ramp(sinceHit - 0.2, 2.2);
        const gale = out.storm * ramp(sinceHit - 0.4, 1.8);
        p.push = sinceHit >= 0 ? out.kick * KICK_RADII * p.radius * (1 - Math.exp(-sinceHit * 0.22)) : 0;
        p.since = sinceHit;
        p.jolt = 0.15 + out.air + out.breakup;
        p.at.copy(p.home).addScaledVector(p.away, p.push);
        // Tokens never shrink below a few pixels, so every body can be found from far out.
        const px = pxAt(p.at);
        const size = Math.max(p.def.radius, p.def.minPx / px);
        const radiusPx = size * p.def.reach * px;
        p.holder.visible = p.onMap;
        p.holder.scale.setScalar(size);
        p.globe.rotation.y += flow * 0.15;
        p.globe.visible = !gone || sinceGone < 0.7;
        p.globe.scale.setScalar(gone ? Math.max(0.01, 1 - sinceGone / 0.7) : 1);
        const u = p.globe.material.uniforms;
        u.uTime.value = time;
        u.uFlash.value = out.flash * dim.light * curve(sinceLit);
        // A giant that loses its upper layers shows the hot gas under them.
        u.uScorch.value = Math.max(out.scorch * ramp(sinceLit - 0.3, 1.5), p.def.giant ? lost : 0);
        u.uMelt.value = out.melt * ramp(sinceHit - 2.0, 3.0);
        u.uBare.value = p.def.cloudDeck ? lost : 0;
        u.uShock.value = sinceHit >= 0 ? Math.exp(-sinceHit * 1.6) * (0.25 + out.air + out.storm) : 0;
        u.uAurora.value = fate && fate.standoffRadii > 0 ? gale : 0;
        if (p.ring) {
          p.ring.visible = !gone;
          ringUniforms.uFade.value = 1 - lost;
        }
        // The tail: air blown off by the blast or, in a solar eruption, gas dragged from a planet that has air
        // but no magnetic field to hold the cloud off.
        const tail = fate && fate.standoffRadii === 0 && p.def.gas !== null ? Math.max(lost, gale * 0.45) : lost;
        p.wreck.group.visible = p.onMap && wreckShows(p);
        p.wreck.group.position.copy(p.at);
        p.wreck.group.scale.setScalar(size);
        p.wreck.update(tail, sinceHit, sinceGone, size);
        p.mark.visible = !concealed && fate !== null && fate.level !== 'safe' && !gone;
        p.mark.position.copy(p.at);
        p.mark.scale.setScalar(size * p.def.reach);
        p.mark.material.opacity = markOpacity(radiusPx);
        // A line from where the body stood to where the blast has carried it.
        const moved = p.onMap && p.push > 0.3 ? p.at : p.home;
        carriedEnds.setXYZ(n * 2, p.home.x, 0, p.home.z);
        carriedEnds.setXYZ(n * 2 + 1, moved.x, 0, moved.z);
        // The Moon's name goes with it behind Earth, and is for close views: from far out it would sit on Earth's.
        const moon = p.def.id === 'moon';
        const seen = p.onMap && !gone && !(moon && behindEarth(p.at));
        name(p.tag, p.at, seen ? radiusPx : 0, seen ? 0.92 * (moon ? 1 - THREE.MathUtils.smoothstep(dist, 30, 46) : 1) : 0);
      });

      // ── the Sun ──
      // A supernova or a burst close by tears off some of its outer layers and pushes it. In a solar eruption it
      // is itself what erupts, and sits at the chosen spot.
      const sunFate = solar ? null : sunBody.fate;
      const sunOut = sunFate?.outcome ?? UNTOUCHED;
      const sunHit = playing && sunFate && sunFate.shockAtSec !== null ? elapsed - sunFate.shockAtSec : -1;
      const sunGone = sunOut.breakup >= LAB_BREAKUP_AT ? sunHit - BREAKUP_DELAY_SEC : -1;
      sunBody.push = sunHit >= 0 ? sunOut.kick * KICK_RADII * sunBody.radius * (1 - Math.exp(-sunHit * 0.22)) : 0;
      sunBody.since = sunHit;
      sunBody.jolt = 0.15 + sunOut.air + sunOut.breakup;
      sunPos.copy(solar ? srcPos : sunBody.home).addScaledVector(sunBody.away, sunBody.push);
      sunMesh.position.copy(sunPos);
      sunLight.position.copy(sunPos);
      sunPosUniform.value.copy(sunPos);
      earthUniforms.uSunDir.value.copy(sunPos).sub(earthGroup.position).normalize();
      const sunPx = pxAt(sunPos);
      const sunSize = Math.max(SUN_TOKEN_R, 7 / sunPx);
      sunMesh.visible = !solar && sunGone < 0.7;
      sunMesh.scale.setScalar(sunSize * (sunGone >= 0 ? Math.max(0.01, 1 - sunGone / 0.7) : 1));
      // Struck by the blast, it flares up for a moment; while the explosion's light is on it, the side facing
      // the explosion is overheated.
      const sunLit = playing && sunFate ? elapsed - sunFate.lightAtSec : -1;
      sunMat.uniforms.uGain.value = 1 + (sunHit >= 0 ? 1.4 * dim.light * Math.exp(-sunHit * 1.2) * (0.3 + sunOut.air) : 0);
      sunMat.uniforms.uHeat.value = 1.6 * dim.light * sunOut.scorch * ramp(sunLit - 0.3, 1.5);
      sunMat.uniforms.uHeatDir.value.copy(starPos).sub(sunPos).normalize();
      sunBody.wreck.group.visible = !solar && wreckShows(sunBody);
      sunBody.wreck.group.position.copy(sunPos);
      sunBody.wreck.group.scale.setScalar(sunSize);
      sunBody.wreck.update(sunOut.air * ramp(sunHit - 0.2, 2.2), sunHit, sunGone, sunSize);
      sunBody.mark.visible = !concealed && sunFate !== null && sunFate.level !== 'safe' && sunGone < 0;
      sunBody.mark.position.copy(sunPos);
      sunBody.mark.scale.setScalar(sunSize);
      sunBody.mark.material.opacity = markOpacity(sunSize * sunPx);
      const sunMoved = sunBody.push > 0.3 ? sunPos : sunBody.home;
      carriedEnds.setXYZ(tokens.length * 2, sunBody.home.x, 0, sunBody.home.z);
      carriedEnds.setXYZ(tokens.length * 2 + 1, sunMoved.x, 0, sunMoved.z);
      carriedEnds.needsUpdate = true;
      name(sunTag, sunPos, (solar ? look.starRadius * BLAST_SCALE : sunSize) * 1.3 * sunPx, sunGone >= 0 ? 0 : 0.92);

      const earthPx = EARTH_TOKEN_R * pxAt(earthGroup.position);
      earthMark.visible = !concealed && impact.level !== 'safe' && !broken;
      earthMark.position.copy(earthGroup.position);
      earthMark.material.opacity = markOpacity(earthPx);

      // The spacecraft are named in views close enough to tell them apart.
      const satShow = magGroup.visible ? 0.9 * (1 - THREE.MathUtils.smoothstep(dist, 8, 14)) : 0;
      for (const sat of satMarkers) {
        sat.holder.updateWorldMatrix(true, false);
        sat.holder.localToWorld(sat.at.copy(sat.def.tagAt));
        name(sat.tag, sat.at, 4, sat.present ? satShow : 0);
      }

      // ── camera ──
      const k = Math.min(1, dt * ease);
      lon += (tLon - lon) * k;
      lat += (tLat - lat) * k;
      dist += (tDist - dist) * k;
      close += (tClose - close) * k;

      name(earthTag, earthGroup.position, broken ? 0 : earthPx, broken ? 0 : 0.95);
      name(blastTag, starPos, look.starRadius * BLAST_SCALE * 1.3 * pxAt(starPos), solar ? 0 : 0.95);
      name(originTag, earthHome, carried ? EARTH_TOKEN_R * pxAt(earthHome) : 0, carried ? 0.95 : 0);
      for (const mark of landmarks) {
        // A star of the map that explodes is the explosion itself.
        const exploding = mark.position.distanceToSquared(srcPos) < 0.3;
        const px = pxAt(mark.position);
        const glow = Math.max(mark.body.kind === 'nebula' ? 3 : 2.2, 18 / px);
        mark.glow.visible = !exploding;
        mark.core.visible = !exploding;
        mark.glow.scale.setScalar(glow);
        mark.core.scale.setScalar(glow * 0.3);
        name(mark.tag, mark.position, exploding ? 0 : glow * 0.2 * px, exploding ? 0 : 0.92);
      }
      for (let i = 0; i < nameTags.length; i++) {
        const tag = nameTags[i];
        let show = tag.show;
        tag.written = false;
        if (show > 0.01) {
          // A name stands close to its body, on the side where it stood, unless another side is clearer; where
          // no side is clear it stands a little farther out.
          let best = tag.side;
          let bestLift = 0;
          let clash = 3;
          for (let lift = 0; lift <= 1 && clash > 0; lift++) {
            for (let k = -1; k < TAG_SIDES.length && clash > 0; k++) {
              const side = k < 0 ? tag.side : TAG_SIDES[k];
              setNameBox(tag, side, lift, tagH);
              const there = nameClash(i);
              if (there < clash) {
                best = side;
                bestLift = lift;
                clash = there;
              }
            }
          }
          tag.side = best;
          tag.lift = bestLift;
          // A name that would be written over a body or over another name gives way to it.
          if (clash > 0) show = 0;
          tag.written = show > 0.01;
        }
        setNameBox(tag, tag.side, tag.lift, tagH);
        tag.sprite.position.copy(tag.at);
        // The sprite is ten times as wide as it is high; its middle goes to the middle of the box.
        tag.sprite.center.set(0.5 - ((tag.left + tag.right) / 2 - tag.x) / (tagH * 10), 0.5 + ((tag.top + tag.bottom) / 2 - tag.y) / tagH);
        const mat = tag.sprite.material;
        mat.opacity += (show - mat.opacity) * Math.min(1, dt * 10);
      }
      // Ring labels: on the side of the ring that faces the camera, stepping along it out of the way of bodies
      // and of their names. A label stays where it stood for as long as that place is clear.
      for (const ringLabel of ringLabels) {
        const halfW = ringLabel.item.widthShare * tagH * 5;
        for (let n = -1; n < RING_LABEL_TURNS.length; n++) {
          const turn = n < 0 ? ringLabel.turn : RING_LABEL_TURNS[n];
          scratchB.set(Math.cos(lon + turn) * ringLabel.radius, 0.05, Math.sin(lon + turn) * ringLabel.radius);
          scratchA.copy(scratchB).project(camera);
          const x = (0.5 + scratchA.x * 0.5) * viewW;
          // The label hangs below its point of the ring.
          const mid = (0.5 - scratchA.y * 0.5) * viewH + tagH * 0.55;
          let free = true;
          for (const tag of nameTags) {
            const dx = tag.x - THREE.MathUtils.clamp(tag.x, x - halfW, x + halfW);
            const dy = tag.y - THREE.MathUtils.clamp(tag.y, mid - tagH * 0.3, mid + tagH * 0.3);
            const overBody = dx * dx + dy * dy < tag.radiusPx * tag.radiusPx;
            const overName = tag.written && x - halfW < tag.right && x + halfW > tag.left && mid - tagH * 0.3 < tag.bottom && mid + tagH * 0.3 > tag.top;
            if (overBody || overName) {
              free = false;
              break;
            }
          }
          if (free) {
            ringLabel.turn = turn;
            break;
          }
        }
        ringLabel.item.sprite.position.set(Math.cos(lon + ringLabel.turn) * ringLabel.radius, 0.05, Math.sin(lon + ringLabel.turn) * ringLabel.radius);
      }
      const cp = Math.cos(lat);
      if (evaMode && suit) {
        const fwd = new THREE.Vector3(-cp * Math.cos(lon), -Math.sin(lat), -cp * Math.sin(lon)).normalize();
        const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
        const thrust = new THREE.Vector3().addScaledVector(right, evaInput.mx).addScaledVector(fwd, evaInput.mz).addScaledVector(up, evaInput.my);
        if (thrust.lengthSq() > 0.001) {
          evaVel.lerp(thrust.normalize().multiplyScalar(evaInput.boost ? 12 : 5), Math.min(1, dt * 3));
        } else {
          evaVel.multiplyScalar(Math.exp(-dt * 1.4));
        }
        // A passing front (a blast, a cloud, a burst's rays) shoves the astronaut away from the explosion:
        // once, as it passes the real place the astronaut's spot on the map stands for, and only where the
        // front is (a cloud's cone, a burst's two beams).
        const astro = labUnproject({ x: evaPos.x, z: evaPos.z }, earthReal);
        const astroAU = Math.hypot(astro.x - srcReal.x, astro.z - srcReal.z);
        const offAxis = Math.abs(Math.atan2(astro.z - srcReal.z, astro.x - srcReal.x) - toEarth) % (2 * Math.PI);
        const fromAxis = Math.min(offAxis, 2 * Math.PI - offAxis);
        const inFront = fromAxis <= halfRad || (burst && fromAxis >= Math.PI - halfRad);
        if (running && inFront && frontWasAU < astroAU && frontAU >= astroAU) {
          evaVel.addScaledVector(scratchA.copy(evaPos).sub(srcPos).setY(0).normalize(), EVA_SHOVE * fade);
        }
        frontWasAU = frontAU;
        evaPos.addScaledVector(evaVel, dt);
        suit.root.position.copy(evaPos);
        suit.root.rotation.y = -lon + Math.PI / 2;
        poseSuit(suit, {
          lRaise: 18 + Math.sin(time * 1.6) * 6, lSpread: 14, lElbow: 32,
          rRaise: 18 - Math.sin(time * 1.6) * 6, rSpread: 14, rElbow: 32,
          lHip: 12, lKnee: 28, rHip: 6, rKnee: 22,
        });
        const back = Math.min(3.5, dist * 0.2);
        camera.position.set(evaPos.x + back * cp * Math.cos(lon), evaPos.y + back * Math.sin(lat) + 0.6, evaPos.z + back * cp * Math.sin(lon));
        camera.lookAt(evaPos);
      } else {
        // Overview: centred on the Sun. Close view: aimed just
        // ahead of the body in focus, following it most of the way as it is carried off and backing away a little.
        const lead = Math.min(body.home.distanceTo(srcPos) * 0.5, ((4.5 - 2 * Math.min(1, body.push / (KICK_RADII * body.radius))) * body.radius) / LAB_EARTH_R);
        const aim = tmp.copy(body.home).addScaledVector(body.away, body.push * 0.82 - lead).multiplyScalar(close);
        const range = dist + body.push * 0.45 * close;
        camera.position.set(aim.x + range * cp * Math.cos(lon), range * Math.sin(lat), aim.z + range * cp * Math.sin(lon));
        // The blast shakes the view as it reaches the body in focus.
        if (body.since >= 0 && body.since < 1.6) {
          const shake = (0.22 * body.jolt * Math.exp(-body.since * 2.6) * body.radius) / LAB_EARTH_R;
          camera.position.x += Math.sin(time * 71) * shake;
          camera.position.y += Math.sin(time * 83 + 1.3) * shake;
        }
        camera.lookAt(aim.x, 0, aim.z);
      }
    },

    layoutFor(jdTT: number): LabBody[] {
      const places = geocentricPlaces(jdTT);
      // Ecliptic longitude runs anticlockwise seen from the north; the map is looked at from the north.
      const sunAngle = -THREE.MathUtils.degToRad(places.sun.lonDeg);
      earthReal = labPlaceFromEarth({ x: 0, z: 0 }, sunAngle + Math.PI, places.sun.distanceAU);
      const earthSpot = labProject(earthReal, earthReal);
      earthHome.set(earthSpot.x, 0, earthSpot.z);
      earthOrbit.scale.setScalar(earthHome.length());
      lensEdge.position.copy(earthHome);
      originRing.position.copy(earthHome);
      const bodies: LabBody[] = [{ id: 'sun', name: BODY_NAMES.sun, kind: 'sun', angleRad: sunAngle, distanceAU: places.sun.distanceAU }];
      tokens.forEach((p, n) => {
        const place = places[p.def.place];
        const angleRad = -THREE.MathUtils.degToRad(place.lonDeg);
        const host = tokens.find((other) => other.id === p.def.host);
        if (host) {
          // A moon of another planet is at its planet's place in space, a few thousandths of an AU from it:
          // its token stands beside the planet's, ahead of it on its orbit.
          const gap = (host.def.radius * host.def.reach + p.def.radius) * 1.3;
          p.home.set(-host.home.z, 0, host.home.x).normalize().multiplyScalar(gap).add(host.home);
        } else {
          const spot = labProject(labPlaceFromEarth(earthReal, angleRad, place.distanceAU), earthReal);
          p.home.set(spot.x, 0, spot.z);
        }
        orbits[n]?.scale.setScalar(p.home.length());
        if (p.def.id === 'moon') {
          // The Moon's way round Earth, as the magnified neighbourhood shows it.
          const way = moonOrbit.geometry.getAttribute('position') as THREE.BufferAttribute;
          for (let i = 0; i < way.count; i++) {
            const spot = labProject(labPlaceFromEarth(earthReal, (i / (way.count - 1)) * Math.PI * 2, place.distanceAU), earthReal);
            way.setXYZ(i, spot.x, 0, spot.z);
          }
          way.needsUpdate = true;
        }
        bodies.push({ id: p.id, name: p.def.name, kind: p.def.id === 'moon' || p.def.host !== null ? 'moon' : 'planet', angleRad, distanceAU: place.distanceAU });
      });
      clickable = [
        { tag: sunTag, body: bodies[0] },
        ...tokens.map((p, i) => ({ tag: p.tag, body: bodies[i + 1] })),
        ...landmarks.map((mark) => ({ tag: mark.tag, body: mark.body })),
      ];
      laidOut = clickable.map((entry) => entry.body);
      applyConfig();
      seedWreckage();
      return [...laidOut].sort((a, b) => a.distanceAU - b.distanceAU);
    },

    configure(next: LabSetup, keepView: boolean): void {
      const kindChanged = next.kind !== setup.kind;
      setup = next;
      applyConfig();
      if (kindChanged) seedEjecta();
      seedWreckage();
      if (!keepView) frameView();
    },

    setResults(results: LabResults): void {
      ({ impact, runSec, clock } = results);
      earthMark.material.color.setHex(LEVEL_COLOUR[impact.level]);
      for (const body of [sunBody, ...tokens]) {
        body.fate = results.fates.find((f) => f.id === body.id) ?? null;
        body.mark.material.color.setHex(LEVEL_COLOUR[body.fate?.level ?? 'safe']);
      }
      for (const sat of satMarkers) {
        const fares = impact.satellites.find((s) => s.id === sat.def.id);
        sat.present = fares !== undefined;
        sat.state = fares?.state ?? 'inside';
      }
    },

    setFocus(bodyId: string, goClose: boolean): void {
      focusId = bodyId;
      if (goClose) chosen = 'close';
      // A close view goes over to the new body; an overview stays as it is.
      if (goClose || framing === 'close') applyFraming('close');
      ease = 2.4;
    },

    setRemoved(ids: string[]): void {
      for (const p of tokens) p.onMap = !ids.includes(p.id);
    },

    setConcealed(on: boolean): void {
      concealed = on;
      styleRings();
    },

    detonate(): void {
      playing = true;
      paused = false;
      elapsed = 0;
      frontWasAU = 0;
    },

    resetExplosion(): void {
      // The run that ends here may have shoved the astronaut away: the next one starts beside Earth again.
      if (playing) homeAstronaut();
      playing = false;
      paused = false;
      elapsed = 0;
    },

    setPaused(on: boolean): void {
      paused = on;
    },

    seek(elapsedSec: number): void {
      if (playing) elapsed = Math.min(runSec, Math.max(0, elapsedSec));
    },

    elapsedSec(): number {
      return playing ? elapsed : 0;
    },

    setEvaMode(on: boolean): void {
      if (on !== evaMode) {
        // Flying, the camera sits low behind the astronaut; afterwards it goes back to the map.
        if (on) {
          tLat = 0.32;
          homeAstronaut();
        } else if (!manual) {
          applyFraming(framing);
        }
        ease = 2.4;
      }
      evaMode = on;
      if (on) ensureSuit();
      if (suit) suit.root.visible = on;
    },

    setEvaKeys(mx: number, mz: number, my: number, boost: boolean): void {
      evaInput.mx = mx;
      evaInput.mz = mz;
      evaInput.my = my;
      evaInput.boost = boost;
    },

    onPlace(cb): void {
      placeCb = cb;
    },

    onLockedClick(cb): void {
      lockedCb = cb;
    },

    setFraming(next: LabFraming): void {
      chosen = next;
      applyFraming(next);
      ease = 2.4;
    },

    setInsets(leftPx: number, rightPx: number): void {
      if (leftPx === insetL && rightPx === insetR) return;
      insetL = leftPx;
      insetR = rightPx;
      if (manual) return;
      applyFraming(framing);
      snapView();
    },

    setLang(lang: Lang): void {
      setLabels(lang);
    },

    setReducedFlash(on: boolean): void {
      reducedFlash = on;
    },

    setMarkers(): void { /* this view has no markers */ },
    setSelection(): void { /* this view has no selection */ },
    setSelectedMarker(): void { /* this view has no markers */ },

    attach(dom: HTMLElement): void {
      if (el === dom) return;
      this.detach();
      el = dom;
      dom.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      dom.addEventListener('wheel', onWheel, { passive: false });
    },

    detach(): void {
      if (!el) return;
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el = null;
      drag = false;
    },

    resize(w: number, h: number): void {
      viewW = w;
      viewH = Math.max(1, h);
      camera.aspect = w / viewH;
      camera.updateProjectionMatrix();
      sizeGrains(h);
      if (manual) return;
      applyFraming(framing);
      snapView();
    },

    dispose(): void {
      this.detach();
      disposed = true;
      for (const map of maps) map.dispose();
      for (const g of [
        starGeo, unitSphere, debrisGeo, fieldGeo, bowGeo, orbitGeo, craftGeo, oneCraftGeo, linkGeo, discGeo, beamGeo, circleGeo, moonOrbitGeo,
        ejectaGeo, originGeo, driftGeo, carriedGeo, markGeo, ringGeo, skyDome.geometry, earthMesh.geometry, markerRing.geometry, ...ringGeos,
        ...[lightBand, ...edgeBands, ...glowBands].map((band) => band.geometry),
      ]) g.dispose();
      for (const m of [
        starMat, skyMat, ringMat, sunMat, starMat2, companionMat, earthMat, atmoMat, ozoneMat, fieldMat, bowMat, discMat, beamMat, ejectaMat,
        originMat, carriedMat, orbitMat, earthOrbitMat, lensMat, earthMark.material, sunGlow.material, linkLine.material, markerRing.material,
        progenitorGlow.material, flashSprite.material, pulsarGlow.material, fireball.material,
        ...[lightBand, ...edgeBands, ...glowBands].map((band) => band.material),
      ]) m.dispose();
      for (const look of ringLooks) look.line.dispose();
      for (const sat of satMarkers) {
        sat.line.dispose();
        sat.dots.dispose();
      }
      earthWreck.dispose();
      for (const body of [sunBody, ...tokens]) {
        body.wreck.dispose();
        body.mark.material.dispose();
      }
      for (const p of tokens) p.globe.material.dispose();
      for (const mark of landmarks) {
        mark.glow.material.dispose();
        mark.core.material.dispose();
      }
      for (const item of labelSprites) {
        item.sprite.material.map?.dispose();
        item.sprite.material.dispose();
      }
    },
  };
}
