import { useMemo, useState } from "react";
import type { LocationId } from "./lib/sites";
import type { LiveSolarSample, WindowExposure } from "./lib/simulation";

export type VisibilitySample = [number, number, number, number, number, number, number, number];
export type MissionSimulation = {
  mode: "static" | "dynamic";
  start: Date;
  end: Date;
  duration: number;
  cadence: number;
  query: string;
  results: Record<LocationId, WindowExposure>;
  solar: LiveSolarSample[];
  details: Record<LocationId, { horizon: number[]; samples: VisibilitySample[] }>;
};

const stations = ["Goldstone", "Madrid", "Canberra"];

function cadenceLabel(seconds: number) {
  if (seconds % 86400 === 0) return `${seconds / 86400} d`;
  if (seconds % 3600 === 0) return `${seconds / 3600} h`;
  return `${seconds} s`;
}

export function StationBars({ mask }: { mask: number }) {
  const visible = stations.filter((_, index) => mask & (1 << index));
  return <div className="dsn-indicator">
    <span className="dsn-bars" role="img" aria-label={`${visible.length} of 3 DSN complexes in view`}>
      {stations.map((name, index) => <i key={name} className={index < visible.length ? "on" : ""}/>)}
    </span>
    <span>{visible.length}/3 DSN · {["No Signal", "Nominal", "Good", "Excellent"][visible.length]}</span>
  </div>;
}

const chartColors = { sun: "#fc7669", earth: "#85b7ff", dsn: "#4689da", preferred: "#adceff" };

export type Playback = { playing: boolean; toggle: () => void };

export function TimePlayback({ playing, toggle }: Playback) {
  return <button type="button" className="time-playback" onClick={toggle}
    aria-label={playing ? "Pause time" : "Play time"}>
    <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span> {playing ? "Pause" : "Play"}
  </button>;
}

