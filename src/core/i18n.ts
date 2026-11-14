/** React side of localization; the texts themselves live in ./l10n (usable without React). */
import { useSyncExternalStore } from 'react';
import type { Lang } from './types';
import { dictRevision, onDictChange } from './l10n';
import { useGame } from './store';

export * from './l10n';

/** React hook: current language. Re-renders when a dictionary finishes loading. */
export function useLang(): Lang {
  useSyncExternalStore(onDictChange, dictRevision);
  return useGame((s) => s.settings.lang);
}
