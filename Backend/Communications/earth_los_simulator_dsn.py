import os
import json
import csv
import urllib.request
import numpy as np
import spiceypy as spice
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import matplotlib.animation as animation
from matplotlib.path import Path
import plotly.graph_objects as go
import plotly.express as px

# BYPASS PLANETARY SAFETY CHECK: Allow Earth EPSG:4326 to map to Moon DEMs
os.environ["PROJ_IGNORE_CELESTIAL_BODY"] = "YES"

# Try importing mapping libraries for DEM processing
try:
    import rasterio
    from pyproj import Transformer
    DEM_LIBRARIES_AVAILABLE = True
except ImportError:
    DEM_LIBRARIES_AVAILABLE = False

# Try importing 3D STL generation library
try:
    from stl import mesh
    STL_AVAILABLE = True
except ImportError:
    STL_AVAILABLE = False

# ==============================================================================
# ARTEMIS III - DSN (DEEP SPACE NETWORK) COMM SIMULATOR
# Architecture: Internal DSN Coordinates and Earth Horizon Checks. Pure RF LoS.
# ==============================================================================

# DYNAMIC ABSOLUTE PATHS
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))

KERNEL_DIR = os.path.join(BASE_DIR, "kernels")
GEOJSON_FILE = os.path.join(BASE_DIR, "LandingSides", "A3-9regions-lonlat-simplified.geojson")
DEM_DIR = os.path.join(BASE_DIR, "LandingSides", "DEMs")

# OUTPUT DIRECTORIES SPLIT
STATIC_OUT = os.path.join(SCRIPT_DIR, "Outputs", "Static")
DYNAMIC_OUT = os.path.join(SCRIPT_DIR, "Outputs", "Dynamic")

# CSV FILES
STATIC_CSV = os.path.join(STATIC_OUT, "DSN_Link_Static_Results.csv")
DYNAMIC_CSV = os.path.join(DYNAMIC_OUT, "DSN_Link_Results.csv")

DYNAMIC_IMAGE = os.path.join(DYNAMIC_OUT, "DSN_TimeSeries.png")
DYNAMIC_HTML = os.path.join(DYNAMIC_OUT, "DSN_TimeSeries.html")

# CORE PLANETARY KERNELS ONLY
KERNELS_TO_DOWNLOAD = {
    "naif0012.tls": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls",
    "de432s.bsp": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de432s.bsp",
    "pck00010.tpc": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00010.tpc"
}

# HARDCODED DSN STATION TOPOGRAPHIC COORDINATES
DSN_STATIONS = {
    "Goldstone (DSS-14)": {"lon": np.radians(-116.89), "lat": np.radians(35.426), "alt": 1.0},
    "Madrid (DSS-63)": {"lon": np.radians(-4.25), "lat": np.radians(40.427), "alt": 0.8},
    "Canberra (DSS-43)": {"lon": np.radians(148.981), "lat": np.radians(-35.401), "alt": 0.6}
}

def setup_environment():
    for d in [KERNEL_DIR, DEM_DIR, STATIC_OUT, DYNAMIC_OUT]:
        if not os.path.exists(d):
            os.makedirs(d)
            
    for filename, url in KERNELS_TO_DOWNLOAD.items():
        filepath = os.path.join(KERNEL_DIR, filename)
        if not os.path.exists(filepath):
            print(f"[*] Downloading SPICE Kernel: {filename}...")
            try:
                urllib.request.urlretrieve(url, filepath)
            except Exception as e:
                print(f"[!] CRITICAL ERROR: Failed to download {filename}. Check internet connection.")
                exit(1)
        spice.furnsh(filepath)

