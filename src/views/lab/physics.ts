/**
 * What an explosion does to Earth and to the other bodies of the map from a given distance:
 * order-of-magnitude models for the Explosion Lab.
 *
 * Supernovae
 *   - Brightness: peak absolute magnitude −17.5 (core collapse, Type II) or −19.3 (Type Ia), inverse-square law.
 *   - Blast: 10^44 J of kinetic energy in the ejecta; a body intercepts the share its disc covers,
 *     (R / 2d)². That energy is compared with what it takes to blow the atmosphere off, boil the oceans,
 *     melt the crust and take the body apart (its gravitational binding energy). Real coupling is less
 *     than complete, so these are upper bounds.
 *   - Ozone: scaled from Gehrels et al. (2003, ApJ 585, 1169), who find that a supernova within about
 *     8 pc (26 light years) roughly doubles the harmful ultraviolet reaching the ground.
 *   - Arrival of the blast: free expansion at 10,000 km/s, then the Sedov–Taylor law; beyond about
 *     100 light years the remnant merges into the interstellar gas before it gets here.
 * Gamma-ray bursts
 *   - The burst of Thomas et al. (2005, ApJ 622, L153; with NASA Goddard): 5×10^44 W for ten seconds as if
 *     it shone in all directions, which from 2 kpc (6,500 light years) puts 100 kJ through every square
 *     metre and takes away 35 % of the ozone layer on average. The energy really leaves in two opposite
 *     beams, taken here to be 12° wide: what lies outside them gets nothing.
 *   - Ozone loss is scaled from that case with the energy received; the energy a body intercepts is put
 *     against the same thresholds as a supernova's blast (upper bounds again). There is no blast wave: the
 *     rays are the whole event, and they arrive with the light.
 * Solar eruptions (CME)
 *   - Ram pressure of the cloud at 1 AU, falling with the square of the distance, in three strengths: an
 *     ordinary eruption (5 nPa, three and a half days on the way), the storm of May 2024 (30 nPa, two days)
 *     and one of the class of the Carrington event of 1859 (60 nPa; 17 h 40 min on the way, as recorded:
 *     Tsurutani et al. 2003, NASA JPL). Nobody measured the pressure in 1859: that value is this model's.
 *   - Magnetopause standoff from pressure balance, r = 10.5 R⊕ · (P / 2 nPa)^(−1/6).
 *   - Lowest latitude with aurora: a fit through quiet conditions (65°) and the May 2024 storm (about 30°).
 *   - Spacecraft near Earth are inside the magnetosphere or outside it according to that standoff; the
 *     sentinels at L1 meet the cloud first, by the time it takes to cover 1.5 million km.
 * The other bodies (the Moon, the Sun, the seven other planets, and Pluto, Titan and Europa when added)
 *   - Each is a sphere of its real radius and mass at its real distance from the explosion (in the plane of
 *     the map). The same energy thresholds apply, worked out from the body: the energy that lifts its air
 *     (or, for a giant planet or the Sun, the outer thousandth of its mass) out of its gravity, the energy
 *     that melts a crust like Earth's (or a 20 km shell of ice) over its surface, and its binding energy as
 *     a uniform sphere.
 *   - An explosion set at a body (it stands on the body's spot of the map, clear of its token so that both
 *     can be seen) is taken to be right beside that body, three of its radii from its centre, and its other
 *     distances are measured from the body's real place. Set at a planet it is the size of the moon's orbit
 *     away from a moon of that planet, and the other way round. The body counts as on the axis of a burst.
 *   - A supernova's flash is compared with the light the body is used to: the sunlight it normally gets or,
 *     for a star, what its own surface gives off (σT⁴). The temperature of the side facing the flash follows
 *     the radiative balance, T ∝ (light received)^¼.
 *   - A CME is a cloud about 70° wide thrown from the Sun toward Earth: bodies outside that cone are missed.
 *     Where it strikes, a magnetosphere is squeezed by the same law as Earth's; a body without a global
 *     field takes the cloud on its upper atmosphere, or on its bare surface. A moon that orbits inside its
 *     planet's magnetosphere is covered by it until that is squeezed to inside the moon's orbit.
 * Everything here is a model for comparison, not a forecast.
 */
import type {
  L10n, LabBody, LabBodyClass, LabClock, LabCmeStrength, LabFate, LabImpact, LabImpactLevel, LabSatellite, LabSetup, Lang,
} from '../../core/types';
import { fmt, lf, tpl } from '../../core/l10n';
import {
  LAB_MAX_AU, LAB_MIN_AU, labEarthPlace, labPlaceFromEarth, labProject, LY_AU, type MapPoint,
} from './map';

const AU_KM = 149_597_870.7;
const PC_AU = 206_264.806;
const AU_M = 1.495978707e11;
const EARTH_RADIUS_M = 6.371e6;
const EARTH_MASS_KG = 5.972e24;
const LIGHT_KM_S = 299_792.458;
const YEAR_S = 365.25 * 86_400;
const SUN_APPARENT_MAG = -26.74;
/** Sunlight at Earth's distance, W/m². */
const SOLAR_CONSTANT = 1361;
/** Stefan–Boltzmann constant, W/m²/K⁴: a surface at temperature T gives off σT⁴. */
const STEFAN_BOLTZMANN = 5.670374e-8;

/** Energy it takes, in joules. */
const E_ATMOSPHERE = 3.2e26; // lift the 5.15×10^18 kg of air out of Earth's gravity
const E_OCEANS = 3.7e27; // heat 1.4×10^21 kg of sea water to 100 °C and boil it off
const E_CRUST = 4.8e28; // heat the 2.8×10^22 kg crust by 1300 K and melt it
const E_BINDING = 2.24e32; // Earth's gravitational binding energy
const GRAVITY_SI = 6.674e-11;
/** The same melting, per square metre of surface: Earth's crust, and a shell of ice 20 km thick warmed from 100 K. */
const CRUST_J_PER_M2 = E_CRUST / (4 * Math.PI * EARTH_RADIUS_M ** 2);
const ICE_J_PER_M2 = 1.1e13;

interface BodyTraits {
  bodyClass: LabBodyClass;
  radiusM: number;
  massKg: number;
  /** Mass of the atmosphere of a body of rock or ice, kg (0 where there is none to speak of). */
  airKg: number;
  /** Its usual temperature, K: of the surface, or of a giant's cloud tops. */
  tempK: number;
  /** Where the sunward edge of its magnetosphere stands in quiet solar wind, in its own radii (0: no global field). */
  quietStandoffRadii: number;
  /** A moon that orbits inside its planet's magnetosphere: the planet, and the size of the orbit in the planet's radii. */
  host?: { id: string; orbitRadii: number };
}

/**
 * The bodies of the map other than Earth. Radii, masses and atmospheres: NASA planetary fact sheets. Pluto's
 * thin nitrogen haze is not counted as air.
 */
const BODY_TRAITS: Record<string, BodyTraits> = {
  moon: { bodyClass: 'rocky', radiusM: 1.7374e6, massKg: 7.342e22, airKg: 0, tempK: 270, quietStandoffRadii: 0 },
  sun: { bodyClass: 'star', radiusM: 6.957e8, massKg: 1.9885e30, airKg: 0, tempK: 5772, quietStandoffRadii: 0 },
  mercury: { bodyClass: 'rocky', radiusM: 2.4397e6, massKg: 3.3011e23, airKg: 0, tempK: 440, quietStandoffRadii: 1.45 },
  venus: { bodyClass: 'rocky', radiusM: 6.0518e6, massKg: 4.8675e24, airKg: 4.8e20, tempK: 737, quietStandoffRadii: 0 },
  mars: { bodyClass: 'rocky', radiusM: 3.3895e6, massKg: 6.4171e23, airKg: 2.5e16, tempK: 210, quietStandoffRadii: 0 },
  jupiter: { bodyClass: 'giant', radiusM: 6.9911e7, massKg: 1.8982e27, airKg: 0, tempK: 165, quietStandoffRadii: 75 },
  saturn: { bodyClass: 'giant', radiusM: 5.8232e7, massKg: 5.6834e26, airKg: 0, tempK: 134, quietStandoffRadii: 22 },
  uranus: { bodyClass: 'giant', radiusM: 2.5362e7, massKg: 8.681e25, airKg: 0, tempK: 76, quietStandoffRadii: 18 },
  neptune: { bodyClass: 'giant', radiusM: 2.4622e7, massKg: 1.02413e26, airKg: 0, tempK: 72, quietStandoffRadii: 23 },
  europa: { bodyClass: 'icy', radiusM: 1.5608e6, massKg: 4.7998e22, airKg: 0, tempK: 102, quietStandoffRadii: 0, host: { id: 'jupiter', orbitRadii: 9.4 } },
  titan: { bodyClass: 'icy', radiusM: 2.5747e6, massKg: 1.3452e23, airKg: 9.1e18, tempK: 94, quietStandoffRadii: 0, host: { id: 'saturn', orbitRadii: 20.3 } },
  pluto: { bodyClass: 'icy', radiusM: 1.1883e6, massKg: 1.303e22, airKg: 0, tempK: 44, quietStandoffRadii: 0 },
};
/** The bodies that are off the map until they are added to it. */
export const LAB_EXTRA_IDS = ['europa', 'titan', 'pluto'];
/** Share of a giant planet's or a star's mass that counts as its outer layers. */
const OUTER_LAYERS_SHARE = 1e-3;

interface SupernovaModel {
  absMag: number;
  kineticJ: number;
  lightJ: number;
  ejectaKg: number;
  /** Relative output of ozone-destroying gamma rays and cosmic rays. */
  ozoneFactor: number;
}

const SUPERNOVA: Record<'sn2' | 'sn1a', SupernovaModel> = {
  sn2: { absMag: -17.5, kineticJ: 1.0e44, lightJ: 1.0e42, ejectaKg: 2.0e31, ozoneFactor: 1 },
  sn1a: { absMag: -19.3, kineticJ: 1.3e44, lightJ: 1.5e42, ejectaKg: 2.8e30, ozoneFactor: 1.5 },
};

const EJECTA_FRONT_KM_S = 10_000;
/** The remnant has merged into the interstellar gas by about this radius. */
const REMNANT_REACH_AU = 100 * LY_AU;
const OZONE_HAZARD_AU = 26 * LY_AU;

/** The burst of Thomas et al. (2005): its energy as if sent out in all directions, J, and how long it lasts, s. */
const BURST_ISOTROPIC_J = 5e45;
const BURST_SECONDS = 10;
/** From this far, 2 kpc, that burst takes away a third of the ozone layer. */
const BURST_HAZARD_AU = 6500 * LY_AU;
/** Half the width of each of the burst's two beams, radians: bodies farther from the axis are missed. */
export const BURST_HALF_WIDTH_RAD = 0.105;

