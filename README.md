# AmTree Lunar Navigator

NASA Space Apps Challenge project by the AmTree team. The current `frontend` branch combines the latest mission-screening UI with traceable precomputed lunar south-pole data.

## Run locally

```bash
npm install
npm run dev
```

## Verify

```bash
npm test
npm run build
```

## Scientific scope

- Terrain: NASA GSFC PGDA LOLA south-pole DEM products.
- Ephemerides: NASA/JPL NAIF SPICE, DE440-based lunar kernels in `MOON_ME`.
- Regional grids: USGS LGRS/ACC.
- Two computed 72-hour windows: baseline and arrival delayed by 48 hours.
- Full 240-second time series and local horizon supplied for Malapert Massif in the baseline window.

The application is a site-screening prototype. Sunlight is a geometric opportunity, not predicted electrical output; Earth visibility is line of sight, not a guaranteed radio link. It is not NASA-approved or validated for flight operations.
 
