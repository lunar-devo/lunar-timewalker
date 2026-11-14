/**
 * Resolution governor. A late frame is felt more than a softer picture: when frames keep coming late, the
 * scene is drawn with fewer pixels, a step at a time. A step that does not make frames come sooner is taken
 * back at once: the delay is then not in the pixels (a browser saving power, a slow display, a busy
 * processor). When the rate has held for a while, a step back up is tried and, if that proves too much,
 * taken back and not tried again until the scene changes. The quality profile's own resolution is never
 * exceeded.
 */

/** Each step changes the pixel ratio by this factor: four steps halve it. */
const STEP = 2 ** 0.25;
/**
 * Frames per second under which frames count as late, and from which the rate counts as held: either side of
 * what a 60 Hz display shows when one frame in twenty misses its turn.
 */
const LATE_FPS = 56;
const STEADY_FPS = 58;
/** Seconds of late frames before a step down, and of a held rate before a step up is tried. */
const LATE_SEC = 1.5;
const STEADY_SEC = 12;
/** Seconds after a step up within which late frames are blamed on it. */
const BLAME_SEC = 10;
/** Seconds at the start of a scene, spent loading it, that say nothing about how fast it draws. */
const SETTLE_SEC = 4;
/** Seconds a step down is given to show its worth, and the least it has to raise the frame rate by. */
const TRIAL_SEC = 2.5;
const WORTH = 1.08;
/** A frame rate this close to one at which fewer pixels did not help is not worth another try. */
const SAME_RATE = 0.15;

export interface ResolutionGovernor {
  /** Share of the quality profile's pixel ratio to draw at, up to 1. */
  readonly scale: number;
  /**
   * Takes one frame into account: its length in seconds and the smoothed frame rate. `scene` names what is
   * on show (a change of it lifts the limit a failed step up has set); `floor` is the lowest scale allowed.
   * Returns true when the scale has changed.
   */
  frame(dt: number, fps: number, scene: string, floor: number): boolean;
  /** Back to the profile's full resolution (the profile has changed). */
  reset(): void;
}

export function createResolutionGovernor(): ResolutionGovernor {
  let scale = 1;
  /** Steps up stop here: the scale a step up from which was last found too much for the scene on show. */
  let ceiling = 1;
  let lateSec = 0;
  let steadySec = 0;
  let sinceStepUpSec = BLAME_SEC;
  let sceneSec = 0;
  let sceneNow = '';
  /** A step down on trial: the frame rate it has to better, and the seconds it has had. */
  let trialFps = 0;
  let trialSec = -1;
  /** The frame rate at which fewer pixels were last found not to help; 0 while none has been. */
  let futileFps = 0;

  return {
    get scale(): number {
      return scale;
    },

    frame(dt: number, fps: number, scene: string, floor: number): boolean {
      if (scene !== sceneNow) {
        sceneNow = scene;
        ceiling = 1;
        lateSec = 0;
        steadySec = 0;
        sceneSec = 0;
        trialSec = -1;
      }
      sceneSec += dt;
      sinceStepUpSec += dt;
      if (sceneSec < SETTLE_SEC) return false;
      if (trialSec >= 0) {
        trialSec += dt;
        if (trialSec < TRIAL_SEC) return false;
        trialSec = -1;
        if (fps < trialFps * WORTH) {
          futileFps = trialFps;
          scale = Math.min(1, scale * STEP);
          lateSec = 0;
          return true;
        }
      }
      lateSec = fps < LATE_FPS ? lateSec + dt : Math.max(0, lateSec - dt);
      steadySec = fps >= STEADY_FPS ? steadySec + dt : 0;
      const futile = futileFps > 0 && Math.abs(fps - futileFps) < futileFps * SAME_RATE;
      if (lateSec >= LATE_SEC && scale > floor && !futile) {
        // Late soon after a step up: that step was too much for this scene.
        if (sinceStepUpSec < BLAME_SEC) ceiling = scale / STEP;
        scale = Math.max(floor, scale / STEP);
        lateSec = 0;
        steadySec = 0;
        trialFps = fps;
        trialSec = 0;
        return true;
      }
      if (steadySec >= STEADY_SEC && scale < 1 && scale * STEP <= ceiling * 1.001) {
        scale = Math.min(1, scale * STEP);
        steadySec = 0;
        sinceStepUpSec = 0;
        return true;
      }
      return false;
    },

    reset(): void {
      scale = 1;
      ceiling = 1;
      lateSec = 0;
      steadySec = 0;
      trialSec = -1;
      futileFps = 0;
    },
  };
}
