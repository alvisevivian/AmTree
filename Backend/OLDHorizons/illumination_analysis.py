import os
import urllib.request
import pandas as pd
import numpy as np
import spiceypy as spice

# ==============================================================================
# LUNAR ILLUMINATION & LINE-OF-SIGHT PIPELINE (SPICE)
# Objective: Calculate solar elevation angles for Artemis III candidate regions.
# ==============================================================================

KERNEL_DIR = "kernels"
CSV_FILE = "Artemis3_Centroid_Altitudes.csv"

# 1. Automated Kernel Downloader
KERNELS_TO_DOWNLOAD = {
    "naif0012.tls": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls",
    "de432s.bsp": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de432s.bsp",
    "pck00010.tpc": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00010.tpc",
    "moon_pa_de421_1900-2050.bpc": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/moon_pa_de421_1900-2050.bpc"
}

def download_kernels():
    if not os.path.exists(KERNEL_DIR):
        os.makedirs(KERNEL_DIR)
    for filename, url in KERNELS_TO_DOWNLOAD.items():
        filepath = os.path.join(KERNEL_DIR, filename)
        if not os.path.exists(filepath):
            print(f"Downloading: {filename}...")
            urllib.request.urlretrieve(url, filepath)
        spice.furnsh(filepath) # Load the kernel into the SPICE subsystem
    print("All SPICE kernels loaded successfully.\n" + "-"*55)

# 2. Main Analysis Function
def calculate_illumination():
    download_kernels()
    
    # Test time for the analysis (e.g., a moment near the Artemis III target date)
    test_utc = "2026-11-14T12:00:00"
    et = spice.str2et(test_utc) # Convert UTC to Ephemeris Time
    print(f"Analysis Time (UTC): {test_utc}")
    print("-" * 55)
    
    # Read crater data from CSV
    try:
        df = pd.read_csv(CSV_FILE)
    except FileNotFoundError:
        print(f"ERROR: {CSV_FILE} not found. Please check the file path.")
        return

    # Sun's position relative to the Moon's center (in 'IAU_MOON' body-fixed frame)
    # 10 = SUN, 301 = MOON
    sun_pos_moon_center, _ = spice.spkpos("SUN", et, "IAU_MOON", "LT+S", "MOON")
    
    # Extract Moon radii from the loaded constants
    radii = spice.bodvrd("MOON", "RADII", 3)[1]
    re = radii[0] # Equatorial radius (1737.4 km)
    rp = radii[2] # Polar radius
    flat = (re - rp) / re # Flattening coefficient
    
    print(f"{'Region':<22} | {'Solar Elevation Angle'}")
    print("-" * 55)

    for index, row in df.iterrows():
        region = row['Region']
        lat = np.radians(row['Center_Lat'])
        lon = np.radians(row['Center_Lon'])
        alt = row['Altitude_Meters'] / 1000.0 if not pd.isna(row['Altitude_Meters']) else 0.0
        
        # Convert Lat/Lon/Alt to 3D (X, Y, Z) Cartesian Vector (from Moon center to crater)
        crater_pos = spice.georec(lon, lat, alt, re, flat)
        
        # Local Zenith Vector at the crater (Surface Normal)
        zenith_vector = spice.vhat(crater_pos)
        
        # Relative vector of the Sun as seen from the crater
        sun_vec_from_crater = sun_pos_moon_center - crater_pos
        
        # Angle between the Zenith vector and the Sun vector (in radians)
        zenith_angle = spice.vsep(zenith_vector, sun_vec_from_crater)
        
        # Elevation = 90 degrees - Zenith Angle
        elevation_deg = 90.0 - np.degrees(zenith_angle)
        
        # Status evaluation (Basic illumination before terrain masking)
        status = "SUNLIT" if elevation_deg > 0 else "IN SHADOW"
        
        print(f"{region:<22} | {elevation_deg:>6.2f}° ({status})")

    # Clear SPICE memory
    spice.kclear()

if __name__ == "__main__":
    calculate_illumination()