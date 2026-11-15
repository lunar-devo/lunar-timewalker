/**
 * Watching the lab's supernova from the ground. The explosion set in the lab becomes a new star in the sky of
 * a world, with a "before → event → after" sequence like those of the historical supernovae. Both are made
 * here from the lab's scenario; the engine plays them like any other event.
 */
import type { EventDef, L10n, Lang, StageMoment, StagingDef, SupernovaDef } from '../../core/types';
import { fmt, lf, tpl } from '../../core/l10n';
import { calendarUTFromJdTT } from '../../core/time';
import { LY_AU } from './map';
import { distanceText, labSupernovaMagnitude } from './physics';

export const LAB_WATCH_EVENT_ID = 'lab_watch';
export const LAB_WATCH_TARGET_ID = 'lab_sn';
export const LAB_WATCH_NAME: L10n = { tr: 'Laboratuvar süpernovası', en: 'Lab supernova' };

export interface LabWatch {
  event: EventDef;
  transient: SupernovaDef;
}

/** Days the template light curves of src/astro take to their brightest. */
const RISE_DAYS: Record<'sn2' | 'sn1a', number> = { sn2: 10, sn1a: 17 };
/** The sequence opens this many days before the light arrives. */
const LEAD_DAYS = 1;
/**
 * The day after first light on which the sequence ends: six sidereal rotations of the Moon (27.321661 days
 * each) after it opens. The view is held under the same stars while it plays (`heldToStars`), and after a
 * whole number of rotations a lunar site has those stars overhead again: the sky the sequence ends on is the
 * site's own.
 */
const END_DAY = 6 * 27.321661 - LEAD_DAYS;
/** The Sun is in the picture with the star when it stands closer to it than this, degrees. */
const SUN_IN_VIEW_DEG = 35;

/**
 * `kind`, `distanceAU`: the lab's supernova and its distance from Earth; `jdTT`: the moment its light arrives
 * (the date of the lab's map); `seen`: its direction and distance from the world it is watched from (see
 * `mapPointSeenFrom`); `sunGapDeg`: the Sun's angular distance from the star in that world's sky, degrees;
 * `aftermath`: what the lab's model says becomes of that world.
 */
export function buildLabWatch(
  kind: 'sn2' | 'sn1a', distanceAU: number, jdTT: number, seen: { raDeg: number; decDeg: number; distanceAU: number },
  sunGapDeg: number, aftermath: L10n,
): LabWatch {
  const firstLight = calendarUTFromJdTT(jdTT);
  const peakMag = labSupernovaMagnitude(kind, seen.distanceAU);
  const riseDays = RISE_DAYS[kind];
  const at = (offsetDays: number): StageMoment => ({ date: firstLight, offsetDays });
  const magnitude = (l: Lang): string => fmt(peakMag, 1, l);
  const staging: StagingDef = {
    where: 'surface',
    focusId: LAB_WATCH_TARGET_ID,
    autoSeat: true,
    heldToStars: true,
    endRate: 3600,
    stages: [
      {
        id: 'lab_before', kind: 'before', label: { tr: 'ÖNCE', en: 'BEFORE' }, seconds: 5,
        from: at(-LEAD_DAYS), to: at(-0.02),
        caption: sunGapDeg < SUN_IN_VIEW_DEG
          ? { tr: 'Patlamadan önce: gökyüzünün bu yanında Güneş’ten başka göze çarpan bir şey yok.', en: 'Before the explosion: nothing but the Sun stands out in this part of the sky.' }
          : { tr: 'Patlamadan önce: gökyüzünün bu yanında göze çarpan bir şey yok.', en: 'Before the explosion: nothing stands out in this part of the sky.' },
      },
      {
        id: 'lab_rise', kind: 'event', label: { tr: 'OLAY', en: 'EVENT' }, seconds: 12,
        from: at(-0.02), to: at(riseDays),
        caption: lf(
          tpl`Işık ulaştı: süpernova ${riseDays} günde en parlak hâline çıkar; buradan ${magnitude} kadir.`,
          tpl`The light arrives: in ${riseDays} days the supernova rises to its brightest; from here, magnitude ${magnitude}.`,
        ),
      },
      {
        id: 'lab_fade', kind: 'after', label: { tr: 'SONRA', en: 'AFTER' }, seconds: 10,
        from: at(riseDays), to: at(END_DAY),
        caption: lf(tpl`Aylar içinde söner. Modele göre sonrası: ${aftermath}`, tpl`It fades over months. What the model says comes next: ${aftermath}`),
      },
    ],
  };
  const title = lf(tpl`Laboratuvar süpernovası: ${distanceText(distanceAU)}`, tpl`Lab supernova: ${distanceText(distanceAU)}`);
  return {
    event: {
      id: LAB_WATCH_EVENT_ID,
      order: 999,
      category: 'supernova',
      title,
      dateLabel: { tr: 'Patlama Laboratuvarı', en: 'Explosion Lab' },
      summary: aftermath,
      about: [aftermath],
      date: firstLight,
      startRate: 3600,
      staging: [staging],
      defaultSiteId: 'apollo11',
      recommendedSiteIds: [],
      seenFrom: 'anywhere',
      primaryTargetId: LAB_WATCH_TARGET_ID,
      notes: [{
        tr: 'Model: Yıldızın yeri, uzaklığı ve en parlak hâli Patlama Laboratuvarı’nda seçilen senaryodan gelir; ışık eğrisi genel bir süpernova şablonudur. Gerçek bir gözlem değildir.',
        en: 'Model: the star’s place, distance and peak brightness come from the scenario set in the Explosion Lab; the light curve is a general supernova template. It is not an observation.',
      }],
      infoTopicIds: [],
      accent: '#fb923c',
    },
    transient: {
      kind: 'supernova',
      id: LAB_WATCH_TARGET_ID,
      name: LAB_WATCH_NAME,
      raDeg: seen.raDeg,
      decDeg: seen.decDeg,
      firstLight,
      peakMag,
      snType: kind === 'sn1a' ? 'Ia' : 'II',
      distanceLy: seen.distanceAU / LY_AU,
      remnantName: LAB_WATCH_NAME,
      remnantDiameterArcmin: 0,
      topicId: '',
    },
  };
}
