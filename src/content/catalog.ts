/**
 * Bilingual (TR/EN) catalogues: lunar and Martian sites, historical supernovae and comets, hardware on
 * the Moon and Mars, and NASA image topics for the info centre.
 */
import type {
  ArtifactPlacement, BodyId, L10n, SiteBody, SiteDef, SurfaceAsset, TransientDef,
} from '../core/types';
import { jdFromCalendar } from '../core/time';

export const BODY_NAMES: Record<BodyId, L10n> = {
  sun: { tr: 'Güneş', en: 'Sun' },
  earth: { tr: 'Dünya', en: 'Earth' },
  mercury: { tr: 'Merkür', en: 'Mercury' },
  venus: { tr: 'Venüs', en: 'Venus' },
  mars: { tr: 'Mars', en: 'Mars' },
  jupiter: { tr: 'Jüpiter', en: 'Jupiter' },
  saturn: { tr: 'Satürn', en: 'Saturn' },
  uranus: { tr: 'Uranüs', en: 'Uranus' },
  neptune: { tr: 'Neptün', en: 'Neptune' },
};

export const SITES: SiteDef[] = [
  {
    id: 'apollo11',
    latDeg: 0.67416,
    lonDeg: 23.47314,
    tags: ['apollo', 'equatorial'],
    spawnHeadingDeg: 25,
    name: { tr: 'Sükûnet Üssü (Apollo 11)', en: 'Tranquility Base (Apollo 11)' },
    region: { tr: 'Sükûnet Denizi (Mare Tranquillitatis)', en: 'Sea of Tranquility (Mare Tranquillitatis)' },
    blurb: {
      tr: 'İnsanların 1969’da ilk kez ayak bastığı düz bazalt ova. Eagle’ın iniş kademesi ve hâlâ kullanılan lazer yansıtıcı burada.',
      en: 'The flat basalt plain where people first walked on the Moon in 1969. Eagle’s descent stage and the still-used laser reflector are here.',
    },
  },
  {
    id: 'shackleton',
    latDeg: -89.78,
    lonDeg: -155.73,
    packId: 'shackleton',
    tags: ['pole', 'artemis', 'clps'],
    spawnHeadingDeg: 320,
    name: { tr: 'Shackleton Krateri Kenarı', en: 'Shackleton Crater Rim' },
    region: { tr: 'Ay’ın güney kutbu (89,8° G)', en: 'Lunar south pole (89.8° S)' },
    blurb: {
      tr: 'Güneş’in yıl boyu ufkun hemen üzerinde dolaştığı kutup sırtı. Hemen yanındaki 4 km derinliğindeki krater tabanına hiç Güneş ışığı ulaşmaz.',
      en: 'A polar ridge where the Sun circles just above the horizon all year. No sunlight ever reaches the floor of the 4 km-deep crater beside it.',
    },
  },
  {
    id: 'connecting_ridge',
    latDeg: -89.45,
    lonDeg: -137.31,
    packId: 'connecting_ridge',
    tags: ['pole', 'artemis'],
    spawnHeadingDeg: 0,
    name: { tr: 'Shackleton–de Gerlache Sırtı', en: 'Shackleton–de Gerlache Ridge' },
    region: { tr: 'Ay’ın güney kutbu', en: 'Lunar south pole' },
    blurb: {
      tr: 'Güney kutbunda Güneş’i en uzun süre kesintisiz gören yerlerden biri (LOLA 5 m/piksel verisiyle belirlendi).',
      en: 'One of the places at the south pole that sees the Sun for the longest unbroken stretches (found with 5 m/pixel LOLA data).',
    },
  },
  {
    id: 'tycho',
    latDeg: -43.31,
    lonDeg: -11.36,
    tags: ['highlands', 'crater'],
    spawnHeadingDeg: 180,
    name: { tr: 'Tycho Krateri Merkez Tepesi', en: 'Tycho Crater Central Peak' },
    region: { tr: 'Güney yaylaları', en: 'Southern highlands' },
    blurb: {
      tr: '85 km genişliğinde genç bir çarpma krateri. Ortasında yaklaşık 2 km yüksekliğinde bir tepe vardır; çarpmada saçılan parlak ışınlar yakın yüzün büyük bölümüne uzanır.',
      en: 'A young impact crater 85 km wide. A peak about 2 km high rises in its centre, and bright rays thrown out by the impact stretch across much of the near side.',
    },
  },
  {
    id: 'apollo15',
    latDeg: 26.1322,
    lonDeg: 3.6339,
    tags: ['apollo'],
    spawnHeadingDeg: 140,
    name: { tr: 'Hadley–Apenin (Apollo 15)', en: 'Hadley–Apennine (Apollo 15)' },
    region: { tr: 'Apenin Dağları', en: 'Apennine Mountains' },
    blurb: {
      tr: 'Yüksek Apenin Dağları ile kıvrımlı Hadley vadisi arasında. Astronotlar Ay aracını (LRV) ilk kez burada kullandı.',
      en: 'Between the high Apennine Mountains and the winding Hadley valley. Astronauts drove the Lunar Roving Vehicle here for the first time.',
    },
  },
  {
    id: 'apollo17',
    latDeg: 20.1908,
    lonDeg: 30.7717,
    tags: ['apollo'],
    spawnHeadingDeg: 90,
    name: { tr: 'Taurus–Littrow Vadisi (Apollo 17)', en: 'Taurus–Littrow Valley (Apollo 17)' },
    region: { tr: 'Berraklık Denizi kıyısı', en: 'Edge of the Sea of Serenity' },
    blurb: {
      tr: 'Apollo programının son iniş yeri (Aralık 1972). Jeolog astronot Harrison Schmitt burada volkanik turuncu cam taneciklerinden oluşan toprak buldu.',
      en: 'The last Apollo landing site (December 1972). Geologist-astronaut Harrison Schmitt found orange soil made of volcanic glass beads here.',
    },
  },
  {
    id: 'copernicus',
    latDeg: 9.62,
    lonDeg: -20.08,
    tags: ['crater'],
    spawnHeadingDeg: 0,
    name: { tr: 'Copernicus Krateri', en: 'Copernicus Crater' },
    region: { tr: 'Fırtınalar Okyanusu’nun doğusu', en: 'Eastern Ocean of Storms' },
    blurb: {
      tr: 'Basamaklı duvarları ve ortasındaki tepeleriyle yaklaşık 800 milyon yaşında, 93 km genişliğinde bir çarpma krateri.',
      en: 'An impact crater 93 km wide and about 800 million years old, with terraced walls and central peaks.',
    },
  },
  {
    id: 'aristarchus',
    latDeg: 23.7,
    lonDeg: -47.4,
    tags: ['crater'],
    spawnHeadingDeg: 220,
    name: { tr: 'Aristarchus Platosu', en: 'Aristarchus Plateau' },
    region: { tr: 'Fırtınalar Okyanusu', en: 'Ocean of Storms' },
    blurb: {
      tr: 'Ay’ın yakın yüzündeki en parlak bölgelerden biri: volkanik küllerle örtülü, kıvrımlı vadilerle kesilmiş yüksek bir plato.',
      en: 'One of the brightest areas on the near side: a high plateau covered in volcanic ash and cut by winding valleys.',
    },
  },
  {
    id: 'mare_crisium',
    latDeg: 18.5623,
    lonDeg: 61.8103,
    tags: ['clps'],
    spawnHeadingDeg: 260,
    name: { tr: 'Krizler Denizi (Blue Ghost)', en: 'Sea of Crises (Blue Ghost)' },
    region: { tr: 'Mare Crisium', en: 'Mare Crisium' },
    blurb: {
      tr: 'Blue Ghost iniş aracının Mart 2025’te NASA’nın ticari iniş programı (CLPS) kapsamında indiği bazalt havza. Dünya burada batı göğünde alçakta görünür.',
      en: 'The basalt basin where the Blue Ghost lander touched down in March 2025 under NASA’s commercial lander programme (CLPS). Here Earth hangs low in the western sky.',
    },
  },
  {
    id: 'im1_malapert_a',
    latDeg: -80.13,
    lonDeg: 1.44,
    tags: ['pole', 'clps'],
    spawnHeadingDeg: 0,
    name: { tr: 'Malapert A (Odysseus)', en: 'Malapert A (Odysseus)' },
    region: { tr: 'Güney kutup bölgesi (80° G)', en: 'South polar region (80° S)' },
    blurb: {
      tr: 'Odysseus iniş aracının Şubat 2024’te NASA’nın bilimsel aletleriyle indiği engebeli bölge.',
      en: 'The rugged area where the Odysseus lander came down with NASA instruments in February 2024.',
    },
  },
  {
    id: 'malapert',
    latDeg: -86.0,
    lonDeg: 2.9,
    tags: ['pole', 'artemis'],
    spawnHeadingDeg: 0,
    name: { tr: 'Malapert Dağı', en: 'Malapert Massif' },
    region: { tr: 'Ay’ın güney kutbu (86° G)', en: 'Lunar south pole (86° S)' },
    blurb: {
      tr: 'Yaklaşık 5 km yüksekliğinde bir kutup dağı. Zirvesinden Dünya neredeyse her zaman görünür; bu yüzden iletişim istasyonu için aday gösterilir.',
      en: 'A polar mountain about 5 km high. Earth is almost always visible from its summit, which makes it a candidate for a communications station.',
    },
  },
  {
    id: 'chandrayaan3',
    latDeg: -69.3741,
    lonDeg: 32.32,
    tags: ['pole'],
    spawnHeadingDeg: 0,
    name: { tr: 'Shiv Shakti Noktası (Chandrayaan-3)', en: 'Statio Shiv Shakti (Chandrayaan-3)' },
    region: { tr: 'Güney yüksek enlemleri (69,4° G)', en: 'Southern high latitudes (69.4° S)' },
    blurb: {
      tr: 'Hindistan’ın Vikram iniş aracı ve Pragyan gezgininin Ağustos 2023’te çalıştığı düzlük.',
      en: 'The plain where India’s Vikram lander and Pragyan rover worked in August 2023.',
    },
  },
  {
    id: 'von_karman',
    latDeg: -45.4446,
    lonDeg: 177.5991,
    tags: ['farside'],
    spawnHeadingDeg: 180,
    name: { tr: 'Von Kármán Krateri (uzak yüz)', en: 'Von Kármán Crater (far side)' },
    region: { tr: 'Güney Kutbu–Aitken Havzası', en: 'South Pole–Aitken Basin' },
    blurb: {
      tr: 'Ay’ın Dünya’dan görünmeyen yüzü. Burada Dünya hiç doğmaz, bu yüzden Dünya ile doğrudan haberleşilemez. Çin’in Chang’e-4 aracı 2019’da buraya indi.',
      en: 'The side of the Moon we never see from Earth. Earth never rises here, so there is no direct radio contact with it. China’s Chang’e 4 landed here in 2019.',
    },
  },
];

