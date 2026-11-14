export const SITES = [
  { id: "Site01", analysisPointId: "pgda-site01-connecting-ridge", name: "Connecting Ridge", latitude: -89.463163, longitude: -137.489553 },
  { id: "Site04", analysisPointId: "pgda-site04-shackleton-rim", name: "Shackleton Rim", latitude: -89.766811, longitude: -171.869898 },
  { id: "Site07", analysisPointId: "pgda-site07-peak-near-shackleton", name: "Peak Near Shackleton", latitude: -88.811008, longitude: 123.690068 },
  { id: "Site11", analysisPointId: "pgda-site11-de-gerlache-rim-1", name: "de Gerlache Rim 1", latitude: -88.683418, longitude: -67.9321 },
  { id: "Site20", analysisPointId: "pgda-site20-leibnitz-beta-plateau", name: "Leibnitz Beta Plateau", latitude: -85.426577, longitude: 31.742761 },
  { id: "Site23", analysisPointId: "pgda-site23-malapert-massif", name: "Malapert Massif", latitude: -85.994785, longitude: -0.235784 },
] as const;

export type SiteId = (typeof SITES)[number]["id"];
