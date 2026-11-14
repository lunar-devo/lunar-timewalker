/**
 * The 2018 planet-encircling Mars dust event, reduced to a three-number model for the close-up view.
 *
 * Anchors (NASA/JPL mission reports): first seen by MRO MARCI on 30 May 2018 over Acidalia Planitia;
 * over Opportunity at Meridiani Planum within about a week (last contact 10 June, optical depth ≈ 10.8);
 * declared planet-encircling around 20 June; decaying from late July, largely clear by mid-September.
 * Between those anchors the growth is interpolated: a schematic of the storm, not a dust retrieval.
 */
import { jdTTFromCalendarUT } from '../core/time';

export interface MarsDustState {
  /** 0..1 veil strength inside the area the storm has reached. */
  opacity: number;
  /** Where the storm was first seen (Acidalia Planitia), planetocentric, east-positive. */
  originLatDeg: number;
  originLonDeg: number;
  /** Angular radius of the dust-covered region around the origin; 180 covers the planet. */
  radiusDeg: number;
}

const FIRST_SEEN = jdTTFromCalendarUT({ year: 2018, month: 5, day: 30 });
const OVER_OPPORTUNITY = jdTTFromCalendarUT({ year: 2018, month: 6, day: 8 });
const ENCIRCLING = jdTTFromCalendarUT({ year: 2018, month: 6, day: 20 });
const DECAY_START = jdTTFromCalendarUT({ year: 2018, month: 7, day: 25 });
const CLEAR = jdTTFromCalendarUT({ year: 2018, month: 9, day: 20 });

function ramp(a: number, b: number, x: number): number {
  return Math.min(1, Math.max(0, (x - a) / (b - a)));
}

export function marsDustState(jdTT: number): MarsDustState {
  const base = { originLatDeg: 45, originLonDeg: -35 };
  if (jdTT <= FIRST_SEEN || jdTT >= CLEAR) return { ...base, opacity: 0, radiusDeg: 0 };
  // Opportunity (2° S, 5.5° W) lies about 55° of arc from the origin.
  const radiusDeg = jdTT < OVER_OPPORTUNITY
    ? 6 + 54 * ramp(FIRST_SEEN, OVER_OPPORTUNITY, jdTT)
    : 60 + 120 * ramp(OVER_OPPORTUNITY, ENCIRCLING, jdTT);
  const opacity = jdTT < DECAY_START
    ? 0.35 + 0.57 * ramp(FIRST_SEEN, ENCIRCLING, jdTT)
    : 0.92 * (1 - ramp(DECAY_START, CLEAR, jdTT));
  return { ...base, opacity, radiusDeg };
}