/** The cloud of a solar eruption: its ram pressure at 1 AU, nPa, and its speed on the way, km/s. */
const CME: Record<LabCmeStrength, { pressureNPa: number; speedKmS: number }> = {
  ordinary: { pressureNPa: 5, speedKmS: 500 },
  may2024: { pressureNPa: 30, speedKmS: 870 },
  carrington: { pressureNPa: 60, speedKmS: 2360 },
};
const QUIET_PRESSURE_NPA = 2;
/** A planet's bow shock stands about a quarter farther out than the edge of its magnetosphere. */
const BOW_SHOCK_RATIO = 1.25;
/** Half the width of the cloud a solar eruption throws out, radians: bodies farther from its axis are missed. */
export const CME_HALF_WIDTH_RAD = 0.6;

/**
 * Where the spacecraft near Earth fly, from Earth's centre in Earth radii: the solar-wind sentinels at L1,
 * 1.5 million km sunward; the geostationary ring, 35,786 km up; GPS, 20,200 km up; the space station,
 * 420 km up. `edgeRe`: within this of the magnetosphere's edge an orbit counts as lying on it.
 */
const L1_KM = 1.5e6;
const ORBITS: Array<{ id: LabSatellite['id']; name: L10n; orbitRe: number; edgeRe: number }> = [
  { id: 'l1', name: { tr: 'L1 gözcüleri (DSCOVR, ACE, SOHO)', en: 'L1 sentinels (DSCOVR, ACE, SOHO)' }, orbitRe: L1_KM / (EARTH_RADIUS_M / 1000), edgeRe: 0 },
  { id: 'geo', name: { tr: 'Yer sabit uydular', en: 'Geostationary satellites' }, orbitRe: 6.62, edgeRe: 0.4 },
  { id: 'gps', name: { tr: 'GPS uyduları', en: 'GPS satellites' }, orbitRe: 4.17, edgeRe: 0.4 },
  { id: 'iss', name: { tr: 'Uluslararası Uzay İstasyonu', en: 'International Space Station' }, orbitRe: 1.07, edgeRe: 0 },
];