function MissionCharts({ simulation, siteId, sampleIndex, onSelectSample, playback }: {
  simulation: MissionSimulation; siteId: LocationId; sampleIndex: number; onSelectSample: (index: number) => void;
  playback: Playback;
}) {
  const samples = simulation.details[siteId].samples;
  const width = 640, left = 70, right = 612, top = 15, bottom = 157;
  const lastOffset = simulation.solar[simulation.solar.length - 1].offsetSeconds;
  const x = (offset: number) => left + (right - left) * offset / lastOffset;
  const selected = samples[sampleIndex];
  const offset = simulation.solar[sampleIndex].offsetSeconds;
  const tickOffsets = [0, lastOffset / 2, lastOffset];
  const dateAt = (seconds: number) => new Date(simulation.start.getTime() + seconds * 1000).toISOString();
  const { low, high, lines, stationPaths } = useMemo(() => {
    const elevations = samples.flatMap(sample => [sample[1], sample[4]]);
    const low = Math.floor(Math.min(...elevations)) - 1;
    const high = Math.ceil(Math.max(...elevations)) + 1;
    const projectY = (el: number) => bottom - (el - low) / (high - low) * (bottom - top);
    const projectX = (i: number) => left + (right - left) * simulation.solar[i].offsetSeconds / lastOffset;
    const lines = [1, 4].map(valueIndex => samples.map((sample, i) => `${projectX(i)},${projectY(sample[valueIndex])}`).join(" "));
    const stationPaths = stations.map((_, station) => {
      const paths = ["", ""];
      let begin = 0;
      const stateAt = (i: number) => samples[i][7] === station ? 2 : samples[i][6] & (1 << station) ? 1 : 0;
      for (let i = 1; i < samples.length; i++) {
        const state = stateAt(begin);
        if (state === stateAt(i) && i < samples.length - 1) continue;
        const start = projectX(begin), end = projectX(i);
        if (state) paths[state - 1] += `M${start},${22 + station * 34}h${end - start}v20h${start - end}z`;
        begin = i;
      }
      return paths;
    });
    return { low, high, lines, stationPaths };
  }, [samples, simulation.solar, lastOffset]);
  const y = (el: number) => bottom - (el - low) / (high - low) * (bottom - top);
  const axis = (at: number) => <g className="mission-chart-axis">
    <path d={`M${left} ${at}H${right}`}/>
    {tickOffsets.map((tick, i) => <g key={tick}>
      <path d={`M${x(tick)} ${at}v4`}/>
      <text textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} x={x(tick)} y={at + 16}>
        {dateAt(tick).slice(5, 19).replace("T", " ")}
      </text>
    </g>)}
    <text textAnchor="middle" x={(left + right) / 2} y={at + 32}>Time (UTC)</text>
  </g>;

  return <div className="simulation-output-section mission-charts">
    <div className="mission-time">
      <div className="time-controls">
        <span>Time <time>{dateAt(offset).slice(0, 19).replace("T", " ")} UTC</time></span>
        <TimePlayback {...playback}/>
      </div>
      <input aria-label="Mission time" className="science-cursor" type="range" min="0" max={samples.length - 1}
        value={sampleIndex} onChange={event => onSelectSample(Number(event.target.value))}/>
    </div>
    <p className="mission-sample">
      <span className="sun-sample">Sun {selected[1].toFixed(2)}°</span>
      <span className="earth-sample">Earth {selected[4].toFixed(2)}°</span>
      <span>DSN {stations.filter((_, i) => selected[6] & (1 << i)).length}/3{selected[7] >= 0 ? ` · ${stations[selected[7]]}` : ""}</span>
    </p>
    <figure className="simulation-figure">
      <figcaption><strong>Sun and Earth elevation</strong></figcaption>
      <svg className="mission-chart" viewBox={`0 0 ${width} 196`} role="img" aria-label="Sun and Earth elevation in degrees over UTC time">
        <title>Sun and Earth elevation over time</title>
        <text className="mission-chart-label" transform="translate(20 95) rotate(-90)" textAnchor="middle">Elevation (°)</text>
        {[low, (low + high) / 2, high].map(el => <g className="mission-chart-axis" key={el}>
          <path d={`M${left} ${y(el)}H${right}`}/>
          <text x={left - 8} y={y(el) + 4} textAnchor="end">{Number.isInteger(el) ? el : el.toFixed(1)}</text>
        </g>)}
        <polyline points={lines[0]} stroke={chartColors.sun} fill="none" strokeWidth="2"/>
        <polyline points={lines[1]} stroke={chartColors.earth} fill="none" strokeWidth="2"/>
        <line className="mission-chart-cursor" x1={x(offset)} x2={x(offset)} y1={top} y2={bottom}/>
        <circle cx={x(offset)} cy={y(selected[1])} r="4" fill={chartColors.sun}/>
        <circle cx={x(offset)} cy={y(selected[4])} r="4" fill={chartColors.earth}/>
        {axis(bottom)}
      </svg>
    </figure>
    <figure className="simulation-figure">
      <figcaption><strong>DSN visibility</strong><small>Blue shows a visible link. Lighter blue marks the preferred link.</small></figcaption>
      <svg className="mission-chart" viewBox={`0 0 ${width} 158`} role="img" aria-label="Visibility of Goldstone, Madrid and Canberra over UTC time">
        <title>DSN station visibility over time</title>
        {stations.map((station, i) => <g key={station}>
          <text className="mission-chart-label" textAnchor="end" x={left - 8} y={36 + i * 34}>{station}</text>
          <rect x={left} y={22 + i * 34} width={right - left} height="20" fill="#000"/>
          <path d={stationPaths[i][0]} fill={chartColors.dsn}/>
          <path d={stationPaths[i][1]} fill={chartColors.preferred}/>
        </g>)}
        <line className="mission-chart-cursor" x1={x(offset)} x2={x(offset)} y1="19" y2="116"/>
        {stations.map((station, i) => <circle key={station} cx={x(offset)} cy={32 + i * 34} r="4"
          fill={selected[7] === i ? chartColors.preferred : selected[6] & (1 << i) ? chartColors.dsn : "#000"}
          stroke="#f4f6ff" strokeWidth="1"/>)}
        {axis(119)}
      </svg>
    </figure>
  </div>;
}

