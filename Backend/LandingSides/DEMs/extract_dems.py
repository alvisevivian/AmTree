import os
import json
import rasterio
from rasterio.mask import mask
from pyproj import Transformer
from shapely.geometry import Polygon, mapping

# ==============================================================================
# LRO LOLA DEM EXTRACTOR (GeoJSON to Local TIFs)
# Objective: Crop a massive Lunar DEM into specific Artemis III landing regions.
# ==============================================================================

# BYPASS PLANETARY SAFETY CHECK: Allow Earth EPSG:4326 to map to Moon projections
os.environ["PROJ_IGNORE_CELESTIAL_BODY"] = "YES"

# --- USER CONFIGURATION ---
# IMPORTANT: Put the exact path to your newly downloaded massive LRO DEM file here
INPUT_DEM_PATH = "LandingSides/DEMs/LRO_LOLA_DEM_SPole75_30mp_v04.tif" 

GEOJSON_FILE = "LandingSides/A3-9regions-lonlat-simplified.geojson"
OUTPUT_DIR = "LandingSides/DEMs"

def extract_regions():
    print("\n" + "="*60)
    print(" LUNAR DEM EXTRACTION TOOL ".center(60, "="))
    print("="*60)

    if not os.path.exists(INPUT_DEM_PATH):
        print(f"\n[!] ERROR: Input DEM not found at '{INPUT_DEM_PATH}'.")
        print("Please update 'INPUT_DEM_PATH' in the script with your downloaded file name.")
        return

    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

    # 1. Load GeoJSON
    try:
        with open(GEOJSON_FILE, 'r', encoding='utf-8') as f:
            geojson_data = json.load(f)
    except FileNotFoundError:
        print(f"\n[!] ERROR: GeoJSON file {GEOJSON_FILE} not found.")
        return

    print(f"[*] Opening Massive DEM file: {INPUT_DEM_PATH}")
    print("[*] This might take a few moments depending on the file size...\n")

    # 2. Open the large DEM and setup projection transformer
    with rasterio.open(INPUT_DEM_PATH) as src:
        dem_crs = src.crs
        print(f"[*] Original DEM CRS detected: {dem_crs}")
        
        # Transformer: EPSG:4326 (Lat/Lon) to the DEM's Native Projection
        transformer = Transformer.from_crs("EPSG:4326", dem_crs, always_xy=True)

        # 3. Process each region in the GeoJSON
        for feature in geojson_data['features']:
            region_name = feature['properties']['Region']
            safe_name = region_name.replace(" ", "_")
            out_filename = os.path.join(OUTPUT_DIR, f"{safe_name}.tif")
            
            print(f" -> Processing Region: {region_name}")

            # Extract lon/lat points from GeoJSON
            lon_lat_coords = feature['geometry']['coordinates'][0]
            
            # Reproject coordinates to match DEM's coordinate system
            projected_coords = []
            for lon, lat in lon_lat_coords:
                x, y = transformer.transform(lon, lat)
                projected_coords.append((x, y))

            # Create a Shapely Polygon and convert it to a GeoJSON-like dictionary
            poly = Polygon(projected_coords)
            geom = [mapping(poly)]

            try:
                # Mask/Crop the large DEM using the projected polygon
                out_image, out_transform = mask(src, geom, crop=True)
                out_meta = src.meta.copy()

                # Update metadata for the new, smaller TIF
                out_meta.update({
                    "driver": "GTiff",
                    "height": out_image.shape[1],
                    "width": out_image.shape[2],
                    "transform": out_transform
                })

                # Write the cropped TIF
                with rasterio.open(out_filename, "w", **out_meta) as dest:
                    dest.write(out_image)
                    
                print(f"    [+] Saved successfully: {out_filename}")
                
            except ValueError as e:
                print(f"    [!] Skipping {region_name} - Polygon might be outside the DEM bounds.")

    print("\n" + "="*60)
    print(" EXTRACTION COMPLETE ".center(60, "="))
    print(f"[*] You can now run the Simulator in 'Dynamic Mode' with 'Y' for DEM Topography.")
    print("="*60 + "\n")

if __name__ == "__main__":
    extract_regions()