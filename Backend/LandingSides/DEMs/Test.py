import json
import csv
import numpy as np

# ==============================================================================
# POLYGON CENTROID EXTRACTOR & DATASET BUILDER
# Objective: Calculate centroid of each crater from GeoJSON and save to CSV.
# ==============================================================================

# 1. FILE PATHS (Update according to your system)
geojson_file_path = 'LandingSides/A3-9regions-lonlat-simplified.geojson' 
csv_output_path = 'Artemis3_Centroid_Altitudes.csv'           

# CSV headers for output (Leaving altitude blank so you can fill it manually later)
csv_data = [["Region", "Center_Lat", "Center_Lon", "Altitude_Meters", "Altitude_km"]]

print("Loading GeoJSON and calculating center points...")
print("-" * 65)

try:
    # 2. READ THE GeoJSON FILE
    with open(geojson_file_path, 'r', encoding='utf-8') as f:
        geojson_data = json.load(f)
        
    # 3. CALCULATE THE GEOMETRIC CENTER (CENTROID) FOR EACH REGION
    for feature in geojson_data['features']:
        region_name = feature['properties']['Region']
        
        # Get coordinates (GeoJSON format returns a 3D list for polygons)
        polygon_points = feature['geometry']['coordinates'][0]
        
        # Calculate the average of the coordinates (Centroid) using Numpy
        points_array = np.array(polygon_points)
        center_lon = np.mean(points_array[:, 0])
        center_lat = np.mean(points_array[:, 1])
        
        print(f"SUCCESS | {region_name:<20} -> Lat: {center_lat:.4f}, Lon: {center_lon:.4f}")
        
        # Add the extracted data to our new dataset list (Leaving Altitude blank)
        csv_data.append([
            region_name, 
            round(center_lat, 4), 
            round(center_lon, 4), 
            "", # Altitude_Meters to be added manually later
            ""  # Altitude_km to be added manually later
        ])

    # 4. WRITE THE RESULTS TO A CLEAN CSV FILE
    with open(csv_output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerows(csv_data)
        
    print("-" * 65)
    print(f"Success! Process complete. Your clean dataset is saved at: {csv_output_path}")

except FileNotFoundError as e:
    print(f"\nFILE NOT FOUND: Please make sure the file names and paths are correct.\nDetails: {e}")
except Exception as e:
    print(f"\nCritical System Error: {e}")