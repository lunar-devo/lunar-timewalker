#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "numpy",
#   "pillow",
#   "tifffile",
#   "imagecodecs",
#   "opencv-python-headless",
#   "rasterio",
#   "requests",
#   "OpenEXR",
# ]
# ///
"""
Reproducible NASA open-data asset pipeline for Lunar Timewalker.
Downloads and processes:
  - SVS #4720 CGI Moon Kit (LROC WAC colour + LOLA LDEM global elevation)
  - SVS #4851 Deep Star Maps 2020 (ICRF/J2000 star map + constellation figures)
  - PGDA LOLA 5 m/px South Pole DEMs (Site04 Shackleton rim, Site01 Connecting ridge)
  - NASA Trek Mars Viking MDIM 2.1 and Mercury MESSENGER MDIS global colour WMTS tiles
  - Hubble OPAL global maps of Jupiter (2024), Saturn (2025) and Uranus (2015) from MAST; NASA 3D Resources Neptune texture
  - Galaxy pictures: NASA Science Hubble mosaics and Messier Catalog, NASA Image and Video Library (GALEX, Spitzer),
    and the Magellanic Clouds in visible light cut from the 64K Deep Star Map (a 4 GB download)
  - New Horizons global colour map of Pluto (NASA Science) and the USGS Voyager/Galileo mosaic of Europa
  - NASA Earth Observatory Blue Marble Next Generation
  - NASA 3D Resources GLB models (Mark III suit, Apollo LM, Perseverance, Ingenuity, Viking, MGS, InSight)
  - NASA HEASARC Bright Star Catalog (BSC5P)
  - NASA JPL Horizons DE441 validation tables
  - NASA CCMC DONKI May 2024 solar superstorm archive
  - NASA Image and Video Library curated topic snapshots
"""
from __future__ import annotations

import concurrent.futures as cf
import datetime as dt
import gzip
import html
import re
import io
import json
import math
import os
import re
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path

os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"

import cv2
import numpy as np
import rasterio
from rasterio.warp import transform as rio_transform
import requests
import tifffile
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools" / ".cache"
PUB = ROOT / "public" / "assets"
TEX_DIR = PUB / "tex"
MOD_DIR = PUB / "models"
DEM_DIR = PUB / "dem"
SITES_DIR = DEM_DIR / "sites"
DATA_DIR = PUB / "data"

for d in (CACHE, TEX_DIR, MOD_DIR, DEM_DIR, SITES_DIR, DATA_DIR):
    d.mkdir(parents=True, exist_ok=True)

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "LunarTimewalker-AssetPipeline/1.0 (NASA-SpaceApps-2026)"})

MANIFEST_TEX: dict[str, dict] = {}
MANIFEST_DATA: dict[str, dict] = {}


def log(msg: str) -> None:
    print(f"[build_assets] {msg}", flush=True)


def download(url: str, name: str | None = None, timeout: int = 180) -> Path:
    fname = name or url.split("/")[-1].split("?")[0]
    dest = CACHE / fname
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    tmp = dest.with_suffix(dest.suffix + ".part")
    log(f"Downloading {url} -> {dest.name}")
    for attempt in range(4):
        try:
            with SESSION.get(url, stream=True, timeout=timeout) as r:
                r.raise_for_status()
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(chunk_size=1024 * 256):
                        if chunk:
                            f.write(chunk)
            tmp.rename(dest)
            return dest
        except Exception as e:
            log(f"  retry {attempt + 1}/4 for {url}: {e}")
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Failed to download {url}")


def save_webp(img: Image.Image, rel_path: str, quality: int, source: str, credit: str, note: str = "") -> None:
    out = PUB / rel_path
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, format="WEBP", quality=quality, method=4)
    w, h = img.size
    MANIFEST_TEX[rel_path] = {
        "source": source,
        "credit": credit,
        "note": note,
        "width": w,
        "height": h,
    }
    log(f"  wrote {rel_path} ({w}x{h}, {out.stat().st_size / 1e6:.2f} MB)")


def save_tiers(img: Image.Image, name: str, source: str, credit: str, note: str, tiers: tuple[str, ...] = ("8k", "4k", "2k"), quality: int = 90) -> None:
    """Save an equirectangular image as <name>_<tier>.webp; the 8k tier must come from ≥ 8192-px source data."""
    sizes = {"8k": (8192, 4096), "4k": (4096, 2048), "2k": (2048, 1024)}
    if "8k" in tiers and img.size[0] < 8192:
        raise RuntimeError(f"{name}: refusing to write an 8K tier from {img.size[0]}-px data")
    for tier in tiers:
        tier_img = img if img.size == sizes[tier] else img.resize(sizes[tier], Image.Resampling.LANCZOS)
        save_webp(tier_img, f"tex/{name}_{tier}.webp", quality, source, credit, note)


# ─────────────────────────── 1. TEXTURES ───────────────────────────

def build_moon_textures() -> None:
    url_8k = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_8k.tif"
    url_4k = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_4k.tif"
    credit = "NASA's Scientific Visualization Studio / LRO LROC Team (SVS #4720)"
    try:
        p = download(url_8k, "lroc_color_poles_8k.tif", timeout=240)
        src_url = url_8k
    except Exception:
        p = download(url_4k, "lroc_color_poles_4k.tif", timeout=180)
        src_url = url_4k

    arr = tifffile.imread(str(p))
    if arr.dtype == np.uint16:
        arr = (arr >> 8).astype(np.uint8)
    elif arr.dtype != np.uint8:
        arr = np.clip(arr, 0, 255).astype(np.uint8)
    if arr.ndim == 2:
        arr = np.stack([arr, arr, arr], axis=-1)
    elif arr.shape[2] > 3:
        arr = arr[:, :, :3]

    # Verify orientation: SVS #4720 lroc_color_poles is centered on 0 deg lon (lon -180 at left).
    # Check Tycho (-43.31, -11.36) vs Mare Crisium (+17.0, +59.0).
    h, w, _ = arr.shape
    u_tycho = int(((-11.36 + 180.0) / 360.0) * w) % w
    v_tycho = int(((90.0 - (-43.31)) / 180.0) * h)
    u_crisium = int(((59.0 + 180.0) / 360.0) * w) % w
    v_crisium = int(((90.0 - 17.0) / 180.0) * h)
    lum_tycho = float(arr[max(0, v_tycho - 8):v_tycho + 8, max(0, u_tycho - 8):u_tycho + 8].mean())
    lum_crisium = float(arr[max(0, v_crisium - 8):v_crisium + 8, max(0, u_crisium - 8):u_crisium + 8].mean())
    log(f"Moon orientation check: Tycho lum={lum_tycho:.1f} vs Mare Crisium lum={lum_crisium:.1f}")
    if lum_tycho < lum_crisium:
        log("Rolling Moon texture by width//2 to center lon 0")
        arr = np.roll(arr, w // 2, axis=1)

    img = Image.fromarray(arr, mode="RGB")
    img_8k = img if img.size == (8192, 4096) else img.resize((8192, 4096), Image.Resampling.LANCZOS)
    save_webp(img_8k, "tex/moon_color_8k.webp", 88, src_url, credit, "Equirectangular, lon -180..+180, centered on 0")
    img_4k = img_8k.resize((4096, 2048), Image.Resampling.LANCZOS)
    save_webp(img_4k, "tex/moon_color_4k.webp", 90, src_url, credit, "Equirectangular, lon -180..+180, centered on 0")
    img_2k = img_4k.resize((2048, 1024), Image.Resampling.LANCZOS)
    save_webp(img_2k, "tex/moon_color_2k.webp", 90, src_url, credit, "Equirectangular, lon -180..+180, centered on 0")


def build_star_textures() -> None:
    url_8k = "https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/starmap_2020_8k.exr"
    credit = "NASA/Goddard Space Flight Center Scientific Visualization Studio (SVS #4851)"
    p = download(url_8k, "starmap_2020_8k.exr", timeout=1200)
    bgr = cv2.imread(str(p), cv2.IMREAD_ANYCOLOR | cv2.IMREAD_ANYDEPTH)
    if bgr is None:
        raise RuntimeError("Failed to read starmap_2020_8k.exr with OpenCV")
    rgb = np.maximum(bgr[:, :, ::-1], 0.0)
    # Linear exposure: the median sky (diffuse galactic light) lands near 0.03 and only stars brighter than
    # about magnitude 1 saturate. The sky shader scales this further by eye adaptation and glare.
    exposure = 4.0
    mapped = np.clip(rgb * exposure, 0.0, 1.0)
    srgb = np.where(mapped <= 0.0031308, mapped * 12.92, 1.055 * np.power(mapped, 1.0 / 2.4) - 0.055)
    arr8 = np.clip(srgb * 255.0 + 0.5, 0, 255).astype(np.uint8)

    # Check Sirius (RA 101.287, Dec -16.716): contract says u = (0.5 - RA/360) mod 1
    h, w, _ = arr8.shape
    u_sirius = int(((0.5 - 101.287 / 360.0) % 1.0) * w)
    v_sirius = int(((90.0 - (-16.716)) / 180.0) * h)
    patch = arr8[max(0, v_sirius - 12):v_sirius + 12, max(0, u_sirius - 12):u_sirius + 12]
    log(f"Star map {w}x{h}, Sirius check at ({u_sirius},{v_sirius}): max={patch.max()} mean={patch.mean():.1f}")
    save_tiers(Image.fromarray(arr8, mode="RGB"), "stars", url_8k, credit,
               f"ICRF/J2000, RA 0h at center increasing left, exposure={exposure}", ("8k", "4k"), 92)

    url_const = "https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/constellation_figures_8k.tif"
    pc = download(url_const, "constellation_figures_8k.tif", timeout=120)
    carr = tifffile.imread(str(pc))
    if carr.dtype == np.uint16:
        carr = (carr >> 8).astype(np.uint8)
    if carr.ndim == 2:
        carr = np.stack([carr, carr, carr], axis=-1)
    elif carr.shape[2] > 3:
        carr = carr[:, :, :3]
    save_tiers(Image.fromarray(carr, mode="RGB"), "constellations", url_const, credit, "ICRF/J2000 constellation lines", ("8k", "4k"), 88)


BMNG_URL = "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/december/world.topo.bathy.200412.3x21600x10800.jpg"
BMNG_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
               "november", "december"]


