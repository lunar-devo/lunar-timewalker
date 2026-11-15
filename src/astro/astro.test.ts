import horizonsVal from '../../public/assets/data/horizons_validation.json';
import { describe, expect, it } from 'vitest';
import {
  angularSeparationDeg, computeSky, discVisibleFraction, eclipticOfRaDec, geocentricPlaces, horizonElevationAt, mapPointSeenFrom,
  solarFluxWm2, supernovaMagnitude, targetAltAz, worldTemperatureK,
} from './index';
import {
  calendarFromJd, jdFromCalendar, jdTTFromCalendarUT, jdTTfromUT, yearLabel,
} from '../core/time';

describe('time & calendar conversions', () => {
  it('round-trips Julian and Gregorian dates accurately', () => {
    const jd1054 = jdFromCalendar({ year: 1054, month: 7, day: 4, hour: 12 });
    const cal1054 = calendarFromJd(jd1054);
    expect(cal1054.year).toBe(1054);
    expect(cal1054.month).toBe(7);
    expect(cal1054.day).toBe(4);
    expect(cal1054.calendar).toBe('julian');

    const jd2026 = jdFromCalendar({ year: 2026, month: 8, day: 12, hour: 17, minute: 46 });
    const cal2026 = calendarFromJd(jd2026);
    expect(cal2026.year).toBe(2026);
    expect(cal2026.month).toBe(8);
    expect(cal2026.day).toBe(12);
    expect(cal2026.calendar).toBe('gregorian');

    expect(yearLabel(-6, 'tr')).toBe('M.Ö. 7');
    expect(yearLabel(-6, 'en')).toBe('7 BC');
  });
});

describe('JPL Horizons DE441 validation', () => {
  it('reproduces Sun topocentric az/el near Shackleton on 2026-08-12 to within 0.01 deg', () => {
    const site = { latDeg: -89.45, lonDeg: -137.2 }; // 222.8E = -137.2E
    const jdTT = jdTTfromUT(jdFromCalendar({ year: 2026, month: 8, day: 12, hour: 17 }));
    const { azDeg, elDeg } = targetAltAz(jdTT, site, 'sun');
    expect(Math.abs(azDeg - 321.5766)).toBeLessThan(0.01);
    expect(Math.abs(elDeg - 0.1813)).toBeLessThan(0.01);
  });

  it('reproduces Earth topocentric az/el at Apollo 11 on 1054-07-04 to within 0.06 deg', () => {
    const site = { latDeg: 0.6741, lonDeg: 23.4730 };
    const jdTT = jdTTfromUT(jdFromCalendar({ year: 1054, month: 7, day: 4, hour: 0 }));
    const { azDeg, elDeg } = targetAltAz(jdTT, site, 'earth');
    expect(Math.abs(azDeg - 268.9268)).toBeLessThan(0.02);
    expect(Math.abs(elDeg - 59.2966)).toBeLessThan(0.06);
  });

  it('reproduces the 7 BC Jupiter-Saturn conjunction separation (~1 deg)', () => {
    const jdTT = jdFromCalendar({ year: -6, month: 5, day: 29 });
    const sky = computeSky(jdTT, { latDeg: 0, lonDeg: 0 });
    const sep = angularSeparationDeg(sky.bodies.jupiter.dirIcrf, sky.bodies.saturn.dirIcrf);
    expect(sep).toBeGreaterThan(0.9);
    expect(sep).toBeLessThan(1.1);
  });

  it('clusters all five naked-eye planets within 17 deg of the Sun on 2000-05-05', () => {
    const jdTT = jdTTFromCalendarUT({ year: 2000, month: 5, day: 5, hour: 8 });
    const sky = computeSky(jdTT, { latDeg: 0.6741, lonDeg: 23.4730 });
    for (const id of ['mercury', 'venus', 'mars', 'jupiter', 'saturn'] as const) {
      expect(sky.bodies[id].elongationDeg).toBeLessThan(17);
    }
  });

  it('detects the 12 August 2026 solar eclipse on Earth from lunar orbit geometry', () => {
    const jdTT = jdTTFromCalendarUT({ year: 2026, month: 8, day: 12, hour: 17, minute: 46 });
    const sky = computeSky(jdTT, { latDeg: 0.6741, lonDeg: 23.4730 });
    expect(sky.earthEclipseMax).toBeGreaterThan(0.95);
    expect(sky.earthEclipsePoint).not.toBeNull();
  });

  it('validates all bundled JPL Horizons DE441 topocentric rows', () => {
    for (const row of horizonsVal.topocentric) {
      const jdTT = jdTTfromUT(row.jdUT);
      const { azDeg, elDeg } = targetAltAz(
        jdTT,
        { latDeg: row.latDeg, lonDeg: row.lonDeg },
        row.body as 'sun' | 'earth',
      );
      expect(Math.abs(azDeg - row.azDeg)).toBeLessThan(0.05);
      expect(Math.abs(elDeg - row.elDeg)).toBeLessThan(0.06);
    }
  });

  it('computes horizon disc visibility and supernova light curves cleanly', () => {
    const profile = new Float32Array(360).fill(2.0);
    expect(horizonElevationAt(profile, 123.4)).toBeCloseTo(2.0, 5);
    expect(discVisibleFraction(profile, 90, 2.0, 0.2666)).toBeCloseTo(0.5, 2);
    expect(solarFluxWm2(1.0)).toBeCloseTo(1361, 1);

    const snPeak = supernovaMagnitude({
      kind: 'supernova',
      id: 'sn1054',
      name: { tr: 'SN 1054', en: 'SN 1054' },
      raDeg: 83.6331,
      decDeg: 22.0145,
      firstLight: { year: 1054, month: 7, day: 4 },
      peakMag: -6,
      snType: 'II',
      distanceLy: 6500,
      remnantName: { tr: 'Yengeç', en: 'Crab' },
      remnantDiameterArcmin: 6,
      topicId: 'sn1054',
    }, jdTTFromCalendarUT({ year: 1054, month: 7, day: 14 }));
    expect(snPeak).toBeCloseTo(-6, 1);
  });
});

