import { describe, expect, it } from 'vitest';
import type { LabBody, LabCmeStrength, LabExplosionKind, LabFate, LabImpact, LabSetup } from '../../core/types';
import {
  LAB_MAX_AU, LAB_MIN_AU, LAB_ORBITS_AU, labEarthPlace, labPlaceFromEarth, labProject, labSunDistanceAU, labSunRadius, labUnproject, LY_AU,
  type MapPoint,
} from './map';
import { computeLabResults, labBlastPlace, labClockRealSec, labClockSec, labFrontsAU, labRunLines, type LabResults } from './physics';
import { labLinkQuery, parseLabLink, type LabLink } from './link';
import { GALAXIES, WORLDS } from '../../content';
import { loc } from '../../core/l10n';

/** An explosion `distanceAU` from Earth in direction `angleRad`, set at no body. */
const setupOf = (kind: LabExplosionKind, angleRad: number, distanceAU: number, cmeStrength: LabCmeStrength = 'may2024'): LabSetup => (
  { kind, angleRad, distanceAU, cmeStrength, anchorId: null }
);
const impactOf = (kind: LabExplosionKind, distanceAU: number, cmeStrength: LabCmeStrength = 'may2024'): LabImpact => (
  computeLabResults(setupOf(kind, 0, distanceAU, cmeStrength), [], []).impact
);
const stepIds = (kind: LabExplosionKind, distanceAU: number): string[] => impactOf(kind, distanceAU).steps.map((s) => s.id);
const rank: Record<string, number> = { safe: 0, caution: 1, danger: 2, extreme: 3 };

describe('Explosion Lab: supernovae', () => {
  it('at the Crab Nebula’s distance it is a harmless star of about magnitude −6 whose blast never arrives', () => {
    const res = impactOf('sn2', 6500 * LY_AU);
    expect(res.level).toBe('safe');
    expect(res.apparentMag).toBeCloseTo(-6.0, 0);
    expect(res.fluxSolar).toBeLessThan(1e-7);
    expect(res.kickKmS).toBe(0);
    expect(res.steps.map((s) => s.id)).toEqual(['light']);
  });

  it('at 50 light years it outshines the full Moon and thins the ozone layer a little', () => {
    const res = impactOf('sn2', 50 * LY_AU);
    expect(res.level).toBe('caution');
    expect(res.apparentMag).toBeLessThan(-12.7);
    expect(res.ozoneLoss).toBeGreaterThan(0.02);
    expect(res.ozoneLoss).toBeLessThan(0.3);
  });

  it('inside the 26-light-year hazard limit most of the ozone layer goes, but the planet is untouched', () => {
    const res = impactOf('sn2', 20 * LY_AU);
    expect(res.level).toBe('danger');
    expect(res.ozoneLoss).toBeGreaterThan(0.3);
    expect(res.outcome.atmosphere).toBe(0);
    expect(res.outcome.breakup).toBe(0);
  });

  it('a Type Ia at one light year is about as bright as the Sun', () => {
    const res = impactOf('sn1a', LY_AU);
    expect(res.fluxSolar).toBeGreaterThan(0.6);
    expect(res.fluxSolar).toBeLessThan(2);
    expect(res.outcome.breakup).toBe(0);
  });

  it('at the Sun’s distance the blast carries about 200 times the energy that holds Earth together', () => {
    const res = impactOf('sn2', 1);
    expect(res.level).toBe('extreme');
    // 10^44 J × (R⊕ / 2 AU)² ≈ 4.5×10^34 J against a binding energy of 2.2×10^32 J.
    expect(res.energyJ).toBeGreaterThan(3e34);
    expect(res.energyJ).toBeLessThan(6e34);
    expect(res.outcome.breakup).toBe(1);
    expect(res.kickKmS).toBeGreaterThan(3);
    expect(res.kickKmS).toBeLessThan(7);
    expect(stepIds('sn2', 1)).toEqual(['light', 'scorch', 'ozone', 'shock', 'atmosphere', 'oceans', 'crust', 'breakup', 'kick']);
    // The light's steps are over before the blast is there, although the blast follows after only 4 hours.
    expect(res.shockAtSec ?? 0).toBeGreaterThan(res.lightAtSec + 1.6);
  });

  it('never throws the remains faster than the ejecta that hit them', () => {
    // 10^44 J carried by 10 solar masses: 3,200 km/s.
    const close = impactOf('sn2', LAB_MIN_AU);
    expect(close.kickKmS).toBeGreaterThan(2500);
    expect(close.kickKmS).toBeLessThan(3200);
    expect(impactOf('sn1a', LAB_MIN_AU).kickKmS).toBeLessThan(12_000);
  });

  it('gets steadily worse as it comes closer', () => {
    const distances = [6500 * LY_AU, 100 * LY_AU, 10 * LY_AU, LY_AU, 1000, 30, 1, LAB_MIN_AU];
    let last = impactOf('sn2', distances[0]);
    for (const d of distances.slice(1)) {
      const next = impactOf('sn2', d);
      expect(next.fluxSolar).toBeGreaterThan(last.fluxSolar);
      expect(next.energyJ).toBeGreaterThan(last.energyJ);
      expect(rank[next.level]).toBeGreaterThanOrEqual(rank[last.level]);
      expect(next.outcome.breakup).toBeGreaterThanOrEqual(last.outcome.breakup);
      last = next;
    }
  });

  it('light always arrives before the blast', () => {
    for (const d of [LAB_MIN_AU, 1, 30, LY_AU, 20 * LY_AU]) {
      const steps = impactOf('sn1a', d).steps;
      const light = steps.find((s) => s.id === 'light');
      const shock = steps.find((s) => s.id === 'shock');
      expect(light && shock && light.atSec < shock.atSec).toBe(true);
    }
  });
});