/**
 * Walkable places on Mars, each where a mission stands whose model exists. Areocentric latitude and east
 * longitude, the same figures as the hardware in SURFACE_ASSETS. Every site looks north on arrival, toward
 * its hardware.
 */
export const MARS_SITES: SiteDef[] = [
  {
    id: 'mars_jezero',
    body: 'mars',
    latDeg: 18.44,
    lonDeg: 77.45,
    tags: ['mars', 'rover'],
    spawnHeadingDeg: 0,
    name: { tr: 'Jezero Krateri (Perseverance ve Ingenuity)', en: 'Jezero Crater (Perseverance and Ingenuity)' },
    region: { tr: 'Wright Kardeşler Alanı, krater tabanı', en: 'Wright Brothers Field, crater floor' },
    blurb: {
      tr: 'Milyarlarca yıl önce göl olan krater; batı kenarında, göle dökülen nehrin bıraktığı delta duruyor. Perseverance 18 Şubat 2021’de buraya indi ve yanında Ingenuity helikopterini getirdi.',
      en: 'A crater that was a lake billions of years ago; at its western edge lies the delta left by the river that flowed into it. Perseverance landed here on 18 February 2021 and brought the Ingenuity helicopter with it.',
    },
  },
  {
    id: 'mars_viking1',
    body: 'mars',
    latDeg: 22.27,
    lonDeg: -47.95,
    tags: ['mars', 'lander'],
    spawnHeadingDeg: 0,
    name: { tr: 'Chryse Planitia (Viking 1)', en: 'Chryse Planitia (Viking 1)' },
    region: { tr: 'Kuzey ovaları, eski sel kanallarının ağzı', en: 'Northern plains, at the mouth of ancient flood channels' },
    blurb: {
      tr: 'Kayalarla kaplı alçak bir ova. Viking 1 buraya 20 Temmuz 1976’da indi ve Kasım 1982’ye kadar çalıştı. Mars yüzeyinden çekilen ilk fotoğraflar buradan geldi.',
      en: 'A low plain strewn with rocks. Viking 1 landed here on 20 July 1976 and worked until November 1982. The first photographs taken on the surface of Mars came from here.',
    },
  },
  {
    id: 'mars_viking2',
    body: 'mars',
    latDeg: 47.64,
    lonDeg: 134.29,
    tags: ['mars', 'lander'],
    spawnHeadingDeg: 0,
    name: { tr: 'Utopia Planitia (Viking 2)', en: 'Utopia Planitia (Viking 2)' },
    region: { tr: 'Kuzey ovaları', en: 'Northern plains' },
    blurb: {
      tr: 'Mars’ın kuzeyindeki geniş düzlük. Viking 2 buraya 3 Eylül 1976’da indi ve Nisan 1980’e kadar çalıştı. Kışın kayaların üzerinde ince bir kırağı tabakası oluştuğunu fotoğrafladı.',
      en: 'A wide plain in the north of Mars. Viking 2 landed here on 3 September 1976 and worked until April 1980. It photographed a thin layer of frost forming on the rocks in winter.',
    },
  },
  {
    id: 'mars_insight',
    body: 'mars',
    latDeg: 4.5,
    lonDeg: 135.62,
    tags: ['mars', 'lander', 'equatorial'],
    spawnHeadingDeg: 0,
    name: { tr: 'Elysium Planitia (InSight)', en: 'Elysium Planitia (InSight)' },
    region: { tr: 'Ekvator yakınında düz ova', en: 'Flat plain near the equator' },
    blurb: {
      tr: 'Ekvatora yakın, dümdüz bir lav ovası. InSight buraya 26 Kasım 2018’de indi ve Aralık 2022’ye kadar Mars depremlerini dinledi; 1.300’den fazlasını kaydetti.',
      en: 'A very flat lava plain near the equator. InSight landed here on 26 November 2018 and listened for marsquakes until December 2022; it recorded more than 1,300 of them.',
    },
  },
];

export const SITES_BY_BODY: Record<SiteBody, SiteDef[]> = { moon: SITES, mars: MARS_SITES };

// ─────────────────────────── historical transients ───────────────────────────

export const TRANSIENTS: TransientDef[] = [
  {
    kind: 'supernova',
    id: 'sn1054',
    name: { tr: 'SN 1054 Süpernovası (Yengeç Bulutsusu)', en: 'SN 1054 Supernova (Crab Nebula)' },
    raDeg: 83.6331,
    decDeg: 22.0145,
    firstLight: { year: 1054, month: 7, day: 4, hour: 0 },
    peakMag: -6.0,
    snType: 'II',
    distanceLy: 6500,
    remnantName: { tr: 'Yengeç Bulutsusu (M1)', en: 'Crab Nebula (M1)' },
    remnantDiameterArcmin: 6.0,
    topicId: 'sn1054',
  },
  {
    kind: 'supernova',
    id: 'sn1006',
    name: { tr: 'SN 1006 Süpernovası', en: 'SN 1006 Supernova' },
    raDeg: 225.59,
    decDeg: -41.95,
    firstLight: { year: 1006, month: 5, day: 1, hour: 0 },
    peakMag: -7.5,
    snType: 'Ia',
    distanceLy: 7200,
    remnantName: { tr: 'SN 1006 Kalıntısı (Lupus)', en: 'SN 1006 Remnant (Lupus)' },
    remnantDiameterArcmin: 30.0,
    topicId: 'sn1006',
  },
  {
    kind: 'supernova',
    id: 'sn1572',
    name: { tr: 'SN 1572 (Tycho Süpernovası)', en: 'SN 1572 (Tycho’s Supernova)' },
    raDeg: 6.33,
    decDeg: 64.14,
    firstLight: { year: 1572, month: 11, day: 6, hour: 0 },
    peakMag: -4.0,
    snType: 'Ia',
    distanceLy: 8500,
    remnantName: { tr: 'Tycho Süpernova Kalıntısı', en: 'Tycho’s Supernova Remnant' },
    remnantDiameterArcmin: 8.0,
    topicId: 'sn1572',
  },
  {
    kind: 'supernova',
    id: 'casA',
    name: { tr: 'Cassiopeia A (Cas A)', en: 'Cassiopeia A (Cas A)' },
    raDeg: 350.85,
    decDeg: 58.815,
    firstLight: { year: 1680, month: 8, day: 16, hour: 0 },
    peakMag: 5.5,
    snType: 'II',
    distanceLy: 11000,
    remnantName: { tr: 'Cassiopeia A Kalıntısı', en: 'Cassiopeia A Remnant' },
    remnantDiameterArcmin: 5.0,
    topicId: 'casA',
  },
  {
    kind: 'comet',
    id: 'comet44bc',
    name: { tr: 'C/-43 K1 (M.Ö. 44 Büyük Kuyruklu Yıldızı)', en: 'C/-43 K1 (Great Comet of 44 BC)' },
    // JPL SBDB parabolic solution by Ramsey & Licht (1997): epoch/TP JD 1705496.5 (-43-May-25)
    elements: {
      q: 0.22,
      e: 1.0,
      iDeg: 110.0,
      nodeDeg: 170.0,
      argPeriDeg: 17.0,
      tpJdTT: 1705496.5,
    },
    absMag: 3.3,
    slope: 10.0,
    // Literature outburst model explaining daylight visibility in late July 44 BC
    outburst: {
      peak: { year: -43, month: 7, day: 24, hour: 12 },
      deltaMag: 9.0,
      riseDays: 2.5,
      decayDays: 6.0,
    },
    topicId: 'comet',
  },
  {
    kind: 'comet',
    id: 'halley',
    name: { tr: '1P/Halley Kuyruklu Yıldızı', en: 'Comet 1P/Halley' },
    elements: {
      q: 0.585978,
      e: 0.967143,
      iDeg: 162.2627,
      nodeDeg: 58.4201,
      argPeriDeg: 111.3325,
      tpJdTT: jdFromCalendar({ year: 1986, month: 2, day: 9, hour: 11 }),
    },
    absMag: 5.5,
    slope: 8.0,
    topicId: 'halley',
  },
];

