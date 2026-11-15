"""Render georeferenced solar and DSN elevation maps for a mission window."""

from datetime import timedelta
from functools import lru_cache
from io import BytesIO
import json
from math import ceil, floor
from threading import Lock


MAP_LOCK = Lock()
MAX_FRAMES = 121
GRID_SIZE = 31
WIDTH, HEIGHT = 1000, 800
LEFT, TOP, PLOT_WIDTH, PLOT_HEIGHT = 126, 97, 620, 616


@lru_cache(maxsize=4)
def map_grid(root, radius, site_id, latitude, longitude, elevations, grids):
    import numpy as np

    def project(lon, lat):
        lon, lat = np.deg2rad(lon), np.deg2rad(lat)
        r = 2 * radius * np.cos(lat) / (1 - np.sin(lat))
        return r * np.sin(lon), r * np.cos(lon)

    center_x, center_y = project(longitude, latitude)
    if site_id.startswith("region-"):
        path = root / "Backend/LandingSides/A3-9regions-lonlat-simplified.geojson"
        features = json.loads(path.read_text(encoding="utf-8"))["features"]
        ring = next(feature["geometry"]["coordinates"][0] for feature in features
                    if "region-" + feature["properties"]["Region"].lower().replace(" ", "-") == site_id)
        outline = np.asarray(ring)
        outline[:, 0] = longitude + (outline[:, 0] - longitude + 180) % 360 - 180
    else:
        edge = 2400
        offsets = np.array([[-edge, -edge], [edge, -edge], [edge, edge], [-edge, edge], [-edge, -edge]])
        xx, yy = offsets.T + np.array([[center_x], [center_y]])
        outline = np.column_stack((np.rad2deg(np.arctan2(xx, yy)),
                                   np.rad2deg(2 * np.arctan(np.hypot(xx, yy) / (2 * radius)) - np.pi / 2)))
        outline[:, 0] = longitude + (outline[:, 0] - longitude + 180) % 360 - 180

    lower = outline.min(axis=0)
    upper = outline.max(axis=0)
    margin = (upper - lower) * .055
    lower -= margin
    upper += margin
    lon, lat = np.meshgrid(np.linspace(lower[0], upper[0], GRID_SIZE),
                           np.linspace(upper[1], lower[1], GRID_SIZE))
    x, y = project(lon, lat)
    lon, lat = np.deg2rad(lon), np.deg2rad(lat)
    up = np.stack((np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)), axis=-1)
    east = np.stack((-np.sin(lon), np.cos(lon), np.zeros_like(lon)), axis=-1)
    north = np.cross(up, east)
    heights = np.asarray(elevations)

    def height(query_x, query_y):
        query_x, query_y = query_x - center_x, query_y - center_y
        result = np.full(query_x.shape, np.nan)
        for step, extent, size, offset in grids:
            inside = np.maximum(np.abs(query_x), np.abs(query_y)) < extent
            u = (query_x[inside] + extent) / step
            v = (query_y[inside] + extent) / step
            col, row = u.astype(int), v.astype(int)
            index = offset + row * size + col
            a, b = u - col, v - row
            result[inside] = ((1-b) * ((1-a) * heights[index] + a * heights[index+1])
                              + b * ((1-a) * heights[index+size] + a * heights[index+size+1]))
        return result

    observer = radius + 2 + height(x, y)
    location = up * observer[..., None]
    distances = np.concatenate((np.arange(30, 3600, 60), np.arange(3600, 18000, 180), np.arange(18000, 100001, 600)))
    cos_d, sin_d = np.cos(distances / radius), np.sin(distances / radius)
    horizon = []
    for azimuth in range(0, 360, 5):
        angle = np.deg2rad(azimuth)
        bearing = north * np.cos(angle) + east * np.sin(angle)
        ray = up[..., None, :] * cos_d[:, None] + bearing[..., None, :] * sin_d[:, None]
        terrain_r = radius + height(2 * radius * ray[..., 1] / (1 - ray[..., 2]),
                                    2 * radius * ray[..., 0] / (1 - ray[..., 2]))
        slopes = np.arctan2(terrain_r * cos_d - observer[..., None], terrain_r * sin_d)
        horizon.append(np.max(np.where(np.isfinite(slopes), slopes, -np.inf), axis=-1))
    horizon = np.stack(horizon, axis=-1)
    return lower, upper, outline, location, up, north, east, horizon


