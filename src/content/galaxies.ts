/**
 * Real galaxies visible in the sky and in the galaxy close-up, plus the brightest stars from BSC5P
 * (exact J2000 coordinates) for the classroom sky guide [C].
 *
 * Every picture's `centre`, `fieldDeg`, `skyCentre` and `northUpDeg` are measured by tools/measure_galaxies.py
 * (its header says how). The pictures made from the sky's own star map are placed by construction.
 *
 * `majorAxisPaDeg` is the published position angle of the long axis (for the Large Magellanic Cloud, of the
 * line its disc is tilted about: van der Marel & Cioni 2001); the Small Cloud's is measured from its two
 * pictures, which agree. The tool finds the same axes in the pictures to within a few degrees.
 * `nearSidePaDeg`: Andromeda's north-west side and the Large Cloud's north-east side are known to be the
 * nearer ones; the Sombrero's dust ring passes in front of its bulge on the south. For M33 and M51 the side
 * follows from the end of the long axis that moves towards us and the way the arms wind, taking the arms to
 * trail the rotation as spiral arms nearly always do: M33's west side, M51's east side.
 */
import type { GalaxyDef, L10n } from '../core/types';

const GALEX: L10n = { tr: 'GALEX uzay teleskobu, morötesi ışık (sahte renk)', en: 'GALEX space telescope, ultraviolet light (false colour)' };
const HUBBLE: L10n = { tr: 'Hubble Uzay Teleskobu, görünür ışık', en: 'Hubble Space Telescope, visible light' };
const HUBBLE_NEAR_INFRARED: L10n = { tr: 'Hubble Uzay Teleskobu, görünür ve yakın kızılötesi ışık', en: 'Hubble Space Telescope, visible and near-infrared light' };
const SPITZER: L10n = { tr: 'Spitzer Uzay Teleskobu, kızılötesi ışık (sahte renk)', en: 'Spitzer Space Telescope, infrared light (false colour)' };
const STAR_MAP: L10n = {
  tr: 'NASA SVS yıldız haritası, görünür ışık: Gaia kataloğundaki yıldızların tek tek çizimi (fotoğraf değil)',
  en: 'NASA SVS star map, visible light: the stars of the Gaia catalogue drawn one by one (not a photograph)',
};

