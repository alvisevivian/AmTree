import { mkdir, copyFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const files = ['Backend/mission_server.py', 'Backend/map_timelapses.py', 'Backend/window-horizons.json', 'Backend/LandingSides/A3-9regions-lonlat-simplified.geojson', 'src/lib/sites.ts', 'public/science/analysis-points.json', 'public/fonts/Lato-Regular.ttf', 'public/fonts/Lato-Bold.ttf'];
for (const directory of ['Backend/kernels', 'src/data', 'public/science/ground']) {
  for (const name of await readdir(resolve(root, directory))) files.push(`${directory}/${name}`);
}
for (const file of files) {
  const target = resolve(root, 'public/runtime/data', file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(root, file), target);
}
await writeFile(resolve(root, 'public/runtime/manifest.json'), JSON.stringify(files));
