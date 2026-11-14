# Science notes, verification and limits

Prototype for site screening. It is not validated for flight operations and carries no NASA approval.

## 1. Data actually used (checksums in `data/SOURCES.json`)

| dataset | what was verified in the files | use |
|---|---|---|
| USGS LGRS/ACC grids, doi:10.5066/P1MEQ6UK (Malapert_Massif, Haworth) | `.prj`: `Moon_2015_-_Sphere` R = 1 737 400 m, Stereographic, lat origin −90°, central meridian 0, scale 0.994, false E/N 500 000 m, metres. Attributes `id, LGRS_ACC, centX, centY, ULX, ULY, LRX, LRY` (cell centre and corner eastings/northings — no elevation, no "Z"). 1 km: 462 / 930 square 1000 m cells. XML: datum "JPL DE421, Mean Earth". | region grid extent, cell ids, sampling points |
| PGDA LOLA `LDEM_80S_80MPP_ADJ.TIF` (doi:10.60903/gsfcpgda-lola-spole) | GeoKeys: polar stereographic, origin −90°, scale 1.0, no false origin, R = 1 737 400 m, PixelIsArea, 80 m, tie point (−304 km, +304 km), float32, nodata NaN (0 % NaN). Product page: surface height in metres, MOON_ME/DE421. | near-field terrain, observer height, slope, GLB |
| PGDA LOLA `LDEM_80S_80MPP_ADJ_HILL.TIF` (doi:10.60903/gsfcpgda-lola-spole) | Official 80 m/pixel hillshade, south polar stereographic, covering 80–90°S. The web asset is a visually compressed 6144 px derivative; it is a topographic relief visualization, not optical imagery. | high-detail south-pole layer on the interactive Moon |
| PGDA LOLA `LDEM_60S_240MPP_ADJ.TIF`, overview level 1 (480 m/px) | same projection, ±931.2 km. The file is a partial download; all overview levels are complete and only level 1 is read. | far-field terrain (to 600 km) |
| PGDA 5 m site DEM headers (Site01/04/07/11/20/23) | tie point, pixel scale, size → tile centres | coordinates of the six panel points |
| NAIF `de440s.bsp`, `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf`, `naif0012.tls`, `pck00011.tpc` | `MOON_ME` = alias of `MOON_ME_DE440_ME421` (DE440 PA orientation rotated to the DE421 mean-Earth frame) | ephemerides |
| IAU Gazetteer centre points | — | approximate label anchors for regions without geometry |

Important distinctions
- A **grid cell size** (1 km / 100 m / 10 m) is a navigation-grid spacing, not a DEM resolution. Terrain comes from LOLA.
- The **grid extent is not the region boundary**. NASA's announcement lists names only; no official outline was found.
  The 1 km and 100 m grids of the same region do not even share one extent (Malapert: 21×22 km vs 21×21 km).
- LPS grid metres are not ground metres: scale 0.994 at the pole, ≈0.9952 at 86°S.
- Latitudes are planetocentric on a sphere (so also planetographic); longitudes east-positive.
- DE421-ME (datasets) vs DE440-based `MOON_ME` (SPICE): the kernel aligns them by construction; residual
  differences are at the metre level, far below the 80 m DEM.

## 2. Model

**Horizon** (`backend/llsn/horizon.py`). Observer at `R + h_DEM(site) + observer_height` (default 2 m). For 1440
azimuths (0.25°) terrain is sampled along great circles from 40 m to 600 km (steps growing 0.3 %), near tier 80 m,
far tier 480 m. Elevation of each terrain point uses exact spherical geometry
`atan2(r_p cos γ − r_o, r_p sin γ)`, γ = d/R, so lunar curvature is included. Missing terrain is *unknown*: an
upper-bound horizon assumes relief up to 10 786 m (highest lunar elevation) wherever data are missing and beyond
the search radius. With both tiers available all six points are fully determined to 600 km.

**Ephemerides** (`ephemeris.py`). SPICE `spkcpo`, observer fixed at the site in MOON_ME, target Sun/Earth,
correction `LT+S`, converted to azimuth (clockwise from north) / elevation (above the plane normal to the radial).
UTC handled by the leap-second kernel.

**Visibility** (`visibility.py`). Sun (R = 695 700 km) and Earth (6378.137 km) are uniform discs sampled at 96
points; each point is compared with the horizon at its own azimuth. "Visible" = ≥ 50 % of the disc above the
horizon (configurable in code); "darkness" = Sun not visible. Three states: visible / not_visible / unknown.
State changes between samples are located by bisection to 1 s. Durations are integrals of the intervals.
Fractions use the requested period as denominator (`*_of_known` variants exclude unknown time).
Eclipses of the Sun by the Earth are flagged per sample from disc overlap and reported
(`sun_eclipsed_by_earth_hours_sampled`), not subtracted.

**Requirements** (`requirements.py`). Hard constraints give pass / fail / unknown with value, threshold and reason
(bounds are used when part of the timeline is unknown). Overall: infeasible > indeterminate > feasible. Preference
score = Σ wᵢ·xᵢ with xᵢ ∈ [0,1] (sun fraction 0.4, Earth fraction 0.3, overlap 0.2, darkness continuity 0.1 by
default); it orders candidates only within the same status.

**Arrival windows** (`services.py`). One analysis per site over `[search start, last arrival + stay]`; each arrival
candidate is evaluated over its entire stay from the stored intervals. Default policy keeps the whole stay inside
the search interval; `arrival_within_search_interval` extends the data by one stay. Consecutive feasible arrivals
are merged into windows (edges resolved to the arrival step).

