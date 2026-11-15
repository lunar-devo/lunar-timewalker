/**
 * Observatory HUD for both the planet/orbit view (SurfaceHud) and close-up views (SpaceHud):
 *   - Unified 46 px top bar (world switcher, clickable compass, telescope, sky guide, data, lab, overflow)
 *   - Unified 54 px bottom time bar (date, step buttons, scrubber, speed selector)
 *   - Borderless sky/ground labels (no boxes around targets), bright star names [C], clean projector mode [U]
 *   - Space Explosion Lab drawer for moving supernovae / CMEs next to Earth and inspecting the impact
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import './hud.css';
import type {
  DonkiResult, EventDef, GalaxyDef, GalaxyPicture, L10n, Lang, NasaImage, NasaTopicResult, SiteBody, SkyTarget, WorldId,
} from '../../core/types';
import { getManifest } from '../../core/assets';
import { frame } from '../../core/frame';
import { LOCALE, dictRevision, fmt, loc, tpl, tx, useLang } from '../../core/i18n';
import { setGame, useGame } from '../../core/store';
import { downloadBlob } from '../../core/download';
import {
  decimalYear, formatDate, formatDuration, jdTTFromDecimalYear, jdTTNow, yearLabel,
} from '../../core/time';
import {
  BODY_NAMES, EVENTS, GALAXIES, GLOBE_CAPTIONS, INFO_TOPICS, SURFACE_ASSETS, TRANSIENTS,
  WORLD_ORDER, WORLDS, archiveTopicAt, earthImageryFor,
} from '../../content';
import { game } from '../../game/api';
import { createNasa } from '../../nasa';
import { parseLabLink } from '../../views/lab/link';
import { LAB_WATCH_EVENT_ID, LAB_WATCH_NAME, LAB_WATCH_TARGET_ID } from '../../views/lab/watch';
import { orbitViewInfo } from '../../views/orbits';
import { sunViewLabels } from '../../views/special';
import { LangPicker } from '../LangPicker';
import { LabDrawer } from './LabDrawer';
import { useFit } from '../useFit';
import { useDialog } from '../useDialog';

const nasaClient = createNasa();

function resolveTargetName(id: string, lang: Lang): string {
  if (id === 'moon') return tx(lang, 'Ay', 'Moon');
  if (id in BODY_NAMES) return loc(BODY_NAMES[id as keyof typeof BODY_NAMES], lang);
  if (id === LAB_WATCH_TARGET_ID) return loc(LAB_WATCH_NAME, lang);
  const tr = TRANSIENTS.find((t) => t.id === id);
  if (tr) return loc(tr.name, lang);
  const gal = GALAXIES.find((g) => g.id === id);
  if (gal) return loc(gal.name, lang);
  const asset = SURFACE_ASSETS.find((a) => a.id === id);
  if (asset) return loc(asset.name, lang);
  return id;
}

/** Compass points for the heading readout, clockwise from north. */
const COMPASS_POINTS: Record<Lang, string[]> = {
  tr: ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'],
  en: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
  de: ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'],
  fr: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'],
  es: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'],
  it: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'],
  ru: ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'],
};
/** Half of the compass strip spans this many degrees of azimuth. */
const COMPASS_HALF_SPAN_DEG = 70;

/** The kinds of light a galaxy's pictures are taken in, as named on the button that chooses one. */
const LIGHT_NAMES: Record<GalaxyPicture['id'], L10n> = {
  visible: { tr: 'Görünür ışık', en: 'Visible light' },
  infrared: { tr: 'Kızılötesi', en: 'Infrared' },
  ultraviolet: { tr: 'Morötesi', en: 'Ultraviolet' },
};
/** The body an event is bound to, for the events that happen on one: it is watched from a place there. */
export const EVENT_BODY: Partial<Record<EventDef['seenFrom'], SiteBody>> = { moon: 'moon', mars: 'mars' };
/** What the map and the world list say while such an event holds them to its body. */
export const ONLY_FROM_BODY: Record<SiteBody, L10n> = {
  moon: { tr: 'Bu olay Ay’da geçer; yalnızca Ay’dan izlenir.', en: 'This event takes place on the Moon and can only be watched from there.' },
  mars: { tr: 'Bu olay Mars’ta geçer; yalnızca Mars’tan izlenir.', en: 'This event takes place on Mars and can only be watched from there.' },
};
/** Close-up views that are not named after a body of the sky or a galaxy: what the bar calls them. */
const VIEW_TITLES: Partial<Record<string, L10n>> = {
  lab: { tr: 'Patlama Laboratuvarı', en: 'Explosion Lab' },
  mars_orbit: { tr: 'Dünya ve Mars’ın yörüngeleri', en: 'The orbits of Earth and Mars' },
};
/** Mean width of the full Moon in Earth's sky, degrees. */
const FULL_MOON_DEG = 0.518;

/** How wide a galaxy's picture is: on the sky, against the full Moon, and at the galaxy's distance. */
function pictureWidthText(galaxy: GalaxyDef, shot: GalaxyPicture, lang: Lang): string {
  const degrees = fmt(shot.fieldDeg, shot.fieldDeg >= 1 ? 1 : shot.fieldDeg >= 0.1 ? 2 : 3, lang);
  const across = 2 * galaxy.distanceMly * 1e6 * Math.tan((shot.fieldDeg / 2) * (Math.PI / 180));
  // Two significant figures: the distance is not known better than that.
  const step = 10 ** (Math.floor(Math.log10(across)) - 1);
  const lightYears = fmt(Math.round(across / step) * step, 0, lang);
  const moons = shot.fieldDeg / FULL_MOON_DEG;
  if (moons >= 1) {
    const count = fmt(moons, moons >= 10 ? 0 : 1, lang);
    return tx(
      lang,
      tpl`Bu görüntü gökyüzünde ${degrees}° genişliğindedir (yan yana ${count} dolunay); galaksinin uzaklığında bu yaklaşık ${lightYears} ışık yılı eder.`,
      tpl`This picture is ${degrees}° wide on the sky (${count} full Moons side by side); at the galaxy's distance that is about ${lightYears} light years.`,
    );
  }
  const times = fmt(1 / moons, 1 / moons >= 10 ? 0 : 1, lang);
  return tx(
    lang,
    tpl`Bu görüntü gökyüzünde ${degrees}° genişliğindedir (dolunay bunun ${times} katıdır); galaksinin uzaklığında bu yaklaşık ${lightYears} ışık yılı eder.`,
    tpl`This picture is ${degrees}° wide on the sky (the full Moon is ${times} times as wide); at the galaxy's distance that is about ${lightYears} light years.`,
  );
}

/**
 * Scale of a galaxy close-up: a bar of a round number of light years at the galaxy's distance and, where
 * the picture is wide enough for it, the full Moon as large as it would be in the same picture.
 */
function GalaxyScale({ galaxy, shot, lang }: { galaxy: GalaxyDef; shot: GalaxyPicture; lang: Lang }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const lengthRef = useRef<HTMLSpanElement>(null);
  const moonRef = useRef<HTMLDivElement>(null);
  const discRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const lightYearsPerDeg = galaxy.distanceMly * 1e6 * (Math.PI / 180);
    let shown = 0;
    const loop = () => {
      const pxPerDeg = frame.closeUpPxPerDeg;
      const root = rootRef.current;
      if (root && barRef.current && lengthRef.current && moonRef.current && discRef.current) {
        root.style.visibility = pxPerDeg > 0 ? 'visible' : 'hidden';
        if (pxPerDeg > 0) {
          // The longest round length (1, 2 or 5 times a power of ten) that is no more than 180 pixels long.
          const most = (180 / pxPerDeg) * lightYearsPerDeg;
          const power = 10 ** Math.floor(Math.log10(most));
          const lightYears = power * (most / power >= 5 ? 5 : most / power >= 2 ? 2 : 1);
          barRef.current.style.width = `${(lightYears / lightYearsPerDeg) * pxPerDeg}px`;
          if (lightYears !== shown) {
            shown = lightYears;
            lengthRef.current.textContent = tx(lang, tpl`${fmt(lightYears, 0, lang)} ışık yılı`, tpl`${fmt(lightYears, 0, lang)} light years`);
          }
          // The Moon is drawn where it is neither a speck nor so large that it would lie over the galaxy: no
          // wider than a third of the window's height, nor than three tenths of the picture.
          const moonPx = FULL_MOON_DEG * pxPerDeg;
          moonRef.current.style.display = moonPx >= 14 && moonPx <= window.innerHeight / 3 && FULL_MOON_DEG <= shot.fieldDeg * 0.3 ? '' : 'none';
          discRef.current.style.width = `${moonPx}px`;
          discRef.current.style.height = `${moonPx}px`;
        }
      }
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [galaxy, shot, lang]);

  return (
    <div ref={rootRef} className="hud-galaxy-scale" style={{ visibility: 'hidden' }}>
      <div ref={moonRef} className="hud-galaxy-moon">
        <div ref={discRef} />
        <span>{tx(lang, 'Dolunay gökyüzünde bu kadar yer kaplar', 'The full Moon covers this much sky')}</span>
      </div>
      <div className="hud-galaxy-bar">
        <div ref={barRef} />
        <span ref={lengthRef} />
      </div>
    </div>
  );
}

/**
 * A share from 0 to 1 as a whole percentage, written the way the language writes it: "%50" in Turkish,
 * "50%" in English, "50 %" in German.
 */
function percent(share: number, lang: Lang): string {
  return share.toLocaleString(LOCALE[lang], { style: 'percent', maximumFractionDigits: 0 });
}

/** Worlds with no air above the astronaut: the sunlight that reaches a panel there is the full flux. */
const AIRLESS: Record<WorldId, boolean> = {
  moon: true,
  mercury: true,
  venus: false,
  earth: false,
  mars: false,
  jupiter: false,
  saturn: false,
  uranus: false,
  neptune: false,
  orbit: true,
};

/** The telescope's mask leaves the view clear out to this share of the window's half-diagonal (.hud-scope-mask). */
const SCOPE_CLEAR = 0.34;
/** A label on an object in the scene comes no closer than this to a side of the window, px. */
const LABEL_EDGE_PX = 6;

/**
 * A name short enough for the compass: its designation, which is the first word and any of the next two
 * that carry a number or are a single letter ("SN 1054", "Cassiopeia A", "C/-43 K1", "Comet 1P/Halley").
 */
function compassShortName(name: string): string {
  const words = name.split(' (')[0].split(' ').slice(0, 3);
  const last = words.findLastIndex((w) => /\d/.test(w) || w.length === 1);
  return words.slice(0, Math.max(1, last + 1)).join(' ');
}

/**
 * Horizon compass in the top bar. Target names slide with the heading every frame; a name is shown only
 * where it fits without touching another one, so labels never pile up (the most important target wins).
 */
