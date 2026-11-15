/**
 * Landing Site Navigator: compares Moon sites, or one site on several dates, by their Sun and Earth above the
 * real skyline. Each row is the site's skyline from the global LOLA map and its Sun/Earth series over one lunar
 * day from the chosen moment (astro/navigator.ts); rows are computed one per frame so the page never stalls.
 */
import { Fragment, useEffect, useMemo, useState, type JSX, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import './navigator.css';
import type { L10n, Lang, SiteDef } from '../../core/types';
import type { Dem } from '../../core/dem';
import { fmt, loc, tpl, tx, useLang } from '../../core/i18n';
import { getGame, useGame } from '../../core/store';
import { calendarUTFromJdTT, formatDate, formatDuration, jdTTFromCalendarUT, jdTTNow } from '../../core/time';
import { SITE_GROUP_NAMES, SITE_GROUP_ORDER, SITES_BY_BODY } from '../../content';
import { customSite } from '../../content/customSite';
import { computeSiteTimeline, SYNODIC_MONTH_DAYS, type SiteTimeline, type TimelineSummary } from '../../astro/navigator';
import { PANEL_EFFICIENCY, VISIBLE_DISC_FRACTION } from '../../astro';
import { globalHorizonProfile, loadMoonGlobalDem } from '../../terrain/globalHorizon';
import { game } from '../../game/api';
import { useDialog } from '../useDialog';

const MAX_ROWS = 6;
const DATE_ROWS = 4;
const DEFAULT_SITE_IDS = ['shackleton', 'connecting_ridge', 'malapert', 'im1_malapert_a', 'chandrayaan3', 'apollo11'];
const MOON_SITES = SITES_BY_BODY.moon;
/** Above this share of the Sun's disc the strip shows full sunlight. */
const FULL_SUN_SHARE = 0.95;
/** Timelines kept in memory; the oldest go first. */
const TIMELINE_CACHE_LIMIT = 120;
/** Eye height (m) and azimuth samples of the skyline, the same as the surface telemetry's. */
const EYE_HEIGHT_M = 1.62;
const HORIZON_SAMPLES = 180;

const OTHER_GROUP: L10n = { tr: 'Diğer', en: 'Other' };

type Mode = 'sites' | 'dates';
type DateStep = 'day' | 'week' | 'lunar' | 'quarter';
const DATE_STEPS: Array<{ id: DateStep; label: L10n }> = [
  { id: 'day', label: { tr: '1 gün', en: '1 day' } },
  { id: 'week', label: { tr: '7 gün', en: '7 days' } },
  { id: 'lunar', label: { tr: '1 Ay günü', en: '1 lunar day' } },
  { id: 'quarter', label: { tr: '3 ay', en: '3 months' } },
];
const STEP_DAYS: Record<Exclude<DateStep, 'quarter'>, number> = { day: 1, week: 7, lunar: SYNODIC_MONTH_DAYS };

const TIME_STEPS: Array<{ days: number; label: L10n }> = [
  { days: -SYNODIC_MONTH_DAYS, label: { tr: '−1 Ay günü', en: '−1 lunar day' } },
  { days: -1, label: { tr: '−1 gün', en: '−1 day' } },
  { days: -1 / 24, label: { tr: '−1 sa', en: '−1 h' } },
  { days: 1 / 24, label: { tr: '+1 sa', en: '+1 h' } },
  { days: 1, label: { tr: '+1 gün', en: '+1 day' } },
  { days: SYNODIC_MONTH_DAYS, label: { tr: '+1 Ay günü', en: '+1 lunar day' } },
];

interface Row { key: string; site: SiteDef; jdTT: number }

const profiles = new Map<string, Float32Array>();
const timelines = new Map<string, SiteTimeline>();

function coordKey(site: SiteDef): string {
  return `${site.latDeg.toFixed(4)},${site.lonDeg.toFixed(4)}`;
}

function rowOf(site: SiteDef, jdTT: number): Row {
  return { key: `${coordKey(site)}@${jdTT.toFixed(6)}`, site, jdTT };
}

/** The moment `months` calendar months after `jdTT`, same day of the month and time of day (UTC). */
function addMonths(jdTT: number, months: number): number {
  const c = calendarUTFromJdTT(jdTT);
  const index = c.year * 12 + (c.month - 1) + months;
  return jdTTFromCalendarUT({ ...c, year: Math.floor(index / 12), month: (index % 12) + 1 });
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The value of a datetime-local field for `jdTT`, read as UTC; empty outside years 1–9999. */
function inputValue(jdTT: number): string {
  const c = calendarUTFromJdTT(jdTT);
  if (c.year < 1 || c.year > 9999) return '';
  return `${String(c.year).padStart(4, '0')}-${pad2(c.month)}-${pad2(c.day)}T${pad2(c.hour)}:${pad2(c.minute)}`;
}

function parseInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  return jdTTFromCalendarUT({ year, month, day, hour, minute, second: 0 });
}

function percent(share: number, lang: Lang): string {
  const n = fmt(share * 100, 0, lang);
  return tx(lang, tpl`%${n}`, tpl`${n} %`);
}

function degrees(value: number, lang: Lang): string {
  return `${fmt(value, 1, lang)}°`;
}

/**
 * A site's latitude and longitude with hemisphere letters. Each quadrant is one whole template: a bare letter
 * would share its translation with the key of the same name in the controls list.
 */
const COORD_TEXT: Record<'ne' | 'nw' | 'se' | 'sw', (lat: string, lon: string, lang: Lang) => string> = {
  ne: (lat, lon, lang) => tx(lang, tpl`${lat}° K, ${lon}° D`, tpl`${lat}° N, ${lon}° E`),
  nw: (lat, lon, lang) => tx(lang, tpl`${lat}° K, ${lon}° B`, tpl`${lat}° N, ${lon}° W`),
  se: (lat, lon, lang) => tx(lang, tpl`${lat}° G, ${lon}° D`, tpl`${lat}° S, ${lon}° E`),
  sw: (lat, lon, lang) => tx(lang, tpl`${lat}° G, ${lon}° B`, tpl`${lat}° S, ${lon}° W`),
};

function coordText(site: SiteDef, lang: Lang): string {
  const quadrant = `${site.latDeg < 0 ? 's' : 'n'}${site.lonDeg < 0 ? 'w' : 'e'}` as const;
  return COORD_TEXT[quadrant](fmt(Math.abs(site.latDeg), 2, lang), fmt(Math.abs(site.lonDeg), 2, lang), lang);
}

function sunEventText(next: TimelineSummary['nextSun'], lang: Lang): string {
  if (!next) return tx(lang, 'Bu pencerede yok', 'None in this window');
  const d = formatDuration(next.inHours, lang);
  return next.kind === 'set' ? tx(lang, tpl`Gün batımına ${d}`, tpl`Sunset in ${d}`) : tx(lang, tpl`Gün doğumuna ${d}`, tpl`Sunrise in ${d}`);
}

function earthEventText(next: TimelineSummary['nextEarth'], lang: Lang): string {
  if (!next) return tx(lang, 'Bu pencerede yok', 'None in this window');
  const d = formatDuration(next.inHours, lang);
  return next.kind === 'set' ? tx(lang, tpl`Dünya batışına ${d}`, tpl`Earthset in ${d}`) : tx(lang, tpl`Dünya doğuşuna ${d}`, tpl`Earthrise in ${d}`);
}

type MetricId = 'sunEl' | 'sunDisc' | 'power' | 'earthEl' | 'nextSun' | 'nextEarth' | 'sunlit' | 'night' | 'earthShare' | 'outage';

interface Metric {
  id: MetricId;
  label: L10n;
  /** Sort key; a larger value is better when `higherFirst`. */
  value: (s: TimelineSummary) => number;
  higherFirst: boolean;
  cell: (s: TimelineSummary, lang: Lang) => ReactNode;
}

const NOW_METRICS: Metric[] = [
  {
    id: 'sunEl',
    label: { tr: 'Güneş yüksekliği', en: 'Sun elevation' },
    value: (s) => s.now.sunElDeg,
    higherFirst: true,
    cell: (s, lang) => (
      <>
        <b>{degrees(s.now.sunElDeg, lang)}</b>
        <small>{tx(lang, tpl`ufuk çizgisi ${degrees(s.now.sunHorizonDeg, lang)}`, tpl`skyline ${degrees(s.now.sunHorizonDeg, lang)}`)}</small>
      </>
    ),
  },
  {
    id: 'sunDisc',
    label: { tr: 'Görünen Güneş diski', en: 'Sun disc visible' },
    value: (s) => s.now.sunVisible,
    higherFirst: true,
    cell: (s, lang) => <b className={s.now.sunVisible > VISIBLE_DISC_FRACTION ? 'nav-ok' : 'nav-bad'}>{percent(s.now.sunVisible, lang)}</b>,
  },
  {
    id: 'power',
    label: { tr: '1 m² panel gücü', en: 'Power, 1 m² panel' },
    value: (s) => s.now.panelPowerW,
    higherFirst: true,
    cell: (s, lang) => (
      <>
        <b>{fmt(s.now.panelPowerW, 0, lang)} W</b>
        <small>{tx(lang, tpl`Güneş ışığı ${fmt(s.now.fluxWm2, 0, lang)} W/m²`, tpl`sunlight ${fmt(s.now.fluxWm2, 0, lang)} W/m²`)}</small>
      </>
    ),
  },
  {
    id: 'earthEl',
    label: { tr: 'Dünya yüksekliği', en: 'Earth elevation' },
    value: (s) => s.now.earthElDeg,
    higherFirst: true,
    cell: (s, lang) => (
      <>
        <b>{degrees(s.now.earthElDeg, lang)}</b>
        <small className={s.now.earthVisible ? 'nav-ok' : 'nav-bad'}>
          {s.now.earthVisible ? tx(lang, 'Doğrudan bağlantı: var', 'Direct link: yes') : tx(lang, 'Doğrudan bağlantı: yok', 'Direct link: no')}
        </small>
      </>
    ),
  },
  {
    id: 'nextSun',
    label: { tr: 'Sonraki gün batımı / doğumu', en: 'Next sunset / sunrise' },
    value: (s) => s.nextSun?.inHours ?? Number.POSITIVE_INFINITY,
    higherFirst: false,
    cell: (s, lang) => <span className="nav-event">{sunEventText(s.nextSun, lang)}</span>,
  },
  {
    id: 'nextEarth',
    label: { tr: 'Sonraki Dünya batışı / doğuşu', en: 'Next Earthset / Earthrise' },
    value: (s) => s.nextEarth?.inHours ?? Number.POSITIVE_INFINITY,
    higherFirst: false,
    cell: (s, lang) => <span className="nav-event">{earthEventText(s.nextEarth, lang)}</span>,
  },
];

const WINDOW_METRICS: Metric[] = [
  {
    id: 'sunlit',
    label: { tr: 'Güneş ışığı', en: 'Sunlight' },
    value: (s) => s.sunlitShare,
    higherFirst: true,
    cell: (s, lang) => <b>{percent(s.sunlitShare, lang)}</b>,
  },
  {
    id: 'night',
    label: { tr: 'En uzun gece', en: 'Longest night' },
    value: (s) => s.longestDarkHours,
    higherFirst: false,
    cell: (s, lang) => <b>{s.longestDarkHours > 0 ? formatDuration(s.longestDarkHours, lang) : tx(lang, 'yok', 'none')}</b>,
  },
  {
    id: 'earthShare',
    label: { tr: 'Dünya görünür', en: 'Earth visible' },
    value: (s) => s.earthVisibleShare,
    higherFirst: true,
    cell: (s, lang) => <b>{percent(s.earthVisibleShare, lang)}</b>,
  },
  {
    id: 'outage',
    label: { tr: 'En uzun Dünya kesintisi', en: 'Longest Earth outage' },
    value: (s) => s.longestEarthOutageHours,
    higherFirst: false,
    cell: (s, lang) => <b>{s.longestEarthOutageHours > 0 ? formatDuration(s.longestEarthOutageHours, lang) : tx(lang, 'yok', 'none')}</b>,
  },
];

const ALL_METRICS = [...NOW_METRICS, ...WINDOW_METRICS];

interface Sort { id: MetricId; higherFirst: boolean }

/** Consecutive samples of the same class, as [first index, count, class]. */
function runsOf(values: Float32Array, classOf: (v: number) => string): Array<[number, number, string]> {
  const runs: Array<[number, number, string]> = [];
  for (let i = 0; i < values.length; i++) {
    const cls = classOf(values[i]);
    const last = runs[runs.length - 1];
    if (last && last[2] === cls) last[1]++;
    else runs.push([i, 1, cls]);
  }
  return runs;
}

const sunClass = (v: number): string => (v >= FULL_SUN_SHARE ? 'nav-sun-lit' : v > VISIBLE_DISC_FRACTION ? 'nav-sun-part' : 'nav-sun-dark');
const earthClass = (v: number): string => (v > VISIBLE_DISC_FRACTION ? 'nav-earth-vis' : 'nav-earth-hid');

function sunState(v: number, lang: Lang): string {
  if (v >= FULL_SUN_SHARE) return tx(lang, 'ufkun üstünde', 'above the skyline');
  return v > VISIBLE_DISC_FRACTION ? tx(lang, 'kısmen gizli', 'partly hidden') : tx(lang, 'ufkun altında', 'below the skyline');
}

/** The Sun and Earth bands over the window, one day per tick, with a read-out of the moment under the pointer. */
function TimelineStrip({ t, lang }: { t: SiteTimeline; lang: Lang }): JSX.Element {
  const [hover, setHover] = useState<number | null>(null);
  const n = t.sunVisible.length;
  const sunRuns = useMemo(() => runsOf(t.sunVisible, sunClass), [t]);
  const earthRuns = useMemo(() => runsOf(t.earthVisible, earthClass), [t]);
  const perDay = 24 / t.stepHours;
  const ticks: number[] = [];
  for (let d = 1; d * perDay < n; d++) ticks.push(d);
  const onMove = (e: PointerEvent<SVGSVGElement>): void => {
    const box = e.currentTarget.getBoundingClientRect();
    setHover(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - box.left) / box.width) * n))));
  };
  let readout = tx(lang, tpl`${formatDate(t.startJdTT, lang, { time: true })} → ${fmt(n * t.stepHours / 24, 1, lang)} gün`, tpl`${formatDate(t.startJdTT, lang, { time: true })} → ${fmt(n * t.stepHours / 24, 1, lang)} days`);
  if (hover !== null) {
    const when = formatDate(t.startJdTT + (hover * t.stepHours) / 24, lang, { time: true });
    const sun = tx(lang, tpl`Güneş ${degrees(t.sunElDeg[hover], lang)}, ${sunState(t.sunVisible[hover], lang)}`, tpl`Sun ${degrees(t.sunElDeg[hover], lang)}, ${sunState(t.sunVisible[hover], lang)}`);
    const earthState = t.earthVisible[hover] > VISIBLE_DISC_FRACTION ? tx(lang, 'görünür', 'visible') : tx(lang, 'gizli', 'hidden');
    const earth = tx(lang, tpl`Dünya ${degrees(t.earthElDeg[hover], lang)}, ${earthState}`, tpl`Earth ${degrees(t.earthElDeg[hover], lang)}, ${earthState}`);
    readout = `${when} · ${sun} · ${earth}`;
  }
  return (
    <div className="nav-strip">
      <svg viewBox={`0 0 ${n} 20`} preserveAspectRatio="none" onPointerMove={onMove} onPointerLeave={() => setHover(null)} aria-hidden="true">
        {sunRuns.map(([i, len, cls]) => <rect key={`s${i}`} className={cls} x={i} y={0} width={len} height={9} />)}
        {earthRuns.map(([i, len, cls]) => <rect key={`e${i}`} className={cls} x={i} y={11} width={len} height={9} />)}
        {ticks.map((d) => (
          <line key={d} className={d % 7 === 0 ? 'nav-tick nav-tick-week' : 'nav-tick'} x1={d * perDay} x2={d * perDay} y1={0} y2={20} />
        ))}
        {hover !== null && <line className="nav-cursor" x1={hover + 0.5} x2={hover + 0.5} y1={0} y2={20} />}
      </svg>
      <div className="nav-strip-read">{readout}</div>
    </div>
  );
}

