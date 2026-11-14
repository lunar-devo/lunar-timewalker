import { describe, expect, it } from 'vitest';
import { createResolutionGovernor, type ResolutionGovernor } from './resolution';

const FLOOR = 0.4;

/**
 * Runs `seconds` on a machine whose graphics card draws the scene at `fullFps` frames a second at full
 * resolution, and faster in proportion as there are fewer pixels, behind a display of `displayHz`.
 * Returns how many times the scale changed.
 */
function play(governor: ResolutionGovernor, seconds: number, fullFps: number, scene = 'surface', displayHz = 60): number {
  let changes = 0;
  for (let t = 0; t < seconds;) {
    const fps = Math.min(displayHz, fullFps / governor.scale ** 2);
    if (governor.frame(1 / fps, fps, scene, FLOOR)) changes++;
    t += 1 / fps;
  }
  return changes;
}

/** The same on a machine whose frames come at `fps` whatever the resolution (a throttled browser, a busy processor). */
function playHeld(governor: ResolutionGovernor, seconds: number, fps: number, scene = 'surface'): number {
  let changes = 0;
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    if (governor.frame(1 / fps, fps, scene, FLOOR)) changes++;
  }
  return changes;
}

describe('resolution governor', () => {
  it('leaves the resolution alone while frames come on time', () => {
    const governor = createResolutionGovernor();
    expect(play(governor, 120, 200)).toBe(0);
    expect(governor.scale).toBe(1);
  });

  it('does not judge a scene by the seconds it spends loading', () => {
    const governor = createResolutionGovernor();
    playHeld(governor, 3.5, 12);
    play(governor, 30, 200);
    expect(governor.scale).toBe(1);
  });

  it('lowers the resolution until frames come on time, and stays there', () => {
    const governor = createResolutionGovernor();
    // 37 frames a second at full resolution: half the pixels are needed for 60.
    play(governor, 20, 37);
    expect(governor.scale).toBeCloseTo(2 ** -0.5, 6);
    expect(37 / governor.scale ** 2).toBeGreaterThan(60);
    // One step up is tried, found too much, and not tried again in this scene.
    play(governor, 40, 37);
    expect(governor.scale).toBeCloseTo(2 ** -0.5, 6);
    expect(play(governor, 120, 37)).toBe(0);
  });

  it('never goes below the floor', () => {
    const governor = createResolutionGovernor();
    play(governor, 120, 3);
    expect(governor.scale).toBeCloseTo(FLOOR, 6);
  });

  it('gives the pixels back when fewer of them do not make frames come sooner', () => {
    const governor = createResolutionGovernor();
    // A browser that is saving power draws 30 frames a second whatever the resolution.
    playHeld(governor, 12, 30);
    expect(governor.scale).toBe(1);
    expect(playHeld(governor, 120, 30)).toBe(0);
    // Nor is it tried again in the next scene at the same rate.
    expect(playHeld(governor, 60, 30, 'space')).toBe(0);
    expect(governor.scale).toBe(1);
  });

  it('returns to full resolution in a lighter scene', () => {
    const governor = createResolutionGovernor();
    play(governor, 20, 37);
    expect(governor.scale).toBeLessThan(0.75);
    play(governor, 60, 200, 'menu');
    expect(governor.scale).toBe(1);
  });
});
