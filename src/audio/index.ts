/**
 * Sound, all of it made in the Web Audio API (there are no recordings): the score (see `soundscape.ts`),
 * what the suit lets through on the ground, short cues for the interface, and Web Speech narration.
 * On an airless world only what the suit conducts is heard: the air it moves, breathing, muffled boot
 * thumps and the radio's tones. The score is not part of that world.
 */
import type { AudioCue, AudioScene, IAudio, Lang } from '../core/types';
import { LOCALE } from '../core/l10n';
import { createSoundscape, type Soundscape } from './soundscape';

/** The score is scheduled this far ahead of the clock, and topped up this often. */
const LOOKAHEAD_SEC = 6;
const PUMP_MS = 1000;
/** Share of a chime that goes to the score's room. */
const CHIME_ROOM = 0.35;
/** How loud the cues are against the levels written at each of them: they sit under the score, not over it. */
const CUE_LEVEL = 0.65;

export function createAudio(): IAudio {
  let ctx: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  let score: Soundscape | null = null;
  let surfaceGain: GainNode | null = null;

  let currentScene: AudioScene = 'silent';
  let masterVolume = 0.7;
  let muted = false;
  let exertion = 0;
  let narrationEnabled = false;
  let breathTimer: number | null = null;

  function applyMaster(): void {
    if (!ctx || !masterGain) return;
    const target = muted ? 0 : Math.max(0, Math.min(1, masterVolume));
    masterGain.gain.setTargetAtTime(target, ctx.currentTime, 0.04);
  }

  /** Two seconds of soft noise with most of its energy in the bass: the raw material of air and breath. */
  function buildNoise(context: AudioContext): AudioBuffer {
    const length = context.sampleRate * 2;
    const buf = context.createBuffer(1, length, context.sampleRate);
    const data = buf.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.997 * b0 + white * 0.029;
      b1 = 0.985 * b1 + white * 0.032;
      b2 = 0.950 * b2 + white * 0.048;
      data[i] = (b0 + b1 + b2 + white * 0.04) * 0.35;
    }
    return buf;
  }

  /** The suit on the ground: the air its fans move, as a low rush without a pitch. */
  function setupSuit(context: AudioContext, dest: AudioNode, noise: AudioBuffer): void {
    surfaceGain = context.createGain();
    surfaceGain.gain.value = 0;
    surfaceGain.connect(dest);
    const air = context.createBufferSource();
    air.buffer = noise;
    air.loop = true;
    const airFilter = context.createBiquadFilter();
    airFilter.type = 'lowpass';
    airFilter.frequency.value = 300;
    airFilter.Q.value = 0.3;
    const airGain = context.createGain();
    airGain.gain.value = 0.035;
    air.connect(airFilter);
    airFilter.connect(airGain);
    airGain.connect(surfaceGain);
    air.start();
  }

  /** One half of a breath: noise through a wide band, swelling to `peak` and dying away. */
  function breathHalf(at: number, centreHz: number, riseSec: number, fallSec: number, peak: number): void {
    if (!ctx || !surfaceGain || !noiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = centreHz;
    band.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + riseSec);
    g.gain.exponentialRampToValueAtTime(0.0001, at + riseSec + fallSec);
    src.connect(band);
    band.connect(g);
    g.connect(surfaceGain);
    src.start(at, Math.random());
    src.stop(at + riseSec + fallSec + 0.05);
  }

  /** A breath in, then out; faster and louder with exertion. */
  function triggerBreath(): void {
    if (!ctx || currentScene !== 'surface' || muted) return;
    const now = ctx.currentTime;
    const peak = 0.008 + exertion * 0.014;
    const inSec = 1.0 - exertion * 0.3;
    breathHalf(now, 1100, inSec * 0.7, inSec * 0.3, peak);
    breathHalf(now + inSec + 0.2, 520, 0.25, 1.3 - exertion * 0.4, peak * 0.8);
  }

  function scheduleBreathing(): void {
    if (breathTimer !== null) window.clearTimeout(breathTimer);
    const loop = (): void => {
      triggerBreath();
      const intervalMs = 4200 - exertion * 1700;
      breathTimer = window.setTimeout(loop, Math.max(2000, intervalMs));
    };
    breathTimer = window.setTimeout(loop, 2400);
  }

  /** Keeps the score scheduled ahead of the clock. */
  function pump(): void {
    if (ctx && score && ctx.state === 'running') score.schedule(ctx.currentTime + LOOKAHEAD_SEC);
  }

  function syncScene(): void {
    if (!ctx || !surfaceGain || !score) return;
    surfaceGain.gain.setTargetAtTime(currentScene === 'surface' ? 1 : 0, ctx.currentTime, 0.45);
    score.setScene(currentScene);
    pump();
  }

  /** A soft struck note: a sine with a quieter octave over it, dying away over `decaySec`, partly in the score's room. */
  function chime(freq: number, peak: number, decaySec: number, delaySec = 0): void {
    if (!ctx || !masterGain || muted) return;
    const t0 = ctx.currentTime + delaySec;
    const out = ctx.createGain();
    out.connect(masterGain);
    if (score) {
      const send = ctx.createGain();
      send.gain.value = CHIME_ROOM;
      out.connect(send);
      send.connect(score.room);
    }
    for (const [multiple, share, life] of [[1, 1, 1], [2, 0.18, 0.6]]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq * multiple;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(peak * share, t0 + 0.006);
      g.gain.exponentialRampToValueAtTime(0.00001, t0 + decaySec * life);
      osc.connect(g);
      g.connect(out);
      osc.start(t0);
      osc.stop(t0 + decaySec * life + 0.05);
    }
  }

  /** A soft tap: a short note whose pitch drops as it dies, like a finger on wood. */
  function tap(peak: number): void {
    if (!ctx || !masterGain || muted) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(820, t0);
    osc.frequency.exponentialRampToValueAtTime(420, t0 + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.00001, t0 + 0.07);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.09);
  }

  /** A plain tone of fixed length: the radio's Quindar tones, and the low swell under a supernova. */
  function tone(freq: number, durSec: number, peak: number, attackSec = 0.012, delaySec = 0): void {
    if (!ctx || !masterGain || muted) return;
    const t0 = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attackSec);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + durSec + 0.02);
  }

  /** A rush of noise whose pitch slides from `fromHz` to `toHz`. */
  function whoosh(fromHz: number, toHz: number, durSec: number, peak: number, delaySec = 0): void {
    if (!ctx || !masterGain || !noiseBuffer || muted) return;
    const t0 = ctx.currentTime + delaySec;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.4;
    band.frequency.setValueAtTime(fromHz, t0);
    band.frequency.exponentialRampToValueAtTime(toHz, t0 + durSec);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + durSec * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec);
    src.connect(band);
    band.connect(g);
    g.connect(masterGain);
    if (score) g.connect(score.room);
    src.start(t0, Math.random());
    src.stop(t0 + durSec + 0.05);
  }

  return {
    unlock(): void {
      if (typeof window === 'undefined') return;
      if (!ctx) {
        if (!window.AudioContext) return;
        ctx = new window.AudioContext();
        masterGain = ctx.createGain();
        masterGain.gain.value = muted ? 0 : masterVolume;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -16;
        comp.ratio.value = 4;
        masterGain.connect(comp);
        comp.connect(ctx.destination);
        noiseBuffer = buildNoise(ctx);
        setupSuit(ctx, masterGain, noiseBuffer);
        score = createSoundscape(ctx, masterGain, Date.now());
        syncScene();
        window.setInterval(pump, PUMP_MS);
        scheduleBreathing();
      }
      if (ctx.state === 'suspended') {
        ctx.resume().then(pump).catch(() => undefined);
      }
    },

    setScene(scene: AudioScene): void {
      currentScene = scene;
      syncScene();
    },

    setMasterVolume(v: number): void {
      masterVolume = Math.max(0, Math.min(1, v));
      applyMaster();
    },

    setMuted(m: boolean): void {
      muted = m;
      applyMaster();
    },

    cue(c: AudioCue, intensity = 1): void {
      if (!ctx || !masterGain || muted) return;
      const k = CUE_LEVEL * Math.max(0.2, Math.min(1.5, intensity));
      switch (c) {
        case 'ui-click':
          tap(0.05 * k);
          break;
        case 'ui-open':
          chime(659.25, 0.03 * k, 0.5);
          chime(987.77, 0.03 * k, 0.7, 0.07);
          break;
        case 'ui-close':
          chime(987.77, 0.026 * k, 0.4);
          chime(659.25, 0.026 * k, 0.6, 0.07);
          break;
        case 'beep':
          chime(1046.5, 0.035 * k, 0.35);
          break;
        case 'radio-on':
          // Apollo's Quindar intro tone: 2525 Hz for a quarter of a second.
          tone(2525, 0.25, 0.035 * k);
          break;
        case 'radio-off':
          // And its outro tone: 2475 Hz.
          tone(2475, 0.25, 0.035 * k);
          break;
        case 'confirm':
          chime(523.25, 0.04 * k, 0.6);
          chime(659.25, 0.04 * k, 0.6, 0.08);
          chime(783.99, 0.04 * k, 0.7, 0.16);
          chime(1046.5, 0.045 * k, 1.2, 0.24);
          break;
        case 'complete':
          chime(587.33, 0.045 * k, 1.6);
          chime(739.99, 0.045 * k, 1.8, 0.11);
          chime(880, 0.045 * k, 2.0, 0.22);
          chime(1174.66, 0.05 * k, 2.4, 0.34);
          break;
        case 'supernova':
          // A vacuum carries no sound: this is a signal for the eye's event, a low swell under rising air.
          tone(55, 3.2, 0.12 * k, 0.5);
          whoosh(200, 1800, 1.6, 0.05 * k);
          chime(880, 0.03 * k, 3.0, 0.3);
          chime(1318.51, 0.026 * k, 3.0, 0.45);
          chime(1975.53, 0.02 * k, 2.6, 0.6);
          break;
        case 'teleport':
          whoosh(300, 2400, 0.55, 0.05 * k);
          chime(440, 0.03 * k, 0.9, 0.05);
          chime(659.25, 0.03 * k, 0.9, 0.12);
          chime(987.77, 0.03 * k, 1.1, 0.19);
          break;
        case 'shutter':
          whoosh(2600, 1800, 0.035, 0.07 * k);
          whoosh(1800, 1400, 0.05, 0.06 * k, 0.05);
          break;
        case 'warn':
          chime(392, 0.05 * k, 0.5);
          chime(329.63, 0.05 * k, 0.6, 0.18);
          break;
      }
    },

    step(intensity: number): void {
      if (!ctx || !masterGain || muted) return;
      const now = ctx.currentTime;
      const k = Math.max(0.15, Math.min(1, intensity));
      // Muffled bone-conducted boot thump
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const f0 = 78 + (Math.random() - 0.5) * 14;
      osc.frequency.setValueAtTime(f0, now);
      osc.frequency.exponentialRampToValueAtTime(34, now + 0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.07 * k, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
      osc.connect(g);
      g.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.11);
    },

    land(impactSpeedMs: number): void {
      if (!ctx || !masterGain || muted) return;
      const now = ctx.currentTime;
      const k = Math.max(0.25, Math.min(1.4, impactSpeedMs / 2.2));
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(92, now);
      osc.frequency.exponentialRampToValueAtTime(28, now + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.12 * k, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
      osc.connect(g);
      g.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.22);
    },

    setExertion(x: number): void {
      exertion = Math.max(0, Math.min(1, x));
    },

    narrate(text: string, lang: Lang): void {
      if (!narrationEnabled || muted || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = LOCALE[lang];
        utter.rate = 0.98;
        const voices = window.speechSynthesis.getVoices();
        const match = voices.find((v) => v.lang.toLowerCase().startsWith(lang));
        if (match) utter.voice = match;
        window.speechSynthesis.speak(utter);
      } catch { /* ignore speech synthesis errors */ }
    },

    stopNarration(): void {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
      }
    },

    setNarrationEnabled(on: boolean): void {
      narrationEnabled = on;
      if (!on) this.stopNarration();
    },
  };
}
