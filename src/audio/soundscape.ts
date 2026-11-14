/**
 * The app's score: a slow ambient piece made entirely in the Web Audio API, with no recordings. Soft pad
 * chords drift through a short progression, a few bell notes fall on top at irregular moments, and a
 * synthetic reverb puts both in a large room. Every scene has its mood (which chords, how many bells, how
 * loud and how bright); a change of scene fades what is sounding and starts the new mood.
 *
 * Space is silent: this is a score, like a film's, not something an astronaut would hear.
 */
import type { AudioScene } from '../core/types';

/** What a scene's music is made of. Notes are MIDI numbers (69 is the A of 440 Hz). */
interface Mood {
  /** The progression: each chord from its lowest note up, one note per pad voice. */
  chords: number[][];
  /** Seconds a chord is held before the next one fades in over it. */
  chordSec: number;
  /** The notes the bells choose from. */
  bells: number[];
  /** Seconds between two bells: the least and the most. */
  bellGapSec: [number, number];
  /** Loudness of the pads and of the bells, 0..1. */
  padLevel: number;
  bellLevel: number;
  /** How bright the pads are: the cutoff of their low-pass filter, Hz. */
  cutoffHz: number;
}

/** A minor, F, C and E minor with open sevenths and ninths: the mood of space, and more quietly of the ground under it. */
const OPEN_SKY: number[][] = [[45, 52, 60, 67], [41, 48, 57, 64], [48, 55, 62, 64], [40, 47, 55, 62]];

const MOODS: Record<Exclude<AudioScene, 'silent'>, Mood> = {
  // D major, warm: the menu.
  menu: {
    chords: [[38, 45, 54, 64], [47, 54, 57, 62], [43, 50, 54, 59], [45, 52, 57, 62]],
    chordSec: 14,
    bells: [74, 76, 78, 81, 83, 86, 88],
    bellGapSec: [2.5, 7],
    padLevel: 1,
    bellLevel: 1,
    cutoffHz: 820,
  },
  space: { chords: OPEN_SKY, chordSec: 18, bells: [76, 79, 81, 83, 86, 88, 91], bellGapSec: [5, 12], padLevel: 0.9, bellLevel: 0.85, cutoffHz: 700 },
  // On the ground the suit's own sounds lead; the score stays far behind them.
  surface: { chords: OPEN_SKY, chordSec: 18, bells: [76, 79, 81, 83, 86, 88], bellGapSec: [11, 24], padLevel: 0.45, bellLevel: 0.5, cutoffHz: 560 },
};

/** A pad note swells in over this long, and after its chord dies away with this time constant; its oscillators stop this long after the chord. */
const PAD_ATTACK_SEC = 3.5;
const PAD_RELEASE_TAU_SEC = 2.4;
const PAD_TAIL_SEC = 14;
/** Peak gain of one pad voice (three detuned sawtooth waves behind two low-pass filters): a quiet bed, not a lead. */
const PAD_PEAK = 0.022;
/**
 * The three oscillators of a pad voice, cents off the note: their slow, uneven beating is the pad's warmth
 * (two alone would pulse like a tremolo).
 */
const PAD_DETUNE_CENTS = [-7, 0, 5];
/** Where the four pad voices sit between the left (-1) and the right (1) speaker, lowest note first. */
const PAD_PAN = [-0.15, 0.45, -0.5, 0.25];
/** When the scene changes, what was sounding fades with this time constant, seconds. */
const SCENE_FADE_TAU_SEC = 1.1;

/** A bell: partials as [multiple of the note's frequency, share of the peak, seconds to die away]. */
const BELL_PARTIALS: Array<[number, number, number]> = [[1, 1, 4.2], [2.004, 0.2, 2.4], [3.01, 0.05, 1.3]];
const BELL_PEAK = 0.045;
/** How often a bell is answered by a second note a moment later. */
const BELL_ECHO_CHANCE = 0.3;

/** The room: seconds of reverb tail, and how fast it dies away (time constant). */
const ROOM_SEC = 4.5;
const ROOM_TAU_SEC = 0.75;

const midiHz = (note: number): number => 440 * 2 ** ((note - 69) / 12);

export interface Soundscape {
  /** The scene whose mood plays from now on; 'silent' fades the music out and schedules nothing. */
  setScene(scene: AudioScene): void;
  /** Schedules chords and bells up to `untilSec` on the context's clock; call it again before that time comes. */
  schedule(untilSec: number): void;
  /** The room's input: a one-off sound sent here gets the same reverb as the score. */
  readonly room: AudioNode;
}

/**
 * Builds the score on `context` and plays it into `destination`. `seed` fixes which bells fall when, so that
 * a piece rendered offline can be rendered again.
 */
