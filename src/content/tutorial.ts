/**
 * Tutorial ("Öğretici"): a short walk through the controls at the Apollo 11 site, one control at a time.
 * Each step shows its keys, says what the control does, and moves on by itself once the engine sees it used.
 */
import type { CalendarDate, L10n } from '../core/types';

export type TutorialCheck =
  | { kind: 'look'; degrees: number }
  | { kind: 'walk'; meters: number }
  | { kind: 'run'; meters: number }
  | { kind: 'jump'; count: number }
  | { kind: 'viewMode'; mode: 'first' | 'third' }
  | { kind: 'shade'; seconds: number }
  /** The information card of a surface object has been opened. */
  | { kind: 'info'; targetId: string }
  | { kind: 'telescope' }
  | { kind: 'telescopeAim'; targetId: string; maxFovDeg: number }
  | { kind: 'enterView'; targetId: string }
  | { kind: 'surface' }
  | { kind: 'timeRate'; minRate: number };

export interface TutorialStep {
  id: string;
  /** Key caps shown in the prompt, e.g. ['Shift', 'W']; words that need translating are L10n. */
  keys: Array<string | L10n>;
  title: L10n;
  text: L10n;
  check: TutorialCheck;
}

/** Site and moment: a day after Apollo 11 landed — Sun about 35° up in the east, Earth high in the west. */
export const TUTORIAL_SITE_ID = 'apollo11';
export const TUTORIAL_DATE: CalendarDate = { year: 1969, month: 7, day: 22, hour: 20, minute: 0 };

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'look',
    keys: [{ tr: 'Sürükleyin', en: 'Drag' }, 'Tab'],
    title: { tr: 'Etrafınıza bakın', en: 'Look around' },
    text: {
      tr: 'Fare düğmesini basılı tutup sürükleyin (ya da Tab’a basıp fareyi yalnızca hareket ettirin). Ay’da hava olmadığı için gökyüzü gündüz de siyahtır.',
      en: 'Hold the mouse button and drag (or press Tab and just move the mouse). With no air on the Moon, the sky is black even by day.',
    },
    check: { kind: 'look', degrees: 120 },
  },
  {
    id: 'walk',
    keys: ['W', 'A', 'S', 'D'],
    title: { tr: 'Yürüyün', en: 'Walk' },
    text: {
      tr: 'W, A, S, D tuşlarıyla 10 metre yürüyün. Ay’da ağırlığınız Dünya’dakinin altıda biri kadardır.',
      en: 'Walk 10 metres with W, A, S and D. On the Moon you weigh a sixth of what you weigh on Earth.',
    },
    check: { kind: 'walk', meters: 10 },
  },
  {
    id: 'run',
    keys: ['Shift', 'W'],
    title: { tr: 'Koşun', en: 'Run' },
    text: {
      tr: 'Shift’e basılı tutarak koşun. Apollo astronotları da Ay’da böyle küçük sıçramalarla ilerliyordu. Yokuş yukarı yavaşlarsınız; çok dik yamaçlara çıkamazsınız.',
      en: 'Hold Shift to run. The Apollo astronauts moved like this too, in small bounds. Uphill you slow down, and very steep slopes cannot be climbed.',
    },
    check: { kind: 'run', meters: 15 },
  },
  {
    id: 'jump',
    keys: ['Space'],
    title: { tr: 'Zıplayın', en: 'Jump' },
    text: {
      tr: 'Boşluk tuşuyla zıplayın. Ay’ın çekimi zayıf olduğu için yaklaşık 1,3 metre yükselir ve 2,5 saniye havada kalırsınız.',
      en: 'Press Space to jump. The Moon’s gravity is weak, so you rise about 1.3 metres and stay in the air for 2.5 seconds.',
    },
    check: { kind: 'jump', count: 1 },
  },
  {
    id: 'third',
    keys: ['V'],
    title: { tr: 'Astronotu dışarıdan görün', en: 'See the astronaut from outside' },
    text: {
      tr: 'V tuşuyla kamerayı astronotun arkasına alın.',
      en: 'Press V to move the camera behind the astronaut.',
    },
    check: { kind: 'viewMode', mode: 'third' },
  },
  {
    id: 'first',
    keys: ['V'],
    title: { tr: 'Astronotun gözünden bakın', en: 'Look through the astronaut’s eyes' },
    text: {
      tr: 'V tuşuna yeniden basarak kaskın içinden bakmaya dönün.',
      en: 'Press V again to go back to the view from inside the helmet.',
    },
    check: { kind: 'viewMode', mode: 'first' },
  },
  {
    id: 'shade',
    keys: ['F'],
    title: { tr: 'Güneş’i elinizle kapatın', en: 'Cover the Sun with your hand' },
    text: {
      tr: 'Güneş’e dönün ve F tuşunu basılı tutun. Eldiven Güneş’in parlamasını keser; gözler karanlığa alışır ve yıldızlar görünmeye başlar.',
      en: 'Turn toward the Sun and hold F. The glove blocks the glare; your eyes adjust to the dark and stars begin to appear.',
    },
    check: { kind: 'shade', seconds: 2 },
  },
  {
    id: 'info',
    keys: ['E'],
    title: { tr: 'Bir araç hakkında bilgi alın', en: 'Get information about an object' },
    text: {
      tr: 'Ay Modülü’nün güneyindeki lazer yansıtıcıya yürüyün, ekranın ortasındaki daireyi üzerine getirin ve E’ye basın.',
      en: 'Walk to the laser reflector south of the lunar module, put the circle in the middle of the screen on it and press E.',
    },
    check: { kind: 'info', targetId: 'a11_lrrr' },
  },
  {
    id: 'telescope',
    keys: ['T'],
    title: { tr: 'Teleskobu açın', en: 'Open the telescope' },
    text: { tr: 'T tuşuyla teleskobu açın.', en: 'Press T to open the telescope.' },
    check: { kind: 'telescope' },
  },
  {
    id: 'aim',
    keys: ['+', '−', { tr: 'Tekerlek', en: 'Wheel' }],
    title: { tr: 'Dünya’ya yakınlaşın', en: 'Zoom in on Earth' },
    text: {
      tr: 'Dünya’yı bulun (batıda, yüksekte), ortaya alın ve + / − tuşları ya da fare tekerleğiyle yakınlaşın.',
      en: 'Find Earth (high in the west), centre it and zoom in with the + / − keys or the mouse wheel.',
    },
    check: { kind: 'telescopeAim', targetId: 'earth', maxFovDeg: 3 },
  },
  {
    id: 'view',
    keys: ['Enter', { tr: 'Tıklayın', en: 'Click' }],
    title: { tr: 'Dünya’nın yakın görünümünü açın', en: 'Open the close-up view of Earth' },
    text: {
      tr: 'Dünya ortadayken Enter’a basın ya da tıklayın. O tarihin uydu görüntüsü varsa gerçek bulutları görürsünüz.',
      en: 'With Earth in the centre, press Enter or click. If satellite pictures exist for that date, you see the real clouds.',
    },
    check: { kind: 'enterView', targetId: 'earth' },
  },
  {
    id: 'return',
    keys: ['Esc'],
    title: { tr: 'Ay yüzeyine dönün', en: 'Go back to the surface' },
    text: { tr: 'Esc tuşuyla ya da soldaki “Yüzeye dön” düğmesiyle geri dönün.', en: 'Press Esc or the “Back” button at the top left.' },
    check: { kind: 'surface' },
  },
  {
    id: 'time',
    keys: ['4', '5', '6'],
    title: { tr: 'Zamanı hızlandırın', en: 'Speed up time' },
    text: {
      tr: '4, 5 ya da 6 tuşuyla zamanı hızlandırın ve gölgelerin nasıl döndüğüne bakın. Ay’da bir gün, Dünya’daki yaklaşık 29,5 güne eşittir. 2 tuşu gerçek hıza döndürür.',
      en: 'Speed up time with 4, 5 or 6 and watch the shadows turn. A day on the Moon lasts about 29.5 Earth days. 2 returns to real time.',
    },
    check: { kind: 'timeRate', minRate: 3600 },
  },
];
