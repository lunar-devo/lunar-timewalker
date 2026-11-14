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

/** The scenario in an address's query, or null when it names none. Anything it leaves out or garbles gets the lab's own default. */
export function parseLabLink(search: string): LabLink | null {
  const q = new URLSearchParams(search);
  const kind = KINDS.find((k) => k === q.get('lab'));
  if (!kind) return null;
  const ids = (key: string): string[] => (q.get(key) ?? '').split(',').filter((id) => ID.test(id));
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
    date: date !== null && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    off: ids('off'),
    add: ids('add'),
    focusId: focus !== null && ID.test(focus) ? focus : 'earth',
    quiz: q.get('quiz') === '1',
  };
}