export const GALAXIES: GalaxyDef[] = [
  {
    id: 'm31',
    catalogCode: 'M31 · NGC 224',
    name: { tr: 'Andromeda Galaksisi (M31)', en: 'Andromeda Galaxy (M31)' },
    typeLabel: { tr: 'Büyük sarmal galaksi', en: 'Large spiral galaxy' },
    raDeg: 10.6847,
    decDeg: 41.2687,
    distanceMly: 2.54,
    apparentDeg: 3.1,
    magnitude: 3.4,
    tiltDeg: 77,
    majorAxisPaDeg: 38,
    nearSidePaDeg: 308,
    pictures: [
      { id: 'visible', caption: HUBBLE_NEAR_INFRARED, centre: [0.414, 0.65], fieldDeg: 2.349, skyCentre: [10.927, 41.3889], northUpDeg: 124.3, fromStarMap: false },
      { id: 'ultraviolet', caption: GALEX, centre: [0.497, 0.494], fieldDeg: 3.893, skyCentre: [10.6661, 41.2837], northUpDeg: 100, fromStarMap: false },
    ],
    summary: {
      tr: 'Samanyolu’na en yakın büyük sarmal galaksi. Karanlık gökyüzünde çıplak gözle bile sönük bir leke olarak görülür; yaklaşık 4,5 milyar yıl sonra Samanyolu ile birleşecek.',
      en: 'The closest large spiral galaxy to the Milky Way. Visible as a faint smudge to the naked eye in dark skies; it will merge with the Milky Way in about 4.5 billion years.',
    },
    facts: [
      { tr: 'Uzaklık: ~2,54 milyon ışık yılı (ışığı bize 2,5 milyon yıl öncesinden geliyor).', en: 'Distance: ~2.54 million light years (we see it as it was 2.5 million years ago).' },
      { tr: 'Çapı yaklaşık 150.000–220.000 ışık yılı; yaklaşık 1 trilyon yıldız içerdiği tahmin edilir.', en: 'Roughly 150,000–220,000 light years across, estimated to hold around a trillion stars.' },
      { tr: 'Gökyüzünde dolunaydan yaklaşık altı kat geniş bir açı kaplar, ancak dış kısımları çok sönüktür.', en: 'Spans about six full-Moon widths in the sky, though its outer parts are very faint.' },
    ],
    topicId: 'm31',
  },
  {
    id: 'm33',
    catalogCode: 'M33 · NGC 598',
    name: { tr: 'Üçgen Galaksisi (M33)', en: 'Triangulum Galaxy (M33)' },
    typeLabel: { tr: 'Sarmal galaksi', en: 'Spiral galaxy' },
    raDeg: 23.4621,
    decDeg: 30.6602,
    distanceMly: 2.73,
    apparentDeg: 1.1,
    magnitude: 5.7,
    tiltDeg: 54,
    majorAxisPaDeg: 23,
    nearSidePaDeg: 293,
    pictures: [
      { id: 'ultraviolet', caption: GALEX, centre: [0.496, 0.502], fieldDeg: 1.193, skyCentre: [23.4567, 30.6625], northUpDeg: 0, fromStarMap: false },
    ],
    summary: {
      tr: 'Yerel Grup’un üçüncü büyük galaksisi. Diskine yaklaşık 54° eğik bir açıdan bakarız; gevşek sarmal kolları ve yıldız doğumevleri net görünür.',
      en: 'The third-largest galaxy in the Local Group. We see its disc tilted by about 54°; its loose spiral arms and star-forming clouds stand out clearly.',
    },
    facts: [
      { tr: 'Uzaklık: ~2,73 milyon ışık yılı.', en: 'Distance: ~2.73 million light years.' },
      { tr: 'Çapı Samanyolu’nun yaklaşık yarısı kadardır (~60.000 ışık yılı).', en: 'About half the width of the Milky Way (~60,000 light years).' },
    ],
    topicId: 'm33',
  },
  {
    id: 'm51',
    catalogCode: 'M51 · NGC 5194',
    name: { tr: 'Girdap Galaksisi (M51)', en: 'Whirlpool Galaxy (M51)' },
    typeLabel: { tr: 'İki kollu sarmal galaksi', en: 'Grand-design spiral galaxy' },
    raDeg: 202.4696,
    decDeg: 47.1953,
    distanceMly: 27,
    apparentDeg: 0.19,
    magnitude: 8.4,
    tiltDeg: 22,
    majorAxisPaDeg: 172,
    nearSidePaDeg: 82,
    pictures: [
      { id: 'visible', caption: HUBBLE, centre: [0.392, 0.485], fieldDeg: 0.1669, skyCentre: [202.4676, 47.2133], northUpDeg: 91, fromStarMap: false },
    ],
    summary: {
      tr: 'Sarmal kolları neredeyse tam karşıdan görünen klasik sarmal galaksi. Kollarından birinin ucundaki küçük komşusu NGC 5195 ile kütleçekimsel olarak etkileşim içindedir.',
      en: 'A classic spiral galaxy seen almost face-on, interacting gravitationally with its smaller companion NGC 5195 at the tip of one arm.',
    },
    facts: [
      { tr: 'Uzaklık: yaklaşık 23–31 milyon ışık yılı.', en: 'Distance: roughly 23–31 million light years.' },
      { tr: 'Sarmal kolların bu kadar belirgin olmasında yanındaki küçük galaksinin çekim etkisi rol oynar.', en: 'The pull of its companion galaxy helps drive its sharp, sweeping spiral arms.' },
    ],
    topicId: 'm51',
  },
  {
    id: 'm104',
    catalogCode: 'M104 · NGC 4594',
    name: { tr: 'Sombrero Galaksisi (M104)', en: 'Sombrero Galaxy (M104)' },
    typeLabel: { tr: 'Yandan görünen sarmal galaksi', en: 'Edge-on spiral galaxy' },
    raDeg: 189.9976,
    decDeg: -11.6231,
    distanceMly: 30,
    apparentDeg: 0.15,
    magnitude: 8.0,
    tiltDeg: 84,
    majorAxisPaDeg: 90,
    nearSidePaDeg: 180,
    pictures: [
      { id: 'visible', caption: HUBBLE, centre: [0.5, 0.49], fieldDeg: 0.1826, skyCentre: [189.9975, -11.6241], northUpDeg: 7, fromStarMap: false },
    ],
    summary: {
      tr: 'Neredeyse tam kenarından baktığımız için parlak merkezi ve ortasını kesen koyu toz kuşağıyla şapkaya benzeyen galaksi.',
      en: 'Seen nearly edge-on, its huge bright core and the crisp dark dust lane along its rim give it the shape of a wide-brimmed hat.',
    },
    facts: [
      { tr: 'Uzaklık: yaklaşık 29–31 milyon ışık yılı.', en: 'Distance: roughly 29–31 million light years.' },
      { tr: 'Çevresindeki hâlede, Samanyolu’nunkinden çok daha fazla sayıda (yaklaşık 2.000) küresel yıldız kümesi bulunur.', en: 'Its outer halo holds roughly 2,000 globular star clusters, far more than the Milky Way.' },
    ],
    topicId: 'm104',
  },
  {
    id: 'm87',
    catalogCode: 'M87 · NGC 4486',
    name: { tr: 'M87 Dev Eliptik Galaksisi', en: 'M87 Giant Elliptical Galaxy' },
    typeLabel: { tr: 'Dev eliptik galaksi (jetli)', en: 'Giant elliptical galaxy (with jet)' },
    raDeg: 187.7059,
    decDeg: 12.3911,
    distanceMly: 53.5,
    apparentDeg: 0.14,
    magnitude: 8.6,
    tiltDeg: 0,
    majorAxisPaDeg: 155,
    nearSidePaDeg: null,
    pictures: [
      { id: 'visible', caption: HUBBLE_NEAR_INFRARED, centre: [0.596, 0.498], fieldDeg: 0.02894, skyCentre: [187.7087, 12.3905], northUpDeg: 11.2, fromStarMap: false },
    ],
    summary: {
      tr: 'Başak kümesinin merkezindeki dev eliptik galaksi. Merkezindeki süper kütleli kara delik 2019’da doğrudan görüntülenen ilk kara delik oldu; dışarıya binlerce ışık yılı uzunluğunda bir plazma jeti fışkırtır.',
      en: 'A giant elliptical galaxy at the heart of the Virgo Cluster. Its central supermassive black hole was the first ever imaged directly (in 2019), and drives a plasma jet thousands of light years long.',
    },
    facts: [
      { tr: 'Uzaklık: ~53,5 milyon ışık yılı.', en: 'Distance: ~53.5 million light years.' },
      { tr: 'Eliptik galaksilerin belirgin sarmal kolları yoktur; yaşlı yıldızlardan oluşan dev bir top ya da yumurta biçimindedirler.', en: 'Elliptical galaxies have no spiral arms; they are huge smooth balls of mostly older stars.' },
    ],
    topicId: 'm87',
  },
  {
    id: 'lmc',
    catalogCode: 'LMC · PGC 17223',
    name: { tr: 'Büyük Macellan Bulutu (LMC)', en: 'Large Magellanic Cloud (LMC)' },
    typeLabel: { tr: 'Düzensiz cüce galaksi', en: 'Irregular dwarf galaxy' },
    raDeg: 80.8942,
    decDeg: -69.7561,
    distanceMly: 0.163,
    apparentDeg: 10.7,
    magnitude: 0.9,
    tiltDeg: 35,
    majorAxisPaDeg: 122.5,
    nearSidePaDeg: 32.5,
    pictures: [
      { id: 'visible', caption: STAR_MAP, centre: [0.492, 0.546], fieldDeg: 9, skyCentre: [80, -68.8], northUpDeg: 0, fromStarMap: true },
      { id: 'infrared', caption: SPITZER, centre: [0.422, 0.555], fieldDeg: 7.344, skyCentre: [79.6905, -68.6893], northUpDeg: 26, fromStarMap: false },
    ],
    summary: {
      tr: 'Samanyolu’nun uydu galaksisi ve güney yarımküreden çıplak gözle kolayca görülen parlak cüce galaksi. 1987’de burada yakın tarihin en iyi incelenen süpernovası (SN 1987A) patladı.',
      en: 'A satellite galaxy of the Milky Way, easily visible to the naked eye from the southern hemisphere. In 1987 it hosted SN 1987A, the best-studied supernova of modern times.',
    },
    facts: [
      { tr: 'Uzaklık: ~163.000 ışık yılı.', en: 'Distance: ~163,000 light years.' },
      { tr: 'İçindeki Tarantula Bulutsusu, Yerel Grup’taki en etkin yıldız oluşum bölgesidir.', en: 'The Tarantula Nebula inside it is the most active star-forming region in the Local Group.' },
    ],
    topicId: 'magellanic',
  },
  {
    id: 'smc',
    catalogCode: 'SMC · NGC 292',
    name: { tr: 'Küçük Macellan Bulutu (SMC)', en: 'Small Magellanic Cloud (SMC)' },
    typeLabel: { tr: 'Düzensiz cüce galaksi', en: 'Irregular dwarf galaxy' },
    raDeg: 13.1583,
    decDeg: -72.8003,
    distanceMly: 0.20,
    apparentDeg: 5.3,
    magnitude: 2.7,
    tiltDeg: 45,
    majorAxisPaDeg: 70,
    nearSidePaDeg: null,
    pictures: [
      { id: 'visible', caption: STAR_MAP, centre: [0.557, 0.503], fieldDeg: 6, skyCentre: [14.5, -72.9], northUpDeg: 0, fromStarMap: true },
      { id: 'infrared', caption: SPITZER, centre: [0.389, 0.425], fieldDeg: 4.341, skyCentre: [15.939, -72.836], northUpDeg: 204, fromStarMap: false },
    ],
    summary: {
      tr: 'Büyük Macellan Bulutu ile birlikte Samanyolu’nun çevresinde dolanan cüce uydu galaksi.',
      en: 'A dwarf satellite galaxy orbiting the Milky Way alongside the Large Magellanic Cloud.',
    },
    facts: [
      { tr: 'Uzaklık: ~200.000 ışık yılı.', en: 'Distance: ~200,000 light years.' },
      { tr: '1912’de Henrietta Swan Leavitt, buradaki değişen yıldızları inceleyerek evrendeki uzaklıkları ölçmenin anahtarını buldu.', en: 'In 1912 Henrietta Swan Leavitt used variable stars here to discover how to measure distances across the universe.' },
    ],
    topicId: 'magellanic',
  },
];

