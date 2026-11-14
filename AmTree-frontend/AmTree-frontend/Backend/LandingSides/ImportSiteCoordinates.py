import json
import numpy as np

# 1. Load your newly acquired GeoJSON file

geojson_file_path = 'LandingSides/A3_Named_regions.geojson'

with open(geojson_file_path, 'r') as file:
    artemis_data = json.load(file)

# Dictionary to store our automatically calculated center points
artemis_centers = {}

# 2. Loop through each of the 13 regions in the GeoJSON
for feature in artemis_data['features']:
    region_name = feature['properties']['label']
    
    # The coordinates are nested inside a list: [[[lon, lat], [lon, lat], ...]]
    polygon_points = feature['geometry']['coordinates'][0]
    
    # Convert to a numpy array for easy math
    points_array = np.array(polygon_points)
    
    # Extract all Longitudes (Column 0) and Latitudes (Column 1)
    longitudes = points_array[:, 0]
    latitudes = points_array[:, 1]
    
    # Calculate the center (centroid) by taking the average
    center_lon = np.mean(longitudes)
    center_lat = np.mean(latitudes)
    
    # Store the results in our dictionary
    artemis_centers[region_name] = {
        "lat": round(center_lat, 4),
        "lon": round(center_lon, 4)
    }

# 3. Print the results to verify
print("Successfully processed Artemis III Regions. Calculated Centers:")
for name, coords in artemis_centers.items():
    print(f"{name:30} -> Lat: {coords['lat']}, Lon: {coords['lon']}")

# Example of how you will use this in your backend API:
# target = artemis_centers['Shackleton'] 
# And then pass target['lat'] and target['lon'] to your Horizons / SPICE engine!