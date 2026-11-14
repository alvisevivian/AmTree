import os
import json
import csv
import urllib.request
import numpy as np
import spiceypy as spice
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.path import Path

# ==============================================================================
# ADVANCED LUNAR ILLUMINATION SIMULATOR (CLI INTERACTIVE)
# Mode S (Static): Single Snapshot Gradient Heatmap (Rectangular Bar, Black Shadows)
# Mode D (Dynamic): Time-Series Propagation (Area % & Centroid Elevation)
# ==============================================================================

KERNEL_DIR = "kernels"
GEOJSON_FILE = "LandingSides/A3-9regions-lonlat-simplified.geojson"
CSV_OUTPUT = "Artemis3_Illumination_Results.csv"
DYNAMIC_IMAGE = "Illumination_Time_Series.png"
SNAPSHOT_DIR = "Snapshot_Maps"

KERNELS_TO_DOWNLOAD = {
    "naif0012.tls": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls",
    "de432s.bsp": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de432s.bsp",
    "pck00010.tpc": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00010.tpc"
}

def setup_environment():
    if not os.path.exists(KERNEL_DIR):
        os.makedirs(KERNEL_DIR)
    for filename, url in KERNELS_TO_DOWNLOAD.items():
        filepath = os.path.join(KERNEL_DIR, filename)
        if not os.path.exists(filepath):
            print(f"[*] Downloading: {filename}...")
            urllib.request.urlretrieve(url, filepath)
        spice.furnsh(filepath)

def get_user_inputs(geojson_data):
    print("\n" + "="*60)
    print(" ARTEMIS III ILLUMINATION SIMULATOR ".center(60, "="))
    print("="*60)
    
    print("\n[ SIMULATION MODE ]")
    print("  S - Static Mode  (Single Snapshot / Gradient Heatmap)")
    print("  D - Dynamic Mode (Time-Series / Propagation Window)")
    mode = input("Your Choice [S/D] (Default: D): ").strip().upper()
    if mode != 'S': mode = 'D'
    
    prefs = {'mode': mode}
    
    if mode == 'S':
        print("\n[ SINGLE SNAPSHOT TIME ]")
        target = input("Target UTC (Format: YYYY-MM-DDThh:mm:ss) [Default: 2026-11-14T12:00:00]: ").strip()
        prefs['target'] = target if target else "2026-11-14T12:00:00"
    else:
        print("\n[ TIME INTERVAL (PROPAGATION) ]")
        start = input("Start UTC [Default: 2026-11-14T00:00:00]: ").strip()
        prefs['start'] = start if start else "2026-11-14T00:00:00"
        
        end = input("End UTC [Default: 2026-11-28T00:00:00]: ").strip()
        prefs['end'] = end if end else "2026-11-28T00:00:00"
        
        step = input("Time step (Minutes) [Default: 60]: ").strip()
        prefs['step'] = int(step) if step.isdigit() else 60
    
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
            print("[!] Invalid input, all regions selected.")
            prefs['regions'] = regions_list
            
    print("="*60 + "\n")
    return prefs