export function VisibilityGraph({ simulation, siteId, sampleIndex, onSelectSample, playback }: {
  simulation: MissionSimulation; siteId: LocationId; sampleIndex: number; onSelectSample: (index: number) => void;
  playback: Playback;
}) {
  const detail = simulation.details[siteId];
  const sample = detail.samples[sampleIndex];
  const [sunAz, sunEl, sunSky, earthAz, earthEl, earthSky, mask, preferred] = sample;
  const plotTop = Math.max(10, sunEl + 3, earthEl + 3, ...detail.horizon);
  const plotBottom = Math.min(-10, sunEl - 3, earthEl - 3, ...detail.horizon);
  const width = 640, height = 190;
  const x = (azimuth: number) => azimuth / 360 * width;
  const y = (elevation: number) => (plotTop - elevation) / (plotTop - plotBottom) * (height - 14) + 7;
  const horizon = [...detail.horizon, detail.horizon[0]].map((value, i) => `${x(i)},${y(value)}`).join(" ");
  const time = new Date(simulation.start.getTime() + simulation.solar[sampleIndex].offsetSeconds * 1000);
  const dynamic = simulation.mode === "dynamic";
  const exportUrl = (format: string, download = false) =>
    `/api/mission-window?${simulation.query}&site=${encodeURIComponent(siteId)}&format=${format}${download ? "&download=1" : ""}`;
  return <section className="detail-section simulation-visibility">
    <div className="section-title">
      <div><small>{dynamic ? `DYNAMIC · ${cadenceLabel(simulation.cadence)}` : "STATIC SNAPSHOT"}</small><h3>Sun and Earth visibility</h3></div>
      <span>{time.toISOString().slice(0, 19).replace("T", " · ")} UTC</span>
    </div>
    <svg className="horizon" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Terrain horizon with Sun and Earth positions by azimuth and elevation">
      <path d={`M0 ${height} L ${horizon} L${width} ${height}Z`} className="terrain"/>
      <polyline points={horizon} className="ridge"/>
      {[0, 90, 180, 270].map(az => <g key={az}>
        <line x1={x(az)} y1="0" x2={x(az)} y2={height} className="grid"/>
        <text x={x(az) + 5} y={height - 5}>{az}°</text>
      </g>)}
      <circle cx={x(sunAz)} cy={y(sunEl)} r="7" className="sun-dot"/>
      <circle cx={x(earthAz)} cy={y(earthEl)} r="7" className="earth-dot"/>
    </svg>
    <div className="body-readout">
      {[{ name: "Sun", tone: "sun", az: sunAz, el: sunEl, sky: sunSky }, { name: "Earth", tone: "earth", az: earthAz, el: earthEl, sky: earthSky }].map(body =>
        <span className={body.tone} key={body.name}><i/><span>
          <strong>{body.name} · {body.el >= body.sky ? "Visible" : "Below terrain"}</strong>
          <small>Az {body.az.toFixed(1)}° · El {body.el.toFixed(2)}° · terrain {body.sky.toFixed(2)}°</small>
        </span></span>)}
    </div>
    <div className="simulation-output-section">
      <h4>DSN visibility at this time</h4>
      <StationBars mask={mask}/>
      <p className="dsn-note">Three bars, one per Deep Space Network complex in view.</p>
      <ul className="dsn-stations">{stations.map((name, i) => <li key={name}>
        <strong>{name}</strong><span>{i === preferred ? "Preferred link" : mask & (1 << i) ? "In view" : "Blocked"}</span>
      </li>)}</ul>
    </div>
    {dynamic && <MissionCharts simulation={simulation} siteId={siteId} sampleIndex={sampleIndex}
      onSelectSample={onSelectSample} playback={playback}/>}
    <div className="simulation-exports">
      <a href={exportUrl("csv", true)} download>Download telemetry CSV</a>
      {dynamic && <a href={exportUrl("png", true)} download>Download comparison PNG</a>}
      {dynamic && <a href={exportUrl("html", true)} download>Download interactive HTML</a>}
    </div>
  </section>;
}

function ElevationMap({ url, title, label, color, filename }: {
  url: string; title: string; label: string; color: string; filename: string;
}) {
  const [failed, setFailed] = useState(false);
  return <figure className={`simulation-figure ${color}`}>
    <figcaption><strong>{title}</strong><small>{label} (degrees)</small></figcaption>
    {failed ? <p className="dsn-note" role="status">Map unavailable. Reload AmTree and rerun the simulation.</p> : <>
      <img loading="lazy" width={1000} height={800} src={url} alt={label} onError={() => setFailed(true)}/>
      <a href={url} download={filename}>Download GIF</a>
    </>}
  </figure>;
}

const mapDate = (date: Date) => date.toISOString().slice(0, 19).replace("T", " ");

export function LocationTimelapses({ siteId, start, end, simulation }: {
  siteId: LocationId; start: Date; end: Date; simulation: MissionSimulation | null;
}) {
  const isRegion = siteId.startsWith("region-");
  const base = `${import.meta.env.BASE_URL}${isRegion ? "artemis-maps" : "study-maps"}/${siteId}/`;
  const snapshot = simulation?.mode === "static";
  return <section className="detail-section region-timelapses">
    <div className="section-title"><div>
      <small>{simulation ? "SIMULATION WINDOW" : "BASELINE WINDOW"}</small>
      <h3>{isRegion ? "Regional illumination and DSN maps" : "Study-point illumination and DSN maps"}</h3>
    </div></div>
    <p className="dsn-note">{mapDate(start)}{snapshot ? "" : ` to ${mapDate(end)}`} UTC
      {simulation ? simulation.solar.length > 121 ? " · 121 sampled frames" : "" : " · 1 h frames"}</p>
    <p className="dsn-note">Red shows sunlight, blue shows DSN coverage, and black shows areas where visibility is blocked.
      {!isRegion && " The boundary encloses a 4.8 km square centered on the study point."}</p>
    <div className="region-timelapse-grid">
      {[
        { kind: "illumination", title: "Solar illumination", label: "Visible solar elevation", color: "red" },
        { kind: "dsn", title: "DSN communications", label: "Best visible DSN elevation", color: "blue" },
      ].map(plot => {
        const url = simulation ? `/api/mission-window?${simulation.query}&site=${encodeURIComponent(siteId)}&format=${plot.kind}-gif`
          : `${base}${plot.kind}.gif`;
        const date = start.toISOString().replace(/[-:]/g, "").slice(0, 15);
        return <ElevationMap key={url} url={url} title={plot.title} label={plot.label} color={plot.color}
          filename={`${siteId}-${plot.kind}-${date}Z.gif`}/>;
      })}
    </div>
  </section>;
}
