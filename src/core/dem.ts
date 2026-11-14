/**
 * Decoder for the "LDEM-BIN" elevation format produced by tools/build_data.py:
 * a gzip stream of little-endian Uint16, row-major, each row delta-encoded (first value absolute,
 * the rest differences mod 65536). height_m = offset + scale · value, metres above the 1 737 400 m sphere.
 * Safe to use from Web Workers.
 */
import { assetUrl } from './assets';

export interface DemMeta {
  width: number;
  height: number;
  offset: number;
  scale: number;
  nodata: number | null;
  projection: 'equirect' | 'local-aeqd';
  /** equirect */
  lonLeftDeg?: number;
  latTopDeg?: number;
  /** local-aeqd */
  centerLatDeg?: number;
  centerLonDeg?: number;
  sizeM?: number;
  metersPerSample: number;
  source: string;
  credit: string;
}

export interface Dem {
  meta: DemMeta;
  /** Raw samples, row-major; use demMeters() or meta.offset + meta.scale · value. */
  data: Uint16Array;
}

export const MOON_RADIUS_M = 1_737_400;

async function gunzipIfNeeded(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(buf, 0, 2);
  // Some hosts transparently decode gzip; only inflate when the magic bytes are still there.
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buf;
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

/** Decode a .bin payload given its metadata. */
export async function decodeDem(meta: DemMeta, payload: ArrayBuffer): Promise<Dem> {
  const raw = await gunzipIfNeeded(payload);
  const expected = meta.width * meta.height * 2;
  if (raw.byteLength !== expected) {
    throw new Error(`DEM size mismatch: got ${raw.byteLength} bytes, expected ${expected} (${meta.width}×${meta.height})`);
  }
  const data = new Uint16Array(raw);
  const w = meta.width;
  for (let row = 0, base = 0; row < meta.height; row++, base += w) {
    let acc = data[base];
    for (let i = 1; i < w; i++) {
      acc = (acc + data[base + i]) & 0xffff;
      data[base + i] = acc;
    }
  }
  return { meta, data };
}

/**
 * Load a DEM whose metadata is a standalone JSON next to the .bin
 * (e.g. loadDem('assets/dem/moon_global.json') reads assets/dem/moon_global.bin).
 */
export async function loadDem(jsonRel: string): Promise<Dem> {
  const metaRes = await fetch(assetUrl(jsonRel));
  if (!metaRes.ok) throw new Error(`DEM metadata ${jsonRel} missing (${metaRes.status})`);
  const meta = (await metaRes.json()) as DemMeta;
  return loadDemLayer(meta, jsonRel.replace(/\.json$/, '.bin'));
}

/** Load a DEM layer when the metadata is already known (site packs keep it inside meta.json). */
export async function loadDemLayer(meta: DemMeta, binRel: string): Promise<Dem> {
  const res = await fetch(assetUrl(binRel));
  if (!res.ok) throw new Error(`DEM payload ${binRel} missing (${res.status})`);
  return decodeDem(meta, await res.arrayBuffer());
}

/** Elevation in metres at integer sample (i, j), clamped to the grid. */
export function demMeters(dem: Dem, i: number, j: number): number {
  const w = dem.meta.width;
  const h = dem.meta.height;
  const ci = i < 0 ? 0 : i >= w ? w - 1 : i;
  const cj = j < 0 ? 0 : j >= h ? h - 1 : j;
  return dem.meta.offset + dem.meta.scale * dem.data[cj * w + ci];
}