def elevation_frames(grid, positions):
    import numpy as np

    _, _, _, location, up, north, east, horizon = grid
    row, col = np.indices(location.shape[:2])

    def visible_elevation(position):
        line = position - location
        x = np.sum(east * line, axis=-1)
        y = np.sum(north * line, axis=-1)
        azimuth = (np.arctan2(x, y) * (36 / np.pi)) % 72
        index = azimuth.astype(int) % 72
        fraction = azimuth % 1
        skyline = horizon[row, col, index] * (1 - fraction) + horizon[row, col, (index + 1) % 72] * fraction
        elevation = np.arctan2(np.sum(up * line, axis=-1), np.hypot(x, y))
        return np.where(elevation >= skyline, np.degrees(elevation), np.nan)

    sun_frames, dsn_frames = [], []
    for _, sun, _, stations, _ in positions:
        sun_frames.append(visible_elevation(sun))
        best = np.full(location.shape[:2], np.nan)
        for position, normal in stations:
            facing_moon = np.sum((location - position) * normal, axis=-1) > 0
            best = np.fmax(best, np.where(facing_moon, visible_elevation(position), np.nan))
        dsn_frames.append(best)
    return sun_frames, dsn_frames


def render_gif(root, site, grid, frames, start, offsets, solar):
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont

    lower, upper, outline = grid[:3]
    finite = np.asarray(frames)
    finite = finite[np.isfinite(finite)]
    minimum = min(0, floor(float(finite.min()))) if finite.size else 0
    maximum = max(1, ceil(float(finite.max()))) if finite.size else 1
    shades = ((255, 208, 194), (239, 52, 39), (105, 4, 16)) if solar else (
        (211, 229, 245), (58, 139, 198), (8, 48, 107))
    gradient = np.column_stack([np.interp(np.arange(30), [0, 14, 29], channel) for channel in zip(*shades)]).astype(int)
    palette = [255, 255, 255, 0, 0, 0, 0, 200, 215, 95, 104, 115, *gradient.flatten()]
    palette.extend([0] * (768 - len(palette)))
    fonts = root / "public/fonts"
    title_font = ImageFont.truetype(str(fonts / "Lato-Bold.ttf"), 24)
    tick_font = ImageFont.truetype(str(fonts / "Lato-Regular.ttf"), 15)
    label_font = ImageFont.truetype(str(fonts / "Lato-Bold.ttf"), 18)
    caption = "Solar Elevation Angle (deg)" if solar else "Best Visible DSN Elevation (deg)"
    title = "Dynamic Timelapse" if solar else "DSN Handover Timelapse"
    if len(frames) == 1:
        title = "Solar Illumination" if solar else "DSN Communications"
    boundary = "Region boundary" if site["id"].startswith("region-") else "Study area boundary"
    poly = [tuple(p) for p in (outline - lower) / (upper - lower) * [PLOT_WIDTH-1, -(PLOT_HEIGHT-1)] + [0, PLOT_HEIGHT-1]]
    mask = Image.new("1", (PLOT_WIDTH, PLOT_HEIGHT))
    ImageDraw.Draw(mask).polygon(poly, fill=1)
    boundary_layer = Image.new("1", mask.size)
    ImageDraw.Draw(boundary_layer).line(poly, fill=1, width=3)
    data_mask = np.asarray(mask)
    base = Image.new("P", (WIDTH, HEIGHT), 0)
    base.putpalette(palette)
    draw = ImageDraw.Draw(base)
    draw.text((500, 49), f'{title}: {site["name"]} (DEM Calculated)', font=title_font, anchor="mm", fill=1)
    draw.rectangle((LEFT-1, TOP-1, LEFT+PLOT_WIDTH, TOP+PLOT_HEIGHT), outline=1)
    for fraction in np.linspace(0, 1, 5):
        x, y = LEFT + PLOT_WIDTH * fraction, TOP + PLOT_HEIGHT * fraction
        lon = lower[0] + (upper[0] - lower[0]) * fraction
        lat = upper[1] - (upper[1] - lower[1]) * fraction
        draw.line((x, TOP+PLOT_HEIGHT, x, TOP+PLOT_HEIGHT+5), fill=1)
        draw.line((LEFT-5, y, LEFT, y), fill=1)
        draw.text((x, TOP+PLOT_HEIGHT+19), f"{lon:.2f}", font=tick_font, anchor="mm", fill=1)
        draw.text((LEFT-9, y), f"{lat:.3f}", font=tick_font, anchor="rm", fill=1)
    draw.text((436, 753), "Longitude (deg)", font=label_font, anchor="mm", fill=1)

    def vertical_label(label, x):
        layer = Image.new("1", (360, 30))
        ImageDraw.Draw(layer).text((180, 15), label, font=label_font, anchor="mm", fill=1)
        base.paste(1, (x, 225), layer.transpose(Image.Transpose.ROTATE_90))

    vertical_label("Latitude (deg)", 38)
    vertical_label(caption, 876)
    for band in range(30):
        y = TOP + round((29 - band) * 590 / 30)
        end_y = TOP + round((30 - band) * 590 / 30) - 1
        draw.rectangle((784, y, 815, end_y), fill=4+band)
    draw.rectangle((784, TOP, 815, TOP+590), outline=1)
    for tick in range(6):
        y = TOP + (5-tick) * 590 / 5
        draw.text((824, y), f"{minimum + (maximum-minimum)*tick/5:.1f}", font=tick_font, anchor="lm", fill=1)
    draw.rectangle((784, 692, 815, 711), fill=1)
    draw.text((824, 702), "Blocked", font=tick_font, anchor="lm", fill=1)
    rendered = []
    for offset, values in zip(offsets, frames):
        valid = np.isfinite(values)
        weights = np.array(Image.fromarray(valid.astype(np.float32)).resize(mask.size, Image.Resampling.BILINEAR))
        interpolated = np.array(Image.fromarray(np.nan_to_num(values).astype(np.float32)).resize(mask.size, Image.Resampling.BILINEAR))
        interpolated /= np.maximum(weights, .001)
        bands = np.clip((interpolated-minimum) * 30 / (maximum-minimum), 0, 29).astype("uint8")
        colors = np.where(data_mask, np.where(weights >= .5, bands+4, 1), 0).astype("uint8")
        plot = Image.fromarray(colors)
        plot.putpalette(palette)
        frame = base.copy()
        frame.paste(plot, (LEFT, TOP))
        frame.paste(2, (LEFT, TOP), boundary_layer)
        draw = ImageDraw.Draw(frame)
        draw.rectangle((537, 103, 739, 130), fill=0, outline=3)
        draw.line((550, 117, 584, 117), fill=2, width=3)
        draw.text((592, 117), boundary, font=tick_font, anchor="lm", fill=1)
        draw.text((500, 77), f"Time: {start + timedelta(seconds=offset):%Y-%m-%dT%H:%M:%S} (UTC)",
                  font=title_font, anchor="mm", fill=1)
        rendered.append(frame)
    result = BytesIO()
    rendered[0].save(result, format="GIF", save_all=True, append_images=rendered[1:], duration=175, loop=0)
    return result.getvalue()


@lru_cache(maxsize=8)
def map_pair(root, radius, site_id, name, latitude, longitude, elevations, grids, start, end, cadence, body_positions):
    import numpy as np

    site = {"id": site_id, "name": name}
    grid = map_grid(root, radius, site_id, latitude, longitude, elevations, grids)
    positions = body_positions(start, end, cadence)
    if len(positions) > MAX_FRAMES:
        positions = [positions[i] for i in np.linspace(0, len(positions)-1, MAX_FRAMES, dtype=int)]
    sun, dsn = elevation_frames(grid, positions)
    offsets = [position[0] for position in positions]
    return (render_gif(root, site, grid, sun, start, offsets, True),
            render_gif(root, site, grid, dsn, start, offsets, False))