def get_user_inputs(geojson_data):
    print("\n" + "="*65)
    print(" ARTEMIS III - DSN MULTI-NODE COMM SIMULATOR ".center(65, "="))
    print("="*65)
    
    prefs = {}
    print("\n[ SIMULATION MODE ]")
    print("  S - Static Mode  (Instant Snapshot PNG, HTML & CSV)")
    print("  D - Dynamic Mode (Time-Series CSV, HTML & GIF)")
    mode = input("Your Choice [S/D] (Default: D): ").strip().upper()
    prefs['mode'] = 'S' if mode == 'S' else 'D'
    
    print("\n[ TERRAIN MASKING / TOPOGRAPHY ]")
    if DEM_LIBRARIES_AVAILABLE:
        print("  Y - Yes (Use extracted DEM .tif files for True Surface LoS)")
        print("  N - No  (Use Idealized Smooth Ellipsoid - Fast)")
        use_dem = input("Enable High-Fidelity Terrain Calculation? [Y/N] (Default: N): ").strip().upper()
        prefs['use_dem'] = True if use_dem == 'Y' else False
    else:
        prefs['use_dem'] = False
        
    prefs['export_stl'] = False
    if prefs['use_dem'] and STL_AVAILABLE:
        print("\n[ 3D PRINT EXPORT ]")
        exp = input("Generate 3D Print (.STL) file for regions? [Y/N] (Default: N): ").strip().upper()
        prefs['export_stl'] = True if exp == 'Y' else False

    print("\n[ TIME INTERVAL ]")
    if prefs['mode'] == 'S':
        target = input("Target UTC (Format: YYYY-MM-DDThh:mm:ss) [Default: 2026-11-14T12:00:00]: ").strip()
        prefs['target'] = target if target else "2026-11-14T12:00:00"
    else:
        start = input("Start UTC [Default: 2026-11-14T00:00:00]: ").strip()
        prefs['start'] = start if start else "2026-11-14T00:00:00"
        end = input("End UTC [Default: 2026-11-28T00:00:00]: ").strip()
        prefs['end'] = end if end else "2026-11-28T00:00:00"
        step = input("Time step (Minutes) [Default: 60]: ").strip()
        prefs['step'] = int(step) if step.isdigit() else 60
        
        print("\n[ ANIMATION EXPORT ]")
        gif_exp = input("Generate Animated Heatmap (.GIF) for regions? [Y/N] (Default: N): ").strip().upper()
        prefs['generate_gif'] = True if gif_exp == 'Y' else False

    print("\n[ REGION SELECTION ]")
    regions_list = [f['properties']['Region'] for f in geojson_data['features']]
    for i, r in enumerate(regions_list):
        print(f"  {i+1}. {r}")
    
    sel = input("Enter regions to calculate separated by commas (e.g., 1,3) or 'all' [Default: all]: ").strip().lower()
    
    if sel == '' or sel == 'all':
        prefs['regions'] = regions_list
    else:
        try:
            indices = [int(x.strip())-1 for x in sel.split(',')]
            prefs['regions'] = [regions_list[i] for i in indices if 0 <= i < len(regions_list)]
        except:
            prefs['regions'] = regions_list
            
    return prefs

def get_elevation_from_dem(lon_array, lat_array, dem_path):
    try:
        with rasterio.open(dem_path) as src:
            dem_crs = src.crs
            transformer = Transformer.from_crs("EPSG:4326", dem_crs, always_xy=True)
            x_coords, y_coords = transformer.transform(lon_array, lat_array)
            
            altitudes_km = []
            nodata_val = src.nodata
            for x, y in zip(x_coords, y_coords):
                row = max(0, min(src.index(x, y)[0], src.height - 1))
                col = max(0, min(src.index(x, y)[1], src.width - 1))
                val = src.read(1)[row, col]
                if (nodata_val is not None and val == nodata_val) or val < -10000:
                    val = 0.0
                altitudes_km.append(val / 1000.0) 
        return altitudes_km
    except:
        return [0.0] * len(lon_array)

