import { loadSpiceQL } from './spice/spiceql.js';
import { loadNaifspice } from './spice/naifspice.js';
import { loadPyodide } from './pyodide/pyodide.mjs';
import { createSpiceBridge } from './cspice-bridge.js';

let runtime;
async function checked(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load ${url}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
async function initialize() {
  const base = new URL('./', import.meta.url);
  const spice = await loadSpiceQL({ moduleOverrides: { locateFile: name => new URL(`spice/${name}`, base).href } });
  const naif = loadNaifspice(spice);
  const py = await loadPyodide({ indexURL: new URL('pyodide/', base).href });
  await py.loadPackage(['numpy', 'pillow']);
  const manifest = await (await fetch(new URL('manifest.json', base))).json();
  await Promise.all(manifest.map(async path => {
    const bytes = await checked(new URL(`data/${path}`, base));
    const destination = `/amtree/${path}`;
    py.FS.mkdirTree(destination.slice(0, destination.lastIndexOf('/')));
    py.FS.writeFile(destination, bytes);
    if (path.startsWith('Backend/kernels/')) {
      spice.mountKernel(`/kernels/${path.split('/').pop()}`, bytes);
    }
  }));
  const resetKernels = () => {
    naif.kclear();
    for (const name of ['naif0012.tls', 'de432s.bsp', 'pck00010.tpc', 'moon_pa_de421_1900-2050.bpc', 'moon_080317.tf', 'dsn_stations.bsp']) naif.furnsh(`/kernels/${name}`);
  };
  resetKernels();
  self.spiceBridge = createSpiceBridge(spice.Module, resetKernels);
  py.FS.writeFile('/amtree/Backend/spiceypy.py', await checked(new URL('spiceypy.py?v=2', base)));
  await py.runPythonAsync(`import sys\nsys.path.insert(0, '/amtree/Backend')\nimport mission_server\nfrom datetime import datetime\nfrom urllib.parse import parse_qs\nimport json\ndef browser_request(query):\n    q = parse_qs(query)\n    start = datetime.fromisoformat(q['start'][0])\n    end = datetime.fromisoformat(q.get('end', q['start'])[0]) if q.get('mode', ['static'])[0] == 'dynamic' else start\n    if start.utcoffset() is None or end.utcoffset() is None:\n        raise ValueError('Supply times with a UTC offset.')\n    start, end = start.astimezone(mission_server.timezone.utc), end.astimezone(mission_server.timezone.utc)\n    if q.get('mode', ['static'])[0] not in ('static', 'dynamic') or (q.get('mode') == ['dynamic'] and end <= start):\n        raise ValueError('The dynamic end time must be later than the start time.')\n    cadence = int(q.get('interval', ['240'])[0])\n    fmt = q.get('format', [None])[0]\n    if fmt in ('illumination-gif', 'dsn-gif'):\n        content = mission_server.window_maps(start, end, cadence, q['site'][0])[int(fmt == 'dsn-gif')]\n        return ('image/gif', content)\n    if fmt:\n        return mission_server.window_export(start, end, cadence, q['site'][0], fmt)\n    return ('application/json', json.dumps(mission_server.calculate_window(start, end, cadence), allow_nan=False).encode())`);
  return py;
}
let queue = Promise.resolve();
self.onmessage = event => {
  const { id, query } = event.data;
  queue = queue.then(async () => {
    try {
      runtime ||= initialize().catch(error => { runtime = undefined; throw error; });
      const py = await runtime;
      py.globals.set('request_query', query);
      const result = await py.runPythonAsync('browser_request(request_query)');
      const values = result.toJs();
      const bytes = new Uint8Array(values[1]);
      result.destroy();
      self.postMessage({ id, type: values[0], bytes }, [bytes.buffer]);
    } catch (error) {
      self.postMessage({ id, error: String(error) });
    }
  });
};