describe('Explosion Lab: gamma-ray bursts', () => {
  it('from 2 kpc it is the burst of Thomas et al. (2005): 100 kJ/m² and a third of the ozone layer', () => {
    const res = impactOf('grb', 6500 * LY_AU);
    expect(res.fluenceJm2).toBeGreaterThan(0.9e5);
    expect(res.fluenceJm2).toBeLessThan(1.15e5);
    expect(res.ozoneLoss).toBeCloseTo(0.35, 2);
    expect(res.level).toBe('danger');
    // Nothing is torn off the planet, and nothing follows the rays.
    expect(res.outcome.atmosphere).toBe(0);
    expect(res.steps.map((s) => s.id)).toEqual(['shock', 'ozone']);
  });

  it('costs some ozone even from the edge of the map, and the planet itself from a few light years', () => {
    expect(impactOf('grb', 10_000 * LY_AU).level).toBe('caution');
    const close = impactOf('grb', LY_AU);
    expect(close.level).toBe('extreme');
    expect(close.outcome.atmosphere).toBeGreaterThan(0.5);
    expect(impactOf('grb', 1).outcome.breakup).toBe(1);
  });

  it('gets steadily worse as it comes closer', () => {
    let last = impactOf('grb', 10_000 * LY_AU);
    for (const d of [3000 * LY_AU, 100 * LY_AU, LY_AU, 30, LAB_MIN_AU]) {
      const next = impactOf('grb', d);
      expect(next.fluenceJm2).toBeGreaterThan(last.fluenceJm2);
      expect(rank[next.level]).toBeGreaterThanOrEqual(rank[last.level]);
      last = next;
    }
  });

  it('strikes a body that stands at the burst’s own place instead of counting it as beside the beam', () => {
    const mars: LabBody = { id: 'mars', name: { tr: 'Mars', en: 'Mars' }, kind: 'planet', angleRad: 0.4, distanceAU: 1.5 };
    const [fate] = computeLabResults(setupOf('grb', 0.4, 1.5), [mars], []).fates;
    expect(fate.level).toBe('extreme');
    expect(fate.energyJ).toBeGreaterThan(0);
  });

  it('does not report thinner ozone after the air itself has been blown off', () => {
    expect(stepIds('grb', LAB_MIN_AU)).toEqual(['shock', 'scorch', 'atmosphere', 'oceans', 'crust', 'breakup', 'kick']);
    for (const d of [LAB_MIN_AU, 0.1, 1, 30, 1000, LY_AU, 100 * LY_AU, 6500 * LY_AU]) {
      const ids = stepIds('grb', d);
      expect(ids.includes('ozone') && ids.includes('atmosphere')).toBe(false);
      expect(ids.includes('ozone') || ids.includes('atmosphere')).toBe(true);
    }
  });

  it('stops the push at a tenth of the speed of light and gives no speed beyond it', () => {
    // From the Moon's distance the momentum of the rays over Earth's mass comes to 0.64 c: outside what that formula is for.
    const close = impactOf('grb', LAB_MIN_AU);
    expect(close.kickKmS).toBeCloseTo(29_979.2458, 3);
    const told = loc(close.steps.find((s) => s.id === 'kick')?.text ?? { tr: '', en: '' }, 'en');
    expect(told).toContain('more than a tenth of the speed of light');
    expect(told).not.toContain('km/s');
    // From 0.3 AU it is about 14 km/s, and the step says so.
    const farther = impactOf('grb', 0.3);
    expect(farther.kickKmS).toBeGreaterThan(10);
    expect(farther.kickKmS).toBeLessThan(16);
    expect(loc(farther.steps.find((s) => s.id === 'kick')?.text ?? { tr: '', en: '' }, 'en')).toMatch(/at 1\d km\/s$/);
  });
});

