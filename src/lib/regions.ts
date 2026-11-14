export type CandidateRegion = {
  region_id: string;
  name: string;
  geometry_status: "verified_against_source_files" | "unavailable";
  geometry_type: "navigation_grid_extent" | null;
  geometry_status_reason: string;
  label_position: {
    lat_deg: number;
    lon_deg: number;
    status: "derived_from_verified_geometry" | "approximate";
    warning?: string;
  };
  render_position: {
    unit_vector: [number, number, number];
    status: "derived_from_verified_geometry" | "approximate";
  };
  analysis_point_ids: string[];
};

type CatalogResponse = { regions: CandidateRegion[] };

export async function loadCandidateRegions(): Promise<CandidateRegion[]> {
  for (const url of ["/science/catalog.json", "/api/v1/regions"]) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const payload = await response.json() as CatalogResponse | CandidateRegion[];
      const regions = Array.isArray(payload) ? payload : payload.regions;
      if (Array.isArray(regions) && regions.length === 9) return regions;
    } catch {
      // The static catalog is the normal demo source; the API is an optional fallback.
    }
  }
  return [];
}

// Densified source rings are rectangular navigation-grid extents. These corner
// vectors come from the verified ring_unit_vectors in the supplied region files.
// They are not official NASA candidate-region boundaries.
export const VERIFIED_REGION_OUTLINES: Record<string, [number, number, number][]> = {
  haworth: [
    [0.043397842, -0.030667809, -0.998587058],
    [0.043406132, -0.013311214, -0.998968828],
    [0.060741334, -0.012726756, -0.998072402],
    [0.060730043, -0.030075831, -0.997701010],
    [0.043397842, -0.030667809, -0.998587058],
  ],
  "malapert-massif": [
    [0.063629984, -0.006362998, -0.997953274],
    [0.063630096, 0.005784554, -0.997956788],
    [0.076322089, 0.005781976, -0.997066451],
    [0.076321955, -0.006360163, -0.997062941],
    [0.063629984, -0.006362998, -0.997953274],
  ],
};
