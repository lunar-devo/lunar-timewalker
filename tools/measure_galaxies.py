# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "pillow", "scipy", "astropy", "requests"]
# ///
"""
Measures every galaxy picture made by `build_assets.py galaxies`. The numbers go into `pictures` of each
entry in src/content/galaxies.ts:

  centre                 where the galaxy's centre is in the picture
  northUpDeg, fieldDeg   how the picture is turned on the sky, and how wide it is there
  skyCentre              where on the sky the picture's middle is

    cd tools && uv run measure_galaxies.py [galaxy ...]

Centre: stars are removed with a median filter; the centre is the brightest point of the smoothed light (the
light's own centre of mass for the two Magellanic Clouds, which have no nucleus).

Place on the sky: the picture is laid, at every rotation, both ways round and over a range of scales, on a
north-up survey image of the same field from NASA SkyView (GALEX for the ultraviolet pictures, the IRAS 60
micron survey for the infrared ones, the Digitized Sky Survey for the visible ones). The best match gives
the rotation and the width; none of the pictures turns out mirrored. The picture's middle then follows from
the nucleus, whose coordinates are known (for the Magellanic Clouds, from where the match puts the picture).
Some pictures are placed otherwise:
  - M87 is a featureless ball that cannot be matched. Its jet is used: position angle 290 degrees, the first
    bright knot (A) 12.4 arcseconds from the nucleus.
  - The Hubble mosaic of M31 has a ragged outline that spoils a match. Two points are used: the nucleus and
    the companion galaxy M32, whose coordinates are known.
  - The Sombrero matches as well upside down. It is searched only within a quarter turn of north-up, where the
    dust lane passes south of the nucleus, as it does on the sky.
  - The star-map cuts of the Magellanic Clouds are north-up and of known width by construction
    (GALAXY_STAR_CUTS in build_assets.py).

As a check, the long axis of the light (of its second moments) is printed as a position angle on the sky, to
compare with the published one (majorAxisPaDeg in src/content/galaxies.ts): they agree to a few degrees
wherever the galaxy is elongated enough to have one (not the nearly face-on M51).
"""
import math
import sys
from pathlib import Path

import numpy as np
import requests
from astropy.io import fits
from PIL import Image
from scipy.ndimage import affine_transform, gaussian_filter, median_filter, zoom

HERE = Path(__file__).resolve().parent
TEX = HERE.parent / "public" / "assets" / "tex"
CACHE = HERE / ".cache" / "skyview"
SKYVIEW = "https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl"

# Galaxy -> right ascension and declination of its centre, J2000 degrees (as in src/content/galaxies.ts).
PLACE = {
    "m31": (10.6847, 41.2687), "m33": (23.4621, 30.6602), "m51": (202.4696, 47.1953), "m104": (189.9976, -11.6231),
    "m87": (187.7059, 12.3911), "lmc": (80.8942, -69.7561), "smc": (13.1583, -72.8003),
}
PICTURES = [("m31", "visible"), ("m31", "ultraviolet"), ("m33", "ultraviolet"), ("m51", "visible"), ("m104", "visible"),
            ("m87", "visible"), ("lmc", "visible"), ("lmc", "infrared"), ("smc", "visible"), ("smc", "infrared")]
# Share of the picture's width, from the left, that belongs to the galaxy itself (M51's companion is cut off).
MAIN_PART = {"m51": 0.7}
NO_NUCLEUS = {"lmc", "smc"}
# (galaxy, picture) -> (SkyView survey, width of the survey image in degrees, first guess of the picture's
# width in degrees, the picture's light to match, half-range of rotations searched about north-up).
MATCH = {
    ("m31", "ultraviolet"): ("GALEX Near UV", 7.0, 4.2, "light", 180),
    ("m33", "ultraviolet"): ("GALEX Near UV", 3.0, 1.6, "light", 180),
    ("m51", "visible"): ("DSS2 Red", 0.6, 0.35, "light", 180),
    ("m104", "visible"): ("DSS2 Red", 0.5, 0.26, "light", 90),
    ("lmc", "infrared"): ("IRIS  60", 16.0, 8.0, "dust", 180),
    ("smc", "infrared"): ("IRIS  60", 14.0, 6.0, "dust", 180),
}
# The same as GALAXY_STAR_CUTS in build_assets.py: centre (RA, Dec) and width of the cut, degrees.
STAR_CUTS = {"lmc": (80.0, -68.8, 9.0), "smc": (14.5, -72.9, 6.0)}
# (galaxy, picture) -> coordinates of a companion galaxy that shows in the picture (M32).
COMPANION = {("m31", "visible"): (10.6743, 40.8652)}
JET_PA_DEG = 290.0
JET_KNOT_A_ARCSEC = 12.4
SURVEY_PX = 512   # side of the survey image asked for
WORK_PX = 256     # side it is matched at
PICTURE_PX = 128  # width the picture is matched at


