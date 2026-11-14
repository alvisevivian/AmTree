import type { SiteId } from "./sites";

export const COVERAGE_START = "2027-01-10T12:00:00.000Z";
export const COVERAGE_END = "2027-01-17T12:00:00.000Z";
export const HOUR = 3_600_000;

export type HourInterval = [number, number];
export type Result = {
  schemaVersion: "1.0";
  siteId: SiteId;
  dataMode: "synthetic-demo";
  coverage: { startUtc: string; endUtc: string };
  sampleIntervalSeconds: 900;
  samples: { tUtc: string; sunAzDeg: number; sunElDeg: number; earthAzDeg: number; earthElDeg: number }[];
  horizonProfile: { azDeg: number; elDeg: number }[];
  visibilityIntervals: { sunlight: { startUtc: string; endUtc: string }[]; earth: { startUtc: string; endUtc: string }[] };
  provenance: { label: string; synthetic: true; generator: string };
};

export const INPUTS: Record<SiteId, { darkness: HourInterval[]; earth: HourInterval[] }> = {
  Site01: { darkness: [[30,36],[82,100]], earth: [[0,22],[32,70],[78,140]] },
  Site04: { darkness: [[20,28],[68,77],[139,151]], earth: [[0,48],[65,105],[124,168]] },
  Site07: { darkness: [[27,39],[64,80],[130,145]], earth: [[8,27],[44,60],[95,142]] },
  Site11: { darkness: [[50,66],[108,123]], earth: [[0,55],[68,98],[110,160]] },
  Site20: { darkness: [[6,12],[55,62],[100,112]], earth: [[18,28],[47,58],[105,130]] },
  Site23: { darkness: [[14,32],[96,104],[150,160]], earth: [[0,40],[45,90],[99,156]] },
};

export const visibleAt = (hour: number, intervals: HourInterval[]) => intervals.some(([a,b]) => hour >= a && hour < b);
export const sunlightAt = (id: SiteId, hour: number) => !visibleAt(hour, INPUTS[id].darkness);
export const earthAt = (id: SiteId, hour: number) => visibleAt(hour, INPUTS[id].earth);
export const horizonAt = (id: SiteId, az: number) => {
  const phase = Object.keys(INPUTS).indexOf(id) * 0.73;
  return 2.2 + 1.25 * Math.sin((az * Math.PI) / 90 + phase) + 0.55 * Math.sin((az * Math.PI) / 30 - phase);
};
export const bodyPosition = (id: SiteId, hour: number, body: "sun" | "earth") => {
  const az = ((body === "sun" ? 32 + hour * 3.2 : 210 + hour * 2.1) + Object.keys(INPUTS).indexOf(id) * 17) % 360;
  const visible = body === "sun" ? sunlightAt(id, hour) : earthAt(id, hour);
  const intervals = body === "sun" ? INPUTS[id].darkness.flatMap(([a,b]) => [[a,b] as HourInterval]) : INPUTS[id].earth;
  const boundaries = intervals.flat();
  const distance = Math.min(12, ...boundaries.map((x) => Math.abs(hour - x)));
  const sign = visible ? 1 : -1;
  return { azDeg: az, elDeg: horizonAt(id, az) + sign * Math.min(5.5, distance * 1.4) };
};

export function metrics(id: SiteId, startHour: number, duration: number, limit: number) {
  if (startHour < 0 || startHour + duration > 168) return { valid: false as const, reason: "Mission falls outside the 168 h demo coverage." };
  let sun = 0, earth = 0, both = 0, run = 0, longest = 0;
  for (let h = startHour; h < startHour + duration; h += 0.25) {
    const s = sunlightAt(id, h + 0.125), e = earthAt(id, h + 0.125);
    if (s) sun += 0.25; else { run += 0.25; longest = Math.max(longest, run); }
    if (s) run = 0;
    if (e) earth += 0.25;
    if (s && e) both += 0.25;
  }
  return { valid: true as const, sunlightHours: sun, earthHours: earth, simultaneousHours: both, longestDarknessHours: longest, meets: longest <= limit };
}

export function nextTransition(id: SiteId, hour: number, body: "sun" | "earth") {
  const now = body === "sun" ? sunlightAt(id, hour) : earthAt(id, hour);
  for (let h = Math.ceil(hour * 4 + 1) / 4; h <= 168; h += 0.25) {
    const state = body === "sun" ? sunlightAt(id, h) : earthAt(id, h);
    if (state !== now) return h;
  }
  return null;
}
