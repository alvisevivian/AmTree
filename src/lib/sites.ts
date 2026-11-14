export const SITES = [
  { id: "Site01", name: "Connecting Ridge", latitude: -89.4632, longitude: -137.49 },
  { id: "Site04", name: "Shackleton Rim", latitude: -89.7668, longitude: -171.87 },
  { id: "Site07", name: "Peak Near Shackleton", latitude: -88.811, longitude: 123.6901 },
  { id: "Site11", name: "de Gerlache Rim 1", latitude: -88.6834, longitude: -67.9321 },
  { id: "Site20", name: "Leibnitz Beta Plateau", latitude: -85.4266, longitude: 31.74276 },
  { id: "Site23", name: "Malapert Massif", latitude: -85.9948, longitude: -0.23578 },
] as const;

export type SiteId = (typeof SITES)[number]["id"];
