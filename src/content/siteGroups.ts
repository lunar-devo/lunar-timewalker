/** The headings curated sites are listed under, on the map and in the navigator. */
import type { L10n, SiteGroup } from '../core/types';

/** The order the groups are listed in. */
export const SITE_GROUP_ORDER: SiteGroup[] = ['apollo', 'robotic', 'commercial', 'international', 'artemis', 'science'];

export const SITE_GROUP_NAMES: Record<SiteGroup, L10n> = {
  apollo: { tr: 'Apollo', en: 'Apollo' },
  robotic: { tr: 'Robotik iniş araçları', en: 'Robotic landers' },
  commercial: { tr: 'Ticari iniş araçları (CLPS)', en: 'Commercial landers (CLPS)' },
  international: { tr: 'Diğer ülkeler', en: 'Other countries' },
  artemis: { tr: 'Artemis III aday bölgeleri', en: 'Artemis III candidate regions' },
  science: { tr: 'Bilimsel hedefler', en: 'Science targets' },
};
