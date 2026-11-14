/**
 * NASA Image and Video Library + CCMC DONKI client with bundled archive fallback.
 * Always returns truthful `source: 'live' | 'archive'` provenance so the UI badge reflects reality.
 */
import type { DonkiEvent, DonkiResult, INasa, NasaImage, NasaTopicResult } from '../core/types';
import { fetchJson } from '../core/assets';
import { INFO_TOPICS } from '../content';

interface BundledTopicsFile {
  fetched: string;
  /** Per topic: the search it came from, lower-case words one of which every picture must mention, the pictures. */
  topics: Record<string, { query: string; keywords?: string[]; images: NasaImage[] }>;
}

interface BundledDonkiFile {
  range: { start: string; end: string };
  fetched: string;
  events: DonkiEvent[];
}

/** What every DONKI record needs: a name to tell it apart by and a start time `Date` can read. */
interface DonkiStamp { id: string; time: string }

function donkiStamp(id: unknown, time: unknown): DonkiStamp | null {
  if (typeof id !== 'string' || id === '' || typeof time !== 'string' || Number.isNaN(Date.parse(time))) return null;
  return { id, time };
}

/** The objects in a list from the API; a value that is no list, and whatever else is in a list, gives none. */
function recordsOf(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
}

/** Whether a value from the API is a number inside [min, max]; the comparisons also turn away NaN and the infinities. */
function isWithin(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && value >= min && value <= max;
}

/**
 * The events in DONKI's answers to a CME and a GST request, oldest first. Nothing is made up: a coronal mass
 * ejection is kept only with a measured speed, half angle and direction that are physically possible, a
 * storm keeps its highest measured Kp and has none when no sample is usable, and a record without an id or
 * a readable start time is left out.
 */
export function parseDonki(cmes: unknown, gsts: unknown): DonkiEvent[] {
  const events: DonkiEvent[] = [];
  for (const it of recordsOf(cmes)) {
    const stamp = donkiStamp(it.activityID, it.startTime);
    const analyses = recordsOf(it.cmeAnalyses);
    const best = analyses.find((a) => a.isMostAccurate === true) ?? analyses[0];
    if (!stamp || !best) continue;
    const { speed, halfAngle, latitude, longitude } = best;
    // The fastest ejections on record are a few thousand km/s; 10,000 is a bound no real one reaches.
    if (typeof speed !== 'number' || !(speed > 0 && speed < 10000)) continue;
    if (!isWithin(halfAngle, 0, 180) || !isWithin(latitude, -90, 90) || !isWithin(longitude, -180, 180)) continue;
    events.push({
      ...stamp,
      type: 'CME',
      speedKmS: speed,
      halfAngleDeg: halfAngle,
      latDeg: latitude,
      lonDeg: longitude,
      note: typeof it.note === 'string' ? it.note.slice(0, 260) : '',
      link: typeof it.link === 'string' ? it.link : '',
    });
  }
  for (const it of recordsOf(gsts)) {
    const stamp = donkiStamp(it.gstID, it.startTime);
    if (!stamp) continue;
    const kps = recordsOf(it.allKpIndex).map((sample) => sample.kpIndex).filter((kp) => isWithin(kp, 0, 9));
    const storm: DonkiEvent = { ...stamp, type: 'GST', link: typeof it.link === 'string' ? it.link : '' };
    if (kps.length > 0) storm.kp = Math.max(...kps);
    events.push(storm);
  }
  return events.sort((a, b) => a.time.localeCompare(b.time));
}

function cleanNasaText(raw: string, maxLen = 480): string {
  const stripped = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length <= maxLen) return stripped;
  const chunk = stripped.slice(0, maxLen);
  const dot = Math.max(chunk.lastIndexOf('. '), chunk.lastIndexOf('! '), chunk.lastIndexOf('? '));
  if (dot >= maxLen * 0.45) return chunk.slice(0, dot + 1).trim();
  const sp = chunk.lastIndexOf(' ');
  return `${(sp > 40 ? chunk.slice(0, sp) : chunk).replace(/[ ,;:-]+$/, '')}…`;
}

