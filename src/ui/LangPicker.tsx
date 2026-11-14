/** Language menu: each language under its own name. A translated language is fetched before it is switched to. */
import type { Lang } from '../core/types';
import { LANGS, isLang, loadDict, tx, useLang } from '../core/i18n';
import { game } from '../game/api';

/**
 * The latest choice made in any of the menus (there are several on screen): a dictionary that arrives for
 * an earlier choice must not switch the language back.
 */
let chosen: Lang | null = null;

export function LangPicker() {
  const lang = useLang();
  return (
    <select
      className="mn-lang"
      value={lang}
      aria-label={tx(lang, 'Dil', 'Language')}
      title={tx(lang, 'Dil', 'Language')}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const next = e.target.value;
        if (!isLang(next)) return;
        chosen = next;
        loadDict(next).then(() => {
          if (chosen === next) game.updateSettings({ lang: next });
        });
      }}
    >
      {LANGS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
    </select>
  );
}