def survey_image(gid: str, pid: str) -> np.ndarray:
    """The north-up, east-left survey image centred on the galaxy, rows from the north."""
    survey, field, _, _, _ = MATCH[(gid, pid)]
    path = CACHE / f"{gid}_{pid}.fits"
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        ra, dec = PLACE[gid]
        print(f"  fetching {survey} {field} deg from SkyView ...", flush=True)
        reply = requests.get(SKYVIEW, params={"Position": f"{ra},{dec}", "Survey": survey, "Pixels": SURVEY_PX, "Size": field,
                                              "Return": "FITS", "Sampler": "LI"}, timeout=300)
        reply.raise_for_status()
        if not reply.content.startswith(b"SIMPLE"):
            raise RuntimeError(f"SkyView did not return a FITS image for {gid} ({survey})")
        path.write_bytes(reply.content)
    return np.nan_to_num(fits.getdata(path).astype(np.float64))[::-1]  # FITS rows run from the south


def structure(a: np.ndarray) -> np.ndarray:
    """What is left of an image between one and twelve pixels in size: its structure, without sky level or glow."""
    a = a - np.percentile(a, 20)
    a = np.arcsinh(np.clip(a, 0, None) / (np.percentile(a, 99.5) / 8 + 1e-9))
    band = gaussian_filter(a, 1.0) - gaussian_filter(a, 12.0)
    return band - band.mean()


def laid(pic: np.ndarray, turn_deg: float, mirrored: bool, scale: float, shape: tuple[int, int]) -> np.ndarray:
    """The picture turned anticlockwise by `turn_deg` (and mirrored), `scale` survey pixels to its own, in the survey's frame."""
    turn = math.radians(turn_deg)
    m = -1.0 if mirrored else 1.0
    back = np.array([[m * math.cos(turn) / scale, m * math.sin(turn) / scale], [-math.sin(turn) / scale, math.cos(turn) / scale]])
    centre_out = np.array([(shape[0] - 1) / 2, (shape[1] - 1) / 2])
    centre_in = np.array([(pic.shape[0] - 1) / 2, (pic.shape[1] - 1) / 2])
    return affine_transform(pic, back, offset=centre_in - back @ centre_out, output_shape=shape, order=1, cval=0.0)


def likeness(ref_f: np.ndarray, ref_norm: float, t: np.ndarray) -> tuple[float, tuple[int, int]]:
    """Best normalised correlation of `t` with the survey over every shift, and that shift."""
    norm = np.linalg.norm(t)
    if norm < 1e-9:
        return -1.0, (0, 0)
    corr = np.fft.irfft2(ref_f * np.conj(np.fft.rfft2(t)), s=t.shape)
    at = np.unravel_index(np.argmax(corr), corr.shape)
    return float(corr[at] / (ref_norm * norm)), (int(at[0]), int(at[1]))


