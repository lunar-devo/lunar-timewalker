/**
 * Asset addressing. Everything under public/assets is referenced through these helpers so the
 * build works from any base path. The manifests (written by tools/) record what exists and where
 * each file came from; code must tolerate optional assets being absent by checking `hasAsset`.
 */
import type { QualityProfile } from './types';

export interface AssetRecord {
  /** Original NASA/USGS URL(s). */
  source: string;
  credit: string;
  note?: string;
  width?: number;
  height?: number;
}

export interface AssetManifest {
  generated: string;
  files: Record<string, AssetRecord>;
}

/** Each pipeline script writes its own manifest part so they never overwrite each other. */
const MANIFEST_PARTS = ['assets/manifest.textures.json', 'assets/manifest.data.json'];

let manifest: AssetManifest = { generated: '', files: {} };

/** URL for a path relative to public/, e.g. assetUrl('assets/tex/moon_color_4k.webp'). */
export function assetUrl(rel: string): string {
  return import.meta.env.BASE_URL + rel.replace(/^\/+/, '');
}

export async function loadManifest(): Promise<AssetManifest> {
  const parts = await Promise.all(MANIFEST_PARTS.map(async (rel) => {
    const res = await fetch(assetUrl(rel), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Asset manifest ${rel} missing (${res.status}). Run the asset pipeline: see README.`);
    return (await res.json()) as AssetManifest;
  }));
  manifest = {
    generated: parts.map((p) => p.generated).sort().pop() ?? '',
    files: Object.assign({}, ...parts.map((p) => p.files)),
  };
  return manifest;
}

export function getManifest(): AssetManifest {
  return manifest;
}

/** True when public/assets/<rel> was produced by the pipeline, e.g. hasAsset('tex/earth_night_4k.webp'). */
export function hasAsset(rel: string): boolean {
  return rel in manifest.files;
}

const TIERS = ['8k', '4k', '2k'] as const;
const TIER_WIDTH: Record<(typeof TIERS)[number], number> = { '8k': 8192, '4k': 4096, '2k': 2048 };
let maxTextureSize = 16384;

/** Called once by the engine with the GPU's MAX_TEXTURE_SIZE; larger tiers are then skipped. */
export function setMaxTextureSize(size: number): void {
  maxTextureSize = size;
}

/**
 * Best available tiered texture at or below the quality's tier (and the GPU's texture limit).
 * texUrl('moon_color', quality) → '<base>assets/tex/moon_color_8k.webp'. Returns null when no tier exists.
 */
export function texUrl(name: string, quality: QualityProfile, ext = 'webp'): string | null {
  const start = TIERS.indexOf(quality.texTier);
  const fits = (t: (typeof TIERS)[number]): boolean => TIER_WIDTH[t] <= maxTextureSize;
  for (let i = start; i < TIERS.length; i++) {
    const rel = `tex/${name}_${TIERS[i]}.${ext}`;
    if (fits(TIERS[i]) && hasAsset(rel)) return assetUrl('assets/' + rel);
  }
  // Fall back upward (a higher tier is better than nothing).
  for (let i = start - 1; i >= 0; i--) {
    const rel = `tex/${name}_${TIERS[i]}.${ext}`;
    if (fits(TIERS[i]) && hasAsset(rel)) return assetUrl('assets/' + rel);
  }
  return null;
}

export async function fetchJson<T>(rel: string): Promise<T> {
  const res = await fetch(assetUrl(rel));
  if (!res.ok) throw new Error(`Failed to load ${rel}: ${res.status}`);
  return (await res.json()) as T;
}
