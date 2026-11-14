/**
 * Staging director: plays a chapter's "before → event → after" sequence by driving the simulation clock.
 * It only decides what time it is and which step is on; the engine applies view, telescope and HUD effects.
 */
import type { StageDef, StageMoment, StagingDef } from '../core/types';
import { jdTTFromCalendarUT, SECONDS_PER_DAY } from '../core/time';

/** Seconds of the dip to black on either side of a cut. */
const FADE_OUT_SEC = 0.35;
const FADE_IN_SEC = 0.6;

export function momentJd(m: StageMoment): number {
  return jdTTFromCalendarUT(m.date) + (m.offsetDays ?? 0);
}

function stageEndJd(s: StageDef): number {
  return s.to ? momentJd(s.to) : momentJd(s.from) + s.seconds / SECONDS_PER_DAY;
}

/** Last moment of a staging sequence: where the clock rests once it has played. */
export function stagingEndJd(staging: StagingDef): number {
  return stageEndJd(staging.stages[staging.stages.length - 1]);
}

/** Every moment a sequence visits, densely enough to test that a target stays in view throughout. */
export function stagingSampleJds(staging: StagingDef): number[] {
  const out: number[] = [];
  for (const s of staging.stages) {
    const a = momentJd(s.from);
    const b = stageEndJd(s);
    const n = b - a > 0.5 ? 8 : 1;
    for (let i = 0; i <= n; i++) out.push(a + ((b - a) * i) / n);
  }
  return out;
}

export interface DirectorFrame {
  jdTT: number;
  /** Simulated seconds per real second of the current step. */
  rate: number;
  index: number;
  stage: StageDef;
  /** True on the first frame of a step: the engine applies its cut, focus, telescope and radio line. */
  entered: boolean;
  /** 0..1 through the current step. */
  progress: number;
  /** 0..1 black overlay. */
  fade: number;
}

export interface Director {
  readonly staging: StagingDef;
  /** Advances by `dt` real seconds. Returns null once the sequence has finished. */
  step(dt: number): DirectorFrame | null;
}

/** `startIndex` starts the sequence at a later step (the Before / Event / After buttons). */
export function createDirector(staging: StagingDef, startIndex = 0): Director {
  let index = startIndex;
  let elapsed = 0;
  let entered = true;
  let fadeIn = FADE_IN_SEC;
  let fadeOut = 0;

  function step(dt: number): DirectorFrame | null {
    const stage = staging.stages[index];
    const from = momentJd(stage.from);
    const to = stageEndJd(stage);
    const next = staging.stages[index + 1];

    if (elapsed >= stage.seconds) {
      // The step has played. A cut dips to black on its last moment before the clock jumps.
      if (!next) return null;
      if (next.cut && fadeOut < FADE_OUT_SEC) {
        fadeOut += dt;
        return { jdTT: to, rate: 0, index, stage, entered: false, progress: 1, fade: Math.min(1, fadeOut / FADE_OUT_SEC) };
      }
      index++;
      elapsed = 0;
      entered = true;
      fadeOut = 0;
      fadeIn = next.cut ? FADE_IN_SEC : 0;
      return step(0);
    }

    const wasEntered = entered;
    entered = false;
    elapsed += dt;
    fadeIn = Math.max(0, fadeIn - dt);
    const progress = Math.min(1, elapsed / stage.seconds);
    return {
      jdTT: from + (to - from) * progress,
      rate: ((to - from) * SECONDS_PER_DAY) / stage.seconds,
      index,
      stage,
      entered: wasEntered,
      progress,
      fade: fadeIn / FADE_IN_SEC,
    };
  }

  return { staging, step };
}
