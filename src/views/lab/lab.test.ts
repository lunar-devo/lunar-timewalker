import { describe, expect, it } from 'vitest';
import type { LabBody, LabCmeStrength, LabExplosionKind, LabFate, LabImpact } from '../../core/types';
import { computeLabFates, computeLabImpact, LAB_MIN_AU, LAB_SHOCK_SEC, labFrontRadius, labRunSeconds, labSceneRadius, LY_AU } from './physics';
import { labLinkQuery, parseLabLink, type LabLink } from './link';
import { GALAXIES, WORLDS } from '../../content';

const impactOf = (kind: LabExplosionKind, distanceAU: number, cmeStrength: LabCmeStrength = 'may2024'): LabImpact => (
  computeLabImpact({ kind, angleRad: 0, distanceAU, cmeStrength })
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
    const mars: LabBody = { id: 'mars', name: { tr: 'Mars', en: 'Mars' }, kind: 'planet', angleRad: 0.4, skyAngleRad: 0.4, spotRad: 0.4, distanceAU: 1.5 };
    const [fate] = computeLabFates({ kind: 'grb', angleRad: 0.4, distanceAU: 1.5, cmeStrength: 'may2024' }, [mars], []);
    expect(fate.level).toBe('extreme');
    expect(fate.energyJ).toBeGreaterThan(0);
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
});

describe('Explosion Lab: the other bodies', () => {
  const body = (id: string, kind: LabBody['kind'], angleRad: number, distanceAU: number): LabBody => (
    { id, name: { tr: id, en: id }, kind, angleRad, skyAngleRad: angleRad, spotRad: angleRad, distanceAU }
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
  const fatesOf = (
    kind: LabExplosionKind, angleRad: number, distanceAU: number, removed: string[] = ['europa', 'titan'], cmeStrength: LabCmeStrength = 'may2024',
  ): Record<string, LabFate> => (
    Object.fromEntries(computeLabFates({ kind, angleRad, distanceAU, cmeStrength }, system, removed).map((f) => [f.id, f]))
  );

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
    const fates = fatesOf('sn2', 0, LAB_MIN_AU);
    const arrives = fates.neptune.shockAtSec ?? Infinity;
    expect(arrives).toBeGreaterThan(fates.mars.shockAtSec ?? Infinity);
    expect(arrives).toBeLessThan(LAB_SHOCK_SEC + 12);
    // Neptune's token stands a quarter turn from the explosion, which is at the Moon's ring.
    const reach = labSceneRadius(LAB_MIN_AU);
    expect(labFrontRadius(reach, arrives)).toBeCloseTo(Math.hypot(reach, labSceneRadius(30)), 6);
    // The time-lapse is taken to last until the last of it has happened.
    expect(labRunSeconds(impactOf('sn2', LAB_MIN_AU), Object.values(fates))).toBeGreaterThan(arrives);
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