describe('Explosion Lab: solar eruptions', () => {
  it('from the Sun’s real distance it is a May 2024 class storm: auroras to about 30°, nothing destroyed', () => {
    const res = impactOf('cme', 1);
    expect(res.level).toBe('caution');
    expect(res.auroraLatDeg).toBeGreaterThan(25);
    expect(res.auroraLatDeg).toBeLessThan(35);
    expect(res.standoffRe).toBeGreaterThan(6);
    expect(res.standoffRe).toBeLessThan(8);
    expect(res.outcome.atmosphere + res.outcome.oceans + res.outcome.crust + res.outcome.breakup).toBe(0);
    // In May 2024 the power grids stayed up: the model must not claim otherwise.
    expect(res.outcome.blackout).toBe(0);
    expect(stepIds('cme', 1)).toEqual(['light', 'shock', 'squeeze', 'aurora']);
  });

  it('is an ordinary storm from farther out and squeezes the magnetosphere flat from the Moon’s distance', () => {
    expect(impactOf('cme', 2).level).toBe('safe');
    const close = impactOf('cme', LAB_MIN_AU);
    expect(close.level).toBe('extreme');
    expect(close.standoffRe).toBe(1);
    expect(close.auroraLatDeg).toBe(0);
    // Even then it harms technology, not the planet.
    expect(close.outcome.breakup).toBe(0);
    expect(close.kickKmS).toBe(0);
    expect(close.outcome.blackout).toBe(1);
    expect(stepIds('cme', LAB_MIN_AU)).toContain('grid');
  });

  it('comes in three strengths: harmless, the storm of May 2024, and one of the Carrington class', () => {
    const ordinary = impactOf('cme', 1, 'ordinary');
    const carrington = impactOf('cme', 1, 'carrington');
    expect(ordinary.level).toBe('safe');
    expect(ordinary.auroraLatDeg).toBeGreaterThan(50);
    expect(carrington.level).toBe('danger');
    // In 1859 auroras were seen from Cuba, at about 22° north, and the cloud took 17 h 40 min (shown rounded).
    expect(carrington.auroraLatDeg).toBeGreaterThan(18);
    expect(carrington.auroraLatDeg).toBeLessThan(22);
    expect(carrington.shockTimeText.en).toBe('18 hours');
    expect(carrington.steps.map((s) => s.id)).toContain('grid');
    expect(rank[impactOf('cme', 1).level]).toBeGreaterThan(rank[ordinary.level]);
  });

  it('does nothing where the cloud arrives thinner than the ordinary solar wind', () => {
    const thin = impactOf('cme', 2, 'ordinary');
    expect(thin.pressureNPa).toBeLessThan(2);
    expect(thin.level).toBe('safe');
    // The magnetosphere keeps its quiet size: a thin cloud cannot make it larger, nor is it squeezed.
    expect(thin.standoffRe).toBeCloseTo(10.5, 6);
    expect(thin.steps.map((s) => s.id)).toEqual(['light', 'shock']);
    expect(thin.summary.en).toContain('thinner than the ordinary solar wind');
  });

  it('leaves the geostationary ring inside the magnetosphere, at its edge or outside it, by strength', () => {
    const geo = (strength: LabCmeStrength): string | undefined => impactOf('cme', 1, strength).satellites.find((s) => s.id === 'geo')?.state;
    expect(geo('ordinary')).toBe('inside');
    expect(geo('may2024')).toBe('edge');
    expect(geo('carrington')).toBe('outside');
    expect(impactOf('cme', 1, 'carrington').satellitesLevel).toBe('danger');
    // The station flies far inside all of them.
    expect(impactOf('cme', 1, 'carrington').satellites.find((s) => s.id === 'iss')?.state).toBe('inside');
    expect(impactOf('sn2', 1).satellites).toEqual([]);
  });

  it('gives the sentinels at L1 less warning the faster the cloud', () => {
    const warning = (strength: LabCmeStrength): string => impactOf('cme', 1, strength).satellites.find((s) => s.id === 'l1')?.note.en ?? '';
    expect(warning('ordinary')).toContain('50 minutes');
    expect(warning('carrington')).toContain('11 minutes');
    // With the Sun moved to inside their orbit there is nothing between it and Earth.
    expect(impactOf('cme', LAB_MIN_AU).satellites.some((s) => s.id === 'l1')).toBe(false);
  });

  it('says that it has nothing to tell where Earth would be inside the Sun, and speaks only for the cloud where the Sun is far too close', () => {
    const inside = impactOf('cme', LAB_MIN_AU);
    expect(inside.level).toBe('extreme');
    expect(loc(inside.summary, 'en')).toContain('The model does not cover this distance');
    expect(loc(inside.summary, 'tr')).toContain('Model bu uzaklığı kapsamaz');
    // The Sun's radius is 0.00465 AU: from just outside it the storm is described again.
    const near = impactOf('cme', 0.1);
    expect(near.level).toBe('extreme');
    expect(loc(near.summary, 'en')).toContain('the model leaves them out');
    for (const d of [LAB_MIN_AU, 0.004, 0.005, 0.1, 0.3]) expect(loc(impactOf('cme', d, 'carrington').summary, 'en')).not.toContain('people are not harmed');
  });
});