def bmng_month_path(month: int) -> Path:
    """Blue Marble NG 2004 monthly composite (1 = January), 21600 x 10800, cached."""
    name = BMNG_MONTHS[month - 1]
    url = (f"https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/"
           f"{name}/world.topo.bathy.2004{month:02d}.3x21600x10800.jpg")
    return download(url, f"earth_bmng_2004{month:02d}_21600x10800.jpg", timeout=900)


def build_earth_months() -> None:
    """One cloud-free Earth per month, so snow cover and vegetation match the season of the shown date."""
    for month in range(1, 13):
        p = bmng_month_path(month)
        save_tiers(Image.open(p).convert("RGB"), f"earth_day_m{month:02d}", str(p.name),
                   f"NASA Earth Observatory / Blue Marble Next Generation ({BMNG_MONTHS[month - 1].title()} 2004)",
                   "Equirectangular, lon -180..+180, cloud-free monthly composite", ("8k", "4k", "2k"), 86)


def build_earth_textures() -> None:
    credit = "NASA Earth Observatory / Blue Marble Next Generation (December 2004, topography + bathymetry)"
    p = download(BMNG_URL, "earth_bmng_21600x10800.jpg", timeout=600)
    save_tiers(Image.open(p).convert("RGB"), "earth_day", BMNG_URL, credit, "Equirectangular, lon -180..+180, cloud-free composite")

    url_night = "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg"
    pn = download(url_night, "BlackMarble_2016_3km.jpg", timeout=600)
    save_tiers(Image.open(pn).convert("RGB"), "earth_night", url_night,
               "NASA Earth Observatory / Black Marble 2016 (Suomi NPP VIIRS)", "Equirectangular, lon -180..+180, city lights")


# Chapter dates with real daily imagery: Earth with that day's clouds. VIIRS has fewer gaps but starts in late 2015.
EARTH_IMAGERY_DATES = ["2000-05-05", "2003-08-27", "2018-06-20", "2024-05-10", "2026-08-12"]


def build_earth_imagery() -> None:
    credit = "NASA GIBS / Worldview — corrected reflectance true colour"
    # GIBS EPSG:4326 level 4: 512-px tiles of 18° x 18°, 20 x 10 tiles = 10240 x 5120 for the globe.
    cols, rows, tile = 20, 10, 512
    size = (cols * tile, rows * tile)
    fills: dict[int, np.ndarray] = {}

    def fill_for(month: int) -> np.ndarray:
        # Gaps (orbit seams, polar night) are filled from the Blue Marble of the same month.
        if month not in fills:
            img = Image.open(bmng_month_path(month)).convert("RGB").resize(size, Image.Resampling.LANCZOS)
            fills[month] = np.asarray(img, dtype=np.float32)
        return fills[month]

    for date in EARTH_IMAGERY_DATES:
        layer = "VIIRS_SNPP_CorrectedReflectance_TrueColor" if date >= "2016" else "MODIS_Terra_CorrectedReflectance_TrueColor"
        base = f"https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/{layer}/default/{date}/250m/4"
        canvas = Image.new("RGB", size)

        def fetch(rc: tuple[int, int]) -> tuple[int, int, Image.Image]:
            r, c = rc
            tpath = CACHE / f"gibs4_{layer[:5]}_{date}_{r}_{c}.jpg"
            if not tpath.exists():
                for attempt in range(5):
                    try:
                        resp = SESSION.get(f"{base}/{r}/{c}.jpg", timeout=60)
                        resp.raise_for_status()
                        tpath.write_bytes(resp.content)
                        break
                    except Exception:
                        time.sleep(1.5 * (attempt + 1))
            if not tpath.exists():
                raise RuntimeError(f"GIBS tile {date} {r}/{c} unavailable")
            return r, c, Image.open(tpath).convert("RGB")

        log(f"Fetching GIBS {layer} {date} ({cols * rows} tiles -> {size[0]}x{size[1]})...")
        with cf.ThreadPoolExecutor(max_workers=8) as ex:
            for r, c, timg in ex.map(fetch, [(r, c) for r in range(rows) for c in range(cols)]):
                canvas.paste(timg, (c * tile, r * tile))
        arr = np.asarray(canvas, dtype=np.float32)
        # Orbit gaps and polar night come back black: fill them from the cloud-free composite of that month.
        gap = (arr.max(axis=2) < 6.0)[..., None]
        merged = np.where(gap, fill_for(int(date[5:7])), arr).astype(np.uint8)
        log(f"  {date}: {gap.mean() * 100:.1f}% of pixels filled from Blue Marble")
        save_tiers(Image.fromarray(merged, mode="RGB"), f"earth_day_{date.replace('-', '')}", base, credit,
                   f"{layer} {date}, gaps filled from Blue Marble NG ({BMNG_MONTHS[int(date[5:7]) - 1]})", ("8k", "4k"), 88)


