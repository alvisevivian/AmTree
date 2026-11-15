import { useState } from "react";
import { LOCATIONS, type LocationId } from "./lib/sites";
import { TimePlayback, type Playback, type MissionSimulation, type VisibilitySample } from "./SimulationResults";

const stations = ["Goldstone", "Madrid", "Canberra"];
const colors = ["#e6bd77", "#8cc8d9", "#c9a6da", "#a4ce9a", "#ec9e8b"];
const nodes = (sample: VisibilitySample) => stations.filter((_, i) => sample[6] & (1 << i));
const isSunlit = (sample: VisibilitySample) => sample[1] >= sample[2];

export function DecisionDashboard({ simulation, index, playback, onTime, onSelect }: {
  simulation: MissionSimulation | null; index: number; playback: Playback;
  onTime: (index: number) => void; onSelect: (id: LocationId) => void;
}) {
  const [metric, setMetric] = useState("dsn");
  if (!simulation) return <section className="decision-dashboard"><h3>Compare all landing sites</h3>
    <p>Run a simulation to rank every location at the selected UTC time.</p></section>;
  const dsn = metric === "dsn";
  const score = (id: LocationId, i: number) => metric === "dsn"
    ? nodes(simulation.details[id].samples[i]).length
    : Number(isSunlit(simulation.details[id].samples[i]));
  const ranked = LOCATIONS.map(location => ({ location, sample: simulation.details[location.id].samples[index] }))
    .sort((a, b) => score(b.location.id, index) - score(a.location.id, index) || a.location.name.localeCompare(b.location.name));
  const top = ranked.slice(0, 5);
  const offsets = simulation.solar.map(sample => sample.offsetSeconds);
  const last = offsets.at(-1) || 1;
  const x = (offset: number) => 48 + offset / last * 540;
  const y = (value: number) => 155 - value / (dsn ? 3 : 1) * 130;
  const stamp = (offset: number) => new Date(simulation.start.getTime() + offset * 1000).toISOString().slice(0, 19).replace("T", " ");
  return <section className="decision-dashboard">
    <div className="decision-heading"><h3>Landing site leaderboard</h3>
      <label>Rank by <select value={metric} onChange={event => setMetric(event.target.value)}>
        <option value="dsn">DSN nodes in view</option><option value="sun">Sunlight</option>
      </select></label></div>
    <p>Sunlight status and DSN bars follow the selected UTC time.</p>
    <div className="time-controls"><time>{stamp(offsets[index])} UTC</time>
      {simulation.mode === "dynamic" && <TimePlayback {...playback}/>}</div>
    {simulation.mode === "dynamic" && <input className="science-cursor" type="range" aria-label="Global UTC time"
      min={0} max={offsets.length - 1} value={index} onChange={event => onTime(Number(event.target.value))}/>}
    <div className="leaderboard">
      {ranked.map(({ location, sample }, rank) => {
        const visible = nodes(sample);
        const sunlit = isSunlit(sample);
        const sunlightStatus = <small className={sunlit ? "condition-good" : "condition-blocked"}>{sunlit ? "Sunlit" : "In shadow"}</small>;
        return <button key={location.id} onClick={() => onSelect(location.id)} className="leaderboard-row">
          <span className="rank">{rank + 1}</span><span><strong>{location.name}</strong>
            <small className={visible.length ? "condition-good" : "condition-blocked"}>
              {["NO SIGNAL", "Nominal", "Good", "Excellent"][visible.length]}
              {visible.length > 0 && ` · ${visible.join(", ")}`}</small>
            {dsn && sunlightStatus}
          </span>{dsn ? <span className="dsn-bars" role="img" aria-label={`${visible.length} of 3 DSN complexes in view`}>
            {stations.map((station,i) => <i key={station} className={i < visible.length ? "on" : ""}/>)}
          </span> : sunlightStatus}
        </button>;
      })}
    </div>
    {simulation.mode === "dynamic" && <>
      <h4>{dsn ? "DSN nodes in view" : "Sunlight"} · top five locations</h4>
      <svg viewBox="0 0 640 205" className="comparison-curves" role="img" aria-label="Top five locations over UTC time with shared playhead">
        {(dsn ? [0, 1, 2, 3] : [0, 1]).map(value => <g key={value}><path d={`M48 ${y(value)}H588`} stroke="#ffffff18"/>
          <text x="44" textAnchor="end" y={y(value) + 4}>{dsn ? value : value ? "Sunlit" : "Shadow"}</text></g>)}
        {top.map(({location}, i) => <polyline key={location.id} fill="none" stroke={colors[i]} strokeWidth="2"
          points={offsets.map((offset, j) =>
            `${j ? `${x(offset)},${y(score(location.id, j - 1))} ` : ""}${x(offset)},${y(score(location.id, j))}`).join(" ")}/>)}
        <line x1={x(offsets[index])} x2={x(offsets[index])} y1="20" y2="158" stroke="white" strokeDasharray="3 3"/>
        {[0, last].map((offset,i) => <text key={i} x={x(offset)} y="179" textAnchor={i ? "end" : "start"}>{stamp(offset)}</text>)}
        <text x="318" y="200" textAnchor="middle">Time (UTC)</text>
        <rect x="48" y="20" width="540" height="138" fill="transparent" style={{cursor:"crosshair"}}
          onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            const target = (event.clientX-rect.left)/rect.width*last;
            const closest = offsets.reduce((best, value, i) => Math.abs(value-target)<Math.abs(offsets[best]-target) ? i : best,0);
            onTime(closest);
          }}/>
      </svg>
      <div className="comparison-legend">{top.map(({location},i) => <span key={location.id} style={{color:colors[i]}}>{location.name}</span>)}</div>
    </>}
  </section>;
}