/** The seconds of the lab's time-lapse at which the explosion's light, and what follows it, reach a body. */
interface Arrivals {
  lightAtSec: number;
  frontAtSec: number;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
/** 0 at a tenth of the threshold, ½ at the threshold, 1 at ten times it. */
const reached = (energy: number, threshold: number): number => clamp01(0.5 + 0.5 * Math.log10(Math.max(energy, 1e-300) / threshold));
/**
 * A body comes apart once the energy that strikes it reaches its binding energy: ½ on the scale of
 * `reached`. The summary, the list of steps and the picture all turn on this one value.
 */
export const LAB_BREAKUP_AT = 0.5;
/** Display brightness of a light `flux` times the sunlight a body is used to: 0 … about 4. */
const flashOf = (flux: number): number => 1.2 * (flux / (1 + flux)) + 0.25 * Math.log10(1 + flux);
/** How far a steady light `flux` times the usual sunlight chars a surface, 0..1: from the Sun's own brightness up. */
const scorchOf = (flux: number): number => clamp01(Math.log10(Math.max(flux, 1e-12)) / 2.5);
/** The same for the ten seconds of a burst: nothing below 10 MJ/m², fully from about 3 GJ/m². */
const burstScorchOf = (fluenceJm2: number): number => clamp01(Math.log10(Math.max(fluenceJm2, 1) / 1e7) / 2.5);

/** A distance from Earth in the unit that suits it: thousands of km, AU or light years. */
export function distanceText(distanceAU: number): L10n {
  if (distanceAU < 0.05) {
    const thousandKm = (distanceAU * AU_KM) / 1000;
    return lf(tpl`${(l: Lang) => fmt(thousandKm, 0, l)} bin km`, tpl`${(l: Lang) => fmt(thousandKm, 0, l)} thousand km`);
  }
  if (distanceAU < 1000) {
    const digits = distanceAU < 10 ? 2 : 0;
    return lf(tpl`${(l: Lang) => fmt(distanceAU, digits, l)} AU`, tpl`${(l: Lang) => fmt(distanceAU, digits, l)} AU`);
  }
  const ly = distanceAU / LY_AU;
  const digits = ly < 10 ? 2 : ly < 100 ? 1 : 0;
  return lf(tpl`${(l: Lang) => fmt(ly, digits, l)} ışık yılı`, tpl`${(l: Lang) => fmt(ly, digits, l)} light years`);
}

function durationText(seconds: number): L10n {
  const pick = (value: number): ((l: Lang) => string) => (l) => fmt(value, value < 10 ? 1 : 0, l);
  // Light crosses the few thousand km to a body right beside the explosion in milliseconds.
  if (seconds < 0.095) return lf(tpl`${pick(seconds * 1000)} ms`, tpl`${pick(seconds * 1000)} ms`);
  if (seconds < 90) return lf(tpl`${pick(seconds)} sn`, tpl`${pick(seconds)} s`);
  if (seconds < 5400) return lf(tpl`${pick(seconds / 60)} dk`, tpl`${pick(seconds / 60)} min`);
  if (seconds < 172_800) return lf(tpl`${pick(seconds / 3600)} saat`, tpl`${pick(seconds / 3600)} hours`);
  if (seconds < YEAR_S) return lf(tpl`${pick(seconds / 86_400)} gün`, tpl`${pick(seconds / 86_400)} days`);
  return lf(tpl`${pick(seconds / YEAR_S)} yıl`, tpl`${pick(seconds / YEAR_S)} years`);
}

const lightTime = (distanceAU: number): L10n => durationText((distanceAU * AU_KM) / LIGHT_KM_S);

/** Seconds for a supernova's blast wave to cover `distanceAU`, or null when the remnant fades out first. */
function blastTravelSeconds(distanceAU: number): number | null {
  if (distanceAU > REMNANT_REACH_AU) return null;
  const free = (distanceAU * AU_KM) / EJECTA_FRONT_KM_S;
  // Sedov–Taylor phase for 10^44 J in gas of one atom per cm³: R = 0.31 pc · t_yr^0.4.
  const sedov = ((distanceAU / PC_AU / 0.31) ** 2.5) * YEAR_S;
  return Math.max(free, sedov);
}

/** Apparent magnitude of a supernova of the lab at its brightest, seen from `distanceAU`. */
export function labSupernovaMagnitude(kind: 'sn2' | 'sn1a', distanceAU: number): number {
  return SUPERNOVA[kind].absMag + 5 * Math.log10(distanceAU / PC_AU) - 5;
}

/** Energy of a burst's rays through each square metre at `distanceAU`, inside one of its beams, J. */
function burstFluence(distanceAU: number): number {
  return BURST_ISOTROPIC_J / (4 * Math.PI * (distanceAU * AU_M) ** 2);
}

type Steps = LabImpact['steps'];
const NEVER: L10n = { tr: 'ulaşmaz', en: 'never arrives' };
const MISSES: L10n = { tr: 'ıskalar', en: 'misses' };
const SCORCH_STEP: L10n = { tr: 'Patlamaya bakan yüz kavruluyor', en: 'The side facing the blast is scorched' };
/**
 * The push is worked out as for a body that stays slow against light. Past a tenth of the speed of light
 * that no longer holds: the model's speed stops there, and the text says only that it is beyond it.
 */
const KICK_LIMIT_KM_S = 0.1 * LIGHT_KM_S;
const kickText = (kickKmS: number): L10n => {
  if (kickKmS >= KICK_LIMIT_KM_S) {
    return { tr: 'Kalıntılar ışık hızının onda birinden hızlı savruluyor', en: 'What is left is pushed away at more than a tenth of the speed of light' };
  }
  const speed = (l: Lang): string => fmt(kickKmS, kickKmS < 10 ? 1 : 0, l);
  return lf(tpl`Kalıntılar ${speed} km/s hızla savruluyor`, tpl`What is left is pushed away at ${speed} km/s`);
};

// What becomes of Earth once the energy that strikes it passes each threshold, the same whatever brought it.
const EARTH_DESTROYED: L10n = {
  tr: 'Dünya yok olur. Çarpan enerji, gezegeni bir arada tutan kütleçekim enerjisinden fazladır: atmosfer ve okyanuslar saniyeler içinde buharlaşır, kabuk erir, gezegen parçalanır ve kalıntıları patlamadan uzağa savrulur.',
  en: 'Earth is destroyed. The energy that strikes it exceeds the gravity holding the planet together: air and oceans flash to vapour, the crust melts, the planet comes apart and its remains are blown away from the blast.',
};
const EARTH_MOLTEN: L10n = {
  tr: 'Yüzey erir. Atmosfer ve okyanuslar uzaya savrulur, kabuk bir magma okyanusuna döner. Gezegen varlığını sürdürür ama üzerindeki hiçbir canlı hayatta kalmaz.',
  en: 'The surface melts. The air and oceans are blown into space and the crust becomes a magma ocean. The planet survives, but no life on it does.',
};
const EARTH_BOILED: L10n = {
  tr: 'Okyanuslar kaynayıp buharlaşır, atmosferin büyük bölümü uzaya kaçar. Yüzey kavrulur.',
  en: 'The oceans boil away and most of the atmosphere escapes to space. The surface is scorched.',
};
const EARTH_STRIPPED: L10n = {
  tr: 'Patlamaya bakan yüz kavrulur ve atmosferin bir bölümü uzaya sökülür. Yeryüzündeki yaşam büyük ölçüde yok olur.',
  en: 'The side facing the blast is scorched and part of the atmosphere is stripped away. Most life on the surface is lost.',
};

/** How far the energy that strikes Earth goes toward each kind of destruction. */
interface EarthDamage {
  atmosphere: number;
  oceans: number;
  crust: number;
  breakup: number;
}

function earthDamage(energyJ: number): EarthDamage {
  return {
    atmosphere: reached(energyJ, E_ATMOSPHERE),
    oceans: reached(energyJ, E_OCEANS),
    crust: reached(energyJ, E_CRUST),
    breakup: reached(energyJ, E_BINDING),
  };
}

/** What becomes of a body in a few words: a line of the list of all bodies. */
const VERDICT = {
  destroyed: { tr: 'parçalanır', en: 'destroyed' },
  dispersed: { tr: 'dağılır', en: 'dispersed' },
  molten: { tr: 'yüzeyi erir', en: 'surface melts' },
  iceMolten: { tr: 'buz kabuğu erir', en: 'ice shell melts' },
  boiled: { tr: 'okyanusları kaynar', en: 'oceans boil away' },
  stripped: { tr: 'atmosferi sökülür', en: 'atmosphere stripped' },
  layersTorn: { tr: 'üst katmanları sökülür', en: 'upper layers torn off' },
  gasLost: { tr: 'dış katmanlarından gaz kopar', en: 'loses gas from its outer layers' },
  airEscapes: { tr: 'atmosferinin bir bölümü kaçar', en: 'part of its atmosphere escapes' },
  partlyMolten: { tr: 'yüzeyi yer yer erir', en: 'surface melts in places' },
  scorched: { tr: 'kavrulur', en: 'scorched' },
  overheated: { tr: 'bulut tepeleri aşırı ısınır', en: 'cloud tops overheat' },
  sideOverheats: { tr: 'patlamaya bakan yüzü aşırı ısınır', en: 'side facing the blast overheats' },
  warmed: { tr: 'ısınır', en: 'warms up' },
  ionised: { tr: 'üst atmosferi iyonlaşır', en: 'upper atmosphere ionised' },
  ozoneLost: { tr: 'ozon tabakasının çoğu yok olur', en: 'most of the ozone layer lost' },
  ozoneThinned: { tr: 'ozon tabakası incelir', en: 'ozone layer thins' },
  squeezed: { tr: 'manyetosferi sıkışır', en: 'magnetosphere squeezed' },
  toSurface: { tr: 'bulut yüzeyine iner', en: 'cloud reaches its surface' },
  gasEscapes: { tr: 'gaz kaybı hızlanır', en: 'loses gas faster' },
  surfaceStruck: { tr: 'bulut yüzeyine çarpar', en: 'cloud strikes its surface' },
  auroras: { tr: 'kutup ışıkları parlar', en: 'auroras brighten' },
  storm: { tr: 'güçlü jeomanyetik fırtına', en: 'strong geomagnetic storm' },
  gridsFail: { tr: 'uydular ve şebekeler devre dışı kalır', en: 'satellites and grids fail' },
  outsideModel: { tr: 'model kapsamaz', en: 'outside the model' },
} satisfies Record<string, L10n>;

/** The worst that the energy does to Earth, in a sentence and in a few words; null while it does nothing of the kind. */
function earthRuin(damage: EarthDamage, stripped: boolean): { summary: L10n; verdict: L10n } | null {
  if (damage.breakup >= LAB_BREAKUP_AT) return { summary: EARTH_DESTROYED, verdict: VERDICT.destroyed };
  if (damage.crust >= 0.5) return { summary: EARTH_MOLTEN, verdict: VERDICT.molten };
  if (damage.oceans >= 0.5) return { summary: EARTH_BOILED, verdict: VERDICT.boiled };
  return stripped ? { summary: EARTH_STRIPPED, verdict: VERDICT.stripped } : null;
}

/** The destruction of Earth step by step, from the moment `at` when what destroys it arrives. */
function earthRuinSteps(at: number, damage: EarthDamage, kickKmS: number): Steps {
  const steps: Steps = [];
  if (damage.atmosphere > 0.3) steps.push({ id: 'atmosphere', atSec: at + 1.0, text: { tr: 'Atmosfer uzaya savruluyor', en: 'The atmosphere is blown into space' } });
  if (damage.oceans > 0.3) steps.push({ id: 'oceans', atSec: at + 2.0, text: { tr: 'Okyanuslar kaynıyor', en: 'The oceans boil away' } });
  if (damage.crust > 0.3) steps.push({ id: 'crust', atSec: at + 3.2, text: { tr: 'Kabuk eriyor', en: 'The crust melts' } });
  if (damage.breakup >= LAB_BREAKUP_AT) steps.push({ id: 'breakup', atSec: at + 4.6, text: { tr: 'Dünya parçalanıyor', en: 'Earth comes apart' } });
  if (kickKmS >= 0.1) steps.push({ id: 'kick', atSec: at + 5.6, text: kickText(kickKmS) });
  return steps;
}

function ozoneStep(at: number, ozoneLoss: number): Steps[number] {
  const percent = Math.round(ozoneLoss * 100);
  return { id: 'ozone', atSec: at, text: lf(tpl`Ozon tabakası inceliyor: %${percent} kayıp`, tpl`The ozone layer thins: ${percent}% lost`) };
}

function supernovaImpact(kind: 'sn2' | 'sn1a', distanceAU: number, at: Arrivals): LabImpact {
  const model = SUPERNOVA[kind];
  const apparentMag = model.absMag + 5 * Math.log10(distanceAU / PC_AU) - 5;
  const fluxSolar = 10 ** (-0.4 * (apparentMag - SUN_APPARENT_MAG));
  const share = (EARTH_RADIUS_M / (2 * distanceAU * AU_M)) ** 2;
  const blastSeconds = blastTravelSeconds(distanceAU);
  const energyJ = (model.lightJ + (blastSeconds === null ? 0 : model.kineticJ)) * share;
  const blastEnergyJ = blastSeconds === null ? 0 : model.kineticJ * share;
  // What is left of Earth ends up moving with the ejecta that struck it (momentum shared between the two),
  // so close in it approaches the speed of the ejecta itself and can never exceed it.
  const momentum = Math.sqrt(2 * model.kineticJ * model.ejectaKg);
  const kickKmS = blastSeconds === null ? 0 : (momentum * share) / (EARTH_MASS_KG + model.ejectaKg * share) / 1000;
  const ozoneLoss = Math.min(0.98, 0.35 * model.ozoneFactor * (OZONE_HAZARD_AU / distanceAU) ** 2);
  const surfaceTempK = 288 * (1 + fluxSolar) ** 0.25;
  const damage = earthDamage(blastEnergyJ);
  const scorch = scorchOf(fluxSolar);

  let level: LabImpactLevel = 'safe';
  let verdict: L10n | null = null;
  // Only the blast strips, boils, melts or breaks; the light scorches and thins the ozone layer.
  const byBlast = damage.atmosphere >= 0.5 || damage.oceans >= 0.5 || damage.crust >= 0.5 || damage.breakup >= LAB_BREAKUP_AT;
  let summary: L10n = {
    tr: 'Zararsız. Gökyüzünde çok parlak yeni bir yıldız belirir ve aylar içinde söner; Dünya’daki yaşam etkilenmez.',
    en: 'Harmless. A very bright new star appears in the sky and fades over months; life on Earth is not affected.',
  };
  const ruin = earthRuin(damage, damage.atmosphere >= 0.5 || scorch >= 0.4);
  if (ruin) {
    level = 'extreme';
    summary = ruin.summary;
    verdict = ruin.verdict;
  } else if (fluxSolar >= 0.05) {
    level = 'danger';
    verdict = VERDICT.ozoneLost;
    summary = {
      tr: 'Gökyüzünde haftalarca ikinci bir Güneş gibi parlar. Gama ışınları ve kozmik ışınlar ozon tabakasını yok eder; yüzey ölümcül morötesi ışınıma ve radyasyona açık kalır.',
      en: 'It shines like a second Sun for weeks. Gamma rays and cosmic rays destroy the ozone layer, leaving the surface open to deadly ultraviolet light and radiation.',
    };
  } else if (ozoneLoss >= 0.3) {
    level = 'danger';
    verdict = VERDICT.ozoneLost;
    summary = {
      tr: 'Tehlike sınırının içinde. Ozon tabakasının büyük bölümü yıllarca kaybolur; yere ulaşan zararlı morötesi ışınım yaklaşık iki katına çıkar. Kitlesel yok oluş riski.',
      en: 'Inside the hazard limit. Much of the ozone layer is lost for years and the harmful ultraviolet light reaching the ground roughly doubles. Risk of a mass extinction.',
    };
  } else if (ozoneLoss >= 0.02) {
    level = 'caution';
    verdict = VERDICT.ozoneThinned;
    summary = {
      tr: 'Dolunaydan parlak görünür ve gündüz de seçilir. Ozon tabakası bir miktar incelir; kalıcı bir zarar beklenmez.',
      en: 'Brighter than the full Moon and visible by day. The ozone layer thins somewhat; no lasting harm is expected.',
    };
  }

  const lightTimeText = lightTime(distanceAU);
  const shockTimeText = blastSeconds === null ? NEVER : durationText(blastSeconds);
  const steps: Steps = [{
    id: 'light',
    atSec: at.lightAtSec,
    text: lf(tpl`Işık ulaştı: ${lightTimeText} sonra`, tpl`The light arrives: after ${lightTimeText}`),
  }];
  if (scorch > 0.05) steps.push({ id: 'scorch', atSec: at.lightAtSec + 0.8, text: SCORCH_STEP });
  const ruinSteps = blastSeconds === null ? [] : earthRuinSteps(at.frontAtSec, damage, kickKmS);
  // The ozone layer thins in the hours or years between the light and the blast: once the blast has blown
  // the air itself off, its ozone is not a step of its own.
  const airGoneSec = ruinSteps.find((s) => s.id === 'atmosphere')?.atSec ?? Infinity;
  if (ozoneLoss >= 0.02 && at.lightAtSec + 1.6 < airGoneSec) steps.push(ozoneStep(at.lightAtSec + 1.6, ozoneLoss));
  if (blastSeconds !== null) {
    steps.push({ id: 'shock', atSec: at.frontAtSec, text: lf(tpl`Şok dalgası ulaştı: ${shockTimeText} sonra`, tpl`The blast wave arrives: after ${shockTimeText}`) });
    steps.push(...ruinSteps);
  }
  // Close to the explosion the blast is on Earth before the light has had time to char it.
  steps.sort((a, b) => a.atSec - b.atSec);

  return {
    distanceLabel: distanceText(distanceAU),
    apparentMag,
    fluxSolar,
    lightTimeText,
    shockTimeText,
    surfaceTempK,
    ozoneLoss,
    fluenceJm2: 0,
    beamWidthLabel: null,
    energyJ,
    kickKmS,
    pressureNPa: 0,
    standoffRe: 0,
    auroraLatDeg: blastSeconds !== null && damage.breakup < 0.3 ? 50 : 65,
    satellites: [],
    satellitesLevel: 'safe',
    level,
    summary,
    verdict,
    verdictFrom: verdict === null ? null : byBlast ? 'blast' : 'light',
    lightAtSec: at.lightAtSec,
    shockAtSec: blastSeconds === null ? null : at.frontAtSec,
    outcome: {
      flash: flashOf(fluxSolar),
      scorch,
      ozone: ozoneLoss,
      ...damage,
      aurora: blastSeconds !== null ? 0.4 : ozoneLoss > 0.02 ? 0.25 : 0,
      blackout: clamp01(damage.atmosphere * 2),
      kick: clamp01(Math.log10(1 + kickKmS) / 2),
    },
    steps,
  };
}

function burstImpact(distanceAU: number, at: Arrivals): LabImpact {
  const fluenceJm2 = burstFluence(distanceAU);
  const fluxSolar = fluenceJm2 / BURST_SECONDS / SOLAR_CONSTANT;
  const energyJ = BURST_ISOTROPIC_J * (EARTH_RADIUS_M / (2 * distanceAU * AU_M)) ** 2;
  // Light pushes with its momentum, E / c.
  const kickKmS = Math.min(KICK_LIMIT_KM_S, energyJ / (LIGHT_KM_S * 1000) / EARTH_MASS_KG / 1000);
  const ozoneLoss = Math.min(0.98, 0.35 * (BURST_HAZARD_AU / distanceAU) ** 2);
  const damage = earthDamage(energyJ);
  const scorch = burstScorchOf(fluenceJm2);

  // Within the map the beam always costs some ozone: even from 10,000 light years, about a seventh of it.
  let level: LabImpactLevel = 'caution';
  let verdict: L10n = VERDICT.ozoneThinned;
  let summary: L10n = {
    tr: 'Tehlike sınırının dışında. Hüzme ozon tabakasını bir miktar inceltir; yere ulaşan morötesi ışınım birkaç yıl artar.',
    en: 'Outside the hazard limit. The beam thins the ozone layer somewhat; more ultraviolet light reaches the ground for a few years.',
  };
  const ruin = earthRuin(damage, damage.atmosphere >= 0.5);
  if (ruin) {
    level = 'extreme';
    summary = ruin.summary;
    verdict = ruin.verdict;
  } else if (ozoneLoss >= 0.3) {
    level = 'danger';
    verdict = VERDICT.ozoneLost;
    summary = {
      tr: 'Tehlike sınırının içinde. On saniyelik hüzme ozon tabakasının büyük bölümünü yok eder; kayıp yıllarca sürer ve yere ulaşan zararlı morötesi ışınım artar. Kitlesel yok oluş riski.',
      en: 'Inside the hazard limit. The ten-second beam destroys much of the ozone layer; the loss lasts for years and more harmful ultraviolet light reaches the ground. Risk of a mass extinction.',
    };
  }

  const raysTimeText = lightTime(distanceAU);
  const steps: Steps = [{ id: 'shock', atSec: at.lightAtSec, text: lf(tpl`Gama ışınları ulaştı: ${raysTimeText} sonra`, tpl`The gamma rays arrive: after ${raysTimeText}`) }];
  if (scorch > 0.05) steps.push({ id: 'scorch', atSec: at.lightAtSec + 0.8, text: SCORCH_STEP });
  const ruinSteps = earthRuinSteps(at.lightAtSec, damage, kickKmS);
  // The rays thin the ozone layer and tear at the air in the same moment: where the air itself is blown
  // off, its ozone is not a step of its own.
  if (!ruinSteps.some((s) => s.id === 'atmosphere')) steps.push(ozoneStep(at.lightAtSec + 1.6, ozoneLoss));
  steps.push(...ruinSteps);
  steps.sort((a, b) => a.atSec - b.atSec);

  return {
    distanceLabel: distanceText(distanceAU),
    apparentMag: SUN_APPARENT_MAG - 2.5 * Math.log10(fluxSolar),
    fluxSolar,
    lightTimeText: raysTimeText,
    shockTimeText: raysTimeText,
    surfaceTempK: 288,
    ozoneLoss,
    fluenceJm2,
    beamWidthLabel: distanceText(2 * distanceAU * Math.tan(BURST_HALF_WIDTH_RAD)),
    energyJ,
    kickKmS,
    pressureNPa: 0,
    standoffRe: 0,
    auroraLatDeg: 65,
    satellites: [],
    satellitesLevel: 'safe',
    level,
    summary,
    verdict,
    verdictFrom: 'light',
    lightAtSec: at.lightAtSec,
    shockAtSec: at.lightAtSec,
    outcome: {
      flash: flashOf(fluxSolar),
      scorch,
      ozone: ozoneLoss,
      ...damage,
      aurora: 0.25,
      blackout: clamp01(damage.atmosphere * 2),
      kick: clamp01(Math.log10(1 + kickKmS) / 2),
    },
    steps,
  };
}

/** How the spacecraft near Earth fare once the cloud has squeezed the magnetosphere to `standoffRe`. */
function satellitesIn(distanceAU: number, standoffRe: number, speedKmS: number): LabSatellite[] {
  const out: LabSatellite[] = [];
  for (const orbit of ORBITS) {
    if (orbit.id === 'l1') {
      // Only while the Sun is beyond them.
      if (distanceAU * AU_KM < L1_KM * 1.2) continue;
      const minutes = Math.round(L1_KM / speedKmS / 60);
      out.push({
        id: orbit.id,
        name: orbit.name,
        orbitRe: orbit.orbitRe,
        state: 'outside',
        note: lf(tpl`Bulut onlara Dünya’dan ${minutes} dakika önce ulaşır: uyarı süresi budur`, tpl`The cloud reaches them ${minutes} minutes before it reaches Earth: that is the warning time`),
      });
      continue;
    }
    const state: LabSatellite['state'] = standoffRe > orbit.orbitRe + orbit.edgeRe ? 'inside' : standoffRe >= orbit.orbitRe - orbit.edgeRe ? 'edge' : 'outside';
    const notes: Record<LabSatellite['state'], L10n> = {
      inside: { tr: 'Manyetosferin içinde kalır', en: 'Stays inside the magnetosphere' },
      edge: {
        tr: 'Manyetosferin sınırı yörüngesine dayanır: gündüz tarafında zaman zaman güneş rüzgârına açık kalır',
        en: 'The edge of the magnetosphere comes down to the orbit: on the day side it is at times open to the solar wind',
      },
      outside: {
        tr: 'Gündüz tarafında manyetosferin dışında kalır: güneş rüzgârına ve yüklü parçacıklarına açık',
        en: 'On the day side it is outside the magnetosphere: open to the solar wind and its charged particles',
      },
    };
    out.push({ id: orbit.id, name: orbit.name, orbitRe: orbit.orbitRe, state, note: notes[state] });
  }
  return out;
}

function satellitesLevel(satellites: LabSatellite[]): LabImpactLevel {
  const near = satellites.filter((s) => s.id !== 'l1');
  if (near.some((s) => s.id === 'iss' && s.state !== 'inside')) return 'extreme';
  if (near.some((s) => s.state === 'outside')) return 'danger';
  return near.some((s) => s.state === 'edge') ? 'caution' : 'safe';
}

/** How a geomagnetic storm reads in a few words, by its level. */
const STORM_VERDICT: Record<LabImpactLevel, L10n> = {
  safe: VERDICT.auroras, caution: VERDICT.storm, danger: VERDICT.gridsFail, extreme: VERDICT.gridsFail,
};

function cmeImpact(distanceAU: number, strength: LabCmeStrength, at: Arrivals): LabImpact {
  const model = CME[strength];
  const pressureNPa = model.pressureNPa / (distanceAU * distanceAU);
  // A cloud no denser than the ordinary solar wind does nothing the wind does not do every day.
  const calm = pressureNPa <= QUIET_PRESSURE_NPA;
  const excess = Math.max(1, pressureNPa / QUIET_PRESSURE_NPA);
  const standoffRe = Math.max(1, 10.5 * excess ** (-1 / 6));
  const auroraLatDeg = Math.min(65, Math.max(0, 65 - 9 * Math.log2(excess)));
  const lightTimeText = lightTime(distanceAU);
  const shockTimeText = durationText((distanceAU * AU_KM) / model.speedKmS);
  // Kinetic energy of a large CME (10^26 J) thrown into a cone of about 2 steradians, caught by the magnetosphere.
  const energyJ = 1e26 * (Math.PI * (standoffRe * EARTH_RADIUS_M) ** 2) / (2 * (distanceAU * AU_M) ** 2);

  let level: LabImpactLevel = 'safe';
  let summary: L10n = {
    tr: 'Sıradan bir jeomanyetik fırtına. Kutup ışıkları yüksek enlemlerde görülür; yeryüzünde tehlike yoktur.',
    en: 'An ordinary geomagnetic storm. Auroras are seen at high latitudes; there is no danger on the ground.',
  };
  const insideSun = distanceAU * AU_M <= BODY_TRAITS.sun.radiusM;
  if (insideSun) {
    // Nearer than the Sun is wide there is no cloud on its way to Earth: the numbers are what the formulas
    // give, and the text says that they mean nothing here.
    level = 'extreme';
    summary = {
      tr: 'Model bu uzaklığı kapsamaz: Güneş’in yarıçapı 696 bin km’dir, Dünya bu kadar yakında Güneş’in içinde kalır. Burada bir plazma bulutundan ve etkilerinden söz edilemez.',
      en: 'The model does not cover this distance: the Sun’s radius is 696 thousand km, so this close Earth would be inside the Sun. There is no plasma cloud, and nothing it does, to speak of here.',
    };
  } else if (calm) {
    summary = {
      tr: 'Bulut buraya vardığında sıradan güneş rüzgârından seyrektir: manyetosfer sıkışmaz, belirgin bir etki olmaz.',
      en: 'By the time it arrives the cloud is thinner than the ordinary solar wind: the magnetosphere is not squeezed and there is no noticeable effect.',
    };
  } else if (auroraLatDeg <= 5) {
    // Only a Sun brought to within about half its real distance drives a storm this strong, and from there
    // its light does more harm than its eruption: the text is about the cloud and says so.
    level = 'extreme';
    summary = {
      tr: 'Manyetosfer yer sabit uyduların yörüngesinin çok altına kadar sıkışır; kutup ışıkları bütün gökyüzünü kaplar. Uyduların çoğu ve elektrik şebekeleri devre dışı kalır, üst atmosfer ısınıp genişler. Bu yalnızca bulutun etkisidir: Güneş bu kadar yakınken ışığı ve ısısı Dünya’ya çok daha büyük zarar verir; model bunu hesaba katmaz.',
      en: 'The magnetosphere is squeezed far below the orbit of the geostationary satellites and auroras fill the whole sky. Most satellites and power grids fail, and the upper atmosphere heats and swells. That is the cloud’s doing alone: with the Sun this close its light and heat would harm Earth far more, and the model leaves them out.',
    };
  } else if (auroraLatDeg <= 22) {
    level = 'danger';
    summary = {
      tr: '1859 Carrington olayı düzeyinde ya da ondan güçlü bir fırtına. Kutup ışıkları ekvatora yaklaşır; uydular, uzun elektrik hatları ve radyo haberleşmesi ağır hasar görür.',
      en: 'A storm as strong as the Carrington event of 1859, or stronger. Auroras approach the equator; satellites, long power lines and radio links are badly hit.',
    };
  } else if (auroraLatDeg <= 40) {
    level = 'caution';
    summary = {
      tr: 'Mayıs 2024 fırtınası düzeyinde (G5): kutup ışıkları orta enlemlere iner; uydular ve elektrik şebekeleri önlem alır. Yeryüzündeki insanlar için tehlike yoktur.',
      en: 'Like the May 2024 storm (G5): auroras reach mid-latitudes; satellites and power grids take precautions. There is no danger to people on the ground.',
    };
  }

  const standoffText = (l: Lang): string => fmt(standoffRe, 1, l);
  const steps: Steps = [
    { id: 'light', atSec: at.lightAtSec, text: lf(tpl`Parlamanın ışığı ulaştı: ${lightTimeText} sonra`, tpl`The flare’s light arrives: after ${lightTimeText}`) },
    { id: 'shock', atSec: at.frontAtSec, text: lf(tpl`Plazma bulutu ulaştı: ${shockTimeText} sonra`, tpl`The plasma cloud arrives: after ${shockTimeText}`) },
  ];
  if (!calm) {
    steps.push(
      { id: 'squeeze', atSec: at.frontAtSec + 0.9, text: lf(tpl`Manyetosfer ${standoffText} Dünya yarıçapına sıkıştı`, tpl`The magnetosphere is squeezed to ${standoffText} Earth radii`) },
      { id: 'aurora', atSec: at.frontAtSec + 1.8, text: lf(tpl`Kutup ışıkları ${Math.round(auroraLatDeg)}° enleme iniyor`, tpl`Auroras reach down to latitude ${Math.round(auroraLatDeg)}°`) },
    );
  }
  // The May 2024 storm (auroras to about 30°) did not bring grids down; failures begin with Carrington-class
  // storms (auroras below about 22°).
  const blackout = clamp01((28 - auroraLatDeg) / 22);
  if (blackout > 0.25) {
    steps.push({ id: 'grid', atSec: at.frontAtSec + 2.8, text: { tr: 'Uydular ve elektrik şebekeleri devre dışı kalıyor', en: 'Satellites and power grids fail' } });
  }
  const satellites = satellitesIn(distanceAU, standoffRe, model.speedKmS);

  return {
    distanceLabel: distanceText(distanceAU),
    apparentMag: SUN_APPARENT_MAG,
    fluxSolar: 0,
    lightTimeText,
    shockTimeText,
    surfaceTempK: 288,
    ozoneLoss: 0,
    fluenceJm2: 0,
    beamWidthLabel: null,
    energyJ,
    kickKmS: 0,
    pressureNPa,
    standoffRe,
    auroraLatDeg,
    satellites,
    satellitesLevel: satellitesLevel(satellites),
    level,
    summary,
    verdict: insideSun ? VERDICT.outsideModel : calm ? null : STORM_VERDICT[level],
    verdictFrom: insideSun || !calm ? 'blast' : null,
    lightAtSec: at.lightAtSec,
    shockAtSec: at.frontAtSec,
    outcome: {
      flash: 0.12,
      scorch: 0,
      ozone: 0,
      atmosphere: 0,
      oceans: 0,
      crust: 0,
      breakup: 0,
      aurora: clamp01(0.25 + (65 - auroraLatDeg) / 50),
      blackout,
      kick: 0,
    },
    steps,
  };
}

/** Where one of the other bodies stands with respect to the explosion, and when the explosion reaches it in the time-lapse. */
interface BodyGeometry extends Arrivals {
  /** From the explosion to the body, and from the Sun's real place to the body, AU. */
  distanceAU: number;
  sunAU: number;
  /** Angle at the explosion between Earth and the body, radians. */
  offAxisRad: number;
}

/** What reaches a body from a supernova or along a burst's beam: light that can scorch it, energy that can strip, melt or break it. */
interface Strike {
  /** The light at the body against the sunlight it normally gets, and what that makes of its temperature, K. */
  fluxLocal: number;
  tempK: number;
  /** 0..1: how far the light chars the side facing it. */
  scorch: number;
  /** Energy that can strip, melt or break the body, J; all the energy that strikes it, J. */
  blastJ: number;
  energyJ: number;
  kickKmS: number;
  fluenceJm2: number;
  /** Travel times in words: of the light, and of what follows it (which may never arrive). */
  lightTimeText: L10n;
  frontTimeText: L10n;
  frontArrives: boolean;
  /** Seconds into the time-lapse at which the two reach the body's token. */
  lightAtSec: number;
  frontAtSec: number;
  /** The steps for the two arrivals; a burst has no light ahead of its rays: its rays are its light, and all it does comes with them. */
  lightStep: L10n | null;
  frontStep: L10n;
  /** What there is to say, and how it rates, when the body is neither burnt nor stripped, melted or broken. */
  mild: { level: LabImpactLevel; text: L10n };
  /** The same in a few words, where it rates above harmless. */
  mildVerdict: L10n;
}

const NOTHING_TO_SEE: L10n = { tr: 'Belirgin bir etki olmaz.', en: 'No noticeable effect.' };

function supernovaStrike(kind: 'sn2' | 'sn1a', traits: BodyTraits, geo: BodyGeometry): Strike {
  const model = SUPERNOVA[kind];
  const star = traits.bodyClass === 'star';
  const apparentMag = model.absMag + 5 * Math.log10(geo.distanceAU / PC_AU) - 5;
  // Light of the explosion at the body, against the light the body is used to: the sunlight it normally
  // gets there or, for a star, what its own surface gives off.
  const usualWm2 = star ? STEFAN_BOLTZMANN * traits.tempK ** 4 : SOLAR_CONSTANT / geo.sunAU ** 2;
  const fluxLocal = (10 ** (-0.4 * (apparentMag - SUN_APPARENT_MAG)) * SOLAR_CONSTANT) / usualWm2;
  const share = (traits.radiusM / (2 * geo.distanceAU * AU_M)) ** 2;
  const blastSeconds = blastTravelSeconds(geo.distanceAU);
  const blastJ = blastSeconds === null ? 0 : model.kineticJ * share;
  const momentum = Math.sqrt(2 * model.kineticJ * model.ejectaKg);
  const lightTimeText = lightTime(geo.distanceAU);
  const frontTimeText = blastSeconds === null ? NEVER : durationText(blastSeconds);
  let mild: Strike['mild'] = { level: 'safe', text: { tr: 'Patlama parlak yeni bir yıldız olarak görünür; başka bir şey değişmez.', en: 'The explosion shows as a bright new star; nothing else changes.' } };
  if (star) {
    mild = fluxLocal >= 0.05
      ? {
        level: 'caution',
        text: {
          tr: 'Patlamanın ışığı, yıldızın kendi yüzeyinin yaydığı ışığın yanında artık küçük değildir; patlamaya bakan yüzü ısınır.',
          en: 'The explosion’s light is no longer small beside what the star’s own surface gives off; the side facing it warms up.',
        },
      }
      : { level: 'safe', text: NOTHING_TO_SEE };
  } else if (fluxLocal >= 1) {
    mild = { level: 'caution', text: { tr: 'Patlama oradan Güneş’ten parlak görünür; sıcaklığı belirgin biçimde yükselir.', en: 'From there the explosion outshines the Sun; its temperature rises markedly.' } };
  } else if (fluxLocal >= 0.05) {
    mild = { level: 'caution', text: { tr: 'Patlama gökyüzünde ikinci bir Güneş gibi parlar; sıcaklığı biraz yükselir.', en: 'The explosion shines like a second Sun in its sky; its temperature rises a little.' } };
  }
  return {
    fluxLocal,
    tempK: traits.tempK * (1 + fluxLocal) ** 0.25,
    scorch: scorchOf(fluxLocal),
    blastJ,
    energyJ: model.lightJ * share + blastJ,
    kickKmS: blastSeconds === null ? 0 : (momentum * share) / (traits.massKg + model.ejectaKg * share) / 1000,
    fluenceJm2: 0,
    lightTimeText,
    frontTimeText,
    frontArrives: blastSeconds !== null,
    lightAtSec: geo.lightAtSec,
    frontAtSec: geo.frontAtSec,
    lightStep: lf(tpl`Işık ulaştı: ${lightTimeText} sonra`, tpl`The light arrives: after ${lightTimeText}`),
    frontStep: lf(tpl`Şok dalgası ulaştı: ${frontTimeText} sonra`, tpl`The blast wave arrives: after ${frontTimeText}`),
    mild,
    mildVerdict: VERDICT.warmed,
  };
}

/** What a burst does to a body inside one of its beams. */
function burstStrike(traits: BodyTraits, geo: BodyGeometry): Strike {
  const fluenceJm2 = burstFluence(geo.distanceAU);
  const star = traits.bodyClass === 'star';
  const blastJ = BURST_ISOTROPIC_J * (traits.radiusM / (2 * geo.distanceAU * AU_M)) ** 2;
  const raysTimeText = lightTime(geo.distanceAU);
  let mild: Strike['mild'] = { level: 'safe', text: { tr: 'Hüzme yüzeyini gama ışınlarıyla tarar; kalıcı bir iz bırakmaz.', en: 'The beam sweeps its surface with gamma rays and leaves no lasting mark.' } };
  if (star) mild = { level: 'safe', text: NOTHING_TO_SEE };
  else if (traits.airKg > 0 || traits.bodyClass === 'giant') mild = { level: 'caution', text: { tr: 'Hüzme üst atmosferini iyonlaştırır.', en: 'The beam ionises its upper atmosphere.' } };
  return {
    fluxLocal: star ? 0 : fluenceJm2 / BURST_SECONDS / (SOLAR_CONSTANT / geo.sunAU ** 2),
    tempK: traits.tempK,
    scorch: star ? 0 : burstScorchOf(fluenceJm2),
    blastJ,
    energyJ: blastJ,
    // Light pushes with its momentum, E / c.
    kickKmS: Math.min(KICK_LIMIT_KM_S, blastJ / (LIGHT_KM_S * 1000) / traits.massKg / 1000),
    fluenceJm2,
    lightTimeText: raysTimeText,
    frontTimeText: raysTimeText,
    frontArrives: true,
    lightAtSec: geo.frontAtSec,
    frontAtSec: geo.frontAtSec,
    lightStep: null,
    frontStep: lf(tpl`Gama ışınları ulaştı: ${raysTimeText} sonra`, tpl`The gamma rays arrive: after ${raysTimeText}`),
    mild,
    mildVerdict: VERDICT.ionised,
  };
}

/** What becomes of a body under a strike: the thresholds are worked out from the body itself. */
function struckFate(id: string, traits: BodyTraits, geo: BodyGeometry, strike: Strike): LabFate {
  const icy = traits.bodyClass === 'icy';
  const solid = icy || traits.bodyClass === 'rocky';
  const star = traits.bodyClass === 'star';
  // Joules that take one kilogram from the body's surface out of its gravity.
  const liftJ = (GRAVITY_SI * traits.massKg) / traits.radiusM;
  const airJ = (solid ? traits.airKg : OUTER_LAYERS_SHARE * traits.massKg) * liftJ;
  const meltJ = solid ? (icy ? ICE_J_PER_M2 : CRUST_J_PER_M2) * 4 * Math.PI * traits.radiusM ** 2 : 0;
  const bindingJ = 0.6 * liftJ * traits.massKg;
  const air = airJ > 0 ? reached(strike.blastJ, airJ) : 0;
  const melt = meltJ > 0 ? reached(strike.blastJ, meltJ) : 0;
  const breakup = reached(strike.blastJ, bindingJ);
  const { scorch, kickKmS } = strike;

  // Unlike Earth's, these levels are not about life: devastating means the body is destroyed, molten or
  // stripped; dangerous, that part of it is, or that the light chars it; otherwise as the strike rates it.
  let level = strike.mild.level;
  if (breakup >= LAB_BREAKUP_AT || melt >= 0.5 || air >= 0.5) level = 'extreme';
  else if (scorch >= 0.4 || air >= 0.25 || melt >= 0.25) level = 'danger';

  const summary: L10n[] = [];
  if (breakup >= LAB_BREAKUP_AT) {
    summary.push(solid
      ? {
        tr: 'Parçalanır. Çarpan enerji, onu bir arada tutan kütleçekim enerjisinden fazladır; kalıntıları patlamadan uzağa savrulur.',
        en: 'It is destroyed. The energy that strikes it exceeds the gravity holding it together; its remains are blown away from the blast.',
      }
      : {
        tr: 'Dağılır. Çarpan enerji, onu bir arada tutan kütleçekim enerjisinden fazladır; gazı uzaya saçılır.',
        en: 'It is dispersed. The energy that strikes it exceeds the gravity holding it together; its gas is scattered into space.',
      });
  } else {
    if (air >= 0.5) {
      if (solid) summary.push({ tr: 'Atmosferi uzaya savrulur.', en: 'Its atmosphere is blown into space.' });
      else if (star) summary.push({ tr: 'Dış katmanlarının bir bölümü sökülür; yıldız yerinde kalır ve parlamayı sürdürür.', en: 'Part of its outer layers is stripped off; the star stays where it is and keeps shining.' });
      else summary.push({ tr: 'Üst katmanları sökülüp uzaya savrulur; gezegenin büyük bölümü yerinde kalır.', en: 'Its upper layers are torn off into space; most of the planet stays.' });
    } else if (air >= 0.25) {
      summary.push(solid
        ? { tr: 'Atmosferinin bir bölümü uzaya kaçar.', en: 'Part of its atmosphere escapes to space.' }
        : { tr: 'En dış katmanlarından bir miktar gaz sökülür.', en: 'Some gas is torn from its outermost layers.' });
    }
    if (melt >= 0.5) {
      summary.push(icy
        ? { tr: 'Buz kabuğu erir ve uzaya buharlaşır.', en: 'Its shell of ice melts and boils off into space.' }
        : { tr: 'Yüzeyi erir; kabuk bir magma okyanusuna döner.', en: 'Its surface melts; the crust becomes a magma ocean.' });
    } else if (melt >= 0.25) {
      summary.push(icy
        ? { tr: 'Buz kabuğu yer yer erir.', en: 'Its shell of ice melts in places.' }
        : { tr: 'Yüzeyi yer yer erir.', en: 'Its surface melts in places.' });
    } else if (scorch >= 0.4) {
      if (solid) summary.push({ tr: 'Patlamaya bakan yüzü kavrulur.', en: 'The side facing the blast is scorched.' });
      else if (star) summary.push({ tr: 'Patlamaya bakan yüzü aşırı ısınır: orada patlamanın ışığı yıldızın kendi ışığını bastırır.', en: 'The side facing the blast overheats: there the explosion’s light outdoes the star’s own.' });
      else summary.push({ tr: 'Bulut tepeleri aşırı ısınır ve şişer.', en: 'Its cloud tops overheat and swell.' });
    }
    if (summary.length === 0) summary.push(strike.mild.text);
  }
  let verdict: L10n | null = strike.mild.level === 'safe' ? null : strike.mildVerdict;
  if (breakup >= LAB_BREAKUP_AT) verdict = solid ? VERDICT.destroyed : VERDICT.dispersed;
  else if (melt >= 0.5) verdict = icy ? VERDICT.iceMolten : VERDICT.molten;
  else if (air >= 0.5) verdict = solid ? VERDICT.stripped : star ? VERDICT.gasLost : VERDICT.layersTorn;
  else if (melt >= 0.25) verdict = VERDICT.partlyMolten;
  else if (air >= 0.25) verdict = solid ? VERDICT.airEscapes : VERDICT.gasLost;
  else if (scorch >= 0.4) verdict = solid ? VERDICT.scorched : star ? VERDICT.sideOverheats : VERDICT.overheated;
  // A supernova's blast strips, melts and breaks; what its light does comes with the light.
  const byBlast = strike.lightStep !== null && (breakup >= LAB_BREAKUP_AT || melt >= 0.25 || air >= 0.25);

  const steps: Steps = [];
  if (strike.lightStep) steps.push({ id: 'light', atSec: strike.lightAtSec, text: strike.lightStep });
  if (scorch > 0.05) {
    steps.push({
      id: 'scorch',
      atSec: strike.lightAtSec + 0.8,
      text: solid ? SCORCH_STEP : star ? { tr: 'Patlamaya bakan yüz ısınıyor', en: 'The side facing the blast heats up' } : { tr: 'Bulut tepeleri ısınıyor', en: 'The cloud tops heat up' },
    });
  }
  if (strike.frontArrives) {
    const at = strike.frontAtSec;
    steps.push({ id: 'shock', atSec: at, text: strike.frontStep });
    if (air > 0.3) {
      steps.push({
        id: 'air',
        atSec: at + 1.0,
        text: solid
          ? { tr: 'Atmosfer uzaya savruluyor', en: 'The atmosphere is blown into space' }
          : star ? { tr: 'Dış katmanlar sökülüyor', en: 'The outer layers are stripped off' } : { tr: 'Üst katmanlar sökülüyor', en: 'The upper layers are torn off' },
      });
    }
    if (melt > 0.3) steps.push({ id: 'melt', atSec: at + 3.2, text: icy ? { tr: 'Buz kabuğu eriyor', en: 'The shell of ice melts' } : { tr: 'Kabuk eriyor', en: 'The crust melts' } });
    if (breakup >= LAB_BREAKUP_AT) steps.push({ id: 'breakup', atSec: at + 4.6, text: solid ? { tr: 'Parçalanıyor', en: 'It comes apart' } : { tr: 'Dağılıyor', en: 'It is dispersed' } });
    if (kickKmS >= 0.1) steps.push({ id: 'kick', atSec: at + 5.6, text: kickText(kickKmS) });
  }
  // Close to the explosion the blast is on the body before the light has had time to char it.
  steps.sort((a, b) => a.atSec - b.atSec);

  const meters: LabFate['meters'] = [];
  if (airJ > 0) {
    meters.push({
      label: solid
        ? { tr: 'Atmosferi söker', en: 'Strips the atmosphere' }
        : star ? { tr: 'Dış katmanları söker', en: 'Strips the outer layers' } : { tr: 'Üst katmanları söker', en: 'Tears off the upper layers' },
      value: air,
    });
  }
  if (meltJ > 0) meters.push({ label: icy ? { tr: 'Buz kabuğunu eritir', en: 'Melts the shell of ice' } : { tr: 'Kabuğu eritir', en: 'Melts the crust' }, value: melt });
  meters.push({ label: { tr: 'Cismi dağıtır', en: 'Takes the body apart' }, value: breakup });

  return {
    id,
    bodyClass: traits.bodyClass,
    distanceLabel: distanceText(geo.distanceAU),
    lightTimeText: strike.lightTimeText,
    shockTimeText: strike.frontTimeText,
    fluxLocal: strike.fluxLocal,
    tempK: strike.tempK,
    fluenceJm2: strike.fluenceJm2,
    energyJ: strike.energyJ,
    kickKmS,
    pressureNPa: 0,
    standoffRadii: 0,
    level,
    summary,
    verdict,
    verdictFrom: verdict === null ? null : byBlast ? 'blast' : 'light',
    outcome: { flash: flashOf(strike.fluxLocal), scorch, air, melt, breakup, kick: clamp01(Math.log10(1 + kickKmS) / 2), storm: 0 },
    meters,
    lightAtSec: strike.lightAtSec,
    shockAtSec: strike.frontArrives ? strike.frontAtSec : null,
    steps,
  };
}

/** A body outside both beams of a burst: it gets nothing, not even the sight of it. */
function missedByBeam(id: string, traits: BodyTraits, geo: BodyGeometry): LabFate {
  return {
    id,
    bodyClass: traits.bodyClass,
    distanceLabel: distanceText(geo.distanceAU),
    lightTimeText: MISSES,
    shockTimeText: MISSES,
    fluxLocal: 0,
    tempK: traits.tempK,
    fluenceJm2: 0,
    energyJ: 0,
    kickKmS: 0,
    pressureNPa: 0,
    standoffRadii: 0,
    level: 'safe',
    summary: [{ tr: 'Hüzme bu yöne gelmez; etkilenmez.', en: 'The beam does not come this way; no effect.' }],
    verdict: null,
    verdictFrom: null,
    outcome: { flash: 0, scorch: 0, air: 0, melt: 0, breakup: 0, kick: 0, storm: 0 },
    meters: [],
    lightAtSec: geo.frontAtSec,
    shockAtSec: null,
    steps: [],
  };
}

function cmeFate(id: string, traits: BodyTraits, geo: BodyGeometry, strength: LabCmeStrength): LabFate {
  const model = CME[strength];
  const inCloud = geo.offAxisRad <= CME_HALF_WIDTH_RAD;
  const pressureNPa = inCloud ? model.pressureNPa / geo.distanceAU ** 2 : 0;
  // Against the ordinary solar wind at the body's own distance from the Sun.
  const excess = pressureNPa / (QUIET_PRESSURE_NPA / geo.sunAU ** 2);
  const squeeze = Math.max(1, excess) ** (-1 / 6);
  // A moon is out of the solar wind for as long as its planet's bow shock stands beyond its orbit.
  const host = traits.host ? BODY_TRAITS[traits.host.id] : undefined;
  const sheltered = traits.host !== undefined && host !== undefined && host.quietStandoffRadii * squeeze * BOW_SHOCK_RATIO > traits.host.orbitRadii;
  const struck = excess > 1 && !sheltered;
  const magnetic = traits.quietStandoffRadii > 0;
  const hasAir = traits.airKg > 0;
  const standoffRadii = magnetic ? Math.max(1, traits.quietStandoffRadii * squeeze) : 0;
  const toSurface = magnetic && standoffRadii <= 1;
  const lightTimeText = lightTime(geo.distanceAU);
  const shockTimeText = inCloud ? durationText((geo.distanceAU * AU_KM) / model.speedKmS) : MISSES;

  let level: LabImpactLevel = 'safe';
  if (struck) level = toSurface || excess >= 150 ? 'danger' : 'caution';

  const summary: L10n[] = [];
  if (!inCloud) {
    summary.push({ tr: 'Plazma bulutu bu yöne gitmez; etkilenmez.', en: 'The plasma cloud does not come this way; no effect.' });
  } else if (excess <= 1) {
    summary.push({ tr: 'Bulut buraya vardığında sıradan güneş rüzgârından güçlü değildir.', en: 'By the time it gets here the cloud is no stronger than the ordinary solar wind.' });
  } else if (sheltered) {
    summary.push({ tr: 'Gezegeninin manyetosferinin içinde kalır: bulut ona doğrudan ulaşmaz.', en: 'It stays inside its planet’s magnetosphere: the cloud does not reach it directly.' });
  } else {
    if (traits.host) {
      summary.push({
        tr: 'Gezegeninin manyetosferi yörüngesinin içine kadar sıkışır: uydu güneş rüzgârına açık kalır.',
        en: 'Its planet’s magnetosphere is squeezed to inside its orbit: the moon is left open to the solar wind.',
      });
    }
    if (magnetic) {
      summary.push({ tr: 'Manyetosferi sıkışır ve kutup ışıkları parlar.', en: 'Its magnetosphere is squeezed and its auroras brighten.' });
      if (toSurface) summary.push({ tr: 'Bulut yüzeye kadar iner.', en: 'The cloud reaches right down to the surface.' });
    } else if (hasAir) {
      summary.push({
        tr: 'Küresel manyetik alanı yoktur: bulut üst atmosferine doğrudan çarpar ve gazın uzaya kaçışını hızlandırır.',
        en: 'It has no global magnetic field: the cloud strikes its upper atmosphere directly and speeds up the escape of gas to space.',
      });
      if (id === 'mars') {
        // NASA release 15-217 (5 November 2015): "a series of dramatic solar storms hit Mars' atmosphere in
        // March 2015, and MAVEN found that the loss was accelerated."
        summary.push({
          tr: 'Ölçüm: NASA’nın MAVEN uydusu, Mart 2015’teki güneş fırtınalarında Mars’ın uzaya gaz kaybının hızlandığını gözledi.',
          en: 'Measured: NASA’s MAVEN orbiter found that Mars lost gas to space faster during the solar storms of March 2015.',
        });
      }
      if (id === 'titan') {
        // NASA JPL, 28 January 2015: in a flyby of December 2013 Cassini found Titan "outside the region of
        // space dominated by Saturn's magnetic field", the magnetosphere being "highly compressed".
        summary.push({
          tr: 'Ölçüm: NASA’nın Cassini uzay aracı Aralık 2013’te Titan’ı Satürn’ün manyetosferinin dışında, güneş rüzgârının içinde gözledi.',
          en: 'Measured: in December 2013 NASA’s Cassini spacecraft found Titan outside Saturn’s magnetosphere, in the solar wind.',
        });
      }
    } else {
      summary.push({ tr: 'Havası ve manyetik alanı yoktur: bulut yüzeye doğrudan çarpar ve yüzeyden atom söker.', en: 'With no air and no magnetic field, the cloud strikes the surface directly and knocks atoms off it.' });
    }
  }
  let verdict: L10n | null = null;
  if (struck) verdict = magnetic ? (toSurface ? VERDICT.toSurface : VERDICT.squeezed) : hasAir ? VERDICT.gasEscapes : VERDICT.surfaceStruck;

  const steps: Steps = [{
    id: 'light',
    atSec: geo.lightAtSec,
    text: lf(tpl`Parlamanın ışığı ulaştı: ${lightTimeText} sonra`, tpl`The flare’s light arrives: after ${lightTimeText}`),
  }];
  if (struck) {
    const at = geo.frontAtSec;
    steps.push({ id: 'shock', atSec: at, text: lf(tpl`Plazma bulutu ulaştı: ${shockTimeText} sonra`, tpl`The plasma cloud arrives: after ${shockTimeText}`) });
    if (magnetic) {
      const radii = (l: Lang): string => fmt(standoffRadii, 1, l);
      steps.push({ id: 'squeeze', atSec: at + 0.9, text: lf(tpl`Manyetosfer ${radii} gezegen yarıçapına sıkıştı`, tpl`The magnetosphere is squeezed to ${radii} planet radii`) });
      steps.push({ id: 'aurora', atSec: at + 1.8, text: { tr: 'Kutup ışıkları parlıyor', en: 'The auroras brighten' } });
    } else if (hasAir) {
      steps.push({ id: 'escape', atSec: at + 0.9, text: { tr: 'Üst atmosferden gaz kaçışı hızlanıyor', en: 'Gas escapes faster from the upper atmosphere' } });
    } else {
      steps.push({ id: 'surface', atSec: at + 0.9, text: { tr: 'Bulut yüzeye çarpıyor', en: 'The cloud strikes the surface' } });
    }
  }

  return {
    id,
    bodyClass: traits.bodyClass,
    distanceLabel: distanceText(geo.distanceAU),
    lightTimeText,
    shockTimeText,
    fluxLocal: 0,
    tempK: traits.tempK,
    fluenceJm2: 0,
    energyJ: 0,
    kickKmS: 0,
    pressureNPa,
    standoffRadii,
    level,
    summary,
    verdict,
    verdictFrom: verdict === null ? null : 'blast',
    outcome: {
      flash: 0.12,
      scorch: 0,
      air: 0,
      melt: 0,
      breakup: 0,
      kick: 0,
      storm: struck ? clamp01(0.25 + 0.4 * Math.log10(excess)) : 0,
    },
    meters: [],
    lightAtSec: geo.lightAtSec,
    shockAtSec: struck ? geo.frontAtSec : null,
    steps,
  };
}

/**
 * Size of the orbit that ties two bodies of the model, AU: a moon and the planet it goes round, in either
 * order. 0 for any other pair.
 */
function sharedOrbitAU(idA: string, idB: string): number {
  for (const [moonId, planetId] of [[idA, idB], [idB, idA]]) {
    const host = BODY_TRAITS[moonId]?.host;
    if (host?.id === planetId) return (host.orbitRadii * BODY_TRAITS[planetId].radiusM) / AU_M;
  }
  return 0;
}

/** A front of the explosion: its light (a burst's rays), or what follows the light: a supernova's blast wave, a solar eruption's cloud. */
type Front = 'light' | 'blast';

/**
 * How far the explosion's fronts have grown `realSec` after it, AU: its light, and what follows the light
 * (null for a burst, which is its rays and nothing else). A supernova's blast stops where its remnant
 * merges into the interstellar gas.
 */
export function labFrontsAU(setup: LabSetup, realSec: number): { lightAU: number; blastAU: number | null } {
  const lightAU = (realSec * LIGHT_KM_S) / AU_KM;
  if (setup.kind === 'grb') return { lightAU, blastAU: null };
  if (setup.kind === 'cme') return { lightAU, blastAU: (realSec * CME[setup.cmeStrength].speedKmS) / AU_KM };
  // The inverse of `blastTravelSeconds`: free expansion, then the Sedov–Taylor law.
  const free = (realSec * EJECTA_FRONT_KM_S) / AU_KM;
  const sedov = 0.31 * PC_AU * (realSec / YEAR_S) ** 0.4;
  return { lightAU, blastAU: Math.min(free, sedov, REMNANT_REACH_AU) };
}

/** Seconds after the explosion at which one of its fronts has grown to `au`. */
function frontTravelSeconds(setup: LabSetup, front: Front, au: number): number {
  if (front === 'light' || setup.kind === 'grb') return (au * AU_KM) / LIGHT_KM_S;
  if (setup.kind === 'cme') return (au * AU_KM) / CME[setup.cmeStrength].speedKmS;
  return blastTravelSeconds(au) ?? Infinity;
}

/** The arrival of a front at a body: when, seconds after the explosion, and where the body really is. */
interface Arrival {
  realSec: number;
  front: Front;
  at: MapPoint;
}

/**
 * The pace of the time-lapse. The front that is next to arrive anywhere closes in on the body it is about
 * to reach at FRONT_PACE scene units a second on the map; no wait between two arrivals is longer than
 * GAP_MAX_SEC, the first comes no sooner than LEAD_MIN_SEC after the explosion (the flash is to be seen),
 * the first arrival of a blast or cloud no sooner than BLAST_LEAD_SEC after the arrival before it (what the
 * light does is to be seen first), and the last no later than ARRIVALS_MAX_SEC. Each wait is cut into
 * GAP_KNOTS knots of the clock.
 */
const FRONT_PACE = 5;
const GAP_MAX_SEC = 3;
const LEAD_MIN_SEC = 1.2;
const BLAST_LEAD_SEC = 1.8;
const ARRIVALS_MAX_SEC = 20;
const GAP_KNOTS = 12;
/** After the last arrival the fronts go on growing: the real time by this factor each second. */
const AFTER_GROWTH = 1.7;

/**
 * The clock of a time-lapse: real time set against the seconds of the show so that every arrival comes in
 * its real order, simultaneous arrivals together, and the fronts cross the map at a pace that can be
 * watched. `src`, `earth`: the real places of the explosion and of Earth.
 */
function buildClock(setup: LabSetup, src: MapPoint, earth: MapPoint, arrivals: Arrival[]): LabClock {
  const knots: LabClock['knots'] = [];
  let sec = 0;
  let realSec = 0;
  let blastSeen = false;
  for (const arrival of [...arrivals].sort((a, b) => a.realSec - b.realSec)) {
    if (arrival.realSec <= realSec || !Number.isFinite(arrival.realSec)) continue;
    const now = labFrontsAU(setup, realSec);
    const then = labFrontsAU(setup, arrival.realSec);
    const fromAU = arrival.front === 'light' ? now.lightAU : now.blastAU ?? 0;
    const toAU = arrival.front === 'light' ? then.lightAU : then.blastAU ?? 0;
    // The way of the front's leading point toward the body, on the map: sampled evenly, and ever more
    // finely toward the body, where the map stretches small distances most.
    const span = Math.hypot(arrival.at.x - src.x, arrival.at.z - src.z);
    const ux = span > 0 ? (arrival.at.x - src.x) / span : 1;
    const uz = span > 0 ? (arrival.at.z - src.z) / span : 0;
    const radii: number[] = [];
    for (let j = 0; j <= 16; j++) radii.push(fromAU + ((toAU - fromAU) * j) / 16);
    for (let j = 1; j <= 36; j++) radii.push(toAU - (toAU - fromAU) * 10 ** (-j / 3));
    radii.sort((a, b) => a - b);
    const along: number[] = [0];
    let last = labProject({ x: src.x + ux * radii[0], z: src.z + uz * radii[0] }, earth);
    for (let j = 1; j < radii.length; j++) {
      const spot = labProject({ x: src.x + ux * radii[j], z: src.z + uz * radii[j] }, earth);
      along.push(along[j - 1] + Math.hypot(spot.x - last.x, spot.z - last.z));
      last = spot;
    }
    const length = along[along.length - 1];
    const least = knots.length === 0 ? LEAD_MIN_SEC : arrival.front === 'blast' && !blastSeen ? BLAST_LEAD_SEC : 0;
    const gap = Math.max(least, Math.min(GAP_MAX_SEC, length / FRONT_PACE));
    let j = 1;
    for (let i = 1; i < GAP_KNOTS && length > 0; i++) {
      const target = (length * i) / GAP_KNOTS;
      while (along[j] < target) j++;
      const radius = radii[j - 1] + ((radii[j] - radii[j - 1]) * (target - along[j - 1])) / Math.max(along[j] - along[j - 1], 1e-12);
      const reached = Math.min(arrival.realSec, Math.max(knots[knots.length - 1]?.realSec ?? 0, frontTravelSeconds(setup, arrival.front, radius)));
      knots.push({ sec: sec + (gap * i) / GAP_KNOTS, realSec: reached });
    }
    sec += gap;
    realSec = arrival.realSec;
    blastSeen ||= arrival.front === 'blast';
    knots.push({ sec, realSec });
  }
  const shrink = Math.min(1, ARRIVALS_MAX_SEC / Math.max(sec, 1e-9));
  return { knots: knots.map((knot) => ({ sec: knot.sec * shrink, realSec: knot.realSec })) };
}

/** The second of a time-lapse at which `realSec` after the explosion is shown; after its last arrival, the second of that arrival. */
export function labClockSec(clock: LabClock, realSec: number): number {
  let prev = { sec: 0, realSec: 0 };
  for (const knot of clock.knots) {
    if (realSec <= knot.realSec) {
      return knot.realSec > prev.realSec ? prev.sec + ((knot.sec - prev.sec) * (realSec - prev.realSec)) / (knot.realSec - prev.realSec) : knot.sec;
    }
    prev = knot;
  }
  return prev.sec;
}

/** The real time after the explosion, seconds, that second `sec` of a time-lapse shows: the inverse of `labClockSec`, carried on past the last arrival. */
export function labClockRealSec(clock: LabClock, sec: number): number {
  let prev = { sec: 0, realSec: 0 };
  for (const knot of clock.knots) {
    if (sec <= knot.sec) {
      return knot.sec > prev.sec ? prev.realSec + ((knot.realSec - prev.realSec) * (sec - prev.sec)) / (knot.sec - prev.sec) : knot.realSec;
    }
    prev = knot;
  }
  return prev.realSec * AFTER_GROWTH ** (sec - prev.sec);
}

/**
 * The explosion's real place, AU from the Sun. Set at a body, it stands three of that body's radii beyond
 * it as Earth sees it: right beside the body, with the body on the line from the explosion to Earth (the
 * axis of a burst's beams). A solar eruption is where the state puts the erupting Sun.
 */
export function labBlastPlace(setup: LabSetup, bodies: LabBody[]): MapPoint {
  const earth = labEarthPlace(bodies);
  const anchor = setup.kind === 'cme' ? undefined : bodies.find((b) => b.id === setup.anchorId);
  if (!anchor) return labPlaceFromEarth(earth, setup.angleRad, Math.min(LAB_MAX_AU, Math.max(LAB_MIN_AU, setup.distanceAU)));
  return labPlaceFromEarth(earth, anchor.angleRad, anchor.distanceAU + (3 * (BODY_TRAITS[anchor.id]?.radiusM ?? 0)) / AU_M);
}

/** What the model says of an explosion: for Earth, for the other bodies on the map, and how its time-lapse runs. */
export interface LabResults {
  impact: LabImpact;
  fates: LabFate[];
  /** The second of the time-lapse by which everything that is going to happen has happened, with a few to spare. */
  runSec: number;
  clock: LabClock;
}

/** A line of the list of all bodies: what becomes of one of them, and when. */
export interface LabRunLine {
  /** 'earth' or a LabBody id. */
  id: string;
  level: LabImpactLevel;
  verdict: L10n | null;
  /**
   * The second of the time-lapse at which that happens, and the real time after the explosion: those of the
   * arrival that causes it. Null for a body that is not affected.
   */
  atSec: number | null;
  timeText: L10n | null;
}

/**
 * The list of all bodies in the order things happen to them: each at the arrival that causes what its line
 * says (the light's, or the blast's or cloud's), bodies reached in the same moment in the order of their
 * distance from the explosion; then the bodies that are not affected, Earth first.
 */
export function labRunLines(impact: LabImpact, fates: LabFate[]): LabRunLine[] {
  const lines = [{ id: 'earth', ...impact }, ...fates].map((body) => {
    const byLight = body.verdictFrom === 'light' || body.shockAtSec === null;
    return {
      id: body.id,
      level: body.level,
      verdict: body.verdict,
      atSec: body.verdictFrom === null ? null : byLight ? body.lightAtSec : body.shockAtSec,
      timeText: body.verdictFrom === null ? null : byLight ? body.lightTimeText : body.shockTimeText,
      // The light reaches the bodies in the order of their distance from the explosion.
      lightAtSec: body.lightAtSec,
    };
  });
  const reached = lines.filter((line) => line.atSec !== null).sort((a, b) => (a.atSec ?? 0) - (b.atSec ?? 0) || a.lightAtSec - b.lightAtSec);
  return [...reached, ...lines.filter((line) => line.atSec === null)].map(({ id, level, verdict, atSec, timeText }) => ({ id, level, verdict, atSec, timeText }));
}

/**
 * What the explosion does to Earth and to the Moon, the Sun and the other bodies: those of `bodies` that are
 * not in `removed`, in the order given. In a solar eruption the Sun is the explosion itself and has no fate
 * of its own. A moon of another planet is taken to stand where its planet does.
 *
 * Every body is reached in the order of its real distance from the explosion: the seconds of the time-lapse
 * come from one clock for the whole map (`buildClock`), and the fronts drawn at the real size they have at
 * each of its seconds (`labFrontsAU`) are at a body's place when that body's effects begin.
 */
export function computeLabResults(setup: LabSetup, bodies: LabBody[], removed: string[]): LabResults {
  const { kind } = setup;
  const earth = labEarthPlace(bodies);
  const src = labBlastPlace(setup, bodies);
  // Earth's distance from the explosion's own place: for one set at a body, a little more than the body's.
  const d = Math.min(LAB_MAX_AU, Math.max(LAB_MIN_AU, Math.hypot(src.x - earth.x, src.z - earth.z)));
  const anchor = kind === 'cme' ? undefined : bodies.find((b) => b.id === setup.anchorId);
  const lightSeconds = (au: number): number => (au * AU_KM) / LIGHT_KM_S;
  // Earth is on the axis of a burst's beams and of a solar eruption's cloud.
  const earthFrontSec = kind === 'grb' ? lightSeconds(d) : frontTravelSeconds(setup, 'blast', d);
  const arrivals: Arrival[] = [{ realSec: lightSeconds(d), front: 'light', at: earth }, { realSec: earthFrontSec, front: 'blast', at: earth }];
  const struck: Array<{ id: string; traits: BodyTraits; geo: BodyGeometry; lightSec: number; frontSec: number }> = [];
  for (const body of bodies) {
    const traits = BODY_TRAITS[body.id];
    if (!traits || removed.includes(body.id) || (kind === 'cme' && body.id === 'sun')) continue;
    // In the plane of the planets, AU: the Sun is at the origin.
    const place = labPlaceFromEarth(earth, body.angleRad, body.distanceAU);
    const bx = place.x - src.x;
    const bz = place.z - src.z;
    const ex = earth.x - src.x;
    const ez = earth.z - src.z;
    const away = Math.hypot(bx, bz);
    const geo: BodyGeometry = {
      // Never nearer than three of the body's own radii; a planet and its moon, which share one place in
      // the model, never nearer than the moon's orbit to an explosion set at the other.
      distanceAU: Math.max(away, (3 * traits.radiusM) / AU_M, anchor ? sharedOrbitAU(body.id, anchor.id) : 0),
      sunAU: body.id === 'sun' ? 1 : Math.hypot(place.x, place.z),
      // A body at the explosion's own place has no direction from it: it counts as on the axis, not beside it.
      offAxisRad: away < 1e-9 ? 0 : Math.acos(Math.min(1, Math.max(-1, (bx * ex + bz * ez) / (away * Math.hypot(ex, ez))))),
      lightAtSec: 0,
      frontAtSec: 0,
    };
    // One of a burst's beams points at Earth, the other the opposite way; a solar eruption's cloud goes toward Earth.
    const inBeam = geo.offAxisRad <= BURST_HALF_WIDTH_RAD || geo.offAxisRad >= Math.PI - BURST_HALF_WIDTH_RAD;
    const reached = kind === 'grb' ? inBeam : kind !== 'cme' || geo.offAxisRad <= CME_HALF_WIDTH_RAD;
    const lightSec = lightSeconds(geo.distanceAU);
    const frontSec = kind === 'grb' ? lightSec : frontTravelSeconds(setup, 'blast', geo.distanceAU);
    if (kind !== 'grb' || inBeam) arrivals.push({ realSec: lightSec, front: 'light', at: place });
    if (kind !== 'grb' && reached) arrivals.push({ realSec: frontSec, front: 'blast', at: place });
    struck.push({ id: body.id, traits, geo, lightSec, frontSec });
  }
  const clock = buildClock(setup, src, earth, arrivals);
  const at: Arrivals = { lightAtSec: labClockSec(clock, lightSeconds(d)), frontAtSec: labClockSec(clock, earthFrontSec) };
  const impact = kind === 'cme' ? cmeImpact(d, setup.cmeStrength, at) : kind === 'grb' ? burstImpact(d, at) : supernovaImpact(kind, d, at);
  const fates = struck.map(({ id, traits, geo, lightSec, frontSec }): LabFate => {
    geo.lightAtSec = labClockSec(clock, lightSec);
    geo.frontAtSec = labClockSec(clock, frontSec);
    if (kind === 'cme') return cmeFate(id, traits, geo, setup.cmeStrength);
    if (kind !== 'grb') return struckFate(id, traits, geo, supernovaStrike(kind, traits, geo));
    const inBeam = geo.offAxisRad <= BURST_HALF_WIDTH_RAD || geo.offAxisRad >= Math.PI - BURST_HALF_WIDTH_RAD;
    return inBeam ? struckFate(id, traits, geo, burstStrike(traits, geo)) : missedByBeam(id, traits, geo);
  });
  let last = 0;
  for (const step of impact.steps) last = Math.max(last, step.atSec);
  for (const fate of fates) {
    for (const step of fate.steps) last = Math.max(last, step.atSec);
  }
  return { impact, fates, runSec: Math.ceil(last + 4), clock };
}
