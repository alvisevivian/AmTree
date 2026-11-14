"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { SITES, type SiteId } from "./lib/sites";
import { bodyPosition, COVERAGE_START, earthAt, horizonAt, HOUR, metrics, nextTransition, sunlightAt } from "./lib/simulation";

const fmt = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} h`;
const dateValue = (hour: number) => new Date(Date.parse(COVERAGE_START) + hour * HOUR).toISOString().slice(0,16);
const hourFromDate = (value: string) => (Date.parse(`${value}Z`) - Date.parse(COVERAGE_START)) / HOUR;

function Moon({ planning, selected, onSelect }: { planning: boolean; selected: SiteId | null; onSelect: (id: SiteId) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; moon: THREE.Group; markers: Map<SiteId, THREE.Mesh>; frame: number; target: THREE.Vector3 } | null>(null);
  const onSelectRef = useRef(onSelect);
  const planningRef = useRef(planning);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { planningRef.current = planning; }, [planning]);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    try {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      container.appendChild(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(34, 1, .1, 100);
      camera.position.set(0, .5, 5.2);
      const moon = new THREE.Group(); scene.add(moon);
      const loader = new THREE.TextureLoader();
      Promise.all([loader.loadAsync("/assets/lroc_color_4k.jpg"), loader.loadAsync("/assets/ldem_4.png")]).then(([texture, displacement]) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        displacement.anisotropy = renderer.capabilities.getMaxAnisotropy();
        const geometry = new THREE.SphereGeometry(1.55, 320, 240);
        const material = new THREE.MeshStandardMaterial({ map: texture, displacementMap: displacement, displacementScale: .012, displacementBias: -.006, roughness: .94, metalness: 0 });
        const sphere = new THREE.Mesh(geometry, material);
        sphere.rotation.y = -Math.PI / 2;
        moon.add(sphere);
      });
      scene.add(new THREE.HemisphereLight(0x8aa5c5, 0x010205, .38));
      const key = new THREE.DirectionalLight(0xfff8eb, 3.15); key.position.set(-4, 2.4, 5); scene.add(key);
      const rim = new THREE.DirectionalLight(0x6f9bc7, 1.35); rim.position.set(4,-2,-4); scene.add(rim);
      const markers = new Map<SiteId, THREE.Mesh>();
      for (const site of SITES) {
        const phi = THREE.MathUtils.degToRad(90 - site.latitude), theta = THREE.MathUtils.degToRad(site.longitude);
        const marker = new THREE.Mesh(new THREE.SphereGeometry(.035,12,12), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
        const dot = new THREE.Mesh(new THREE.SphereGeometry(.006,16,16), new THREE.MeshBasicMaterial({ color: 0xf3b44b }));
        marker.add(dot);
        marker.userData.dot = dot;
        marker.position.set(1.59*Math.sin(phi)*Math.cos(theta),1.59*Math.cos(phi),-1.59*Math.sin(phi)*Math.sin(theta));
        marker.userData.id = site.id; moon.add(marker); markers.set(site.id, marker);
      }
      const target = new THREE.Vector3(0, 0, 5.2);
      state.current = { renderer, scene, camera, moon, markers, frame: 0, target };
      const resize = () => { const {clientWidth:w,clientHeight:h}=container; renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); };
      const ray = new THREE.Raycaster(), pointer = new THREE.Vector2(); let dragging=false, px=0, py=0;
      const down=(e:PointerEvent)=>{dragging=true;px=e.clientX;py=e.clientY;renderer.domElement.setPointerCapture(e.pointerId)};
      const move=(e:PointerEvent)=>{if(!dragging)return;moon.rotation.y+=(e.clientX-px)*.006;moon.rotation.x+=(e.clientY-py)*.006;px=e.clientX;py=e.clientY};
      const up=(e:PointerEvent)=>{dragging=false;renderer.domElement.releasePointerCapture(e.pointerId)};
      const click=(e:MouseEvent)=>{const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-((e.clientY-r.top)/r.height)*2+1);ray.setFromCamera(pointer,camera);const hit=ray.intersectObjects([...markers.values()],true)[0];if(hit){const target=hit.object.userData.id?hit.object:hit.object.parent;if(target?.userData.id)onSelectRef.current(target.userData.id)}};
      const wheel=(e:WheelEvent)=>{e.preventDefault();camera.position.z=THREE.MathUtils.clamp(camera.position.z+e.deltaY*.002,2.6,6)};
      addEventListener("resize",resize); renderer.domElement.addEventListener("pointerdown",down);renderer.domElement.addEventListener("pointermove",move);renderer.domElement.addEventListener("pointerup",up);renderer.domElement.addEventListener("click",click);renderer.domElement.addEventListener("wheel",wheel,{passive:false}); resize();
      const animate=()=>{if(!state.current)return;camera.position.lerp(target,.045); if(!dragging&&!planningRef.current)moon.rotation.y+=.0012;renderer.render(scene,camera);state.current.frame=requestAnimationFrame(animate)};animate();
      return()=>{removeEventListener("resize",resize);cancelAnimationFrame(state.current?.frame||0);renderer.dispose();container.replaceChildren();state.current=null};
    } catch {
      const fallback = document.createElement("div");
      fallback.className = "fallback";
      fallback.textContent = "3D Moon unavailable — the planner and all six locations remain accessible.";
      container.appendChild(fallback);
    }
  }, []);
  useEffect(()=>{if(!state.current)return;state.current.target.set(0,planning?-1.05:.5,planning?3.15:5.2);if(planning)state.current.moon.rotation.x=-1.2;},[planning]);
  useEffect(()=>{state.current?.markers.forEach((m,id)=>{const dot=m.userData.dot as THREE.Mesh;(dot.material as THREE.MeshBasicMaterial).color.set(id===selected?0xffffff:0xf3b44b);dot.scale.setScalar(id===selected?2.2:1)})},[selected]);
  return <div className="moon-stage" ref={host} aria-label="Interactive 3D Moon. Drag to rotate and scroll to zoom."><div className="map-tools"><button onClick={()=>{if(state.current){state.current.moon.rotation.set(-1.2,0,0);state.current.target.set(0,-1.05,3.15)}}}>South pole</button><span>Drag to rotate · Scroll to zoom</span></div></div>;
}

function Timeline({ id, cursor, setCursor, start, duration }:{id:SiteId;cursor:number;setCursor:(n:number)=>void;start:number;duration:number}) {
  const blocks=(body:"sun"|"earth")=>Array.from({length:Math.round(duration*4)},(_,i)=>{const h=start+i/4;return body==="sun"?sunlightAt(id,h):earthAt(id,h)});
  return <div className="timeline"><div className="track-label"><span>Sunlight</span><span>Amber = visible</span></div><div className="track sun">{blocks("sun").map((on,i)=><i className={on?"on":""} key={i}/>)}</div><div className="track-label"><span>Earth visibility</span><span>Blue = visible</span></div><div className="track earth">{blocks("earth").map((on,i)=><i className={on?"on":""} key={i}/>)}</div><input aria-label="Observation time cursor" type="range" min={start} max={start+duration} step="0.25" value={cursor} onChange={e=>setCursor(+e.target.value)}/><div className="time-ends"><span>Landing</span><strong>{new Date(Date.parse(COVERAGE_START)+cursor*HOUR).toISOString().slice(11,16)} UTC</strong><span>+{duration} h</span></div></div>;
}

function Horizon({id,hour}:{id:SiteId;hour:number}){
  const width=640,height=210,x=(az:number)=>az/360*width,y=(el:number)=>height-(el+8)/18*height;
  const horizon=Array.from({length:73},(_,i)=>`${x(i*5)},${y(horizonAt(id,i*5))}`).join(" "); const sun=bodyPosition(id,hour,"sun"),earth=bodyPosition(id,hour,"earth");
  return <svg className="horizon" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Local horizon profile with Sun and Earth positions"><path d={`M0 ${height} L ${horizon} L${width} ${height}Z`} className="terrain"/><polyline points={horizon} className="ridge"/>{[0,90,180,270,360].map(a=><g key={a}><line x1={x(a)} y1="0" x2={x(a)} y2={height} className="grid"/><text x={x(a)+3} y={height-6}>{a}°</text></g>)}<circle cx={x(sun.azDeg)} cy={y(sun.elDeg)} r="7" className="sun-dot"/><circle cx={x(earth.azDeg)} cy={y(earth.elDeg)} r="7" className="earth-dot"/></svg>;
}

function ComparisonRow({site,result,duration,limit,onSelect}:{site:(typeof SITES)[number];result:ReturnType<typeof metrics>;duration:number;limit:number;onSelect:()=>void}){
  if(!result.valid)return <button className="site-row invalid-row" onClick={onSelect}><span className="site-index">{site.id.replace("Site","")}</span><span className="site-name"><strong>{site.name}</strong><small>{site.latitude.toFixed(4)}°, {site.longitude.toFixed(4)}°</small></span><span className="invalid">Mission outside data coverage</span><b className="row-arrow">›</b></button>;
  const values=[
    {label:"Sunlight",value:result.sunlightHours,tone:"sun"},
    {label:"Earth visibility",value:result.earthHours,tone:"earth"},
    {label:"Sun + Earth",value:result.simultaneousHours,tone:"both"},
    {label:"Longest dark",value:result.longestDarknessHours,tone:"dark"}
  ];
  return <button className="site-row" onClick={onSelect}><span className="site-index">{site.id.replace("Site","")}</span><span className="site-name"><strong>{site.name}</strong><small>{site.latitude.toFixed(3)}° lat · {site.longitude.toFixed(3)}° lon</small></span><span className={`status-pill ${result.meets?"pass":"fail"}`}><i/>{result.meets?"Meets demo limits":`Exceeds ${fmt(limit)} dark limit`}</span><span className="row-metrics">{values.map(metric=><span className="row-metric" key={metric.label}><span><small>{metric.label}</small><strong>{fmt(metric.value)}</strong></span><i className={`metric-bar ${metric.tone}`}><b style={{width:`${Math.min(100,metric.value/duration*100)}%`}}/></i></span>)}</span><b className="row-arrow">›</b></button>;
}

export default function App(){
  const [planning,setPlanning]=useState(false),[selected,setSelected]=useState<SiteId|null>(null),[start,setStart]=useState(0),[duration,setDuration]=useState(72),[limit,setLimit]=useState(12),[cursor,setCursor]=useState(0),[delayed,setDelayed]=useState(false),[method,setMethod]=useState(false);
  const results=useMemo(()=>Object.fromEntries(SITES.map(s=>[s.id,metrics(s.id,start,duration,limit)])) as Record<SiteId,ReturnType<typeof metrics>>,[start,duration,limit]);
  const reset=()=>{setPlanning(true);setSelected(null);setStart(0);setDuration(72);setLimit(12);setCursor(0);setDelayed(false)};
  const scrollPanelTop=()=>requestAnimationFrame(()=>document.querySelector(".panel")?.scrollTo({top:0,behavior:"smooth"}));
  const choose=(id:SiteId)=>{setSelected(id);setCursor(start);scrollPanelTop()};
  const showAllSites=()=>{setSelected(null);scrollPanelTop()};
  const selectedSite=SITES.find(s=>s.id===selected); const selectedResult=selected?results[selected]:null;
  const summary=useMemo(()=>{if(!delayed)return null;const old=Object.fromEntries(SITES.map(s=>[s.id,metrics(s.id,0,duration,limit)])) as Record<SiteId,ReturnType<typeof metrics>>;const entered=SITES.filter(s=>old[s.id].valid&&results[s.id].valid&&!old[s.id].meets&&results[s.id].meets);const left=SITES.filter(s=>old[s.id].valid&&results[s.id].valid&&old[s.id].meets&&!results[s.id].meets);return {entered,left}},[delayed,duration,limit,results]);
  const darknessFor=(id:SiteId)=>{const result=results[id];return result.valid?fmt(result.longestDarknessHours):"Outside coverage"};
  const shortlist=SITES.filter(s=>results[s.id].valid&&results[s.id].meets).length;
  const missionStart=new Date(Date.parse(COVERAGE_START)+start*HOUR);
  const missionEnd=new Date(missionStart.getTime()+duration*HOUR);
  const inCoverage=start>=0&&start+duration<=168;
  const utc=(date:Date)=>date.toISOString().replace("T"," · ").slice(0,18)+" UTC";
  return <main className={planning?"planning":"opening"}>
    <Moon planning={planning} selected={selected} onSelect={choose}/>
    <header><div className="brand"><span className="brand-mark">A</span><span>AmTree</span></div>{planning&&<div className="header-actions"><span className="demo-badge">Demo data · Illustrative conditions</span><button className="text-button" onClick={()=>setMethod(true)}>Data &amp; Method</button><button className="text-button" onClick={reset}>Reset demo</button></div>}</header>
    {!planning?<section className="hero"><p className="eyebrow">AMTREE LUNAR NAVIGATOR</p><h1>Lunar Navigator</h1><p>Compare landing conditions at the lunar south pole.</p><button className="primary" onClick={()=>setPlanning(true)}>Plan a landing <span>→</span></button></section>:<section className="planner">
      <div className="map-caption"><span>NASA LRO / LOLA terrain · Six study locations</span><strong>{selectedSite?.name||"South polar overview"}</strong></div>
      <aside className="panel">
        {!selectedSite?<>
          <div className="dashboard-title"><div><p className="eyebrow">MISSION SCREENING</p><h2>Compare landing sites</h2><p>One mission window. Six documented study locations.</p></div><span className={`coverage-state ${inCoverage?"valid":"invalid"}`}><i/>{inCoverage?"Coverage valid":"Outside coverage"}</span></div>
          <section className="mission-strip" aria-label="Mission interval"><span><small>Landing</small><strong>{utc(missionStart)}</strong></span><b>→</b><span><small>Mission end</small><strong>{utc(missionEnd)}</strong></span></section>
          <section className="control-surface">
            <div className="section-kicker"><span>Mission setup</span><small>Applied to all six sites</small></div>
            <div className="controls"><label>Landing date &amp; time <small>UTC</small><input type="datetime-local" value={dateValue(start)} onChange={e=>{setStart(hourFromDate(e.target.value));setCursor(hourFromDate(e.target.value));setDelayed(false)}}/></label><label>Duration<select value={duration} onChange={e=>setDuration(+e.target.value)}><option value="24">24 hours</option><option value="48">48 hours</option><option value="72">72 hours</option><option value="96">96 hours</option></select></label><label>Maximum consecutive darkness<select value={limit} onChange={e=>setLimit(+e.target.value)}><option value="6">6 hours</option><option value="12">12 hours</option><option value="18">18 hours</option><option value="24">24 hours</option></select></label><button className="delay" onClick={()=>{setStart(v=>v+48);setCursor(v=>v+48);setDelayed(true)}}><span>Delay mission</span><strong>+48 h</strong></button></div>
          </section>
          <section className="decision-summary"><div className="summary-number"><strong>{shortlist}</strong><span><b>of 6 sites</b><small>meet the {limit} h darkness limit</small></span></div><div className="summary-legend"><span><i className="sun"/>Sunlight</span><span><i className="earth"/>Earth visibility</span><span><i className="both"/>Both visible</span><span><i className="dark"/>Consecutive dark</span></div></section>
          {summary&&<div className="change-summary"><div><span>After +48 h</span><strong>Mission shift impact</strong></div>{summary.left.map(s=><p key={s.id}><b>Left shortlist</b><span>{s.name}</span><small>Darkness increased to {darknessFor(s.id)}, above the {limit} h limit.</small></p>)}{summary.entered.map(s=><p key={s.id}><b>Entered shortlist</b><span>{s.name}</span><small>Darkness decreased to {darknessFor(s.id)}.</small></p>)}</div>}
          <div className="results-head"><div><h3>Site comparison</h3><span>All sites remain visible, including failures</span></div><small>Hours within mission</small></div>
          <div className="site-list">{SITES.map(site=><ComparisonRow key={site.id} site={site} result={results[site.id]} duration={duration} limit={limit} onSelect={()=>choose(site.id)}/>)}</div>
          <div className="criteria-note"><strong>Screening rule</strong><p>A site meets demo limits when its longest continuous darkness period is at or below {limit} hours. This is not a landing-safety determination.</p></div>
        </>:<>
          <div className="detail-nav"><button className="back" onClick={showAllSites}>← All sites</button><span>{selectedSite.id}</span></div>
          <div className="detail-hero"><div><p className="eyebrow">STUDY LOCATION</p><h2>{selectedSite.name}</h2><p>{selectedSite.latitude}° latitude · {selectedSite.longitude}° longitude</p></div>{selectedResult?.valid&&<span className={`detail-status ${selectedResult.meets?"pass":"fail"}`}><i/>{selectedResult.meets?"Meets demo limits":`Exceeds ${limit} h darkness limit`}</span>}</div>
          <section className="detail-window"><span><small>Landing</small><strong>{utc(missionStart)}</strong></span><span><small>Duration</small><strong>{duration} hours</strong></span><span><small>Mission end</small><strong>{utc(missionEnd)}</strong></span></section>
          <div className="detail-metrics">{selectedResult?.valid&&<><span className="sun"><small>Sunlight</small><strong>{fmt(selectedResult.sunlightHours)}</strong><em>{Math.round(selectedResult.sunlightHours/duration*100)}% of mission</em></span><span className="earth"><small>Earth visibility</small><strong>{fmt(selectedResult.earthHours)}</strong><em>{Math.round(selectedResult.earthHours/duration*100)}% of mission</em></span><span className="dark"><small>Longest darkness</small><strong>{fmt(selectedResult.longestDarknessHours)}</strong><em>{selectedResult.meets?"Within limit":"Above limit"}</em></span><span className="both"><small>Sun + Earth</small><strong>{fmt(selectedResult.simultaneousHours)}</strong><em>Simultaneous visibility</em></span></>}</div>
          <section className="detail-section"><div className="section-title"><div><small>TIME SERIES</small><h3>Mission visibility</h3></div><span>15 minute samples</span></div><Timeline id={selectedSite.id} cursor={cursor} setCursor={setCursor} start={start} duration={duration}/></section>
          <section className="detail-section"><div className="section-title"><div><small>OBSERVATION CURSOR</small><h3>Local horizon</h3></div><span>Azimuth clockwise from north</span></div><Horizon id={selectedSite.id} hour={cursor}/><div className="body-readout">{(["sun","earth"] as const).map(body=>{const on=body==="sun"?sunlightAt(selectedSite.id,cursor):earthAt(selectedSite.id,cursor),next=nextTransition(selectedSite.id,cursor,body);return <span key={body} className={body}><i/><span><strong>{body==="sun"?"Sun":"Earth"} {on?"above":"below"} horizon</strong><small>{next===null?"No next transition in coverage":`${on?"Loss":"Rise"} in ${fmt(next-cursor)}`}</small></span></span>})}</div></section>
        </>}
      </aside>
    </section>}
    {method&&<div className="modal" role="dialog" aria-modal="true" aria-label="Data and Method"><button className="modal-close" onClick={()=>setMethod(false)}>Close</button><p className="eyebrow">TRANSPARENT BY DESIGN</p><h2>Data &amp; Method</h2><h3>What this demo uses</h3><p>Official 2025 4K lunar color imagery from NASA’s Goddard Space Flight Center CGI Moon Kit, official LOLA elevation displacement, and study-location coordinates from NASA’s Lunar Surface Data Book, ACD-50044 Rev A.</p><h3>What is synthetic</h3><p>Sun and Earth positions, local horizon profiles, and visibility windows are deterministic illustrative conditions. They are not NASA predictions or MATLAB output.</p><h3>Future scientific integration</h3><p>The fixture schema is ready for MATLAB exports informed by higher-resolution LOLA terrain products and JPL Horizons. Moon Trek, QuickMap, and CSA mission context are reference resources only.</p><p className="method-note">No live APIs or external services are used at runtime.</p></div>}
  </main>;
}
