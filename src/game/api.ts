/**
 * UI → engine command channel. UI code imports `game` and calls methods; the engine registers the
 * implementation at boot. Calls made before registration throw, which only happens on programmer error.
 */
import type { GameAPI } from '../core/types';

let impl: GameAPI | null = null;

export function registerGame(api: GameAPI): void {
  impl = api;
}

export const game: GameAPI = new Proxy({} as GameAPI, {
  get(_target, prop: string) {
    if (!impl) throw new Error(`Game engine not ready (called game.${prop})`);
    const value = (impl as unknown as Record<string, unknown>)[prop];
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(impl) : value;
  },
});
