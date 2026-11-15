/**
 * Explosion Lab panels: on the left, what explodes and where (how far from Earth, beside which body of the
 * map, on which date), the link to the scenario and the class mode; at the bottom, the time-lapse's
 * transport and the framings; on the right, the bodies the explosion reaches (any of which can be put in
 * focus, taken off the map and put back, or compared in a table), the running list of what becomes of every
 * body of the map in the order the explosion reaches them and, for what is in focus, what reaches it, what
 * that does there, the sequence of consequences ticking off as the time-lapse plays, and where those
 * results come from. In the class mode the left panel is the quiz, and the right panel stays empty until the
 * model's answer is out.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  L10n, LabCmeStrength, LabExplosionKind, LabFate, LabFraming, LabImpact, LabImpactLevel, LabQuiz, LabState,
  Lang, WorldId,
} from '../../core/types';
import { fmt, lf, loc, tpl, tx, useLang } from '../../core/i18n';
import { useGame } from '../../core/store';
import { calendarUTFromJdTT, formatDate, jdTTFromCalendarUT, jdTTNow } from '../../core/time';
import { BODY_NAMES, WORLDS } from '../../content';
import { game } from '../../game/api';
import { distanceText, LAB_BREAKUP_AT, LAB_MAX_AU, LAB_MIN_AU, LY_AU } from '../../views/lab';
import { useDialog } from '../useDialog';

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

const KINDS: Array<{ id: LabExplosionKind; name: L10n; what: L10n }> = [
  {
    id: 'sn2',
    name: { tr: 'Tip II süpernova', en: 'Type II supernova' },
    what: { tr: 'Dev bir yıldızın çekirdeği çöker', en: 'The core of a giant star collapses' },
  },
  {
    id: 'sn1a',
    name: { tr: 'Tip Ia süpernova', en: 'Type Ia supernova' },
    what: { tr: 'Bir beyaz cüce tümüyle patlar', en: 'A white dwarf explodes completely' },
  },
  {
    id: 'grb',
    name: { tr: 'Gama ışını patlaması', en: 'Gamma-ray burst' },
    what: { tr: 'Dev bir yıldız kara deliğe çöker; iki dar hüzme', en: 'A massive star collapses to a black hole; two narrow beams' },
  },
  {
    id: 'cme',
    name: { tr: 'Güneş patlaması (CME)', en: 'Solar eruption (CME)' },
    what: { tr: 'Güneş’ten fırlayan plazma bulutu', en: 'A cloud of plasma thrown off by the Sun' },
  },
];

/** How strong a solar eruption can be made. */
const STRENGTHS: Array<{ id: LabCmeStrength; label: L10n }> = [
  { id: 'ordinary', label: { tr: 'Sıradan', en: 'Ordinary' } },
  { id: 'may2024', label: { tr: 'Mayıs 2024', en: 'May 2024' } },
  { id: 'carrington', label: { tr: 'Carrington (1859)', en: 'Carrington (1859)' } },
];

const tenths = (value: number): L10n => lf(tpl`${(l: Lang) => fmt(value, 1, l)} AU`, tpl`${(l: Lang) => fmt(value, 1, l)} AU`);

/**
 * A ready place for the explosion: a distance, for a body of the map also its direction, and the body the
 * place is taken from (null: a distance that no body marks).
 */
interface Place {
  key: string;
  label: L10n;
  au: number;
  angleRad?: number;
  anchorId: string | null;
}

/** Light years of the hazard limit offered as a place: for a supernova, and for a gamma-ray burst. */
const SUPERNOVA_HAZARD_LY = 26;
const BURST_HAZARD_LY = 6500;

/** Hypothetical places for the Sun in a solar eruption, closer than it really is. */
const NEAR_SUN: Place[] = [
  { key: 'moon', label: { tr: 'Ay uzaklığı', en: 'Moon’s distance' }, au: LAB_MIN_AU, anchorId: null },
  { key: '0.1', label: tenths(0.1), au: 0.1, anchorId: null },
  { key: '0.5', label: tenths(0.5), au: 0.5, anchorId: null },
];

/** The days the map can be set to, as the date field writes them, and the same as moments (noon UT). */
const MAP_DATE_MIN = '1900-01-01';
const MAP_DATE_MAX = '2100-12-31';
const MAP_JD_MIN = jdTTFromCalendarUT({ year: 1900, month: 1, day: 1, hour: 12 });
const MAP_JD_MAX = jdTTFromCalendarUT({ year: 2100, month: 12, day: 31, hour: 12 });

const LEVEL: Record<LabImpactLevel, { label: L10n; cls: string }> = {
  safe: { label: { tr: 'ZARARSIZ', en: 'HARMLESS' }, cls: 'ok' },
  caution: { label: { tr: 'DİKKAT', en: 'CAUTION' }, cls: 'warn' },
  danger: { label: { tr: 'TEHLİKELİ', en: 'DANGEROUS' }, cls: 'warn' },
  extreme: { label: { tr: 'YIKICI', en: 'DEVASTATING' }, cls: 'bad' },
};

/** The levels from the mildest to the worst: the order of the answers in the class mode. */
const LEVEL_ORDER: LabImpactLevel[] = ['safe', 'caution', 'danger', 'extreme'];

const VIEWS: Array<{ id: LabFraming; label: L10n }> = [
  { id: 'orbit', label: { tr: 'Tüm yörünge', en: 'Whole orbit' } },
  { id: 'map', label: { tr: 'Tüm harita', en: 'Whole map' } },
  { id: 'close', label: { tr: 'Seçili cisme yakın', en: 'Close to the chosen body' } },
];

/** The spacecraft near Earth, as one entry among the bodies. */
const SATELLITES_NAME: L10n = { tr: 'Uydular', en: 'Satellites' };

/** What the running list says of a body the explosion does nothing to. */
const NOT_AFFECTED: L10n = { tr: 'etkilenmez', en: 'not affected' };

/** Worlds whose ground the lab's supernova can be watched from; from the Moon for any other body in focus. */
const WATCH_WORLDS: WorldId[] = ['moon', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];