export function createNasa(): INasa {
  let bundledTopicsPromise: Promise<BundledTopicsFile> | null = null;
  let bundledDonkiPromise: Promise<BundledDonkiFile> | null = null;
  const topicCache = new Map<string, NasaTopicResult>();
  const donkiCache = new Map<string, DonkiResult>();

  function getBundledTopics(): Promise<BundledTopicsFile> {
    if (!bundledTopicsPromise) {
      bundledTopicsPromise = fetchJson<BundledTopicsFile>('assets/data/nasa_topics.json').catch(() => ({
        fetched: '',
        topics: {},
      }));
    }
    return bundledTopicsPromise;
  }

  function getBundledDonki(): Promise<BundledDonkiFile> {
    if (!bundledDonkiPromise) {
      bundledDonkiPromise = fetchJson<BundledDonkiFile>('assets/data/donki_archive.json').catch(() => ({
        range: { start: '2024-05-07', end: '2024-05-15' },
        fetched: '',
        events: [],
      }));
    }
    return bundledDonkiPromise;
  }

  async function fetchLiveImages(query: string, limit: number): Promise<NasaImage[] | null> {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 5500);
    try {
      const url = `https://images-api.nasa.gov/search?media_type=image&page_size=${limit}&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        collection?: {
          items?: Array<{
            data?: Array<{
              nasa_id?: string;
              title?: string;
              description?: string;
              date_created?: string;
              center?: string;
              photographer?: string;
              secondary_creator?: string;
            }>;
            links?: Array<{ href?: string }>;
          }>;
        };
      };
      const items = json.collection?.items ?? [];
      const out: NasaImage[] = [];
      for (const it of items) {
        const d0 = it.data?.[0];
        const l0 = it.links?.[0];
        if (!d0?.nasa_id || !l0?.href) continue;
        const thumbUrl = l0.href.replace(/^http:\/\//, 'https://');
        out.push({
          nasaId: d0.nasa_id,
          title: cleanNasaText(d0.title ?? d0.nasa_id, 140),
          description: cleanNasaText(d0.description ?? '', 480),
          date: (d0.date_created ?? '').slice(0, 10),
          center: d0.center ?? 'NASA',
          thumbUrl,
          imageUrl: thumbUrl,
          pageUrl: `https://images.nasa.gov/details/${encodeURIComponent(d0.nasa_id)}`,
          credit: cleanNasaText(d0.secondary_creator ?? d0.photographer ?? d0.center ?? 'NASA', 120),
        });
        if (out.length >= limit) break;
      }
      return out;
    } catch {
      return null;
    } finally {
      window.clearTimeout(timer);
    }
  }

  return {
    async getTopic(topicId: string, onArchive?: (bundled: NasaTopicResult) => void): Promise<NasaTopicResult> {
      const cached = topicCache.get(topicId);
      if (cached) return cached;

      const bundled = await getBundledTopics();
      const entry = bundled.topics[topicId];
      const archiveImages = entry?.images ?? [];
      // The snapshot's pictures need not wait for the live request, which can take seconds.
      if (archiveImages.length > 0) onArchive?.({ topicId, source: 'archive', images: archiveImages.slice(0, 12) });
      const query = entry?.query ?? INFO_TOPICS[topicId]?.query ?? topicId;
      // A free-text search also returns unrelated pictures: keep those that name the topic, as the snapshot does.
      const keywords = entry?.keywords ?? [];
      const onTopic = (img: NasaImage): boolean => {
        if (keywords.length === 0) return true;
        const text = `${img.title} ${img.description}`.toLowerCase();
        return keywords.some((w) => text.includes(w));
      };

      const live = (await fetchLiveImages(query, 8))?.filter(onTopic) ?? [];
      const liveIds = new Set(live.map((i) => i.nasaId));
      const seen = new Set(archiveImages.map((i) => i.nasaId));
      const images = [...archiveImages, ...live.filter((i) => !seen.has(i.nasaId))].slice(0, 12);
      // "Live" only when something on screen was confirmed by the API in this session.
      const res: NasaTopicResult = { topicId, source: images.some((i) => liveIds.has(i.nasaId)) ? 'live' : 'archive', images };
      topicCache.set(topicId, res);
      return res;
    },

    async search(query: string, limit = 12): Promise<NasaTopicResult> {
      const live = await fetchLiveImages(query, limit);
      if (live) return { topicId: query, source: 'live', images: live };
      return { topicId: query, source: 'archive', images: [] };
    },

    async donki(startDate: string, endDate: string): Promise<DonkiResult> {
      const key = `${startDate}..${endDate}`;
      const cached = donkiCache.get(key);
      if (cached) return cached;

      // DONKI has no records prior to 2010
      if (endDate < '2010-01-01') {
        return { source: 'live', events: [] };
      }

      const apiKey = (import.meta.env.VITE_NASA_API_KEY as string | undefined) || 'DEMO_KEY';
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 6000);
      try {
        const [cmeRes, gstRes] = await Promise.all([
          fetch(`https://api.nasa.gov/DONKI/CME?startDate=${startDate}&endDate=${endDate}&api_key=${apiKey}`, { signal: ctrl.signal }),
          fetch(`https://api.nasa.gov/DONKI/GST?startDate=${startDate}&endDate=${endDate}&api_key=${apiKey}`, { signal: ctrl.signal }),
        ]);
        if (cmeRes.ok && gstRes.ok) {
          const events = parseDonki(await cmeRes.json(), await gstRes.json());
          if (events.length > 0) {
            const res: DonkiResult = { source: 'live', events };
            donkiCache.set(key, res);
            return res;
          }
        }
      } catch {
        // Fall through to bundled archive
      } finally {
        window.clearTimeout(timer);
      }

      const archive = await getBundledDonki();
      const res: DonkiResult = { source: 'archive', events: archive.events };
      donkiCache.set(key, res);
      return res;
    },
  };
}
