import { describe, expect, it } from 'vitest';
import type { StagingDef } from '../core/types';
import { SECONDS_PER_DAY } from '../core/time';
import { EVENTS } from '../content';
import { createDirector, momentJd, stagingEndJd } from './director';

const L = { tr: '', en: '' };
const base = { year: 2000, month: 1, day: 1, hour: 12 };

const staging: StagingDef = {
  where: 'surface',
  endRate: 1,
  stages: [
    { id: 'a', kind: 'before', label: L, caption: L, seconds: 2, from: { date: base }, to: { date: base, offsetDays: 1 } },
    { id: 'b', kind: 'event', label: L, caption: L, seconds: 1, cut: true, from: { date: base, offsetDays: 10 } },
  ],
};

function run(dt: number, steps: number) {
  const d = createDirector(staging);
  const frames = [];
  for (let i = 0; i < steps; i++) {
    const f = d.step(dt);
    frames.push(f);
    if (!f) break;
  }
  return frames;
}

describe('staging director', () => {
  it('interpolates the clock through a step at the implied rate', () => {
    const [first, ...rest] = run(0.5, 3);
    const t0 = momentJd(staging.stages[0].from);
    expect(first?.entered).toBe(true);
    expect(first?.jdTT).toBeCloseTo(t0 + 0.25, 9);
    expect(first?.rate).toBeCloseTo(SECONDS_PER_DAY / 2, 6);
    expect(rest[0]?.entered).toBe(false);
    expect(rest[1]?.jdTT).toBeCloseTo(t0 + 0.75, 9);
  });

  it('dips to black on the old moment before a cut, then enters the next step', () => {
    const frames = run(0.1, 60);
    const cutIndex = frames.findIndex((f) => f?.index === 1);
    const beforeCut = frames.slice(20, cutIndex);
    expect(beforeCut.length).toBeGreaterThan(0);
    for (const f of beforeCut) {
      expect(f?.rate).toBe(0);
      expect(f?.jdTT).toBeCloseTo(momentJd(staging.stages[0].to ?? staging.stages[0].from), 9);
    }
    expect(beforeCut[beforeCut.length - 1]?.fade).toBe(1);
    const entered = frames[cutIndex];
    expect(entered?.entered).toBe(true);
    expect(entered?.jdTT).toBeCloseTo(momentJd(staging.stages[1].from), 9);
    expect(entered?.fade).toBeGreaterThan(0.5);
  });

  it('finishes after the last step and rests at its end', () => {
    const frames = run(0.1, 200);
    expect(frames[frames.length - 1]).toBeNull();
    expect(stagingEndJd(staging)).toBeCloseTo(momentJd(staging.stages[1].from) + 1 / SECONDS_PER_DAY, 9);
  });

  it('started from a later step, enters that step at its own moment and plays on to the end', () => {
    const d = createDirector(staging, 1);
    const first = d.step(0.25);
    expect(first?.index).toBe(1);
    expect(first?.entered).toBe(true);
    expect(first?.jdTT).toBeCloseTo(momentJd(staging.stages[1].from) + 0.25 / SECONDS_PER_DAY, 9);
    expect(d.step(1)?.progress).toBe(1);
    expect(d.step(0.1)).toBeNull();
  });
});

describe('chapter stagings', () => {
  const all = EVENTS.flatMap((ev) => (ev.staging ?? []).map((s) => ({ ev, s })));

  it('exist for every chapter', () => {
    for (const ev of EVENTS) expect(ev.staging?.length, ev.id).toBeGreaterThan(0);
  });

  it('show the moment before the event first and never run the clock backwards inside a step', () => {
    for (const { ev, s } of all) {
      expect(s.stages[0].kind, ev.id).toBe('before');
      expect(s.stages.some((st) => st.kind === 'event'), ev.id).toBe(true);
      for (const st of s.stages) {
        expect(st.seconds, `${ev.id}/${st.id}`).toBeGreaterThan(0);
        if (st.to) expect(momentJd(st.to), `${ev.id}/${st.id}`).toBeGreaterThanOrEqual(momentJd(st.from));
      }
    }
  });

  it('only jump in time at cuts', () => {
    for (const { ev, s } of all) {
      for (let i = 1; i < s.stages.length; i++) {
        const prev = s.stages[i - 1];
        const prevEnd = prev.to ? momentJd(prev.to) : momentJd(prev.from) + prev.seconds / SECONDS_PER_DAY;
        const gapSec = Math.abs(momentJd(s.stages[i].from) - prevEnd) * SECONDS_PER_DAY;
        if (!s.stages[i].cut) expect(gapSec, `${ev.id}/${s.stages[i].id}`).toBeLessThan(2);
      }
    }
  });

  it('play the event itself: its moment falls inside an event step', () => {
    for (const { ev, s } of all) {
      if (s.where !== 'surface') continue;
      const eventJd = momentJd({ date: ev.date });
      const covered = s.stages.some((st) => {
        if (st.kind !== 'event') return false;
        const a = momentJd(st.from);
        const b = st.to ? momentJd(st.to) : a + st.seconds / SECONDS_PER_DAY;
        return eventJd >= a - 1 / 24 && eventJd <= b + 1 / 24;
      });
      expect(covered, ev.id).toBe(true);
    }
  });
});
