/**
 * Per-frame values that change too fast for React state. The engine mutates this object every
 * frame; HUD components read it inside their own requestAnimationFrame loop and write to the DOM
 * through refs (compass strip, target brackets, speedometer).
 */
export interface FrameProjection {
  /** Sky target id or artifact asset id. */
  id: string;
  kind: 'sky' | 'artifact';
  /** Normalized viewport coordinates, (0,0) = top-left, (1,1) = bottom-right. Valid when inFront is true. */
  x: number;
  y: number;
  /** In front of the camera (not necessarily inside the viewport). */
  inFront: boolean;
  /** Not hidden by terrain. */
  visible: boolean;
  /** Angular distance from the view centre, degrees. */
  offAxisDeg: number;
  /** Distance in metres for artifacts, 0 for sky targets. */
  distanceM: number;
}

export interface FrameState {
  /** Seconds since the engine started. */
  time: number;
  headingDeg: number;
  pitchDeg: number;
  fovDeg: number;
  speedMs: number;
  /** Height of the feet above the ground, metres (0 when standing). */
  heightAboveGroundM: number;
  /** 0..1 how much the glove covers the Sun. */
  shade: number;
  /** 0..1 eye dark adaptation. */
  adaptation: number;
  /** Simulated seconds per real second. */
  rate: number;
  jdTT: number;
  /** 0..1 progress through the current staging step. */
  stageProgress: number;
  /** 0..1 strength of the black dip used for cuts between staged moments. */
  stageFade: number;
  projections: FrameProjection[];
  /** Bright star names projected when sky guide [C] is active. */
  starLabels: Array<{ id: string; name: string; x: number; y: number }>;
  /**
   * Screen boxes (CSS pixels) of the name labels the HUD has drawn next to sky targets and hardware. Written
   * by the HUD, read by the engine: a click inside one counts as a click on that object.
   */
  labelBoxes: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }>;
  /**
   * Galaxy close-up: CSS pixels on the screen to one degree of sky at the galaxy, written by that view while a
   * picture is on show (0 while one is loading). The HUD draws its scale bar from it.
   */
  closeUpPxPerDeg: number;
}

export const frame: FrameState = {
  time: 0,
  headingDeg: 0,
  pitchDeg: 0,
  fovDeg: 60,
  speedMs: 0,
  heightAboveGroundM: 0,
  shade: 0,
  adaptation: 0,
  rate: 1,
  jdTT: 2451545.0,
  stageProgress: 0,
  stageFade: 0,
  projections: [],
  starLabels: [],
  labelBoxes: [],
  closeUpPxPerDeg: 0,
};
