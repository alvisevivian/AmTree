import basePayload from "../data/comparison.json";
import delayedPayload from "../data/comparison-delay48.json";
import horizonPayload from "../data/horizon.json";
import seriesPayload from "../data/malapert-timeseries.json";
import type { SiteId } from "./sites";

export const HOUR = 3_600_000;
export const SCENARIOS = [
  { id: "baseline", label: "Baseline", landingUtc: "2027-01-10T12:00:00Z", payload: basePayload },
  { id: "delay48", label: "Delay +48 h", landingUtc: "2027-01-12T12:00:00Z", payload: delayedPayload },
] as const;
export type ScenarioId = (typeof SCENARIOS)[number]["id"];

const idMap: Record<string, SiteId> = {
  "pgda-site01-connecting-ridge": "Site01",
  "pgda-site04-shackleton-rim": "Site04",
  "pgda-site07-peak-near-shackleton": "Site07",
  "pgda-site11-de-gerlache-rim-1": "Site11",
  "pgda-site20-leibnitz-beta-plateau": "Site20",
  "pgda-site23-malapert-massif": "Site23",
};

type RawRow = (typeof basePayload.result.rows)[number];
export type SiteMetrics = {
  valid: true;
  sunlightHours: number;
  earthHours: number;
  simultaneousHours: number;
  longestDarknessHours: number;
  unknownHours: number;
  analysisId: string;
  rank: number;
  score: number;
  meets: boolean;
};

const rowsFor = (scenario: ScenarioId) => SCENARIOS.find((item) => item.id === scenario)!.payload.result.rows as RawRow[];
export function metrics(id: SiteId, scenario: ScenarioId, limit: number): SiteMetrics {
  const row = rowsFor(scenario).find((item) => idMap[item.analysis_point_id] === id)!;
  return {
    valid: true,
    sunlightHours: row.sun_visible_hours,
    earthHours: row.earth_visible_hours,
    simultaneousHours: row.sun_and_earth_visible_hours,
    longestDarknessHours: row.longest_darkness_hours,
    unknownHours: row.unknown_hours,
    analysisId: row.analysis_id,
    rank: row.rank,
    score: row.preference_score,
    meets: row.longest_darkness_hours <= limit && row.unknown_hours === 0,
  };
}

export const scenarioInfo = (scenario: ScenarioId) => {
  const item = SCENARIOS.find((candidate) => candidate.id === scenario)!;
  const start = new Date(item.payload.result.period.start_utc);
  const end = new Date(item.payload.result.period.end_utc);
  return { ...item, start, end, duration: item.payload.result.period.mission_duration_hours };
};

type Sample = (typeof seriesPayload.samples)[number];
export const MALAPERT_SAMPLES = seriesPayload.samples as Sample[];
export const MALAPERT_STEP_SECONDS = seriesPayload.period.step_s;
export const malapertSampleAt = (utcMs: number) => {
  const start = Date.parse(seriesPayload.period.start_utc);
  const index = Math.max(0, Math.min(MALAPERT_SAMPLES.length - 1, Math.round((utcMs - start) / (MALAPERT_STEP_SECONDS * 1000))));
  return MALAPERT_SAMPLES[index];
};

export const MALAPERT_HORIZON = horizonPayload.azimuth_deg.map((azDeg: number, index: number) => ({
  azDeg,
  elDeg: horizonPayload.elevation_deg[index] as number,
}));

export const hasDetailedSeries = (id: SiteId, scenario: ScenarioId) => id === "Site23" && scenario === "baseline";

export const SOURCE_SUMMARY = {
  terrain: "NASA GSFC PGDA LOLA · 80 m near field / 480 m far field",
  ephemeris: "NASA/JPL NAIF SPICE · DE440 / MOON_ME",
  visibility: "≥ 50% of the Sun or Earth disc above the terrain horizon",
  observer: "2 m above the LOLA terrain surface",
  status: "Precomputed screening data · not validated for flight operations",
};