## 3. Verification performed

| check | result |
|---|---|
| Closed-form LPS / PGDA projections vs PROJ (explicit lunar sphere), 500 random points | < 1 µm, < 1e-10° |
| Independent MATLAB R2026b recomputation of projections, unit vectors, matrix orientation after `jsondecode`/`jsonencode` (`matlab/llsn_verify_frames.m`) | agreement < 1e-10°, < 1e-12; control points < 1e-8 |
| Six frontend coordinates vs PGDA tile centres from GeoTIFF headers | equal to the 4 displayed decimals |
| **SPICE vs JPL Horizons** (independent service), Malapert tile centre, 73 hourly samples, Sun and Earth | max Δaz 9.6e-7°, Δel 5.3e-7°, Δ angular radius 1.3e-7° (Horizons print precision) — `docs/verification/horizons_crosscheck.json` |
| Horizons header | site in "MEAN_ME (high precision)", radii 1737.4 km, airless — same conventions as ours |
| Horizon on a smooth sphere | equals the analytic dip −acos(R/(R+h)) within 0.002° |
| Horizon behind a 3 km ring wall at 50 km | matches the curved-Moon formula within 0.01° (flat-Moon answer is 0.4° off) |
| Missing terrain | upper bound > known horizon; visibility becomes `unknown`, never "visible" or 0 |
| Transition timing (synthetic crossing at a known instant) | within 2 s |
| Clipped intervals, period end off the sampling grid, naive timestamps rejected | pass |
| Metric invariants (0 ≤ x ≤ duration, overlap ≤ min, longest dark ≤ total dark, intervals ⇔ metrics, sub-windows additive) | pass |
| Constraints: pass/fail/unknown, score cannot outrank a failed constraint | pass |
| Window search vs a direct analysis of the best stay | same metrics within 0.15 h |
| Horizons parser on a real response and on error bodies returned with HTTP 200 | pass |
| Strict JSON (no NaN/Infinity) for every package file | pass |
| Full API path incl. job polling, Delay +48 h, scenario, region rows | pass |
| Frontend flow in Node against the live server (`frontend_package/examples/panel_flow.mjs`) | pass |

`.venv/Scripts/python -m pytest backend/tests -q` → 36 passed.

**Not verified**
- The terrain horizon itself has no independent reference yet (no comparison with LROC imagery, PGDA illumination
  maps or another horizon code). The geometry is tested synthetically; the real-terrain numbers are plausible but
  unvalidated. PGDA product 69 (multi-year average illumination) is an average and cannot confirm a specific date.
- The render adapter was not checked against the frontend's actual scene (source not available).
- `frontend_package/examples` was run in Node only, not in a browser.

## 4. Measured performance (`docs/verification/timings.json`, developer laptop)

| operation | cold | warm |
|---|---|---|
| comparison, 6 points × 72 h (horizons + analyses) | ≈ 14 s | 0.05 s |
| same, only the darkness limit changed | — | ≈ 0.2 s (analyses reused) |
| window search, 6 points × 30 d, 577 arrivals each, horizons cached | ≈ 11 s | < 0.01 s |
| one horizon (1440 azimuths × 1660 distances) | ≈ 1–2 s | file read |

Caches (`data/cache`, `data/analyses`, `data/results`) are keyed by all inputs plus data/algorithm versions, written
atomically, and guarded by file locks. After the first acquisition everything runs offline (Horizons is only used
by the cross-check).

## 5. Limits and open dependencies

1. **Seven regions have no geometry** (Peak near Cabeus B, Mons Mouton Plateau, Mons Mouton, Nobile Rim 1/2,
   de Gerlache Rim 2, Slater Plain). ScienceBase blocks scripted downloads; download the zips in a browser and run
   `scripts/ingest_usgs_grids.py` + `scripts/build_package.py`. Mons Mouton Plateau ships its 1 km grid as four
   quadrant shapefiles (handled by the reader, untested until the file is available).
2. **Point choice.** The six panel points are DEM tile centres, not chosen landing spots; e.g. "Shackleton Rim"
   falls on a 32° slope and "Leibnitz Beta Plateau" is in terrain shadow for the whole example period. Region
   representative points use "highest 1 km cell", a heuristic. Results describe those coordinates only.
3. **Resolution.** 80 m terrain, 2 m observer: nearby boulders, small rims and the vehicle are invisible to the
   model. Far terrain uses a 480 m overview whose resampling can lower sharp summits (non-conservative). Azimuth
   spacing 0.25° (≈ 1.3 km at 300 km). Near grazing incidence a 0.05° horizon error can move a transition by tens
   of minutes; the 1 s figure is numerical precision only.
4. **Sunlight ≠ power, Earth line of sight ≠ link.** No array, thermal, antenna, ground-station or multipath model.
5. **Slope** is a ~160 m-baseline regional slope, not lander scale.
6. **Not evaluated:** reachability, descent, navigation, hazards, vehicle limits. "Reachable sites" in scenarios
   are operator declarations and are labelled as such.
7. **Regions ≠ points.** A region row reports its recommended point and the range across sampled points (≈ 4 % of
   the 1 km cells with `point_selection: "all"`).
8. Jobs run in a 2-thread in-process pool; a server restart fails pending jobs (resubmit). Single worker assumed.
9. `data/analyses` grows quickly (full time series per analysis); it can be deleted at any time.
10. Not implemented: ML surrogate, Horizons as a production ephemeris provider (verification only), landing
    ellipses, 10 m grids, 5 m site DEMs for near-field refinement.
