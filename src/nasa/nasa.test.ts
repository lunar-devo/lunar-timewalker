/** DONKI answers are read without making anything up: what was not measured, or cannot be, is not shown. */
import { describe, expect, it } from 'vitest';
import { parseDonki } from './index';

const analysis = { isMostAccurate: true, speed: 1200, halfAngle: 45, latitude: -12, longitude: 30 };
const cme = (over: Record<string, unknown>, best: Record<string, unknown> = {}): Record<string, unknown> => ({
  activityID: '2024-05-08T05:36:00-CME-001',
  startTime: '2024-05-08T05:36Z',
  note: 'Halo CME.',
  link: 'https://example.test/cme',
  cmeAnalyses: [{ ...analysis, ...best }],
  ...over,
});
const gst = (over: Record<string, unknown>): Record<string, unknown> => ({
  gstID: '2024-05-10T15:00:00-GST-001',
  startTime: '2024-05-10T15:00Z',
  link: 'https://example.test/gst',
  ...over,
});

describe('parseDonki', () => {
  it('reads a coronal mass ejection from its most accurate analysis', () => {
    const raw = cme({ cmeAnalyses: [{ ...analysis, isMostAccurate: false, speed: 300 }, analysis] });
    expect(parseDonki([raw], [])).toEqual([{
      id: '2024-05-08T05:36:00-CME-001',
      type: 'CME',
      time: '2024-05-08T05:36Z',
      speedKmS: 1200,
      halfAngleDeg: 45,
      latDeg: -12,
      lonDeg: 30,
      note: 'Halo CME.',
      link: 'https://example.test/cme',
    }]);
  });

  it('leaves out an ejection whose measurements are missing or impossible', () => {
    const bad: Array<Record<string, unknown>> = [
      { speed: null }, { speed: '1200' }, { speed: 0 }, { speed: -5 }, { speed: 10000 }, { speed: Number.NaN },
      { speed: Number.POSITIVE_INFINITY },
      { halfAngle: null }, { halfAngle: -1 }, { halfAngle: 181 },
      { latitude: undefined }, { latitude: 90.5 }, { latitude: -91 },
      { longitude: null }, { longitude: 181 }, { longitude: -180.5 },
    ];
    for (const best of bad) expect(parseDonki([cme({}, best)], [])).toEqual([]);
    expect(parseDonki([cme({ cmeAnalyses: [] })], [])).toEqual([]);
    expect(parseDonki([cme({ cmeAnalyses: null })], [])).toEqual([]);
  });

  it('takes the values at the ends of their ranges', () => {
    const events = parseDonki([cme({}, { speed: 9999, halfAngle: 0, latitude: 90, longitude: -180 })], []);
    expect(events).toMatchObject([{ speedKmS: 9999, halfAngleDeg: 0, latDeg: 90, lonDeg: -180 }]);
  });

  it('leaves out a record without an id or a readable start time', () => {
    expect(parseDonki([cme({ activityID: undefined }), cme({ activityID: '' }), cme({ startTime: 'soon' }), cme({ startTime: null })], [])).toEqual([]);
    expect(parseDonki([], [gst({ gstID: 7 }), gst({ startTime: undefined })])).toEqual([]);
  });

  it('gives a storm its highest measured Kp', () => {
    const raw = gst({ allKpIndex: [{ kpIndex: 6.33 }, { kpIndex: 9 }, { kpIndex: 8 }] });
    expect(parseDonki([], [raw])).toEqual([{
      id: '2024-05-10T15:00:00-GST-001', type: 'GST', time: '2024-05-10T15:00Z', kp: 9, link: 'https://example.test/gst',
    }]);
  });

  it('gives a storm no Kp when no sample is usable', () => {
    for (const allKpIndex of [undefined, null, [], [{}], [{ kpIndex: null }, { kpIndex: 12 }, { kpIndex: -1 }, { kpIndex: '7' }]]) {
      const [storm] = parseDonki([], [gst({ allKpIndex })]);
      expect(storm.type).toBe('GST');
      expect('kp' in storm).toBe(false);
    }
    expect(parseDonki([], [gst({ allKpIndex: [{ kpIndex: 99 }, { kpIndex: 5 }] })])[0].kp).toBe(5);
  });

  it('orders the events by time and ignores answers that are not lists of records', () => {
    const late = cme({ activityID: 'late', startTime: '2024-05-11T01:00Z' });
    const events = parseDonki([late, null, 'x', cme({})], [gst({})]);
    expect(events.map((e) => e.time)).toEqual(['2024-05-08T05:36Z', '2024-05-10T15:00Z', '2024-05-11T01:00Z']);
    expect(parseDonki({ error: 'OVER_RATE_LIMIT' }, null)).toEqual([]);
  });
});
