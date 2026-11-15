/**
 * The sources of the pictures, maps, data and published results the app uses, as the Sources dialog lists
 * them. README section 4 lists the same sources with the same addresses.
 *
 * An address is the provider's page for the source where README section 4 names one, and otherwise the
 * address tools/build_assets.py downloads from. An item that names several sources carries the address of
 * the first one. An item without an address has none recorded in this repository.
 */
import type { L10n } from '../core/types';

/** One source the app uses: how it is credited, and where it can be found. */
export interface CreditItem {
  text: string;
  url?: string;
}

/** The sources shown in the Sources dialog, grouped as there. Credit lines stay in English, as their owners word them. */
export const CREDIT_GROUPS: Array<{ title: L10n; items: CreditItem[] }> = [
  {
    title: { tr: 'Ay yüzeyi', en: 'Lunar surface' },
    items: [
      {
        text: 'NASA SVS #4720 / LRO LOLA — global elevation (LDEM, 16 px/deg) and relief normal map',
        url: 'https://svs.gsfc.nasa.gov/4720',
      },
      {
        text: 'NASA GSFC PGDA / LRO LOLA 5 m/px polar DEMs, Site01 & Site04 (Barker et al. 2021)',
        url: 'https://pgda.gsfc.nasa.gov/products/78',
      },
      {
        text: 'NASA SVS #4720 / LRO LROC — colour mosaic of the Moon (8K)',
        url: 'https://svs.gsfc.nasa.gov/4720',
      },
      {
        text: 'NASA NSSDCA — Apollo landing site coordinates from LRO images (Wagner et al. 2017, Icarus 283, 92–103)',
        url: 'https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html',
      },
      {
        text: 'NASA/GSFC/Arizona State University LROC — landing coordinates of SLIM (JAXA)',
        url: 'https://www.lroc.asu.edu/images/1358',
      },
      {
        text: 'NASA/GSFC/Arizona State University LROC — landing coordinates of Chang’e 5 (CNSA)',
        url: 'https://www.lroc.asu.edu/images/1172',
      },
      {
        text: 'NASA/GSFC/Arizona State University LROC — landing coordinates of Chang’e 6 (CNSA)',
        url: 'https://www.lroc.asu.edu/images/1374',
      },
      {
        text: 'NASA/GSFC/Arizona State University LROC — landing coordinates of IM-2 Athena',
        url: 'https://www.lroc.asu.edu/images/1408',
      },
      {
        text: 'NASA/GSFC/Arizona State University LROC — coordinates of robotic spacecraft (Luna 16, Surveyor 1)',
        url: 'https://lroc.im-ldi.com/news/117',
      },
      {
        text: 'NASA/GSFC/Arizona State University LROC — landing coordinates of Chandrayaan-3 (ISRO)',
        url: 'https://www.lroc.asu.edu/images/1314',
      },
      {
        text: 'NASA/GSFC/Arizona State University LROC — landing coordinates of IM-1 Odysseus',
        url: 'https://www.lroc.asu.edu/images/1360',
      },
      {
        text: 'Liu et al. 2019, Nature Communications 10, 4229 — landing coordinates of Chang’e 4 (CNSA)',
        url: 'https://doi.org/10.1038/s41467-019-12278-3',
      },
      {
        text: 'Blewett et al. 2025, LPSC 56, abstract 1233 — the Lunar Vertex (IM-3) target at Reiner Gamma',
        url: 'https://www.hou.usra.edu/meetings/lpsc2025/pdf/1233.pdf',
      },
    ],
  },
  {
    title: { tr: 'Mars yüzeyi', en: 'Mars surface' },
    items: [
      {
        text: 'NASA MGS MOLA Science Team / PDS Geosciences Node — global elevation of Mars (MEGDR, 16 px/deg)',
        url: 'https://pds-geosciences.wustl.edu/missions/mgs/megdr.html',
      },
      {
        text: 'NASA release 21-039, “NASA’s Ingenuity Mars Helicopter Succeeds in Historic First Flight” (19 April 2021) — time, height and duration of the first flight',
        url: 'https://www.nasa.gov/news-release/nasas-ingenuity-mars-helicopter-succeeds-in-historic-first-flight/',
      },
    ],
  },
  {
    title: { tr: 'Gökyüzü, gezegenler ve galaksiler', en: 'Sky, planets and galaxies' },
    items: [
      {
        text: 'NASA SVS #4851 — Deep Star Maps 2020 and constellation figures (8K); the Magellanic Clouds in visible light are cut from its 64K map (star catalogues: ESA Gaia DR2, Hipparcos-2, Tycho-2)',
        url: 'https://svs.gsfc.nasa.gov/4851',
      },
      {
        text: 'NASA HEASARC — Yale Bright Star Catalogue (BSC5P)',
        url: 'https://heasarc.gsfc.nasa.gov/W3Browse/star-catalog/bsc5p.html',
      },
      {
        text: 'NASA/JPL SSD Horizons (DE441) — ephemeris checks; astronomy-engine (D. Cross, MIT) for live positions',
        url: 'https://ssd.jpl.nasa.gov/horizons/',
      },
      {
        text: 'NASA/JPL SSD Small-Body Database (SBDB) — orbit of the Great Comet of 44 BC, C/-43 K1 (parabolic solution by Ramsey & Licht, 1997)',
        url: 'https://ssd-api.jpl.nasa.gov/doc/sbdb.html',
      },
      {
        text: 'NASA/JPL/USGS Mars Trek — Viking MDIM 2.1 colour mosaic (8K)',
        url: 'https://trek.nasa.gov/mars/',
      },
      {
        text: 'NASA/Johns Hopkins APL/Carnegie Institution of Washington — MESSENGER MDIS colour mosaic of Mercury, via NASA Mercury Trek (8K)',
        url: 'https://trek.nasa.gov/mercury/',
      },
      {
        text: 'NASA, ESA, A. Simon (NASA GSFC), M. H. Wong (UC Berkeley) and the OPAL team — Hubble maps of Jupiter (2024), Saturn (2025; both hemispheres, the strip under the rings bridged) and Uranus (2015; colour by latitude, observed to 49° south)',
        url: 'https://archive.stsci.edu/hlsp/opal',
      },
      {
        text: 'NASA 3D Resources — Neptune texture map',
        url: 'https://github.com/nasa/NASA-3D-Resources',
      },
      {
        text: 'NASA, ESA, B. F. Williams and Z. Chen (University of Washington), L. C. Johnson (Northwestern); image processing J. DePasquale (STScI) — Hubble mosaic of M31 (PHAT and PHAST surveys, 2025)',
        url: 'https://science.nasa.gov/missions/hubble/nasas-hubble-traces-hidden-history-of-andromeda-galaxy/',
      },
      {
        text: 'NASA/JPL-Caltech — GALEX ultraviolet pictures of M31 (PIA15416) and M33 (PIA03033); Spitzer infrared pictures of the Large Magellanic Cloud (PIA07137; M. Meixner, STScI, and the SAGE Legacy Team) and the Small Magellanic Cloud (PIA12485; STScI)',
        url: 'https://images.nasa.gov/details/PIA15416',
      },
      {
        text: 'NASA, ESA and the Hubble Heritage Team (STScI/AURA) — Hubble pictures of M51 (S. Beckwith, STScI), M104 and M87 (P. Cote, E. Baltz)',
        url: 'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/',
      },
      {
        text: 'NASA SkyView (GSFC) — survey images the galaxy pictures were matched with to find their place and turn on the sky (GALEX, IRAS/IRIS, Digitized Sky Survey)',
        url: 'https://skyview.gsfc.nasa.gov/',
      },
      {
        text: 'Messier & Magellanic galaxy coordinates and properties from SIMBAD/NED/NASA',
        url: 'https://simbad.cds.unistra.fr/',
      },
    ],
  },
  {
    title: { tr: 'Dünya', en: 'Earth' },
    items: [
      {
        text: 'NASA Earth Observatory — Blue Marble Next Generation (2004, twelve months) and Black Marble 2016 (Suomi NPP VIIRS)',
        url: 'https://visibleearth.nasa.gov/collection/1484/blue-marble',
      },
      {
        text: 'NASA GIBS / Worldview — MODIS Terra and VIIRS SNPP corrected reflectance for 2000-05-05, 2003-08-27, 2018-06-20, 2024-05-10, 2026-08-12',
        url: 'https://worldview.earthdata.nasa.gov/',
      },
    ],
  },
  {
    title: { tr: 'Patlama Laboratuvarı', en: 'Explosion Lab' },
    items: [
      {
        text: 'NASA/Johns Hopkins University Applied Physics Laboratory/Southwest Research Institute — New Horizons global colour map of Pluto (2017; nothing was seen south of 29° south, that part is filled in)',
        url: 'https://science.nasa.gov/resource/pluto-global-color-map',
      },
      {
        text: 'NASA/JPL/USGS Astrogeology Science Center — Voyager and Galileo SSI global mosaic of Europa (500 m/px, grey)',
        url: 'https://astrogeology.usgs.gov/search/map/europa_voyager_galileo_ssi_global_mosaic_500m',
      },
      {
        text: 'Gehrels et al. 2003 (NASA Goddard), “Ozone Depletion from Nearby Supernovae”, ApJ 585, 1169 — the distance within which a supernova would thin the ozone layer dangerously (about 26 light years)',
        url: 'https://arxiv.org/abs/astro-ph/0211361',
      },
      {
        text: 'NASA release 15-217, “NASA Mission Reveals Speed of Solar Wind Stripping Martian Atmosphere” (5 November 2015) — MAVEN: Mars lost gas to space faster in the solar storms of March 2015',
        url: 'https://www.nasa.gov/news-release/nasa-mission-reveals-speed-of-solar-wind-stripping-martian-atmosphere/',
      },
      {
        text: 'NASA/JPL news, “Cassini Catches Titan Naked in the Solar Wind” (28 January 2015) — Titan outside Saturn’s magnetosphere in December 2013',
        url: 'https://www.jpl.nasa.gov/news/cassini-catches-titan-naked-in-the-solar-wind/',
      },
      {
        text: 'Thomas et al. 2005 (with NASA Goddard), “Terrestrial Ozone Depletion Due to a Milky Way Gamma-Ray Burst”, ApJ 622, L153 — the gamma-ray burst and its effect on ozone (2 kpc, 100 kJ/m², 35% on average)',
        url: 'https://arxiv.org/abs/astro-ph/0411284',
      },
      {
        text: 'Tsurutani et al. 2003 (NASA JPL), “The extreme magnetic storm of 1–2 September 1859”, JGR 108, 1268 — the cloud of the Carrington event reaching Earth in 17 h 40 min',
        url: 'https://doi.org/10.1029/2002JA009504',
      },
    ],
  },
  {
    title: { tr: 'Uzay havası, radyasyon ve arşiv', en: 'Space weather, radiation and archive' },
    items: [
      {
        text: 'Chang’e-4 LND — Zhang et al. 2020, Science Advances 6, eaaz1334 — radiation dose measured on the surface of the Moon',
        url: 'https://doi.org/10.1126/sciadv.aaz1334',
      },
      {
        text: 'NASA MSL RAD — Hassler et al. 2014, Science 343, 1244797 — radiation dose measured on the surface of Mars',
        url: 'https://doi.org/10.1126/science.1244797',
      },
      {
        text: 'NASA CCMC DONKI — May 2024 CME and flare records',
        url: 'https://ccmc.gsfc.nasa.gov/tools/DONKI/',
      },
      {
        text: 'NASA Image and Video Library — archive images in the info panel',
        url: 'https://images.nasa.gov/',
      },
    ],
  },
  {
    title: { tr: '3B modeller', en: '3D models' },
    items: [
      {
        text: 'NASA 3D Resources — Apollo Lunar Module, Mark III spacesuit, Viking Lander, Mars Global Surveyor, InSight, Perseverance, Ingenuity (NASA and JPL logos and the Mars 2020 wordmark painted out of the textures)',
        url: 'https://github.com/nasa/NASA-3D-Resources',
      },
    ],
  },
];