// ─────────────────────────── hardware on the Moon and Mars ───────────────────────────

export const SURFACE_ASSETS: SurfaceAsset[] = [
  {
    id: 'a11_descent',
    body: 'moon',
    name: { tr: 'Eagle’ın İniş Kademesi (Apollo 11)', en: 'Eagle Descent Stage (Apollo 11)' },
    kind: 'stage',
    mission: { tr: 'Apollo 11 (NASA)', en: 'Apollo 11 (NASA)' },
    agency: 'NASA',
    latDeg: 0.67416,
    lonDeg: 23.47314,
    arrival: { year: 1969, month: 7, day: 20, hour: 20, minute: 17 },
    lastContact: { year: 1969, month: 7, day: 21, hour: 17, minute: 54 },
    stillActive: false,
    status: {
      tr: 'Yerinde duruyor. Kalkış kademesi için fırlatma rampası görevi gördü.',
      en: 'Still standing where it landed. It served as the launch pad for the ascent stage.',
    },
    history: [
      {
        tr: '20 Temmuz 1969’da Neil Armstrong, bilgisayarın yöneldiği kayalık bir krateri geçmek için Eagle’ı elle uçurdu ve biraz ileride düz bir yere indirdi. İndiğinde yakıt azalmıştı.',
        en: 'On 20 July 1969 Neil Armstrong took manual control to fly Eagle past a boulder-strewn crater the computer was heading for, and landed on level ground a little further on. Fuel was running low by then.',
      },
      {
        tr: 'Astronotlar yaklaşık 21,5 saat sonra üst kısımla (kalkış kademesi) havalandı. Bu alt kısım rampa olarak yerinde kaldı. Ay’da rüzgâr ve yağmur olmadığı için bugün de aynı yerde duruyor.',
        en: 'About 21.5 hours later the astronauts lifted off in the upper part (the ascent stage). This lower part stayed behind as the launch pad. With no wind or rain on the Moon, it still stands in the same place.',
      },
    ],
    facts: [
      { tr: 'Gövdesi yaklaşık 4,2 m genişliğinde; ayaklarının uçları arası 9,4 m.', en: 'Its body is about 4.2 m wide; 9.4 m across the footpads.' },
      {
        tr: 'Ön ayağındaki plakette şöyle yazar: “Burada Dünya gezegeninden gelen insanlar Ay’a ilk kez ayak bastı, Temmuz 1969. Bütün insanlık için barış içinde geldik.”',
        en: 'The plaque on its front leg reads: “Here men from the planet Earth first set foot upon the Moon, July 1969 A.D. We came in peace for all mankind.”',
      },
    ],
    modelFile: 'apollo_lm.glb',
    topicId: 'apollo11',
  },
  {
    id: 'a11_lrrr',
    body: 'moon',
    name: { tr: 'Lazer Yansıtıcı (LRRR)', en: 'Laser Ranging Retroreflector (LRRR)' },
    kind: 'instrument',
    mission: { tr: 'Apollo 11 (NASA)', en: 'Apollo 11 (NASA)' },
    agency: 'NASA',
    latDeg: 0.6734,
    lonDeg: 23.4729,
    arrival: { year: 1969, month: 7, day: 21, hour: 3, minute: 35 },
    stillActive: true,
    status: {
      tr: 'Hâlâ kullanılıyor: Dünya’daki gözlemevleri bugün de bu yansıtıcıya lazer gönderiyor.',
      en: 'Still in use: observatories on Earth still fire lasers at it today.',
    },
    history: [
      {
        tr: 'Pili, kablosu ya da elektronik parçası yoktur. 100 küçük cam prizmadan oluşan bir paneldir. Bu prizmalar gelen ışığı, hangi açıdan gelirse gelsin, tam geldiği yöne geri gönderir.',
        en: 'It has no battery, no cables and no electronics. It is a panel of 100 small glass prisms that send light straight back in the direction it came from, whatever the angle.',
      },
      {
        tr: 'Dünya’dan gönderilen lazer ışığının yansıtıcıya gidip geri dönmesi yaklaşık 2,5 saniye sürer. Bu süre ölçülerek Ay’ın uzaklığı milimetre düzeyinde hesaplanır. Bu ölçümler sayesinde Ay’ın Dünya’dan her yıl yaklaşık 3,8 cm uzaklaştığını biliyoruz.',
        en: 'Laser light sent from Earth takes about 2.5 seconds to reach the reflector and come back. Timing it gives the Moon’s distance to the millimetre. These measurements show that the Moon is moving away from Earth by about 3.8 cm a year.',
      },
    ],
    facts: [
      { tr: '100 adet 3,8 cm’lik kuvars cam prizmadan oluşur.', en: 'Made of 100 fused-silica prisms, each 3.8 cm across.' },
      { tr: 'Benzer yansıtıcılar Apollo 14 ve 15 ile Sovyet Lunokhod araçlarında da var.', en: 'Similar reflectors were left by Apollo 14 and 15 and on the Soviet Lunokhod rovers.' },
      { tr: 'Bu ölçümler Einstein’ın kütleçekim kuramının en hassas testlerinden birinde de kullanılır.', en: 'The measurements are also used in one of the most precise tests of Einstein’s theory of gravity.' },
    ],
    topicId: 'lrrr',
  },
  {
    id: 'a11_psep',
    body: 'moon',
    name: { tr: 'Sismometre (PSEP)', en: 'Seismometer (PSEP)' },
    kind: 'instrument',
    mission: { tr: 'Apollo 11 (NASA)', en: 'Apollo 11 (NASA)' },
    agency: 'NASA',
    latDeg: 0.6732,
    lonDeg: 23.4730,
    arrival: { year: 1969, month: 7, day: 21, hour: 3, minute: 40 },
    lastContact: { year: 1969, month: 8, day: 25 },
    stillActive: false,
    status: {
      tr: 'Çalışmıyor. Yaklaşık üç hafta veri gönderdi; 25 Ağustos 1969’da komutlara yanıt vermez oldu.',
      en: 'Not working. It sent data for about three weeks and stopped answering commands on 25 August 1969.',
    },
    history: [
      {
        tr: 'Ay’daki sarsıntıları ve göktaşı çarpmalarını ölçmek için kuruldu ve güneş panelleriyle çalışıyordu. O kadar hassastı ki astronotların Ay Modülü’nün içinde yürümesini bile algıladı.',
        en: 'It was set up to measure tremors and meteorite impacts on the Moon and ran on solar panels. It was so sensitive that it picked up the astronauts walking around inside the lunar module.',
      },
    ],
    facts: [
      { tr: 'Ay’daki ilk sismometreydi. Sonraki Apollo görevlerinin kurduğu sismometreler, Ay’ın iç yapısını anlamamızı sağladı.', en: 'It was the first seismometer on the Moon. The seismometers set up by later Apollo missions revealed the Moon’s internal structure.' },
    ],
    topicId: 'apollo_seismic',
  },
  {
    id: 'a11_flag',
    body: 'moon',
    name: { tr: 'Apollo 11 Bayrağı', en: 'Apollo 11 Flag' },
    kind: 'flag',
    mission: { tr: 'Apollo 11 (NASA)', en: 'Apollo 11 (NASA)' },
    agency: 'NASA',
    latDeg: 0.6742,
    lonDeg: 23.4730,
    arrival: { year: 1969, month: 7, day: 21, hour: 3, minute: 41 },
    stillActive: false,
    status: {
      tr: 'Devrildi. Buzz Aldrin, kalkış sırasında motorun egzozunun bayrağı devirdiğini gördü.',
      en: 'Knocked over. Buzz Aldrin saw the engine exhaust blow it down during lift-off.',
    },
    history: [
      {
        tr: 'Ay toprağı birkaç santimetre altında çok sert olduğu için direk derine çakılamadı. Kalkış sırasında motorun egzozu bayrağı yere yatırdı. Atmosfer süzmediği için doğrudan gelen Güneş ışığı, kumaşın renklerini büyük olasılıkla soldurdu.',
        en: 'The lunar soil is very hard a few centimetres down, so the pole could not be pushed in deep. During lift-off the engine exhaust laid the flag down. Unfiltered sunlight has most likely faded its colours.',
      },
    ],
    facts: [
      { tr: 'Sonraki Apollo görevlerinin bayrakları Ay Modülü’nden daha uzağa dikildi. LRO uydusunun fotoğrafları bazılarının hâlâ ayakta durduğunu gösteriyor.', en: 'Later Apollo flags were planted further from the lunar module. Photos from the LRO spacecraft show that some of them are still standing.' },
    ],
    topicId: 'apollo11',
  },
  {
    id: 'a11_tv',
    body: 'moon',
    name: { tr: 'Televizyon Kamerası', en: 'Television Camera' },
    kind: 'instrument',
    mission: { tr: 'Apollo 11 (NASA)', en: 'Apollo 11 (NASA)' },
    agency: 'NASA',
    latDeg: 0.6743,
    lonDeg: 23.4729,
    arrival: { year: 1969, month: 7, day: 21, hour: 3, minute: 15 },
    lastContact: { year: 1969, month: 7, day: 21, hour: 5, minute: 11 },
    stillActive: false,
    status: {
      tr: 'Yerinde duruyor. Ay yürüyüşünü yüz milyonlarca kişiye canlı yayınladı.',
      en: 'Still where it was left. It broadcast the moonwalk live to hundreds of millions of people.',
    },
    history: [
      {
        tr: 'Astronotlar kamerayı Ay Modülü’nden biraz uzağa, bir ayaklığın üzerine kurdu. Ay yürüyüşü bu kameradan Dünya’ya canlı yayınlandı. Görevden sonra kamera Dünya’ya geri getirilmedi.',
        en: 'The astronauts set the camera on a stand a short way from the lunar module. The moonwalk was broadcast live to Earth through it. The camera was not brought back.',
      },
    ],
    facts: [
      { tr: 'Saniyede 10 kare, 320 satırlık siyah-beyaz görüntü üretiyordu ve yalnızca 7 watt güç harcıyordu.', en: 'It produced black-and-white pictures at 10 frames a second with 320 lines, using only 7 watts.' },
    ],
    topicId: 'apollo11',
  },
  {
    id: 'a11_bootprints',
    body: 'moon',
    name: { tr: 'İlk Ayak İzleri', en: 'First Bootprints' },
    kind: 'trace',
    mission: { tr: 'Apollo 11 (NASA)', en: 'Apollo 11 (NASA)' },
    agency: 'NASA',
    latDeg: 0.6741,
    lonDeg: 23.4731,
    arrival: { year: 1969, month: 7, day: 21, hour: 2, minute: 56 },
    stillActive: false,
    status: {
      tr: 'Yerinde. Rüzgâr ve su olmadığı için milyonlarca yıl kalabilir.',
      en: 'Still there. With no wind or water, they can last for millions of years.',
    },
    history: [
      {
        tr: 'Ay tozu, Dünya’daki kum gibi rüzgârla ve suyla aşınıp yuvarlanmadığı için sivri köşelidir. Tanecikler birbirine kenetlendiğinden ayak izleri basıldığı gün kadar net kalır.',
        en: 'Lunar dust is never worn round by wind and water like sand on Earth, so its grains stay sharp-edged. They lock together, so the bootprints stay as crisp as the day they were made.',
      },
    ],
    facts: [
      { tr: 'İzleri yavaş yavaş silecek olan şey, yüzeye düşen çok küçük göktaşlarıdır; bu milyonlarca yıl sürer.', en: 'What will slowly wipe them out is the rain of tiny meteorites hitting the surface, which takes millions of years.' },
    ],
    topicId: 'apollo11',
  },

  // ── Mars hardware ──
  {
    id: 'viking1',
    body: 'mars',
    name: { tr: 'Viking 1 İniş Aracı', en: 'Viking 1 Lander' },
    kind: 'lander',
    mission: { tr: 'Viking 1 (NASA)', en: 'Viking 1 (NASA)' },
    agency: 'NASA',
    latDeg: 22.27,
    lonDeg: -47.95,
    arrival: { year: 1976, month: 7, day: 20 },
    lastContact: { year: 1982, month: 11, day: 11 },
    stillActive: false,
    status: {
      tr: '1976–1982 arasında çalıştı (2.245 Mars günü).',
      en: 'Worked from 1976 to 1982 (2,245 Martian days).',
    },
    history: [
      {
        tr: 'Mars yüzeyinde uzun süre çalışan ilk araç. 20 Temmuz 1976’da Chryse Planitia’ya indi ve Mars yüzeyinin ilk renkli fotoğraflarını gönderdi. Altı yıldan uzun süre Mars’ın havasını ölçtü.',
        en: 'The first spacecraft to work on the surface of Mars for a long time. It landed on Chryse Planitia on 20 July 1976, sent the first colour photographs from the surface and measured the Martian weather for more than six years.',
      },
    ],
    facts: [
      { tr: 'Toprakta yaşam izi aramak için deneyler yaptı; sonuçlar yaşamın varlığını kanıtlamadı.', en: 'It ran experiments looking for signs of life in the soil; the results did not prove that life was present.' },
    ],
    modelFile: 'viking_lander.glb',
    topicId: 'viking',
  },
  {
    id: 'viking2',
    body: 'mars',
    name: { tr: 'Viking 2 İniş Aracı', en: 'Viking 2 Lander' },
    kind: 'lander',
    mission: { tr: 'Viking 2 (NASA)', en: 'Viking 2 (NASA)' },
    agency: 'NASA',
    latDeg: 47.64,
    lonDeg: 134.29,
    arrival: { year: 1976, month: 9, day: 3 },
    lastContact: { year: 1980, month: 4, day: 12 },
    stillActive: false,
    status: {
      tr: '1976–1980 arasında çalıştı (1.281 Mars günü).',
      en: 'Worked from 1976 to 1980 (1,281 Martian days).',
    },
    history: [
      {
        tr: 'Kuzeydeki Utopia Planitia düzlüğüne indi. Mars kışında kayaların üzerinde oluşan ince kırağıyı fotoğrafladı.',
        en: 'It landed on the northern plain of Utopia Planitia and photographed thin frost forming on the rocks in the Martian winter.',
      },
    ],
    facts: [
      { tr: 'Pilleri bozulunca Nisan 1980’de sustu.', en: 'It fell silent in April 1980 when its batteries failed.' },
    ],
    modelFile: 'viking_lander.glb',
    topicId: 'viking',
  },
  {
    id: 'pathfinder',
    body: 'mars',
    name: { tr: 'Mars Pathfinder ve Sojourner', en: 'Mars Pathfinder and Sojourner' },
    kind: 'rover',
    mission: { tr: 'Mars Pathfinder (NASA/JPL)', en: 'Mars Pathfinder (NASA/JPL)' },
    agency: 'NASA',
    latDeg: 19.13,
    lonDeg: -33.22,
    arrival: { year: 1997, month: 7, day: 4 },
    lastContact: { year: 1997, month: 9, day: 27 },
    stillActive: false,
    status: {
      tr: '1997’de yaklaşık üç ay çalıştı.',
      en: 'Worked for about three months in 1997.',
    },
    history: [
      {
        tr: '4 Temmuz 1997’de hava yastıklarının içinde zıplayarak Ares Vallis’e indi. İçinden çıkan 10,6 kg’lık Sojourner, Mars’ta dolaşan ilk tekerlekli araç oldu.',
        en: 'It bounced down inside airbags in Ares Vallis on 4 July 1997. The 10.6 kg Sojourner that rolled out of it was the first wheeled vehicle to drive on Mars.',
      },
    ],
    facts: [
      { tr: 'Sojourner yaklaşık 100 m yol aldı ve kayaların kimyasal yapısını inceledi.', en: 'Sojourner drove about 100 m and studied the chemistry of the rocks.' },
    ],
    topicId: 'pathfinder',
  },
  {
    id: 'mgs',
    body: 'mars',
    name: { tr: 'Mars Global Surveyor', en: 'Mars Global Surveyor' },
    kind: 'orbiter',
    mission: { tr: 'Mars Global Surveyor (NASA/JPL)', en: 'Mars Global Surveyor (NASA/JPL)' },
    agency: 'NASA',
    latDeg: 0.0,
    lonDeg: 0.0,
    arrival: { year: 1997, month: 9, day: 12 },
    lastContact: { year: 2006, month: 11, day: 2 },
    stillActive: false,
    status: {
      tr: '1997–2006 arasında Mars’ın yörüngesinde çalıştı.',
      en: 'Worked in orbit around Mars from 1997 to 2006.',
    },
    history: [
      {
        tr: 'Dokuz yıl boyunca Mars’ın çevresinde dolanarak lazerle yüzeyin yüksekliğini ölçtü ve gezegenin ayrıntılı yükseklik haritasını çıkardı.',
        en: 'For nine years it circled Mars, measuring the height of the surface with a laser and building a detailed elevation map of the planet.',
      },
    ],
    facts: [
      { tr: '240.000’den fazla fotoğraf gönderdi; bu fotoğraflarda suyla oluşmuş olabilecek genç oluklar keşfedildi.', en: 'It sent more than 240,000 pictures, in which young gullies that may have been formed by water were discovered.' },
    ],
    modelFile: 'mgs.glb',
    topicId: 'mgs',
  },
  {
    id: 'spirit',
    body: 'mars',
    name: { tr: 'Spirit Gezgini', en: 'Spirit Rover' },
    kind: 'rover',
    mission: { tr: 'Mars Keşif Gezginleri (NASA/JPL)', en: 'Mars Exploration Rovers (NASA/JPL)' },
    agency: 'NASA',
    latDeg: -14.57,
    lonDeg: 175.47,
    arrival: { year: 2004, month: 1, day: 4 },
    lastContact: { year: 2010, month: 3, day: 22 },
    stillActive: false,
    status: {
      tr: '2004–2010 arasında çalıştı.',
      en: 'Worked from 2004 to 2010.',
    },
    history: [
      {
        tr: 'Gusev Krateri’ne indi. Yalnızca 90 Mars günü çalışması planlanmıştı, ama 6 yıl çalıştı. Bozulan bir tekerleğini sürüklerken toprağı kazdı ve saf silika buldu; bu, burada geçmişte sıcak su kaynakları olduğunu gösteriyor. 2009’da yumuşak kuma saplandı ve 2010’da sustu.',
        en: 'It landed in Gusev Crater. It was planned to work for 90 Martian days but lasted six years. Dragging a broken wheel, it dug up pure silica, a sign of hot springs here long ago. It got stuck in soft sand in 2009 and fell silent in 2010.',
      },
    ],
    facts: [
      { tr: 'Toplam 7,7 km yol aldı ve başka bir gezegende bir tepeye tırmanan ilk araç oldu (Husband Hill).', en: 'It drove 7.7 km in all and was the first vehicle to climb a hill on another planet (Husband Hill).' },
    ],
    topicId: 'spirit',
  },
  {
    id: 'opportunity',
    body: 'mars',
    name: { tr: 'Opportunity Gezgini', en: 'Opportunity Rover' },
    kind: 'rover',
    mission: { tr: 'Mars Keşif Gezginleri (NASA/JPL)', en: 'Mars Exploration Rovers (NASA/JPL)' },
    agency: 'NASA',
    latDeg: -2.28,
    lonDeg: -5.35,
    arrival: { year: 2004, month: 1, day: 25 },
    lastContact: { year: 2018, month: 6, day: 10 },
    stillActive: false,
    status: {
      tr: '2004–2018 arasında çalıştı. 2018 toz fırtınasında sustu.',
      en: 'Worked from 2004 to 2018. It fell silent in the 2018 dust storm.',
    },
    history: [
      {
        tr: '90 Mars günü ve yaklaşık 1 km yol için tasarlanmıştı. Meridiani düzlüğünde 14 yıldan uzun süre çalıştı, 45,16 km yol aldı ve Mars’ta geçmişte su bulunduğuna dair önemli kanıtlar buldu.',
        en: 'It was designed for 90 Martian days and about 1 km of driving. It worked on Meridiani Planum for more than 14 years, drove 45.16 km and found strong evidence that Mars once had water.',
      },
      {
        tr: 'Haziran 2018’de gezegeni saran toz fırtınası Güneş ışığını neredeyse tamamen kesti. Güneş panelleriyle çalışan gezgin enerjisiz kaldı ve 10 Haziran 2018’den sonra bir daha sinyal göndermedi.',
        en: 'In June 2018 the dust storm that wrapped the planet blocked almost all sunlight. The solar-powered rover ran out of energy and sent no signal after 10 June 2018.',
      },
    ],
    facts: [
      { tr: 'Başka bir gezegende maraton mesafesini (42 km) aşan ilk araç.', en: 'The first vehicle to drive more than a marathon (42 km) on another planet.' },
      { tr: 'Sık alıntılanan “Pilim azaldı ve hava kararıyor” sözü gezginin değil; son verilerini özetleyen bir gazeteciye aittir.', en: 'The often-quoted line “My battery is low and it’s getting dark” is not the rover’s; it is a journalist’s summary of its last data.' },
    ],
    topicId: 'opportunity',
  },
  {
    id: 'phoenix',
    body: 'mars',
    name: { tr: 'Phoenix İniş Aracı', en: 'Phoenix Lander' },
    kind: 'lander',
    mission: { tr: 'Phoenix (NASA)', en: 'Phoenix (NASA)' },
    agency: 'NASA',
    latDeg: 68.22,
    lonDeg: -125.75,
    arrival: { year: 2008, month: 5, day: 25 },
    lastContact: { year: 2008, month: 11, day: 2 },
    stillActive: false,
    status: {
      tr: '2008’de yaklaşık beş ay çalıştı.',
      en: 'Worked for about five months in 2008.',
    },
    history: [
      {
        tr: 'Mars’ın kuzey kutup bölgesine indi. Robot koluyla birkaç santimetre kazınca beyaz su buzu ortaya çıktı. Kutup kışı başlayıp Güneş ışığı azalınca enerjisi tükendi.',
        en: 'It landed in the north polar region of Mars. When its robotic arm dug a few centimetres down, white water ice appeared. As polar winter came and the sunlight faded, it ran out of power.',
      },
    ],
    facts: [
      { tr: 'Mars toprağında perklorat tuzlarını buldu.', en: 'It found perchlorate salts in the Martian soil.' },
    ],
    topicId: 'phoenix',
  },
  {
    id: 'curiosity',
    body: 'mars',
    name: { tr: 'Curiosity Gezgini', en: 'Curiosity Rover' },
    kind: 'rover',
    mission: { tr: 'Mars Bilim Laboratuvarı (NASA/JPL)', en: 'Mars Science Laboratory (NASA/JPL)' },
    agency: 'NASA',
    latDeg: -4.59,
    lonDeg: 137.44,
    arrival: { year: 2012, month: 8, day: 6 },
    stillActive: true,
    status: {
      tr: '2012’den beri çalışıyor.',
      en: 'Working since 2012.',
    },
    history: [
      {
        tr: 'Gale Krateri’ne indi. Güneş paneli yerine nükleer güç kaynağıyla çalıştığı için 2018 toz fırtınası sırasında da çalışmayı sürdürdü. Gale Krateri’nde bir zamanlar canlıların yaşayabileceği tatlı su gölleri olduğunu gösterdi.',
        en: 'It landed in Gale Crater. Because it runs on a nuclear power source instead of solar panels, it kept working through the 2018 dust storm. It showed that Gale Crater once held freshwater lakes where life could have lived.',
      },
    ],
    facts: [
      { tr: 'Kütlesi 899 kg. Eski göl tortularında organik moleküller buldu.', en: 'Mass 899 kg. It found organic molecules in old lake sediments.' },
    ],
    topicId: 'curiosity',
  },
  {
    id: 'insight',
    body: 'mars',
    name: { tr: 'InSight İniş Aracı', en: 'InSight Lander' },
    kind: 'lander',
    mission: { tr: 'InSight (NASA/JPL)', en: 'InSight (NASA/JPL)' },
    agency: 'NASA',
    latDeg: 4.5,
    lonDeg: 135.62,
    arrival: { year: 2018, month: 11, day: 26 },
    lastContact: { year: 2022, month: 12, day: 15 },
    stillActive: false,
    status: {
      tr: '2018–2022 arasında çalıştı.',
      en: 'Worked from 2018 to 2022.',
    },
    history: [
      {
        tr: 'Mars’ın iç yapısını incelemek için Elysium Planitia’ya indi. Yüzeye koyduğu sismometreyle 1.300’den fazla Mars depremi kaydetti ve gezegenin sıvı çekirdeğinin büyüklüğünü ölçtü. Güneş panelleri tozla kaplanınca enerjisi tükendi.',
        en: 'It landed on Elysium Planitia to study the inside of Mars. With the seismometer it placed on the ground it recorded more than 1,300 marsquakes and measured the size of the planet’s liquid core. It ran out of power when dust covered its solar panels.',
      },
    ],
    facts: [
      { tr: 'Kaydettiği en büyük Mars depremi 4,7 büyüklüğündeydi (Mayıs 2022).', en: 'The largest marsquake it recorded had a magnitude of 4.7 (May 2022).' },
    ],
    modelFile: 'insight.glb',
    topicId: 'insight',
  },
  {
    id: 'perseverance',
    body: 'mars',
    name: { tr: 'Perseverance Gezgini', en: 'Perseverance Rover' },
    kind: 'rover',
    mission: { tr: 'Mars 2020 (NASA/JPL)', en: 'Mars 2020 (NASA/JPL)' },
    agency: 'NASA',
    latDeg: 18.44,
    lonDeg: 77.45,
    arrival: { year: 2021, month: 2, day: 18 },
    stillActive: true,
    status: {
      tr: '2021’den beri çalışıyor.',
      en: 'Working since 2021.',
    },
    history: [
      {
        tr: 'Bir zamanlar göl olan Jezero Krateri’ne indi. Eski nehir deltasındaki kayalardan örnekler alıp tüplerde saklıyor. Üzerindeki MOXIE deneyi, Mars’ın karbondioksitli havasından ilk kez oksijen üretti.',
        en: 'It landed in Jezero Crater, which was once a lake. It drills samples from the rocks of an old river delta and stores them in tubes. Its MOXIE experiment made oxygen from the carbon dioxide air of Mars for the first time.',
      },
    ],
    facts: [
      { tr: 'Kütlesi 1.025 kg. 23 kamerası ve Mars’ın sesini ilk kez kaydeden mikrofonları var.', en: 'Mass 1,025 kg. It carries 23 cameras and the first microphones to record the sounds of Mars.' },
    ],
    modelFile: 'perseverance.glb',
    topicId: 'perseverance',
  },
  {
    id: 'ingenuity',
    body: 'mars',
    name: { tr: 'Ingenuity Helikopteri', en: 'Ingenuity Helicopter' },
    kind: 'helicopter',
    mission: { tr: 'Mars 2020 (NASA/JPL)', en: 'Mars 2020 (NASA/JPL)' },
    agency: 'NASA',
    // Wright Brothers Field, the airfield of its first flights, beside the rover's landing site; its 72 flights
    // carried it about 17 km from here.
    latDeg: 18.44,
    lonDeg: 77.45,
    arrival: { year: 2021, month: 2, day: 18 },
    lastContact: { year: 2024, month: 1, day: 18 },
    stillActive: false,
    status: {
      tr: '2021–2024 arasında 72 kez uçtu.',
      en: 'Flew 72 times between 2021 and 2024.',
    },
    history: [
      {
        tr: 'Mars’ın havası Dünya’nınkinin yaklaşık yüzde biri yoğunluğunda olduğu için orada uçmak çok zordur. Ingenuity yalnızca 5 deneme uçuşu için tasarlanmıştı; üç yılda 72 kez uçtu ve toplam 17 km yol aldı.',
        en: 'The air on Mars is only about one percent as dense as Earth’s, which makes flying very hard. Ingenuity was designed for just five test flights; in three years it flew 72 times and covered 17 km.',
      },
      {
        tr: 'Ocak 2024’teki son inişinde pervane kanatları hasar gördü ve uçuşları sona erdi. Üzerinde, Wright Kardeşler’in 1903’teki ilk uçağından küçük bir kumaş parçası taşıyor.',
        en: 'Its rotor blades were damaged on its last landing in January 2024, which ended its flights. It carries a small piece of fabric from the Wright brothers’ first aeroplane of 1903.',
      },
    ],
    facts: [
      { tr: 'Kütlesi 1,8 kg. Pervaneleri dakikada yaklaşık 2.500 kez döner.', en: 'Mass 1.8 kg. Its rotors spin about 2,500 times a minute.' },
    ],
    modelFile: 'ingenuity.glb',
    topicId: 'ingenuity',
  },
];