function Compass({ targets, primaryId, lang }: { targets: SkyTarget[]; primaryId: string | undefined; lang: Lang }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const readoutRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const widths = useRef(new Map<string, { text: string; width: number }>());

  // What is above the horizon comes before what is below it, so that a set Sun does not take the place of a
  // planet that can be seen; within each, the Sun, then Earth or the Moon, then the event's kinds of object.
  const ordered = useMemo(() => {
    const rank = (t: SkyTarget): number => (
      t.id === primaryId ? -1
        : (t.visible ? 0 : 4) + (
          t.kind === 'sun' ? 0
            : t.kind === 'earth' || t.id === 'moon' ? 1
              : t.kind === 'supernova' || t.kind === 'comet' ? 2
                : 3
        )
    );
    return targets
      .filter((t) => t.kind !== 'galaxy')
      .sort((a, b) => rank(a) - rank(b) || a.magnitude - b.magnitude)
      .slice(0, 12);
  }, [targets, primaryId]);
  const orderedRef = useRef(ordered);
  orderedRef.current = ordered;

  useEffect(() => {
    let raf = 0;
    const loop = (): void => {
      const wrap = wrapRef.current;
      if (wrap) {
        const heading = ((frame.headingDeg % 360) + 360) % 360;
        if (readoutRef.current) {
          readoutRef.current.textContent = `${Math.round(heading) % 360}° ${COMPASS_POINTS[lang][Math.round(heading / 45) % 8]}`;
        }
        const half = wrap.clientWidth / 2;
        const placed: Array<[number, number]> = [];
        for (const t of orderedRef.current) {
          const el = itemRefs.current.get(t.id);
          if (!el) continue;
          const diff = ((t.azDeg - heading + 540) % 360) - 180;
          let cached = widths.current.get(t.id);
          const text = el.textContent ?? '';
          if (!cached || cached.text !== text) {
            cached = { text, width: el.offsetWidth };
            widths.current.set(t.id, cached);
          }
          const x = half + (diff / COMPASS_HALF_SPAN_DEG) * half;
          const x1 = x - cached.width / 2;
          const x2 = x + cached.width / 2;
          const fits = Math.abs(diff) <= COMPASS_HALF_SPAN_DEG && x1 >= 2 && x2 <= half * 2 - 2
            && placed.every(([a, b]) => x2 + 6 < a || x1 - 6 > b);
          if (fits) placed.push([x1, x2]);
          el.style.transform = `translateX(${Math.round(x1)}px)`;
          el.style.visibility = fits ? 'visible' : 'hidden';
        }
      }
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [lang]);

  return (
    <div
      ref={wrapRef}
      className="hud-compass-wrap"
      title={tx(lang, 'Bir gök cisminin adına tıklarsanız kamera ona döner', 'Click any object name to turn toward it')}
    >
      <div className="hud-compass-center-tick" />
      <div className="hud-compass-readout" ref={readoutRef}>0°</div>
      {ordered.map((t) => (
        <button
          key={t.id}
          type="button"
          className="hud-compass-marker"
          ref={(el) => {
            if (el) itemRefs.current.set(t.id, el);
            else itemRefs.current.delete(t.id);
          }}
          onClick={() => game.lookAtTarget(t.id)}
          style={{
            visibility: 'hidden',
            color: t.id === primaryId ? 'var(--c-accent-2)' : t.visible ? 'var(--c-accent)' : 'var(--c-dim)',
          }}
        >
          {compassShortName(t.id === 'moon' ? (tx(lang, 'Ay', 'Moon')) : loc(t.name, lang))}
        </button>
      ))}
    </div>
  );
}

interface Box2D { x1: number; y1: number; x2: number; y2: number }

function overlapsBox(a: Box2D, list: Box2D[]): boolean {
  for (const b of list) {
    if (a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1) return true;
  }
  return false;
}

// ─────────────────────────── Staging ("before → event → after") ───────────────────────────

const STAGE_KIND_ORDER = ['before', 'event', 'after'] as const;
/** An object brighter than the full Moon (this magnitude) is not lost in the Sun's glare, however close it stands. */
const GLARE_HIDES_FAINTER_THAN_MAG = -12;

/**
 * The note under the caption while the sky is held to the stars. The lab's supernova is narrated for the world it is
 * watched from, the archive's events for the Moon. Mars and the Moon are walked on their measured ground; the ground
 * of the other planets is a model.
 */
function heldSkyNote(lang: Lang, world: WorldId, labWatch: boolean): string {
  const name = WORLDS[world].name;
  if (!labWatch) {
    return world === 'mars'
      ? tx(
        lang,
        tpl`${name} üzerinden izliyorsunuz; anlatım Ay’dan görünen hâle göre yazılmıştır. Gökyüzü yıldızlara sabitlendi: gezegenin her dönüşünde tek kare gösterilir.`,
        tpl`Watching from ${name}; the narration was written for the view from the Moon. The sky is held to the stars: one frame is shown per rotation of the planet.`,
      )
      : tx(
        lang,
        tpl`${name} üzerinden izliyorsunuz; anlatım Ay’dan görünen hâle göre yazılmıştır. Gökyüzü yıldızlara sabitlendi: gezegenin her dönüşünde tek kare gösterilir. Zemin modeldir.`,
        tpl`Watching from ${name}; the narration was written for the view from the Moon. The sky is held to the stars: one frame is shown per rotation of the planet. The ground is a model.`,
      );
  }
  if (world === 'moon') {
    return tx(lang, 'Ay üzerinden izliyorsunuz. Gökyüzü yıldızlara sabitlendi: Ay’ın her dönüşünde tek kare gösterilir.', 'Watching from the Moon. The sky is held to the stars: one frame is shown per rotation of the Moon.');
  }
  return world === 'mars'
    ? tx(
      lang,
      tpl`${name} üzerinden izliyorsunuz. Gökyüzü yıldızlara sabitlendi: gezegenin her dönüşünde tek kare gösterilir.`,
      tpl`Watching from ${name}. The sky is held to the stars: one frame is shown per rotation of the planet.`,
    )
    : tx(
      lang,
      tpl`${name} üzerinden izliyorsunuz. Gökyüzü yıldızlara sabitlendi: gezegenin her dönüşünde tek kare gösterilir. Zemin modeldir.`,
      tpl`Watching from ${name}. The sky is held to the stars: one frame is shown per rotation of the planet. The ground is a model.`,
    );
}

function StagePanel() {
  const lang = useLang();
  const stage = useGame((s) => s.stage);
  const skyLocked = useGame((s) => s.skyLocked);
  const world = useGame((s) => s.world);
  const activeEventId = useGame((s) => s.activeEventId);
  const lockedTargets = useGame((s) => (s.skyLocked ? s.targets : null));
  const fadeRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let raf = 0;
    const loop = (): void => {
      if (fadeRef.current) fadeRef.current.style.opacity = String(frame.stageFade);
      if (barRef.current && stage) {
        const overall = stage.playing ? (stage.index + frame.stageProgress) / stage.steps.length : 1;
        barRef.current.style.width = `${Math.round(overall * 1000) / 10}%`;
      }
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [stage]);

  if (!stage) return null;
  const currentKind = stage.steps[stage.index]?.kind;
  const kinds = STAGE_KIND_ORDER.filter((k) => stage.steps.some((s) => s.kind === k));
  const currentRank = STAGE_KIND_ORDER.indexOf(currentKind ?? 'after');
  // Seen from another world, what the sequence is about may sit right beside the Sun.
  const focus = lockedTargets?.find((t) => t.id === stage.focusId && t.id !== 'sun');
  const sun = lockedTargets?.find((t) => t.id === 'sun');
  const rad = Math.PI / 180;
  const sunGapDeg = focus && sun
    ? Math.acos(Math.max(-1, Math.min(1,
      Math.sin(focus.elDeg * rad) * Math.sin(sun.elDeg * rad)
      + Math.cos(focus.elDeg * rad) * Math.cos(sun.elDeg * rad) * Math.cos((focus.azDeg - sun.azDeg) * rad),
    ))) / rad
    : null;

  const chips = (
    <div className="hud-stage-chips">
      {kinds.map((k, i) => {
        const first = stage.steps.findIndex((s) => s.kind === k);
        const rank = STAGE_KIND_ORDER.indexOf(k);
        const cls = !stage.playing ? '' : rank === currentRank ? 'is-on' : rank < currentRank ? 'is-done' : '';
        return (
          <React.Fragment key={k}>
            {i > 0 && <span className="hud-stage-arrow">→</span>}
            <button
              type="button"
              className={`hud-stage-chip is-${k} ${cls}`}
              title={tx(lang, 'Bu bölümden oynat', 'Play from this part')}
              onClick={() => game.replayStaging(first)}
            >
              {loc(stage.steps[first].label, lang)}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );

  return (
    <>
      <div ref={fadeRef} className="hud-stage-fade" />
      {/* Once the sequence has played, its parts stay within reach as a small row of buttons. */}
      {!stage.playing && <div className="hud-stage is-idle">{chips}</div>}
      {stage.playing && (
        <div className="hud-stage">
          <div className="hud-stage-row">
            {chips}
            <button type="button" className="hud-step-btn" onClick={() => game.skipStaging()}>
              {tx(lang, 'Atla', 'Skip')}
            </button>
          </div>
          <div className="hud-stage-caption">{loc(stage.caption, lang)}</div>
          {skyLocked && (
            <div className="hud-stage-note">
              {heldSkyNote(lang, world, activeEventId === LAB_WATCH_EVENT_ID)}
              {EVENTS.find((e) => e.id === activeEventId)?.seenFrom === 'earthMoon' && (
                <> {tx(lang, 'Bu dizilim Dünya ve Ay’a özgüdür; buradan açılar farklıdır.', 'This alignment is specific to Earth and the Moon; the angles are different from here.')}</>
              )}
              {focus && focus.magnitude >= GLARE_HIDES_FAINTER_THAN_MAG && sunGapDeg !== null && sunGapDeg < 20 && (
                <> {tx(
                  lang,
                  tpl`Buradan bakınca ${focus.name} Güneş’e yalnızca ${Math.round(sunGapDeg)}° uzakta; gündüz göğünde, Güneş’in parıltısı içinde kalır.`,
                  tpl`From here ${focus.name} is only ${Math.round(sunGapDeg)}° from the Sun and stays within its glare in the daytime sky.`,
                )}</>
              )}
            </div>
          )}
          <div className="hud-stage-track"><div ref={barRef} className="hud-stage-bar" /></div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────── Unified Bottom Time Dock ───────────────────────────

function TimeMachineBar() {
  const lang = useLang();
  const clock = useGame((s) => s.clock);
  const activeEventId = useGame((s) => s.activeEventId);
  const phase = useGame((s) => s.phase);
  const decY = Math.round(decimalYear(clock.jdTT));
  // In a narrow window the bar gives up, in turn: the year labels, the month step, the hour steps.
  const [barRef, tight] = useFit(3, `${lang}|${dictRevision()}|${activeEventId}|${clock.paused}`);
  const day = tx(lang, 'g', 'd');
  const hour = tx(lang, 'sa', 'h');

  // The first button stops the clock and starts it again at the rate it had; the others set a rate. On the
  // ground the keys 1 to 6 do the same, in this order.
  const rates: Array<{ label: string; title: string; rate: number }> = [
    clock.paused
      ? { label: tx(lang, 'Devam', 'Resume'), title: tx(lang, 'Saati aynı hızda yeniden çalıştırır', 'Starts the clock again at the same rate'), rate: 0 }
      : { label: tx(lang, 'Durdur', 'Pause'), title: tx(lang, 'Saati durdurur', 'Stops the clock'), rate: 0 },
    { label: '1×', title: tx(lang, 'Gerçek hız: saniyede 1 saniye', 'Real speed: 1 second each second'), rate: 1 },
    { label: tx(lang, '1dk', '1m'), title: tx(lang, 'Saniyede 1 dakika', '1 minute each second'), rate: 60 },
    { label: tx(lang, '1sa', '1h'), title: tx(lang, 'Saniyede 1 saat', '1 hour each second'), rate: 3600 },
    { label: tx(lang, '1g', '1d'), title: tx(lang, 'Saniyede 1 gün', '1 day each second'), rate: 86400 },
    { label: tx(lang, '10g', '10d'), title: tx(lang, 'Saniyede 10 gün', '10 days each second'), rate: 864000 },
  ];

  const stepDays = (days: number): void => game.setTime(clock.jdTT + days);

  return (
    <div className="hud-bottom-bar" ref={barRef}>
      <div className="hud-bar-fixed" style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: '#ffffff', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {formatDate(clock.jdTT, lang, { time: true, calendarTag: true })}
        </span>
        {tight < 1 && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.64rem', color: 'var(--c-dim)', whiteSpace: 'nowrap' }}>
            {tx(lang, 'M.Ö. 3000 – M.S. 2035', '3000 BC – 2035 AD')}
          </span>
        )}
      </div>

      <div className="hud-bar-fixed" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button type="button" className="hud-step-btn" title={tx(lang, '1 gün geri', 'Back 1 day')} onClick={() => stepDays(-1)}>−1{day}</button>
        {tight < 3 && (
          <button type="button" className="hud-step-btn" title={tx(lang, '1 saat geri', 'Back 1 hour')} onClick={() => stepDays(-1 / 24)}>−1{hour}</button>
        )}
      </div>

      <div className="hud-year-track">
        {tight < 1 && <span>{yearLabel(-2999, lang)}</span>}
        <input
          type="range"
          min={-2999}
          max={2035}
          step={1}
          value={Math.max(-2999, Math.min(2035, decY))}
          onChange={(e) => game.setTime(jdTTFromDecimalYear(Number(e.target.value)))}
          aria-label={tx(lang, 'Yıl', 'Year')}
        />
        {tight < 1 && <span>2035</span>}
      </div>

      <div className="hud-bar-fixed" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {tight < 3 && (
          <button type="button" className="hud-step-btn" title={tx(lang, '1 saat ileri', 'Forward 1 hour')} onClick={() => stepDays(1 / 24)}>+1{hour}</button>
        )}
        <button type="button" className="hud-step-btn" title={tx(lang, '1 gün ileri', 'Forward 1 day')} onClick={() => stepDays(1)}>+1{day}</button>
        {tight < 2 && (
          <button type="button" className="hud-step-btn" title={tx(lang, '1 yıldız ayı (27,3 gün)', '1 sidereal month (27.3 days)')} onClick={() => stepDays(27.321661)}>+{fmt(27.3, 1, lang)}{day}</button>
        )}
        {tight < 2 && (
          <button type="button" className="hud-step-btn" title={tx(lang, 'Saati şu ana getirir: gökyüzü şimdi nasılsa öyle', 'Sets the clock to this moment: the sky as it is right now')} onClick={() => game.setTime(jdTTNow())}>{tx(lang, 'Şimdi', 'Now')}</button>
        )}
      </div>

      <div className="mn-seg hud-bar-fixed" style={{ padding: 2 }}>
        {rates.map((r, i) => {
          const isAct = r.rate === 0 ? clock.paused : !clock.paused && clock.rate === r.rate;
          return (
            <button
              key={r.rate}
              type="button"
              className={`mn-seg-btn ${isAct ? 'is-active' : ''}`}
              style={{ padding: '4px 9px', fontSize: '0.73rem' }}
              title={phase === 'surface' ? `${r.title} [${i + 1}]` : r.title}
              onClick={() => {
                // Resuming leaves the rate alone: setting a rate ends a sequence that is playing.
                if (r.rate === 0) game.setPaused(!clock.paused);
                else {
                  game.setPaused(false);
                  game.setRate(r.rate);
                }
              }}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      {activeEventId && (
        <button
          type="button"
          className="hud-step-btn hud-bar-fixed"
          onClick={() => game.resetEventTime()}
          title={tx(lang, 'Olayı başından oynat [R]', 'Replay event [R]')}
        >
          ↺ {tx(lang, 'Baştan', 'Replay')}
        </button>
      )}
    </div>
  );
}

// ─────────────────────────── Shared Modals ───────────────────────────

function AssetCardModal() {
  const lang = useLang();
  const focusAssetId = useGame((s) => s.focusAssetId);
  const asset = SURFACE_ASSETS.find((a) => a.id === focusAssetId);
  const dialog = useDialog(asset !== undefined);
  if (!asset) return null;

  return (
    <div className="mn-modal-backdrop" onClick={() => setGame({ focusAssetId: null })}>
      <div className="mn-modal" ref={dialog} role="dialog" aria-modal="true" aria-label={loc(asset.name, lang)} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="mn-modal-head">
          <div>
            <div className="mn-brand-tag">
              {/* Most mission labels already name the agency ("Apollo 11 (NASA)"). */}
              {loc(asset.mission, lang).includes(asset.agency) ? loc(asset.mission, lang) : `${loc(asset.mission, lang)} · ${asset.agency}`}
            </div>
            <h2 className="mn-modal-title">{loc(asset.name, lang)}</h2>
          </div>
          <button type="button" className="mn-btn" onClick={() => setGame({ focusAssetId: null })}>
            {tx(lang, 'Kapat [Esc]', 'Close [Esc]')}
          </button>
        </div>

        <div className="mn-badge-row">
          <span className={`mn-badge ${asset.stillActive ? 'ok' : 'warn'}`}>{loc(asset.status, lang)}</span>
          <span className="mn-badge">
            {/* An orbiter has no place on the ground to give the latitude and longitude of. */}
            {asset.kind === 'orbiter'
              ? tx(lang, 'Yörünge aracı · yüzeye inmedi', 'Orbiter · did not land')
              : `${fmt(asset.latDeg, 2, lang)}°, ${fmt(asset.lonDeg, 2, lang)}°`}
          </span>
        </div>

        {asset.history.map((p) => (
          <p key={p.en} style={{ margin: 0, lineHeight: 1.55, fontSize: '0.92rem', color: '#e2e8f0' }}>
            {loc(p, lang)}
          </p>
        ))}

        <div style={{ borderTop: '1px solid var(--c-line-soft)', paddingTop: 10 }}>
          <div className="mn-section-label" style={{ marginBottom: 6 }}>
            {tx(lang, 'Kısa bilgiler', 'Key facts')}
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.84rem', lineHeight: 1.5, color: 'var(--c-dim)' }}>
            {asset.facts.map((f) => <li key={f.en}>{loc(f, lang)}</li>)}
          </ul>
        </div>

        {asset.topicId && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="mn-btn mn-btn-primary"
              onClick={() => {
                setGame({ focusAssetId: null });
                game.openArchive(asset.topicId);
              }}
            >
              {tx(lang, 'NASA görsellerini aç', 'Open NASA images')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AboutEventModal() {
  const lang = useLang();
  const open = useGame((s) => s.panels.about);
  const activeEventId = useGame((s) => s.activeEventId);
  const ev = EVENTS.find((e) => e.id === activeEventId);
  const dialog = useDialog(open && ev !== undefined);
  if (!open || !ev) return null;

  return (
    <div className="mn-modal-backdrop" onClick={() => game.togglePanel('about', false)}>
      <div className="mn-modal" ref={dialog} role="dialog" aria-modal="true" aria-label={loc(ev.title, lang)} tabIndex={-1} style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
        <div className="mn-modal-head">
          <div>
            <div className="mn-brand-tag" style={{ color: ev.accent }}>{loc(ev.dateLabel, lang)}</div>
            <h2 className="mn-modal-title">{loc(ev.title, lang)}</h2>
          </div>
          <button type="button" className="mn-btn" onClick={() => game.togglePanel('about', false)}>
            {tx(lang, 'Kapat [Esc]', 'Close [Esc]')}
          </button>
        </div>

        {ev.about.map((p) => (
          <p key={p.en} style={{ margin: 0, lineHeight: 1.6, fontSize: '0.94rem', color: '#e2e8f0' }}>
            {loc(p, lang)}
          </p>
        ))}

        <div style={{ borderTop: '1px solid var(--c-line-soft)', paddingTop: 10 }}>
          <div className="mn-section-label" style={{ marginBottom: 6 }}>
            {tx(lang, 'Ne gerçek, ne model?', 'What is real and what is a model?')}
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.84rem', lineHeight: 1.5, color: 'var(--c-dim)' }}>
            {ev.notes.map((n) => <li key={n.en}>{loc(n, lang)}</li>)}
          </ul>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="mn-btn mn-btn-primary"
            onClick={() => {
              game.togglePanel('about', false);
              game.openArchive(ev.infoTopicIds[0]);
            }}
          >
            {tx(lang, 'NASA görsellerini aç', 'Open NASA images')}
          </button>
        </div>
      </div>
    </div>
  );
}

const ARCHIVE_GROUPS: Array<{ id: 'all' | 'events' | 'worlds' | 'rovers'; label: L10n; ids?: string[] }> = [
  { id: 'all', label: { tr: 'Tümü', en: 'All' } },
  {
    id: 'events',
    label: { tr: 'Olaylar ve Gökyüzü', en: 'Events & Sky' },
    ids: ['apollo11', 'lrrr', 'apollo_seismic', 'moon', 'earth_from_moon', 'shackleton', 'artemis', 'eclipse_2026', 'solar_storm', 'sn1054', 'sn1006', 'sn1572', 'casA', 'grb', 'comet', 'halley', 'conjunction', 'planets'],
  },
  {
    id: 'worlds',
    label: { tr: 'Gezegenler & Galaksiler', en: 'Planets & Galaxies' },
    ids: ['mercury', 'venus', 'mars_global', 'mars_2003', 'mars_dust_2018', 'jupiter', 'saturn', 'uranus', 'neptune', 'm31', 'm33', 'm51', 'm104', 'm87', 'magellanic'],
  },
  {
    id: 'rovers',
    label: { tr: 'Mars Araçları', en: 'Mars Spacecraft' },
    ids: ['perseverance', 'ingenuity', 'curiosity', 'insight', 'opportunity', 'spirit', 'viking', 'pathfinder', 'phoenix', 'mgs'],
  },
];

function cleanText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function InfoCentreModal() {
  const lang = useLang();
  const open = useGame((s) => s.panels.info);
  const infoTopicId = useGame((s) => s.infoTopicId);
  const activeEventId = useGame((s) => s.activeEventId);
  const spaceTargetId = useGame((s) => s.spaceView?.targetId ?? null);
  const stageWhere = useGame((s) => s.stage?.where ?? null);
  const world = useGame((s) => s.world);
  const siteId = useGame((s) => s.site?.id ?? null);
  const labKind = useGame((s) => s.lab?.kind ?? null);
  const labReturn = useGame((s) => s.labReturn);
  const [showAllTopics, setShowAllTopics] = useState(false);
  const [group, setGroup] = useState<'all' | 'events' | 'worlds' | 'rovers'>('all');

  // Without a topic asked for, the archive shows the one that belongs to where it is opened: the subject of
  // the close-up view, the event, the lab's explosion (also while it is watched from the ground), the place.
  const watchedKind = labReturn !== null && spaceTargetId === null ? parseLabLink(`?${labReturn}`)?.kind ?? null : null;
  const here = archiveTopicAt({
    spaceTargetId: spaceTargetId === 'lab' ? null : spaceTargetId,
    eventId: activeEventId,
    stagedHere: stageWhere !== null && stageWhere === spaceTargetId,
    labKind: labKind ?? watchedKind,
    world,
    siteId,
  });
  const currentTopicId = infoTopicId && infoTopicId in INFO_TOPICS ? infoTopicId : here;

  const activeEvent = EVENTS.find((e) => e.id === activeEventId);
  // The topics offered: the event's, or a group's; the one being shown leads when it is not among them.
  const topicIds = useMemo(() => {
    if (!showAllTopics && activeEvent) {
      return activeEvent.infoTopicIds.includes(currentTopicId) ? activeEvent.infoTopicIds : [currentTopicId, ...activeEvent.infoTopicIds];
    }
    const grp = ARCHIVE_GROUPS.find((g) => g.id === group);
    if (!grp?.ids) return Object.keys(INFO_TOPICS);
    const filtered = grp.ids.filter((id) => id in INFO_TOPICS);
    return filtered.includes(currentTopicId) ? filtered : [currentTopicId, ...filtered];
  }, [activeEvent, currentTopicId, showAllTopics, group]);

  const [topicData, setTopicData] = useState<NasaTopicResult | null>(null);
  const [donkiData, setDonkiData] = useState<DonkiResult | null>(null);
  const [selectedImg, setSelectedImg] = useState<NasaImage | null>(null);

  // Every opening starts from the topics of the place, not from the list that was browsed last time.
  useEffect(() => {
    if (!open) return;
    setShowAllTopics(false);
    setGroup('all');
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    // The pictures of the topic before must not stand under the new title, nor arrive late and replace it.
    let wanted = true;
    setSelectedImg(null);
    setTopicData(null);
    // The pictures that came with the app show at once; those fetched from NASA replace them when they arrive.
    const show = (data: NasaTopicResult): void => {
      if (wanted) setTopicData(data);
    };
    nasaClient.getTopic(currentTopicId, show).then(show).catch(() => undefined);
    if (currentTopicId === 'solar_storm') {
      nasaClient.donki('2024-05-07', '2024-05-15')
        .then((data) => {
          if (wanted) setDonkiData(data);
        })
        .catch(() => undefined);
    }
    return () => {
      wanted = false;
    };
  }, [open, currentTopicId]);

  const dialog = useDialog(open);
  if (!open) return null;
  const meta = INFO_TOPICS[currentTopicId];

  return (
    <div className="mn-modal-backdrop" onClick={() => game.togglePanel('info', false)}>
      <div className="mn-modal" ref={dialog} role="dialog" aria-modal="true" aria-label={tx(lang, 'NASA Görsel ve Veri Arşivi', 'NASA Image and Data Archive')} tabIndex={-1} style={{ width: 'min(960px, 95vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="mn-modal-head">
          <div>
            <div className="mn-brand-tag">
              {tx(lang, 'NASA Görsel ve Veri Arşivi', 'NASA Image and Data Archive')}
              {topicData && (
                <span className={`mn-badge ${topicData.source === 'live' ? 'ok' : 'warn'}`} style={{ marginLeft: 10 }}>
                  {topicData.source === 'live'
                    ? (tx(lang, 'NASA ARŞİVİ · ÇEVRİMİÇİ SORGU', 'NASA ARCHIVE · ONLINE QUERY'))
                    : (tx(lang, 'GÖMÜLÜ ARŞİV KOPYASI', 'BUNDLED ARCHIVE COPY'))}
                </span>
              )}
            </div>
            <h2 className="mn-modal-title">{meta ? loc(meta.title, lang) : currentTopicId}</h2>
          </div>
          <button type="button" className="mn-btn" onClick={() => game.togglePanel('info', false)}>
            {tx(lang, 'Kapat [Esc]', 'Close [Esc]')}
          </button>
        </div>

        {activeEvent && !showAllTopics ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {topicIds.map((tid) => (
              <button
                key={tid}
                type="button"
                className={`mn-seg-btn ${tid === currentTopicId ? 'is-active' : ''}`}
                style={{ border: '1px solid var(--c-line-soft)' }}
                onClick={() => setGame({ infoTopicId: tid })}
              >
                {INFO_TOPICS[tid] ? loc(INFO_TOPICS[tid].title, lang) : tid}
              </button>
            ))}
            <button
              type="button"
              className="mn-seg-btn"
              style={{ border: '1px solid var(--c-line-soft)' }}
              onClick={() => setShowAllTopics(true)}
            >
              {tx(lang, tpl`Tüm konular (${Object.keys(INFO_TOPICS).length}) ▾`, tpl`All topics (${Object.keys(INFO_TOPICS).length}) ▾`)}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="mn-seg" style={{ padding: 2 }}>
              {ARCHIVE_GROUPS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={`mn-seg-btn ${group === g.id ? 'is-active' : ''}`}
                  style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                  onClick={() => {
                    setGroup(g.id);
                    if (g.ids && g.ids[0] && !g.ids.includes(currentTopicId)) {
                      setGame({ infoTopicId: g.ids[0] });
                    }
                  }}
                >
                  {loc(g.label, lang)}
                </button>
              ))}
            </div>
            <select
              className="hud-bar-select"
              value={currentTopicId}
              aria-label={tx(lang, 'Konu seç', 'Select topic')}
              onChange={(e) => setGame({ infoTopicId: e.target.value })}
              style={{ minWidth: 230, maxWidth: '100%' }}
            >
              {topicIds.map((tid) => (
                <option key={tid} value={tid}>{INFO_TOPICS[tid] ? loc(INFO_TOPICS[tid].title, lang) : tid}</option>
              ))}
            </select>
          </div>
        )}

        {meta && (
          <p style={{ margin: 0, fontSize: '0.88rem', lineHeight: 1.5, color: 'var(--c-dim)' }}>
            {loc(meta.blurb, lang)}
          </p>
        )}

        {selectedImg ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'rgba(6,10,18,0.8)', padding: 14, borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <strong>{cleanText(selectedImg.title)} ({selectedImg.date})</strong>
              <button type="button" className="mn-btn" style={{ flexShrink: 0 }} onClick={() => setSelectedImg(null)}>
                {tx(lang, '← Görsellere dön', '← Back to the images')}
              </button>
            </div>
            <img
              src={selectedImg.imageUrl}
              alt={cleanText(selectedImg.title)}
              onError={(e) => {
                if (e.currentTarget.src !== selectedImg.thumbUrl) {
                  e.currentTarget.src = selectedImg.thumbUrl;
                }
              }}
              style={{ maxHeight: '46vh', objectFit: 'contain', borderRadius: 6 }}
            />
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--c-dim)', lineHeight: 1.45 }}>
              {cleanText(selectedImg.description)}
            </p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
              <span>{tx(lang, 'Kaynak:', 'Credit:')} {cleanText(selectedImg.credit)} ({selectedImg.nasaId})</span>
              <a
                href={selectedImg.pageUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--c-accent)', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                images.nasa.gov ↗
              </a>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {(topicData?.images ?? []).map((img) => (
              <button key={img.nasaId} type="button" className="mn-card" style={{ padding: 8 }} onClick={() => setSelectedImg(img)}>
                <img
                  src={img.thumbUrl}
                  alt={cleanText(img.title)}
                  loading="lazy"
                  onError={(e) => {
                    if (e.currentTarget.src !== img.imageUrl) e.currentTarget.src = img.imageUrl;
                  }}
                  style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 6 }}
                />
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#f8fafc', marginTop: 4 }}>{cleanText(img.title).slice(0, 65)}</div>
                <div style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: 'var(--c-dim)' }}>{img.date} · {img.nasaId}</div>
              </button>
            ))}
          </div>
        )}

        {currentTopicId === 'solar_storm' && donkiData && (
          <div style={{ borderTop: '1px solid var(--c-line-soft)', paddingTop: 10 }}>
            <div className="mn-section-label" style={{ marginBottom: 6 }}>
              NASA CCMC DONKI — {tx(lang, 'Mayıs 2024 Güneş Fırtınası Kayıtları', 'May 2024 Solar Storm Records')}
            </div>
            <div style={{ maxHeight: 170, overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.74rem' }}>
              {donkiData.events.slice(0, 15).map((ev) => (
                <div key={ev.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--c-line-soft)' }}>
                  <span style={{ color: 'var(--c-accent)' }}>{ev.type} · {ev.time.slice(0, 16)}</span>
                  <span>
                    {ev.type === 'CME' && `${ev.speedKmS} km/s (±${ev.halfAngleDeg}°)`}
                    {ev.type === 'GST' && (ev.kp === undefined ? tx(lang, 'Kp bildirilmedi', 'Kp not reported') : `Kp = ${ev.kp}`)}
                    {ev.type === 'FLR' && ev.classType !== undefined && tx(lang, tpl`${ev.classType} sınıfı`, tpl`Class ${ev.classType}`)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────── SurfaceHud ───────────────────────────

/** The arrows of the on-screen pad: the key each one presses and where it sits in the pad's grid. */
const PAD_ARROWS: Array<{ code: string; glyph: string; cell: string; label: L10n }> = [
  { code: 'KeyW', glyph: '▲', cell: 'up', label: { tr: 'İleri', en: 'Forward' } },
  { code: 'KeyA', glyph: '◀', cell: 'left', label: { tr: 'Sola', en: 'Left' } },
  { code: 'KeyS', glyph: '▼', cell: 'down', label: { tr: 'Geri', en: 'Backward' } },
  { code: 'KeyD', glyph: '▶', cell: 'right', label: { tr: 'Sağa', en: 'Right' } },
];

/** One key of the pad: held for as long as the finger that pressed it stays down, wherever it slides. */
function PadKey({ code, cell, label, children }: { code: string; cell: string; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={`hud-pad-key is-${cell}`}
      aria-label={label}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        game.pressKey(code, true);
      }}
      onPointerUp={() => game.pressKey(code, false)}
      onPointerCancel={() => game.pressKey(code, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

/**
 * Walking on a touch screen: arrows that press W A S D and a button for Space; where there is no ground to
 * stand on, Space rises and a second button (Q) descends.
 */
function TouchPad({ zeroG, lang }: { zeroG: boolean; lang: Lang }) {
  return (
    <div className="hud-touchpad">
      {PAD_ARROWS.map((a) => (
        <PadKey key={a.code} code={a.code} cell={a.cell} label={loc(a.label, lang)}>{a.glyph}</PadKey>
      ))}
      <PadKey code="Space" cell="act" label={zeroG ? tx(lang, 'Yüksel', 'Rise') : tx(lang, 'Zıpla', 'Jump')}>
        {zeroG ? tx(lang, 'Yüksel', 'Rise') : tx(lang, 'Zıpla', 'Jump')}
      </PadKey>
      {zeroG && (
        <PadKey code="KeyQ" cell="act2" label={tx(lang, 'Alçal', 'Descend')}>{tx(lang, 'Alçal', 'Descend')}</PadKey>
      )}
    </div>
  );
}

export function SurfaceHud() {
  const lang = useLang();
  const world = useGame((s) => s.world);
  const site = useGame((s) => s.site);
  const activeEventId = useGame((s) => s.activeEventId);
  const telemetry = useGame((s) => s.telemetry);
  const targets = useGame((s) => s.targets);
  const reticleId = useGame((s) => s.reticleId);
  const telescope = useGame((s) => s.telescope);
  const viewMode = useGame((s) => s.viewMode);
  const panels = useGame((s) => s.panels);
  const subtitle = useGame((s) => s.subtitle);
  const toast = useGame((s) => s.toast);
  const lightReading = useGame((s) => s.lightReading);
  const headlamp = useGame((s) => s.headlamp);
  const stage = useGame((s) => s.stage);
  const spectator = useGame((s) => s.spectator);
  const cleanMode = useGame((s) => s.cleanMode);
  const labReturn = useGame((s) => s.labReturn);
  const showLabels = useGame((s) => s.settings.showLabels);
  const showGuide = useGame((s) => s.settings.showConstellations);
  const soundOn = useGame((s) => s.settings.soundOn);
  const touchInput = useGame((s) => s.touchInput);

  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  // The ⋯ menu closes on a press outside it and on Escape. Escape is taken on its way down to the page and
  // stopped there: the engine's key handler does not see it and so does not open the pause menu as well.
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onPress = (e: PointerEvent): void => {
      if (!moreRef.current?.contains(e.target as Node | null)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'Escape') return;
      e.stopPropagation();
      setMoreOpen(false);
    };
    window.addEventListener('pointerdown', onPress, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPress, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [moreOpen]);
  const worldInfo = WORLDS[world];
  // The top bar, left to right: where you are (menu, world, place), the compass, what you look with
  // (telescope, sky guide), what you read (data, archive), and ⋯ for the rest. Buttons that do not fit move
  // into the ⋯ menu, least needed first.
  const [topRef, tight] = useFit(3, `${lang}|${dictRevision()}|${site?.id}|${activeEventId}|${world}|${telescope.active}|${labReturn !== null}`);
  const barActions: Array<{ id: string; group: 'look' | 'read'; label: string; hotkey: string; on: boolean; dropAt: number; run: () => void }> = [
    { id: 'guide', group: 'look', label: tx(lang, 'Gökyüzü rehberi', 'Sky guide'), hotkey: 'C', on: showGuide, dropAt: 2, run: () => game.updateSettings({ showConstellations: !showGuide }) },
    { id: 'data', group: 'read', label: tx(lang, 'Veriler', 'Data'), hotkey: 'N', on: panels.telemetry, dropAt: 3, run: () => game.togglePanel('telemetry') },
    { id: 'archive', group: 'read', label: tx(lang, 'Arşiv', 'Archive'), hotkey: 'I', on: panels.info, dropAt: 1, run: () => (panels.info ? game.togglePanel('info', false) : game.openArchive()) },
  ];
  const shownActions = barActions.filter((a) => tight < a.dropAt);

  const activeEvent = EVENTS.find((e) => e.id === activeEventId);
  const eventBody = activeEvent ? EVENT_BODY[activeEvent.seenFrom] : undefined;
  const nextEvent = activeEvent ? EVENTS.find((e) => e.order === activeEvent.order + 1) : undefined;

  async function handleTakePhoto(kind: '4k' | '8k'): Promise<void> {
    downloadBlob(await game.capture(kind), `lunar-timewalker-${kind}-${Date.now()}.png`);
  }

  const reticleTarget = reticleId ? targets.find((t) => t.id === reticleId) : undefined;
  const visibleQuickTargets = targets.filter((t) => t.visible && (t.kind !== 'galaxy' || t.id === 'm31' || t.id === 'lmc'));
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 720;
  const occupied: Box2D[] = [
    { x1: 0, y1: 0, x2: vw, y2: 56 },
    { x1: 0, y1: vh - 68, x2: vw, y2: vh },
  ];
  if (activeEvent) occupied.push({ x1: 8, y1: 52, x2: Math.min(296, vw * 0.24), y2: 310 });
  if (panels.telemetry && telemetry) occupied.push({ x1: vw - Math.min(310, vw * 0.25), y1: 52, x2: vw, y2: Math.min(vh - 70, 560) });
  if (stage?.playing) occupied.push({ x1: vw * 0.5 - 265, y1: 52, x2: vw * 0.5 + 265, y2: 190 });
  else if (stage) occupied.push({ x1: vw * 0.5 - 150, y1: 52, x2: vw * 0.5 + 150, y2: 94 });
  // The name of what is under the crosshair hangs just below it. Under the telescope the object fills the
  // middle of the view, so the name moves down to the rim of the clear field, or as far as it can go and
  // still stay above the strip where subtitles and messages appear.
  const reticleTop = telescope.active
    ? Math.max(vh / 2 + 26, Math.min(vh / 2 + SCOPE_CLEAR * Math.hypot(vw, vh) / 2, vh - 206))
    : vh / 2 + 26;
  if (reticleId) {
    occupied.push({ x1: vw * 0.5 - 150, y1: vh * 0.5 - 24, x2: vw * 0.5 + 150, y2: vh * 0.5 + 26 });
    occupied.push({ x1: vw * 0.5 - 150, y1: reticleTop, x2: vw * 0.5 + 150, y2: reticleTop + 69 });
  }

  const targetRank = new Map<string, number>();
  for (const t of targets) {
    const base = t.kind === 'sun' ? -40 : t.kind === 'earth' || t.id === 'moon' ? -30 : t.kind === 'supernova' || t.kind === 'comet' ? -20 : 0;
    targetRank.set(t.id, base + t.magnitude);
  }
  const sortedPins = [...frame.projections]
    .filter((p) => p.inFront && p.x >= 0.04 && p.x <= 0.96 && p.y >= 0.08 && p.y <= 0.88 && p.id !== reticleId && (!stage?.playing || p.id === stage.focusId))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'artifact' ? -1 : 1;
      if (a.kind === 'artifact') return a.distanceM - b.distanceM;
      return (targetRank.get(a.id) ?? 50) - (targetRank.get(b.id) ?? 50);
    })
    .slice(0, 14);

  const placedPins = sortedPins.map((p) => {
    const named = p.kind === 'sky' || p.distanceM < 24;
    const labelText = named
      ? `${resolveTargetName(p.id, lang)}${p.kind === 'artifact' && p.distanceM > 0 ? ` · ${Math.round(p.distanceM)} m` : ''}`
      : '';
    let offsetY = 0;
    let labelBox: Box2D | null = null;
    if (labelText && showLabels) {
      const px = p.x * vw;
      const py = p.y * vh;
      const halfW = Math.max(32, labelText.length * 3.8 + 10);
      // A name that would cross a side of the window slides inward; its pin stays on the object.
      const cx = px + Math.max(LABEL_EDGE_PX + halfW - px, Math.min(0, vw - LABEL_EDGE_PX - halfW - px));
      for (const dy of [0, -22, 22, -42, 42]) {
        const box: Box2D = { x1: cx - halfW, y1: py + dy - 4, x2: cx + halfW, y2: py + dy + 22 };
        if (!overlapsBox(box, occupied)) {
          occupied.push(box);
          offsetY = dy;
          labelBox = box;
          break;
        }
      }
    }
    return { p, labelText, offsetY, labelBox };
  });
  // The engine treats a click on one of these names as a click on the object itself.
  frame.labelBoxes = cleanMode
    ? []
    : placedPins.flatMap(({ p, labelBox }) => (labelBox ? [{ id: p.id, ...labelBox }] : []));

  const placedStars = frame.starLabels.filter((s) => {
    const sx = s.x * vw;
    const sy = s.y * vh;
    const halfW = Math.max(28, s.name.length * 3.7 + 8);
    const box: Box2D = { x1: sx - halfW, y1: sy - 24, x2: sx + halfW, y2: sy - 2 };
    if (overlapsBox(box, occupied)) return false;
    occupied.push(box);
    return true;
  });
  return (
    <div className={`hud-root ${stage?.playing ? 'is-cinematic' : ''} ${spectator ? 'is-spectator' : ''} ${cleanMode ? 'is-clean' : ''}`}>
      {telescope.active && <div className="hud-scope-mask" />}
      <StagePanel />

      {/* Top Unified Observatory Bar */}
      <div className="hud-topbar" ref={topRef}>
        <div className="hud-bar-group">
          <button type="button" className="hud-bar-btn" onClick={() => game.openMenu()}>
            ← {tx(lang, 'Ana menü', 'Menu')}
          </button>
          {labReturn !== null && (
            <button type="button" className="hud-bar-btn is-amber" onClick={() => game.returnToLab()}>
              {tx(lang, '← Laboratuvara dön', '← Back to the lab')}
            </button>
          )}
          <span className="hud-divider" />
          <select
            className="hud-bar-select"
            value={world}
            aria-label={tx(lang, 'Ortam / Çekim', 'World / Gravity')}
            // On the Moon or on Mars during an event that happens there no other world can be chosen; from
            // another world the list stays open, since it is the way back.
            disabled={eventBody !== undefined && eventBody === world}
            title={eventBody ? loc(ONLY_FROM_BODY[eventBody], lang) : undefined}
            onChange={(e) => game.setWorld(e.target.value as WorldId)}
          >
            {WORLD_ORDER.map((wid) => {
              const w = WORLDS[wid];
              return (
                <option key={wid} value={wid}>
                  {loc(w.name, lang)} ({w.zeroG ? '0g' : `${fmt(w.gravityMs2, 2, lang)} m/s²`})
                </option>
              );
            })}
          </select>
          <button type="button" className="hud-bar-btn" onClick={() => game.openMap()}>
            {/* A place belongs to the Moon or to Mars; on a world that only borrows its ground the button opens the map. */}
            {site && (site.body ?? 'moon') === world ? loc(site.name, lang).split(' (')[0] : tx(lang, 'Harita', 'Map')} [M]
          </button>
        </div>

        <Compass targets={targets} primaryId={activeEvent?.primaryTargetId} lang={lang} />

        <div className="hud-bar-group">
          <button
            type="button"
            className={`hud-bar-btn ${telescope.active ? 'is-on' : ''}`}
            onClick={() => game.setTelescope(!telescope.active)}
          >
            {telescope.active
              ? tx(lang, tpl`Teleskop ${fmt(telescope.fovDeg, 1, lang)}° [T]`, tpl`Telescope ${fmt(telescope.fovDeg, 1, lang)}° [T]`)
              : tx(lang, 'Teleskop [T]', 'Telescope [T]')}
          </button>
          {shownActions.filter((a) => a.group === 'look').map((a) => (
            <button key={a.id} type="button" className={`hud-bar-btn ${a.on ? 'is-on' : ''}`} onClick={a.run}>
              {a.label} [{a.hotkey}]
            </button>
          ))}
          {shownActions.some((a) => a.group === 'read') && <span className="hud-divider" />}
          {shownActions.filter((a) => a.group === 'read').map((a) => (
            <button key={a.id} type="button" className={`hud-bar-btn ${a.on ? 'is-on' : ''}`} onClick={a.run}>
              {a.label} [{a.hotkey}]
            </button>
          ))}
          <span className="hud-divider" />

          <div className="hud-more-wrap" ref={moreRef}>
            <button type="button" className="hud-bar-btn" aria-label={tx(lang, 'Diğer seçenekler', 'More options')} onClick={() => setMoreOpen((v) => !v)}>
              ⋯
            </button>
            {moreOpen && (
              <div className="hud-more-menu" onClick={() => setMoreOpen(false)}>
                {barActions.filter((a) => tight >= a.dropAt).map((a) => (
                  <button key={a.id} type="button" className={`hud-bar-btn ${a.on ? 'is-on' : ''}`} onClick={a.run}>
                    <span>{a.label}</span>
                    <span>{a.hotkey}</span>
                  </button>
                ))}
                <button type="button" className="hud-bar-btn" onClick={() => game.setViewMode(viewMode === 'first' ? 'third' : 'first')}>
                  <span>{viewMode === 'first' ? (tx(lang, 'Dışarıdan bak', '3rd person')) : (tx(lang, 'Kask içinden bak', '1st person'))}</span>
                  <span>V</span>
                </button>
                <button type="button" className={`hud-bar-btn ${headlamp ? 'is-on' : ''}`} onClick={() => setGame({ headlamp: !headlamp })}>
                  <span>{tx(lang, 'Kask lambası', 'Helmet lamp')}</span>
                  <span>G</span>
                </button>
                <button type="button" className={`hud-bar-btn ${soundOn ? 'is-on' : ''}`} onClick={() => game.updateSettings({ soundOn: !soundOn })}>
                  <span>{tx(lang, 'Ses', 'Sound')}</span>
                  <span>K</span>
                </button>
                <button type="button" className="hud-bar-btn" onClick={() => game.toggleCleanMode(true)}>
                  <span>{tx(lang, 'Temiz ekran', 'Clean view')}</span>
                  <span>U</span>
                </button>
                <button type="button" className="hud-bar-btn" onClick={() => { handleTakePhoto('4k').catch(() => undefined); }}>
                  <span>{tx(lang, '4K fotoğraf', '4K photo')}</span>
                  <span>3840×2160</span>
                </button>
                <button type="button" className="hud-bar-btn" onClick={() => { handleTakePhoto('8k').catch(() => undefined); }}>
                  <span>{tx(lang, '8K fotoğraf', '8K photo')}</span>
                  <span>P</span>
                </button>
                <button type="button" className="hud-bar-btn" onClick={() => game.togglePanel('help', true)}>
                  <span>{tx(lang, 'Kontroller', 'Controls')}</span>
                  <span>H</span>
                </button>
                <button type="button" className="hud-bar-btn" onClick={() => game.requestPointerLock()}>
                  <span>{tx(lang, 'Fare kilidi', 'Mouse lock')}</span>
                  <span>Tab</span>
                </button>
                <div className="hud-more-row">
                  <span>{tx(lang, 'Dil', 'Language')}</span>
                  <LangPicker />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {toast && <div className={`hud-toast is-${toast.kind}`}>{loc(toast.text, lang)}</div>}

      {touchInput && !spectator && !cleanMode && <TouchPad zeroG={WORLDS[world].zeroG ?? false} lang={lang} />}

      {/* Minimal Crosshair (no scan box) */}
      <div className="hud-crosshair">
        <svg width="26" height="26" viewBox="0 0 26 26">
          <circle cx="13" cy="13" r="9" fill="none" stroke="rgba(125,211,252,0.35)" strokeWidth="1" />
          <circle cx="13" cy="13" r="1.8" fill="#7dd3fc" />
        </svg>
      </div>

      {reticleId && (
        <div className="hud-reticle-label" style={telescope.active ? { top: reticleTop } : undefined}>
          <div style={{ fontSize: '0.88rem', fontWeight: 700 }}>{resolveTargetName(reticleId, lang)}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--c-accent)' }}>
            {tx(lang, '[E] Bilgi', '[E] Info')}
            {reticleTarget?.hasSpaceView && (
              <span> · {tx(lang, '[Tıkla] Yakın görünüm', '[Click] Close-up')}</span>
            )}
          </div>
          {reticleTarget?.lightTimeSec !== undefined && reticleTarget.lightTimeSec > 2 && (
            <div style={{ fontSize: '0.68rem', color: 'var(--c-dim)' }}>
              {tx(lang, tpl`Işığın geliş süresi: ${fmt(reticleTarget.lightTimeSec / 60, 1, lang)} dk`, tpl`Light travel time: ${fmt(reticleTarget.lightTimeSec / 60, 1, lang)} min`)}
            </div>
          )}
        </div>
      )}

      {/* Borderless Target Labels with 2D de-overlap */}
      {showLabels && placedPins.map(({ p, labelText, offsetY, labelBox }) => (
        <div
          key={`${p.kind}-${p.id}`}
          className={`hud-sky-pin ${p.kind === 'artifact' ? 'is-artifact' : ''}`}
          style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
        >
          <div className="hud-sky-dot" />
          {labelBox && (
            <span
              className="hud-sky-name"
              // The same slide as the label's box above, from the name's real width (50% is half of it).
              style={{ transform: `translate(clamp(calc(50% + ${LABEL_EDGE_PX - p.x * vw}px), 0px, calc(${vw - LABEL_EDGE_PX - p.x * vw}px - 50%)), ${offsetY}px)` }}
            >
              {labelText}
            </span>
          )}
        </div>
      ))}

      {/* Bright Star Names when Sky Guide [C] is on (de-overlapped against sky pins and panels) */}
      {placedStars.map((s) => (
        <span key={s.id} className="hud-star-label" style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%` }}>
          {s.name}
        </span>
      ))}
      {/* Left Event Card (only when an event is active) */}
      {activeEvent && (
        <div className="hud-left-col">
          <div className="hud-card" style={{ borderLeft: `3px solid ${activeEvent.accent}` }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: activeEvent.accent, marginBottom: 4 }}>
              {loc(activeEvent.dateLabel, lang)}
            </div>
            <div className="hud-card-title" style={{ marginBottom: 4 }}>
              <span>{loc(activeEvent.title, lang)}</span>
            </div>
            <p style={{ margin: 0, fontSize: '0.79rem', lineHeight: 1.45, color: 'var(--c-dim)' }}>
              {loc(activeEvent.summary, lang)}
            </p>
            <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {activeEvent.primaryTargetId && targets.some((t) => t.id === activeEvent.primaryTargetId && t.hasSpaceView) && (
                <button type="button" className="mn-btn mn-btn-amber" style={{ padding: '5px 10px', fontSize: '0.74rem' }} onClick={() => game.enterSpaceView(activeEvent.primaryTargetId!)}>
                  {tx(lang, 'Yakın görünüm →', 'Close-up →')}
                </button>
              )}
              <button type="button" className="mn-btn mn-btn-primary" style={{ padding: '5px 10px', fontSize: '0.74rem' }} onClick={() => game.togglePanel('about', true)}>
                {tx(lang, 'Hakkında', 'About')}
              </button>
              <button type="button" className="mn-btn" style={{ padding: '5px 10px', fontSize: '0.74rem' }} onClick={() => game.resetEventTime()}>
                ↺ {tx(lang, 'Tekrar', 'Replay')}
              </button>
              {nextEvent && (
                <button type="button" className="mn-btn" style={{ padding: '5px 10px', fontSize: '0.74rem' }} onClick={() => game.selectEvent(nextEvent.id)}>
                  {tx(lang, 'Sonraki →', 'Next →')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Right Inspector Drawer */}
      {panels.telemetry && telemetry && (
        <div className="hud-right-col">
          <div className="hud-card hud-telemetry">
            <div className="hud-card-title" style={{ marginBottom: 2 }}>
              <span>{loc(worldInfo.name, lang)}</span>
              <span className="mn-badge ok">
                {telemetry.accuracy === 'high'
                  ? (tx(lang, 'DE441 ≤0,01°', 'DE441 ≤0.01°'))
                  : telemetry.accuracy === 'medium'
                    ? (tx(lang, 'Yaklaşık (±0,1°)', 'Approx (±0.1°)'))
                    : (tx(lang, 'Eski dönem', 'Ancient'))}
              </span>
            </div>
            <div style={{ fontFamily: 'var(--font-ui)', fontSize: '0.76rem', lineHeight: 1.4, color: 'var(--c-dim)' }}>
              {loc(worldInfo.note, lang)}
            </div>

            {visibleQuickTargets.length > 0 && (
              <div className="hud-telem-group">
                <div style={{ color: 'var(--c-dim)', fontSize: '0.68rem', marginBottom: 4 }}>
                  {tx(lang, 'HIZLI BAKIŞ (TIKLA → DÖN)', 'LOOK AT (CLICK TO TURN)')}
                </div>
                <div className="hud-look-row">
                  {visibleQuickTargets.map((t) => (
                    <button key={t.id} type="button" className="hud-look-chip" onClick={() => game.lookAtTarget(t.id)}>
                      {loc(t.name, lang).split(' (')[0]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="hud-telem-group">
              <div style={{ color: 'var(--c-accent-2)', fontWeight: 700, marginBottom: 2 }}>
                {tx(lang, 'GÜNEŞ VE GÜÇ', 'SUN AND POWER')}
              </div>
              <div className="hud-telem-row">
                <span>{tx(lang, 'Yön / Yükseklik', 'Azimuth / Alt')}</span>
                <span className="hud-telem-val">{fmt(telemetry.sunAzDeg, 1, lang)}° / {fmt(telemetry.sunElDeg, 2, lang)}°</span>
              </div>
              <div className="hud-telem-row">
                <span>{tx(lang, 'Ufuk / Görünen disk', 'Horizon / Disc')}</span>
                <span className="hud-telem-val">{fmt(telemetry.sunHorizonDeg, 2, lang)}° ({percent(telemetry.sunVisibleFraction, lang)})</span>
              </div>
              {/* The flux is worked out for the top of the atmosphere; what reaches a panel under air is not modelled. */}
              <div className="hud-telem-row">
                <span>{AIRLESS[world] ? tx(lang, 'Işınım / 1 m² panel', 'Flux / 1 m² panel') : tx(lang, 'Işınım (atmosfer üstü)', 'Flux (above the air)')}</span>
                <span className="hud-telem-val">
                  {Math.round(telemetry.solarFluxWm2)} W/m²{AIRLESS[world] && ` · ${Math.round(telemetry.panelPowerW)} W`}
                </span>
              </div>
              {telemetry.sunEvent && (
                <div className="hud-telem-row">
                  <span>{telemetry.sunEvent.kind === 'set' ? (tx(lang, 'Gün batımına', 'Until sunset')) : (tx(lang, 'Gün doğumuna', 'Until sunrise'))}</span>
                  <span className="hud-telem-val">{formatDuration(telemetry.sunEvent.inHours, lang)}</span>
                </div>
              )}
            </div>

            {world !== 'earth' ? (
              <div className="hud-telem-group">
                <div style={{ color: 'var(--c-accent)', fontWeight: 700, marginBottom: 2 }}>
                  {tx(lang, 'DÜNYA VE İLETİŞİM', 'EARTH AND RADIO')}
                </div>
                <div className="hud-telem-row">
                  <span>{tx(lang, 'Yön / Yükseklik', 'Azimuth / Alt')}</span>
                  <span className="hud-telem-val">{fmt(telemetry.earthAzDeg, 1, lang)}° / {fmt(telemetry.earthElDeg, 2, lang)}°</span>
                </div>
                <div className="hud-telem-row">
                  <span>{tx(lang, 'Doğrudan iletişim', 'Direct link')}</span>
                  <span className="hud-telem-val" style={{ color: telemetry.dteLink ? 'var(--c-ok)' : 'var(--c-bad)' }}>
                    {telemetry.dteLink
                      ? tx(lang, tpl`Var (${fmt(telemetry.lightTimeSec, 2, lang)} sn)`, tpl`Yes (${fmt(telemetry.lightTimeSec, 2, lang)} s)`)
                      : (tx(lang, 'Yok (ufuk altı)', 'No (below horizon)'))}
                  </span>
                </div>
              </div>
            ) : (() => {
              const moonT = targets.find((t) => t.id === 'moon');
              return moonT ? (
                <div className="hud-telem-group">
                  <div style={{ color: 'var(--c-accent)', fontWeight: 700, marginBottom: 2 }}>
                    {tx(lang, 'AY (DÜNYA GÖĞÜNDE)', 'MOON (FROM EARTH)')}
                  </div>
                  <div className="hud-telem-row">
                    <span>{tx(lang, 'Yön / Yükseklik', 'Azimuth / Alt')}</span>
                    <span className="hud-telem-val">{fmt(moonT.azDeg, 1, lang)}° / {fmt(moonT.elDeg, 2, lang)}°</span>
                  </div>
                  <div className="hud-telem-row">
                    <span>{tx(lang, 'Parlaklık / Durum', 'Magnitude / State')}</span>
                    <span className="hud-telem-val">{fmt(moonT.magnitude, 1, lang)} {tx(lang, 'kadir', 'mag')} · {moonT.visible ? (tx(lang, 'Ufuk üstü', 'Visible')) : (tx(lang, 'Ufuk altı', 'Below'))}</span>
                  </div>
                </div>
              ) : null;
            })()}
            <div className="hud-telem-group">
              <div style={{ color: 'var(--c-dim)', fontWeight: 700, marginBottom: 2 }}>
                {tx(lang, 'YÜZEY ORTAMI (MODEL)', 'CONDITIONS (MODEL)')}
              </div>
              <div className="hud-telem-row">
                <span>{tx(lang, 'Sıcaklık', 'Temperature')}</span>
                <span className="hud-telem-val">{Math.round(telemetry.surfaceTempK)} K ({Math.round(telemetry.surfaceTempK - 273.15)} °C)</span>
              </div>
              {telemetry.radiationMsvDay !== null && (
                <div className="hud-telem-row">
                  <span>{tx(lang, 'Radyasyon (arka plan)', 'Radiation (bg)')}</span>
                  <span className="hud-telem-val">{fmt(telemetry.radiationMsvDay, 2, lang)} {tx(lang, 'mSv/gün', 'mSv/day')}</span>
                </div>
              )}
              {/* Floating in zero g there is no ground and so no slope to read. */}
              <div className="hud-telem-row">
                <span>{worldInfo.zeroG ? tx(lang, 'Lamba [G]', 'Lamp [G]') : tx(lang, 'Eğim / Lamba [G]', 'Slope / Lamp [G]')}</span>
                <span className="hud-telem-val">
                  {!worldInfo.zeroG && `${fmt(telemetry.slopeDeg, 1, lang)}° · `}{headlamp ? (tx(lang, 'Açık', 'On')) : (tx(lang, 'Kapalı', 'Off'))}
                </span>
              </div>
            </div>

            {lightReading && (
              <div className="hud-telem-group" style={{ background: 'rgba(16, 40, 32, 0.45)', padding: 8, borderRadius: 6 }}>
                <div style={{ color: 'var(--c-ok)', fontWeight: 700 }}>
                  {tx(lang, 'ÖLÇÜM DİREĞİ [B] (29,5 GÜN)', 'MEASURING MAST [B] (29.5 DAYS)')}
                </div>
                <div className="hud-telem-row">
                  <span>{tx(lang, 'Güneş / Dünya', 'Sun / Earth')}</span>
                  <span className="hud-telem-val">{percent(lightReading.sunFraction, lang)} / {percent(lightReading.earthFraction, lang)}</span>
                </div>
                <div className="hud-telem-row">
                  <span>{tx(lang, 'En uzun karanlık', 'Longest dark')}</span>
                  <span className="hud-telem-val">{fmt(lightReading.longestDarkHours, 1, lang)} {tx(lang, 'sa', 'h')}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {subtitle && (
        <div className="hud-subtitle">
          {subtitle.speaker && <span className="hud-subtitle-speaker">{loc(subtitle.speaker, lang)}</span>}
          <span>{loc(subtitle.text, lang)}</span>
        </div>
      )}

      {cleanMode && (
        <button type="button" className="mn-btn hud-clean-exit" onClick={() => game.toggleCleanMode(false)}>
          {tx(lang, 'Kontrolleri göster [U]', 'Show controls [U]')}
        </button>
      )}

      <TimeMachineBar />

      <AssetCardModal />
      <AboutEventModal />
      <InfoCentreModal />
    </div>
  );
}

// ─────────────────────────── SpaceHud (Galaxies, Planets, Sun, Remnants, Explosion Lab) ───────────────────────────

/** A dot of a close-up view that the HUD names. The view writes where the dot is on the screen every frame. */
interface ViewDot {
  id: string;
  name: L10n;
  /** Shares of the viewport's width and height from its top-left corner. */
  x: number;
  y: number;
  shown: boolean;
}

/** How far a dot's name stands from the dot, px: clear of a planet's ball at the distance the views open at. */
const DOT_NAME_GAP_PX = 26;

/**
 * Names on the dots of a close-up view: the planets of the Sun view; the Sun, the planets and Mars's
 * perihelion in the orbits view. The names follow the dots in a frame loop of their own. A name stands on the
 * side of its dot away from the middle of the view, where the Sun is; where it would lie over a name placed
 * before it (Mars passing its perihelion), it goes to the other side.
 */
function DotNames({ dots, lang }: { dots: ViewDot[]; lang: Lang }) {
  const itemRefs = useRef(new Map<string, HTMLSpanElement>());

  useEffect(() => {
    let raf = 0;
    const loop = (): void => {
      // Every size is read before anything is moved, so that the page is laid out once a frame.
      const sized = dots.flatMap((dot) => {
        const el = itemRefs.current.get(dot.id);
        return el ? [{ dot, el, width: el.offsetWidth, height: el.offsetHeight }] : [];
      });
      const placed: Box2D[] = [];
      for (const { dot, el, width, height } of sized) {
        el.style.visibility = dot.shown ? 'visible' : 'hidden';
        if (!dot.shown) continue;
        const x1 = dot.x * window.innerWidth - width / 2;
        const y = dot.y * window.innerHeight;
        const above: Box2D = { x1, y1: y - DOT_NAME_GAP_PX - height, x2: x1 + width, y2: y - DOT_NAME_GAP_PX };
        const below: Box2D = { x1, y1: y + DOT_NAME_GAP_PX, x2: x1 + width, y2: y + DOT_NAME_GAP_PX + height };
        const sides = dot.y < 0.5 ? [above, below] : [below, above];
        const box = sides.find((b) => !overlapsBox(b, placed)) ?? sides[0];
        placed.push(box);
        el.style.left = `${box.x1}px`;
        el.style.top = `${box.y1}px`;
      }
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [dots]);

  return (
    <>
      {dots.map((dot) => (
        <span
          key={dot.id}
          className="hud-star-label"
          style={{ visibility: 'hidden', transform: 'none' }}
          ref={(el) => {
            if (el) itemRefs.current.set(dot.id, el);
            else itemRefs.current.delete(dot.id);
          }}
        >
          {loc(dot.name, lang)}
        </span>
      ))}
    </>
  );
}

/** Mars's largest apparent diameter, arcseconds: that of 27 August 2003. A disc this wide fills the eyepiece drawn in the orbits view's card. */
const MARS_LARGEST_ARCSEC = 25.1;

/**
 * The orbits view's card: how far Mars is from Earth on the date shown, how long light takes to cross, and
 * how large Mars looks in a telescope, with a disc drawn to that size. The view writes the numbers every
 * frame; the card follows in a frame loop of its own and rewrites its texts only when the distance changes.
 */
function OrbitCard({ lang }: { lang: Lang }) {
  const distanceRef = useRef<HTMLSpanElement>(null);
  const lightRef = useRef<HTMLSpanElement>(null);
  const sizeRef = useRef<HTMLSpanElement>(null);
  const discRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    let shownKm = -1;
    const loop = (): void => {
      const info = orbitViewInfo;
      if (info.shown && info.distanceKm !== shownKm && distanceRef.current && lightRef.current && sizeRef.current && discRef.current) {
        shownKm = info.distanceKm;
        const millionKm = fmt(info.distanceKm / 1e6, 2, lang);
        const au = fmt(info.distanceAU, 3, lang);
        const minutes = fmt(info.lightTimeSec / 60, 1, lang);
        distanceRef.current.textContent = tx(lang, tpl`${millionKm} milyon km · ${au} AU`, tpl`${millionKm} million km · ${au} AU`);
        lightRef.current.textContent = tx(lang, tpl`${minutes} dk`, tpl`${minutes} min`);
        sizeRef.current.textContent = `${fmt(info.marsDiameterArcsec, 1, lang)}″`;
        const share = `${Math.min(1, info.marsDiameterArcsec / MARS_LARGEST_ARCSEC) * 100}%`;
        discRef.current.style.width = share;
        discRef.current.style.height = share;
      }
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [lang]);

  return (
    <div className="hud-card hud-space-side hud-orbit-card">
      <div className="hud-card-title">
        <span>{tx(lang, 'Dünya ile Mars arasında', 'Between Earth and Mars')}</span>
      </div>
      <div>
        <div className="hud-telem-row">
          <span>{tx(lang, 'Uzaklık', 'Distance')}</span>
          <span className="hud-telem-val" ref={distanceRef}>—</span>
        </div>
        <div className="hud-telem-row">
          <span>{tx(lang, 'Işığın geliş süresi', 'Light travel time')}</span>
          <span className="hud-telem-val" ref={lightRef}>—</span>
        </div>
        <div className="hud-telem-row">
          <span>{tx(lang, 'Mars’ın görünen çapı', 'Apparent diameter of Mars')}</span>
          <span className="hud-telem-val" ref={sizeRef}>—</span>
        </div>
      </div>
      <div className="hud-orbit-eyepiece">
        <div><div ref={discRef} /></div>
        <span>
          {tx(
            lang,
            tpl`Mars bu tarihte teleskopta bu büyüklükte görünür. En büyük hâli (${fmt(MARS_LARGEST_ARCSEC, 1, lang)}″, 27 Ağustos 2003) çemberi doldurur.`,
            tpl`This is how large Mars looks in a telescope on this date. At its largest (${fmt(MARS_LARGEST_ARCSEC, 1, lang)}″, 27 August 2003) it fills the circle.`,
          )}
        </span>
      </div>
      <ul>
        <li>{tx(lang, 'Parlak çizgi Dünya ile Mars arasındaki uzaklıktır.', 'The bright line is the distance between Earth and Mars.')}</li>
        <li>{tx(lang, 'Ölçekli değildir: Güneş yaklaşık 19 kat, gezegenler yaklaşık 1.400 kat büyük çizilmiştir. Yörüngeler, gezegenlerin yerleri ve aralarındaki uzaklık gösterilen tarih için hesaplanır.', 'Not to scale: the Sun is drawn about 19 times and the planets about 1,400 times too large. The orbits, the planets’ places and the distance between them are computed for the date shown.')}</li>
      </ul>
    </div>
  );
}

export function SpaceHud() {
  const lang = useLang();
  const spaceView = useGame((s) => s.spaceView);
  const clock = useGame((s) => s.clock);
  const spectator = useGame((s) => s.spectator);
  const cleanMode = useGame((s) => s.cleanMode);
  const site = useGame((s) => s.site);
  const soundOn = useGame((s) => s.settings.soundOn);
  const toast = useGame((s) => s.toast);
  // In a narrow window the bar gives up, in turn: the sound button, the language list, the clean-view button.
  const [topRef, tight] = useFit(3, `${lang}|${dictRevision()}|${spaceView?.targetId}`);

  if (!spaceView) return null;
  const tid = spaceView.targetId;
  const marsAssets = SURFACE_ASSETS.filter((a) => a.body === 'mars');
  const galDef = GALAXIES.find((g) => g.id === tid);
  const galShot = galDef?.pictures.find((p) => p.id === spaceView.galaxyPictureId) ?? galDef?.pictures[0];
  const remnant = TRANSIENTS.find((t) => t.id === tid);
  const isLab = tid === 'lab';
  const viewTitle = VIEW_TITLES[tid];
  const canWalkHere = WORLD_ORDER.includes(tid as WorldId);
  // The line under a globe that says what its picture is. Earth's names the month of its picture, and the
  // view keeps the picture it has while the clock runs at a day each second or faster: the line would then
  // name a month that is not on show, so it is left out.
  const globeCaption = tid === 'earth'
    ? (!clock.paused && clock.rate >= 86400 ? null : earthImageryFor(clock.jdTT).label)
    : tid in GLOBE_CAPTIONS ? GLOBE_CAPTIONS[tid] : null;

  return (
    <div className={`hud-root hud-space ${spectator ? 'is-spectator' : ''} ${cleanMode ? 'is-clean' : ''}`}>
      {/* Unified Space Top Bar */}
      <div className="hud-topbar hud-space-top" ref={topRef}>
        <div className="hud-bar-group">
          <button type="button" className="hud-bar-btn" onClick={() => game.exitSpaceView()}>
            ← {site ? (tx(lang, 'Yüzeye dön [Esc]', 'Back to surface [Esc]')) : (tx(lang, 'Ana menü [Esc]', 'Home menu [Esc]'))}
          </button>
          <span className="hud-divider" />
          {/* A galaxy's name is what its list shows. */}
          {galDef ? (
            <select
              className="hud-bar-select"
              value={galDef.id}
              aria-label={tx(lang, 'Galaksi seç', 'Choose galaxy')}
              onChange={(e) => game.enterSpaceView(e.target.value)}
            >
              {GALAXIES.map((g) => (
                <option key={g.id} value={g.id}>{loc(g.name, lang)}</option>
              ))}
            </select>
          ) : (
            <strong style={{ fontSize: '0.92rem' }}>
              {viewTitle ? loc(viewTitle, lang) : resolveTargetName(tid, lang)}
            </strong>
          )}
        </div>

        <div className="hud-bar-group">
          {canWalkHere && (
            <button type="button" className="hud-bar-btn is-amber" onClick={() => game.setWorld(tid as WorldId)}>
              {tx(lang, 'Astronotla bu ortama git →', 'Go there as the astronaut →')}
            </button>
          )}
          <button type="button" className="hud-bar-btn" onClick={() => game.openArchive()}>
            {tx(lang, 'Arşiv [I]', 'Archive [I]')}
          </button>
          {tight < 1 && (
            <button type="button" className={`hud-bar-btn ${soundOn ? 'is-on' : ''}`} aria-pressed={soundOn} onClick={() => game.updateSettings({ soundOn: !soundOn })}>
              {tx(lang, 'Ses [K]', 'Sound [K]')}
            </button>
          )}
          {tight < 3 && (
            <button type="button" className="hud-bar-btn" onClick={() => game.toggleCleanMode(true)}>
              {tx(lang, 'Temiz ekran [U]', 'Clean view [U]')}
            </button>
          )}
          {tight < 2 && <LangPicker />}
        </div>
      </div>

      {globeCaption && (
        <div
          className="hud-card hud-space-side"
          style={{ position: 'fixed', bottom: 66, left: 16, maxWidth: 'min(480px, calc(100vw - 32px))', padding: '6px 12px', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--c-accent-2)', pointerEvents: 'none' }}
        >
          {loc(globeCaption, lang)}
        </div>
      )}
      {isLab && <LabDrawer />}

      {tid === 'mars' && (
        <div className="hud-card hud-space-side" style={{ position: 'fixed', top: 58, left: 16, width: 'min(320px, 27vw)', maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }}>
          <div className="hud-card-title">
            <span>{tx(lang, 'Mars’taki Araçlar', 'Spacecraft on Mars')}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {marsAssets.map((a) => {
              const isSel = spaceView.selectedMarkerId === a.id;
              const status = loc(a.status, lang);
              return (
                <button
                  key={a.id}
                  type="button"
                  className={`mn-site-item ${isSel ? 'is-selected' : ''}`}
                  onClick={() => {
                    game.selectMarker(a.id);
                    setGame({ focusAssetId: a.id });
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '0.8rem', fontWeight: 700 }}>
                    <span>{loc(a.name, lang)}</span>
                    <span className={`mn-badge ${a.stillActive ? 'ok' : 'dim'}`}>
                      {a.stillActive ? (tx(lang, 'ÇALIŞIYOR', 'WORKING')) : a.arrival.year}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--c-dim)' }}>
                    {status.length > 88 ? `${status.slice(0, 85)}…` : status}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {galDef && galShot && (
        <div className="hud-card hud-space-side" style={{ position: 'fixed', top: 58, left: 16, width: 'min(340px, 32vw)', maxHeight: 'calc(100vh - 74px)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div className="mn-brand-tag">{galDef.catalogCode} · {loc(galDef.typeLabel, lang)}</div>
            <h3 style={{ margin: '4px 0 0', fontSize: '1.05rem' }}>{loc(galDef.name, lang)}</h3>
          </div>
          <p style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.5, color: 'var(--c-dim)' }}>
            {loc(galDef.summary, lang)}
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.78rem', lineHeight: 1.45, color: 'var(--c-text)' }}>
            {galDef.facts.map((f) => <li key={f.en}>{loc(f, lang)}</li>)}
          </ul>
          <div className="hud-galaxy-note">
            {galDef.pictures.length > 1 && (
              <div className="hud-galaxy-light">
                <span>{tx(lang, 'Hangi ışıkta?', 'In which light?')}</span>
                <div className="mn-seg">
                  {galDef.pictures.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`mn-seg-btn ${p.id === galShot.id ? 'is-active' : ''}`}
                      aria-pressed={p.id === galShot.id}
                      onClick={() => game.setGalaxyPicture(p.id)}
                    >
                      {loc(LIGHT_NAMES[p.id], lang)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p>
              <strong>{tx(lang, 'Görüntü', 'Picture')}:</strong> {loc(galShot.caption, lang)}
              {' · '}{getManifest().files[`tex/galaxy_${galDef.id}_${galShot.id}.webp`]?.credit ?? 'NASA'}
            </p>
            <p>{pictureWidthText(galDef, galShot, lang)}</p>
            <p>{tx(lang, 'Sürükleyince görünen 3B derinlik bir modeldir: görüntünün kendisinde derinlik bilgisi yoktur. Çift tıklayınca görüntüye dönülür.', 'The 3D depth you see when you drag is a model: the picture itself holds no depth. Double-click to return to the picture.')}</p>
          </div>
          <button
            type="button"
            className="mn-btn mn-btn-primary"
            onClick={() => game.openArchive(galDef.topicId)}
          >
            {tx(lang, 'NASA görsellerini aç', 'Open NASA images')}
          </button>
        </div>
      )}

      {galDef && galShot && <GalaxyScale galaxy={galDef} shot={galShot} lang={lang} />}

      {remnant?.kind === 'supernova' && (
        <div className="hud-card hud-space-side" style={{ position: 'fixed', top: 58, left: 16, width: 'min(300px, 26vw)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div className="mn-brand-tag">{tx(lang, 'Süpernova Kalıntısı', 'Supernova Remnant')}</div>
            <h3 style={{ margin: '4px 0 0', fontSize: '1.05rem' }}>{loc(remnant.remnantName, lang)}</h3>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.78rem', lineHeight: 1.45, color: 'var(--c-text)' }}>
            <li>
              {tx(
                lang,
                tpl`Uzaklığı: yaklaşık ${fmt(remnant.distanceLy, 0, lang)} ışık yılı`,
                tpl`Distance: about ${fmt(remnant.distanceLy, 0, lang)} light years`,
              )}
            </li>
            <li>
              {tx(
                lang,
                tpl`Gökyüzündeki genişliği: bugün yaklaşık ${fmt(remnant.remnantDiameterArcmin, 0, lang)} yay dakikası (dolunay ${fmt(FULL_MOON_DEG * 60, 0, lang)} yay dakikasıdır)`,
                tpl`Width on the sky: about ${fmt(remnant.remnantDiameterArcmin, 0, lang)} arcminutes today (the full Moon is ${fmt(FULL_MOON_DEG * 60, 0, lang)})`,
              )}
            </li>
          </ul>
          <p style={{ margin: 0, fontSize: '0.8rem', lineHeight: 1.45, color: 'var(--c-dim)' }}>
            {tx(
              lang,
              'Bulutun biçimi bir modeldir, fotoğraf değildir: bu türden bir kalıntının genel görünüşünü çizer. Büyümesi de modeldir: bugünkü boyutuna sabit hızla ulaşacak biçimde genişler.',
              'The shape of the cloud is a model, not a picture: it draws the general look of a remnant of this kind. Its growth is a model too: it expands at a steady speed that brings it to its size today.',
            )}
          </p>
          <p style={{ margin: 0, fontSize: '0.8rem', lineHeight: 1.45, color: 'var(--c-dim)' }}>
            {tx(lang, 'Alttaki zaman çubuğunu patlama yılından 2026’ya doğru kaydırarak gaz bulutunun yüzyıllar içinde nasıl genişlediğini izleyin.', 'Drag the year slider at the bottom from the year of the explosion toward 2026 to see the gas cloud expand over centuries.')}
          </p>
        </div>
      )}

      {tid === 'sun' && <DotNames dots={sunViewLabels} lang={lang} />}
      {tid === 'mars_orbit' && <DotNames dots={orbitViewInfo.labels} lang={lang} />}
      {tid === 'mars_orbit' && <OrbitCard lang={lang} />}
      {tid === 'sun' && (
        <div className="hud-card hud-space-side" style={{ position: 'fixed', top: 58, left: 16, width: 'min(320px, 30vw)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="hud-card-title">
            <span>{tx(lang, 'Güneş ve İç Gezegenler', 'The Sun and the Inner Planets')}</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.8rem', lineHeight: 1.45, color: 'var(--c-dim)' }}>
            <li>{tx(lang, 'Üç nokta Merkür, Venüs ve Dünya’dır; her biri gösterilen tarihte yörüngesinde bulunduğu yerdedir.', 'The three dots are Mercury, Venus and Earth, each where it is on its orbit on the date shown.')}</li>
            <li>{tx(lang, 'Ölçekli değildir: Güneş de gezegenler de aralarındaki uzaklıklara göre olduklarından çok büyük çizilmiştir.', 'Not to scale: the Sun and the planets are drawn far larger than they are against the distances between them.')}</li>
            <li>{tx(lang, 'Püskürmeler NASA DONKI’nin Mayıs 2024 kayıtlarından çizilir; uzaydaki ilerleyişleri bir modeldir.', 'The eruptions are drawn from NASA DONKI records of May 2024; their travel through space is a model.')}</li>
            <li>{tx(lang, 'Başka tarihlerde Güneş sakin gösterilir.', 'On other dates the Sun is shown quiet.')}</li>
          </ul>
        </div>
      )}

      {cleanMode && (
        <button type="button" className="mn-btn hud-clean-exit" onClick={() => game.toggleCleanMode(false)}>
          {tx(lang, 'Kontrolleri göster [U]', 'Show controls [U]')}
        </button>
      )}

      {toast && <div className={`hud-toast is-raised is-${toast.kind}`}>{loc(toast.text, lang)}</div>}

      <StagePanel />
      {!isLab && !galDef && <TimeMachineBar />}
      <AssetCardModal />
      <AboutEventModal />
      <InfoCentreModal />
    </div>
  );
}