describe('Explosion Lab: the other bodies', () => {
  const body = (id: string, kind: LabBody['kind'], angleRad: number, distanceAU: number): LabBody => (
    { id, name: { tr: id, en: id }, kind, angleRad, distanceAU }
  );
  // Earth is at the centre: the Sun on one side, the Moon, Mars and Saturn (with Titan) on the other, Jupiter
  // (with Europa) and Neptune at right angles to that line.
  const system = [
    body('moon', 'moon', 0, 0.00257),
    body('mars', 'planet', 0, 0.6),
    body('sun', 'sun', Math.PI, 1),
    body('jupiter', 'planet', Math.PI / 2, 5),
    body('europa', 'moon', Math.PI / 2, 5),
    body('saturn', 'planet', 0.05, 9),
    body('titan', 'moon', 0.05, 9),
    body('neptune', 'planet', -Math.PI / 2, 30),
    body('sirius', 'star', 1, 8.6 * LY_AU),
  ];
  const resultsOf = (
    kind: LabExplosionKind, angleRad: number, distanceAU: number, removed: string[] = ['europa', 'titan'], cmeStrength: LabCmeStrength = 'may2024',
  ): LabResults => computeLabResults(setupOf(kind, angleRad, distanceAU, cmeStrength), system, removed);
  const fatesOf = (
    kind: LabExplosionKind, angleRad: number, distanceAU: number, removed: string[] = ['europa', 'titan'], cmeStrength: LabCmeStrength = 'may2024',
  ): Record<string, LabFate> => (
    Object.fromEntries(resultsOf(kind, angleRad, distanceAU, removed, cmeStrength).fates.map((f) => [f.id, f]))
  );
  /** The real place of a body of `system`, AU from the Sun. */
  const placeOf = (id: string): MapPoint => {
    const at = system.find((b) => b.id === id);
    return labPlaceFromEarth(labEarthPlace(system), at?.angleRad ?? 0, at?.distanceAU ?? 0);
  };

  it('a supernova just beyond Mars destroys Mars and the Moon, strips Jupiter and leaves the Sun standing', () => {
    const fates = fatesOf('sn2', 0, 0.9);
    expect(fates.mars.level).toBe('extreme');
    expect(fates.mars.outcome.breakup).toBe(1);
    expect(fates.moon.outcome.breakup).toBe(1);
    // 5 AU away, Jupiter takes a tenth of its binding energy: its upper layers go, the planet stays.
    expect(fates.jupiter.outcome.air).toBe(1);
    expect(fates.jupiter.outcome.breakup).toBeLessThan(0.1);
    expect(fates.jupiter.steps.map((s) => s.id)).not.toContain('breakup');
    expect(fates.sun.outcome.breakup).toBe(0);
    expect(fates.sun.level).not.toBe('extreme');
    // Stars of the far rings are markers, not bodies of the model.
    expect(fates.sirius).toBeUndefined();
  });

  it('gives a small body more speed than a large one at the same distance', () => {
    const fates = fatesOf('sn2', Math.PI / 4, 40);
    expect(fates.moon.kickKmS).toBeGreaterThan(fates.jupiter.kickKmS);
  });

  it('from 50 light years the same light counts for more the farther a planet is from the Sun', () => {
    const fates = fatesOf('sn2', 2, 50 * LY_AU);
    expect(fates.neptune.fluxLocal).toBeGreaterThan(fates.jupiter.fluxLocal * 20);
    expect(fates.jupiter.fluxLocal).toBeGreaterThan(fates.mars.fluxLocal * 5);
    expect(fates.neptune.level).toBe('caution');
    expect(fates.mars.level).toBe('safe');
    expect(fates.neptune.tempK).toBeGreaterThan(72);
    expect(fates.neptune.tempK).toBeLessThan(75);
    for (const fate of Object.values(fates)) expect(fate.outcome.breakup).toBe(0);
  });

  it('rates a flash that tears nothing off as dangerous at most, however bright', () => {
    // From 4 light years the light at Neptune is more than ten times its faint sunlight, yet the blast is too thin to strip it.
    const neptune = fatesOf('sn2', 2, 4 * LY_AU).neptune;
    expect(neptune.fluxLocal).toBeGreaterThan(10);
    expect(neptune.outcome.air).toBeLessThan(0.25);
    expect(neptune.level).toBe('danger');
  });

  it('never treats a body more gently as the explosion comes closer to it', () => {
    let last = fatesOf('sn1a', 0, 30).mars;
    for (const d of [5, 2, 1, 0.7]) {
      const next = fatesOf('sn1a', 0, d).mars;
      expect(rank[next.level]).toBeGreaterThanOrEqual(rank[last.level]);
      expect(next.energyJ).toBeGreaterThan(last.energyJ);
      expect(next.outcome.melt).toBeGreaterThanOrEqual(last.outcome.melt);
      last = next;
    }
  });

  it('lets the light reach every body before the blast, the nearer tokens first', () => {
    const fates = fatesOf('sn2', 0, 0.9);
    for (const fate of Object.values(fates)) {
      expect(fate.shockAtSec).not.toBeNull();
      expect(fate.lightAtSec).toBeLessThan(fate.shockAtSec ?? 0);
      expect(fate.steps[0].id).toBe('light');
    }
    expect(fates.mars.lightAtSec).toBeLessThan(fates.sun.lightAtSec);
  });

  it('a blast set off at the Moon’s distance still reaches Neptune within the run, where the drawn front is', () => {
    const setup = setupOf('sn2', 0, LAB_MIN_AU);
    const results = computeLabResults(setup, system, ['europa', 'titan']);
    const fates = Object.fromEntries(results.fates.map((f) => [f.id, f]));
    const arrives = fates.neptune.shockAtSec ?? Infinity;
    expect(arrives).toBeGreaterThan(fates.mars.shockAtSec ?? Infinity);
    expect(arrives).toBeLessThanOrEqual(20);
    // At that second the blast front is as large as Neptune is far from the explosion.
    const src = labBlastPlace(setup, system);
    const neptune = placeOf('neptune');
    const front = labFrontsAU(setup, labClockRealSec(results.clock, arrives)).blastAU ?? 0;
    expect(front / Math.hypot(neptune.x - src.x, neptune.z - src.z)).toBeCloseTo(1, 9);
    // The time-lapse is taken to last until the last of it has happened.
    expect(results.runSec).toBeGreaterThan(arrives);
  });

  it('reaches the bodies in the order of their real distance from the explosion, each front at the body at its moment', () => {
    for (const [kind, angleRad, distanceAU] of [['sn2', 0.7, 0.3], ['sn1a', 2.5, 40], ['grb', 0, 100], ['cme', Math.PI, 1], ['sn2', 1.1, 3 * LY_AU]] as const) {
      const setup = setupOf(kind, angleRad, distanceAU);
      const results = computeLabResults(setup, system, []);
      const src = labBlastPlace(setup, system);
      const reached = results.fates.filter((f) => f.shockAtSec !== null).map((f) => {
        const at = placeOf(f.id);
        return { id: f.id, au: Math.max(Math.hypot(at.x - src.x, at.z - src.z), 1e-6), sec: f.shockAtSec ?? 0 };
      });
      const byDistance = [...reached].sort((a, b) => a.au - b.au);
      const byMoment = [...reached].sort((a, b) => a.sec - b.sec || a.au - b.au);
      expect(byMoment.map((r) => r.id)).toEqual(byDistance.map((r) => r.id));
      for (const body of reached) {
        const fronts = labFrontsAU(setup, labClockRealSec(results.clock, body.sec));
        expect((kind === 'grb' ? fronts.lightAU : fronts.blastAU ?? 0) / body.au).toBeCloseTo(1, 6);
      }
      // The light is at every body, struck or not, at that body's own moment.
      for (const fate of results.fates) {
        if (kind === 'grb' && fate.shockAtSec === null) continue;
        const at = placeOf(fate.id);
        const au = Math.max(Math.hypot(at.x - src.x, at.z - src.z), 1e-6);
        expect(labFrontsAU(setup, labClockRealSec(results.clock, fate.lightAtSec)).lightAU / au).toBeCloseTo(1, 6);
      }
    }
  });

  it('lets a supernova’s light reach every body before its blast reaches the first, where light has the time', () => {
    // 40 AU away, the nearest body is 10 AU from the explosion and the farthest 70: the light, 30 times
    // faster than the ejecta, is past them all before the blast is at the first.
    const fates = Object.values(fatesOf('sn2', -Math.PI / 2, 40));
    const firstBlast = Math.min(...fates.map((f) => f.shockAtSec ?? Infinity));
    for (const fate of fates) expect(fate.lightAtSec).toBeLessThan(firstBlast);
    // Earth and the Moon, the same distance from it, go at the same moment.
    const results = resultsOf('sn2', -Math.PI / 2, 40);
    const moon = results.fates.find((f) => f.id === 'moon');
    expect(Math.abs((moon?.shockAtSec ?? 0) - (results.impact.shockAtSec ?? 9))).toBeLessThan(0.05);
  });

  it('runs until the last affected body has played out, and no longer than a class can watch', () => {
    for (const [kind, angleRad, distanceAU] of [['sn2', 0.7, 0.3], ['sn1a', 2.5, 40], ['grb', 0, 100], ['cme', Math.PI, 1], ['sn2', 1.1, 6500 * LY_AU]] as const) {
      const results = resultsOf(kind, angleRad, distanceAU, []);
      const steps = [...results.impact.steps, ...results.fates.flatMap((f) => f.steps)];
      const last = Math.max(...steps.map((s) => s.atSec));
      expect(results.runSec).toBeGreaterThanOrEqual(last + 4);
      expect(results.runSec).toBeLessThan(last + 5);
      expect(results.runSec).toBeLessThanOrEqual(31);
      // The clock never runs backwards, and its seconds and the real time are each other's inverse.
      const knots = results.clock.knots;
      for (let i = 1; i < knots.length; i++) {
        expect(knots[i].sec).toBeGreaterThanOrEqual(knots[i - 1].sec);
        expect(knots[i].realSec).toBeGreaterThanOrEqual(knots[i - 1].realSec);
      }
      const mid = knots[Math.floor(knots.length / 2)];
      expect(labClockSec(results.clock, labClockRealSec(results.clock, mid.sec * 0.83))).toBeCloseTo(mid.sec * 0.83, 6);
    }
  });

  it('says in a few words what becomes of each body, and nothing where nothing does', () => {
    const results = resultsOf('sn2', 0, 0.9);
    const fates = Object.fromEntries(results.fates.map((f) => [f.id, f]));
    expect(results.impact.verdict?.en).toBe('destroyed');
    expect(fates.mars.verdict?.en).toBe('destroyed');
    expect(fates.jupiter.verdict?.en).toBe('upper layers torn off');
    expect(fates.sun.verdict?.en).toBe('loses gas from its outer layers');
    const calm = resultsOf('grb', 0, 100);
    expect(calm.fates.find((f) => f.id === 'neptune')?.verdict).toBeNull();
    expect(impactOf('sn2', 6500 * LY_AU).verdict).toBeNull();
    for (const fate of resultsOf('cme', Math.PI, 1).fates) expect(fate.verdict === null).toBe(fate.shockAtSec === null);
  });

  it('lists every body at the arrival that causes what its line says', () => {
    // One light year away the light is there after a year (365 days, a quarter of a day short of the year the
    // times are counted in): it thins Earth's ozone layer and warms Jupiter. The blast follows 29 years
    // later; it strips Mars of its thin air and does nothing more to the others.
    const far = resultsOf('sn2', 1.1, LY_AU);
    const bodies = [{ id: 'earth', ...far.impact }, ...far.fates];
    const lines = labRunLines(far.impact, far.fates);
    const cause = (id: string): string | null => bodies.find((b) => b.id === id)?.verdictFrom ?? null;
    const line = (id: string): string => {
      const found = lines.find((l) => l.id === id);
      return `${found?.timeText ? loc(found.timeText, 'en') : '-'} · ${found?.verdict?.en ?? 'not affected'}`;
    };
    expect(line('earth')).toBe('365 days · most of the ozone layer lost');
    expect(line('jupiter')).toBe('365 days · warms up');
    expect(line('mars')).toBe('30 years · atmosphere stripped');
    for (const found of lines) {
      const body = bodies.find((b) => b.id === found.id);
      expect(found.atSec).toBe(cause(found.id) === null ? null : cause(found.id) === 'light' ? body?.lightAtSec : body?.shockAtSec);
    }
    // Every line the light causes comes before every line the blast causes; the unaffected come last.
    const order = lines.map((l) => cause(l.id) ?? 'none');
    expect(order.lastIndexOf('light')).toBeLessThan(order.indexOf('blast'));
    expect(order.lastIndexOf('blast')).toBeLessThan(order.indexOf('none'));
    expect(order.filter((c) => c === 'none').length).toBe(lines.filter((l) => l.verdict === null).length);

    // Close by, everything that is said is the blast's doing: the list is in the order of the blast's arrival.
    const near = resultsOf('sn2', 0.7, 0.3);
    const nearBodies = [{ id: 'earth', ...near.impact }, ...near.fates];
    expect(nearBodies.every((b) => b.verdictFrom === 'blast')).toBe(true);
    const nearLines = labRunLines(near.impact, near.fates);
    expect(nearLines.map((l) => l.id)).toEqual([...nearBodies].sort((a, b) => (a.shockAtSec ?? 0) - (b.shockAtSec ?? 0)).map((b) => b.id));
    for (const found of nearLines) expect(found.timeText).toBe(nearBodies.find((b) => b.id === found.id)?.shockTimeText);

    // A burst is its own light: its lines carry the time of its rays.
    const burst = resultsOf('grb', 0, 100);
    for (const found of labRunLines(burst.impact, burst.fates)) {
      const fate = burst.fates.find((f) => f.id === found.id);
      if (fate && found.atSec !== null) expect(found.atSec).toBe(fate.lightAtSec);
    }
  });

  it('heats the side of the Sun that faces a supernova near it, by the rule that holds for the planets', () => {
    // Set at Jupiter, 5.1 AU from the Sun: 4.5×10¹⁰ W/m² at peak against the 6.3×10⁷ W/m² that the Sun's
    // own surface gives off. The blast is too thin there to tear gas off it; the light is not.
    const atJupiter = computeLabResults({ ...setupOf('sn2', Math.PI / 2, 5), anchorId: 'jupiter' }, system, ['europa', 'titan']);
    const sun = atJupiter.fates.find((f) => f.id === 'sun');
    expect(sun?.outcome.air).toBeLessThan(0.25);
    expect(sun?.fluxLocal).toBeGreaterThan(500);
    expect(sun?.fluxLocal).toBeLessThan(1000);
    // 5772 K × (1 + 710)^¼.
    expect(sun?.tempK).toBeGreaterThan(28_000);
    expect(sun?.tempK).toBeLessThan(32_000);
    expect(sun?.level).toBe('danger');
    expect(sun?.verdict?.en).toBe('side facing the blast overheats');
    expect(sun?.steps.map((s) => s.id)).toEqual(['light', 'scorch', 'shock']);
    // Where the blast does tear gas off it, that is what is said first.
    expect(fatesOf('sn2', 0, 0.9).sun.verdict?.en).toBe('loses gas from its outer layers');
    // From 300 AU the light is a fifth of the Sun's own: the side facing it warms up, no more.
    const warm = fatesOf('sn2', Math.PI, 301).sun;
    expect(warm.fluxLocal).toBeGreaterThan(0.1);
    expect(warm.fluxLocal).toBeLessThan(0.4);
    expect(warm.level).toBe('caution');
    expect(warm.verdict?.en).toBe('warms up');
    // From Betelgeuse's distance it is a hundred-billionth: nothing.
    const far = fatesOf('sn2', 1.1, 550 * LY_AU).sun;
    expect(far.level).toBe('safe');
    expect(far.verdict).toBeNull();
    expect(far.fluxLocal).toBeLessThan(1e-9);
    expect(far.tempK).toBeCloseTo(5772, 3);
  });

  it('a solar eruption aimed at Earth strikes what lies along its way and misses the rest', () => {
    const fates = fatesOf('cme', Math.PI, 1);
    // The Sun is the eruption itself.
    expect(fates.sun).toBeUndefined();
    expect(fates.moon.steps.map((s) => s.id)).toEqual(['light', 'shock', 'surface']);
    expect(fates.mars.steps.map((s) => s.id)).toEqual(['light', 'shock', 'escape']);
    expect(fates.mars.level).toBe('caution');
    // Saturn's magnetosphere gives way by the same law as Earth's: to 64 % of its quiet size.
    expect(fates.saturn.standoffRadii).toBeCloseTo(22 * 15 ** (-1 / 6), 1);
    expect(fates.saturn.steps.map((s) => s.id)).toEqual(['light', 'shock', 'squeeze', 'aurora']);
    for (const id of ['jupiter', 'neptune']) {
      expect(fates[id].level).toBe('safe');
      expect(fates[id].pressureNPa).toBe(0);
      expect(fates[id].shockAtSec).toBeNull();
      expect(fates[id].outcome.storm).toBe(0);
    }
    // Nothing is destroyed by a solar eruption.
    for (const fate of Object.values(fates)) expect(fate.outcome.breakup + fate.outcome.melt + fate.outcome.air).toBe(0);
  });

  it('has nothing to say about a body that has been taken off the map', () => {
    const fates = fatesOf('sn2', 0, 0.9, ['mars', 'jupiter', 'europa', 'titan']);
    expect(Object.keys(fates).sort()).toEqual(['moon', 'neptune', 'saturn', 'sun']);
  });

  it('a burst inside the solar system strikes only what its two beams cross', () => {
    // From 100 AU along the line of the Moon, Mars and the Sun: Neptune, far off that line, sees nothing.
    const fates = fatesOf('grb', 0, 100);
    for (const id of ['moon', 'mars', 'sun']) expect(fates[id].shockAtSec).not.toBeNull();
    expect(fates.neptune.shockAtSec).toBeNull();
    expect(fates.neptune.level).toBe('safe');
    expect(fates.neptune.steps).toEqual([]);
    expect(fates.mars.level).toBe('extreme');
    // A burst has no light ahead of its rays.
    expect(fates.mars.steps[0].id).toBe('shock');
    expect(fates.mars.lightAtSec).toBe(fates.mars.shockAtSec);
  });

  it('from 6,500 light years the whole solar system is inside the beam, and only the planets with air notice', () => {
    const fates = fatesOf('grb', 2, 6500 * LY_AU);
    for (const fate of Object.values(fates)) expect(fate.fluenceJm2).toBeGreaterThan(0.9e5);
    expect(fates.moon.level).toBe('safe');
    expect(fates.mars.level).toBe('caution');
    expect(fates.jupiter.level).toBe('caution');
    expect(fates.sun.level).toBe('safe');
  });

  it('Titan is out of the solar wind in an ordinary eruption and in it in a strong one; Europa never is', () => {
    const calm = fatesOf('cme', Math.PI, 1, [], 'ordinary');
    const strong = fatesOf('cme', Math.PI, 1, []);
    expect(calm.titan.shockAtSec).toBeNull();
    expect(calm.titan.level).toBe('safe');
    expect(strong.titan.steps.map((s) => s.id)).toEqual(['light', 'shock', 'escape']);
    expect(strong.titan.level).toBe('caution');
    // Jupiter and Europa stand outside this cloud; inside one, Europa is still deep in Jupiter's magnetosphere.
    const aimed = fatesOf('cme', -Math.PI / 2, 1, [], 'carrington');
    expect(aimed.jupiter.shockAtSec).not.toBeNull();
    expect(aimed.europa.shockAtSec).toBeNull();
  });

  it('melts a shell of ice long before it melts a crust of rock', () => {
    const fates = fatesOf('sn2', Math.PI / 2, 4.9, []);
    // Europa and Jupiter stand together, a tenth of an AU from this explosion.
    expect(fates.europa.bodyClass).toBe('icy');
    expect(fates.europa.outcome.melt).toBe(1);
    // From 3,000 AU the same blast half melts Europa's ice and leaves the Moon's rock solid.
    const far = fatesOf('sn2', 0, 3000, []);
    expect(far.europa.outcome.melt).toBeGreaterThan(0.3);
    expect(far.moon.outcome.melt).toBeLessThan(0.1);
  });

  it('takes an explosion set at a body to be right beside it, on every date', () => {
    // Jupiter on two dates: elsewhere in the sky, nearer to Earth.
    const sun = body('sun', 'sun', Math.PI, 1);
    const setAt = (at: LabBody, kind: LabExplosionKind, bodies: LabBody[]): Record<string, LabFate> => (
      Object.fromEntries(computeLabResults({ ...setupOf(kind, at.angleRad, at.distanceAU), anchorId: at.id }, bodies, []).fates.map((f) => [f.id, f]))
    );
    const jupiterIn = body('jupiter', 'planet', 2.1, 5.2);
    const jupiterLater = body('jupiter', 'planet', 1.6, 4.4);
    const first = setAt(jupiterIn, 'sn2', [jupiterIn, sun]).jupiter;
    const later = setAt(jupiterLater, 'sn2', [jupiterLater, sun]).jupiter;
    // Three of Jupiter's radii: 209,733 km, and 0.7 s for the light.
    expect(loc(first.distanceLabel, 'en')).toBe('210 thousand km');
    expect(loc(later.distanceLabel, 'en')).toBe('210 thousand km');
    expect(later.energyJ / first.energyJ).toBeCloseTo(1, 6);
    expect(later.kickKmS / first.kickKmS).toBeCloseTo(1, 6);
    expect(first.level).toBe('extreme');
    expect(first.outcome.breakup).toBe(1);
    // The other bodies are measured from where Jupiter really is: the Sun is 4.77 AU from Jupiter's own
    // place, and 4.78 AU from an explosion three radii beyond it.
    const sunFate = setAt(jupiterIn, 'sn2', [jupiterIn, sun]).sun;
    expect(loc(fatesOf('sn2', 2.1, 5.2).sun.distanceLabel, 'en')).toBe('4.77 AU');
    expect(loc(sunFate.distanceLabel, 'en')).toBe('4.78 AU');
    // A place picked by hand a third of a radian along is that place, 1.7 AU from Jupiter.
    const [beside] = computeLabResults(setupOf('sn2', 2.43, 5.2), [jupiterIn, sun], []).fates;
    expect(loc(beside.distanceLabel, 'en')).toBe('1.71 AU');
  });

  it('a burst set at a body strikes that body, on every date', () => {
    for (const [id, kind, au] of [['moon', 'moon', 0.00257], ['mars', 'planet', 1.9], ['jupiter', 'planet', 5.2], ['saturn', 'planet', 9.6], ['sun', 'sun', 0.99]] as const) {
      for (const skyRad of [0.3, 2.9, -1.2]) {
        const at = body(id, kind, skyRad, au);
        const [fate] = computeLabResults({ ...setupOf('grb', skyRad, au), anchorId: id }, [at], []).fates;
        expect(fate.shockAtSec).not.toBeNull();
        expect(fate.steps[0].id).toBe('shock');
        expect(fate.energyJ).toBeGreaterThan(0);
        expect(fate.level).toBe('extreme');
      }
    }
    // The Moon is 5,212 km from a burst set at it: the rays are there in 17 thousandths of a second.
    const moon = body('moon', 'moon', 0.3, 0.00257);
    const [fate] = computeLabResults({ ...setupOf('grb', 0.3, 0.00257), anchorId: 'moon' }, [moon], []).fates;
    expect(loc(fate.distanceLabel, 'en')).toBe('5 thousand km');
    expect(loc(fate.lightTimeText, 'en')).toBe('17 ms');
  });

  it('an explosion set at a planet is the size of its moon’s orbit away from that moon, and the other way round', () => {
    const jupiter = body('jupiter', 'planet', Math.PI / 2, 5);
    const europa = body('europa', 'moon', Math.PI / 2, 5);
    const distanceTo = (id: string, at: LabBody): string => {
      const fates = computeLabResults({ ...setupOf('sn2', at.angleRad, 5), anchorId: at.id }, [jupiter, europa], []).fates;
      return loc(fates.find((f) => f.id === id)?.distanceLabel ?? { tr: '', en: '' }, 'en');
    };
    // Europa goes round Jupiter at 9.4 of Jupiter's radii: 657,000 km.
    expect(distanceTo('europa', jupiter)).toBe('657 thousand km');
    expect(distanceTo('jupiter', europa)).toBe('657 thousand km');
    expect(distanceTo('europa', europa)).toBe('5 thousand km');
  });
});

