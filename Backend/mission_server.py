"""Serve the navigator and calculate Sun and Earth visibility with SPICE and LOLA."""
from argparse import ArgumentParser
from base64 import b64encode
from html import escape
import csv
from io import BytesIO, StringIO
from datetime import datetime, timedelta, timezone
from functools import lru_cache, partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from math import asin, atan2, ceil, cos, degrees, hypot, radians, sin
from pathlib import Path
import re
import sys
from threading import Lock
from struct import unpack
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src/data"
RADIUS = 1_737_400
GRIDS = ((600, 108_000), (120, 18_000), (30, 3_600))


def read_data(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


# Stay inside the supplied DE432s coverage, including light-time corrections.
START = datetime(1950, 1, 2, tzinfo=timezone.utc)
END = datetime(2049, 12, 30, tzinfo=timezone.utc)
FRAME = "MOON_ME_DE421"
SAMPLE_SECONDS = 240
MAX_SAMPLES = 4096
STATIONS = (("Goldstone", "399014"), ("Madrid", "399063"), ("Canberra", "399043"))
SPICE_LOCK = Lock()


def basis(latitude, longitude):
    lat, lon = radians(latitude), radians(longitude)
    return (
        (cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat)),
        (-sin(lat) * cos(lon), -sin(lat) * sin(lon), cos(lat)),
        (-sin(lon), cos(lon), 0.0),
    )


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def terrain(site):
    tile = (ROOT / "public/science/ground" / (site["id"] + ".bin")).read_bytes()
    grid_specs = [(step, extent, 1 + 2 * extent // step) for step, extent in GRIDS]
    count = sum(n * n for _, _, n in grid_specs)
    elevations = unpack(f"<{count}h", tile)
    offset = 0
    grids = []
    for step, extent, n in grid_specs:
        grids.append((step, extent, n, offset))
        offset += n * n
    return elevations, grids


def height_at(x, y, elevations, grids):
    for step, extent, n, offset in reversed(grids):
        if max(abs(x), abs(y)) < extent:
            u, v = (x + extent) / step, (y + extent) / step
            col, row = int(u), int(v)
            a = offset + row * n + col
            tx, ty = u - col, v - row
            return (1 - ty) * ((1 - tx) * elevations[a] + tx * elevations[a + 1]) + ty * (
                (1 - tx) * elevations[a + n] + tx * elevations[a + n + 1]
            )
    raise ValueError("Point outside terrain tile")


def horizon_profile(site):
    up, north, east = basis(site["latitude"], site["longitude"])
    center_x = 2 * RADIUS * up[1] / (1 - up[2])
    center_y = 2 * RADIUS * up[0] / (1 - up[2])
    values, grids = terrain(site)
    ground = height_at(0, 0, values, grids)
    distances = [d for start, stop, step in ((15, 3600, 30), (3600, 18000, 120), (18000, 100001, 300))
                 for d in range(start, stop, step)]
    samples = [(sin(d / RADIUS), cos(d / RADIUS)) for d in distances]
    profile = []
    for degree in range(360):
        az = radians(degree)
        bearing = tuple(n * cos(az) + e * sin(az) for n, e in zip(north, east))
        peak = -90.0
        for sin_g, cos_g in samples:
            x, y, z = (u * cos_g + b * sin_g for u, b in zip(up, bearing))
            map_x = 2 * RADIUS * y / (1 - z) - center_x
            map_y = 2 * RADIUS * x / (1 - z) - center_y
            r = RADIUS + height_at(map_x, map_y, values, grids)
            peak = max(peak, degrees(atan2(r * cos_g - (RADIUS + ground + 2), r * sin_g)))
        profile.append(round(peak, 4))
    return ground, profile


def sites():
    analysis_points = json.loads((ROOT / "public/science/analysis-points.json").read_text(encoding="utf-8"))
    coordinates = {point["analysis_point_id"]: point for point in analysis_points["analysis_points"]}
    code = (ROOT / "src/lib/sites.ts").read_text(encoding="utf-8")
    studies = [{"id": key, "name": name, "latitude": coordinates[point]["lat_deg"], "longitude": coordinates[point]["lon_deg"]}
               for key, point, name in re.findall(r'id: "(Site\d+)", analysisPointId: "([^"]+)", name: "([^"]+)"', code)]
    return [*studies, *read_data("artemis-regions.json")]


def make_profiles():
    output = {site["id"]: horizon_profile(site) for site in sites()}
    (ROOT / "Backend/window-horizons.json").write_text(json.dumps(output, separators=(",", ":")), encoding="utf-8")


@lru_cache(maxsize=1)
def spice_runtime():
    dependency_path = ROOT / "Backend/.deps"
    if dependency_path.is_dir():
        sys.path.insert(0, str(dependency_path))
    try:
        import spiceypy as spice
    except ImportError as error:
        raise RuntimeError("Install the bundled SPICE dependency or use Start AmTree.cmd.") from error
    kernels = ROOT / "Backend/kernels"
    for filename in ("naif0012.tls", "de432s.bsp", "pck00010.tpc",
                     "moon_pa_de421_1900-2050.bpc", "moon_080317.tf", "dsn_stations.bsp"):
        spice.furnsh(str(kernels / filename))
    return spice


def body_positions(start, end, cadence):
    duration = int((end - start).total_seconds())
    if ceil(duration / cadence) + 1 > MAX_SAMPLES:
        minimum = ceil(duration / (MAX_SAMPLES - 1))
        raise ValueError(f"This range needs too many samples. Choose an interval of at least {minimum} seconds.")
    offsets = [*range(0, duration, cadence), duration]
    # CSPICE has a process-wide kernel pool and error state.
    with SPICE_LOCK:
        spice = spice_runtime()
        times = [spice.str2et((start + timedelta(seconds=t)).isoformat().replace("+00:00", "Z")) for t in offsets]
        sun, _ = spice.spkpos("SUN", times, FRAME, "LT+S", "MOON")
        earth, light_time = spice.spkpos("EARTH", times, FRAME, "LT+S", "MOON")
        output = []
        for offset, et, sun_pos, earth_pos, lt in zip(offsets, times, sun * 1000, earth * 1000, light_time):
            rotation = spice.pxfrm2("IAU_EARTH", FRAME, et - lt, et)
            stations = []
            for _, code in STATIONS:
                # NAIF station coordinates are Earth-fixed. Use the bundled IAU Earth rotation.
                xyz, _ = spice.spkpos(code, et - lt, "ITRF93", "NONE", "EARTH")
                normal = rotation @ (xyz * [1, 1, 1 / (1 - 1 / 298.257223563) ** 2])
                stations.append((earth_pos + rotation @ (xyz * 1000), normal))
            output.append((offset, sun_pos, earth_pos, stations, rotation))
    return output


def body_angles(position, axes, observer_radius, horizon):
    up, north, east = axes
    n, e = dot(position, north), dot(position, east)
    azimuth = degrees(atan2(e, n)) % 360
    i = int(azimuth)
    fraction = azimuth - i
    skyline = (1 - fraction) * horizon[i] + fraction * horizon[(i + 1) % 360]
    return azimuth, degrees(atan2(dot(position, up) - observer_radius, hypot(n, e))), skyline


def visible_intervals(samples):
    intervals = []
    start = samples[0][0] if samples[0][1] >= 0 else None
    for (a, before), (b, after) in zip(samples, samples[1:]):
        if (before >= 0) == (after >= 0):
            continue
        crossing = a + (b - a) * before / (before - after)
        if start is None:
            start = crossing
        else:
            intervals.append((start, crossing))
            start = None
    if start is not None:
        intervals.append((start, samples[-1][0]))
    return intervals


@lru_cache(maxsize=1)
def location_profiles():
    profiles = json.loads((ROOT / "Backend/window-horizons.json").read_text(encoding="utf-8"))
    return tuple((site["id"], basis(site["latitude"], site["longitude"]), *profiles[site["id"]]) for site in sites())


def aggregate(sun, earth, duration):
    edges = [0.0, *(point for interval in sun for point in interval), duration]
    return {
        "sunlightHours": sum(b - a for a, b in sun) / 3600,
        "earthHours": sum(b - a for a, b in earth) / 3600,
        "simultaneousHours": sum(max(0, min(b, d) - max(a, c)) for a, b in sun for c, d in earth) / 3600,
        "longestDarknessHours": max((edges[i + 1] - edges[i] for i in range(0, len(edges) - 1, 2))) / 3600,
        "unknownHours": 0,
    }


@lru_cache(maxsize=128)
def daily_sunlight(day):
    """Full UTC-day sunlight duration at a fixed cadence independent of UI sampling."""
    offsets = list(range(0, 86401, 240))
    with SPICE_LOCK:
        spice = spice_runtime()
        times = [spice.str2et((day + timedelta(seconds=value)).isoformat().replace("+00:00", "Z")) for value in offsets]
        positions, _ = spice.spkpos("SUN", times, FRAME, "LT+S", "MOON")
        positions = positions * 1000
    result = {}
    for key, axes, height, horizon in location_profiles():
        margins = []
        for offset, position in zip(offsets, positions):
            _, elevation, skyline = body_angles(position, axes, RADIUS + height + 2, horizon)
            margins.append((offset, elevation - skyline))
        seconds = sum(end - start for start, end in visible_intervals(margins))
        result[key] = seconds / 86400 * 100
    return result


@lru_cache(maxsize=3)
def calculate_window(start, end, cadence=SAMPLE_SECONDS):
    if not START <= start <= end <= END:
        raise ValueError("Choose ordered dates between 2 January 1950 and 30 December 2049 UTC.")
    if cadence < 1:
        raise ValueError("Enter a positive sampling interval in whole seconds.")
    positions = body_positions(start, end, cadence)
    duration = (end - start).total_seconds()
    results, details = {}, {}
    for key, axes, height, horizon in location_profiles():
        observer_radius = RADIUS + height + 2
        observer = tuple(axis * observer_radius for axis in axes[0])
        samples, sun_margins, earth_margins = [], [], []
        for offset, sun, earth, stations, _ in positions:
            sun_angles = body_angles(sun, axes, observer_radius, horizon)
            earth_angles = body_angles(earth, axes, observer_radius, horizon)
            sun_margins.append((offset, sun_angles[1] - sun_angles[2]))
            earth_margins.append((offset, earth_angles[1] - earth_angles[2]))
            mask, preferred, best_clearance = 0, -1, -1.0
            for index, (position, normal) in enumerate(stations):
                line = tuple(o - p for o, p in zip(observer, position))
                projection = dot(line, normal)
                if projection <= 0:
                    continue
                earth_clearance = degrees(asin(min(1, projection / (hypot(*line) * hypot(*normal)))))
                _, elevation, skyline = body_angles(position, axes, observer_radius, horizon)
                if elevation >= skyline:
                    mask |= 1 << index
                    clearance = min(earth_clearance, elevation - skyline)
                    if clearance > best_clearance:
                        best_clearance, preferred = clearance, index
            samples.append([*(round(a, 5) for a in (*sun_angles, *earth_angles)), mask, preferred])
        results[key] = aggregate(visible_intervals(sun_margins), visible_intervals(earth_margins), duration)
        details[key] = {"horizon": horizon, "samples": samples}
    solar = []
    for offset, sun, earth, _, earth_rotation in positions:
        distance = hypot(*sun)
        earth_distance = hypot(*earth)
        solar.append({
            "offsetSeconds": offset,
            "direction": [round(float(coordinate) / distance, 8) for coordinate in sun],
            "radiusDeg": degrees(asin(695_700_000 / distance)),
            "earthDirection": [round(float(coordinate) / earth_distance, 8) for coordinate in earth],
            "earthRadiusDeg": degrees(asin(6_378_137 / earth_distance)),
            "earthNorth": list(earth_rotation[:, 2]),
            "earthPrime": list(earth_rotation[:, 0]),
        })
    days = {}
    day = start.replace(hour=0, minute=0, second=0, microsecond=0)
    while day <= end:
        days[day.date().isoformat()] = daily_sunlight(day)
        day += timedelta(days=1)
    return {"results": results, "solar": solar, "details": details, "dailySunlight": days}


def export_simulation(report, start, site_id, format_name):
    detail = report["details"].get(site_id)
    if detail is None:
        raise ValueError("Select a location to export.")
    locations = {item["id"]: item for item in sites()}
    title = locations[site_id].get("name", site_id)
    points = detail["samples"]
    times = [start + timedelta(seconds=sample["offsetSeconds"]) for sample in report["solar"]]
    if format_name == "csv":
        output = StringIO()
        writer = csv.writer(output)
        writer.writerow(("UTC", "Sun azimuth deg", "Sun elevation deg", "Sun terrain horizon deg",
                         "Earth azimuth deg", "Earth elevation deg", "Earth terrain horizon deg",
                         *(name for name, _ in STATIONS), "Preferred DSN complex"))
        for t, row in zip(times, points):
            writer.writerow((t.isoformat(), *row[:6], *(int(bool(row[6] & (1 << i))) for i in range(3)), STATIONS[row[7]][0] if row[7] >= 0 else ""))
        return "text/csv", output.getvalue().encode()
    if format_name == "html":
        if len(points) < 2:
            raise ValueError("The comparison export requires a dynamic simulation.")
        _, png = export_simulation(report, start, site_id, "png")
        image = b64encode(png).decode("ascii")
        rows = json.dumps([[t.isoformat(timespec="seconds"), row[6], row[7], row[1], row[4]] for t, row in zip(times, points)])
        document = f"""<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{escape(title)} | AmTree DSN</title>
<style>body{{font:16px system-ui;background:#0e141d;color:#eef4f9;max-width:1080px;margin:24px auto;padding:0 16px}}
img{{width:100%}} input{{width:100%;accent-color:#68c7aa}} output{{display:block;margin:14px 0}}</style>
<h1>{escape(title)}</h1><img src="data:image/png;base64,{image}" alt="Sun and Earth elevation and DSN links over time">
<label for="time">DSN observation time</label><input id="time" type="range" min="0" max="{len(points)-1}" value="0">
<output id="status"></output><p>Each bar represents one DSN complex in view. The display models geometric line of sight.</p>
<script>
const samples={rows};
const stations=["Goldstone","Madrid","Canberra"];
const cursor=document.getElementById("time"), status=document.getElementById("status");
function update(){{
  const [time,mask,preferred,sun,earth]=samples[Number(cursor.value)];
  const visible=stations.filter((_,i)=>mask & (1<<i));
  status.textContent=time.replace("T"," ").replace("+00:00"," UTC")+" · Sun "+sun.toFixed(2)+"° · Earth "+earth.toFixed(2)+"° · DSN "+visible.length+"/3 · "+(visible.join(", ") || "No stations in view")+(preferred>=0 ? " · Preferred: "+stations[preferred] : "");
}}
cursor.addEventListener("input",update); update();
</script></html>"""
        return "text/html; charset=utf-8", document.encode("utf-8")
    if format_name != "png" or len(points) < 2:
        raise ValueError("The PNG export requires a dynamic simulation.")
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError as error:
        raise RuntimeError("Run Start AmTree.cmd to install the offline export dependency.") from error
    image = Image.new("RGB", (1080, 570), "#0e141d")
    draw = ImageDraw.Draw(image)
    font_dir = ROOT / "public/fonts"
    font = lambda size: ImageFont.truetype(str(font_dir / "Lato-Regular.ttf"), size)
    bold = ImageFont.truetype(str(font_dir / "Lato-Bold.ttf"), 28)
    draw.text((34, 24), f"{title} | Sun, Earth and DSN visibility", fill="#f3f5fa", font=bold)
    draw.text((34, 65), f"{times[0]:%d %b %Y %H:%M:%S} to {times[-1]:%d %b %Y %H:%M:%S} UTC", fill="#aeb9cc", font=font(18))
    x0, x1, y0, y1 = 112, 1040, 128, 330
    series = [[r[i] for r in points] for i in (1, 4)]
    low = min(-.5, min(min(channel) for channel in series))
    high = max(.5, max(max(channel) for channel in series))
    x = lambda i: x0 + (x1 - x0) * (times[i] - times[0]).total_seconds() / (times[-1] - times[0]).total_seconds()
    y = lambda v: y1 - (y1 - y0) * (v - low) / (high - low)
    draw.rectangle((x0, y0, x1, y1), outline="#344052")
    draw.text((23, 103), "Elevation (°)", fill="#aeb9cc", font=font(14))
    for elevation in (low, (low + high) / 2, high):
        draw.line((x0, y(elevation), x1, y(elevation)), fill="#394759", width=1)
        draw.text((102, y(elevation)), f"{elevation:.1f}", fill="#aeb9cc", font=font(14), anchor="rm")

    def time_axis(y_position):
        draw.line((x0, y_position, x1, y_position), fill="#627085")
        for fraction, anchor in ((0, "lt"), (.5, "mt"), (1, "rt")):
            tx = x0 + fraction * (x1 - x0)
            tick = times[0] + (times[-1] - times[0]) * fraction
            draw.line((tx, y_position, tx, y_position + 5), fill="#8796aa")
            draw.text((tx, y_position + 9), f"{tick:%d %b %H:%M:%S}", fill="#aeb9cc", font=font(13), anchor=anchor)
        draw.text(((x0+x1)/2, y_position + 27), "Time (UTC)", fill="#aeb9cc", font=font(14), anchor="mt")
    time_axis(y1)
    draw.text((25, 381), "DSN visibility", fill="#d4e2f7", font=font(16))
    for channel, label, color, label_x in zip(series, ("Sun", "Earth"), ("#fc7669", "#85b7ff"), (876, 943)):
        draw.text((label_x, 102), label, fill=color, font=font(16))
        draw.line([(x(i), y(v)) for i, v in enumerate(channel)], fill=color, width=3)
    for index, (name, _) in enumerate(STATIONS):
        yy = 405 + index * 28
        draw.text((25, yy), name, fill="#b8c9d8", font=font(15))
        draw.rectangle((x0, yy, x1, yy+21), fill="#000000")
        for i, row in enumerate(points[:-1]):
            if row[6] & (1 << index):
                draw.rectangle((x(i), yy, x(i+1), yy+21), fill="#9bcbff" if row[7] == index else "#3f83cf")
    time_axis(485)
    draw.text((112, 535), "DSN bands show line of sight. Brighter bands mark the preferred link.", fill="#aeb9cc", font=font(16))
    stream = BytesIO()
    image.save(stream, format="PNG")
    return "image/png", stream.getvalue()


def make_region_presets():
    region_ids = [region["id"] for region in read_data("artemis-regions.json")]
    presets = {}
    for key, filename in (("baseline", "comparison.json"), ("delay48", "comparison-delay48.json")):
        period = read_data(filename)["result"]["period"]
        start = datetime.fromisoformat(period["start_utc"])
        end = datetime.fromisoformat(period["end_utc"])
        results = calculate_window(start, end)["results"]
        presets[key] = {region_id: results[region_id] for region_id in region_ids}
    (DATA / "artemis-region-exposure.json").write_text(json.dumps(presets, indent=2) + "\n", encoding="utf-8")


@lru_cache(maxsize=12)
def window_export(start, end, cadence, site, format_name):
    return export_simulation(calculate_window(start, end, cadence), start, site, format_name)


def window_maps(start, end, cadence, site_id):
    from map_timelapses import MAP_LOCK, map_pair

    if not START <= start <= end <= END or cadence < 1:
        raise ValueError("Choose ordered dates within the kernel coverage and a positive sampling interval.")
    site = next((location for location in sites() if location["id"] == site_id), None)
    if site is None:
        raise ValueError("Select a location to export.")
    elevations, grids = terrain(site)
    with MAP_LOCK:
        return map_pair(ROOT, RADIUS, site_id, site["name"], site["latitude"], site["longitude"],
                        elevations, tuple(grids), start, end, cadence, body_positions)


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        route = urlsplit(self.path)
        if route.path != "/api/mission-window":
            return super().do_GET()
        query = parse_qs(route.query)
        def utc_value(field):
            value = datetime.fromisoformat(query[field][0])
            if value.utcoffset() is None:
                raise ValueError("Supply times with a UTC offset.")
            return value.astimezone(timezone.utc)

        filename = None
        try:
            start = utc_value("start")
            end = utc_value("end") if "end" in query else start
            mode = query.get("mode", ["static"])[0]
            if mode not in {"static", "dynamic"} or (mode == "dynamic" and end <= start):
                raise ValueError("The dynamic end time must be later than the start time.")
            if mode == "static":
                end = start
            cadence = int(query.get("interval", [str(SAMPLE_SECONDS)])[0])
            format_name = query.get("format", [None])[0]
            if format_name in ("illumination-gif", "dsn-gif"):
                site = query["site"][0]
                content_type = "image/gif"
                body = window_maps(start, end, cadence, site)[int(format_name == "dsn-gif")]
                filename = f"{site}-{format_name.removesuffix('-gif')}-{start:%Y%m%dT%H%M%SZ}.gif"
            elif format_name:
                site = query["site"][0]
                content_type, body = window_export(start, end, cadence, site, format_name)
                filename = f"{site}-{start:%Y%m%dT%H%M%SZ}.{format_name}"
            else:
                payload = calculate_window(start, end, cadence)
                content_type, body = "application/json", json.dumps(payload, allow_nan=False, separators=(",", ":")).encode()
            status = 200
        except (KeyError, ValueError, OverflowError, RuntimeError) as error:
            content_type = "application/json"
            status = 503 if isinstance(error, RuntimeError) else 400
            body = json.dumps({"error": str(error)}).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        if filename and query.get("download") == ["1"]:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4194)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--build-horizons", action="store_true")
    parser.add_argument("--open-browser", action="store_true")
    parser.add_argument("--build-region-presets", action="store_true")
    options = parser.parse_args()
    if options.build_horizons:
        make_profiles()
    elif options.build_region_presets:
        make_region_presets()
    else:
        with SPICE_LOCK:
            spice_runtime()
        handler = partial(Handler, directory=ROOT / "dist")
        with ThreadingHTTPServer((options.host, options.port), handler) as server:
            url = f"http://127.0.0.1:{options.port}/"
            print(f"AmTree runs at {url}", flush=True)
            if options.open_browser:
                import webbrowser
                webbrowser.open(url)
            server.serve_forever()
