import { describe, expect, it } from 'vitest';
import { FLIGHT_SPIN_SEC, flightHeightM, flightRotorTurns, flightTurnDeg } from './index';

describe('Ingenuity first flight profile', () => {
  it('stands on the ground before lift-off and after touchdown at 39.1 s', () => {
    expect(flightHeightM(-10)).toBe(0);
    expect(flightHeightM(0)).toBe(0);
    expect(flightHeightM(39.1)).toBe(0);
    expect(flightHeightM(45)).toBe(0);
    expect(flightHeightM(39.0)).toBeGreaterThan(0);
  });

  it('hovers at 3 m for 30 s and never goes higher', () => {
    let hoverSec = 0;
    let top = 0;
    for (let t = 0; t <= 39.1; t += 0.01) {
      const h = flightHeightM(t);
      top = Math.max(top, h);
      if (h === 3) hoverSec += 0.01;
    }
    expect(top).toBe(3);
    expect(hoverSec).toBeCloseTo(30, 1);
    expect(flightHeightM(5)).toBe(3);
    expect(flightHeightM(20)).toBe(3);
  });

  it('climbs and descends at about 1 m/s at most', () => {
    let peak = 0;
    for (let t = 0; t < 39.1; t += 0.01) peak = Math.max(peak, Math.abs(flightHeightM(t + 0.01) - flightHeightM(t)) / 0.01);
    expect(peak).toBeGreaterThan(0.8);
    expect(peak).toBeLessThan(1.2);
  });

  it('turns 96° while hovering and lands turned', () => {
    expect(flightTurnDeg(4.1)).toBe(0);
    expect(flightTurnDeg(34.1)).toBe(96);
    expect(flightTurnDeg(100)).toBe(96);
  });

  it('runs the rotors up before lift-off and down after touchdown', () => {
    const speed = (t: number) => (flightRotorTurns(t + 0.001) - flightRotorTurns(t - 0.001)) / 0.002;
    expect(flightRotorTurns(-FLIGHT_SPIN_SEC - 1)).toBe(0);
    expect(speed(-FLIGHT_SPIN_SEC / 2) * 60).toBeCloseTo(1250, 0);
    expect(speed(20) * 60).toBeCloseTo(2500, 0);
    expect(speed(39.1 + FLIGHT_SPIN_SEC / 2) * 60).toBeCloseTo(1250, 0);
    expect(speed(39.1 + FLIGHT_SPIN_SEC + 1)).toBe(0);
  });
});
