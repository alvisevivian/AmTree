import rasterio
import numpy as np
import json

# 1. Read the TIF File (GeoTIFF)
file_path = 'Moon - Southern Sea.tif'

with rasterio.open(file_path) as dataset:
    # Read Band 1 (Elevation data is usually in the first band)
    # Cast to float since elevation values (in meters) can be decimals
    elevation_matrix = dataset.read(1).astype(float)
    
    # Get the bounding box of the map (Useful for mapping coordinates later)
    bounds = dataset.bounds
    print(f"Original Map Shape: {elevation_matrix.shape}")
    
# 2. Downsampling (To prevent frontend browser crashes)
# Taking every 10th pixel. Adjust 'step_size' based on UI performance needs.
step_size = 10  
small_matrix = elevation_matrix[::step_size, ::step_size]
print(f"Downsampled Map Shape for Frontend: {small_matrix.shape}")

# 3. Export to JSON (Data Handoff to UI Team)
# Convert the NumPy array to a standard Python list for JSON serialization
frontend_data = {
    "bounds": {
        "left": bounds.left,
        "bottom": bounds.bottom,
        "right": bounds.right,
        "top": bounds.top
    },
    "z_matrix": small_matrix.tolist()
}

with open('moon_surface_mock.json', 'w') as json_file:
    json.dump(frontend_data, json_file)

print("Process Complete! 'moon_surface_mock.json' is ready to be shared with the frontend team.")