describe('planet-centred skies across the Solar System', () => {
  const jd2026 = jdTTFromCalendarUT({ year: 2026, month: 8, day: 12, hour: 12 });
  const site = { latDeg: 0, lonDeg: 0 };

  it('computes realistic solar angular sizes and AU distances from Mercury out to Neptune', () => {
    const merc = computeSky(jd2026, site, 'mercury');
    const earth = computeSky(jd2026, site, 'earth');
    const mars = computeSky(jd2026, site, 'mars');
    const nept = computeSky(jd2026, site, 'neptune');

    expect(merc.bodies.sun.distanceAU).toBeLessThan(0.5);
    expect(merc.bodies.sun.angularDiameterDeg).toBeGreaterThan(1.1);
    expect(earth.bodies.sun.distanceAU).toBeCloseTo(1.01, 1);
    expect(earth.moon).toBeDefined();
    expect(earth.moon!.angularDiameterDeg).toBeGreaterThan(0.45);
    expect(earth.moon!.angularDiameterDeg).toBeLessThan(0.60);
    expect(mars.bodies.sun.distanceAU).toBeGreaterThan(1.35);
    expect(mars.bodies.earth.distanceAU).toBeGreaterThan(0.3);
    expect(nept.bodies.sun.distanceAU).toBeGreaterThan(29);
    expect(nept.bodies.sun.angularDiameterDeg).toBeLessThan(0.025);
  });

  it('models ambient temperatures across Venus, Mars, and ice giants', () => {
    expect(worldTemperatureK('venus', -20, 0, 0.72, 0.2)).toBeCloseTo(737, 0);
    expect(worldTemperatureK('mars', 60, 1, 1.52, 0.21)).toBeGreaterThan(250);
    expect(worldTemperatureK('neptune', 30, 1, 30, 0.3)).toBeLessThan(80);
  });

  it('sees a point of the plane of the planets from another world: far ones the same way, Mars’ own place on top of it', () => {
    // A point 1,000 light years off toward the March equinox lies there from everywhere.
    const far = mapPointSeenFrom('neptune', jd2026, 0, 6.3e7);
    expect(Math.min(far.raDeg, 360 - far.raDeg)).toBeLessThan(0.01);
    expect(Math.abs(far.decDeg)).toBeLessThan(0.01);
    // The point of the map where Mars is drawn is, seen from Mars, all but underfoot (Mars strays a little from the plane).
    const mars = geocentricPlaces(jd2026).mars;
    expect(mapPointSeenFrom('mars', jd2026, mars.lonDeg, mars.distanceAU * Math.cos((mars.latDeg * Math.PI) / 180)).distanceAU).toBeLessThan(0.08);
    // From Earth itself nothing changes.
    expect(mapPointSeenFrom('earth', jd2026, 90, 5).distanceAU).toBeCloseTo(5, 9);
  });

  it('sees a point that stands for a star where the star is, once its ecliptic latitude is given', () => {
    // Sirius, 8.6 light years off: a map in the plane of the planets shows it at its ecliptic longitude.
    const sirius = { raDeg: 101.2871, decDeg: -16.7161 };
    const ecl = eclipticOfRaDec(sirius.raDeg, sirius.decDeg);
    const au = 8.6 * 63_241.077;
    for (const world of ['earth', 'moon', 'mars'] as const) {
      const seen = mapPointSeenFrom(world, jd2026, ecl.lonDeg, au, ecl.latDeg);
      expect(seen.raDeg).toBeCloseTo(sirius.raDeg, 3);
      expect(seen.decDeg).toBeCloseTo(sirius.decDeg, 3);
      expect(seen.distanceAU / au).toBeCloseTo(1, 4);
    }
    // Left in the plane, the same point lies on the ecliptic in Gemini, 40° north of the star.
    const flat = mapPointSeenFrom('earth', jd2026, ecl.lonDeg, au);
    expect(flat.decDeg - sirius.decDeg).toBeGreaterThan(38);
    expect(flat.decDeg - sirius.decDeg).toBeLessThan(41);
  });
});