def run_static_snapshot(prefs, geojson_data):
    if not os.path.exists(SNAPSHOT_DIR):
        os.makedirs(SNAPSHOT_DIR)
        
    et = spice.str2et(prefs['target'])
    sun_pos, _ = spice.spkpos("SUN", et, "IAU_MOON", "LT+S", "MOON")
    radii = spice.bodvrd("MOON", "RADII", 3)[1]
    re, flat = radii[0], (radii[0] - radii[2]) / radii[0]

    print(f"[*] Generating spatial heatmaps for {prefs['target']}...")
    
    for feature in geojson_data['features']:
        region_name = feature['properties']['Region']
        if region_name not in prefs['regions']: continue
        
        polygon_points = np.array(feature['geometry']['coordinates'][0])
        lons, lats = polygon_points[:, 0], polygon_points[:, 1]
        
        grid_lon, grid_lat = np.meshgrid(
            np.linspace(np.min(lons), np.max(lons), 50),
            np.linspace(np.min(lats), np.max(lats), 50)
        )
        grid_pts = np.column_stack((grid_lon.flatten(), grid_lat.flatten()))
        
        poly_path = Path(polygon_points)
        inside_pts = grid_pts[poly_path.contains_points(grid_pts)]
        
        elevations = []
        for pt in inside_pts:
            p = spice.georec(np.radians(pt[0]), np.radians(pt[1]), 0.0, re, flat)
            z = spice.vhat(p)
            s_vec = sun_pos - p
            angle = spice.vsep(z, s_vec)
            elevations.append(90.0 - np.degrees(angle))
            
        elevs = np.array(elevations)
        
        # Clip deep negative shadows to a tiny negative baseline to ensure they fall into the first bin
        elevs = np.clip(elevs, -1e-5, None)
        max_el = elevs.max()
        
        if max_el <= 0:
            max_el = 1.0 # Prevent flat array crash if region is totally dark
            
        # Create 31 explicit level bins. The first bin [-1e-5 to 0.0] captures all shadows.
        levels = np.zeros(31)
        levels[0] = -1e-5
        levels[1:] = np.linspace(0.0, max_el, 30)
        
        # Match colors: First bin gets Black, the remaining 29 bins get Reds
        c_list = ['black'] + [plt.cm.Reds(x) for x in np.linspace(0.2, 1.0, 29)]

        plt.figure(figsize=(10, 8))
        plt.title(f"Solar Elevation Gradient: {region_name}\nTime: {prefs['target']} (UTC)", fontsize=14, fontweight='bold')
        
        plt.xlabel("Longitude (deg)", fontsize=12, fontweight='bold')
        plt.ylabel("Latitude (deg)", fontsize=12, fontweight='bold')
        
        # Generate the contour using explicit colors (no extend='min' keyword used)
        contour = plt.tricontourf(inside_pts[:, 0], inside_pts[:, 1], elevs, levels=levels, colors=c_list)
        
        cbar = plt.colorbar(contour)
        cbar.set_label('Solar Elevation Angle (deg)', fontsize=12, fontweight='bold')
        
        # Force the ticks to only show 0 and above, hiding the microscopic negative bin boundary
        cbar.set_ticks(np.linspace(0.0, max_el, 6))
        
        plt.plot(lons, lats, color='cyan', linewidth=2, label='Region Boundary')
        plt.legend(loc='upper right')
        
        safe_name = region_name.replace(" ", "_")
        out_path = os.path.join(SNAPSHOT_DIR, f"{safe_name}_Snapshot.png")
        plt.savefig(out_path, dpi=300, bbox_inches='tight')
        plt.close()
        print(f" -> Saved heatmap: {out_path}")
        
    print(f"[*] Snapshot analysis complete. Maps saved in '{SNAPSHOT_DIR}' directory.")

