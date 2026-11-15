"""Build browser elevation tiles from the supplied south-pole LOLA GeoTIFFs."""
from argparse import ArgumentParser
from contextlib import ExitStack
import json
import math
from pathlib import Path
import re

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.transform import rowcol
from rasterio.windows import Window, transform
from scipy.ndimage import map_coordinates

ROOT = Path(__file__).resolve().parents[1]
RADIUS = 1_737_400
# Keep each inner boundary aligned with vertices on the surrounding grid.
GRIDS = ((600, 108_000), (120, 18_000), (30, 3_600))


def elevation(dataset, x, y, step):
    scale = max(1, step // 60)
    x0 = x.min() - 90 * scale
    y0 = y.max() + 90 * scale
    x1 = x.max() + 90 * scale
    y1 = y.min() - 90 * scale
    row, col = rowcol(dataset.transform, x0, y0)
    end_row, end_col = rowcol(dataset.transform, x1, y1)
    window = Window(col, row, end_col - col + 1, end_row - row + 1)
    shape = (max(2, math.ceil(window.height / scale)),
             max(2, math.ceil(window.width / scale)))
    data = dataset.read(1, window=window, boundless=True, masked=True,
                        out_shape=shape, resampling=Resampling.bilinear).filled(np.nan)
    affine = transform(window, dataset.transform)
    cols = (x - affine.c) / (affine.a * window.width / shape[1]) - .5
    rows = (y - affine.f) / (affine.e * window.height / shape[0]) - .5
    return map_coordinates(data, [rows, cols], order=1, mode="constant", cval=np.nan)


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("polar_dem", type=Path)
    parser.add_argument("--regional-dems", type=Path)
    parser.add_argument("--regions-only", action="store_true")
    args = parser.parse_args()

    sites = re.findall(r'id: "(Site\d+)".*?latitude: ([-.\d]+), longitude: ([-.\d]+)',
                       (ROOT / "src/lib/sites.ts").read_text(encoding="utf-8"))
    if len(sites) != 6:
        raise ValueError("Expected all six study points")

    regions = json.loads((ROOT / "src/data/artemis-regions.json").read_text(encoding="utf-8"))
    region_sites = [(region["id"], region["latitude"], region["longitude"]) for region in regions]
    sites = region_sites if args.regions_only else [*sites, *region_sites]

    output = ROOT / "public/science/ground"
    output.mkdir(parents=True, exist_ok=True)
    region_elevations = {}
    with ExitStack() as stack:
        polar = stack.enter_context(rasterio.open(args.polar_dem))
        paths = sorted(args.regional_dems.glob("*.tif")) if args.regional_dems else []
        local = [stack.enter_context(rasterio.open(path)) for path in paths]
        if any(tile.crs != polar.crs or tile.res != (30, 30) for tile in [polar, *local]):
            raise ValueError("Expected the matching 30 m south-polar GeoTIFFs")

        for site, lat, lon in sites:
            lat, lon = map(math.radians, (float(lat), float(lon)))
            rho = 2 * RADIUS * math.tan((math.pi / 2 + lat) / 2)
            cx, cy = rho * math.sin(lon), rho * math.cos(lon)
            grids = []
            sources = set()
            for step, extent in GRIDS:
                axis = np.arange(-extent, extent + step, step)
                x, y = np.meshgrid(axis + cx, axis + cy)
                z = elevation(polar, x, y, step)
                if step == 30:
                    for tile in local:
                        bounds = tile.bounds
                        covered = ((x >= bounds.left) & (x < bounds.right) &
                                   (y >= bounds.bottom) & (y < bounds.top))
                        if not covered.any():
                            continue
                        values = elevation(tile, x[covered], y[covered], step)
                        z[covered] = np.where(np.isfinite(values), values, z[covered])
                        if np.isfinite(values).any():
                            sources.add(Path(tile.name).name)
                if not np.isfinite(z).all() or np.abs(z).max() > 32767:
                    raise ValueError(f"Invalid elevation coverage for {site}: {step} m grid")
                grids.append(np.rint(z).astype("<i2"))
            (output / f"{site}.bin").write_bytes(b"".join(grid.tobytes() for grid in grids))
            finest = grids[-1]
            center = len(finest) // 2
            center_elevation = int(finest[center, center])
            if site.startswith("region-"):
                region_elevations[site] = center_elevation
            print(site, center_elevation, sorted(sources))
    metadata = ROOT / "src/data/artemis-region-terrain.json"
    metadata.write_text(json.dumps(region_elevations, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