/**
 * Hardware standing on the walkable sites, as offsets from the point where the astronaut arrives.
 *
 * Apollo 11: approximate positions relative to the Lunar Module at (0,0), from the traverse map of the NASA
 * Apollo 11 Preliminary Science Report.
 *
 * Mars: `visual: 'model'` draws the asset's GLB, scaled so that it stands `heightM` tall. The heights are
 * chosen so that each model's footprint matches the real vehicle (bounding boxes read from the GLB files):
 * Ingenuity 0.59 m to the top of its antenna puts the rotors at 1.2 m across; Perseverance 1.85 m gives the
 * real 2.7 m width and 3.1 m length (the model's mast is lower than the real 2.2 m); a Viking lander 2.1 m
 * to the top of its dish spans 2.9 m by 3.9 m; InSight 1.65 m spans 6.0 m across its two solar panels.
 * The landers stand 18 m north of the arrival point; that offset is a staging choice, not a measurement.
 * At Jezero the rover stands 64 m from the helicopter, the distance from which it watched the first flight
 * at Van Zyl Overlook; the direction between them here is not the real one.
 */
export const ARTIFACT_PLACEMENTS: ArtifactPlacement[] = [
  { assetId: 'a11_descent', siteId: 'apollo11', eastM: 0, southM: 0, headingDeg: 90, visual: 'apollo_lm_descent', radiusM: 6 },
  { assetId: 'a11_flag', siteId: 'apollo11', eastM: -7.5, southM: -3.2, headingDeg: 35, visual: 'flag', radiusM: 3.5 },
  { assetId: 'a11_tv', siteId: 'apollo11', eastM: -13.5, southM: -11.0, headingDeg: 130, visual: 'tv_camera', radiusM: 3.5 },
  { assetId: 'a11_lrrr', siteId: 'apollo11', eastM: -4.2, southM: 14.5, headingDeg: 180, visual: 'lrrr', radiusM: 3.5 },
  { assetId: 'a11_psep', siteId: 'apollo11', eastM: -2.0, southM: 19.2, headingDeg: 0, visual: 'psep', radiusM: 3.5 },
  { assetId: 'a11_bootprints', siteId: 'apollo11', eastM: -3.8, southM: 1.8, headingDeg: 0, visual: 'bootprints', radiusM: 3.5 },
  { assetId: 'ingenuity', siteId: 'mars_jezero', eastM: 0, southM: -24, headingDeg: 0, visual: 'model', heightM: 0.59, radiusM: 3.5 },
  { assetId: 'perseverance', siteId: 'mars_jezero', eastM: 46, southM: -68, headingDeg: 45, visual: 'model', heightM: 1.85, radiusM: 6 },
  { assetId: 'viking1', siteId: 'mars_viking1', eastM: 0, southM: -18, headingDeg: 0, visual: 'model', heightM: 2.1, radiusM: 6 },
  { assetId: 'viking2', siteId: 'mars_viking2', eastM: 0, southM: -18, headingDeg: 0, visual: 'model', heightM: 2.1, radiusM: 6 },
  { assetId: 'insight', siteId: 'mars_insight', eastM: 0, southM: -18, headingDeg: 0, visual: 'model', heightM: 1.65, radiusM: 7 },
];

