/**
 * Overlays for the two guided modes:
 *   - TutorialPanel: the current tutorial step with its key caps and progress.
 *   - SpectatorBar: chapter title card and remote (previous / pause / next / exit) for the auto tour.
 */
import { loc, tx, useLang } from '../core/i18n';
import { useGame } from '../core/store';
import { EVENTS, TUTORIAL_STEPS } from '../content';
import { game } from '../game/api';

export function TutorialPanel() {
  const lang = useLang();
  const tutorial = useGame((s) => s.tutorial);
  const phase = useGame((s) => s.phase);
  if (!tutorial || (phase !== 'surface' && phase !== 'space')) return null;

  if (tutorial.finished) {
    return (
      <div className="md-tutorial is-finished" role="status">
        <div className="md-tutorial-head">
          <span className="md-tag">{tx(lang, 'ÖĞRETİCİ · TAMAMLANDI', 'TUTORIAL · COMPLETE')}</span>
        </div>
        <h3 className="md-tutorial-title">{tx(lang, 'Hazırsınız', 'You are ready')}</h3>
        <p className="md-tutorial-text">
          {tx(lang, 'Olaylar listesinden bir gök olayı seçip izleyebilir ya da burada dolaşmaya devam edebilirsiniz.', 'You can pick a sky event to watch from the menu, or stay here and look around.')}
        </p>
        <div className="md-row">
          <button type="button" className="mn-btn mn-btn-primary" onClick={() => game.openMenu()}>
            {tx(lang, 'Olaylara git', 'Go to events')}
          </button>
          <button type="button" className="mn-btn" onClick={() => game.stopModes()}>
            {tx(lang, 'Burada kal', 'Stay here')}
          </button>
        </div>
      </div>
    );
  }

  const step = TUTORIAL_STEPS[tutorial.index];
  const done = tutorial.progress >= 1;
  return (
    <div className={`md-tutorial ${done ? 'is-done' : ''}`} role="status">
      <div className="md-tutorial-head">
        <span className="md-tag">
          {tx(lang, 'ÖĞRETİCİ', 'TUTORIAL')} · {tutorial.index + 1}/{TUTORIAL_STEPS.length}
        </span>
        <div className="md-row">
          <button type="button" className="mn-btn md-small" onClick={() => game.skipTutorialStep()}>
            {tx(lang, 'Atla', 'Skip')}
          </button>
          <button type="button" className="mn-btn md-small" onClick={() => game.stopModes()}>
            {tx(lang, 'Çık', 'Exit')}
          </button>
        </div>
      </div>
      <div className="md-tutorial-body">
        <div className="md-keys">
          {step.keys.map((k) => {
            const label = typeof k === 'string' ? k : loc(k, lang);
            return <kbd key={label} className="md-kbd">{label}</kbd>;
          })}
        </div>
        <div>
          <h3 className="md-tutorial-title">{done ? '✓ ' : ''}{loc(step.title, lang)}</h3>
          <p className="md-tutorial-text">{loc(step.text, lang)}</p>
        </div>
      </div>
      <div className="md-progress"><div style={{ width: `${Math.round(tutorial.progress * 100)}%` }} /></div>
    </div>
  );
}

export function SpectatorBar() {
  const lang = useLang();
  const spectator = useGame((s) => s.spectator);
  const phase = useGame((s) => s.phase);
  if (!spectator) return null;
  const ev = EVENTS[spectator.index];
  if (!ev) return null;
  const loading = phase === 'loading' || phase === 'map';

  return (
    <div className="md-spectator" role="region" aria-label={tx(lang, 'Seyirci modu', 'Spectator mode')}>
      <div className="md-spectator-card" style={{ borderLeftColor: ev.accent }}>
        <span className="md-tag">
          {tx(lang, 'SEYİRCİ MODU', 'SPECTATOR MODE')} · {spectator.index + 1}/{EVENTS.length}
          {spectator.paused ? (tx(lang, ' · DURAKLATILDI', ' · PAUSED')) : ''}
        </span>
        <div className="md-spectator-date" style={{ color: ev.accent }}>{loc(ev.dateLabel, lang)}</div>
        <h2 className="md-spectator-title">{loc(ev.title, lang)}</h2>
        {loading && <div className="md-spectator-sub">{tx(lang, 'Yükleniyor…', 'Loading…')}</div>}
      </div>
      <div className="md-remote">
        <button type="button" className="mn-btn" title="←" onClick={() => game.spectatorStep(-1)}>
          ◀ {tx(lang, 'Önceki', 'Previous')}
        </button>
        <button
          type="button"
          className="mn-btn"
          title={tx(lang, 'Boşluk', 'Space')}
          onClick={() => {
            const paused = !spectator.paused;
            useGame.setState({ spectator: { ...spectator, paused } });
            game.setPaused(paused);
          }}
        >
          {spectator.paused ? (tx(lang, '▶ Devam', '▶ Resume')) : (tx(lang, '❚❚ Duraklat', '❚❚ Pause'))}
        </button>
        <button type="button" className="mn-btn" title="→" onClick={() => game.spectatorStep(1)}>
          {tx(lang, 'Sonraki', 'Next')} ▶
        </button>
        <button type="button" className="mn-btn mn-btn-amber" title="Esc" onClick={() => game.openMenu()}>
          {tx(lang, 'Menü', 'Menu')}
        </button>
      </div>
    </div>
  );
}
