import os
import json
import csv
import urllib.request
import numpy as np
import spiceypy as spice
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

# ==============================================================================
# LUNAR ILLUMINATION TIME-SERIES GENERATOR, RANKING & VISUALIZER
# Objective: Propagate time, calculate solar elevation, rank regions, and plot.
# ==============================================================================

KERNEL_DIR = "kernels"
GEOJSON_FILE = "LandingSides/A3-9regions-lonlat-simplified.geojson"
CSV_OUTPUT = "Artemis3_Illumination_Windows.csv"
OUTPUT_IMAGE = "Illumination_Windows_Chart.png"

# 1. USER DEFINED TIME INTERVAL & STEP
START_UTC = "2026-11-14T00:00:00"
END_UTC = "2026-11-28T00:00:00"   # 14 days later (roughly half a Lunar day)
STEP_MINUTES = 60                 # Calculate elevation every 60 minutes

# Automated Kernel Downloader
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
            print(f"Downloading: {filename}...")
            urllib.request.urlretrieve(url, filepath)
        spice.furnsh(filepath)
    print("Environment ready. SPICE Kernels loaded.")

def generate_time_series_csv():
    setup_environment()
    
    try:
        with open(GEOJSON_FILE, 'r', encoding='utf-8') as f:
            geojson_data = json.load(f)
    except FileNotFoundError:
        print(f"ERROR: {GEOJSON_FILE} not found.")
        return False

    et_start = spice.str2et(START_UTC)
    et_end = spice.str2et(END_UTC)
    step_seconds = STEP_MINUTES * 60.0
    et_times = np.arange(et_start, et_end + step_seconds, step_seconds)
    
    print(f"\nStarting Time-Series Analysis...")
    print(f"Start: {START_UTC} | End: {END_UTC} | Step: {STEP_MINUTES} mins")
    print(f"Total time steps to compute: {len(et_times)}")
    print("-" * 70)

    radii = spice.bodvrd("MOON", "RADII", 3)[1]
    re = radii[0] 
    flat = (re - radii[2]) / re

    csv_data = [["Region", "Time_UTC", "Center_Lat", "Center_Lon", "Elevation_Deg", "Status"]]

    for et in et_times:
        current_utc = spice.et2utc(et, 'ISOC', 0)
        sun_pos_moon_center, _ = spice.spkpos("SUN", et, "IAU_MOON", "LT+S", "MOON")
        
        for feature in geojson_data['features']:
            region_name = feature['properties']['Region']
            
            polygon_points = np.array(feature['geometry']['coordinates'][0])
            center_lon = np.mean(polygon_points[:, 0])
            center_lat = np.mean(polygon_points[:, 1])
            
            lon_rad = np.radians(center_lon)
            lat_rad = np.radians(center_lat)
            
            crater_pos = spice.georec(lon_rad, lat_rad, 0.0, re, flat)
            zenith_vec = spice.vhat(crater_pos)
            sun_vec_from_crater = sun_pos_moon_center - crater_pos
            zenith_angle = spice.vsep(zenith_vec, sun_vec_from_crater)
            
            elevation_deg = 90.0 - np.degrees(zenith_angle)
            status = "SUNLIT" if elevation_deg > 0 else "IN SHADOW"
            
            csv_data.append([
                region_name, 
                current_utc, 
                round(center_lat, 4), 
                round(center_lon, 4), 
                round(elevation_deg, 3), 
                status
            ])

    with open(CSV_OUTPUT, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerows(csv_data)
        
    spice.kclear()
    print(f"Success! Time-series data saved to: {CSV_OUTPUT}\n")
    return True

def process_and_visualize_data():
    print(f"Reading dataset: {CSV_OUTPUT}...")
    try:
        df = pd.read_csv(CSV_OUTPUT)
        df['Time_UTC'] = pd.to_datetime(df['Time_UTC'])
        
        # --- RANKING LOGIC START ---
        regions = df['Region'].unique()
        illumination_stats = []
        
        for region in regions:
            region_data = df[df['Region'] == region]
            total_steps = len(region_data)
            sunlit_steps = len(region_data[region_data['Elevation_Deg'] > 0])
            sunlit_pct = (sunlit_steps / total_steps) * 100 if total_steps > 0 else 0
            
            illumination_stats.append({
                'Region': region,
                'Sunlit_Pct': sunlit_pct
            })
            
        illumination_stats.sort(key=lambda x: x['Sunlit_Pct'], reverse=True)
        
        print("=============================================")
        print(f"{'RANK | REGION':<28} | {'SUNLIT TIME (%)'}")
        print("=============================================")
        for rank, stat in enumerate(illumination_stats, 1):
            print(f"{rank:<2}.  | {stat['Region']:<22} | {stat['Sunlit_Pct']:>8.2f}%")
        print("=============================================\n")
        # --- RANKING LOGIC END ---

        print("Generating time-series chart...")
        plt.figure(figsize=(14, 7))
        
        for region in regions:
            region_data = df[df['Region'] == region]
            plt.plot(region_data['Time_UTC'], region_data['Elevation_Deg'], label=region, linewidth=2)
            
        plt.axhline(0, color='red', linestyle='--', linewidth=2, label='Horizon (0°)')
        
        plt.title("Artemis III Candidate Regions: Illumination Windows", fontsize=16, fontweight='bold', pad=15)
        plt.xlabel("Time (UTC)", fontsize=12, fontweight='bold')
        plt.ylabel("Solar Elevation Angle (Degrees)", fontsize=12, fontweight='bold')
        
        plt.gca().xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d'))
        plt.gcf().autofmt_xdate()
        plt.grid(True, linestyle=':', alpha=0.7)
        
        plt.legend(loc='center left', bbox_to_anchor=(1.02, 0.5), title="Regions")
        plt.tight_layout()
        
        plt.savefig(OUTPUT_IMAGE, dpi=300, bbox_inches='tight')
        print(f"Success! Time-series chart saved as: {OUTPUT_IMAGE}")
        
    except FileNotFoundError:
        print(f"\nERROR: Could not find {CSV_OUTPUT}.")
    except Exception as e:
        print(f"\nCritical Error: {e}")

if __name__ == "__main__":
    # Run the full pipeline
    success = generate_time_series_csv()
    if success:
        process_and_visualize_data()