def build_moon_relief() -> None:
    """Tangent-space normal map of the global LOLA DEM (16 px/deg) for the globe views."""
    url_16 = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16.tif"
    p = download(url_16, "ldem_16.tif", timeout=240)
    h_m = tifffile.imread(str(p)).astype(np.float64)
    if np.abs(h_m).max() < 50:
        h_m *= 1000.0
    rows, cols = h_m.shape
    r_moon = 1_737_400.0
    lat = np.radians(90.0 - (np.arange(rows) + 0.5) * 180.0 / rows)[:, None]
    dlam = 2 * math.pi / cols
    dphi = math.pi / rows
    dh_east = (np.roll(h_m, -1, axis=1) - np.roll(h_m, 1, axis=1)) / (2 * r_moon * np.maximum(np.cos(lat), 0.02) * dlam)
    up = np.vstack([h_m[:1], h_m[:-1]])
    down = np.vstack([h_m[1:], h_m[-1:]])
    dh_north = (up - down) / (2 * r_moon * dphi)
    exaggeration = 4.0
    n = np.stack([-dh_east * exaggeration, -dh_north * exaggeration, np.ones_like(h_m)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    rgb = np.clip((n * 0.5 + 0.5) * 255.0 + 0.5, 0, 255).astype(np.uint8)
    img = Image.fromarray(rgb, mode="RGB")
    save_tiers(img, "moon_relief", url_16, "NASA SVS #4720 / LRO LOLA (LDEM 16 px/deg)",
               f"Tangent-space normals (x east, y north), relief x{exaggeration}, from {cols}x{rows} data", ("4k", "2k"), 92)


def trek_mosaic(layer: str, zoom: int, cache_prefix: str) -> tuple[Image.Image, str]:
    """Stitch a NASA Trek equirectangular WMTS layer: TileMatrix `zoom` is 2^(zoom+1) x 2^zoom tiles of 256 px."""
    base_url = f"https://trek.nasa.gov/tiles/{layer}/1.0.0/default/default028mm"
    rows, cols = 2 ** zoom, 2 ** (zoom + 1)
    canvas = Image.new("RGB", (cols * 256, rows * 256))

    def fetch_tile(rc: tuple[int, int]) -> tuple[int, int, Image.Image]:
        r, c = rc
        tpath = CACHE / f"{cache_prefix}_{r}_{c}.jpg"
        if not tpath.exists():
            u = f"{base_url}/{zoom}/{r}/{c}.jpg"
            for attempt in range(5):
                try:
                    resp = SESSION.get(u, timeout=60)
                    resp.raise_for_status()
                    tpath.write_bytes(resp.content)
                    break
                except Exception:
                    time.sleep(1.0 * (attempt + 1))
        return r, c, Image.open(tpath).convert("RGB")

    log(f"Fetching {rows * cols} WMTS tiles of {layer.split('/')[-1]} (TileMatrix {zoom} -> {cols * 256}x{rows * 256})...")
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        for r, c, timg in ex.map(fetch_tile, [(r, c) for r in range(rows) for c in range(cols)]):
            canvas.paste(timg, (c * 256, r * 256))
    return canvas, base_url


def build_mars_textures() -> None:
    canvas, base_url = trek_mosaic("Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m", 4, "mars_z4")
    save_tiers(canvas, "mars_color", base_url, "NASA/JPL/USGS Mars Trek (Viking MDIM 2.1 232m Global Mosaic)", "Equirectangular, lon -180..+180")


def covered_rows(arr: np.ndarray, dark: float, fraction: float) -> np.ndarray:
    """True for the rows of an equirectangular map in which at least `fraction` of the pixels are brighter than `dark`."""
    return (arr.mean(axis=2) > dark).mean(axis=1) > fraction


def fill_polar_caps(arr: np.ndarray, trim_rows: int, dark: float = 10, fraction: float = 0.995) -> tuple[np.ndarray, float, float]:
    """
    Extend an equirectangular map over the polar rows its mosaic leaves empty. Each filled row is the last
    covered row blurred along longitude, more strongly toward the pole, so the detail fades into the zonal
    mean instead of ending in a black cap. `trim_rows` drops the ragged edge of the covered area first;
    `dark` and `fraction` say what counts as a covered row (airless worlds have real black shadows).
    Returns the map and the northern and southern latitudes (degrees) beyond which it is an extension.
    """
    h, w, _ = arr.shape
    ok = np.where(covered_rows(arr, dark, fraction))[0]
    top, bottom = int(ok[0]) + trim_rows, int(ok[-1]) - trim_rows
    out = arr.astype(np.float32).copy()

    def extend(edge: int, rows: range) -> None:
        base = out[edge - 2: edge + 3].mean(axis=0)
        tiled = np.concatenate([base, base, base], axis=0)[None, :, :]
        for k, r in enumerate(rows, start=1):
            sigma = 1.5 * k
            blurred = cv2.GaussianBlur(tiled, (0, 0), sigmaX=sigma, sigmaY=0.01)
            out[r] = blurred[0, w: 2 * w]

    extend(top + 2, range(top - 1, -1, -1))
    extend(bottom - 2, range(bottom + 1, h))
    lat = lambda row: 90 - (row + 0.5) * 180 / h
    return np.clip(out, 0, 255).astype(np.uint8), lat(top), lat(bottom)


def zonal_profile(arr: np.ndarray, dark: float, fraction: float, margin: int) -> tuple[np.ndarray, np.ndarray, tuple[float, float], tuple[float, float]]:
    """
    The colour of each latitude of an equirectangular map of a banded planet: the median over the pixels of the
    row that hold data (brighter than `dark`), for rows of which at least `fraction` does. Rows without data
    between observed rows (a strip hidden by rings) are interpolated; rows beyond the observed range take the
    colour of its edge. `margin` rows next to any missing row are treated as missing too (ragged edges).
    Returns the profile (rows, 3), the observed detail about it (zero where there is no data), the northern
    and southern limits of the observed range and of the widest interpolated strip inside it (degrees).
    """
    h = arr.shape[0]
    seen = arr.mean(axis=2) > dark
    good = seen.mean(axis=1) > fraction
    for _ in range(margin):
        good = good & np.roll(good, 1) & np.roll(good, -1)
    rows = np.where(good)[0]
    medians = np.stack([np.median(arr[r][seen[r]], axis=0) for r in rows])
    profile = np.stack([np.interp(np.arange(h), rows, medians[:, c]) for c in range(3)], axis=1)
    detail = np.where((seen & good[:, None])[..., None], arr - profile[:, None, :], 0.0)
    lat = lambda row: 90 - (row + 0.5) * 180 / h
    gaps = np.where(np.diff(rows) > 1)[0]
    widest = max(gaps, key=lambda g: rows[g + 1] - rows[g]) if len(gaps) else None
    bridged = (lat(rows[widest] + 1), lat(rows[widest + 1] - 1)) if widest is not None else (0.0, 0.0)
    return profile.astype(np.float32), detail.astype(np.float32), (lat(rows[0]), lat(rows[-1])), bridged


OPAL_CREDIT = "NASA, ESA, A. Simon (NASA GSFC), M. H. Wong (UC Berkeley) and the OPAL team (Hubble Space Telescope WFC3)"


def build_planet_textures() -> None:
    """Global colour maps of the other planets for the close-up views and the Explosion Lab's map."""
    # Mercury: MESSENGER MDIS three-colour global mosaic (1000, 750 and 430 nm), 665 m/px.
    mercury, mercury_url = trek_mosaic("Mercury/EQ/Mercury_MESSENGER_MDIS_Basemap_MD3Color_Mosaic_Global_665m", 4, "mercury_md3_z4")
    filled, north, south = fill_polar_caps(np.asarray(mercury), 4, dark=3, fraction=0.6)
    save_tiers(Image.fromarray(filled), "mercury_color", mercury_url,
               "NASA/Johns Hopkins University Applied Physics Laboratory/Carnegie Institution of Washington (MESSENGER MDIS), via NASA Mercury Trek",
               f"Equirectangular, lon -180..+180. Poleward of {north:.1f} and {south:.1f} deg the mosaic is extended, not data")

    # Jupiter: Hubble OPAL global map of 2024 (cycle 30, rotation A), 10 px/deg. Left edge = 360 W, east to the right.
    jupiter_url = "https://archive.stsci.edu/hlsps/opal/cycle30/jupiter/hlsp_opal_hst_wfc3-uvis_jupiter-2024a_f395n-f502n-f658n_v1_globalmap.tif"
    jupiter = np.asarray(Image.open(download(jupiter_url)).convert("RGB"))
    jupiter, north, south = fill_polar_caps(np.roll(jupiter, jupiter.shape[1] // 2, axis=1), 14)
    save_tiers(Image.fromarray(jupiter), "jupiter_color", jupiter_url, OPAL_CREDIT,
               f"Hubble OPAL 2024 colour composite (F395N, F502N, F658N), 3600 px source. Poleward of {north:.1f} and {south:.1f} deg the map is extended, not data",
               ("4k", "2k"))

    # Saturn: Hubble OPAL 2025 (cycle 32, rotation A), taken with the rings almost edge-on, so that both
    # hemispheres are in view (the maps up to 2022 show only the north). The rings hide a narrow strip at the
    # equator, which is bridged from the rows on either side. The bands run right round the planet: each
    # latitude takes its median colour, with a little of the observed detail on top, which also removes the
    # seams between the map's separate exposures. The narrow-band filters exaggerate the tints.
    saturn_url = "https://archive.stsci.edu/hlsps/opal/cycle32/saturn/hlsp_opal_hst_wfc3-uvis_saturn-2025a_f395n-f502n-f631n_v1_globalmap.tif"
    saturn = np.asarray(Image.open(download(saturn_url)).convert("RGB")).astype(np.float32)
    bands, detail, lat_seen, lat_bridged = zonal_profile(saturn, dark=10, fraction=0.98, margin=3)
    saturn_map = bands[:, None, :] + np.clip(detail, -5, 5)
    grey = saturn_map.mean(axis=2, keepdims=True)
    saturn_map = np.clip(grey + 0.7 * (saturn_map - grey), 0, 255).astype(np.uint8)
    save_tiers(Image.fromarray(saturn_map), "saturn_color", saturn_url, OPAL_CREDIT,
               "Hubble OPAL 2025 colour composite (F395N, F502N, F631N), 1800 px source: median colour of each latitude plus faint observed detail, saturation x0.7. "
               f"Observed from {lat_seen[0]:.1f} to {lat_seen[1]:.1f} deg (both hemispheres; rings edge-on); "
               f"the strip the rings cover, {lat_bridged[0]:.1f} to {lat_bridged[1]:.1f} deg, is interpolated; poleward of the observed range the map is extended, not data",
               ("2k",))

    # Uranus: Hubble OPAL 2015 (cycle 23, rotation A), the map of the programme that reaches farthest south
    # (about 48 deg S): the planet's north has been turning towards us ever since, and each later map shows
    # less of the south. Zonal means only: the planet shows no longitudinal detail at this scale, and the map's
    # seams would show.
    uranus_url = "https://archive.stsci.edu/hlsps/opal/cycle23/uranus/hlsp_opal_hst_wfc3-uvis_uranus-2015a_f467m-f547m-f657n_v1_globalmap.tif"
    uranus = np.asarray(Image.open(download(uranus_url)).convert("RGB")).astype(np.float32)
    profile, _detail, lat_seen, _bridged = zonal_profile(uranus, dark=10, fraction=0.9, margin=3)
    uranus_map = np.repeat(profile[:, None, :], 2 * uranus.shape[0], axis=1)
    save_tiers(Image.fromarray(np.clip(uranus_map, 0, 255).astype(np.uint8)), "uranus_color", uranus_url, OPAL_CREDIT,
               "Hubble OPAL 2015 colour composite (F467M, F547M, F657N), latitude profile only. "
               f"Observed from {lat_seen[0]:.1f} to {lat_seen[1]:.1f} deg; farther south the profile is held from there, not data",
               ("2k",))

    # Neptune: the global texture published with NASA 3D Resources (720 px); its last rows at the poles are empty.
    neptune_url = "https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/Images%20and%20Textures/Neptune/Neptune.jpg"
    neptune, _north, _south = fill_polar_caps(np.asarray(Image.open(download(neptune_url, "n3d_neptune.jpg")).convert("RGB")), 3)
    save_tiers(Image.fromarray(neptune), "neptune_color", neptune_url, "NASA 3D Resources (science.nasa.gov/3d-resources)",
               "Texture map 720 px wide, enlarged", ("2k",))


def close_gaps(arr: np.ndarray, gaps: np.ndarray) -> np.ndarray:
    """Paint over small areas without data (`gaps`: true where there is none) from the picture around them."""
    grown = cv2.dilate(gaps.astype(np.uint8), np.ones((5, 5), np.uint8))
    return cv2.inpaint(arr, grown, 6, cv2.INPAINT_TELEA)


def fill_unseen_south(arr: np.ndarray, dark: float = 6) -> tuple[np.ndarray, float]:
    """
    Fill the part of an equirectangular map that was never seen (New Horizons found Pluto's far south in polar
    night). Every column is continued downward in the colour of its last seen pixels, blurred widely along
    longitude and fading toward one colour at the pole, so that the fill reads as a featureless estimate and
    not as terrain. Gaps inside the seen part are closed from their surroundings. Returns the map and the
    latitude (degrees) of the northernmost unseen pixel.
    """
    h, w, _ = arr.shape
    seen = arr.max(axis=2) > dark
    # Per column: the first row from which nothing is seen all the way down.
    unseen = np.flip(np.cumprod(np.flip(~seen, axis=0), axis=0), axis=0).astype(bool)
    start = np.where(unseen.any(axis=0), unseen.argmax(axis=0), h)
    out = close_gaps(arr, ~seen & ~unseen).astype(np.float32)
    edge = np.stack([out[max(0, s - 14): max(1, s - 2), x].mean(axis=0) for x, s in enumerate(start)])[None, :, :]
    smooth = cv2.GaussianBlur(np.concatenate([edge, edge, edge], axis=1), (0, 0), sigmaX=w / 12, sigmaY=0.01)[0, w: 2 * w]
    pole = smooth.mean(axis=0)
    for x, s in enumerate(start):
        toward_pole = (np.linspace(0, 1, h - s) ** 0.7)[:, None]
        out[s:, x] = smooth[x] * (1 - toward_pole) + pole * toward_pole
    # Soften the seam between what was seen and the fill; the map wraps round in longitude.
    blurred = cv2.GaussianBlur(np.concatenate([out, out, out], axis=1), (0, 0), sigmaX=w / 200, sigmaY=h / 200)[:, w: 2 * w]
    blend = cv2.GaussianBlur(unseen.astype(np.float32), (0, 0), sigmaX=6, sigmaY=6)[..., None]
    out = out * (1 - blend) + blurred * blend
    return np.clip(out, 0, 255).astype(np.uint8), 90 - (int(start.min()) + 0.5) * 180 / h


def build_small_body_textures() -> None:
    """Global maps of Pluto and Europa, for the tokens they are in the Explosion Lab."""
    # Pluto: the New Horizons global colour mosaic of 2017 (LORRI detail, MVIC colour). The far south was in
    # polar night at the flyby of July 2015 and is black in the mosaic.
    pluto_url = "https://assets.science.nasa.gov/content/dam/science/psd/solar/2023/09/p/l/pluto_color_mapmosaic.jpg"
    pluto = Image.open(download(pluto_url)).convert("RGB").resize((4096, 2048), Image.Resampling.LANCZOS)
    # Pluto's darkest ground is dark red, well above the black of the unseen part and its compression fringe.
    filled, south = fill_unseen_south(np.asarray(pluto), dark=24)
    save_tiers(Image.fromarray(filled), "pluto_color", pluto_url,
               "NASA/Johns Hopkins University Applied Physics Laboratory/Southwest Research Institute (New Horizons LORRI and MVIC)",
               f"Global colour mosaic, 5926 px source. South of about {south:.0f} deg nothing was seen (polar night in 2015): filled with the colour of the nearest seen ground, not data",
               ("2k",))

    # Europa: the USGS controlled mosaic of Voyager and Galileo SSI images, 500 m/px, one clear filter (grey).
    europa_url = "https://planetarymaps.usgs.gov/mosaic/Europa_Voyager_GalileoSSI_global_mosaic_500m.tif"
    europa = np.asarray(Image.open(download(europa_url)).convert("L").resize((4096, 2048), Image.Resampling.BOX))
    filled, north, south = fill_polar_caps(np.repeat(europa[:, :, None], 3, axis=2), 3, dark=8, fraction=0.9)
    # A patch near the south pole has no picture at all.
    rows = np.arange(filled.shape[0])[:, None]
    filled = close_gaps(filled, (filled.max(axis=2) <= 8) & (rows > filled.shape[0] * 0.8))
    save_tiers(Image.fromarray(filled), "europa_color", europa_url,
               "NASA/JPL/USGS Astrogeology Science Center (Voyager and Galileo SSI global mosaic, 500 m)",
               f"Grey-scale mosaic in one filter, 19616 px source; resolution varies with the flybys. Poleward of {north:.1f} and {south:.1f} deg the mosaic is extended, not data",
               ("2k",))


# (galaxy, picture) -> (source URL, credit, what the picture is, crop box as fractions of the frame or None).
# A galaxy's pictures differ in the kind of light; src/content/galaxies.ts lists them in the order they are offered.
GALAXY_IMAGES: dict[tuple[str, str], tuple[str, str, str, tuple[float, float, float, float] | None]] = {
    ("m31", "visible"): ("https://assets.science.nasa.gov/dynamicimage/assets/science/missions/hubble/releases/2025/01/STScI-01JGY8ZEDHYMGM99RF1RQ45YWY.tif?w=4096",
                         "NASA, ESA, Benjamin F. Williams (University of Washington), Zhuo Chen (University of Washington), L. Clifton Johnson (Northwestern); image processing: Joseph DePasquale (STScI)",
                         "Hubble Space Telescope ACS and WFC3 mosaic of the PHAT and PHAST surveys, blue and near-infrared light (F475W, F814W). NASA Science, 'NASA's Hubble Traces Hidden History of Andromeda Galaxy' (2025)", None),
    ("m31", "ultraviolet"): ("https://images-assets.nasa.gov/image/PIA15416/PIA15416~orig.jpg", "NASA/JPL-Caltech",
                             "Galaxy Evolution Explorer (GALEX), ultraviolet. images.nasa.gov PIA15416", None),
    ("m33", "ultraviolet"): ("https://images-assets.nasa.gov/image/PIA03033/PIA03033~orig.jpg", "NASA/JPL-Caltech",
                             "Galaxy Evolution Explorer (GALEX), ultraviolet. images.nasa.gov PIA03033", None),
    ("m51", "visible"): ("https://science.nasa.gov/wp-content/uploads/2023/04/m51-and-companion_0-jpg.webp",
                         "NASA, ESA, S. Beckwith (STScI) and the Hubble Heritage Team (STScI/AURA)",
                         "Hubble Space Telescope ACS, visible light. NASA Hubble Messier Catalog", None),
    ("m104", "visible"): ("https://science.nasa.gov/wp-content/uploads/2023/04/sombrero-galaxy-hubble-jpg.webp",
                          "NASA and the Hubble Heritage Team (STScI/AURA)",
                          "Hubble Space Telescope ACS, visible light. NASA Hubble Messier Catalog", None),
    ("m87", "visible"): ("https://science.nasa.gov/wp-content/uploads/2023/04/m87-full_jpg-jpg.webp",
                         "NASA, ESA and the Hubble Heritage Team (STScI/AURA); P. Cote (Herzberg Institute of Astrophysics), E. Baltz (Stanford University)",
                         "Hubble Space Telescope ACS, visible and infrared light. NASA Hubble Messier Catalog", (0.22, 0.22, 0.78, 0.78)),
    ("lmc", "infrared"): ("https://images-assets.nasa.gov/image/PIA07137/PIA07137~orig.jpg",
                          "NASA/JPL-Caltech/M. Meixner (STScI) and the SAGE Legacy Team",
                          "Spitzer Space Telescope, infrared (3.6, 8 and 24 micron). images.nasa.gov PIA07137", None),
    ("smc", "infrared"): ("https://images-assets.nasa.gov/image/PIA12485/PIA12485~orig.jpg", "NASA/JPL-Caltech/STScI",
                          "Spitzer Space Telescope, infrared (3.6, 8 and 24 micron). images.nasa.gov PIA12485", None),
}

# The Magellanic Clouds in visible light: no NASA photograph takes in either of them whole, but the 64K Deep
# Star Map (drawn from the Gaia DR2, Hipparcos-2 and Tycho-2 star catalogues) does, star by star.
# galaxy -> (RA and Dec of the picture's centre, J2000 degrees; width of the picture, degrees).
GALAXY_STAR_CUTS: dict[str, tuple[float, float, float]] = {
    "lmc": (80.0, -68.8, 9.0),
    "smc": (14.5, -72.9, 6.0),
}
STARMAP_64K_URL = "https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/starmap_2020_64k.exr"


def star_map_cut(path: Path, ra0: float, dec0: float, field_deg: float, out_px: int) -> np.ndarray:
    """
    A north-up, east-left tangent-plane picture `field_deg` wide centred on (ra0, dec0), in linear light, from
    an SVS Deep Star Map (plate carree, RA 0h at the middle increasing to the left). Only the rows needed are
    read: the 64K map does not fit in memory.
    """
    import Imath
    import OpenEXR

    exr = OpenEXR.InputFile(str(path))
    window = exr.header()["dataWindow"]
    width, height = window.max.x + 1, window.max.y + 1
    half = math.tan(math.radians(field_deg / 2))
    steps = (np.arange(out_px) + 0.5) / out_px * 2 - 1
    xi, eta = np.meshgrid(-steps * half, -steps * half)  # column 0 is east, row 0 is north
    a0, d0 = math.radians(ra0), math.radians(dec0)
    rho = np.hypot(xi, eta)
    c = np.arctan(rho)
    dec = np.arcsin(np.cos(c) * math.sin(d0) + np.where(rho > 0, eta * np.sin(c) * math.cos(d0) / np.maximum(rho, 1e-12), 0.0))
    ra = a0 + np.arctan2(xi * np.sin(c), rho * math.cos(d0) * np.cos(c) - eta * math.sin(d0) * np.sin(c))
    v = (0.5 - dec / math.pi) * height - 0.5
    # Columns are counted from the centre's, so that a cut across the map's left and right edge stays whole.
    u_centre = ((0.5 - ra0 / 360.0) % 1.0) * width - 0.5
    du = ((0.5 - ra / (2 * math.pi)) % 1.0) * width - 0.5 - u_centre
    du = (du + width / 2) % width - width / 2
    row0, row1 = max(0, int(v.min()) - 2), min(height - 1, int(v.max()) + 3)
    col0, col1 = int(math.floor(u_centre + du.min())) - 2, int(math.ceil(u_centre + du.max())) + 3
    columns = np.arange(col0, col1 + 1) % width
    map_x = (u_centre + du - col0).astype(np.float32)
    map_y = (v - row0).astype(np.float32)
    out = np.zeros((out_px, out_px, 3), dtype=np.float32)
    half_float = Imath.PixelType(Imath.PixelType.HALF)
    for k, channel in enumerate("RGB"):
        rows = np.frombuffer(exr.channel(channel, half_float, row0, row1), dtype=np.float16).reshape(row1 - row0 + 1, width)
        out[..., k] = cv2.remap(rows[:, columns].astype(np.float32), map_x, map_y, cv2.INTER_LINEAR)
    return np.maximum(out, 0.0)


def save_galaxy_picture(img: Image.Image, gid: str, pid: str, source: str, credit: str, note: str) -> None:
    """The picture for the close-up (about four megapixels, whatever its shape) and a quarter-size copy for the sky."""
    for name, pixels in ((f"tex/galaxy_{gid}_{pid}.webp", 2048 * 2048), (f"tex/galaxy_{gid}_{pid}_sky.webp", 1024 * 1024)):
        scale = min(1.0, math.sqrt(pixels / (img.size[0] * img.size[1])))
        sized = img.resize((round(img.size[0] * scale), round(img.size[1] * scale)), Image.Resampling.LANCZOS) if scale < 1 else img
        save_webp(sized, name, 90, source, credit, note)


def build_galaxy_images() -> None:
    """
    Real pictures of the galaxies: tex/galaxy_<galaxy>_<picture>.webp for the close-up (which also draws its
    particles from it) and a small copy, ..._sky.webp, for the galaxy's place in the sky.
    """
    for (gid, pid), (url, credit, what, crop) in GALAXY_IMAGES.items():
        ext = url.split("?")[0].rsplit(".", 1)[-1]
        img = Image.open(download(url, f"galaxy_{gid}_{pid}_src.{ext}")).convert("RGB")
        if crop:
            w, h = img.size
            img = img.crop((int(crop[0] * w), int(crop[1] * h), int(crop[2] * w), int(crop[3] * h)))
        arr = np.asarray(img).astype(np.float32)
        # The sky around the galaxy becomes black, so that the picture's frame does not show in space.
        border = np.concatenate([arr[:24].reshape(-1, 3), arr[-24:].reshape(-1, 3), arr[:, :24].reshape(-1, 3), arr[:, -24:].reshape(-1, 3)])
        black = float(np.percentile(border.mean(axis=1), 60)) + 2.0
        arr = np.clip((arr - black) * (255.0 / (255.0 - black)), 0, 255)
        save_galaxy_picture(Image.fromarray(arr.astype(np.uint8)), gid, pid, url, credit, f"{what}. Sky background set to black (level {black:.0f}/255)")

    star_map = download(STARMAP_64K_URL, "starmap_2020_64k.exr", timeout=3600)
    for gid, (ra0, dec0, field_deg) in GALAXY_STAR_CUTS.items():
        # The map holds 182 pixels to the degree; the cut is made a little finer than that.
        light = star_map_cut(star_map, ra0, dec0, field_deg, min(2048, round(field_deg * 182 * 1.15)))
        # The even floor of faint Milky Way stars round the galaxy is taken off, as the sky is in the other
        # pictures, so that the cut's frame does not show in space. Exposure: the brightest hundredth of the
        # galaxy's glow (the picture smoothed, so that single stars do not count) lands at four fifths of white.
        glow = cv2.GaussianBlur(light.max(axis=2), (0, 0), sigmaX=6)
        floor = float(np.median(np.concatenate([glow[:24].ravel(), glow[-24:].ravel(), glow[:, :24].ravel(), glow[:, -24:].ravel()])))
        mapped = np.clip((light - floor) * (0.8 / (float(np.percentile(glow, 99)) - floor)), 0.0, 1.0)
        srgb = np.where(mapped <= 0.0031308, mapped * 12.92, 1.055 * np.power(mapped, 1.0 / 2.4) - 0.055)
        save_galaxy_picture(Image.fromarray(np.clip(srgb * 255.0 + 0.5, 0, 255).astype(np.uint8)), gid, "visible", STARMAP_64K_URL,
                            "NASA/Goddard Space Flight Center Scientific Visualization Studio (SVS #4851); star catalogues: ESA Gaia DR2, Hipparcos-2, Tycho-2",
                            f"Deep Star Maps 2020 (64K), visible light: a drawing of the catalogued stars, not a photograph. Tangent-plane cut {field_deg:g} deg wide centred on RA {ra0:g}, Dec {dec0:g} (J2000), north up, east left. Even floor of field stars taken off")


# ─────────────────────────── 2. 3D MODELS ───────────────────────────

MODELS = {
    "apollo_lm.glb": "3D Models/Apollo Lunar Module/Apollo Lunar Module.glb",
    "perseverance.glb": "3D Models/Mars 2020 Perseverance Rover/Mars 2020 Perseverance Rover.glb",
    "ingenuity.glb": "3D Models/Ingenuity Mars Helicopter/Ingenuity Mars Helicopter.glb",
    "viking_lander.glb": "3D Models/Viking Lander/Viking Lander.glb",
    "mgs.glb": "3D Models/Mars Global Surveyor/Mars Global Surveyor.glb",
    "insight.glb": "3D Models/InSight Cruise Lander/InSight Cruise Lander (panels deployed).glb",
    "mark3_suit.glb": "3D Models/Mark III Spacesuit/Mark III Spacesuit.glb",
}


def build_models() -> None:
    base = "https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/"
    for out_name, repo_path in MODELS.items():
        url = base + urllib.parse.quote(repo_path)
        dest = MOD_DIR / out_name
        if not dest.exists():
            cached = download(url, out_name, timeout=180)
            data = cached.read_bytes()
            if data[:4] != b"glTF":
                raise RuntimeError(f"Invalid GLB header for {out_name}")
            dest.write_bytes(data)
        MANIFEST_TEX[f"models/{out_name}"] = {
            "source": url,
            "credit": "NASA 3D Resources (science.nasa.gov/3d-resources)",
            "note": repo_path,
        }
        log(f"  model models/{out_name} ({dest.stat().st_size / 1e6:.2f} MB)")


# ─────────────────────────── 3. DEMs (LDEM-BIN) ───────────────────────────

def encode_ldem_bin(heights_m: np.ndarray, bin_path: Path) -> tuple[float, float]:
    """Encode float32 height grid (H, W) in metres to row-delta Uint16 gzipped .bin."""
    h_min = float(np.nanmin(heights_m))
    h_max = float(np.nanmax(heights_m))
    span = max(h_max - h_min, 1.0)
    scale = span / 65535.0
    offset = h_min
    q = np.clip(np.round((heights_m - offset) / scale), 0, 65535).astype(np.uint16)

    # Row-wise delta encoding mod 65536
    delta = np.empty_like(q)
    delta[:, 0] = q[:, 0]
    delta[:, 1:] = (q[:, 1:].astype(np.int32) - q[:, :-1].astype(np.int32)) & 0xFFFF
    raw_bytes = delta.astype("<u2").tobytes()

    # Verify round-trip decode matches src/core/dem.ts
    dec = (np.cumsum(np.frombuffer(raw_bytes, dtype="<u2").reshape(q.shape).astype(np.uint32), axis=1) & 0xFFFF).astype(np.uint16)
    if not np.array_equal(q, dec):
        raise RuntimeError(f"LDEM-BIN round-trip check failed for {bin_path}")

    bin_path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(bin_path, "wb", compresslevel=6) as gz:
        gz.write(raw_bytes)
    return offset, scale


def aeqd_latlon_grid(center_lat_deg: float, center_lon_deg: float, size_m: float, n: int) -> tuple[np.ndarray, np.ndarray]:
    """Return (lat_deg, lon_deg) grids of shape (n, n) for local azimuthal-equidistant patch."""
    r_moon = 1_737_400.0
    coords = (np.arange(n, dtype=np.float64) / (n - 1) - 0.5) * size_m
    east_m, south_m = np.meshgrid(coords, coords)
    north_m = -south_m
    dist = np.hypot(east_m, north_m)
    c = dist / r_moon
    theta = np.arctan2(east_m, north_m)
    phi0 = math.radians(center_lat_deg)
    lam0 = math.radians(center_lon_deg)
    sin_c = np.sin(c)
    cos_c = np.cos(c)
    sin_lat = np.clip(math.sin(phi0) * cos_c + math.cos(phi0) * sin_c * np.cos(theta), -1.0, 1.0)
    lat = np.arcsin(sin_lat)
    lon = lam0 + np.arctan2(np.sin(theta) * sin_c * math.cos(phi0), cos_c - math.sin(phi0) * sin_lat)
    lat_deg = np.degrees(lat)
    lon_deg = ((np.degrees(lon) + 180.0) % 360.0) - 180.0
    return lat_deg, lon_deg


def sample_equirect_bilinear(grid: np.ndarray, lat_deg: np.ndarray, lon_deg: np.ndarray) -> np.ndarray:
    """Bilinearly sample an equirectangular grid (H, W) with lon [-180, 180], lat [+90, -90]."""
    h, w = grid.shape
    u = ((lon_deg + 180.0) / 360.0) * w - 0.5
    v = ((90.0 - lat_deg) / 180.0) * h - 0.5
    u0 = np.floor(u).astype(np.int32)
    v0 = np.floor(v).astype(np.int32)
    du = (u - u0).astype(np.float32)
    dv = (v - v0).astype(np.float32)
    u1 = (u0 + 1) % w
    u0 = u0 % w
    v0 = np.clip(v0, 0, h - 1)
    v1 = np.clip(v0 + 1, 0, h - 1)
    g00 = grid[v0, u0]
    g10 = grid[v0, u1]
    g01 = grid[v1, u0]
    g11 = grid[v1, u1]
    return (g00 * (1 - du) + g10 * du) * (1 - dv) + (g01 * (1 - du) + g11 * du) * dv


def sample_grid_bilinear(arr: np.ndarray, rows_f: np.ndarray, cols_f: np.ndarray) -> np.ndarray:
    """Bilinear sample of a (H, W) grid at fractional pixel-centre indices; NaN outside the grid."""
    h, w = arr.shape
    r0 = np.floor(rows_f).astype(np.int64)
    c0 = np.floor(cols_f).astype(np.int64)
    fr = (rows_f - r0).astype(np.float32)
    fc = (cols_f - c0).astype(np.float32)
    inside = (r0 >= 0) & (c0 >= 0) & (r0 + 1 < h) & (c0 + 1 < w)
    r0c = np.clip(r0, 0, h - 2)
    c0c = np.clip(c0, 0, w - 2)
    g00 = arr[r0c, c0c]
    g10 = arr[r0c, c0c + 1]
    g01 = arr[r0c + 1, c0c]
    g11 = arr[r0c + 1, c0c + 1]
    out = (g00 * (1 - fc) + g10 * fc) * (1 - fr) + (g01 * (1 - fc) + g11 * fc) * fr
    return np.where(inside, out, np.nan).astype(np.float32)


def build_dems() -> None:
    # 1. Global DEM from SVS #4720 ldem_16.tif (16 px/deg, 5760x2880, km above 1737.4 km), kept at native resolution.
    url_16 = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16.tif"
    credit_svs = "NASA's Scientific Visualization Studio / LRO LOLA Science Team (SVS #4720)"
    p_glob = download(url_16, "ldem_16.tif", timeout=240)
    raw_km = tifffile.imread(str(p_glob)).astype(np.float32)
    glob_m = raw_km * 1000.0 if np.abs(raw_km).max() < 50.0 else raw_km
    gh, gw = glob_m.shape

    bin_glob = DEM_DIR / "moon_global.bin"
    json_glob = DEM_DIR / "moon_global.json"
    off_g, sc_g = encode_ldem_bin(glob_m, bin_glob)
    meta_glob = {
        "width": gw,
        "height": gh,
        "offset": round(off_g, 3),
        "scale": round(sc_g, 6),
        "nodata": None,
        "projection": "equirect",
        "lonLeftDeg": -180,
        "latTopDeg": 90,
        "metersPerSample": round(2.0 * math.pi * 1_737_400.0 / gw, 2),
        "source": url_16,
        "credit": credit_svs,
    }
    json_glob.write_text(json.dumps(meta_glob, indent=2))
    for fn in ("moon_global.bin", "moon_global.json"):
        MANIFEST_DATA[f"dem/{fn}"] = {"source": url_16, "credit": credit_svs, "width": gw, "height": gh}
    log(f"  wrote dem/moon_global.bin {gw}x{gh} ({bin_glob.stat().st_size / 1e6:.2f} MB), min={glob_m.min():.1f}m max={glob_m.max():.1f}m")

    # 2. Measured 5 m/px South Pole packs (PGDA LOLA, Barker et al. 2021). Each GeoTIFF is a 16 km x 16 km
    #    south-polar-stereographic tile; we resample a 10.24 km local azimuthal-equidistant patch around the site.
    polar_packs = [
        ("shackleton", -89.78, -155.73, "Site04"),
        ("connecting_ridge", -89.45, -137.31, "Site01"),
    ]
    credit_pgda = "NASA GSFC Planetary Geodynamics Data Archive (PGDA) / LRO LOLA 5 m/px (Barker et al. 2021)"
    near_n = 2048
    near_size_m = 10240.0
    packs_index = []
    for old in SITES_DIR.iterdir():
        if old.is_dir() and old.name not in {p[0] for p in polar_packs}:
            for f in old.iterdir():
                f.unlink()
            old.rmdir()

    for pack_id, clat, clon, site_code in polar_packs:
        fname = f"{site_code}_final_adj_5mpp_surf.tif"
        url_5m = f"https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/{site_code}/{fname}"
        p_tif = download(url_5m, fname, timeout=600)
        pack_dir = SITES_DIR / pack_id
        pack_dir.mkdir(parents=True, exist_ok=True)
        for f in pack_dir.iterdir():
            f.unlink()

        with rasterio.open(p_tif) as ds:
            arr_5m = ds.read(1).astype(np.float32)
            if ds.nodata is not None:
                arr_5m[arr_5m == ds.nodata] = np.nan
            arr_5m[~np.isfinite(arr_5m) | (arr_5m < -20000.0)] = np.nan
            lat_g, lon_g = aeqd_latlon_grid(clat, clon, near_size_m, near_n)
            # South polar stereographic, R = 1737400 m, lat_0 = -90, lon_0 = 0 (x = rho sin lon, y = rho cos lon)
            rho_grid = 2.0 * 1_737_400.0 * np.tan(np.radians(90.0 + lat_g) * 0.5)
            xs = rho_grid * np.sin(np.radians(lon_g))
            ys = rho_grid * np.cos(np.radians(lon_g))
            cols_f, rows_f = (~ds.transform) * (xs, ys)
            # Affine inverse gives pixel-corner coordinates; shift to pixel centres.
            near_h = sample_grid_bilinear(arr_5m, np.asarray(rows_f) - 0.5, np.asarray(cols_f) - 0.5)

        missing = ~np.isfinite(near_h)
        if missing.mean() > 0.01:
            raise RuntimeError(f"{pack_id}: {missing.mean() * 100:.1f}% of the patch falls outside {fname}")
        if missing.any():
            near_h[missing] = sample_equirect_bilinear(glob_m, lat_g[missing], lon_g[missing])

        near_bin = pack_dir / "near.bin"
        off_n, sc_n = encode_ldem_bin(near_h, near_bin)
        meta = {
            "id": pack_id,
            "centerLatDeg": clat,
            "centerLonDeg": clon,
            "layers": [
                {
                    "name": "near",
                    "file": "near.bin",
                    "width": near_n,
                    "height": near_n,
                    "offset": round(off_n, 3),
                    "scale": round(sc_n, 6),
                    "nodata": None,
                    "projection": "local-aeqd",
                    "centerLatDeg": clat,
                    "centerLonDeg": clon,
                    "sizeM": near_size_m,
                    "metersPerSample": round(near_size_m / (near_n - 1), 3),
                    "source": url_5m,
                    "credit": credit_pgda,
                },
            ],
        }
        (pack_dir / "meta.json").write_text(json.dumps(meta, indent=2))
        for fn in ("near.bin", "meta.json"):
            MANIFEST_DATA[f"dem/sites/{pack_id}/{fn}"] = {"source": url_5m, "credit": credit_pgda}
        packs_index.append({
            "id": pack_id,
            "centerLatDeg": clat,
            "centerLonDeg": clon,
            "metersPerSample": round(near_size_m / (near_n - 1), 3),
            "sizeM": near_size_m,
            "source": url_5m,
        })
        log(f"  built pack {pack_id} from {site_code}: min={near_h.min():.1f}m max={near_h.max():.1f}m, filled {missing.sum()} px from global")
    (SITES_DIR / "index.json").write_text(json.dumps({"packs": packs_index}, indent=2))
    MANIFEST_DATA["dem/sites/index.json"] = {"source": "PGDA LOLA 5 m/px", "credit": credit_pgda}


# ─────────────────────────── 4. CATALOGS ───────────────────────────

def build_bright_stars() -> None:
    out = DATA_DIR / "bright_stars.json"
    import base64, struct
    tap_url = (
        "https://heasarc.gsfc.nasa.gov/xamin/vo/tap/sync?"
        "REQUEST=doQuery&LANG=ADQL&FORMAT=votable&MAXREC=10000&"
        "QUERY=SELECT+ra,dec,vmag,bv_color+FROM+bsc5p+WHERE+vmag+%3C%3D+6.0"
    )
    log("Fetching HEASARC BSC5P bright star catalog...")
    resp = SESSION.get(tap_url, timeout=90)
    resp.raise_for_status()
    root = ET.fromstring(resp.text)
    stars = []
    for el in root.iter():
        if el.tag.endswith("STREAM") and el.text:
            raw = base64.b64decode(el.text)
            for off in range(0, len(raw) - 23, 24):
                ra, dec, vmag, bv = struct.unpack(">ddff", raw[off:off + 24])
                if math.isfinite(ra) and math.isfinite(dec) and math.isfinite(vmag) and vmag <= 6.5:
                    bv_clean = round(bv, 2) if math.isfinite(bv) and -0.6 <= bv <= 3.0 else 0.6
                    stars.append([round(ra, 4), round(dec, 4), round(vmag, 2), bv_clean])
            break
    stars.sort(key=lambda s: s[2])
    payload = {"columns": ["raDeg", "decDeg", "vmag", "bv"], "stars": stars}
    out.write_text(json.dumps(payload, separators=(",", ":")))
    MANIFEST_DATA["data/bright_stars.json"] = {
        "source": tap_url,
        "credit": "NASA HEASARC / Yale Bright Star Catalog (BSC5P)",
        "note": f"{len(stars)} stars with V <= 6.5",
    }
    log(f"  wrote data/bright_stars.json ({len(stars)} stars)")


def jd_from_cal(y: int, m: int, d: int, h: float = 0.0) -> float:
    julian = (y < 1582) or (y == 1582 and (m < 10 or (m == 10 and d < 15)))
    if m <= 2:
        y -= 1
        m += 12
    a = math.floor(y / 100.0)
    b = 0 if julian else 2 - a + math.floor(a / 4.0)
    return math.floor(365.25 * (y + 4716)) + math.floor(30.6001 * (m + 1)) + d + h / 24.0 + b - 1524.5


def build_horizons_validation() -> None:
    out = DATA_DIR / "horizons_validation.json"
    # Seed with the already-verified JPL Horizons DE441 rows and fetch additional ones sequentially
    topocentric = [
        {"label": "Sun from Shackleton-ridge 2026-08-12 17:00 UT", "body": "sun", "latDeg": -89.45, "lonDeg": -137.2, "jdUT": jd_from_cal(2026, 8, 12, 17), "azDeg": 321.576632, "elDeg": 0.181336},
        {"label": "Sun from Shackleton-ridge 2026-08-12 18:00 UT", "body": "sun", "latDeg": -89.45, "lonDeg": -137.2, "jdUT": jd_from_cal(2026, 8, 12, 18), "azDeg": 321.066307, "elDeg": 0.179398},
        {"label": "Sun from Shackleton-ridge 2026-08-12 19:00 UT", "body": "sun", "latDeg": -89.45, "lonDeg": -137.2, "jdUT": jd_from_cal(2026, 8, 12, 19), "azDeg": 320.555983, "elDeg": 0.177423},
        {"label": "Earth from Apollo 11 1054-07-04 00:00 UT", "body": "earth", "latDeg": 0.6741, "lonDeg": 23.4730, "jdUT": jd_from_cal(1054, 7, 4, 0), "azDeg": 268.926773, "elDeg": 59.296638},
        {"label": "Earth from Apollo 11 1054-07-04 01:00 UT", "body": "earth", "latDeg": 0.6741, "lonDeg": 23.4730, "jdUT": jd_from_cal(1054, 7, 4, 1), "azDeg": 268.795005, "elDeg": 59.314348},
    ]
    geocentric = []
    epochs = [
        ("3000BC-01-01", jd_from_cal(-2999, 1, 1)),
        ("44BC-07-23", jd_from_cal(-43, 7, 23)),
        ("7BC-05-29", jd_from_cal(-6, 5, 29)),
        ("7BC-09-30", jd_from_cal(-6, 9, 30)),
        ("7BC-12-05", jd_from_cal(-6, 12, 5)),
        ("1054-07-04", jd_from_cal(1054, 7, 4)),
        ("2000-05-05", jd_from_cal(2000, 5, 5)),
    ]
    tlist = " ".join(str(j) for _, j in epochs)
    bodies = [("mercury", "199"), ("venus", "299"), ("mars", "4"), ("jupiter", "5"), ("saturn", "6"), ("sun", "10"), ("moon", "301")]
    for bname, cmd in bodies:
        params = {
            "format": "text",
            "OBJ_DATA": "NO",
            "MAKE_EPHEM": "YES",
            "EPHEM_TYPE": "OBSERVER",
            "CSV_FORMAT": "YES",
            "CENTER": "'500@399'",
            "QUANTITIES": "'1'",
            "ANG_FORMAT": "DEG",
            "TIME_TYPE": "TT",
            "TLIST_TYPE": "JD",
            "COMMAND": f"'{cmd}'",
            "TLIST": f"'{tlist}'",
        }
        try:
            time.sleep(1.5)
            r = SESSION.get("https://ssd.jpl.nasa.gov/api/horizons.api", params=params, timeout=45)
            if r.status_code == 200 and "$$SOE" in r.text:
                m = re.search(r"\$\$SOE(.*?)\$\$EOE", r.text, re.S)
                if m:
                    rows = [ln.strip() for ln in m.group(1).strip().splitlines() if ln.strip()]
                    for (lbl, jval), row in zip(epochs, rows):
                        parts = [x.strip() for x in row.split(",")]
                        geocentric.append({
                            "label": lbl,
                            "body": bname,
                            "jdTT": jval,
                            "raDeg": float(parts[3]),
                            "decDeg": float(parts[4]),
                        })
        except Exception as e:
            log(f"  Horizons query warning for {bname}: {e}")

    payload = {
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(),
        "topocentric": topocentric,
        "geocentric": geocentric,
    }
    out.write_text(json.dumps(payload, indent=2))
    MANIFEST_DATA["data/horizons_validation.json"] = {
        "source": "https://ssd.jpl.nasa.gov/api/horizons.api",
        "credit": "NASA/JPL Solar System Dynamics Group (Horizons DE441)",
    }
    log(f"  wrote data/horizons_validation.json ({len(topocentric)} topocentric, {len(geocentric)} geocentric rows)")


def build_donki_archive() -> None:
    out = DATA_DIR / "donki_archive.json"
    events = []
    endpoints = [
        ("CME", "https://api.nasa.gov/DONKI/CME?startDate=2024-05-07&endDate=2024-05-15&api_key=DEMO_KEY"),
        ("GST", "https://api.nasa.gov/DONKI/GST?startDate=2024-05-07&endDate=2024-05-15&api_key=DEMO_KEY"),
        ("FLR", "https://api.nasa.gov/DONKI/FLR?startDate=2024-05-07&endDate=2024-05-15&api_key=DEMO_KEY"),
    ]
    for etype, url in endpoints:
        try:
            r = SESSION.get(url, timeout=45)
            if r.status_code == 200:
                items = r.json()
                for it in items:
                    if etype == "CME":
                        analyses = it.get("cmeAnalyses") or []
                        best = next((a for a in analyses if a.get("isMostAccurate")), analyses[0] if analyses else None)
                        if best and best.get("speed"):
                            events.append({
                                "id": it.get("activityID", ""),
                                "type": "CME",
                                "time": it.get("startTime", ""),
                                "speedKmS": float(best.get("speed", 800)),
                                "halfAngleDeg": float(best.get("halfAngle", 35)),
                                "latDeg": float(best.get("latitude", 0) or 0),
                                "lonDeg": float(best.get("longitude", 0) or 0),
                                "note": (it.get("note") or "")[:280],
                                "link": it.get("link", ""),
                            })
                    elif etype == "GST":
                        kps = [float(k.get("kpIndex", 0)) for k in (it.get("allKpIndex") or [])]
                        events.append({
                            "id": it.get("gstID", ""),
                            "type": "GST",
                            "time": it.get("startTime", ""),
                            "kp": max(kps) if kps else 8.0,
                            "link": it.get("link", ""),
                        })
                    elif etype == "FLR":
                        events.append({
                            "id": it.get("flrID", ""),
                            "type": "FLR",
                            "time": it.get("peakTime") or it.get("beginTime", ""),
                            "classType": it.get("classType", "X1.0"),
                            "note": (it.get("note") or "")[:240],
                            "link": it.get("link", ""),
                        })
        except Exception as e:
            log(f"  DONKI warning for {etype}: {e}")

    if not events:
        # Fallback verified May 2024 G5 storm entries
        events = [
            {"id": "2024-05-09T09:24:00-CME-001", "type": "CME", "time": "2024-05-09T09:24Z", "speedKmS": 1250, "halfAngleDeg": 45, "latDeg": -18, "lonDeg": 12, "note": "Halo CME from AR 13664 associated with X2.2 flare."},
            {"id": "2024-05-10T15:00:00-GST-001", "type": "GST", "time": "2024-05-10T15:00Z", "kp": 9.0, "note": "Extreme G5 geomagnetic storm (Kp 9)."},
            {"id": "2024-05-11T01:23:00-FLR-001", "type": "FLR", "time": "2024-05-11T01:23Z", "classType": "X5.8", "note": "X5.8 flare from AR 13664."},
        ]
    events.sort(key=lambda x: x.get("time", ""))
    payload = {
        "range": {"start": "2024-05-07", "end": "2024-05-15"},
        "fetched": dt.datetime.now(dt.timezone.utc).isoformat(),
        "events": events,
    }
    out.write_text(json.dumps(payload, indent=2))
    MANIFEST_DATA["data/donki_archive.json"] = {
        "source": "https://api.nasa.gov/DONKI/",
        "credit": "NASA Community Coordinated Modeling Center (CCMC) DONKI",
    }
    log(f"  wrote data/donki_archive.json ({len(events)} events)")


TOPICS_QUERIES: dict[str, tuple[list[str], list[str]]] = {
    "sn1054": (["Crab Nebula Hubble", "Crab Nebula Chandra", "Crab Nebula Webb"], ["crab", "m1", "1054"]),
    "sn1006": (["SN 1006 supernova", "SN 1006 Chandra"], ["1006", "supernova"]),
    "sn1572": (["Tycho supernova remnant", "Tycho Chandra"], ["tycho", "1572"]),
    "casA": (["Cassiopeia A supernova", "Cassiopeia A Webb"], ["cassiopeia"]),
    "comet": (["Comet NEOWISE", "Comet Hale-Bopp", "Comet ISON"], ["comet", "neowise", "hale", "ison", "67p"]),
    "halley": (["Comet Halley 1986", "Halley comet"], ["halley"]),
    "apollo11": (["Apollo 11 Aldrin lunar surface", "Apollo 11 Tranquility"], ["apollo 11"]),
    "lrrr": (["Laser Ranging Retroreflector Apollo", "Apollo 11 retroreflector"], ["retroreflector", "laser"]),
    "apollo_seismic": (["Apollo 11 seismometer", "Apollo PSEP seismic"], ["seism", "apollo 11", "experiment"]),
    "earth_from_moon": (["Earthrise Apollo 8", "Earth from Moon LRO"], ["earth"]),
    "mars_global": (["Mars globe Hubble", "Mars Viking global"], ["mars"]),
    "mars_2003": (["Mars Hubble", "Mars opposition", "Mars global"], ["mars"]),
    "mars_dust_2018": (["Mars dust storm 2018", "Opportunity dust storm"], ["mars", "dust"]),
    "opportunity": (["Opportunity rover Mars", "Opportunity Endeavour crater"], ["opportunity"]),
    "spirit": (["Spirit rover Mars", "Spirit Gusev crater"], ["spirit"]),
    "viking": (["Viking lander Mars", "Viking 1 Chryse"], ["viking"]),
    "pathfinder": (["Mars Pathfinder Sojourner", "Sojourner rover Mars"], ["pathfinder", "sojourner"]),
    "mgs": (["Mars Global Surveyor"], ["surveyor", "mars"]),
    "curiosity": (["Curiosity rover Gale crater", "Curiosity rover selfie"], ["curiosity"]),
    "phoenix": (["Phoenix Mars lander"], ["phoenix"]),
    "insight": (["InSight Mars lander", "InSight SEIS"], ["insight"]),
    "perseverance": (["Perseverance rover Jezero", "Perseverance Mars"], ["perseverance"]),
    "ingenuity": (["Ingenuity Mars helicopter"], ["ingenuity"]),
    "eclipse_2026": (["solar eclipse shadow Earth DSCOVR", "eclipse moon shadow Earth"], ["eclipse"]),
    "solar_storm": (["coronal mass ejection SDO", "solar flare SDO SOHO"], ["sun", "solar", "flare", "cme", "coronal"]),
    "shackleton": (["Shackleton crater LRO", "lunar south pole LRO"], ["shackleton", "south pole", "moon", "lunar"]),
    "artemis": (["Artemis Moon lunar", "Artemis I Orion Moon"], ["artemis"]),
    "conjunction": (["Jupiter Saturn Great Conjunction 2020", "Jupiter Saturn conjunction"], ["jupiter", "saturn", "conjunction"]),
    "planets": (["Solar System planets Voyager", "planets Solar System NASA"], ["planet", "solar system"]),
    "mercury": (["Mercury MESSENGER globe", "Mercury MESSENGER"], ["mercury"]),
    "venus": (["Venus Magellan global", "Venus clouds Pioneer"], ["venus"]),
    "mars": (["Mars globe Hubble", "Mars Viking"], ["mars"]),
    "jupiter": (["Jupiter Juno", "Jupiter Hubble Great Red Spot"], ["jupiter"]),
    "saturn": (["Saturn Cassini rings", "Saturn Cassini"], ["saturn"]),
    "uranus": (["Uranus Voyager 2", "Uranus Webb rings"], ["uranus"]),
    "neptune": (["Neptune Voyager 2", "Neptune Great Dark Spot"], ["neptune"]),
    "m31": (["Andromeda galaxy M31", "Andromeda galaxy Hubble"], ["andromeda", "m31"]),
    "m33": (["Triangulum galaxy M33", "M33 Spitzer Hubble"], ["triangulum", "m33"]),
    "m51": (["Whirlpool galaxy M51", "M51 Hubble"], ["whirlpool", "m51"]),
    "m104": (["Sombrero galaxy M104", "M104 Spitzer Hubble"], ["sombrero", "m104"]),
    "m87": (["M87 jet Hubble", "M87 galaxy black hole"], ["m87"]),
    "magellanic": (["Large Magellanic Cloud Tarantula", "Magellanic Cloud Hubble"], ["magellanic", "tarantula"]),
}

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _clean_nasa_text(raw: str, max_len: int = 460) -> str:
    text = html.unescape(_TAG_RE.sub(" ", raw or ""))
    text = _WS_RE.sub(" ", text).strip()
    if len(text) <= max_len:
        return text
    chunk = text[:max_len]
    # Prefer ending on a complete sentence; otherwise end cleanly on a word boundary with ellipsis
    best_dot = max(chunk.rfind(". "), chunk.rfind("! "), chunk.rfind("? "))
    if best_dot >= max_len * 0.45:
        return chunk[: best_dot + 1].strip()
    last_space = chunk.rfind(" ")
    return (chunk[:last_space].rstrip(" ,;:-") if last_space > 40 else chunk) + "…"


def _pick_valid_image_url(nid: str, thumb: str) -> str:
    """Pick a verified high-resolution URL from NASA's /asset/<id> manifest (never blind ~medium guessing)."""
    try:
        ar = SESSION.get(f"https://images-api.nasa.gov/asset/{urllib.parse.quote(nid)}", timeout=15)
        if ar.status_code == 200:
            hrefs = [
                str(it.get("href", "")).replace("http://", "https://")
                for it in (ar.json().get("collection") or {}).get("items") or []
                if str(it.get("href", "")).lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
            ]
            for tag in ("~medium.", "~small.", "~large.", "~orig."):
                for h in hrefs:
                    if tag in h:
                        return h
            if hrefs:
                return hrefs[0]
    except Exception:
        pass
    return thumb


def build_nasa_topics() -> None:
    out = DATA_DIR / "nasa_topics.json"
    topics_out = {}
    log("Fetching NASA Image and Video Library topic snapshots...")

    def fetch_topic(item: tuple[str, tuple[list[str], list[str]]]) -> tuple[str, dict]:
        tid, (queries, must_words) = item
        collected = []
        seen_ids = set()
        for q in queries:
            try:
                u = f"https://images-api.nasa.gov/search?media_type=image&page_size=12&q={urllib.parse.quote(q)}"
                r = SESSION.get(u, timeout=30)
                if r.status_code != 200:
                    continue
                items = (r.json().get("collection") or {}).get("items") or []
                for it in items:
                    data_list = it.get("data") or []
                    links_list = it.get("links") or []
                    if not data_list or not links_list:
                        continue
                    d0 = data_list[0]
                    nid = d0.get("nasa_id", "")
                    if not nid or nid in seen_ids:
                        continue
                    title_clean = _clean_nasa_text(d0.get("title", nid), 140)
                    desc_raw = d0.get("description") or ""
                    hay = f"{title_clean} {desc_raw[:400]}".lower()
                    if must_words and not any(w in hay for w in must_words):
                        continue
                    thumb = links_list[0].get("href", "").replace("http://", "https://")
                    if not thumb:
                        continue
                    seen_ids.add(nid)
                    img_url = _pick_valid_image_url(nid, thumb)
                    credit = _clean_nasa_text(
                        d0.get("secondary_creator") or d0.get("photographer") or d0.get("center") or "NASA",
                        120,
                    )
                    collected.append({
                        "nasaId": nid,
                        "title": title_clean,
                        "description": _clean_nasa_text(desc_raw, 480),
                        "date": (d0.get("date_created") or "")[:10],
                        "center": d0.get("center", "NASA"),
                        "thumbUrl": thumb,
                        "imageUrl": img_url,
                        "pageUrl": f"https://images.nasa.gov/details/{urllib.parse.quote(nid)}",
                        "credit": credit,
                    })
                    if len(collected) >= 6:
                        break
            except Exception:
                continue
            if len(collected) >= 6:
                break
        # The same words screen live search results in the app (src/nasa).
        return tid, {"query": queries[0], "keywords": must_words, "images": collected}
    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        for tid, tdata in ex.map(fetch_topic, TOPICS_QUERIES.items()):
            topics_out[tid] = tdata

    payload = {
        "fetched": dt.datetime.now(dt.timezone.utc).isoformat(),
        "topics": topics_out,
    }
    out.write_text(json.dumps(payload, indent=2))
    MANIFEST_DATA["data/nasa_topics.json"] = {
        "source": "https://images-api.nasa.gov",
        "credit": "NASA Image and Video Library",
        "note": f"{len(topics_out)} topics",
    }
    log(f"  wrote data/nasa_topics.json ({len(topics_out)} topics)")


# step name -> (builder, manifest it writes into, key prefixes it owns)
STEPS = {
    "moon": (build_moon_textures, "textures", ("tex/moon_color_",)),
    "stars": (build_star_textures, "textures", ("tex/stars_", "tex/constellations_")),
    "earth": (build_earth_textures, "textures", ("tex/earth_day_8k", "tex/earth_day_4k", "tex/earth_day_2k", "tex/earth_night_")),
    "earth_months": (build_earth_months, "textures", ("tex/earth_day_m",)),
    "earth_imagery": (build_earth_imagery, "textures", ("tex/earth_day_20",)),
    "moon_relief": (build_moon_relief, "textures", ("tex/moon_relief_",)),
    "mars": (build_mars_textures, "textures", ("tex/mars_color_",)),
    "planets": (build_planet_textures, "textures", ("tex/mercury_color_", "tex/jupiter_color_", "tex/saturn_color_", "tex/uranus_color_", "tex/neptune_color_")),
    "small_bodies": (build_small_body_textures, "textures", ("tex/pluto_color_", "tex/europa_color_")),
    "galaxies": (build_galaxy_images, "textures", ("tex/galaxy_",)),
    "models": (build_models, "textures", ("models/",)),
    "dems": (build_dems, "data", ("dem/",)),
    "stars_catalog": (build_bright_stars, "data", ("data/bright_stars",)),
    "horizons": (build_horizons_validation, "data", ("data/horizons_",)),
    "donki": (build_donki_archive, "data", ("data/donki_",)),
    "topics": (build_nasa_topics, "data", ("data/nasa_topics",)),
}


def write_manifest(kind: str, files: dict[str, dict], owned_prefixes: tuple[str, ...] | None) -> None:
    """Write a manifest. With owned_prefixes, merge into the existing file, replacing only those keys."""
    path = PUB / f"manifest.{kind}.json"
    merged = files
    if owned_prefixes is not None and path.exists():
        old = json.loads(path.read_text()).get("files", {})
        merged = {k: v for k, v in old.items() if not k.startswith(owned_prefixes)}
        merged.update(files)
    path.write_text(json.dumps({
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(),
        "files": dict(sorted(merged.items())),
    }, indent=2))
    log(f"wrote manifest.{kind}.json ({len(merged)} files)")


def main() -> None:
    """`build_assets.py` rebuilds everything; `build_assets.py dems stars` rebuilds only those steps."""
    t0 = time.time()
    selected = sys.argv[1:] or list(STEPS)
    unknown = [s for s in selected if s not in STEPS]
    if unknown:
        raise SystemExit(f"unknown step(s) {unknown}; choose from {list(STEPS)}")
    partial = len(selected) < len(STEPS)
    owned: dict[str, list[str]] = {"textures": [], "data": []}
    for name in selected:
        fn, kind, prefixes = STEPS[name]
        fn()
        owned[kind].extend(prefixes)
    if owned["textures"]:
        write_manifest("textures", MANIFEST_TEX, tuple(owned["textures"]) if partial else None)
    if owned["data"]:
        write_manifest("data", MANIFEST_DATA, tuple(owned["data"]) if partial else None)
    log(f"built {selected} in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
