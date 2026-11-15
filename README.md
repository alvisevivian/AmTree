# AmTree Patch 11

Extract the ZIP into a separate folder. On Windows with 64-bit Python 3.13,
double-click `Start AmTree.cmd` and leave its terminal open. It installs the
included dependencies on first run and opens http://127.0.0.1:4194/.
The built app and offline dependencies are included.

## Frontend development

Open this folder in VS Code and run these commands from its terminal.

```powershell
npm ci
npm run dev
```

Open the local URL Vite prints. For VS Code Live Server, run `npm run build` first, then start Live Server from the project workspace. Its settings serve `dist/index.html`. Use `npm test` to check the bundled comparison data.

The planner, baseline data, globe, terrain, and map GIFs are included in the frontend. Static and Dynamic simulations use the updated AmTree backend at `/api/mission-window`. On your computer, run `python -B Backend/mission_server.py` from the integrated project folder. Its default port is 4194. Vite and the workspace’s Live Server settings forward requests there. On a deployed site, route `/api/mission-window` to your backend.

## Illumination and communications maps

Select an Artemis III region or a study point to see its illumination and DSN GIFs. Both use the same longitude and latitude plots, elevation color scale, and UTC frame timestamps. The study-point boundary encloses a 4.8 km square around the named coordinates. The maps use bundled LOLA-derived elevations and SPICE positions. The model checks the terrain horizon up to 100 km where terrain data are available, with the observer 2 m above the terrain.

The included GIFs cover the planner's baseline from 10 January 2027 12:00 through 13 January 2027 12:00 UTC, with hourly frames. The updated backend generates GIFs for custom simulation windows. Long runs display up to 121 evenly sampled frames, including the first and last samples. Red shows sunlight, blue shows visibility to a DSN station, and black shows blocked locations. Use Play or Pause beside the mission or ground-view time slider to advance both views together.