function SitePicker({ lang, value, onPick, disabled }: { lang: Lang; value: string; onPick: (site: SiteDef) => void; disabled?: (site: SiteDef) => boolean }): JSX.Element {
  const groups = [
    ...SITE_GROUP_ORDER.map((g) => ({ label: SITE_GROUP_NAMES[g], sites: MOON_SITES.filter((s) => s.group === g) })),
    { label: OTHER_GROUP, sites: MOON_SITES.filter((s) => s.group === undefined) },
  ].filter((g) => g.sites.length > 0);
  return (
    <select
      className="nav-select"
      value={value}
      onChange={(e) => {
        const site = MOON_SITES.find((s) => s.id === e.target.value);
        if (site) onPick(site);
      }}
    >
      {value === '' && <option value="">{tx(lang, 'Yer ekle…', 'Add a site…')}</option>}
      {value === 'custom' && <option value="custom">{tx(lang, 'Özel nokta', 'Custom site')}</option>}
      {groups.map((g) => (
        <optgroup key={g.label.en} label={loc(g.label, lang)}>
          {g.sites.map((s) => (
            <option key={s.id} value={s.id} disabled={disabled?.(s)}>{loc(s.name, lang)}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Latitude and longitude fields; `onSubmit` receives a valid custom site. */
function CustomCoords({ lang, action, disabled, onSubmit }: { lang: Lang; action: string; disabled: boolean; onSubmit: (site: SiteDef) => void }): JSX.Element {
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [error, setError] = useState(false);
  const submit = (): void => {
    const latDeg = Number(lat.replace(',', '.'));
    const lonDeg = Number(lon.replace(',', '.'));
    const valid = lat.trim() !== '' && lon.trim() !== '' && Math.abs(latDeg) <= 90 && Math.abs(lonDeg) <= 180;
    setError(!valid);
    if (valid) onSubmit(customSite('moon', latDeg, lonDeg));
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') submit();
  };
  return (
    <div className="nav-custom">
      <label>
        <span>{tx(lang, 'Enlem', 'Latitude')}</span>
        <input type="text" inputMode="decimal" value={lat} placeholder="-89.5" onChange={(e) => setLat(e.target.value)} onKeyDown={onKey} aria-invalid={error} />
      </label>
      <label>
        <span>{tx(lang, 'Boylam (doğu +)', 'Longitude (east +)')}</span>
        <input type="text" inputMode="decimal" value={lon} placeholder="-150.0" onChange={(e) => setLon(e.target.value)} onKeyDown={onKey} aria-invalid={error} />
      </label>
      <button type="button" className="mn-btn" disabled={disabled} onClick={submit}>{action}</button>
      {error && <span className="nav-error" role="alert">{tx(lang, 'Enlem −90…90, boylam −180…180 derece olmalı.', 'Latitude must be −90…90 and longitude −180…180 degrees.')}</span>}
    </div>
  );
}

export function NavigatorScreen(): JSX.Element | null {
  const open = useGame((s) => s.panels.navigator);
  const dialog = useDialog(open);
  if (!open) return null;
  return <NavigatorDialog dialogRef={dialog} />;
}

function NavigatorDialog({ dialogRef }: { dialogRef: RefObject<HTMLDivElement | null> }): JSX.Element {
  const lang = useLang();
  const [startJd, setStartJd] = useState(() => {
    const st = getGame();
    return st.phase === 'surface' || st.phase === 'map' ? st.clock.jdTT : jdTTNow();
  });
  const [mode, setMode] = useState<Mode>('sites');
  const [sites, setSites] = useState<SiteDef[]>(() => DEFAULT_SITE_IDS.flatMap((id) => MOON_SITES.filter((s) => s.id === id)));
  const [dateSite, setDateSite] = useState<SiteDef>(() => {
    const st = getGame();
    const here = st.phase === 'surface' && st.world === 'moon' ? st.site : null;
    return here ?? sites[0] ?? MOON_SITES[0];
  });
  const [dateStep, setDateStep] = useState<DateStep>('week');
  const [sort, setSort] = useState<Sort | null>(null);
  const [dem, setDem] = useState<Dem | null>(null);
  const [demError, setDemError] = useState<string | null>(null);
  const [, setRevision] = useState(0);
  const close = (): void => game.togglePanel('navigator', false);

  useEffect(() => {
    let live = true;
    loadMoonGlobalDem().then(
      (d) => live && setDem(d),
      (e: unknown) => live && setDemError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, []);

  const rows = useMemo<Row[]>(() => {
    if (mode === 'sites') return sites.map((s) => rowOf(s, startJd));
    return Array.from({ length: DATE_ROWS }, (_, k) =>
      rowOf(dateSite, dateStep === 'quarter' ? addMonths(startJd, 3 * k) : startJd + k * STEP_DAYS[dateStep]));
  }, [mode, sites, dateSite, dateStep, startJd]);
  const rowsKey = rows.map((r) => r.key).join('|');

  // Rows missing from the cache are computed one per frame, in table order; a change of rows abandons the rest.
  useEffect(() => {
    if (!dem) return undefined;
    let live = true;
    const nextFrame = (): Promise<void> => {
      const { promise, resolve } = Promise.withResolvers<void>();
      requestAnimationFrame(() => setTimeout(resolve, 0));
      return promise;
    };
    void (async () => {
      for (const row of rows) {
        if (timelines.has(row.key)) continue;
        const ck = coordKey(row.site);
        let profile = profiles.get(ck);
        if (!profile) {
          await nextFrame();
          if (!live) return;
          profile = globalHorizonProfile(dem, row.site.latDeg, row.site.lonDeg, EYE_HEIGHT_M, HORIZON_SAMPLES);
          profiles.set(ck, profile);
        }
        await nextFrame();
        if (!live) return;
        timelines.set(row.key, computeSiteTimeline(row.site, row.jdTT, profile));
        if (timelines.size > TIMELINE_CACHE_LIMIT) timelines.delete(timelines.keys().next().value ?? '');
        setRevision((r) => r + 1);
      }
    })();
    return () => {
      live = false;
    };
    // rowsKey changes exactly when `rows` holds other rows.
  }, [dem, rowsKey]);

  const pending = rows.filter((r) => !timelines.has(r.key)).length;
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const metric = ALL_METRICS.find((m) => m.id === sort.id);
    if (!metric) return rows;
    const keyOf = (r: Row): number => {
      const t = timelines.get(r.key);
      if (!t) return Number.NaN;
      return sort.higherFirst ? -metric.value(t.summary) : metric.value(t.summary);
    };
    return [...rows].sort((a, b) => {
      const ka = keyOf(a);
      const kb = keyOf(b);
      if (Number.isNaN(ka) || Number.isNaN(kb)) return Number.isNaN(ka) ? (Number.isNaN(kb) ? 0 : 1) : -1;
      return ka === kb ? 0 : ka < kb ? -1 : 1;
    });
    // pending changes as rows finish, so the order follows the new numbers.
  }, [rows, sort, pending]);

  const onSort = (m: Metric): void => {
    setSort((s) => (s?.id === m.id ? { id: m.id, higherFirst: !s.higherFirst } : { id: m.id, higherFirst: m.higherFirst }));
  };
  const header = (m: Metric): JSX.Element => {
    const active = sort?.id === m.id;
    const ariaSort = active ? (sort.higherFirst ? 'descending' : 'ascending') : 'none';
    return (
      <th key={m.id} scope="col" aria-sort={ariaSort}>
        <button type="button" className={active ? 'nav-sort is-active' : 'nav-sort'} onClick={() => onSort(m)}>
          {loc(m.label, lang)}
          <span aria-hidden="true">{active ? (sort.higherFirst ? ' ▼' : ' ▲') : ''}</span>
        </button>
      </th>
    );
  };
  const siteTaken = (s: SiteDef): boolean => sites.some((x) => coordKey(x) === coordKey(s));
  const addSite = (s: SiteDef): void => {
    if (sites.length < MAX_ROWS && !siteTaken(s)) setSites([...sites, s]);
  };
  const full = sites.length >= MAX_ROWS;
  const windowDays = fmt(SYNODIC_MONTH_DAYS, 1, lang);

  let status: string | null = null;
  if (demError) status = tx(lang, tpl`LOLA arazisi yüklenemedi: ${demError}`, tpl`Could not load the LOLA terrain: ${demError}`);
  else if (!dem) status = tx(lang, 'LOLA arazisi yükleniyor…', 'Loading LOLA terrain…');
  else if (pending > 0) status = tx(lang, tpl`Hesaplanıyor: ${rows.length - pending} / ${rows.length}`, tpl`Computing: ${rows.length - pending} of ${rows.length}`);

  return (
    <div className="mn-modal-backdrop" onClick={close}>
      <div
        className="mn-modal nav-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={tx(lang, 'İniş Yeri Navigatörü', 'Landing Site Navigator')}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.stopPropagation();
          close();
        }}
      >
        <div className="mn-modal-head">
          <div>
            <h2 className="mn-modal-title">{tx(lang, 'İniş Yeri Navigatörü', 'Landing Site Navigator')}</h2>
            <p className="nav-subtitle">
              {tx(
                lang,
                'Ay’daki iniş yerlerini ya da tarihleri karşılaştırır: gerçek ufuk çizgisinin üstünde Güneş (güç) ve Dünya (doğrudan iletişim).',
                'Compares Moon landing sites or dates: the Sun (power) and the Earth (direct link) above the real skyline.',
              )}
            </p>
          </div>
          <div className="nav-head-actions">
            <div className="mn-seg" role="group" aria-label={tx(lang, 'Karşılaştırma', 'Comparison')}>
              <button type="button" className={mode === 'sites' ? 'mn-seg-btn is-active' : 'mn-seg-btn'} aria-pressed={mode === 'sites'} onClick={() => setMode('sites')}>
                {tx(lang, 'Yerleri karşılaştır', 'Compare sites')}
              </button>
              <button type="button" className={mode === 'dates' ? 'mn-seg-btn is-active' : 'mn-seg-btn'} aria-pressed={mode === 'dates'} onClick={() => setMode('dates')}>
                {tx(lang, 'Tarihleri karşılaştır', 'Compare dates')}
              </button>
            </div>
            <button type="button" className="mn-btn" onClick={close}>{tx(lang, 'Kapat [Esc]', 'Close [Esc]')}</button>
          </div>
        </div>

        <div className="nav-controls">
          <label className="nav-date">
            <span>{tx(lang, 'Tarih ve saat (UTC)', 'Date and time (UTC)')}</span>
            <input
              type="datetime-local"
              value={inputValue(startJd)}
              onChange={(e) => {
                const jd = parseInput(e.target.value);
                if (jd !== null) setStartJd(jd);
              }}
            />
          </label>
          <div className="nav-steps">
            {TIME_STEPS.map((s) => (
              <button key={s.label.en} type="button" className="mn-btn" onClick={() => setStartJd(startJd + s.days)}>{loc(s.label, lang)}</button>
            ))}
            <button type="button" className="mn-btn" onClick={() => setStartJd(jdTTNow())}>{tx(lang, 'Şimdi', 'Now')}</button>
          </div>
        </div>

        <div className="nav-controls">
          {mode === 'sites' ? (
            <>
              <SitePicker lang={lang} value="" onPick={addSite} disabled={(s) => full || siteTaken(s)} />
              <CustomCoords lang={lang} action={tx(lang, 'Ekle', 'Add')} disabled={full} onSubmit={addSite} />
              <span className="nav-note">{tx(lang, tpl`En çok ${MAX_ROWS} satır`, tpl`Up to ${MAX_ROWS} rows`)}</span>
            </>
          ) : (
            <>
              <SitePicker lang={lang} value={dateSite.id} onPick={setDateSite} />
              <CustomCoords lang={lang} action={tx(lang, 'Kullan', 'Use')} disabled={false} onSubmit={setDateSite} />
              <div className="mn-seg" role="group" aria-label={tx(lang, 'Satırlar arası', 'Between rows')}>
                {DATE_STEPS.map((s) => (
                  <button key={s.id} type="button" className={dateStep === s.id ? 'mn-seg-btn is-active' : 'mn-seg-btn'} aria-pressed={dateStep === s.id} onClick={() => setDateStep(s.id)}>
                    {loc(s.label, lang)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="nav-legend">
          <span><i className="nav-sw nav-sun-lit" />{tx(lang, 'Güneş tam', 'Full Sun')}</span>
          <span><i className="nav-sw nav-sun-part" />{tx(lang, 'Güneş kısmen', 'Sun partly')}</span>
          <span><i className="nav-sw nav-sun-dark" />{tx(lang, 'Güneş yok', 'No Sun')}</span>
          <span><i className="nav-sw nav-earth-vis" />{tx(lang, 'Dünya görünür', 'Earth visible')}</span>
          <span><i className="nav-sw nav-earth-hid" />{tx(lang, 'Dünya gizli', 'Earth hidden')}</span>
          <span>{tx(lang, 'Çizgiler: günler (kalın: haftalar)', 'Ticks: days (bold: weeks)')}</span>
          {status && <span className="nav-status" role="status">{status}</span>}
        </div>

        <div className="nav-table-wrap">
          <table className="nav-table">
            <thead>
              <tr>
                <th rowSpan={2} scope="col" className="nav-site-col">{mode === 'sites' ? tx(lang, 'Yer', 'Site') : tx(lang, 'Tarih', 'Date')}</th>
                <th colSpan={NOW_METRICS.length} scope="colgroup" className="nav-group">
                  {tx(lang, tpl`ŞİMDİ (${formatDate(startJd, lang, { time: true })})`, tpl`NOW (${formatDate(startJd, lang, { time: true })})`)}
                </th>
                <th colSpan={WINDOW_METRICS.length} scope="colgroup" className="nav-group">
                  {tx(lang, tpl`SONRAKİ AY GÜNÜ BOYUNCA (${windowDays} gün)`, tpl`OVER THE NEXT LUNAR DAY (${windowDays} days)`)}
                </th>
              </tr>
              <tr>{ALL_METRICS.map(header)}</tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const t = timelines.get(row.key);
                return (
                  <Fragment key={row.key}>
                    <tr className="nav-row">
                      <th scope="row" className="nav-site-col">
                        {mode === 'dates' && <b className="nav-row-date">{formatDate(row.jdTT, lang, { time: true })}</b>}
                        <span className="nav-name">{loc(row.site.name, lang)}</span>
                        <small>{coordText(row.site, lang)}</small>
                        {mode === 'sites' && (
                          <button
                            type="button"
                            className="mn-btn mn-btn-ghost nav-remove"
                            aria-label={tx(lang, tpl`${loc(row.site.name, lang)} satırını kaldır`, tpl`Remove ${loc(row.site.name, lang)}`)}
                            onClick={() => setSites(sites.filter((s) => coordKey(s) !== coordKey(row.site)))}
                          >
                            ×
                          </button>
                        )}
                      </th>
                      {t
                        ? ALL_METRICS.map((m) => <td key={m.id}>{m.cell(t.summary, lang)}</td>)
                        : <td colSpan={ALL_METRICS.length} className="nav-pending">{tx(lang, 'Hesaplanıyor…', 'Computing…')}</td>}
                    </tr>
                    <tr className="nav-strip-row">
                      <td>
                        <button type="button" className="mn-btn mn-btn-amber nav-go" onClick={() => game.visitSite(row.site, row.jdTT)}>
                          {tx(lang, 'Oraya git →', 'Go there →')}
                        </button>
                      </td>
                      <td colSpan={ALL_METRICS.length}>{t && <TimelineStrip t={t} lang={lang} />}</td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="nav-source">
          {tx(
            lang,
            tpl`Güneş ve Dünya konumları astronomy-engine ile hesaplanır (JPL Horizons DE441 ile sınandı). Ufuk çizgisi, Ay’ın eğriliği dahil LRO LOLA küresel haritasından gelir (piksel başına yaklaşık 1,9 km): kilometrelerce uzaktaki sırtlar ve kraterler hesaba girer, iniş aracının hemen yanındaki küçük kraterler ve kayalar girmez. Yüzeyde telemetri çevrenizdeki araziyi kullanır; bu yüzden kutuplara yakın yerlerde sayıları farklı olabilir. Hava yok, dolayısıyla kırılma yok. Panel gücü telemetrideki gibi: Güneş’e dönük 1 m² panel, %${PANEL_EFFICIENCY * 100} verim, Güneş diskinin görünen payıyla çarpılır. Saatler UTC.`,
            tpl`Sun and Earth positions computed with astronomy-engine (tested against JPL Horizons DE441). The skyline comes from the LRO LOLA global map (about 1.9 km per pixel), including the Moon’s curvature: ridges and craters kilometres away are included, small craters and rocks next to a lander are not. On the surface, the telemetry uses the terrain around you, so near the poles its numbers can differ. No air, so no refraction. Panel power as in the telemetry: a 1 m² panel facing the Sun at ${PANEL_EFFICIENCY * 100} % efficiency, times the visible share of the Sun’s disc. Times in UTC.`,
          )}
        </p>
      </div>
    </div>
  );
}
