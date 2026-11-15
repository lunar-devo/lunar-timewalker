/**
 * What each globe of the close-up view is made of: where its map comes from, and what in the picture is not
 * what the eye would see. Earth is not here: its picture changes with the date (see ./earthImagery).
 */
import type { L10n } from '../core/types';

export const GLOBE_CAPTIONS: Record<string, L10n> = {
  moon: {
    tr: 'Ay: LRO LROC renk mozaiği; engebeler LOLA lazer ölçümlerinden (NASA SVS)',
    en: 'Moon: LRO LROC colour mosaic; relief from LOLA laser altimetry (NASA SVS)',
  },
  mercury: {
    tr: 'Merkür: MESSENGER MDIS üç filtreli renk mozaiği (NASA Mercury Trek) — gözün göreceği renklerle birebir aynı değildir',
    en: 'Mercury: MESSENGER MDIS three-filter colour mosaic (NASA Mercury Trek) — not exactly the colours the eye would see',
  },
  venus: {
    tr: 'Venüs: bulut örtüsü bir modeldir, fotoğraf değil',
    en: 'Venus: the cloud deck is a model, not a photograph',
  },
  mars: {
    tr: 'Mars: Viking MDIM 2.1 renk mozaiği (NASA/JPL/USGS Mars Trek)',
    en: 'Mars: Viking MDIM 2.1 colour mosaic (NASA/JPL/USGS Mars Trek)',
  },
  jupiter: {
    tr: 'Jüpiter: Hubble haritası, 2024 (NASA, ESA, OPAL ekibi)',
    en: 'Jupiter: Hubble map, 2024 (NASA, ESA, the OPAL team)',
  },
  saturn: {
    tr: 'Satürn: Hubble haritası, 2025 (NASA, ESA, OPAL ekibi) — halkaların örttüğü şerit tamamlanmıştır',
    en: 'Saturn: Hubble map, 2025 (NASA, ESA, the OPAL team) — the strip hidden by the rings is filled in',
  },
  uranus: {
    tr: 'Uranüs: Hubble’ın 2015 gözlemlerinden enleme göre renk (NASA, ESA, OPAL ekibi) — 49° güneyin ötesi gözlenmedi',
    en: 'Uranus: colour by latitude from Hubble’s 2015 observations (NASA, ESA, the OPAL team) — nothing was observed south of 49° south',
  },
  neptune: {
    tr: 'Neptün: NASA 3D Resources doku haritası — kaba ayrıntılı bir haritadır, yumuşatılarak gösterilir',
    en: 'Neptune: NASA 3D Resources texture map — a coarse map, shown smoothed',
  },
};
