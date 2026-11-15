import json
import csv
import numpy as np
import rasterio

# 1. File Paths (Update dem_file_path if your TIF file is in a different folder)
geojson_file_path = 'LandingSides/A3_Named_regions.geojson'
dem_file_path = 'Moon - Southern Sea.tif'  # The LOLA DEM file you downloaded earlier
csv_output_path = 'LandingSides/A3_Centers.csv'

# 2. Load the GeoJSON file
with open(geojson_file_path, 'r') as file:
    artemis_data = json.load(file)

csv_data = []
# Add the header row for the CSV
csv_data.append(['Name', 'lat', 'lon', 'alt'])

print("Processing regions and extracting altitude from DEM...")

# 3. Open the DEM file to query altitude
with rasterio.open(dem_file_path) as dem:
    
    # Loop through each of the 13 regions
    for feature in artemis_data['features']:
        region_name = feature['properties']['label']
        polygon_points = feature['geometry']['coordinates'][0]
        
        points_array = np.array(polygon_points)
        longitudes = points_array[:, 0]
        latitudes = points_array[:, 1]
        
        # Calculate the center (centroid)
        center_lon = np.mean(longitudes)
        center_lat = np.mean(latitudes)
        
        # 4. Sample the altitude from the DEM file
        # rasterio.sample expects an iterable of (x, y) coordinates -> (lon, lat)
        coord_to_sample = [(center_lon, center_lat)]
        
        try:
            # Extract the raw elevation value (in meters)
            raw_elevation_meters = list(dem.sample(coord_to_sample))[0][0]
            
            # Convert meters to kilometers for JPL Horizons API compatibility
            altitude_km = raw_elevation_meters / 1000.0
            
        except IndexError:
            # Fallback just in case the centroid falls outside the TIF file boundaries
            print(f"Warning: {region_name} is outside the DEM boundaries. Setting alt to 0.")
            altitude_km = 0.0
            
        # Append the formatted row to our CSV data list
        csv_data.append([
            region_name, 
            round(center_lat, 4), 
            round(center_lon, 4), 
            round(altitude_km, 4)
        ])

# 5. Write the results to a CSV file
with open(csv_output_path, 'w', newline='', encoding='utf-8') as csvfile:
    writer = csv.writer(csvfile)
    writer.writerows(csv_data)

print(f"Successfully generated CSV file at: {csv_output_path}")