def build_region_cache(prefs, geojson_data, re_moon, flat_moon):
    region_cache = {}
    for feature in geojson_data['features']:
        region_name = feature['properties']['Region']
        if region_name not in prefs['regions']: continue
            
        polygon_points = np.array(feature['geometry']['coordinates'][0])
        min_lon, max_lon = np.min(polygon_points[:, 0]), np.max(polygon_points[:, 0])
        min_lat, max_lat = np.min(polygon_points[:, 1]), np.max(polygon_points[:, 1])
        
        glon, glat = np.meshgrid(np.linspace(min_lon, max_lon, 30), np.linspace(min_lat, max_lat, 30))
        grid_pts = np.column_stack((glon.flatten(), glat.flatten()))
        
        poly_path = Path(polygon_points)
        inside_pts = grid_pts[poly_path.contains_points(grid_pts)]
        lons, lats = inside_pts[:, 0], inside_pts[:, 1]
        
        dem_path = None
        if prefs['use_dem']:
            dem_filename = f"{region_name.replace(' ', '_')}.tif"
            dem_path = os.path.join(DEM_DIR, dem_filename)
            if os.path.exists(dem_path):
                alts = get_elevation_from_dem(lons, lats, dem_path)
            else:
                alts = [0.0] * len(lons)
                dem_path = None
        else:
            alts = [0.0] * len(lons)
            
        pos_list = [spice.georec(np.radians(lon), np.radians(lat), alt, re_moon, flat_moon) for lon, lat, alt in zip(lons, lats, alts)]
        
        c_lon, c_lat = np.mean(lons), np.mean(lats)
        c_alt = np.mean(alts) if len(alts) > 0 else 0.0
        c_pos = spice.georec(np.radians(c_lon), np.radians(c_lat), c_alt, re_moon, flat_moon)
        
        region_cache[region_name] = {
            'c_pos': c_pos, 
            'c_zenith': spice.vhat(c_pos),
            'inside_pts': inside_pts,
            'grid_pos': pos_list, 
            'grid_zenith': [spice.vhat(p) for p in pos_list], 
            'total_points': len(inside_pts),
            'boundary': polygon_points,
            'dem_path': dem_path
        }
    return region_cache