/** 8.5×10⁸ for very large and very small numbers, plain digits otherwise. */
function scientific(x: number, lang: Lang): string {
  if (x === 0) return '0';
  if (x >= 0.01 && x < 10_000) return fmt(x, x < 10 ? 2 : 0, lang);
  // A mantissa that rounds up to 10.0 belongs to the next power of ten: 9.96×10¹³ reads 1.0×10¹⁴.
  const floor = Math.floor(Math.log10(x));
  const exp = x / 10 ** floor >= 9.95 ? floor + 1 : floor;
  const digits = String(Math.abs(exp)).split('').map((d) => SUPERSCRIPT[Number(d)]).join('');
  return `${fmt(x / 10 ** exp, 1, lang)}×10${exp < 0 ? '⁻' : ''}${digits}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="hud-telem-row hud-lab-row">
      <span>{label}</span>
      <span className="hud-telem-val">{value}</span>
    </div>
  );
}

function Meters({ meters }: { meters: Array<{ label: string; value: number }> }) {
  return (
    <div className="hud-lab-meters">
      {meters.map((m) => (
        <div key={m.label} className="hud-lab-meter">
          <span>{m.label}</span>
          <div className="hud-lab-bar"><div style={{ width: `${Math.round(m.value * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

/** What reaches Earth and what it does there. */
function EarthResult({ impact, kind, lang }: { impact: LabImpact; kind: LabExplosionKind; lang: Lang }) {
  if (kind === 'cme') {
    return (
      <div className="hud-lab-rows">
        <Row label={tx(lang, 'Parlamanın ışığı', 'Light of the flare')} value={loc(impact.lightTimeText, lang)} />
        <Row label={tx(lang, 'Plazma bulutu', 'Plasma cloud')} value={loc(impact.shockTimeText, lang)} />
        <Row label={tx(lang, 'Güneş rüzgârı basıncı', 'Solar wind pressure')} value={`${scientific(impact.pressureNPa, lang)} nPa`} />
        <Row label={tx(lang, 'Manyetosferin sınırı', 'Edge of the magnetosphere')} value={tx(lang, tpl`${fmt(impact.standoffRe, 1, lang)} Dünya yarıçapı`, tpl`${fmt(impact.standoffRe, 1, lang)} Earth radii`)} />
        <Row label={tx(lang, 'Kutup ışıkları', 'Auroras')} value={tx(lang, tpl`${Math.round(impact.auroraLatDeg)}° enleme kadar`, tpl`down to latitude ${Math.round(impact.auroraLatDeg)}°`)} />
      </div>
    );
  }
  return (
    <>
      {kind === 'grb' ? (
        <div className="hud-lab-rows">
          <Row label={tx(lang, 'Gama ışını akısı', 'Gamma-ray fluence')} value={`${scientific(impact.fluenceJm2, lang)} J/m²`} />
          <Row label={tx(lang, '10 saniye boyunca Güneş’e göre', 'Against the Sun, for 10 seconds')} value={`× ${scientific(impact.fluxSolar, lang)}`} />
          <Row label={tx(lang, 'Işınların varışı', 'Ray arrival')} value={loc(impact.shockTimeText, lang)} />
          {impact.beamWidthLabel && (
            <Row label={tx(lang, 'Hüzmenin Dünya’daki genişliği', 'Width of the beam at Earth')} value={loc(impact.beamWidthLabel, lang)} />
          )}
          <Row label={tx(lang, 'Dünya’ya çarpan enerji', 'Energy striking Earth')} value={`${scientific(impact.energyJ, lang)} J`} />
        </div>
      ) : (
        <div className="hud-lab-rows">
          <Row label={tx(lang, 'Gökteki parlaklığı', 'Brightness in the sky')} value={tx(lang, tpl`${fmt(impact.apparentMag, 1, lang)} kadir`, tpl`magnitude ${fmt(impact.apparentMag, 1, lang)}`)} />
          <Row label={tx(lang, 'Güneş’e göre', 'Compared with the Sun')} value={`× ${scientific(impact.fluxSolar, lang)}`} />
          <Row label={tx(lang, 'Işığın varışı', 'Light arrival')} value={loc(impact.lightTimeText, lang)} />
          <Row label={tx(lang, 'Şok dalgasının varışı', 'Blast arrival')} value={loc(impact.shockTimeText, lang)} />
          <Row label={tx(lang, 'Yüzey sıcaklığı', 'Surface temperature')} value={`${scientific(impact.surfaceTempK, lang)} K`} />
          <Row label={tx(lang, 'Dünya’ya çarpan enerji', 'Energy striking Earth')} value={`${scientific(impact.energyJ, lang)} J`} />
        </div>
      )}
      <Meters
        meters={[
          { label: tx(lang, 'Ozon tabakasını yok eder', 'Destroys the ozone layer'), value: impact.outcome.ozone },
          { label: tx(lang, 'Atmosferi söker', 'Strips the atmosphere'), value: impact.outcome.atmosphere },
          { label: tx(lang, 'Okyanusları kaynatır', 'Boils the oceans'), value: impact.outcome.oceans },
          { label: tx(lang, 'Kabuğu eritir', 'Melts the crust'), value: impact.outcome.crust },
          { label: tx(lang, 'Gezegeni dağıtır', 'Takes the planet apart'), value: impact.outcome.breakup },
        ]}
      />
    </>
  );
}

/** What reaches the Moon, the Sun, a planet or another moon, and what it does there. */
function FateResult({ fate, kind, lang }: { fate: LabFate; kind: LabExplosionKind; lang: Lang }) {
  if (kind === 'cme') {
    return (
      <div className="hud-lab-rows">
        <Row label={tx(lang, 'Güneş’e uzaklığı', 'Distance from the Sun')} value={loc(fate.distanceLabel, lang)} />
        <Row label={tx(lang, 'Parlamanın ışığı', 'Light of the flare')} value={loc(fate.lightTimeText, lang)} />
        <Row label={tx(lang, 'Plazma bulutu', 'Plasma cloud')} value={loc(fate.shockTimeText, lang)} />
        <Row label={tx(lang, 'Güneş rüzgârı basıncı', 'Solar wind pressure')} value={`${scientific(fate.pressureNPa, lang)} nPa`} />
        {fate.standoffRadii > 0 && (
          <Row label={tx(lang, 'Manyetosferin sınırı', 'Edge of the magnetosphere')} value={tx(lang, tpl`${fmt(fate.standoffRadii, 1, lang)} gezegen yarıçapı`, tpl`${fmt(fate.standoffRadii, 1, lang)} planet radii`)} />
        )}
      </div>
    );
  }
  const star = fate.bodyClass === 'star';
  return (
    <>
      {kind === 'grb' ? (
        <div className="hud-lab-rows">
          <Row label={tx(lang, 'Patlamaya uzaklığı', 'Distance from the explosion')} value={loc(fate.distanceLabel, lang)} />
          <Row label={tx(lang, 'Gama ışını akısı', 'Gamma-ray fluence')} value={`${scientific(fate.fluenceJm2, lang)} J/m²`} />
          <Row label={tx(lang, 'Işınların varışı', 'Ray arrival')} value={loc(fate.shockTimeText, lang)} />
          <Row label={tx(lang, 'Çarpan enerji', 'Energy striking it')} value={`${scientific(fate.energyJ, lang)} J`} />
        </div>
      ) : (
        <div className="hud-lab-rows">
          <Row label={tx(lang, 'Patlamaya uzaklığı', 'Distance from the explosion')} value={loc(fate.distanceLabel, lang)} />
          {!star && <Row label={tx(lang, 'Oradaki Güneş’e göre', 'Compared with the Sun there')} value={`× ${scientific(fate.fluxLocal, lang)}`} />}
          <Row label={tx(lang, 'Işığın varışı', 'Light arrival')} value={loc(fate.lightTimeText, lang)} />
          <Row label={tx(lang, 'Şok dalgasının varışı', 'Blast arrival')} value={loc(fate.shockTimeText, lang)} />
          {!star && <Row label={tx(lang, 'Sıcaklık', 'Temperature')} value={`${scientific(fate.tempK, lang)} K`} />}
          <Row label={tx(lang, 'Çarpan enerji', 'Energy striking it')} value={`${scientific(fate.energyJ, lang)} J`} />
        </div>
      )}
      <Meters meters={fate.meters.map((m) => ({ label: loc(m.label, lang), value: m.value }))} />
    </>
  );
}

/** The day (UT) the map shows: a date field, steps of 30 days either way, and the way back to today. */
function MapDate({ jdTT, lang }: { jdTT: number; lang: Lang }) {
  const day = calendarUTFromJdTT(jdTT);
  const value = `${String(day.year).padStart(4, '0')}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
  // What is being typed, while it is not a day the map can show: a year typed digit by digit passes through
  // 0002 and 0020, which are out of range. The map keeps its date until the field holds a day in range.
  const [draft, setDraft] = useState<string | null>(null);
  const label = tx(lang, 'Haritanın tarihi (UT)', 'Date of the map (UT)');
  const back = tx(lang, '30 gün geri', 'Back 30 days');
  const on = tx(lang, '30 gün ileri', 'Forward 30 days');
  return (
    <div className="hud-lab-date">
      <span className="hud-lab-label">{label}</span>
      <div className="hud-lab-date-row">
        <button type="button" className="hud-look-chip" aria-label={back} title={back} onClick={() => game.setLabDate(Math.max(MAP_JD_MIN, jdTT - 30))}>
          ‹
        </button>
        <input
          type="date"
          min={MAP_DATE_MIN}
          max={MAP_DATE_MAX}
          value={draft ?? value}
          aria-label={label}
          onChange={(e) => {
            const [year, month, dayOfMonth] = e.target.value.split('-').map(Number);
            if (e.target.validity.valid && year && month && dayOfMonth) {
              setDraft(null);
              game.setLabDate(jdTTFromCalendarUT({ year, month, day: dayOfMonth, hour: 12 }));
            } else {
              setDraft(e.target.value);
            }
          }}
          onBlur={() => setDraft(null)}
        />
        <button type="button" className="hud-look-chip" aria-label={on} title={on} onClick={() => game.setLabDate(Math.min(MAP_JD_MAX, jdTT + 30))}>
          ›
        </button>
        <button type="button" className="hud-look-chip" onClick={() => game.setLabDate(jdTTNow())}>
          {tx(lang, 'Bugün', 'Today')}
        </button>
      </div>
    </div>
  );
}

/**
 * Copies the address that opens the lab with the scenario that is set. Where the clipboard cannot be written
 * (no permission, a page not served securely), the address is shown instead, selected, to be copied by hand.
 */
function ShareLink({ lang }: { lang: Lang }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    if (shown) fieldRef.current?.select();
  }, [shown]);
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(game.labLink());
      setShown(false);
      setCopied(true);
    } catch {
      setShown(true);
    }
  }
  return (
    <>
      <button type="button" className="mn-btn" onClick={() => { copy().catch(() => undefined); }}>
        {copied ? tx(lang, 'Kopyalandı', 'Copied') : tx(lang, 'Bağlantıyı kopyala', 'Copy link')}
      </button>
      {shown && (
        <input
          ref={fieldRef}
          type="text"
          readOnly
          className="hud-lab-link"
          value={game.labLink()}
          aria-label={tx(lang, 'Bağlantıyı kopyala', 'Copy link')}
          onFocus={(e) => e.target.select()}
        />
      )}
    </>
  );
}

/** One line of the class mode: a prediction, or the model's answer, with the dot of its level. */
function QuizLine({ level, model, lang }: { level: LabImpactLevel; model: boolean; lang: Lang }) {
  const label = loc(LEVEL[level].label, lang);
  return (
    <span className={`hud-lab-quiz-line is-${level}`}>
      <i />
      {model
        ? tx(lang, tpl`Modelin sonucu: ${label}`, tpl`The model says: ${label}`)
        : tx(lang, tpl`Tahmininiz: ${label}`, tpl`Your prediction: ${label}`)}
    </span>
  );
}

/**
 * The class mode: a question about how a body fares, the four levels to predict from, the model's answer
 * once the explosion has played, and at the end the score with every round.
 */
function QuizCard({ quiz, lang }: { quiz: LabQuiz; lang: Lang }) {
  const done = quiz.phase === 'done';
  const round = quiz.rounds.at(quiz.index);
  const right = quiz.rounds.filter((r) => r.picked === r.answer).length;
  return (
    <div className="hud-card hud-lab-card hud-lab-quiz">
      <div className="hud-card-title" style={{ marginBottom: 0 }}>
        <span>{tx(lang, 'Tahmin et', 'Predict')}</span>
        {!done && (
          <span className="hud-lab-quiz-count">
            {tx(lang, tpl`Soru ${quiz.index + 1}/${quiz.count}`, tpl`Question ${quiz.index + 1} of ${quiz.count}`)}
          </span>
        )}
      </div>

      {!done && <p className="hud-lab-quiz-question">{loc(quiz.question, lang)}</p>}

      {quiz.phase === 'ask' && (
        <div className="hud-lab-quiz-picks">
          {LEVEL_ORDER.map((level) => (
            <button key={level} type="button" className={`hud-lab-quiz-pick is-${level}`} onClick={() => game.answerLabQuiz(level)}>
              <i />
              {loc(LEVEL[level].label, lang)}
            </button>
          ))}
        </div>
      )}

      {quiz.phase === 'run' && (
        <>
          {quiz.picked && <QuizLine level={quiz.picked} model={false} lang={lang} />}
          <p className="hud-lab-hint">{tx(lang, 'Patlama izleniyor…', 'Watching the explosion…')}</p>
        </>
      )}

      {quiz.phase === 'reveal' && (
        <>
          {quiz.picked && <QuizLine level={quiz.picked} model={false} lang={lang} />}
          {round && <QuizLine level={round.answer} model lang={lang} />}
          {round && (
            <p className={`hud-lab-quiz-verdict ${round.picked === round.answer ? 'is-right' : 'is-wrong'}`}>
              {round.picked === round.answer ? tx(lang, 'Doğru tahmin', 'Correct') : tx(lang, 'Tutmadı', 'Not this time')}
            </p>
          )}
          <span className="mn-badge hud-lab-quiz-model">MODEL</span>
        </>
      )}

      {done && (
        <>
          <p className="hud-lab-quiz-score">{tx(lang, tpl`${right}/${quiz.count} doğru`, tpl`${right} of ${quiz.count} correct`)}</p>
          <ol className="hud-lab-quiz-rounds">
            {quiz.rounds.map((r, i) => (
              <li key={i} className={r.picked === r.answer ? 'is-right' : 'is-wrong'}>
                <span>{loc(r.question, lang)}</span>
                <QuizLine level={r.picked} model={false} lang={lang} />
                <QuizLine level={r.answer} model lang={lang} />
              </li>
            ))}
          </ol>
        </>
      )}

      <div className="hud-lab-actions hud-lab-quiz-actions">
        {quiz.phase === 'reveal' && (
          <button type="button" className="mn-btn mn-btn-amber" style={{ flex: 1 }} onClick={() => game.nextLabQuiz()}>
            {quiz.index + 1 < quiz.count ? tx(lang, 'Sonraki soru', 'Next question') : tx(lang, 'Sonucu göster', 'Show the score')}
          </button>
        )}
        {done && (
          <button type="button" className="mn-btn mn-btn-amber" style={{ flex: 1 }} onClick={() => game.nextLabQuiz()}>
            {tx(lang, 'Yeniden başla', 'Start again')}
          </button>
        )}
        <button type="button" className="mn-btn" onClick={() => game.stopLabQuiz()}>
          {done ? tx(lang, 'Laboratuvara dön', 'Back to the lab') : tx(lang, 'Çık', 'Leave')}
        </button>
      </div>
    </div>
  );
}

/**
 * The running list of the whole map: Earth and every other body, each with what becomes of it, in the order
 * the explosion reaches them. A body's moment is the arrival of the blast wave, plasma cloud or beam; where
 * that never comes but the light alone does something, the arrival of the light. A line lights up when the
 * time-lapse reaches its moment; bodies that nothing happens to stand last, without a moment. A click on a
 * line puts its body in focus.
 */
function RunList({ lab, lang }: { lab: LabState; lang: Lang }) {
  const started = lab.playing || lab.elapsedSec > 0;
  // Reached bodies first, in the order the fronts reach them (equal moments: Earth, then the bodies as the
  // model lists them); then those that only the light reaches and that it does nothing to.
  const lines = [{ id: 'earth', ...lab.impact }, ...lab.fates]
    .map((b) => {
      const name = loc(lab.bodies.find((body) => body.id === b.id)?.name ?? BODY_NAMES.earth, lang);
      const verdict = loc(b.verdict ?? NOT_AFFECTED, lang);
      const time = b.shockAtSec !== null ? b.shockTimeText : b.lightTimeText;
      /** Second of the time-lapse at which the line lights up; Infinity for a body that comes to no harm. */
      const atSec = b.verdict === null ? Infinity : b.shockAtSec ?? b.lightAtSec;
      return {
        id: b.id,
        level: b.level,
        atSec,
        text: atSec === Infinity ? `${name}: ${verdict}` : `${loc(time, lang)} · ${name}: ${verdict}`,
      };
    })
    .sort((a, b) => (a.atSec === b.atSec ? 0 : a.atSec - b.atSec));
  return (
    <div className="hud-card hud-lab-card">
      <div className="hud-card-title" style={{ marginBottom: 0 }}>
        <span>{tx(lang, 'Sırayla ne oluyor', 'What happens, in order')}</span>
        <span className="mn-badge">MODEL</span>
      </div>
      <p className="hud-lab-hint">
        {tx(
          lang,
          'Hızlandırılmış gösterim: sıra ve yazan süreler gerçektir, gösterimin hızı değil.',
          'Time-lapse: the order and the times given are real, the speed of the show is not.',
        )}
      </p>
      <ol className="hud-lab-run">
        {lines.map((line) => (
          <li key={line.id}>
            <button
              type="button"
              className={`hud-lab-run-line is-${line.level} ${started && lab.elapsedSec >= line.atSec ? 'is-done' : ''} ${line.atSec === Infinity ? 'is-never' : ''}`}
              aria-current={lab.focusId === line.id ? 'true' : undefined}
              onClick={() => game.setLabFocus(line.id)}
            >
              <i />
              <span>{line.text}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The bodies the explosion reaches, each with a dot in the colour of how it fares: a click on a name puts
 * that body in focus; the Moon, the planets and the other moons can be taken off the map and put on it. In a
 * solar eruption the spacecraft near Earth are one more entry.
 */
function BodyList({ lab, lang, onTable }: { lab: LabState; lang: Lang; onTable: () => void }) {
  const nameOf = (id: string): string => loc(lab.bodies.find((b) => b.id === id)?.name ?? BODY_NAMES.earth, lang);
  // In the class mode the question's scenario is fixed: bodies are neither taken off the map nor put on it.
  const fixed = lab.quiz !== null;
  const reached: Array<{ id: string; name: string; level: LabImpactLevel; removable: boolean }> = [
    { id: 'earth', name: nameOf('earth'), level: lab.impact.level, removable: false },
    ...(lab.kind === 'cme' && lab.impact.satellites.length > 0
      ? [{ id: 'satellites', name: loc(SATELLITES_NAME, lang), level: lab.impact.satellitesLevel, removable: false }]
      : []),
    ...lab.fates.map((f) => ({ id: f.id, name: nameOf(f.id), level: f.level, removable: !fixed && f.id !== 'sun' })),
  ];
  return (
    <div className="hud-card hud-lab-card">
      <div className="hud-card-title" style={{ marginBottom: 0 }}>
        <span>{tx(lang, 'Etkilenen cisimler', 'Bodies affected')}</span>
        <span className="mn-badge">MODEL</span>
      </div>
      <div className="hud-lab-bodies">
        {reached.map((b) => (
          <span key={b.id} className={`hud-lab-body is-${b.level} ${lab.focusId === b.id ? 'is-on' : ''}`}>
            <button
              type="button"
              className="hud-lab-body-name"
              aria-pressed={lab.focusId === b.id}
              title={`${loc(LEVEL[b.level].label, lang)} · ${tx(lang, 'Yakından bak', 'Look closely')}`}
              onClick={() => game.setLabFocus(b.id)}
            >
              <i />
              {b.name}
            </button>
            {b.removable && (
              <button
                type="button"
                className="hud-lab-body-off"
                aria-label={tx(lang, tpl`Haritadan çıkar: ${b.name}`, tpl`Take off the map: ${b.name}`)}
                title={tx(lang, 'Haritadan çıkar', 'Take off the map')}
                onClick={() => game.setLabBodyOnMap(b.id, false)}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!fixed && lab.removed.map((id) => (
          <button
            key={id}
            type="button"
            className="hud-lab-body-add"
            title={tx(lang, 'Haritaya geri koy', 'Put back on the map')}
            onClick={() => game.setLabBodyOnMap(id, true)}
          >
            + {nameOf(id)}
          </button>
        ))}
      </div>
      <button type="button" className="hud-look-chip hud-lab-table-open" onClick={onTable}>
        {tx(lang, 'Tümünü tabloda göster', 'Show all in a table')}
      </button>
      {!fixed && (
        <p className="hud-lab-hint">
          {tx(
            lang,
            'Nokta rengi cismin ne kadar etkilendiğini gösterir; haritadaki halka da aynı renktedir. Ada tıklayınca o cisme yaklaşılır ve sonucu aşağıda açılır. × cismi haritadan çıkarır; + ile Plüton, Titan, Europa ve çıkarılan cisimler eklenir.',
            'The colour of the dot shows how badly the body fares; its ring on the map has the same colour. A click on a name goes close to that body and opens its result below. × takes a body off the map; + adds Pluto, Titan, Europa and the bodies taken off.',
          )}
        </p>
      )}
    </div>
  );
}

/** One line of the table of all bodies: the body, what the columns say of it, and how it fares. */
interface TableRow {
  id: string;
  cells: string[];
  level: LabImpactLevel;
}

/**
 * Every body on the map side by side, Earth first: what reaches each and how it fares. The columns are those
 * of the kind of explosion; a name puts that body in focus and closes the table.
 */
function LabTable({ lab, lang, onClose }: { lab: LabState; lang: Lang; onClose: () => void }) {
  const { impact, fates, kind } = lab;
  const dialog = useDialog(true);
  const body = tx(lang, 'Cisim', 'Body');
  const result = tx(lang, 'Sonuç', 'Result');
  const distance = tx(lang, 'Uzaklık', 'Distance');
  let heads: string[];
  let rows: TableRow[];
  if (kind === 'cme') {
    heads = [body, tx(lang, 'Güneş’e uzaklık', 'Distance from the Sun'), tx(lang, 'Bulut', 'Cloud'), tx(lang, 'Basınç', 'Pressure'), tx(lang, 'Manyetosfer', 'Magnetosphere'), result];
    // The sunward edge of a magnetosphere is given in the body's own radii; a body without one has none.
    rows = [{ id: 'earth', ...impact, standoffRadii: impact.standoffRe }, ...fates].map((b): TableRow => ({
      id: b.id,
      cells: [
        loc(b.distanceLabel, lang),
        loc(b.shockTimeText, lang),
        `${scientific(b.pressureNPa, lang)} nPa`,
        b.standoffRadii > 0 ? tx(lang, tpl`${fmt(b.standoffRadii, 1, lang)} yarıçap`, tpl`${fmt(b.standoffRadii, 1, lang)} radii`) : '—',
      ],
      level: b.level,
    }));
  } else if (kind === 'grb') {
    heads = [body, distance, tx(lang, 'Gama akısı', 'Gamma fluence'), tx(lang, 'Işınlar', 'Rays'), tx(lang, 'Enerji', 'Energy'), result];
    rows = [{ id: 'earth', ...impact }, ...fates].map((b): TableRow => ({
      id: b.id,
      cells: [loc(b.distanceLabel, lang), `${scientific(b.fluenceJm2, lang)} J/m²`, loc(b.shockTimeText, lang), `${scientific(b.energyJ, lang)} J`],
      level: b.level,
    }));
  } else {
    heads = [body, distance, tx(lang, 'Işık (× oradaki Güneş)', 'Light (× the Sun there)'), tx(lang, 'Sıcaklık', 'Temperature'), tx(lang, 'Işık', 'Light'), tx(lang, 'Şok', 'Blast'), result];
    rows = [
      {
        id: 'earth',
        cells: [loc(impact.distanceLabel, lang), `× ${scientific(impact.fluxSolar, lang)}`, `${scientific(impact.surfaceTempK, lang)} K`, loc(impact.lightTimeText, lang), loc(impact.shockTimeText, lang)],
        level: impact.level,
      },
      // A star is not compared with the sunlight it gets, nor given a temperature: as in its result card.
      ...fates.map((f): TableRow => ({
        id: f.id,
        cells: [
          loc(f.distanceLabel, lang),
          f.bodyClass === 'star' ? '—' : `× ${scientific(f.fluxLocal, lang)}`,
          f.bodyClass === 'star' ? '—' : `${scientific(f.tempK, lang)} K`,
          loc(f.lightTimeText, lang),
          loc(f.shockTimeText, lang),
        ],
        level: f.level,
      })),
    ];
  }
  return (
    <div className="mn-modal-backdrop" onClick={onClose}>
      <div
        className="mn-modal hud-lab-table-modal"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={tx(lang, 'Bütün cisimler', 'All bodies')}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        // Esc closes the table; it must not reach the page's own Esc, which leaves the lab.
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.stopPropagation();
          onClose();
        }}
      >
        <div className="mn-modal-head">
          <h2 className="mn-modal-title hud-lab-table-title">
            <span>{tx(lang, 'Bütün cisimler', 'All bodies')}</span>
            <span className="mn-badge">MODEL</span>
          </h2>
          <button type="button" className="mn-btn" onClick={onClose}>
            {tx(lang, 'Kapat [Esc]', 'Close [Esc]')}
          </button>
        </div>
        <div className="hud-lab-table-wrap">
          <table className="hud-lab-table">
            <thead>
              <tr>
                {heads.map((h, i) => <th key={i} scope="col">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row">
                    <button
                      type="button"
                      className="hud-lab-table-name"
                      onClick={() => {
                        game.setLabFocus(r.id);
                        onClose();
                      }}
                    >
                      {loc(lab.bodies.find((b) => b.id === r.id)?.name ?? BODY_NAMES.earth, lang)}
                    </button>
                  </th>
                  {r.cells.map((cell, i) => <td key={i}>{cell}</td>)}
                  <td><span className={`mn-badge ${LEVEL[r.level].cls}`}>{loc(LEVEL[r.level].label, lang)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function LabDrawer() {
  const lang = useLang();
  const lab = useGame((s) => s.lab);
  const cleanMode = useGame((s) => s.cleanMode);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  /** Pixels the two panels cover at the left and right edges; the map and the view chips sit between them. */
  const [insets, setInsets] = useState({ left: 0, right: 0 });
  const [tableOpen, setTableOpen] = useState(false);
  const open = lab !== null;
  const quizPhase = lab?.quiz?.phase ?? null;
  // Until the model's answer is out, the right panel (which is that answer) is empty and covers nothing.
  const concealed = quizPhase === 'ask' || quizPhase === 'run';
  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = (): void => {
      const left = leftRef.current?.getBoundingClientRect().right ?? 0;
      const right = window.innerWidth - (rightRef.current?.getBoundingClientRect().left ?? window.innerWidth);
      game.setLabInsets(left, right);
      setInsets((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, quizPhase, cleanMode]);
  // The clean view (projector, board) draws no panel: with none to measure, the map has the whole screen.
  if (!lab || cleanMode) return null;
  const { impact } = lab;
  const solar = lab.kind === 'cme';
  const supernova = lab.kind === 'sn2' || lab.kind === 'sn1a';
  const maxAU = solar ? 2 : LAB_MAX_AU;
  // The distance slider counts whole steps of a hundredth of a decade from the nearest distance: whole
  // numbers, so that its last step is the far end exactly.
  const logMinAU = Math.log10(LAB_MIN_AU);
  const sliderSteps = Math.ceil((Math.log10(maxAU) - logMinAU) * 100);
  const sun = lab.bodies.find((b) => b.id === 'sun');
  const sunAU = sun?.distanceAU ?? 1;
  // Distances that no body on the map marks.
  const farPlaces: Place[] = [
    { key: 'ly', label: { tr: '1 ışık yılı', en: '1 light year' }, au: LY_AU, anchorId: null },
    { key: 'hazard', label: { tr: 'Tehlike sınırı', en: 'Hazard limit' }, au: (lab.kind === 'grb' ? BURST_HAZARD_LY : SUPERNOVA_HAZARD_LY) * LY_AU, anchorId: null },
  ];
  const places: Place[] = solar
    ? [...NEAR_SUN, { key: 'sun', label: { tr: 'Gerçek yeri', en: 'Its real place' }, au: sunAU, anchorId: 'sun' }]
    : [
      ...lab.bodies.filter((b) => !lab.removed.includes(b.id)).map((b): Place => ({ key: b.id, label: b.name, au: b.distanceAU, angleRad: b.angleRad, anchorId: b.id })),
      ...farPlaces,
    ].sort((a, b) => a.au - b.au);
  const mapDate = formatDate(lab.jdTT, lang);
  // The bodies other than Earth that the explosion takes apart, by name: Earth's card names them too, so
  // that its summary does not read as if Earth alone were hit.
  const destroyed = lab.fates
    .filter((f) => f.outcome.breakup >= LAB_BREAKUP_AT)
    .map((f) => loc(lab.bodies.find((b) => b.id === f.id)?.name ?? BODY_NAMES.earth, lang));
  const destroyedNames = destroyed.join(', ');
  const earthGone = impact.outcome.breakup >= LAB_BREAKUP_AT;
  let alsoDestroyed = '';
  if (destroyed.length === 1) {
    alsoDestroyed = earthGone
      ? tx(lang, tpl`Dünya ile birlikte 1 cisim daha yok olur: ${destroyedNames}.`, tpl`1 more body is destroyed along with Earth: ${destroyedNames}.`)
      : tx(lang, tpl`Dünya dağılmaz, ama 1 cisim yok olur: ${destroyedNames}.`, tpl`Earth holds together, but 1 body is destroyed: ${destroyedNames}.`);
  } else if (destroyed.length > 1) {
    alsoDestroyed = earthGone
      ? tx(lang, tpl`Dünya ile birlikte ${destroyed.length} cisim daha yok olur: ${destroyedNames}.`, tpl`${destroyed.length} more bodies are destroyed along with Earth: ${destroyedNames}.`)
      : tx(lang, tpl`Dünya dağılmaz, ama ${destroyed.length} cisim yok olur: ${destroyedNames}.`, tpl`Earth holds together, but ${destroyed.length} bodies are destroyed: ${destroyedNames}.`);
  }
  const kindWhat = KINDS.find((k) => k.id === lab.kind)?.what;
  // What is in focus: Earth, the spacecraft near it, or one of the other bodies with what is to become of it.
  const onSatellites = lab.focusId === 'satellites';
  const fate = lab.fates.find((f) => f.id === lab.focusId);
  const focusName = loc(onSatellites ? SATELLITES_NAME : lab.bodies.find((b) => b.id === lab.focusId)?.name ?? BODY_NAMES.earth, lang);
  const focusLevel = onSatellites ? impact.satellitesLevel : fate ? fate.level : impact.level;
  const level = LEVEL[focusLevel];
  const steps = fate ? fate.steps : impact.steps;
  const watchWorld = loc(WORLDS[WATCH_WORLDS.find((w) => w === lab.focusId) ?? 'moon'].name, lang);

  return (
    <>
      <div className="hud-lab-drawer" ref={leftRef}>
        {lab.quiz ? <QuizCard quiz={lab.quiz} lang={lang} /> : (
          <div className="hud-card hud-lab-card">
            <div className="hud-card-title" style={{ marginBottom: 0 }}>
              <span>{tx(lang, 'Patlama Laboratuvarı', 'Explosion Lab')}</span>
              <span className="mn-badge">MODEL</span>
            </div>

            <div>
              <div className="hud-lab-kinds">
                {KINDS.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    className={`hud-lab-kind ${lab.kind === k.id ? 'is-active' : ''}`}
                    aria-pressed={lab.kind === k.id}
                    onClick={() => game.setLabConfig({ kind: k.id })}
                  >
                    {loc(k.name, lang)}
                  </button>
                ))}
              </div>
              {kindWhat && <p className="hud-lab-kind-what">{loc(kindWhat, lang)}</p>}
            </div>

            {solar && (
              <div>
                <span className="hud-lab-label">{tx(lang, 'Patlamanın gücü', 'Strength of the eruption')}</span>
                <div className="hud-look-row">
                  {STRENGTHS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`hud-look-chip ${lab.cmeStrength === s.id ? 'is-on' : ''}`}
                      aria-pressed={lab.cmeStrength === s.id}
                      onClick={() => game.setLabConfig({ cmeStrength: s.id })}
                    >
                      {loc(s.label, lang)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="hud-lab-distance">
                <span>{tx(lang, 'Dünya’ya uzaklığı', 'Distance from Earth')}</span>
                <strong>{loc(impact.distanceLabel, lang)}</strong>
              </div>
              <input
                type="range"
                className="hud-lab-slider"
                min={0}
                max={sliderSteps}
                step={1}
                value={lab.distanceAU >= maxAU ? sliderSteps : Math.round((Math.log10(lab.distanceAU) - logMinAU) * 100)}
                onChange={(e) => game.setLabConfig({ distanceAU: Math.min(maxAU, 10 ** (logMinAU + Number(e.target.value) / 100)), anchorId: null })}
                aria-label={tx(lang, 'Dünya’ya uzaklığı', 'Distance from Earth')}
              />
              <div className="hud-look-row" style={{ marginTop: 6 }}>
                {places.map((p) => {
                  // A place taken from a body is the chosen one while the explosion is set at that body; a
                  // free distance, while the explosion is that far away.
                  const chosen = p.anchorId !== null
                    ? lab.anchorId === p.anchorId
                    : Math.abs(Math.log10(lab.distanceAU / Math.max(LAB_MIN_AU, p.au))) < 0.004;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      className={`hud-look-chip ${chosen ? 'is-on' : ''}`}
                      title={loc(distanceText(p.au), lang)}
                      onClick={() => game.setLabConfig(
                        p.angleRad === undefined
                          ? { distanceAU: p.au, anchorId: p.anchorId }
                          : { distanceAU: p.au, angleRad: p.angleRad, anchorId: p.anchorId },
                      )}
                    >
                      {loc(p.label, lang)}
                    </button>
                  );
                })}
              </div>
              <MapDate jdTT={lab.jdTT} lang={lang} />
              <p className="hud-lab-hint">
                {solar
                  ? tx(
                    lang,
                    tpl`Gerçekte Güneş ${loc(distanceText(sunAU), lang)} uzaktadır; daha yakın konumlar varsayımsaldır. Gezegenler ${mapDate} tarihindeki yerlerindedir. Bir cisme ya da haritaya tıklayarak da yer seçebilirsiniz.`,
                    tpl`In reality the Sun is ${loc(distanceText(sunAU), lang)} away; closer positions are hypothetical. The planets are where they stood on ${mapDate}. You can also click a body or the map to choose a place.`,
                  )
                  : tx(
                    lang,
                    tpl`Harita Güneş merkezlidir: gezegenler ${mapDate} tarihinde yörüngelerinde, gerçek sıralarında ve Güneş çevresindeki gerçek konumlarındadır. Yörünge aralıkları şematiktir (eşit adımlar); gezegenlerin ötesinde ölçek 10.000 ışık yılına kadar logaritmiktir. Dünya’nın yakın çevresi (yaklaşık 0,2 AU’ya kadar) büyütülmüştür: Ay ve yakındaki bir patlama Dünya’dan ayrı görünür. Cisimler ölçekli değildir. Bir cisme ya da haritaya tıklayarak da yer seçebilirsiniz.`,
                    tpl`The Sun is at the centre of the map: the planets are on their orbits, in their true order, at their real positions round the Sun on ${mapDate}. The spacing of the orbits is schematic (equal steps); beyond the planets the scale is logarithmic, out to 10,000 light years. Earth’s neighbourhood (out to about 0.2 AU) is magnified, so that the Moon and a nearby explosion are seen apart from Earth. The bodies are not to scale. You can also click a body or the map to choose a place.`,
                  )}
              </p>
            </div>

            <div className="hud-lab-actions">
              <button type="button" className="mn-btn mn-btn-amber" style={{ flex: 1 }} onClick={() => game.detonateLab()}>
                {lab.playing ? tx(lang, '↺ Yeniden patlat', '↺ Detonate again') : tx(lang, 'Patlat', 'Detonate')}
              </button>
              <button type="button" className="mn-btn" disabled={!lab.playing} onClick={() => game.resetLab()}>
                {tx(lang, 'Sıfırla', 'Reset')}
              </button>
            </div>

            <div className="hud-lab-extras">
              <ShareLink lang={lang} />
              <button type="button" className="mn-btn" onClick={() => game.startLabQuiz()}>
                {tx(lang, 'Tahmin et: 5 soru', 'Predict: 5 questions')}
              </button>
            </div>

            <label className="hud-lab-check">
              <input type="checkbox" checked={lab.evaMode} onChange={(e) => game.setLabConfig({ evaMode: e.target.checked })} />
              <span>{tx(lang, 'Astronot olarak içinde uç (W A S D, Boşluk, Q)', 'Fly through it as the astronaut (W A S D, Space, Q)')}</span>
            </label>
          </div>
        )}
      </div>

      <div className="hud-lab-views" style={{ left: insets.left + 12, right: insets.right + 12 }}>
        {lab.playing && (
          <div className="hud-lab-transport">
            {lab.elapsedSec >= lab.runSec ? (
              // The run has reached its end and waits there: the button plays it again from the start.
              <button
                type="button"
                aria-label={tx(lang, 'Baştan oynat', 'Play again')}
                title={tx(lang, 'Baştan oynat', 'Play again')}
                onClick={() => {
                  game.seekLab(0);
                  game.setLabPaused(false);
                }}
              >
                ↺
              </button>
            ) : (
              <button
                type="button"
                aria-label={lab.paused ? tx(lang, 'Devam et', 'Resume') : tx(lang, 'Duraklat', 'Pause')}
                title={lab.paused ? tx(lang, 'Devam et', 'Resume') : tx(lang, 'Duraklat', 'Pause')}
                onClick={() => game.setLabPaused(!lab.paused)}
              >
                {lab.paused ? '▶\uFE0E' : '⏸\uFE0E'}
              </button>
            )}
            <input
              type="range"
              min={0}
              max={lab.runSec}
              step={0.05}
              value={Math.min(lab.runSec, lab.elapsedSec)}
              onChange={(e) => game.seekLab(Number(e.target.value))}
              aria-label={tx(lang, 'Zaman', 'Time')}
            />
          </div>
        )}
        {!lab.evaMode && (
          <div className="hud-look-row">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" className="hud-look-chip" onClick={() => game.setLabView(v.id)}>
                {loc(v.label, lang)}
              </button>
            ))}
          </div>
        )}
        <span>{tx(lang, 'Sürükle: döndür · Tekerlek: yakınlaş, uzaklaş', 'Drag: turn · Wheel: zoom in and out')}</span>
      </div>

      <div className={`hud-lab-result ${concealed ? 'is-concealed' : ''}`} ref={rightRef}>
        {!concealed && (
          <>
            <BodyList lab={lab} lang={lang} onTable={() => setTableOpen(true)} />

            <RunList lab={lab} lang={lang} />

            <div className={`hud-card hud-impact-box is-${focusLevel}`}>
              <div className="hud-card-title" style={{ marginBottom: 0 }}>
                <span>{tx(lang, tpl`${focusName} üzerindeki etki`, tpl`Effect on ${focusName}`)}</span>
                <span className={`mn-badge ${level.cls}`}>{loc(level.label, lang)}</span>
              </div>
              {onSatellites ? (
                <ul className="hud-lab-sats">
                  {impact.satellites.map((s) => (
                    <li key={s.id}>
                      <strong>{loc(s.name, lang)}</strong>
                      <span>{loc(s.note, lang)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="hud-lab-summary">{fate ? fate.summary.map((s) => loc(s, lang)).join(' ') : loc(impact.summary, lang)}</p>
              )}
              {!onSatellites && !fate && alsoDestroyed !== '' && <p className="hud-lab-summary">{alsoDestroyed}</p>}
              {/* Not in the class mode: the way back would start its questions again. */}
              {supernova && !lab.quiz && (
                <button
                  type="button"
                  className="mn-btn hud-lab-watch"
                  title={tx(lang, 'Bu patlamayı o dünyanın gökyüzünde izleyin', 'Watch this explosion in the sky of that world')}
                  onClick={() => { game.watchLabFromGround().catch(() => undefined); }}
                >
                  {tx(lang, tpl`Oradan izle: ${watchWorld}`, tpl`Watch from there: ${watchWorld}`)}
                </button>
              )}
              <p className="hud-lab-origin">
                <span className="mn-badge">MODEL</span>
                <span>{tx(lang, 'Bu uygulamanın kendi hesabıdır; NASA’nın açıklaması değildir.', 'This app’s own estimate, not a statement by NASA.')}</span>
              </p>

              {!onSatellites && (fate ? <FateResult fate={fate} kind={lab.kind} lang={lang} /> : <EarthResult impact={impact} kind={lab.kind} lang={lang} />)}

              {steps.length > 0 && (
                <div className="hud-lab-steps">
                  <div className="mn-section-label">{tx(lang, 'Sırasıyla ne olur?', 'What happens, in order')}</div>
                  {steps.map((s) => {
                    const done = lab.playing && lab.elapsedSec >= s.atSec;
                    return (
                      <div key={s.id} className={`hud-lab-step ${done ? 'is-done' : ''}`}>
                        <span className="hud-lab-tick">{done ? '✓' : '·'}</span>
                        <span>{loc(s.text, lang)}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              <details className="hud-lab-sources">
                <summary>{tx(lang, 'Hesap neye dayanıyor?', 'What is the estimate based on?')}</summary>
                <p>{tx(lang, 'Bu bir büyüklük mertebesi modelidir: amacı kesin tahmin değil, uzaklıkları karşılaştırmaktır. “ZARARSIZ”, “YIKICI” gibi etiketler ve sonuçların anlatımı bu uygulamaya aittir.', 'It is an order-of-magnitude model: it is for comparing distances, not for forecasting. Labels such as “HARMLESS” and “DEVASTATING”, and the wording of the consequences, are this app’s own.')}</p>
                <ul>
                  <li>{tx(lang, 'NASA araştırmasından: 26 ışık yılı tehlike sınırı (Gehrels ve ark. 2003, NASA Goddard; ozon tabakası).', 'From NASA research: the 26-light-year hazard limit (Gehrels et al. 2003, NASA Goddard; ozone layer).')}</li>
                  <li>{tx(lang, 'Gama ışını patlaması: NASA Goddard ortak yazarlı Thomas ve ark. (2005) çalışmasındaki patlama; 6.500 ışık yılından metrekareye 100 kJ düşer ve ozon tabakası ortalama %35 azalır. Daha yakın ve daha uzak değerler bu noktadan ölçeklenir. Hüzme 12° genişliğinde alınır; ölçekli olmayan haritada geniş görünür.', 'Gamma-ray burst: the burst of Thomas et al. (2005, with NASA Goddard); from 6,500 light years 100 kJ falls on every square metre and the ozone layer thins by 35% on average. Nearer and farther values are scaled from that point. The beam is taken to be 12° wide; on the map, which is not to scale, it looks wide.')}</li>
                  <li>{tx(lang, 'Ölçümden: Mayıs 2024 fırtınasında kutup ışıkları yaklaşık 30° enleme kadar indi; güneş patlamasının ölçeği buna göre ayarlıdır.', 'From measurement: in the May 2024 storm the auroras reached about latitude 30°; the scale of the solar eruption is fitted to that.')}</li>
                  <li>{tx(lang, 'Güneş patlamasının gücü: Mayıs 2024 ölçüme, Carrington sınıfı 1859’da bulutun 17 saat 40 dakikada ulaşmasına (Tsurutani ve ark. 2003, NASA JPL) dayanır; 1859’da basınç ölçülmedi, o değer modelindir.', 'Strength of the solar eruption: May 2024 rests on measurement, the Carrington class on the cloud of 1859 taking 17 h 40 min (Tsurutani et al. 2003, NASA JPL); the pressure was not measured in 1859, that value is the model’s.')}</li>
                  <li>{tx(lang, 'Uydular: yörünge yükseklikleri gerçektir; manyetosferin içinde mi dışında mı kaldıkları modelin hesabıdır. L1’deki gözcüler bulutu Dünya’dan önce görür.', 'Satellites: the heights of the orbits are real; whether they end up inside or outside the magnetosphere is the model’s estimate. The sentinels at L1 meet the cloud before Earth does.')}</li>
                  <li>{tx(lang, 'Modelden: parlaklık (ters kare yasası), Dünya’ya düşen enerji payı, yıkım eşikleri (üst sınır) ve şok dalgasının varış süresi.', 'From the model: brightness (inverse-square law), the share of the energy that strikes Earth, the destruction thresholds (upper bounds) and the arrival time of the blast wave.')}</li>
                  <li>{tx(lang, 'Diğer cisimler: Ay, Güneş ve gezegenlerin her biri gerçek yarıçapı, kütlesi ve patlamaya gerçek uzaklığıyla aynı modelden geçer; parlaklık, o cismin normalde aldığı güneş ışığıyla karşılaştırılır. Güneş patlamasının bulutu yaklaşık 70° genişliğindedir ve Dünya’ya yöneliktir: dışında kalan cisimleri ıskalar.', 'The other bodies: the Moon, the Sun and each planet go through the same model with their real radius, mass and distance from the explosion; the brightness is compared with the sunlight that body normally gets. The cloud of a solar eruption is about 70° wide and aimed at Earth: it misses the bodies outside it.')}</li>
                  <li>{tx(lang, 'Eklenen cisimler: Plüton (New Horizons haritası; güneyi görülmedi), Europa (Voyager ve Galileo mozaiği), Titan (pusunun rengi bir model varsayımıdır). Uydular gezegenlerinin yerinde sayılır.', 'Added bodies: Pluto (New Horizons map; its far south was not seen), Europa (Voyager and Galileo mosaic), Titan (its haze colour is a model assumption). Moons are taken to stand where their planets do.')}</li>
                  <li>{tx(lang, 'Gezegenlerin yerleri: astronomy-engine ile hesaplanır (NASA JPL Horizons ile sınanmış bir kütüphane). Haritada Güneş merkezdedir; gezegenler yörüngelerinde, gerçek sıralarında ve Güneş çevresindeki gerçek konumlarındadır. Yörünge aralıkları şematiktir.', 'Planet positions: computed with astronomy-engine (a library tested against NASA JPL Horizons). On the map the Sun is at the centre; the planets are on their orbits, in their true order, at their real positions round the Sun. The spacing of the orbits is schematic.')}</li>
                  <li>{tx(lang, 'Gezegen görüntüleri: NASA görev haritaları ve Hubble (OPAL); ayrıntılar ana menüdeki Kaynaklar’da.', 'Planet pictures: NASA mission maps and Hubble (OPAL); details under Sources in the main menu.')}</li>
                </ul>
              </details>
            </div>
          </>
        )}
      </div>

      {tableOpen && !concealed && <LabTable lab={lab} lang={lang} onClose={() => setTableOpen(false)} />}
    </>
  );
}