export function createSoundscape(context: BaseAudioContext, destination: AudioNode, seed: number): Soundscape {
  // Mulberry32: a small generator, the same sequence for the same seed.
  let state = seed >>> 0;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let r = Math.imul(state ^ (state >>> 15), 1 | state);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  const between = (low: number, high: number): number => low + (high - low) * random();

  // The room is decaying noise that loses its treble as it dies away: a large, dark hall.
  const roomLength = Math.floor(context.sampleRate * ROOM_SEC);
  const impulse = context.createBuffer(2, roomLength, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    let smooth = 0;
    for (let i = 0; i < roomLength; i++) {
      const t = i / context.sampleRate;
      smooth += (0.55 * Math.exp(-t / 1.2) + 0.06) * (random() * 2 - 1 - smooth);
      data[i] = smooth * Math.exp(-t / ROOM_TAU_SEC);
    }
  }
  const convolver = context.createConvolver();
  convolver.buffer = impulse;
  const wet = context.createGain();
  wet.gain.value = 0.5;
  convolver.connect(wet);
  wet.connect(destination);
  const room = context.createGain();
  room.connect(convolver);

  // Pads are heard mostly direct, bells mostly through the room.
  const padBus = context.createGain();
  padBus.gain.value = 0;
  padBus.connect(destination);
  const padSend = context.createGain();
  padSend.gain.value = 0.5;
  padBus.connect(padSend);
  padSend.connect(room);
  const bellBus = context.createGain();
  bellBus.gain.value = 0;
  const bellDry = context.createGain();
  bellDry.gain.value = 0.5;
  bellBus.connect(bellDry);
  bellDry.connect(destination);
  bellBus.connect(room);

  // One slow wave opens and closes every pad's filter a little: the chords breathe.
  const sway = context.createOscillator();
  sway.frequency.value = 0.06;
  const swayDepth = context.createGain();
  swayDepth.gain.value = 110;
  sway.connect(swayDepth);
  sway.start();

  let mood: Mood | null = null;
  let chordAt = 0;
  let chordIndex = 0;
  let bellAt = 0;
  let lastBell = -1;
  /** Pad voices that may still be sounding, to fade them when the scene changes. */
  let voices: Array<{ gain: AudioParam; endAt: number }> = [];

  function playPad(note: number, slot: number, at: number, of: Mood): void {
    // Two low-pass stages in a row take the buzz off the sawtooth waves and leave a soft, dark tone. The
    // lowest voice is kept darker still: it carries the chord without droning over it.
    const stages = [context.createBiquadFilter(), context.createBiquadFilter()];
    for (const stage of stages) {
      stage.type = 'lowpass';
      stage.frequency.value = of.cutoffHz * (slot === 0 ? 0.6 : 1);
      stage.Q.value = 0.5;
      swayDepth.connect(stage.frequency);
    }
    stages[0].connect(stages[1]);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(PAD_PEAK, at + PAD_ATTACK_SEC);
    envelope.gain.setTargetAtTime(0, at + of.chordSec, PAD_RELEASE_TAU_SEC);
    const pan = context.createStereoPanner();
    pan.pan.value = PAD_PAN[slot % PAD_PAN.length];
    const endAt = at + of.chordSec + PAD_TAIL_SEC;
    let last: OscillatorNode | null = null;
    for (const cents of PAD_DETUNE_CENTS) {
      const osc = context.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiHz(note) * 2 ** (cents / 1200);
      osc.connect(stages[0]);
      osc.start(at);
      osc.stop(endAt);
      last = osc;
    }
    // A voice that has ended leaves the graph: the sway would otherwise keep its filters running for good.
    last?.addEventListener('ended', () => {
      for (const stage of stages) swayDepth.disconnect(stage.frequency);
      pan.disconnect();
    });
    stages[1].connect(envelope);
    envelope.connect(pan);
    pan.connect(padBus);
    voices.push({ gain: envelope.gain, endAt });
  }

  function playBell(note: number, at: number): void {
    const pan = context.createStereoPanner();
    pan.pan.value = between(-0.6, 0.6);
    pan.connect(bellBus);
    const peak = BELL_PEAK * between(0.55, 1);
    for (const [multiple, share, decaySec] of BELL_PARTIALS) {
      const osc = context.createOscillator();
      osc.frequency.value = midiHz(note) * multiple;
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(peak * share, at + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.00001, at + decaySec);
      osc.connect(envelope);
      envelope.connect(pan);
      osc.start(at);
      osc.stop(at + decaySec + 0.05);
    }
  }

  /** A bell note other than the last one played. */
  function nextBell(of: Mood): number {
    let index = Math.floor(random() * of.bells.length);
    if (index === lastBell) index = (index + 1) % of.bells.length;
    lastBell = index;
    return of.bells[index];
  }

  return {
    room,

    setScene(scene: AudioScene): void {
      const next = scene === 'silent' ? null : MOODS[scene];
      if (next === mood) return;
      const now = context.currentTime;
      // The old mood's chords may be in another key: they leave faster than a chord normally does.
      for (const voice of voices) {
        if (voice.endAt <= now) continue;
        if (typeof voice.gain.cancelAndHoldAtTime === 'function') {
          voice.gain.cancelAndHoldAtTime(now);
        } else {
          const held = voice.gain.value;
          voice.gain.cancelScheduledValues(now);
          voice.gain.setValueAtTime(held, now);
        }
        voice.gain.setTargetAtTime(0, now, SCENE_FADE_TAU_SEC);
      }
      voices = [];
      mood = next;
      padBus.gain.setTargetAtTime(next ? next.padLevel : 0, now, 0.6);
      bellBus.gain.setTargetAtTime(next ? next.bellLevel : 0, now, 0.6);
      chordIndex = 0;
      chordAt = now + 0.4;
      bellAt = now + between(2, 5);
    },

    schedule(untilSec: number): void {
      if (!mood) return;
      const now = context.currentTime;
      // After a long pause (a hidden tab's timers run late) the piece picks up from now, not all at once.
      if (chordAt < now) chordAt = now + 0.1;
      if (bellAt < now) bellAt = now + between(...mood.bellGapSec);
      voices = voices.filter((v) => v.endAt > now);
      while (chordAt < untilSec) {
        const chord = mood.chords[chordIndex % mood.chords.length];
        for (let slot = 0; slot < chord.length; slot++) playPad(chord[slot], slot, chordAt, mood);
        chordIndex += 1;
        chordAt += mood.chordSec;
      }
      while (bellAt < untilSec) {
        playBell(nextBell(mood), bellAt);
        if (random() < BELL_ECHO_CHANCE) playBell(nextBell(mood), bellAt + between(0.24, 0.5));
        bellAt += between(...mood.bellGapSec);
      }
    },
  };
}