/** NASA Image Library topics for the info centre; `query` is the image search. */
export const INFO_TOPICS: Record<string, { title: L10n; blurb: L10n; query: string }> = {
  sn1054: {
    title: { tr: 'SN 1054 ve Yengeç Bulutsusu', en: 'SN 1054 and the Crab Nebula' },
    blurb: {
      tr: '1054’te Boğa takımyıldızında görülen süpernovanın kalıntısı. Merkezinde saniyede yaklaşık 30 kez dönen bir nötron yıldızı var. Fotoğraflar NASA’nın Hubble, Chandra ve Webb teleskoplarından.',
      en: 'The remains of the supernova seen in Taurus in 1054. A neutron star spinning about 30 times a second sits at its centre. Pictures from NASA’s Hubble, Chandra and Webb telescopes.',
    },
    query: 'Crab Nebula Hubble Chandra',
  },
  sn1006: {
    title: { tr: 'SN 1006', en: 'SN 1006' },
    blurb: {
      tr: 'Kayıtlı tarihin en parlak yıldızı olan 1006 süpernovası ve bugün yaklaşık 60 ışık yılı genişliğindeki kalıntısı.',
      en: 'The supernova of 1006, the brightest star on record, and its remnant, now about 60 light years across.',
    },
    query: 'SN 1006 supernova remnant',
  },
  sn1572: {
    title: { tr: 'Tycho Süpernovası (1572)', en: 'Tycho’s Supernova (1572)' },
    blurb: {
      tr: '1572’de Kraliçe (Cassiopeia) takımyıldızında görülen süpernova. Tycho Brahe’nin gözlemleri, yıldızların bulunduğu gökyüzünün değişmez olmadığını gösterdi.',
      en: 'The supernova seen in Cassiopeia in 1572. Tycho Brahe’s observations showed that the starry sky is not unchanging.',
    },
    query: 'Tycho supernova remnant',
  },
  casA: {
    title: { tr: 'Cassiopeia A', en: 'Cassiopeia A' },
    blurb: {
      tr: 'Samanyolu’nun bilinen en genç süpernova kalıntılarından biri. Işığı Dünya’ya yaklaşık 1680’de ulaştı, ama aradaki toz yüzünden neredeyse hiç fark edilmedi.',
      en: 'One of the youngest known supernova remnants in the Milky Way. Its light reached Earth around 1680 but, dimmed by dust, went almost unnoticed.',
    },
    query: 'Cassiopeia A supernova remnant',
  },
  comet: {
    title: { tr: 'Kuyruklu Yıldızlar', en: 'Comets' },
    blurb: {
      tr: 'Buz ve tozdan oluşan küçük gök cisimleri. Güneş’e yaklaştıklarında gaz ve toz kuyrukları oluşur; kuyruklar hep Güneş’in tersini gösterir.',
      en: 'Small bodies made of ice and dust. Near the Sun they grow tails of gas and dust, which always point away from the Sun.',
    },
    query: 'Comet NEOWISE',
  },
  halley: {
    title: { tr: 'Halley Kuyruklu Yıldızı', en: 'Halley’s Comet' },
    blurb: {
      tr: 'Yaklaşık 76 yılda bir Güneş’e yaklaşan kuyruklu yıldız. M.Ö. 240’tan beri her gelişi kaydedilmiştir; bir sonraki gelişi 2061’de.',
      en: 'A comet that returns to the Sun about every 76 years. Every return since 240 BC has been recorded; the next is in 2061.',
    },
    query: 'Halley comet 1986',
  },
  apollo11: {
    title: { tr: 'Apollo 11', en: 'Apollo 11' },
    blurb: {
      tr: 'Neil Armstrong ve Buzz Aldrin’in 20 Temmuz 1969’da Sükûnet Denizi’ne inişi ve kurdukları aletler.',
      en: 'Neil Armstrong and Buzz Aldrin’s landing on the Sea of Tranquility on 20 July 1969, and the instruments they set up.',
    },
    query: 'Apollo 11 lunar surface Buzz Aldrin',
  },
  lrrr: {
    title: { tr: 'Lazer Yansıtıcılar', en: 'Laser Reflectors' },
    blurb: {
      tr: 'Apollo 11, 14 ve 15’in Ay’a bıraktığı yansıtıcılar. Dünya’dan gönderilen lazerle Ay’ın uzaklığı bugün de milimetre düzeyinde ölçülüyor.',
      en: 'The reflectors left on the Moon by Apollo 11, 14 and 15. Lasers fired from Earth still measure the Moon’s distance to the millimetre.',
    },
    query: 'Laser Ranging Retroreflector Apollo 11',
  },
  apollo_seismic: {
    title: { tr: 'Ay Depremleri', en: 'Moonquakes' },
    blurb: {
      tr: 'Apollo görevlerinin kurduğu sismometreler Ay depremlerini ve göktaşı çarpmalarını kaydederek Ay’ın iç yapısını ortaya çıkardı.',
      en: 'Seismometers set up by the Apollo missions recorded moonquakes and meteorite impacts, revealing what the inside of the Moon is like.',
    },
    query: 'Apollo 11 seismometer PSEP',
  },
  earth_from_moon: {
    title: { tr: 'Ay’dan Dünya', en: 'Earth from the Moon' },
    blurb: {
      tr: 'Ay Dünya’ya hep aynı yüzünü gösterdiği için, yakın yüzden bakınca Dünya gökyüzünde hemen hemen aynı yerde durur. Doğmaz, batmaz; yalnızca evreleri değişir.',
      en: 'Because the Moon always keeps the same face toward Earth, Earth stays in nearly the same place in the near-side sky. It does not rise or set; only its phase changes.',
    },
    query: 'Earthrise Apollo',
  },
  mars_global: {
    title: { tr: 'Mars', en: 'Mars' },
    blurb: {
      tr: 'Dev volkanları, büyük kanyonları ve kutup buzullarıyla Mars. Viking’den Perseverance’a pek çok araç gezegeni inceledi.',
      en: 'Mars, with its giant volcanoes, huge canyons and polar ice caps. Many spacecraft, from Viking to Perseverance, have studied it.',
    },
    query: 'Mars global Hubble Viking',
  },
  mars_2003: {
    title: { tr: 'Mars’ın 2003’teki Yakın Geçişi', en: 'Mars’s Close Approach in 2003' },
    blurb: {
      tr: '27 Ağustos 2003’te Mars Dünya’ya 55,76 milyon km yaklaştı: yaklaşık 60.000 yılın en yakın mesafesi.',
      en: 'On 27 August 2003 Mars came within 55.76 million km of Earth, the closest in about 60,000 years.',
    },
    query: 'Mars Hubble',
  },
  mars_dust_2018: {
    title: { tr: '2018 Mars Toz Fırtınası', en: '2018 Martian Dust Storm' },
    blurb: {
      tr: 'Haziran 2018’de bütün Mars’ı saran ve Opportunity gezgininin görevini sona erdiren toz fırtınası.',
      en: 'The dust storm that wrapped all of Mars in June 2018 and ended the Opportunity rover’s mission.',
    },
    query: 'Mars global dust storm 2018',
  },
  opportunity: {
    title: { tr: 'Opportunity Gezgini', en: 'Opportunity Rover' },
    blurb: {
      tr: '90 gün için tasarlanıp 14 yıldan uzun çalışan ve Mars’ta 45 km yol alan gezgin (2004–2018).',
      en: 'The rover designed for 90 days that worked for more than 14 years and drove 45 km on Mars (2004–2018).',
    },
    query: 'Opportunity rover Mars Endeavour',
  },
  spirit: {
    title: { tr: 'Spirit Gezgini', en: 'Spirit Rover' },
    blurb: {
      tr: 'Gusev Krateri’nde geçmişteki sıcak su kaynaklarının izlerini bulan gezgin (2004–2010).',
      en: 'The rover that found traces of ancient hot springs in Gusev Crater (2004–2010).',
    },
    query: 'Spirit rover Mars Gusev',
  },
  viking: {
    title: { tr: 'Viking İniş Araçları', en: 'Viking Landers' },
    blurb: {
      tr: '1976’da Mars’a inen ve yüzeyden ilk renkli fotoğrafları gönderen iki araç.',
      en: 'The two landers that reached Mars in 1976 and sent the first colour photographs from its surface.',
    },
    query: 'Viking 1 lander Mars surface',
  },
  pathfinder: {
    title: { tr: 'Mars Pathfinder ve Sojourner', en: 'Mars Pathfinder and Sojourner' },
    blurb: {
      tr: '1997’de Mars’a inen ve ilk tekerlekli gezgin Sojourner’ı taşıyan görev.',
      en: 'The 1997 mission that landed on Mars carrying Sojourner, the first wheeled rover.',
    },
    query: 'Mars Pathfinder Sojourner',
  },
  mgs: {
    title: { tr: 'Mars Global Surveyor', en: 'Mars Global Surveyor' },
    blurb: {
      tr: 'Mars’ın ayrıntılı yükseklik haritasını çıkaran yörünge aracı (1997–2006).',
      en: 'The orbiter that made a detailed elevation map of Mars (1997–2006).',
    },
    query: 'Mars Global Surveyor',
  },
  curiosity: {
    title: { tr: 'Curiosity Gezgini', en: 'Curiosity Rover' },
    blurb: {
      tr: '2012’den beri Gale Krateri’nde eski göl tortularını inceleyen, nükleer enerjiyle çalışan gezgin.',
      en: 'The nuclear-powered rover studying old lake sediments in Gale Crater since 2012.',
    },
    query: 'Curiosity rover Gale crater',
  },
  phoenix: {
    title: { tr: 'Phoenix İniş Aracı', en: 'Phoenix Lander' },
    blurb: {
      tr: '2008’de Mars’ın kuzey kutup bölgesinde toprağın altındaki su buzunu bulan araç.',
      en: 'The lander that found water ice under the soil in the north polar region of Mars in 2008.',
    },
    query: 'Phoenix Mars lander',
  },
  insight: {
    title: { tr: 'InSight', en: 'InSight' },
    blurb: {
      tr: 'Mars depremlerini dinleyerek gezegenin iç yapısını ölçen araç (2018–2022).',
      en: 'The lander that measured the inside of Mars by listening to marsquakes (2018–2022).',
    },
    query: 'InSight Mars lander',
  },
  perseverance: {
    title: { tr: 'Perseverance Gezgini', en: 'Perseverance Rover' },
    blurb: {
      tr: '2021’den beri Jezero Krateri’nde eski yaşam izleri arayan ve kaya örnekleri toplayan gezgin.',
      en: 'The rover searching for signs of ancient life and collecting rock samples in Jezero Crater since 2021.',
    },
    query: 'Perseverance rover Jezero',
  },
  ingenuity: {
    title: { tr: 'Ingenuity Helikopteri', en: 'Ingenuity Helicopter' },
    blurb: {
      tr: 'Başka bir gezegende uçan ilk araç: 2021–2024 arasında 72 kez uçtu.',
      en: 'The first aircraft to fly on another planet: 72 flights between 2021 and 2024.',
    },
    query: 'Ingenuity Mars helicopter flight',
  },
  eclipse_2026: {
    title: { tr: '12 Ağustos 2026 Güneş Tutulması', en: 'Solar Eclipse of 12 August 2026' },
    blurb: {
      tr: 'Tam tutulma Grönland, İzlanda ve İspanya’dan görülecek. Aşağıda uzaydan çekilmiş tutulma gölgesi fotoğrafları var.',
      en: 'The total eclipse will be seen from Greenland, Iceland and Spain. Below are photographs of eclipse shadows taken from space.',
    },
    query: 'Earth eclipse shadow from space DSCOVR',
  },
  solar_storm: {
    title: { tr: 'Güneş Fırtınaları', en: 'Solar Storms' },
    blurb: {
      tr: 'Güneş patlamaları ve koronal kütle atımları; Mayıs 2024 fırtınası. Kayıtlar NASA’nın uzay havası veritabanı DONKI’den.',
      en: 'Solar flares and coronal mass ejections, including the May 2024 storm. Records from DONKI, NASA’s space weather database.',
    },
    query: 'coronal mass ejection SOHO SDO',
  },
  shackleton: {
    title: { tr: 'Shackleton Krateri ve Güney Kutbu', en: 'Shackleton Crater and the South Pole' },
    blurb: {
      tr: 'Aydınlık tepeleri ve hiç Güneş görmeyen kraterleriyle Ay’ın güney kutbu.',
      en: 'The Moon’s south pole, with its sunlit ridges and craters that never see the Sun.',
    },
    query: 'Shackleton crater lunar south pole',
  },
  artemis: {
    title: { tr: 'Artemis Programı', en: 'The Artemis Programme' },
    blurb: {
      tr: 'NASA’nın insanları yeniden Ay’a, bu kez güney kutbu bölgesine götürmeyi amaçlayan programı.',
      en: 'NASA’s programme to send people back to the Moon, this time to the south polar region.',
    },
    query: 'Artemis lunar south pole',
  },
  conjunction: {
    title: { tr: 'Jüpiter–Satürn Kavuşumları', en: 'Jupiter–Saturn Conjunctions' },
    blurb: {
      tr: 'Jüpiter ile Satürn yaklaşık 20 yılda bir gökyüzünde yan yana görünür. Son büyük kavuşum Aralık 2020’deydi.',
      en: 'Jupiter and Saturn appear side by side about every 20 years. The last great conjunction was in December 2020.',
    },
    query: 'Jupiter Saturn Great Conjunction',
  },
  planets: {
    title: { tr: '5 Mayıs 2000 Gezegen Dizilimi', en: 'Planetary Line-up of 5 May 2000' },
    blurb: {
      tr: 'Güneş’in yanında toplanan beş gezegen. Dünya’dan gündüz göğünün aydınlığı yüzünden görülemedi.',
      en: 'Five planets gathered beside the Sun, hidden from Earth by the bright daytime sky.',
    },
    query: 'Solar System planets alignment',
  },
  jupiter: {
    title: { tr: 'Jüpiter', en: 'Jupiter' },
    blurb: {
      tr: 'Güneş Sistemi’nin en büyük gezegeni. Bulut kuşakları ve Büyük Kırmızı Leke adlı dev fırtınasıyla bilinir.',
      en: 'The largest planet in the Solar System, known for its cloud bands and the giant storm called the Great Red Spot.',
    },
    query: 'Jupiter Juno Hubble',
  },
  saturn: {
    title: { tr: 'Satürn', en: 'Saturn' },
    blurb: {
      tr: 'Buz parçacıklarından oluşan geniş halkalarıyla bilinen dev gezegen.',
      en: 'The giant planet known for its wide rings of ice particles.',
    },
    query: 'Saturn Cassini rings',
  },
  m31: {
    title: { tr: 'Andromeda Galaksisi (M31)', en: 'Andromeda Galaxy (M31)' },
    blurb: {
      tr: 'Yaklaşık 2,54 milyon ışık yılı uzaklıktaki en yakın büyük sarmal galaksi. Fotoğraflar NASA’nın Hubble, Spitzer ve GALEX teleskoplarından.',
      en: 'The nearest large spiral galaxy, about 2.54 million light years away. Images from NASA’s Hubble, Spitzer and GALEX telescopes.',
    },
    query: 'Andromeda galaxy M31 Hubble',
  },
  m33: {
    title: { tr: 'Üçgen Galaksisi (M33)', en: 'Triangulum Galaxy (M33)' },
    blurb: {
      tr: 'Yerel Grup’un üçüncü büyük galaksisi; gevşek sarmal kollarında yoğun yıldız oluşum bölgeleri bulunur.',
      en: 'The third-largest galaxy in the Local Group, rich in star-forming clouds along its loose spiral arms.',
    },
    query: 'Triangulum galaxy M33 Hubble',
  },
  m51: {
    title: { tr: 'Girdap Galaksisi (M51)', en: 'Whirlpool Galaxy (M51)' },
    blurb: {
      tr: 'Bize tam karşıdan bakan iki kollu sarmal galaksi ve ucundaki küçük komşusu NGC 5195.',
      en: 'Face-on two-armed spiral galaxy and its smaller companion NGC 5195.',
    },
    query: 'Whirlpool galaxy M51 Hubble',
  },
  m104: {
    title: { tr: 'Sombrero Galaksisi (M104)', en: 'Sombrero Galaxy (M104)' },
    blurb: {
      tr: 'Kenarından görülen parlak çekirdeği ve onu kesen koyu toz kuşağıyla bilinen sarmal galaksi.',
      en: 'Spiral galaxy seen almost edge-on, with a bright core bisected by a dark dust ring.',
    },
    query: 'Sombrero galaxy M104 Hubble',
  },
  m87: {
    title: { tr: 'M87 ve Kara Delik Jeti', en: 'M87 and Its Black Hole Jet' },
    blurb: {
      tr: 'Başak kümesinin merkezindeki dev eliptik galaksi; çekirdeğindeki süper kütleli kara delikten çıkan plazma jetiyle ünlüdür.',
      en: 'Giant elliptical galaxy at the centre of the Virgo Cluster, famed for the plasma jet driven by its supermassive black hole.',
    },
    query: 'M87 galaxy jet Hubble',
  },
  magellanic: {
    title: { tr: 'Macellan Bulutları (LMC ve SMC)', en: 'Magellanic Clouds (LMC and SMC)' },
    blurb: {
      tr: 'Samanyolu’nun çevresinde dolanan iki cüce uydu galaksi ve içlerindeki parlak yıldız doğumevleri.',
      en: 'Two dwarf satellite galaxies orbiting the Milky Way and their bright star-forming nebulae.',
    },
    query: 'Large Magellanic Cloud Tarantula Hubble',
  },
  mercury: {
    title: { tr: 'Merkür', en: 'Mercury' },
    blurb: {
      tr: 'Güneş’e en yakın, atmosferi olmayan kraterli gezegen. Gündüz ve gece arasındaki sıcaklık farkı 600 K’yi aşar.',
      en: 'The innermost airless cratered planet, with day-to-night temperature swings exceeding 600 K.',
    },
    query: 'Mercury MESSENGER global mosaic',
  },
  venus: {
    title: { tr: 'Venüs', en: 'Venus' },
    blurb: {
      tr: 'Yoğun karbondioksit ve sülfürik asit bulutları altında ~737 K sıcaklığa ulaşan kaçak sera gezegeni.',
      en: 'Shrouded in thick carbon-dioxide and sulfuric-acid clouds with a runaway greenhouse surface near 737 K.',
    },
    query: 'Venus Magellan Akatsuki clouds',
  },
  uranus: {
    title: { tr: 'Uranüs', en: 'Uranus' },
    blurb: {
      tr: 'Ekseni neredeyse yörünge düzlemine yatık (~98°) turkuaz buz devi; ince koyu halkaları vardır.',
      en: 'Ice giant tilted ~98 degrees onto its side, glowing pale cyan from upper-atmosphere methane with thin dark rings.',
    },
    query: 'Uranus Voyager JWST rings',
  },
  neptune: {
    title: { tr: 'Neptün', en: 'Neptune' },
    blurb: {
      tr: 'Güneş Sistemi’nin en uzak dev gezegeni; saatte 2.000 km’ye varan rüzgârları ve metan bulutlarıyla bilinir.',
      en: 'The outermost giant planet, swept by supersonic winds and bright high-altitude methane cloud streaks.',
    },
    query: 'Neptune Voyager Great Dark Spot',
  },
  moon: {
    title: { tr: 'Ay: Lunar Reconnaissance Orbiter’ın gözünden', en: 'The Moon as seen by the Lunar Reconnaissance Orbiter' },
    blurb: {
      tr: 'NASA’nın Lunar Reconnaissance Orbiter aracı 2009’dan beri Ay’ın çevresinde dönüyor; yüzeyi, kraterleri ve iniş yerlerini görüntülüyor. Bu uygulamadaki Ay arazisi de onun LOLA yükseklik ölçümlerinden gelir.',
      en: 'NASA’s Lunar Reconnaissance Orbiter has circled the Moon since 2009, picturing its surface, its craters and the landing sites. The Moon terrain in this app comes from its LOLA height measurements.',
    },
    query: 'Lunar Reconnaissance Orbiter Moon',
  },
  grb: {
    title: { tr: 'Gama ışını patlamaları', en: 'Gamma-ray bursts' },
    blurb: {
      tr: 'Evrendeki en parlak patlamalar: çoğu, çok büyük bir yıldızın çöküşünden ya da iki nötron yıldızının birleşmesinden doğar. NASA’nın Swift ve Fermi uyduları bunları düzenli olarak yakalar. Buradaki görsellerin bir kısmı teleskop gözlemi, bir kısmı bilgisayar benzetimidir.',
      en: 'The brightest explosions in the universe: most come from the collapse of a very massive star or the merger of two neutron stars. NASA’s Swift and Fermi satellites catch them regularly. Some pictures here are telescope observations, others computer simulations.',
    },
    query: 'NASA Telescopes Join Forces To Observe Unprecedented Explosion',
  },
};

/** Info topic for each Sun, Earth and planet target (supernovae and comets carry their own topicId). */
export const BODY_TOPICS: Record<BodyId, string> = {
  sun: 'solar_storm',
  earth: 'earth_from_moon',
  mercury: 'mercury',
  venus: 'venus',
  mars: 'mars_global',
  jupiter: 'jupiter',
  saturn: 'saturn',
  uranus: 'uranus',
  neptune: 'neptune',
};
