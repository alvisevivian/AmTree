import os
import json
import urllib.request
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.path import Path
import spiceypy as spice

# ==============================================================================
# SPICE LUNAR ILLUMINATION GRADIENT MAPPER
# Objective: Generate solar elevation heatmaps inside GeoJSON polygons.
# ==============================================================================

KERNEL_DIR = "kernels"
GEOJSON_FILE = "LandingSides/A3-9regions-lonlat-simplified.geojson"
OUTPUT_DIR = "Gradient_Maps"

# 1. Automated Kernel Downloader (Kept from previous script)
KERNELS_TO_DOWNLOAD = {
    "naif0012.tls": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls",
    "de432s.bsp": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de432s.bsp",
    "pck00010.tpc": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00010.tpc"
}

def setup_environment():
    if not os.path.exists(KERNEL_DIR):
        os.makedirs(KERNEL_DIR)
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        
    for filename, url in KERNELS_TO_DOWNLOAD.items():
        filepath = os.path.join(KERNEL_DIR, filename)
        if not os.path.exists(filepath):
            print(f"Downloading: {filename}...")
            urllib.request.urlretrieve(url, filepath)
        spice.furnsh(filepath)
    print("Environment ready. SPICE Kernels loaded.")

# 2. Main Processing and Plotting Function
def generate_gradient_maps():
    setup_environment()
    
    # Target time for the analysis
    test_utc = "2026-11-14T12:00:00"
    et = spice.str2et(test_utc)
    
    # Get Sun position and Moon shape parameters
    sun_pos_moon_center, _ = spice.spkpos("SUN", et, "IAU_MOON", "LT+S", "MOON")
    radii = spice.bodvrd("MOON", "RADII", 3)[1]
    re = radii[0] # 1737.4 km
    flat = (re - radii[2]) / re

    # Load the GeoJSON polygons
    try:
        with open(GEOJSON_FILE, 'r', encoding='utf-8') as f:
            geojson_data = json.load(f)
    except FileNotFoundError:
        print(f"ERROR: {GEOJSON_FILE} not found.")
        return

    print(f"\nStarting spatial illumination analysis for {test_utc}")
    print("-" * 60)

    # Loop through each landing region
    for feature in geojson_data['features']:
        region_name = feature['properties']['Region']
        print(f"Processing Region: {region_name}...")
        
        polygon_points = np.array(feature['geometry']['coordinates'][0])
        lons = polygon_points[:, 0]
        lats = polygon_points[:, 1]
        
        # Create a bounding box for the polygon
        min_lon, max_lon = np.min(lons), np.max(lons)
        min_lat, max_lat = np.min(lats), np.max(lats)
        
        # Generate a grid of points (e.g., 50x50 resolution)
        grid_lon, grid_lat = np.meshgrid(
            np.linspace(min_lon, max_lon, 50),
            np.linspace(min_lat, max_lat, 50)
        )
        grid_points = np.column_stack((grid_lon.flatten(), grid_lat.flatten()))
        
        # Filter points that are strictly INSIDE the polygon
        poly_path = Path(polygon_points)
        inside_mask = poly_path.contains_points(grid_points)
        inside_points = grid_points[inside_mask]
        
        elevations = []
        
        # Calculate SPICE elevation angle for each point inside the region
        for point in inside_points:
            pt_lon_rad = np.radians(point[0])
            pt_lat_rad = np.radians(point[1])
            
            # Using elevation 0 for the base sphere gradient (without DEM)
            pos_vec = spice.georec(pt_lon_rad, pt_lat_rad, 0.0, re, flat)
            zenith_vec = spice.vhat(pos_vec)
            sun_vec = sun_pos_moon_center - pos_vec
            zenith_angle = spice.vsep(zenith_vec, sun_vec)
            elevation_deg = 90.0 - np.degrees(zenith_angle)
            elevations.append(elevation_deg)
            
        elevations = np.array(elevations)
        
        # 3. GENERATE THE GRADIENT HEATMAP (Contour Plot)
        plt.figure(figsize=(10, 8))
        plt.title(f"Solar Elevation Gradient: {region_name}\nTime: {test_utc}", fontsize=14)
        plt.xlabel("Longitude", fontsize=12)
        plt.ylabel("Latitude", fontsize=12)
        
        # Plot the smooth gradient (tricontourf connects the scattered points into a fluid map)
        contour = plt.tricontourf(inside_points[:, 0], inside_points[:, 1], elevations, levels=30, cmap='plasma')
        cbar = plt.colorbar(contour)
        cbar.set_label('Solar Elevation Angle (Degrees)', fontsize=12)
        
        # Overlay the actual polygon boundary for clarity
        plt.plot(lons, lats, color='cyan', linewidth=2, label='Region Boundary')
        plt.legend()
        
        # Save the map
        safe_name = region_name.replace(" ", "_")
        output_path = os.path.join(OUTPUT_DIR, f"{safe_name}_Illumination.png")
        plt.savefig(output_path, dpi=300, bbox_inches='tight')
        plt.close()
        
        print(f" -> Gradient map saved to: {output_path}")

    spice.kclear()
    print("-" * 60)
    print("All spatial analyses completed successfully!")

if __name__ == "__main__":
    generate_gradient_maps()