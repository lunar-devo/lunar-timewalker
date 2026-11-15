/**
 * A place picked freely on a body, by clicking its globe or typing its coordinates: a site of its own
 * with id 'custom'.
 */
import type { Lang, SiteBody, SiteDef } from '../core/types';
import { fmt, lf, tpl } from '../core/l10n';

/** How a place picked freely on a body's globe is described. */
const PICKED_SITE_TEXT: Record<SiteBody, Pick<SiteDef, 'region' | 'blurb'>> = {
  moon: {
    region: { tr: 'Serbest Seçim Koordinatı', en: 'Custom Selenographic Coordinate' },
    blurb: {
      tr: '3B Ay küresi üzerinden doğrudan seçtiğiniz özel iniş koordinatı.',
      en: 'Custom lunar coordinates picked directly on the 3D Moon globe.',
    },
  },
  mars: {
    region: { tr: 'Serbest Seçim Koordinatı', en: 'Custom Areographic Coordinate' },
    blurb: {
      tr: '3B Mars küresi üzerinden doğrudan seçtiğiniz özel iniş koordinatı.',
      en: 'Custom Martian coordinates picked directly on the 3D Mars globe.',
    },
  },
};

/** The site at `latDeg`, `lonDeg` (east, −180..180) on `body`, named by its coordinates. */
export function customSite(body: SiteBody, latDeg: number, lonDeg: number): SiteDef {
  return {
    id: 'custom',
    body,
    latDeg,
    lonDeg,
    name: lf(
      tpl`Özel Nokta (${(l: Lang) => fmt(latDeg, 1, l)}°, ${(l: Lang) => fmt(lonDeg, 1, l)}°)`,
      tpl`Custom Site (${(l: Lang) => fmt(latDeg, 1, l)}°, ${(l: Lang) => fmt(lonDeg, 1, l)}°)`,
    ),
    ...PICKED_SITE_TEXT[body],
  };
}