def run_dynamic_timeseries(prefs, geojson_data):
    et_start = spice.str2et(prefs['start'])
    et_end = spice.str2et(prefs['end'])
    step_seconds = prefs['step'] * 60.0
    et_times = np.arange(et_start, et_end + step_seconds, step_seconds)
    
    radii = spice.bodvrd("MOON", "RADII", 3)[1]
    re, flat = radii[0], (radii[0] - radii[2]) / radii[0]

    print(f"[*] Preparing Propagation... (Number of Time Steps: {len(et_times)})")
    
    region_cache = {}
    for feature in geojson_data['features']:
        region_name = feature['properties']['Region']
        if region_name not in prefs['regions']: continue
            
        polygon_points = np.array(feature['geometry']['coordinates'][0])
        
        c_lon = np.mean(polygon_points[:, 0])
        c_lat = np.mean(polygon_points[:, 1])
        c_pos = spice.georec(np.radians(c_lon), np.radians(c_lat), 0.0, re, flat)
        c_zenith = spice.vhat(c_pos)
        
        min_lon, max_lon = np.min(polygon_points[:, 0]), np.max(polygon_points[:, 0])
        min_lat, max_lat = np.min(polygon_points[:, 1]), np.max(polygon_points[:, 1])
        
        glon, glat = np.meshgrid(np.linspace(min_lon, max_lon, 25), np.linspace(min_lat, max_lat, 25))
        grid_pts = np.column_stack((glon.flatten(), glat.flatten()))
        
        poly_path = Path(polygon_points)
        inside_pts = grid_pts[poly_path.contains_points(grid_pts)]
        
        pos_list = [spice.georec(np.radians(pt[0]), np.radians(pt[1]), 0.0, re, flat) for pt in inside_pts]
        zenith_list = [spice.vhat(p) for p in pos_list]
            
        region_cache[region_name] = {
            'c_pos': c_pos, 'c_zenith': c_zenith,
            'grid_pos': pos_list, 'grid_zenith': zenith_list, 
            'total_points': len(inside_pts)
        }

    print("[*] Processing time loop...")
    csv_data = [["Region", "Time_UTC", "Elevation_Deg", "Sunlit_Area_Pct", "Status"]]

    for et in et_times:
        current_utc = spice.et2utc(et, 'ISOC', 0)
        sun_pos, _ = spice.spkpos("SUN", et, "IAU_MOON", "LT+S", "MOON")
        
        for r_name, cache in region_cache.items():
            c_sun_vec = sun_pos - cache['c_pos']
            c_angle = spice.vsep(cache['c_zenith'], c_sun_vec)
            c_elev_deg = 90.0 - np.degrees(c_angle)
            
            sunlit_count = sum(1 for p, z in zip(cache['grid_pos'], cache['grid_zenith']) 
                               if (90.0 - np.degrees(spice.vsep(z, sun_pos - p))) > 0)
                    
            pct = (sunlit_count / cache['total_points']) * 100
            
            c_val, p_val = round(c_elev_deg, 3), round(pct, 2)
            status = "PARTIAL/SUNLIT" if p_val > 0 else "IN SHADOW"
            csv_data.append([r_name, current_utc, c_val, p_val, status])

    with open(CSV_OUTPUT, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerows(csv_data)
        
    print(f"[*] Time-series processed and saved to: {CSV_OUTPUT}")

def process_and_visualize_data(prefs):
    print(f"[*] Reading {CSV_OUTPUT} to generate ranking and chart...\n")
    try:
        df = pd.read_csv(CSV_OUTPUT)
        df['Time_UTC'] = pd.to_datetime(df['Time_UTC'])
        
        regions = df['Region'].unique()
        stats = [{'Region': r, 'Score': df[df['Region'] == r]['Sunlit_Area_Pct'].mean()} for r in regions]
        stats.sort(key=lambda x: x['Score'], reverse=True)
        
        print("="*60)
        print(f"{'RANK | REGION':<28} | AVG. SUNLIT AREA (%)")
        print("="*60)
        for rank, s in enumerate(stats, 1):
            print(f"{rank:<2}.  | {s['Region']:<22} | {s['Score']:>8.2f}%")
        print("="*60 + "\n")

        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 10), sharex=True)
        
        for r in regions:
            r_data = df[df['Region'] == r]
            ax1.plot(r_data['Time_UTC'], r_data['Sunlit_Area_Pct'], label=r, linewidth=2)
            ax2.plot(r_data['Time_UTC'], r_data['Elevation_Deg'], label=r, linewidth=2)
            
        ax1.axhline(0, color='red', linestyle='--', linewidth=1)
        ax1.set_ylabel("Sunlit Surface Area (%)", fontsize=12, fontweight='bold')
        ax1.set_title("Dynamic Mode: Area-Based Illumination vs. Centroid Reference", fontsize=16, fontweight='bold')
        ax1.set_ylim(0, 105) 
        ax1.margins(x=0)
        ax1.grid(True, linestyle=':', alpha=0.7)
        ax1.legend(loc='center left', bbox_to_anchor=(1.02, 0.5), title="Regions")
        
        ax2.set_ylabel("Centroid Elevation Angle (deg)", fontsize=12, fontweight='bold')
        ax2.set_ylim(bottom=0) 
        ax2.margins(x=0)
        ax2.grid(True, linestyle=':', alpha=0.7)
        
        plt.xlabel("Time (UTC)", fontsize=12, fontweight='bold')
        plt.gca().xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d %H:%M'))
        plt.gcf().autofmt_xdate()
        plt.tight_layout()

        plt.savefig(DYNAMIC_IMAGE, dpi=300, bbox_inches='tight')
        print(f"[*] Propagation chart successfully saved to: {DYNAMIC_IMAGE}")
        
    except Exception as e:
        print(f"\n[!] Error generating chart: {e}")

def run_simulation():
    setup_environment()
    try:
        with open(GEOJSON_FILE, 'r', encoding='utf-8') as f:
            geojson_data = json.load(f)
    except FileNotFoundError:
        print(f"ERROR: {GEOJSON_FILE} not found.")
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