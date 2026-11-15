/**
 * A lab scenario as an address: what explodes, how strong, where, on which day, which bodies are on the map
 * and which of them is in focus. `labLinkQuery` writes it as the query of the app's address and
 * `parseLabLink` reads it back, so that a scenario can be handed on as a link.
 */
import type { LabCmeStrength, LabExplosionKind } from '../../core/types';

export interface LabLink {
  kind: LabExplosionKind;
  cmeStrength: LabCmeStrength;
  distanceAU: number;
  /** Direction of the explosion from Earth on the map, degrees. */
  angleDeg: number;
  /** The body of the map the explosion is set at and follows; null for a place picked freely. */
  anchorId: string | null;
  /** The map's day, UT, as YYYY-MM-DD; null for the day the link is opened. */
  date: string | null;
  /** Ids of the bodies taken off the map, and of those added to it. */
  off: string[];
  add: string[];
  /** 'earth', a body's id, or 'satellites'. */
  focusId: string;
  /** Opens in the class mode. */
  quiz: boolean;
}

const KINDS: LabExplosionKind[] = ['sn2', 'sn1a', 'grb', 'cme'];
const STRENGTHS: LabCmeStrength[] = ['ordinary', 'may2024', 'carrington'];
const ID = /^[a-z][a-z0-9_]*$/;
/** The map holds far fewer bodies than this: a list in a link is read no further, and each id counts once. */
const MAX_IDS = 32;
/** The years the lab's map can be set to: 1 January of the first … 31 December of the last. */
export const LAB_FIRST_YEAR = 1900;
export const LAB_LAST_YEAR = 2100;

/** Whether `text` is YYYY-MM-DD and names a day of the calendar within those years. */
function isLabDay(text: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!parts) return false;
  const [year, month, day] = parts.slice(1).map(Number);
  if (year < LAB_FIRST_YEAR || year > LAB_LAST_YEAR) return false;
  // A day that does not exist rolls over into another month, or another year.
  const made = new Date(Date.UTC(year, month - 1, day));
  return made.getUTCFullYear() === year && made.getUTCMonth() === month - 1 && made.getUTCDate() === day;
}

/** Writes a number with six significant digits: enough for any place on the map, short in the address. */
const short = (x: number): string => String(Number(x.toPrecision(6)));

export function labLinkQuery(link: LabLink): string {
  const q = new URLSearchParams();
  q.set('lab', link.kind);
  if (link.kind === 'cme') q.set('cme', link.cmeStrength);
  q.set('d', short(link.distanceAU));
  q.set('a', short(((link.angleDeg % 360) + 360) % 360));
  if (link.anchorId) q.set('at', link.anchorId);
  if (link.date) q.set('date', link.date);
  if (link.off.length > 0) q.set('off', link.off.join(','));
  if (link.add.length > 0) q.set('add', link.add.join(','));
  if (link.focusId !== 'earth') q.set('focus', link.focusId);
  if (link.quiz) q.set('quiz', '1');
  return q.toString();
}

/**
 * The scenario in an address's query, or null when it names none. Anything it leaves out or garbles gets the
 * lab's own default: a date that is no day of the calendar, or lies outside the lab's years, is left out,
 * and the lab opens on the day the link is opened.
 */
export function parseLabLink(search: string): LabLink | null {
  const q = new URLSearchParams(search);
  const kind = KINDS.find((k) => k === q.get('lab'));
  if (!kind) return null;
  const ids = (key: string): string[] => [...new Set((q.get(key) ?? '').split(',', MAX_IDS * 4).filter((id) => ID.test(id)))].slice(0, MAX_IDS);
  const number = (key: string, fallback: number): number => {
    const raw = q.get(key);
    const value = raw === null || raw === '' ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };
  const anchor = q.get('at');
  const date = q.get('date');
  const focus = q.get('focus');
  return {
    kind,
    cmeStrength: STRENGTHS.find((s) => s === q.get('cme')) ?? 'may2024',
    distanceAU: Math.max(0, number('d', kind === 'cme' ? 1 : 0.3)),
    angleDeg: number('a', 0),
    anchorId: anchor !== null && ID.test(anchor) ? anchor : null,
    date: date !== null && isLabDay(date) ? date : null,
    off: ids('off'),
    add: ids('add'),
    focusId: focus !== null && ID.test(focus) ? focus : 'earth',
    quiz: q.get('quiz') === '1',
  };
}