describe('Explosion Lab: the map round the Sun', () => {
  it('puts the orbits of the planets one step apart in their true order, and never turns back', () => {
    LAB_ORBITS_AU.forEach((au, i) => expect(labSunRadius(au)).toBeCloseTo((i + 1) * labSunRadius(LAB_ORBITS_AU[0]), 9));
    let last = -1;
    for (let e = -4; e <= Math.log10(LAB_MAX_AU); e += 0.01) {
      const radius = labSunRadius(10 ** e);
      expect(radius).toBeGreaterThan(last);
      expect(labSunDistanceAU(radius) / 10 ** e).toBeCloseTo(1, 9);
      last = radius;
    }
  });

  it('gives back the real place of every place it draws, in Earth’s magnified neighbourhood too', () => {
    for (const earthLon of [0, 1.3, -2.4]) {
      const earth = { x: Math.cos(earthLon), z: Math.sin(earthLon) };
      for (const angleRad of [0, 0.9, 2.2, 3.1, -1.4]) {
        for (const au of [LAB_MIN_AU, 0.01, 0.05, 0.11, 0.3, 0.99, 1.7, 5, 31, 400, LY_AU, 26 * LY_AU, LAB_MAX_AU]) {
          const place = labPlaceFromEarth(earth, angleRad, au);
          const back = labUnproject(labProject(place, earth), earth);
          expect(Math.hypot(back.x - place.x, back.z - place.z) / au).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('draws the Moon and an explosion at the Moon’s distance apart from Earth, and moves the explosion without a jump', () => {
    const earth = { x: -0.6, z: 0.8 };
    const home = labProject(earth, earth);
    const spot = (au: number): MapPoint => labProject(labPlaceFromEarth(earth, 0.4, au), earth);
    const near = spot(LAB_MIN_AU);
    expect(Math.hypot(near.x - home.x, near.z - home.z)).toBeGreaterThan(1);
    // The whole range of the distance slider: one continuous path. A step ten times finer moves the explosion
    // about ten times less, everywhere (it moves most between Neptune's and Pluto's rings, a third of a unit
    // for a hundredth of a decade).
    for (const [step, most] of [[0.01, 0.4], [0.001, 0.04]]) {
      let last = near;
      for (let e = Math.log10(LAB_MIN_AU) + step; e <= Math.log10(LAB_MAX_AU); e += step) {
        const next = spot(10 ** e);
        expect(Math.hypot(next.x - last.x, next.z - last.z)).toBeLessThan(most);
        last = next;
      }
    }
  });

  it('moves a planet anticlockwise seen from the north as its longitude grows', () => {
    // The map's angle is minus the ecliptic longitude, and the map is looked at from +y with x to the right
    // and z toward the viewer: a growing longitude turns from +x toward −z, anticlockwise on the screen.
    const earth = { x: 1, z: 0 };
    const sun: LabBody = { id: 'sun', name: { tr: 'Güneş', en: 'Sun' }, kind: 'sun', angleRad: Math.PI, distanceAU: 1 };
    expect(labEarthPlace([sun]).x).toBeCloseTo(1, 12);
    const at = (lonDeg: number): MapPoint => labProject({ x: 5.2 * Math.cos((-lonDeg * Math.PI) / 180), z: 5.2 * Math.sin((-lonDeg * Math.PI) / 180) }, earth);
    const before = at(100);
    const after = at(110);
    // On the screen (x right, −z up) the cross product of the two places is positive for an anticlockwise turn.
    expect(before.x * -after.z - -before.z * after.x).toBeGreaterThan(0);
  });
});

describe('Explosion Lab: scenarios as links', () => {
  const link: LabLink = {
    kind: 'cme', cmeStrength: 'carrington', distanceAU: 0.989412, angleDeg: 127.25, anchorId: 'sun', date: '2026-11-14',
    off: ['mars', 'jupiter'], add: ['titan'], focusId: 'satellites', quiz: false,
  };

  it('reads back exactly the scenario it wrote', () => {
    expect(parseLabLink(`?${labLinkQuery(link)}`)).toEqual(link);
    const plain: LabLink = { ...link, kind: 'sn2', cmeStrength: 'may2024', anchorId: null, date: null, off: [], add: [], focusId: 'earth', quiz: true };
    expect(parseLabLink(labLinkQuery(plain))).toEqual(plain);
  });

  it('names no scenario for an address without one, and survives a garbled one', () => {
    expect(parseLabLink('')).toBeNull();
    expect(parseLabLink('?chapter=free')).toBeNull();
    expect(parseLabLink('?lab=nova')).toBeNull();
    const garbled = parseLabLink('?lab=grb&d=abc&a=&off=mars,<b>,,JUPITER&focus=../x&date=14.11.2026&cme=huge');
    expect(garbled).toEqual({
      kind: 'grb', cmeStrength: 'may2024', distanceAU: 0.3, angleDeg: 0, anchorId: null, date: null, off: ['mars'], add: [], focusId: 'earth', quiz: false,
    });
  });

  it('counts a body named many times once, and reads no endless list', () => {
    const repeated = parseLabLink(`?lab=sn2&off=${'mars,'.repeat(5000)}venus&add=titan,titan`);
    expect(repeated?.off).toEqual(['mars']);
    expect(repeated?.add).toEqual(['titan']);
    const many = parseLabLink(`?lab=sn2&off=${Array.from({ length: 500 }, (_, i) => `b${i}`).join(',')}`);
    expect(many?.off.length).toBeLessThanOrEqual(32);
  });

  it('leaves out a date that is no day of the calendar or lies outside the lab’s years', () => {
    const dateOf = (text: string): string | null | undefined => parseLabLink(`?lab=sn2&date=${text}`)?.date;
    for (const text of ['2100-13-45', '9999-99-99', '0000-00-00', '2026-02-30', '2023-02-29', '2026-00-10', '2026-04-31', '1899-12-31', '2101-01-01', '2026-1-5', '2026-11-15T00']) {
      expect(dateOf(text)).toBeNull();
    }
    for (const text of ['1900-01-01', '2024-02-29', '2026-11-15', '2100-12-31']) expect(dateOf(text)).toBe(text);
    // The rest of such a link is still read.
    expect(parseLabLink('?lab=grb&date=2026-02-30&at=jupiter')?.anchorId).toBe('jupiter');
  });
});

describe('Galaxies and worlds catalogs', () => {
  it('lists 7 galaxies with valid J2000 coordinates', () => {
    expect(GALAXIES).toHaveLength(7);
    for (const g of GALAXIES) {
      expect(g.raDeg).toBeGreaterThanOrEqual(0);
      expect(g.raDeg).toBeLessThan(360);
      expect(g.decDeg).toBeGreaterThanOrEqual(-90);
      expect(g.decDeg).toBeLessThanOrEqual(90);
      expect(g.distanceMly).toBeGreaterThan(0);
    }
  });

  it('defines realistic gravities for solid worlds and 0g for gas giants / orbit', () => {
    expect(WORLDS.moon.gravityMs2).toBeCloseTo(1.62, 2);
    expect(WORLDS.mars.gravityMs2).toBeCloseTo(3.72, 2);
    expect(WORLDS.earth.gravityMs2).toBeCloseTo(9.81, 2);
    expect(WORLDS.jupiter.zeroG).toBe(true);
    expect(WORLDS.saturn.zeroG).toBe(true);
  });
});