export interface BrightStarLabel {
  id: string;
  name: L10n;
  raDeg: number;
  decDeg: number;
}

/** Brightest stars from NASA HEASARC BSC5P (exact J2000 coordinates) shown when Sky Guide [C] is on. */
export const BRIGHT_STARS: BrightStarLabel[] = [
  { id: 'sirius', name: { tr: 'Sirius', en: 'Sirius' }, raDeg: 101.2871, decDeg: -16.7161 },
  { id: 'canopus', name: { tr: 'Canopus', en: 'Canopus' }, raDeg: 95.9879, decDeg: -52.6958 },
  { id: 'arcturus', name: { tr: 'Arcturus', en: 'Arcturus' }, raDeg: 213.9154, decDeg: 19.1825 },
  { id: 'alpha_cen', name: { tr: 'Alfa Centauri', en: 'Alpha Centauri' }, raDeg: 219.8996, decDeg: -60.8353 },
  { id: 'vega', name: { tr: 'Vega', en: 'Vega' }, raDeg: 279.2346, decDeg: 38.7836 },
  { id: 'capella', name: { tr: 'Capella', en: 'Capella' }, raDeg: 79.1725, decDeg: 45.9981 },
  { id: 'rigel', name: { tr: 'Rigel', en: 'Rigel' }, raDeg: 78.6346, decDeg: -8.2017 },
  { id: 'procyon', name: { tr: 'Procyon', en: 'Procyon' }, raDeg: 114.8254, decDeg: 5.225 },
  { id: 'betelgeuse', name: { tr: 'Betelgeuse', en: 'Betelgeuse' }, raDeg: 88.7929, decDeg: 7.4069 },
  { id: 'altair', name: { tr: 'Altair', en: 'Altair' }, raDeg: 297.6958, decDeg: 8.8683 },
  { id: 'aldebaran', name: { tr: 'Aldebaran', en: 'Aldebaran' }, raDeg: 68.98, decDeg: 16.5092 },
  { id: 'antares', name: { tr: 'Antares', en: 'Antares' }, raDeg: 247.3517, decDeg: -26.4319 },
  { id: 'spica', name: { tr: 'Spica', en: 'Spica' }, raDeg: 201.2983, decDeg: -11.1614 },
  { id: 'deneb', name: { tr: 'Deneb', en: 'Deneb' }, raDeg: 310.3579, decDeg: 45.2803 },
  { id: 'regulus', name: { tr: 'Regulus', en: 'Regulus' }, raDeg: 152.0929, decDeg: 11.9672 },
  { id: 'polaris', name: { tr: 'Kutup Yıldızı (Polaris)', en: 'Polaris' }, raDeg: 37.9529, decDeg: 89.2642 },
];