def export_3d_stl(r_name, dem_path, safe_name, target_dir):
    if not dem_path or not os.path.exists(dem_path):
        return
    stl_path = os.path.join(target_dir, f"{safe_name}_Topography.stl")
    
    with rasterio.open(dem_path) as src:
        z_arr = src.read(1).astype(np.float32)
        if src.nodata is not None:
            valid_mask = z_arr != src.nodata
            if np.any(valid_mask):
                min_z = np.nanmin(z_arr[valid_mask])
                z_arr[~valid_mask] = min_z
            else:
                z_arr[:] = 0.0
        z_arr = np.nan_to_num(z_arr, nan=np.nanmin(z_arr))
        
        step = max(1, max(src.width, src.height) // 250)
        z_arr = z_arr[::step, ::step]
        rows, cols = z_arr.shape
        
        faces = []
        for row in range(rows - 1):
            for col in range(cols - 1):
                x1, y1 = src.transform * (col * step, row * step)
                x2, y2 = src.transform * ((col + 1) * step, row * step)
                x3, y3 = src.transform * (col * step, (row + 1) * step)
                x4, y4 = src.transform * ((col + 1) * step, (row + 1) * step)
                
                v1 = [x1, y1, z_arr[row, col]]
                v2 = [x2, y2, z_arr[row, col + 1]]
                v3 = [x3, y3, z_arr[row + 1, col]]
                v4 = [x4, y4, z_arr[row + 1, col + 1]]
                
                faces.append([v1, v2, v3])
                faces.append([v2, v4, v3])
                
        faces = np.array(faces)
        surface_mesh = mesh.Mesh(np.zeros(faces.shape[0], dtype=mesh.Mesh.dtype))
        for i, f in enumerate(faces):
            for j in range(3):
                surface_mesh.vectors[i][j] = f[j]
                
        surface_mesh.save(stl_path)

def get_dsn_positions_in_moon_frame(et):
    re_earth, _, rp_earth = spice.bodvrd("EARTH", "RADII", 3)[1]
    flat_earth = (re_earth - rp_earth) / re_earth
    
    earth_pos_moon, _ = spice.spkpos("EARTH", et, "IAU_MOON", "LT+S", "MOON")
    rot_mat = spice.pxform("IAU_EARTH", "IAU_MOON", et)
    
    dsn_data = {}
    for name, coords in DSN_STATIONS.items():
        st_pos_earth = spice.georec(coords['lon'], coords['lat'], coords['alt'], re_earth, flat_earth)
        st_pos_moon_offset = spice.mxv(rot_mat, st_pos_earth)
        dsn_pos_moon = earth_pos_moon + st_pos_moon_offset
        
        dsn_data[name] = {
            'pos': dsn_pos_moon,
            'earth_normal': st_pos_moon_offset
        }
    return dsn_data

def run_static_snapshot(prefs, geojson_data):
    et = spice.str2et(prefs['target'])
    
    radii_moon = spice.bodvrd("MOON", "RADII", 3)[1]
    re_moon, flat_moon = radii_moon[0], (radii_moon[0] - radii_moon[2]) / radii_moon[0]

    print(f"\n[*] Generating DSN Link Snapshot & CSV for {prefs['target']} -> Outputs/Static...")
    region_cache = build_region_cache(prefs, geojson_data, re_moon, flat_moon)
    dsn_data = get_dsn_positions_in_moon_frame(et)
    
    current_utc = spice.et2utc(et, 'ISOC', 0)
    csv_data = [["Region", "Time_UTC", "Max_DSN_Elev_Deg", "DSN_Coverage_Pct", "Signal_Quality", "Active_Nodes"]]
    
    for r_name, cache in region_cache.items():
        safe_name = r_name.replace(" ", "_")
        
        elevations = []
        for p, z in zip(cache['grid_pos'], cache['grid_zenith']):
            max_el = -90.0
            for st_name, st_info in dsn_data.items():
                st_pos = st_info['pos']
                earth_normal = st_info['earth_normal']
                
                if np.degrees(spice.vsep(earth_normal, -st_pos)) < 90.0:
                    el = 90.0 - np.degrees(spice.vsep(z, st_pos - p))
                    if el > max_el: max_el = el
            elevations.append(max_el)
            
        elevs = np.array(elevations)
        vis_count = sum(1 for el in elevs if el > 0)
        pct = (vis_count / cache['total_points']) * 100
        
        active_nodes = []
        c_max_elev = -90.0
        for st_name, st_info in dsn_data.items():
            st_pos = st_info['pos']
            earth_normal = st_info['earth_normal']
            
            if np.degrees(spice.vsep(earth_normal, -st_pos)) < 90.0:
                el = 90.0 - np.degrees(spice.vsep(cache['c_zenith'], st_pos - cache['c_pos']))
                if el > c_max_elev: c_max_elev = el
                if el > 0: active_nodes.append(st_name)
            
        if len(active_nodes) == 3: sig_qual = "Excellent (3 Nodes)"
        elif len(active_nodes) == 2: sig_qual = "Good (2 Nodes)"
        elif len(active_nodes) == 1: sig_qual = "Nominal (1 Node)"
        else: sig_qual = "NO SIGNAL"
        
        nodes_short = ", ".join([n.split(" ")[0] for n in active_nodes]) if active_nodes else "None"
        nodes_full = ", ".join(active_nodes) if active_nodes else "None"
        
        csv_data.append([r_name, current_utc, round(c_max_elev, 3), round(pct, 2), sig_qual, nodes_full])
        
        elevs_clipped = np.clip(elevs, -1e-5, None)
        max_el_map = max(1.0, elevs_clipped.max())
            
        levels = np.zeros(31)
        levels[0] = -1e-5
        levels[1:] = np.linspace(0.0, max_el_map, 30)
        c_list = ['black'] + [plt.cm.Blues(x) for x in np.linspace(0.2, 1.0, 29)]

        fig = plt.figure(figsize=(10, 8))
        mode_title = "DEM Masked" if prefs['use_dem'] else "Ellipsoid"
        
        plt.title(f"DSN Link Gradient: {r_name} ({mode_title})\nUTC: {current_utc} | Active: {nodes_short}", fontsize=14, fontweight='bold')
        
        plt.xlabel("Longitude (deg)", fontsize=12, fontweight='bold')
        plt.ylabel("Latitude (deg)", fontsize=12, fontweight='bold')
        
        contour = plt.tricontourf(cache['inside_pts'][:, 0], cache['inside_pts'][:, 1], elevs_clipped, levels=levels, colors=c_list)
        cbar = plt.colorbar(contour)
        cbar.set_label('Best DSN Elevation Angle (deg)', fontsize=12, fontweight='bold')
        cbar.set_ticks(np.linspace(0.0, max_el_map, 6))
        
        plt.plot(cache['boundary'][:, 0], cache['boundary'][:, 1], color='cyan', linewidth=2, label='Region Boundary')
        plt.legend(loc='upper right')
        
        out_png = os.path.join(STATIC_OUT, f"{safe_name}_DSN_Link.png")
        plt.savefig(out_png, dpi=300, bbox_inches='tight')
        plt.close()

        fig_plotly = go.Figure(data=go.Contour(
            x=cache['inside_pts'][:, 0],
            y=cache['inside_pts'][:, 1],
            z=elevs_clipped,
            colorscale=[[0, 'black'], [1e-5/max_el_map, 'black'], [1e-5/max_el_map, '#cfe2f3'], [1, '#0b5394']],
            colorbar=dict(title='Max DSN Elev (deg)'),
            hovertemplate='Lon: %{x:.2f}°<br>Lat: %{y:.2f}°<br>Elev: %{z:.2f}°<extra></extra>'
        ))
        
        fig_plotly.add_trace(go.Scatter(
            x=cache['boundary'][:, 0], y=cache['boundary'][:, 1],
            mode='lines', line=dict(color='cyan', width=3), name='Boundary'
        ))
        
        fig_plotly.update_layout(
            title=f"DSN Map: {r_name} ({current_utc}) - {sig_qual}",
            xaxis_title="Longitude (deg)",
            yaxis_title="Latitude (deg)",
            template="plotly_dark"
        )
        
        out_html = os.path.join(STATIC_OUT, f"{safe_name}_DSN_Link_Interactive.html")
        fig_plotly.write_html(out_html)
        
        if prefs.get('export_stl'):
            export_3d_stl(r_name, cache['dem_path'], safe_name, STATIC_OUT)

    with open(STATIC_CSV, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerows(csv_data)
    print(f"\n[*] Static DSN Report saved to: {STATIC_CSV}")

def run_dynamic_timeseries(prefs, geojson_data):
    et_start, et_end = spice.str2et(prefs['start']), spice.str2et(prefs['end'])
    step_seconds = prefs['step'] * 60.0
    et_times = np.arange(et_start, et_end + step_seconds, step_seconds)
    
    radii_moon = spice.bodvrd("MOON", "RADII", 3)[1]
    re_moon, flat_moon = radii_moon[0], (radii_moon[0] - radii_moon[2]) / radii_moon[0]

    print(f"\n[*] Preparing Dynamic DSN Propagation -> Outputs/Dynamic (Time Steps: {len(et_times)})")
    region_cache = build_region_cache(prefs, geojson_data, re_moon, flat_moon)
    csv_data = [["Region", "Time_UTC", "Max_DSN_Elev_Deg", "DSN_Coverage_Pct", "Signal_Quality", "Active_Nodes"]]

    for r_name, cache in region_cache.items():
        safe_name = r_name.replace(" ", "_")
        
        if prefs.get('export_stl'):
            export_3d_stl(r_name, cache['dem_path'], safe_name, DYNAMIC_OUT)

        print(f"    -> Tracking Multi-Node DSN Handover for {r_name}...")
        all_frames = [] if prefs.get('generate_gif') else None
        all_connected_nodes = [] if prefs.get('generate_gif') else None
        
        for et in et_times:
            current_utc = spice.et2utc(et, 'ISOC', 0)
            dsn_data = get_dsn_positions_in_moon_frame(et)
            
            elevations = []
            for p, z in zip(cache['grid_pos'], cache['grid_zenith']):
                max_el = -90.0
                for st_name, st_info in dsn_data.items():
                    st_pos = st_info['pos']
                    earth_normal = st_info['earth_normal']
                    
                    if np.degrees(spice.vsep(earth_normal, -st_pos)) < 90.0:
                        el = 90.0 - np.degrees(spice.vsep(z, st_pos - p))
                        if el > max_el: max_el = el
                elevations.append(max_el)
                
            elevs = np.array(elevations)
            vis_count = sum(1 for el in elevs if el > 0)
            pct = (vis_count / cache['total_points']) * 100
            
            active_nodes = []
            c_max_elev = -90.0
            for st_name, st_info in dsn_data.items():
                st_pos = st_info['pos']
                earth_normal = st_info['earth_normal']
                
                if np.degrees(spice.vsep(earth_normal, -st_pos)) < 90.0:
                    el = 90.0 - np.degrees(spice.vsep(cache['c_zenith'], st_pos - cache['c_pos']))
                    if el > c_max_elev: c_max_elev = el
                    if el > 0: active_nodes.append(st_name)
                
            if len(active_nodes) == 3: sig_qual = "Excellent (3 Nodes)"
            elif len(active_nodes) == 2: sig_qual = "Good (2 Nodes)"
            elif len(active_nodes) == 1: sig_qual = "Nominal (1 Node)"
            else: sig_qual = "NO SIGNAL"
            
            nodes_short = ", ".join([n.split(" ")[0] for n in active_nodes]) if active_nodes else "None"
            nodes_full = ", ".join(active_nodes) if active_nodes else "None"
            
            if prefs.get('generate_gif'):
                all_frames.append(np.clip(elevs, -1e-5, None))
                all_connected_nodes.append(nodes_short)

            csv_data.append([r_name, current_utc, round(c_max_elev, 3), round(pct, 2), sig_qual, nodes_full])

        if prefs.get('generate_gif') and all_frames:
            print(f"    [*] Rendering DSN Timelapse GIF for {r_name}...")
            global_max = max(1.0, max([np.max(f) for f in all_frames]))
            levels = np.zeros(31)
            levels[0] = -1e-5
            levels[1:] = np.linspace(0.0, global_max, 30)
            c_list = ['black'] + [plt.cm.Blues(x) for x in np.linspace(0.2, 1.0, 29)]
                
            fig = plt.figure(figsize=(10, 8))
            
            def update_frame(i):
                fig.clf()
                ax = fig.add_subplot(111)
                current_utc = spice.et2utc(et_times[i], 'ISOC', 0)
                mode_title = "DEM Calculated" if prefs['use_dem'] else "Ellipsoid Calculated"
                connected_str = all_connected_nodes[i]
                
                ax.set_title(f"DSN Handover Timelapse: {r_name} ({mode_title})\nTime: {current_utc} (UTC) | Active: {connected_str}", fontsize=14, fontweight='bold')
                
                ax.set_xlabel("Longitude (deg)", fontsize=12, fontweight='bold')
                ax.set_ylabel("Latitude (deg)", fontsize=12, fontweight='bold')
                
                contour = ax.tricontourf(cache['inside_pts'][:, 0], cache['inside_pts'][:, 1], all_frames[i], levels=levels, colors=c_list)
                cbar = fig.colorbar(contour, ax=ax)
                cbar.set_label('Best DSN Elev (deg)', fontsize=12, fontweight='bold')
                cbar.set_ticks(np.linspace(0.0, global_max, 6))
                
                ax.plot(cache['boundary'][:, 0], cache['boundary'][:, 1], color='cyan', linewidth=2, label='Region Boundary')
                ax.legend(loc='upper right')

            ani = animation.FuncAnimation(fig, update_frame, frames=len(et_times), repeat=False)
            gif_path = os.path.join(DYNAMIC_OUT, f"{safe_name}_DSN_Timelapse.gif")
            ani.save(gif_path, writer='pillow', fps=10)
            plt.close(fig)

    with open(DYNAMIC_CSV, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerows(csv_data)
        
    print(f"[*] DSN Propagation processed and saved to: {DYNAMIC_CSV}")

def process_and_visualize_data(prefs):
    print(f"[*] Generating PNG and Interactive HTML charts...\n")
    try:
        df = pd.read_csv(DYNAMIC_CSV)
        df['Time_UTC'] = pd.to_datetime(df['Time_UTC'])
        
        regions = df['Region'].unique()
        
        fig, ax1 = plt.subplots(figsize=(14, 6))
        for r in regions:
            r_data = df[df['Region'] == r]
            ax1.plot(r_data['Time_UTC'], r_data['DSN_Coverage_Pct'], label=r, linewidth=2)
            
        ax1.axhline(0, color='red', linestyle='--', linewidth=1)
        ax1.set_ylabel("DSN Visible Area (%)", fontsize=12, fontweight='bold')
        mode_text = "DEM Topology Integrated" if prefs['use_dem'] else "Ellipsoid Reference"
        ax1.set_title(f"Multi-Node DSN Link Coverage ({mode_text})", fontsize=16, fontweight='bold')
        ax1.set_ylim(0, 105)
        ax1.margins(x=0)
        ax1.grid(True, linestyle=':', alpha=0.7)
        ax1.legend(loc='center left', bbox_to_anchor=(1.02, 0.5), title="Regions")
        
        plt.xlabel("Time (UTC)", fontsize=12, fontweight='bold')
        plt.gca().xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d %H:%M'))
        plt.gcf().autofmt_xdate()
        plt.tight_layout()
        plt.savefig(DYNAMIC_IMAGE, dpi=300, bbox_inches='tight')
        
        fig_plotly = go.Figure()
        for r in regions:
            r_data = df[df['Region'] == r]
            fig_plotly.add_trace(go.Scatter(
                x=r_data['Time_UTC'], y=r_data['DSN_Coverage_Pct'], 
                mode='lines', name=r,
                hovertemplate='%{x}<br>Coverage: %{y:.1f}%<br>Link: %{customdata[0]}<br>Nodes: %{customdata[1]}<extra></extra>',
                customdata=r_data[['Signal_Quality', 'Active_Nodes']].values
            ))
            
        fig_plotly.update_layout(
            title=f"Interactive Multi-Node DSN Coverage ({mode_text})",
            xaxis_title="Time (UTC)",
            yaxis_title="Visible Area (%)",
            yaxis=dict(range=[0, 105]),
            template="plotly_dark",
            legend_title="Regions"
        )
        fig_plotly.write_html(DYNAMIC_HTML)
        
        print(f" [+] Static Chart Saved: {DYNAMIC_IMAGE}")
        print(f" [+] Interactive Web Chart Saved: {DYNAMIC_HTML}")
        
    except Exception as e:
        print(f"\n[!] Error generating chart: {e}")

def run_simulation():
    setup_environment()
    try:
        with open(GEOJSON_FILE, 'r', encoding='utf-8') as f:
            geojson_data = json.load(f)
    except FileNotFoundError:
        return None

    prefs = get_user_inputs(geojson_data)
    
    if prefs['mode'] == 'S':
        run_static_snapshot(prefs, geojson_data)
        spice.kclear()
        return None 
    else:
        run_dynamic_timeseries(prefs, geojson_data)
        spice.kclear()
        return prefs

if __name__ == "__main__":
    user_prefs = run_simulation()
    if user_prefs and user_prefs['mode'] == 'D':
        process_and_visualize_data(user_prefs)