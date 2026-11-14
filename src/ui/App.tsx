/**
 * Root UI:
 *   - Home menu: Events (with category filters), Galaxies (3D viewer), Worlds (walkable physics),
 *     Explosion Lab, Spectator Mode, Free Exploration, Tutorial
 *   - 3D Moon Map for choosing where to watch an event from
 *   - Loading screen, SurfaceHud, SpaceHud, and clean glass panels
 */
import { useEffect, useMemo, useState } from 'react';
import './theme.css';
import type { EventCategory, L10n, Lang, Quality, SiteDef, WorldId } from '../core/types';
import { fmt, lf, loc, tpl, tx, useLang } from '../core/i18n';
import { useGame } from '../core/store';
import { formatDate } from '../core/time';
import { useDialog } from './useDialog';
import { targetAltAz } from '../astro';
import {
  BODY_NAMES, EVENTS, GALAXIES, SITES, TRANSIENTS, WORLD_ORDER, WORLDS,
} from '../content';
import { game } from '../game/api';
import { SpaceHud, SurfaceHud } from './hud';
import { LangPicker } from './LangPicker';
import { SpectatorBar, TutorialPanel } from './modes';

// ─────────────────────────── Modals ───────────────────────────

function SettingsModal() {
  const lang = useLang();
  const open = useGame((s) => s.panels.settings);
  const settings = useGame((s) => s.settings);
  const gpu = useGame((s) => s.gpu);
  const dialog = useDialog(open);
  if (!open) return null;

  const qualities: Array<{ id: Quality; label: string }> = [
    { id: 'low', label: tx(lang, 'Düşük (2K doku)', 'Low (2K textures)') },
    { id: 'medium', label: tx(lang, 'Orta (4K doku)', 'Medium (4K textures)') },
    { id: 'high', label: tx(lang, 'Yüksek (8K doku)', 'High (8K textures)') },
    { id: 'ultra', label: tx(lang, 'Çok yüksek (8K, ayrıntılı gölge)', 'Very high (8K, detailed shadows)') },
  ];
  const toggles: Array<{ key: 'showConstellations' | 'narration' | 'showLabels' | 'invertY' | 'reducedFlash'; label: L10n }> = [
    { key: 'showConstellations', label: { tr: 'Gökyüzü rehberi: takımyıldızlar, ekliptik ve yıldız adları [C]', en: 'Sky guide: constellations, ecliptic and star names [C]' } },
    { key: 'narration', label: { tr: 'Sesli anlatım (metinleri sesli okur)', en: 'Narration (reads captions aloud)' } },
    { key: 'showLabels', label: { tr: 'Gök cismi ve araç etiketleri', en: 'Labels on sky objects and hardware' } },
    { key: 'invertY', label: { tr: 'Fareyi ters çevir (yukarı/aşağı)', en: 'Invert mouse (up/down)' } },
    { key: 'reducedFlash', label: { tr: 'Parlamaları azalt (ışığa duyarlı kişiler için)', en: 'Reduce flashes (light sensitivity)' } },
  ];

  return (
    <div className="mn-modal-backdrop" onClick={() => game.togglePanel('settings', false)}>
      <div className="mn-modal" ref={dialog} role="dialog" aria-modal="true" aria-label={tx(lang, 'Ayarlar', 'Settings')} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="mn-modal-head">
          <h2 className="mn-modal-title">{tx(lang, 'Ayarlar', 'Settings')}</h2>
          <button type="button" className="mn-btn" onClick={() => game.togglePanel('settings', false)}>
            {tx(lang, 'Kapat', 'Close')}
          </button>
        </div>

        <div className="mn-form-row">
          <span>{tx(lang, 'Dil', 'Language')}</span>
          <LangPicker />
        </div>

        <div className="mn-form-row">
          <span>{tx(lang, 'Görüntü kalitesi', 'Picture quality')}</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {qualities.map((q) => (
              <button
                key={q.id}
                type="button"
                className={`mn-btn ${settings.quality === q.id ? 'mn-btn-primary' : ''}`}
                aria-pressed={settings.quality === q.id}
                onClick={() => game.updateSettings({ quality: q.id })}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mn-form-row">
          <span>{tx(lang, 'Ses (müzik ve efektler) [K]', 'Sound (music and effects) [K]')}</span>
          <input
            type="checkbox"
            aria-label={tx(lang, 'Ses (müzik ve efektler) [K]', 'Sound (music and effects) [K]')}
            checked={settings.soundOn}
            onChange={(e) => game.updateSettings({ soundOn: e.target.checked })}
          />
        </div>

        <div className="mn-form-row">
          <span>{tx(lang, 'Ses düzeyi', 'Volume')}</span>
          <input
            type="range"
            aria-label={tx(lang, 'Ses düzeyi', 'Volume')}
            min={0}
            max={1}
            step={0.05}
            value={settings.masterVolume}
            onChange={(e) => game.updateSettings({ masterVolume: Number(e.target.value) })}
            disabled={!settings.soundOn}
          />
        </div>

        <div className="mn-form-row">
          <span>{tx(lang, 'Fare hassasiyeti', 'Mouse sensitivity')}</span>
          <input
            type="range"
            aria-label={tx(lang, 'Fare hassasiyeti', 'Mouse sensitivity')}
            min={0.3}
            max={2.5}
            step={0.1}
            value={settings.mouseSensitivity}
            onChange={(e) => game.updateSettings({ mouseSensitivity: Number(e.target.value) })}
          />
        </div>

        {toggles.map((t) => (
          <div key={t.key} className="mn-form-row">
            <span>{loc(t.label, lang)}</span>
            <input
              type="checkbox"
              aria-label={loc(t.label, lang)}
              checked={settings[t.key]}
              onChange={(e) => game.updateSettings({ [t.key]: e.target.checked })}
            />
          </div>
        ))}

        {gpu && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--c-dim)' }}>
            {tx(lang, tpl`Ekran kartı: ${gpu.renderer} · En büyük doku: ${gpu.maxTextureSize} px · Ekran: ${gpu.width}×${gpu.height}`, tpl`Graphics card: ${gpu.renderer} · Max texture: ${gpu.maxTextureSize} px · Screen: ${gpu.width}×${gpu.height}`)}
            <br />
            {tx(
              lang,
              tpl`Çizim çözünürlüğü: ${Math.round(window.innerWidth * gpu.pixelRatio)}×${Math.round(window.innerHeight * gpu.pixelRatio)}. Kareler gecikirse kendiliğinden düşer, toparlanınca yeniden yükselir.`,
              tpl`Drawing resolution: ${Math.round(window.innerWidth * gpu.pixelRatio)}×${Math.round(window.innerHeight * gpu.pixelRatio)}. It lowers by itself when frames come late and rises again when there is room.`,
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const HELP_ROWS: Array<{ keys: L10n; does: L10n }> = [
  { keys: { tr: 'Sürükle / Fare', en: 'Drag / Mouse' }, does: { tr: 'Sürükleyerek etrafa bakın (Tab isteğe bağlı fare kilidini açar)', en: 'Drag to look around (Tab toggles optional mouse lock)' } },
  { keys: { tr: 'W A S D / Oklar', en: 'W A S D / Arrows' }, does: { tr: 'Yürü (veya 0g uzayda itki ver)', en: 'Walk (or thrust in 0g space)' } },
  { keys: { tr: 'Shift + W', en: 'Shift + W' }, does: { tr: 'Koş (Ay/Mars’ta küçük sıçramalar; 0g’de hızlı itki)', en: 'Run (small hops on the Moon and Mars; fast thrust in 0g)' } },
  { keys: { tr: 'Boşluk / Q', en: 'Space / Q' }, does: { tr: 'Zıpla (katı yüzeyde) · yüksel / alçal (0g uzayda)', en: 'Jump (solid ground) · rise / descend (0g space)' } },
  { keys: { tr: 'E', en: 'E' }, does: { tr: 'Ortadaki cisim veya araç hakkında bilgi aç', en: 'Open information for the object in view' } },
  { keys: { tr: 'Tıklayın', en: 'Click' }, does: { tr: 'Gökteki bir cisme tıkla: yakın görünümü açılır · Araca tıkla: bilgi kartı açılır', en: 'Click an object in the sky: its close-up view opens · Click hardware: its info card opens' } },
  { keys: { tr: 'F (basılı tut)', en: 'F (hold)' }, does: { tr: 'Güneş’i elle kapat: sönük yıldızlar ve gezegenler belirir', en: 'Shade the Sun with your hand: faint stars and planets appear' } },
  { keys: { tr: 'T + Tekerlek / + −', en: 'T + Wheel / + −' }, does: { tr: 'Teleskop aç/kapat ve yakınlaştır', en: 'Toggle telescope and zoom' } },
  { keys: { tr: 'Enter', en: 'Enter' }, does: { tr: 'Teleskop açıkken ortadaki cismin yakın görünümünü aç', en: 'With the telescope up: open the close-up of the object in the centre' } },
  { keys: { tr: 'C', en: 'C' }, does: { tr: 'Gökyüzü rehberi: takımyıldızlar, ekliptik ve yıldız adları', en: 'Sky guide: constellations, ecliptic and star names' } },
  { keys: { tr: 'U', en: 'U' }, does: { tr: 'Temiz ekran (tahta / projeksiyon için yazıları gizle)', en: 'Clean view (hide controls for projector / board)' } },
  { keys: { tr: 'K', en: 'K' }, does: { tr: 'Sesi aç / kapat', en: 'Sound on / off' } },
  { keys: { tr: 'V / G', en: 'V / G' }, does: { tr: '1. / 3. şahıs görünümü · Kask lambası', en: '1st / 3rd person view · Helmet lamp' } },
  { keys: { tr: 'B', en: 'B' }, does: { tr: 'Ölçüm direği koy (29,5 gün Güneş ve Dünya görünürlüğü)', en: 'Place measuring mast (29.5-day Sun & Earth visibility)' } },
  { keys: { tr: 'M / I / N', en: 'M / I / N' }, does: { tr: 'Ay haritası · NASA görselleri · Veri paneli', en: 'Moon map · NASA images · Data panel' } },
  { keys: { tr: 'P', en: 'P' }, does: { tr: '8K fotoğraf kaydet (7680×4320)', en: 'Save an 8K photo (7680×4320)' } },
  { keys: { tr: '1 … 6 / R', en: '1 … 6 / R' }, does: { tr: 'Zaman hızı · Olayı baştan oynat', en: 'Time speed · Replay event' } },
  { keys: { tr: 'H', en: 'H' }, does: { tr: 'Bu kontrol listesini aç / kapat', en: 'Open / close this list of controls' } },
  { keys: { tr: 'Esc', en: 'Esc' }, does: { tr: 'Açık kartı kapat · Yakın görünümden dön · Yüzeyde menüyü aç', en: 'Close the open card · Leave the close-up · Open the menu on the surface' } },
  { keys: { tr: 'Dokunmatik ekran', en: 'Touch screen' }, does: { tr: 'Tek parmakla sürükle: bak ya da döndür · İki parmak: yakınlaş · Dokun: seç · Ekrandaki oklar: yürü', en: 'Drag with one finger: look or turn · Two fingers: zoom · Tap: choose · On-screen arrows: walk' } },
];

function HelpModal() {
  const lang = useLang();
  const open = useGame((s) => s.panels.help);
  const dialog = useDialog(open);
  if (!open) return null;

  return (
    <div className="mn-modal-backdrop" onClick={() => game.togglePanel('help', false)}>
      <div className="mn-modal" ref={dialog} role="dialog" aria-modal="true" aria-label={tx(lang, 'Kontroller', 'Controls')} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="mn-modal-head">
          <h2 className="mn-modal-title">{tx(lang, 'Kontroller', 'Controls')}</h2>
          <button type="button" className="mn-btn" onClick={() => game.togglePanel('help', false)}>
            {tx(lang, 'Kapat', 'Close')}
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {HELP_ROWS.map((r) => (
            <div key={r.keys.en} className="mn-form-row">
              <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-accent)' }}>{loc(r.keys, lang)}</strong>
              <span style={{ textAlign: 'right' }}>{loc(r.does, lang)}</span>
            </div>
          ))}
        </div>
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--c-dim)' }}>
          {tx(lang, 'Saatler UT (Evrensel Zaman) olarak verilir. Türkiye saati UT + 3 saattir.', 'Times are given in UT (Universal Time).')}
        </p>
      </div>
    </div>
  );
}

const CREDIT_GROUPS: Array<{ title: L10n; items: string[] }> = [
  {
    title: { tr: 'Ay yüzeyi', en: 'Lunar surface' },
    items: [
      'NASA SVS #4720 / LRO LOLA — global elevation (LDEM, 16 px/deg) and relief normal map',
      'NASA GSFC PGDA / LRO LOLA 5 m/px polar DEMs, Site01 & Site04 (Barker et al. 2021)',
      'NASA SVS #4720 / LRO LROC — colour mosaic of the Moon (8K)',
    ],
  },
  {
    title: { tr: 'Gökyüzü, gezegenler ve galaksiler', en: 'Sky, planets and galaxies' },
    items: [
      'NASA SVS #4851 — Deep Star Maps 2020 and constellation figures (8K); the Magellanic Clouds in visible light are cut from its 64K map (star catalogues: ESA Gaia DR2, Hipparcos-2, Tycho-2)',
      'NASA HEASARC — Yale Bright Star Catalogue (BSC5P)',
      'NASA/JPL SSD Horizons (DE441) — ephemeris checks; astronomy-engine (D. Cross, MIT) for live positions',
      'NASA/JPL/USGS Mars Trek — Viking MDIM 2.1 colour mosaic (8K)',
      'NASA/Johns Hopkins APL/Carnegie Institution of Washington — MESSENGER MDIS colour mosaic of Mercury, via NASA Mercury Trek (8K)',
      'NASA, ESA, A. Simon (NASA GSFC), M. H. Wong (UC Berkeley) and the OPAL team — Hubble maps of Jupiter (2024), Saturn (2025; both hemispheres, the strip under the rings bridged) and Uranus (2015; colour by latitude, observed to 49° south)',
      'NASA 3D Resources — Neptune texture map',
      'NASA, ESA, B. F. Williams and Z. Chen (University of Washington), L. C. Johnson (Northwestern); image processing J. DePasquale (STScI) — Hubble mosaic of M31 (PHAT and PHAST surveys, 2025)',
      'NASA/JPL-Caltech — GALEX ultraviolet pictures of M31 (PIA15416) and M33 (PIA03033); Spitzer infrared pictures of the Large Magellanic Cloud (PIA07137; M. Meixner, STScI, and the SAGE Legacy Team) and the Small Magellanic Cloud (PIA12485; STScI)',
      'NASA, ESA and the Hubble Heritage Team (STScI/AURA) — Hubble pictures of M51 (S. Beckwith, STScI), M104 and M87 (P. Cote, E. Baltz)',
      'NASA SkyView (GSFC) — survey images the galaxy pictures were matched with to find their place and turn on the sky (GALEX, IRAS/IRIS, Digitized Sky Survey)',
      'Messier & Magellanic galaxy coordinates and properties from SIMBAD/NED/NASA',
    ],
  },
  {
    title: { tr: 'Dünya', en: 'Earth' },
    items: [
      'NASA Earth Observatory — Blue Marble Next Generation (2004, twelve months) and Black Marble 2016 (Suomi NPP VIIRS)',
      'NASA GIBS / Worldview — MODIS Terra and VIIRS SNPP corrected reflectance for 2000-05-05, 2003-08-27, 2018-06-20, 2024-05-10, 2026-08-12',
    ],
  },
  {
    title: { tr: 'Uzay havası ve arşiv', en: 'Space weather and archive' },
    items: [
      'NASA CCMC DONKI — May 2024 CME and flare records',
      'NASA Image and Video Library — archive images in the info panel',
    ],
  },
  {
    title: { tr: '3B modeller', en: '3D models' },
    items: [
      'NASA 3D Resources — Apollo Lunar Module, Mark III spacesuit, Viking Lander, Mars Global Surveyor, InSight, Perseverance, Ingenuity',
    ],
  },
];

function CreditsModal() {
  const lang = useLang();
  const open = useGame((s) => s.panels.credits);
  const dialog = useDialog(open);
  if (!open) return null;

  return (
    <div className="mn-modal-backdrop" onClick={() => game.togglePanel('credits', false)}>
      <div className="mn-modal" ref={dialog} role="dialog" aria-modal="true" aria-label={tx(lang, 'Veri Kaynakları', 'Data Sources')} tabIndex={-1} style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
        <div className="mn-modal-head">
          <h2 className="mn-modal-title">{tx(lang, 'Veri Kaynakları', 'Data Sources')}</h2>
          <button type="button" className="mn-btn" onClick={() => game.togglePanel('credits', false)}>
            {tx(lang, 'Kapat', 'Close')}
          </button>
        </div>
        <div className="mn-credits">
          <p style={{ margin: 0, color: 'var(--c-dim)' }}>
            {tx(lang, 'Görüntü ve veriler NASA’nın herkese açık arşivlerinden alındı ve uygulamayla birlikte gelir. İnternet bağlantısı varken bilgi paneli NASA Görüntü Kütüphanesi’nden arşiv görselleri de getirir. Hiçbiri canlı yayın değildir. Parlaklık eğrileri, Patlama Laboratuvarı’ndaki etki hesapları, koronal kütle atımlarının ilerleyişi, galaksi görüntülerine verilen 3B derinlik, Venüs’ün ve dev gezegenlerin bulut katmanları, başka gezegenlerdeki zemin ve toz fırtınasının yayılışı eğitim amaçlı modellerdir. Bu proje NASA tarafından onaylanmış değildir.', 'Imagery and data come from NASA’s public archives and ship with the app. When online, the info panel also fetches archive images from the NASA Image Library. None of it is a live feed. Brightness curves, the Explosion Lab’s impact estimates, the travel of coronal mass ejections, the 3D depth given to the galaxy pictures, the cloud decks of Venus and the giant planets, the ground on other planets and the spread of the dust storm are educational models. This project is not endorsed by NASA.')}
          </p>
          {CREDIT_GROUPS.map((g) => (
            <div key={g.title.en}>
              <h3>{loc(g.title, lang)}</h3>
              {/* Credit lines stay as their owners word them, in English, and say so to a screen reader. */}
              <ul lang="en">{g.items.map((it) => <li key={it}>{it}</li>)}</ul>
            </div>
          ))}
          <h3>{tx(lang, 'Ekip', 'Team')}</h3>
          <p style={{ margin: 0 }}>NASA Space Apps Challenge 2026 · Sakarya</p>
        </div>
      </div>
    </div>
  );
}

function PauseModal() {
  const lang = useLang();
  const open = useGame((s) => s.panels.pause);
  const phase = useGame((s) => s.phase);
  const activeEventId = useGame((s) => s.activeEventId);
  const shown = open && (phase === 'surface' || phase === 'space');
  const dialog = useDialog(shown);
  if (!shown) return null;

  const close = (): void => game.togglePanel('pause', false);
  return (
    <div className="mn-modal-backdrop" onClick={close}>
      <div className="mn-modal" ref={dialog} role="dialog" aria-modal="true" aria-label={tx(lang, 'Menü', 'Menu')} tabIndex={-1} style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="mn-modal-head">
          <h2 className="mn-modal-title">{tx(lang, 'Menü', 'Menu')}</h2>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button type="button" className="mn-btn mn-btn-primary" onClick={close}>
            {tx(lang, 'Devam et', 'Continue')}
          </button>
          {activeEventId && (
            <button type="button" className="mn-btn" onClick={() => game.togglePanel('about', true)}>
              {tx(lang, 'Bu olay hakkında', 'About this event')}
            </button>
          )}
          {phase === 'surface' && (
            <button type="button" className="mn-btn" onClick={() => { close(); game.openMap(); }}>
              {tx(lang, 'Harita: konum değiştir [M]', 'Map: change place [M]')}
            </button>
          )}
          <button type="button" className="mn-btn" onClick={() => game.togglePanel('settings', true)}>
            {tx(lang, 'Ayarlar', 'Settings')}
          </button>
          <button type="button" className="mn-btn" onClick={() => game.togglePanel('help', true)}>
            {tx(lang, 'Kontroller', 'Controls')}
          </button>
          <button type="button" className="mn-btn mn-btn-ghost" onClick={() => { close(); game.openMenu(); }}>
            ← {tx(lang, 'Ana menü', 'Home menu')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── Map Screen (phase === 'map') ───────────────────────────

function shortTargetName(id: string, lang: Lang): string {
  if (id in BODY_NAMES) return loc(BODY_NAMES[id as keyof typeof BODY_NAMES], lang);
  const tr = TRANSIENTS.find((t) => t.id === id);
  return tr ? loc(tr.name, lang).split(' (')[0] : id;
}

function MapScreen() {
  const lang = useLang();
  const activeEventId = useGame((s) => s.activeEventId);
  const mapSelection = useGame((s) => s.mapSelection);
  const site = useGame((s) => s.site);
  const clock = useGame((s) => s.clock);
  const mapWorld = useGame((s) => s.mapWorld);

  const activeEvent = EVENTS.find((e) => e.id === activeEventId);

  const siteBadges = useMemo(() => {
    const out: Record<string, { sunUp: boolean; earthUp: boolean; targetEl: number | null }> = {};
    const targetId = activeEvent?.primaryTargetId;
    const transient = targetId ? TRANSIENTS.find((t) => t.id === targetId && t.kind === 'supernova') : undefined;

    for (const s of SITES) {
      const sun = targetAltAz(clock.jdTT, s, 'sun');
      const earth = targetAltAz(clock.jdTT, s, 'earth');
      let targetEl: number | null = null;
      if (targetId && targetId in BODY_NAMES && targetId !== 'sun' && targetId !== 'earth') {
        targetEl = targetAltAz(clock.jdTT, s, targetId as keyof typeof BODY_NAMES).elDeg;
      } else if (transient && transient.kind === 'supernova') {
        targetEl = targetAltAz(clock.jdTT, s, { raDeg: transient.raDeg, decDeg: transient.decDeg }).elDeg;
      }
      out[s.id] = { sunUp: sun.elDeg > 0, earthUp: earth.elDeg > 0, targetEl };
    }
    return out;
  }, [clock.jdTT, activeEvent]);

  const orderedSites = useMemo(() => {
    const rec = new Set(activeEvent?.recommendedSiteIds ?? []);
    return [...SITES].sort((a, b) => (rec.has(b.id) ? 1 : 0) - (rec.has(a.id) ? 1 : 0));
  }, [activeEvent]);

  const selectedSite: SiteDef = mapSelection ?? orderedSites[0];
  const targetName = activeEvent?.primaryTargetId ? shortTargetName(activeEvent.primaryTargetId, lang) : '';
  const moonOnly = activeEvent?.seenFrom === 'moon';
  const elsewhere = mapWorld !== 'moon' && !moonOnly;
  const worldName = WORLDS[mapWorld].name;

  return (
    <div className="mn-map-screen">
      <div className="mn-map-header">
        <div>
          <div className="mn-brand-tag">
            {activeEvent
              ? (tx(lang, 'Nereden izlemek istediğinizi seçin', 'Choose where to watch from'))
              : (tx(lang, 'Serbest dolaşım: bir yer seçin', 'Free exploration: choose a place'))}
          </div>
          <h2 style={{ margin: 0, fontSize: '1.12rem' }}>
            {activeEvent ? loc(activeEvent.title, lang) : (tx(lang, 'Serbest dolaşım', 'Free exploration'))}
            <span style={{ marginLeft: 12, fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--c-accent)' }}>
              {formatDate(clock.jdTT, lang, { time: true, calendarTag: true })}
            </span>
          </h2>
        </div>

        <div className="mn-actions">
          <label className="mn-map-world">
            <span>{activeEvent ? tx(lang, 'İzleme yeri', 'Watch from') : tx(lang, 'Gezegen', 'World')}</span>
            <select
              className="mn-lang"
              value={moonOnly ? 'moon' : mapWorld}
              disabled={moonOnly}
              onChange={(e) => game.setMapWorld(e.target.value as WorldId)}
            >
              {WORLD_ORDER.map((wid) => (
                <option key={wid} value={wid}>{loc(WORLDS[wid].name, lang)}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="mn-btn"
            onClick={() => (site ? game.closeMap() : game.openMenu())}
          >
            {site
              ? (tx(lang, '← Yüzeye dön', '← Back to surface'))
              : (tx(lang, '← Ana menü', '← Home menu'))}
          </button>
          <button
            type="button"
            className="mn-btn mn-btn-amber"
            onClick={() => { game.landAt(selectedSite).catch(() => undefined); }}
          >
            {elsewhere
              ? tx(lang, tpl`${worldName} ortamına git →`, tpl`Go to ${worldName} →`)
              : activeEvent
                ? tx(lang, tpl`Burada izle: ${selectedSite.name} →`, tpl`Watch from here: ${selectedSite.name} →`)
                : tx(lang, tpl`Buraya in: ${selectedSite.name} →`, tpl`Land here: ${selectedSite.name} →`)}
          </button>
        </div>
      </div>

      <div className="mn-map-col">
        {(elsewhere || moonOnly) && (
          <div className="mn-map-note">
            {moonOnly && (
              <p>{tx(lang, 'Bu olay Ay’da geçer; yalnızca Ay’dan izlenir.', 'This event takes place on the Moon and can only be watched from there.')}</p>
            )}
            {elsewhere && (
              <p>
                {tx(
                  lang,
                  tpl`${worldName}: gökyüzü, çekim ve ışık bu gezegen için hesaplanır. Zemin ise seçtiğiniz Ay bölgesinin yükseklik verisinden uyarlanmış bir modeldir.`,
                  tpl`${worldName}: the sky, gravity and light are computed for this planet. The ground is a model adapted from the elevation data of the Moon site you select.`,
                )}
              </p>
            )}
            {elsewhere && activeEvent && activeEvent.staging?.some((s) => s.where === 'surface') && (
              <p>
                {tx(lang, 'Olay için en uygun gözlem yeri kendiliğinden seçilir. Gezegen hızlı döndüğü için gökyüzü yıldızlara sabitlenir: gezegenin her dönüşünde tek kare gösterilir.', 'The best viewing spot for the event is chosen automatically. Because the planet spins quickly, the sky is held to the stars: one frame is shown per rotation of the planet.')}
              </p>
            )}
            {elsewhere && activeEvent?.seenFrom === 'earthMoon' && (
              <p>
                {tx(lang, 'Bu olay, Dünya ve Ay’dan görünen hâliyle anlatılır. Başka bir gezegenden aynı an farklı görünür; orada göreceğiniz, o gezegenin o andaki hesaplanmış gökyüzüdür.', 'This event is described as it appears from Earth and the Moon. From another planet the same moment looks different; what you will see there is that planet’s computed sky at that moment.')}
              </p>
            )}
          </div>
        )}
        {activeEvent ? (
          <>
            <div className="mn-section-label">{tx(lang, 'Bu olay hakkında', 'About this event')}</div>
            {activeEvent.about.map((p) => (
              <p key={p.en} style={{ margin: 0, fontSize: '0.86rem', lineHeight: 1.55, color: '#e2e8f0' }}>
                {loc(p, lang)}
              </p>
            ))}
            <div style={{ borderTop: '1px solid var(--c-line-soft)', paddingTop: 10 }}>
              <div className="mn-section-label" style={{ marginBottom: 6 }}>
                {tx(lang, 'Ne gerçek, ne model?', 'What is real and what is a model?')}
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.8rem', lineHeight: 1.5, color: 'var(--c-dim)' }}>
                {activeEvent.notes.map((n) => (
                  <li key={n.en}>{loc(n, lang)}</li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: '0.86rem', lineHeight: 1.55, color: 'var(--c-dim)' }}>
            {tx(lang, 'Ortadaki Ay küresini sürükleyerek döndürün. Sağdaki listeden bir yer seçin ya da küre üzerinde istediğiniz noktaya tıklayın. İndikten sonra alttaki zaman çubuğuyla istediğiniz tarihe gidebilir, üst çubuktan Mars veya Dünya’ya geçebilirsiniz.', 'Drag the Moon globe to turn it. Pick a site on the right or click anywhere on the sphere. Once on the ground, use the time bar to visit any date or switch worlds from the top bar.')}
          </p>
        )}
      </div>

      <div className="mn-map-center-hint">
        {tx(lang, 'Küreyi sürükleyerek döndürün · Bir noktaya tıklayarak orayı seçin', 'Drag to turn the globe · Click any point to select it')}
      </div>

      <div className="mn-map-col">
        <div className="mn-section-label">
          {activeEvent
            ? (tx(lang, 'Gözlem yerleri (önerilenler üstte)', 'Viewing places (recommended first)'))
            : (tx(lang, 'İniş yerleri', 'Landing places'))}
        </div>

        {selectedSite.id === 'custom' && (
          <div className="mn-site-item is-selected">
            <div style={{ fontWeight: 700, fontSize: '0.86rem' }}>
              {loc(selectedSite.name, lang)}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--c-dim)' }}>
              {loc(selectedSite.blurb, lang)}
            </div>
          </div>
        )}

        <div className="mn-site-list">
          {orderedSites.map((s) => {
            const isSel = selectedSite.id === s.id;
            const b = siteBadges[s.id];
            const isRec = activeEvent?.recommendedSiteIds.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                className={`mn-site-item ${isSel ? 'is-selected' : ''}`}
                onClick={() => game.previewSite(s)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                  <strong style={{ fontSize: '0.86rem', color: '#f8fafc' }}>{loc(s.name, lang)}</strong>
                  {isRec && (
                    <span className="mn-badge ok">
                      {tx(lang, 'Önerilen', 'Recommended')}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--c-dim)' }}>
                  {loc(s.region, lang)} · {fmt(s.latDeg, 2, lang)}°, {fmt(s.lonDeg, 2, lang)}°
                </div>
                <div style={{ fontSize: '0.75rem', color: '#cbd5e1', lineHeight: 1.4 }}>
                  {loc(s.blurb, lang)}
                </div>
                {b && !elsewhere && (
                  <div className="mn-badge-row">
                    {b.targetEl !== null && (
                      <span className={`mn-badge ${b.targetEl > 2 ? 'ok' : 'dim'}`}>
                        {b.targetEl > 0
                          ? `${targetName} +${Math.round(b.targetEl)}°`
                          : tx(lang, tpl`${targetName} ufkun altında`, tpl`${targetName} below horizon`)}
                      </span>
                    )}
                    <span className={`mn-badge ${b.sunUp ? 'warn' : 'ok'}`}>
                      {b.sunUp ? (tx(lang, 'Gündüz', 'Day')) : (tx(lang, 'Gece', 'Night'))}
                    </span>
                    <span className={`mn-badge ${b.earthUp ? 'ok' : 'dim'}`}>
                      {b.earthUp
                        ? (tx(lang, 'Dünya görünür', 'Earth visible'))
                        : (tx(lang, 'Dünya görünmez', 'Earth hidden'))}
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── Home Menu (phase === 'title' | 'menu') ───────────────────────────

type MenuTab = 'events' | 'galaxies' | 'worlds';
type CategoryFilter = 'all' | 'moon_mars' | 'deep' | 'planets' | 'solar_eclipse';

const CATEGORY_MAP: Record<Exclude<CategoryFilter, 'all'>, EventCategory[]> = {
  moon_mars: ['mission', 'mars', 'future'],
  deep: ['supernova', 'comet'],
  planets: ['conjunction'],
  solar_eclipse: ['solar', 'eclipse'],
};

function EventMenuScreen() {
  const lang = useLang();
  const soundOn = useGame((s) => s.settings.soundOn);
  const [tab, setTab] = useState<MenuTab>('events');
  const [cat, setCat] = useState<CategoryFilter>('all');

  const filteredEvents = useMemo(() => {
    if (cat === 'all') return EVENTS;
    const allowed = new Set(CATEGORY_MAP[cat]);
    return EVENTS.filter((e) => allowed.has(e.category));
  }, [cat]);

  const catLabels: Array<{ id: CategoryFilter; label: L10n }> = [
    { id: 'all', label: lf(tpl`Tümü (${EVENTS.length})`, tpl`All (${EVENTS.length})`) },
    { id: 'moon_mars', label: { tr: 'Ay ve Mars', en: 'Moon & Mars' } },
    { id: 'deep', label: { tr: 'Süpernovalar ve Kuyruklu Yıldız', en: 'Supernovae & Comet' } },
    { id: 'planets', label: { tr: 'Gezegen Buluşmaları', en: 'Planetary Conjunctions' } },
    { id: 'solar_eclipse', label: { tr: 'Güneş ve Tutulma', en: 'Sun & Eclipse' } },
  ];

  return (
    <div className="mn-screen">
      <div className="mn-topbar">
        <div className="mn-brand">
          <span className="mn-brand-tag">NASA SPACE APPS CHALLENGE 2026 · SAKARYA</span>
          <h1 className="mn-brand-title">LUNAR TIMEWALKER</h1>
          <p className="mn-brand-sub">
            {tx(lang, 'Gerçek NASA Ay haritası üzerinde dolaşın; tarihteki gökyüzü olaylarını, farklı galaksileri ve patlamaların Dünya’ya ve diğer gezegenlere etkisini sınıfta gösterin ya da kendiniz keşfedin.', 'Walk on real NASA Moon terrain; show historic sky events, galaxies, and how cosmic explosions affect Earth and the other planets, in a classroom or on your own.')}
          </p>
        </div>

        <div className="mn-top-right">
          <div className="mn-actions">
            <button type="button" className="mn-btn mn-btn-ghost" aria-pressed={soundOn} onClick={() => game.updateSettings({ soundOn: !soundOn })}>
              {soundOn ? tx(lang, 'Ses: açık', 'Sound: on') : tx(lang, 'Ses: kapalı', 'Sound: off')}
            </button>
            <button type="button" className="mn-btn mn-btn-ghost" onClick={() => game.togglePanel('settings', true)}>
              {tx(lang, 'Ayarlar', 'Settings')}
            </button>
            <button type="button" className="mn-btn mn-btn-ghost" onClick={() => game.togglePanel('help', true)}>
              {tx(lang, 'Kontroller', 'Controls')}
            </button>
            <button type="button" className="mn-btn mn-btn-ghost" onClick={() => game.togglePanel('credits', true)}>
              {tx(lang, 'Kaynaklar', 'Sources')}
            </button>
            <LangPicker />
          </div>

          {/* The ways in, in the order one would take them: learn the controls, walk about, experiment, sit back. */}
          <div className="mn-actions">
            <button type="button" className="mn-btn" onClick={() => { game.startTutorial().catch(() => undefined); }}>
              {tx(lang, 'Öğretici', 'Tutorial')}
            </button>
            <button type="button" className="mn-btn mn-btn-primary" onClick={() => game.selectEvent(null)}>
              {tx(lang, 'Serbest Dolaşım', 'Free Exploration')}
            </button>
            <button type="button" className="mn-btn" onClick={() => game.openSpaceLab('sn2')}>
              {tx(lang, 'Patlama Laboratuvarı', 'Explosion Lab')}
            </button>
            <button type="button" className="mn-btn mn-btn-amber" onClick={() => { game.startSpectator(0).catch(() => undefined); }}>
              ▶ {tx(lang, 'Seyirci Modu', 'Spectator Mode')}
            </button>
          </div>
        </div>
      </div>

      <div className="mn-nav-row">
        <div className="mn-seg">
          <button type="button" className={`mn-seg-btn ${tab === 'events' ? 'is-active' : ''}`} onClick={() => setTab('events')}>
            {tx(lang, tpl`Olaylar (${EVENTS.length})`, tpl`Events (${EVENTS.length})`)}
          </button>
          <button type="button" className={`mn-seg-btn ${tab === 'galaxies' ? 'is-active' : ''}`} onClick={() => setTab('galaxies')}>
            {tx(lang, tpl`Galaksiler (${GALAXIES.length})`, tpl`Galaxies (${GALAXIES.length})`)}
          </button>
          <button type="button" className={`mn-seg-btn ${tab === 'worlds' ? 'is-active' : ''}`} onClick={() => setTab('worlds')}>
            {tx(lang, tpl`Gezegenler (${WORLD_ORDER.length})`, tpl`Worlds (${WORLD_ORDER.length})`)}
          </button>
        </div>

        {tab === 'events' && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {catLabels.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`mn-seg-btn ${cat === c.id ? 'is-active' : ''}`}
                style={{ border: '1px solid var(--c-line-soft)' }}
                onClick={() => setCat(c.id)}
              >
                {loc(c.label, lang)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mn-chapters-wrap">
        {tab === 'events' && (
          <div className="mn-grid">
            {filteredEvents.map((ev) => (
              <button
                key={ev.id}
                type="button"
                className="mn-card"
                onClick={() => game.selectEvent(ev.id)}
              >
                <div>
                  <div className="mn-card-top">
                    <span>
                      <span className="mn-dot" style={{ background: ev.accent }} />
                      {loc(ev.dateLabel, lang)}
                    </span>
                  </div>
                  <h3 className="mn-card-title">{loc(ev.title, lang)}</h3>
                  <p className="mn-card-teaser">{loc(ev.summary, lang)}</p>
                </div>

                <div className="mn-card-foot">
                  <span>{tx(lang, 'Yer seç ve izle', 'Choose a place and watch')}</span>
                  <span>→</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {tab === 'galaxies' && (
          <div className="mn-grid">
            {GALAXIES.map((g) => (
              <button
                key={g.id}
                type="button"
                className="mn-card"
                onClick={() => game.enterSpaceView(g.id)}
              >
                <div>
                  <div className="mn-card-top">
                    <span>{g.catalogCode}</span>
                    <span>
                      {g.distanceMly < 1
                        ? `${Math.round(g.distanceMly * 1000)} ${tx(lang, 'bin ışık yılı', 'kly')}`
                        : `${fmt(g.distanceMly, 1, lang)} ${tx(lang, 'milyon ly', 'Mly')}`}
                    </span>
                  </div>
                  <h3 className="mn-card-title">{loc(g.name, lang)}</h3>
                  <p className="mn-card-teaser">{loc(g.summary, lang)}</p>
                </div>
                <div className="mn-card-foot">
                  <span>{loc(g.typeLabel, lang)}</span>
                  <span>{tx(lang, '3B Görünüm →', '3D View →')}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {tab === 'worlds' && (
          <div className="mn-grid">
            {WORLD_ORDER.map((wid) => {
              const w = WORLDS[wid];
              const kindLabel = w.solidSurface
                ? (tx(lang, 'Katı yüzey', 'Solid ground'))
                : wid === 'uranus' || wid === 'neptune'
                  ? (tx(lang, 'Buz devi', 'Ice giant'))
                  : (tx(lang, 'Gaz devi', 'Gas giant'));
              return (
                <div key={wid} className="mn-card" onClick={() => game.setWorld(wid)}>
                  <div>
                    <div className="mn-card-top">
                      <span>{w.zeroG ? (tx(lang, 'Sıfır çekim (0g)', 'Zero gravity (0g)')) : `${fmt(w.gravityMs2, 2, lang)} m/s²`}</span>
                      <span>{kindLabel}</span>
                    </div>
                    <h3 className="mn-card-title">{loc(w.name, lang)}</h3>
                    <p className="mn-card-teaser">{loc(w.note, lang)}</p>
                  </div>
                  <div className="mn-card-foot" style={{ paddingTop: 10 }}>
                    <button
                      type="button"
                      className="mn-btn mn-btn-primary"
                      style={{ padding: '5px 10px', fontSize: '0.74rem' }}
                      onClick={(e) => { e.stopPropagation(); game.setWorld(wid); }}
                    >
                      {tx(lang, 'Ortamda Gez →', 'Explore World →')}
                    </button>
                    <button
                      type="button"
                      className="mn-btn"
                      style={{ padding: '5px 10px', fontSize: '0.74rem' }}
                      onClick={(e) => { e.stopPropagation(); game.enterSpaceView(wid); }}
                    >
                      {tx(lang, '3B Küre', '3D Globe')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────── Root App ───────────────────────────

export default function App() {
  const lang = useLang();
  const phase = useGame((s) => s.phase);
  const loading = useGame((s) => s.loading);
  const fatal = useGame((s) => s.fatal);
  const toast = useGame((s) => s.toast);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <>
      {phase === 'boot' && (
        <div className="mn-screen" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
          <div className="mn-brand-tag">NASA SPACE APPS CHALLENGE 2026 · SAKARYA</div>
          <h1 className="mn-brand-title" style={{ marginTop: 8 }}>LUNAR TIMEWALKER</h1>
          {fatal ? (
            <div className="hud-card" style={{ maxWidth: 520, marginTop: 18, borderColor: 'var(--c-bad)' }}>
              <p style={{ color: 'var(--c-bad)', margin: 0 }}>{loc(fatal, lang)}</p>
            </div>
          ) : (
            <div style={{ width: 280, height: 4, background: 'rgba(255,255,255,0.12)', borderRadius: 2, marginTop: 18 }}>
              <div style={{ width: `${Math.round(loading.fraction * 100)}%`, height: '100%', background: 'var(--c-accent)' }} />
            </div>
          )}
        </div>
      )}

      {(phase === 'title' || phase === 'menu') && <EventMenuScreen />}
      {phase === 'map' && <MapScreen />}

      {phase === 'loading' && (
        <div className="mn-screen" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
          <div className="mn-brand-tag">
            {tx(lang, 'NASA LRO / LOLA arazi verisi yükleniyor', 'Loading NASA LRO / LOLA terrain')}
          </div>
          <h2 style={{ margin: '10px 0', fontSize: '1.5rem' }}>
            {loading.label ? loc(loading.label, lang) : (tx(lang, 'Yükleniyor…', 'Loading…'))}
          </h2>
          <div style={{ width: 320, height: 6, background: 'rgba(255,255,255,0.12)', borderRadius: 3 }}>
            <div style={{ width: `${Math.round(loading.fraction * 100)}%`, height: '100%', background: 'var(--c-accent)' }} />
          </div>
        </div>
      )}

      {phase === 'surface' && <SurfaceHud />}
      {phase === 'space' && <SpaceHud />}
      {/* Outside the two HUDs (the menu, the map, the loading screen) a toast is shown here. */}
      {toast && phase !== 'surface' && phase !== 'space' && <div className={`hud-toast is-${toast.kind}`}>{loc(toast.text, lang)}</div>}

      <PauseModal />
      <SettingsModal />
      <HelpModal />
      <CreditsModal />
      <TutorialPanel />
      <SpectatorBar />
    </>
  );
}
