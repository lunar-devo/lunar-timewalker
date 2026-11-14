import type { Quality, QualityProfile } from './types';

export const QUALITY: Record<Quality, QualityProfile> = {
  low: {
    id: 'low', pixelRatioCap: 1, texTier: '2k', bloom: false,
    terrainGrid: 128, shadowMapSize: 1024, particles: 0.35, rocks: 300,
  },
  medium: {
    id: 'medium', pixelRatioCap: 1.25, texTier: '4k', bloom: true,
    terrainGrid: 160, shadowMapSize: 2048, particles: 0.7, rocks: 700,
  },
  high: {
    id: 'high', pixelRatioCap: 2, texTier: '8k', bloom: true,
    terrainGrid: 192, shadowMapSize: 2048, particles: 1, rocks: 1200,
  },
  ultra: {
    id: 'ultra', pixelRatioCap: 3, texTier: '8k', bloom: true,
    terrainGrid: 256, shadowMapSize: 4096, particles: 1.5, rocks: 2000,
  },
};

/** Pick a starting tier from what the device reports. Users can change it in settings. */
export function detectQuality(): Quality {
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mobile) return 'low';
  if (cores >= 8 && mem >= 8) return 'high';
  if (cores >= 4) return 'medium';
  return 'low';
}