def match_with_survey(gid: str, pid: str, rgb: np.ndarray) -> dict:
    _, ref_field, guess, light, half_range = MATCH[(gid, pid)]
    full = survey_image(gid, pid)
    ref = structure(zoom(full, WORK_PX / full.shape[0], order=1))
    h0, w0, _ = rgb.shape
    small = np.asarray(Image.fromarray((rgb * 255).astype(np.uint8)).resize((PICTURE_PX, max(8, round(PICTURE_PX * h0 / w0))), Image.Resampling.LANCZOS)).astype(np.float64) / 255
    # Infrared pictures show dust in red and green, as the 60 micron survey does; their blue is starlight.
    pic = structure(small[..., 0] + small[..., 1] if light == "dust" else small.max(axis=2))
    ref_f, ref_norm = np.fft.rfft2(ref), float(np.linalg.norm(ref))
    ref_px = ref_field / WORK_PX
    tried = []
    for field in guess * np.geomspace(0.45, 1.8, 15):
        scale = (field / PICTURE_PX) / ref_px
        if PICTURE_PX * scale > WORK_PX * 0.98:
            continue
        for mirrored in (False, True):
            for turn in range(-half_range, half_range, 3):
                s, at = likeness(ref_f, ref_norm, laid(pic, turn, mirrored, scale, ref.shape))
                tried.append((s, float(field), mirrored, float(turn), at))
    best = max(tried, key=lambda r: r[0])
    for field in best[1] * np.linspace(0.93, 1.07, 15):
        scale = (field / PICTURE_PX) / ref_px
        for turn in np.arange(best[3] - 3, best[3] + 3.01, 0.5):
            s, at = likeness(ref_f, ref_norm, laid(pic, float(turn), best[2], scale, ref.shape))
            if s > best[0]:
                best = (s, float(field), best[2], float(turn), at)
    s, field, mirrored, turn, at = best
    other_way = max(r[0] for r in tried if r[2] != mirrored)
    other_turn = max((r[0] for r in tried if r[2] == mirrored and abs((r[3] - turn + 180) % 360 - 180) > 20), default=-1.0)
    rows = (at[0] + WORK_PX // 2) % WORK_PX - WORK_PX // 2
    cols = (at[1] + WORK_PX // 2) % WORK_PX - WORK_PX // 2
    return dict(northUpDeg=turn % 360, fieldDeg=field, mirrored=mirrored, likeness=s, otherWay=other_way, otherTurn=other_turn,
                # Where the match puts the picture's middle, from the galaxy's place: degrees east and north.
                middleEastDeg=-cols * ref_px, middleNorthDeg=-rows * ref_px)


def placement_by(angle_in_picture_deg: float, share_of_width: float, pa_deg: float, separation_deg: float) -> tuple[float, float]:
    """
    northUpDeg and fieldDeg from one direction known both ways: a direction with position angle P lies at
    90 + P - northUp degrees anticlockwise from the picture's right.
    """
    return (90.0 + pa_deg - angle_in_picture_deg) % 360, separation_deg / share_of_width


def jet_placement(rgb: np.ndarray, centre: tuple[float, float]) -> tuple[float, float]:
    """M87's picture from its jet, the only blue light in it."""
    h, w, _ = rgb.shape
    cx, cy = centre[0] * w, centre[1] * h
    blue = np.clip(rgb[..., 2] - rgb[..., 0] * 1.05, 0, None)
    yy, xx = np.mgrid[0:h, 0:w]
    dx, dy = xx - cx, -(yy - cy)
    r = np.hypot(dx, dy)
    jet = (r > 0.02 * w) & (r < 0.2 * w) & (blue > 0.04)
    angle = math.degrees(math.atan2(float((blue[jet] * dy[jet]).sum()), float((blue[jet] * dx[jet]).sum())))
    # Only the jet's bright knots are blue enough to count: A, B and C, outwards. Knot A is the first.
    along = (dx * math.cos(math.radians(angle)) + dy * math.sin(math.radians(angle)))[jet] / w
    bins = np.linspace(0.02, 0.2, 91)
    profile, _ = np.histogram(along, bins=bins, weights=blue[jet])
    first = next(i for i in range(1, len(profile) - 1) if profile[i] >= 0.6 * profile.max() and profile[i] >= profile[i - 1] and profile[i] >= profile[i + 1])
    return placement_by(angle, float(bins[first] + bins[first + 1]) / 2, JET_PA_DEG, JET_KNOT_A_ARCSEC / 3600)


def companion_placement(gid: str, pid: str, rgb: np.ndarray, centre: tuple[float, float]) -> tuple[float, float]:
    """The picture from its nucleus and its companion: the brightest glow well away from the nucleus."""
    h, w, _ = rgb.shape
    glow = gaussian_filter(rgb.max(axis=2), 0.004 * w)
    yy, xx = np.mgrid[0:h, 0:w]
    glow[np.hypot(xx - centre[0] * w, yy - centre[1] * h) < 0.08 * w] = 0
    iy, ix = np.unravel_index(np.argmax(glow), glow.shape)
    dx, dy = (ix - centre[0] * w) / w, -(iy - centre[1] * h) / w
    (ra0, dec0), (ra1, dec1) = PLACE[gid], COMPANION[(gid, pid)]
    east = (ra1 - ra0) * math.cos(math.radians((dec0 + dec1) / 2))
    north = dec1 - dec0
    return placement_by(math.degrees(math.atan2(dy, dx)), math.hypot(dx, dy), math.degrees(math.atan2(east, north)), math.hypot(east, north))


def sky_at(ra0: float, dec0: float, east_deg: float, north_deg: float) -> tuple[float, float]:
    """The point `east_deg`, `north_deg` from (ra0, dec0) on the tangent plane there."""
    xi, eta = math.tan(math.radians(east_deg)), math.tan(math.radians(north_deg))
    a0, d0 = math.radians(ra0), math.radians(dec0)
    rho = math.hypot(xi, eta)
    if rho < 1e-12:
        return ra0, dec0
    c = math.atan(rho)
    dec = math.asin(math.cos(c) * math.sin(d0) + eta * math.sin(c) * math.cos(d0) / rho)
    ra = a0 + math.atan2(xi * math.sin(c), rho * math.cos(d0) * math.cos(c) - eta * math.sin(d0) * math.sin(c))
    return math.degrees(ra) % 360, math.degrees(dec)


def centre_and_axis(gid: str, rgb: np.ndarray) -> tuple[tuple[float, float], float]:
    """The galaxy's centre as shares of the picture's width and height, and its long axis, degrees anticlockwise from the picture's right."""
    h0, w0, _ = rgb.shape
    step = max(1, round(max(w0, h0) / 512))
    light = rgb[::step, ::step].max(axis=2)
    h, w = light.shape
    smooth = median_filter(light, size=9)
    mask = np.ones_like(light)
    mask[:, int(w * MAIN_PART.get(gid, 1.0)):] = 0
    body = np.clip(gaussian_filter(smooth, 3) - np.percentile(smooth, 40), 0, None) * mask
    yy, xx = np.mgrid[0:h, 0:w]
    total = body.sum()
    mx, my = (body * xx).sum() / total, (body * yy).sum() / total
    if gid in NO_NUCLEUS:
        cx, cy = mx, my
    else:
        cy, cx = np.unravel_index(np.argmax(gaussian_filter(smooth * mask, 6)), light.shape)
    dx, dy = xx - mx, yy - my
    moments = np.array([[(body * dx * dx).sum(), (body * dx * dy).sum()], [(body * dx * dy).sum(), (body * dy * dy).sum()]]) / total
    major = np.linalg.eigh(moments)[1][:, 1]
    return (float(cx / w), float(cy / h)), float(np.degrees(np.arctan2(-major[1], major[0])) % 180)


def main() -> None:
    wanted = sys.argv[1:]
    for gid, pid in PICTURES:
        if wanted and gid not in wanted:
            continue
        path = TEX / f"galaxy_{gid}_{pid}.webp"
        if not path.exists():
            print(f"{gid} {pid}: no picture (run build_assets.py galaxies)")
            continue
        rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float64) / 255
        tall = rgb.shape[0] / rgb.shape[1]
        centre, axis = centre_and_axis(gid, rgb)
        middle_offset = None
        if pid == "visible" and gid in STAR_CUTS:
            ra, dec, field = STAR_CUTS[gid]
            north_up, sky_centre = 0.0, (ra, dec)
            how = "star-map cut: placed by construction"
        elif gid == "m87":
            north_up, field = jet_placement(rgb, centre)
            how = "placed by the jet"
        elif (gid, pid) in COMPANION:
            north_up, field = companion_placement(gid, pid, rgb, centre)
            how = "placed by the nucleus and the companion"
        else:
            found = match_with_survey(gid, pid, rgb)
            north_up, field = found["northUpDeg"], found["fieldDeg"]
            middle_offset = (found["middleEastDeg"], found["middleNorthDeg"])
            how = (f"match {found['likeness']:.2f} (mirrored {found['otherWay']:.2f}, other rotations {found['otherTurn']:.2f})"
                   + (" MIRRORED" if found["mirrored"] else ""))
        if gid in NO_NUCLEUS and middle_offset:
            sky_centre = sky_at(*PLACE[gid], *middle_offset)
        elif gid not in NO_NUCLEUS:
            # From the nucleus to the picture's middle, in picture widths (x right, y up), then turned north-up
            # (where right is west).
            x, y = 0.5 - centre[0], (centre[1] - 0.5) * tall
            turn = math.radians(north_up)
            west = x * math.cos(turn) - y * math.sin(turn)
            north = x * math.sin(turn) + y * math.cos(turn)
            sky_centre = sky_at(*PLACE[gid], -west * field, north * field)
        print(f"{gid} {pid}: centre: [{centre[0]:.3f}, {centre[1]:.3f}], fieldDeg: {field:.4g}, "
              f"skyCentre: [{sky_centre[0]:.4f}, {sky_centre[1]:.4f}], northUpDeg: {north_up:.1f}"
              f"   # {how}; long axis of the light at position angle {(axis - 90 + north_up) % 180:.0f}", flush=True)


main()
