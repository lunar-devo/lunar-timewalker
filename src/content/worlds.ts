/**
 * Physical environments the astronaut can experience: solid worlds (Moon, Mercury, Venus, Earth, Mars)
 * with real surface gravity, and zero-g orbital/upper-atmosphere EVA above gas/ice giants or in open space.
 */
import type { WorldId, WorldPhysics } from '../core/types';

export const WORLDS: Record<WorldId, WorldPhysics> = {
  moon: {
    id: 'moon',
    name: { tr: 'Ay', en: 'Moon' },
    gravityMs2: 1.62,
    jumpSpeedMs: 2.08, // ~1.33 m apex, ~2.57 s in the air
    walkSpeedMs: 1.85,
    runSpeedMs: 3.8,
    zeroG: false,
    solidSurface: true,
    note: {
      tr: '1,62 m/s² çekim, hava yok. Adımlar uzun, sıçrayışlar 1,3 m yüksekliğe çıkar; gökyüzü her zaman siyahtır.',
      en: '1.62 m/s² gravity, no air. Jumps rise ~1.3 m; the sky is always black.',
    },
  },
  mercury: {
    id: 'mercury',
    name: { tr: 'Merkür', en: 'Mercury' },
    gravityMs2: 3.70,
    jumpSpeedMs: 2.08, // ~0.58 m apex
    walkSpeedMs: 2.0,
    runSpeedMs: 4.2,
    zeroG: false,
    solidSurface: true,
    note: {
      tr: '3,70 m/s² çekim, hava yok. Güneş gökte Dünya’dakinden yaklaşık 2,5 kat daha büyük ve çok daha parlak görünür; kraterli koyu yüzey.',
      en: '3.70 m/s² gravity, no air. The Sun appears ~2.5x wider and far brighter than from Earth over dark cratered terrain.',
    },
  },
  venus: {
    id: 'venus',
    name: { tr: 'Venüs', en: 'Venus' },
    gravityMs2: 8.87,
    jumpSpeedMs: 2.35, // ~0.31 m apex
    walkSpeedMs: 2.1,
    runSpeedMs: 4.6,
    zeroG: false,
    solidSurface: true,
    note: {
      tr: '8,87 m/s² çekim, çok kalın sülfürik asit bulutları (~92 bar, ~737 K model). Yıldızlar görünmez; gök kehribar sarısı pusludur.',
      en: '8.87 m/s² gravity, thick sulfuric-acid clouds (~92 bar, ~737 K model). Stars are hidden beneath an amber overcast sky.',
    },
  },
  earth: {
    id: 'earth',
    name: { tr: 'Dünya', en: 'Earth' },
    gravityMs2: 9.81,
    jumpSpeedMs: 2.45, // ~0.31 m apex, ~0.50 s in the air
    walkSpeedMs: 2.2,
    runSpeedMs: 5.0,
    zeroG: false,
    solidSurface: true,
    note: {
      tr: '9,81 m/s² çekim, mavi gökyüzü ve hava direnci. Gökte Ay’ı gerçek evresinde ve gerçek açısal boyutunda görürsünüz.',
      en: '9.81 m/s² gravity, blue sky and air drag. You see the Moon in its real phase and angular size overhead.',
    },
  },
  mars: {
    id: 'mars',
    name: { tr: 'Mars', en: 'Mars' },
    gravityMs2: 3.72,
    jumpSpeedMs: 2.08, // ~0.58 m apex, ~1.12 s in the air
    walkSpeedMs: 2.0,
    runSpeedMs: 4.2,
    zeroG: false,
    solidSurface: true,
    note: {
      tr: '3,72 m/s² çekim (Dünya’nın %38’i), ince CO₂ atmosferi ve karamel rengi gökyüzü. Dünya gökte parlak bir yıldız gibi görünür.',
      en: '3.72 m/s² gravity (38% of Earth’s), thin CO₂ air, butterscotch sky, and Earth visible as a bright star.',
    },
  },
  jupiter: {
    id: 'jupiter',
    name: { tr: 'Jüpiter (bulut tepeleri)', en: 'Jupiter (cloud tops)' },
    gravityMs2: 0,
    jumpSpeedMs: 0,
    walkSpeedMs: 8,
    runSpeedMs: 18,
    zeroG: true,
    solidSurface: false,
    note: {
      tr: 'Jüpiter bir gaz devidir, basacak katı yüzeyi yoktur. Fırtına kuşaklarının üzerinde 0g jetpack ile süzülüyorsunuz (bulut tepesi ≈ 24,8 m/s²).',
      en: 'Jupiter is a gas giant with no solid ground. Float in 0g jetpack EVA above the swirling cloud belts (cloud-top gravity ≈ 24.8 m/s²).',
    },
  },
  saturn: {
    id: 'saturn',
    name: { tr: 'Satürn (bulut tepeleri)', en: 'Saturn (cloud tops)' },
    gravityMs2: 0,
    jumpSpeedMs: 0,
    walkSpeedMs: 8,
    runSpeedMs: 18,
    zeroG: true,
    solidSurface: false,
    note: {
      tr: 'Satürn bir gaz devidir, katı yüzeyi yoktur. Altın bulutların üzerinde ve görkemli buz halkalarının altında 0g jetpack ile uçuyorsunuz.',
      en: 'Saturn is a gas giant with no solid ground. Fly in 0g jetpack EVA above golden clouds beneath the sweeping ice rings.',
    },
  },
  uranus: {
    id: 'uranus',
    name: { tr: 'Uranüs (bulut tepeleri)', en: 'Uranus (cloud tops)' },
    gravityMs2: 0,
    jumpSpeedMs: 0,
    walkSpeedMs: 8,
    runSpeedMs: 18,
    zeroG: true,
    solidSurface: false,
    note: {
      tr: 'Uranüs yan yatmış (~98°) bir buz devidir; katı yüzeyi yoktur. Turkuaz metan bulutlarının üzerinde ve ince dik halkaların yanında 0g uçuş.',
      en: 'Uranus is a sideways-tilted (~98°) ice giant with no solid ground. Float in 0g above cyan methane clouds beside its thin rings.',
    },
  },
  neptune: {
    id: 'neptune',
    name: { tr: 'Neptün (bulut tepeleri)', en: 'Neptune (cloud tops)' },
    gravityMs2: 0,
    jumpSpeedMs: 0,
    walkSpeedMs: 8,
    runSpeedMs: 18,
    zeroG: true,
    solidSurface: false,
    note: {
      tr: 'Neptün Güneş’ten ~30 AU uzakta bir buz devidir. Lacivert fırtına kuşaklarının ve beyaz metan bulutlarının üzerinde 0g jetpack uçuşu.',
      en: 'Neptune orbits ~30 AU from the Sun. Fly in 0g EVA above deep cobalt storm bands and bright white methane wisps.',
    },
  },
  orbit: {
    id: 'orbit',
    name: { tr: 'Serbest Uzay (0g)', en: 'Open Space (0g)' },
    gravityMs2: 0,
    jumpSpeedMs: 0,
    walkSpeedMs: 10,
    runSpeedMs: 25,
    zeroG: true,
    solidSurface: false,
    note: {
      tr: 'Ağırlıksız ortam (0 m/s²): W A S D ile itki verin, Boşluk ile yükselin, Q ile alçalın.',
      en: 'Weightless (0 m/s²): thrust with W A S D, rise with Space, descend with Q.',
    },
  },
};

export const WORLD_ORDER: WorldId[] = [
  'moon', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune',
];
