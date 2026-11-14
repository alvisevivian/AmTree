"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { SITES, type SiteId } from "./lib/sites";
import { MALAPERT_HORIZON, MALAPERT_SAMPLES, SOURCE_SUMMARY, hasDetailedSeries, malapertSampleAt, metrics, scenarioInfo, type ScenarioId, type SiteMetrics } from "./lib/simulation";

const fmt = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} h`;

function Moon({ planning, selected, onSelect }: { planning: boolean; selected: SiteId | null; onSelect: (id: SiteId) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const focusLabel = useRef<HTMLDivElement>(null);
  const state = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; moon: THREE.Group; markers: Map<SiteId, THREE.Sprite>; frame: number; cameraTarget: THREE.Vector3; rotationTarget: THREE.Quaternion } | null>(null);
  const onSelectRef = useRef(onSelect);
  const planningRef = useRef(planning);
  const selectedRef = useRef(selected);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { planningRef.current = planning; }, [planning]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    try {
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      container.appendChild(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(34, 1, .1, 100);
      camera.position.set(0, .5, 5.2);
      const moon = new THREE.Group(); scene.add(moon);
      const loader = new THREE.TextureLoader();
      Promise.all([loader.loadAsync("/assets/lroc_color_poles_8k.jpg"), loader.loadAsync("/assets/ldem_4.png")]).then(([texture, displacement]) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        const anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.anisotropy = anisotropy;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        displacement.anisotropy = anisotropy;
        displacement.minFilter = THREE.LinearMipmapLinearFilter;
        displacement.magFilter = THREE.LinearFilter;
        const geometry = new THREE.SphereGeometry(1.55, 384, 256);
        const material = new THREE.MeshStandardMaterial({ map: texture, displacementMap: displacement, displacementScale: .018, displacementBias: -.009, roughness: .88, metalness: 0 });
        const sphere = new THREE.Mesh(geometry, material);
        moon.add(sphere);
      });
      scene.add(new THREE.HemisphereLight(0x7790ad, 0x010205, .22));
      const key = new THREE.DirectionalLight(0xfff7e8, 3.8); key.position.set(-4, 2.6, 5); scene.add(key);
      const rim = new THREE.DirectionalLight(0x608cc0, .72); rim.position.set(4,-2,-4); scene.add(rim);
      const markerTexture=(active=false)=>{const canvas=document.createElement("canvas");canvas.width=128;canvas.height=128;const context=canvas.getContext("2d")!;context.clearRect(0,0,128,128);context.strokeStyle=active?"#fff5df":"#f4b94f";context.fillStyle="#f4b94f";context.lineWidth=active?8:7;context.lineCap="round";const corner=(x:number,y:number,sx:number,sy:number)=>{context.beginPath();context.moveTo(x+sx*25,y);context.lineTo(x,y);context.lineTo(x,y+sy*25);context.stroke()};corner(38,38,1,1);corner(90,38,-1,1);corner(38,90,1,-1);corner(90,90,-1,-1);context.save();context.translate(64,64);context.rotate(Math.PI/4);context.fillRect(active?-8:-5,active?-8:-5,active?16:10,active?16:10);context.restore();const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.minFilter=THREE.LinearFilter;return map};
      const markers = new Map<SiteId, THREE.Sprite>();
      for (const site of SITES) {
        const phi = THREE.MathUtils.degToRad(90 - site.latitude), theta = THREE.MathUtils.degToRad(site.longitude);
        const normalTexture=markerTexture(),activeTexture=markerTexture(true);
        const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map:normalTexture,transparent:true,depthWrite:false,depthTest:true }));
        marker.scale.setScalar(.13);
        marker.userData.normalTexture=normalTexture;marker.userData.activeTexture=activeTexture;
        marker.position.set(1.59*Math.sin(phi)*Math.cos(theta),1.59*Math.cos(phi),-1.59*Math.sin(phi)*Math.sin(theta));
        marker.userData.id = site.id; moon.add(marker); markers.set(site.id, marker);
      }
      const cameraTarget = new THREE.Vector3(0, 0, 5.2);
      const rotationTarget = moon.quaternion.clone();
      state.current = { renderer, scene, camera, moon, markers, frame: 0, cameraTarget, rotationTarget };
      const resize = () => { const {clientWidth:w,clientHeight:h}=container; renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); };
      const observer=new ResizeObserver(resize);observer.observe(container);
      const ray = new THREE.Raycaster(), pointer = new THREE.Vector2(); let dragging=false, moved=false, px=0, py=0;
      const down=(e:PointerEvent)=>{if(e.target!==renderer.domElement)return;dragging=true;moved=false;px=e.clientX;py=e.clientY;e.preventDefault()};
      const move=(e:PointerEvent)=>{if(!dragging)return;const dx=e.clientX-px,dy=e.clientY-py;if(Math.abs(dx)+Math.abs(dy)>2)moved=true;const delta=new THREE.Quaternion().setFromEuler(new THREE.Euler(dy*.006,dx*.006,0,"XYZ"));moon.quaternion.premultiply(delta).normalize();rotationTarget.copy(moon.quaternion);px=e.clientX;py=e.clientY};
      const up=()=>{dragging=false};
      const click=(e:MouseEvent)=>{if(moved)return;const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-((e.clientY-r.top)/r.height)*2+1);ray.setFromCamera(pointer,camera);const hit=ray.intersectObjects([...markers.values()],false)[0];if(hit?.object.userData.id)onSelectRef.current(hit.object.userData.id)};
      const wheel=(e:WheelEvent)=>{e.preventDefault();cameraTarget.z=THREE.MathUtils.clamp(cameraTarget.z+e.deltaY*.002,2.25,6)};
      addEventListener("resize",resize);renderer.domElement.style.touchAction="none";renderer.domElement.addEventListener("pointerdown",down);addEventListener("pointermove",move);addEventListener("pointerup",up);renderer.domElement.addEventListener("click",click);renderer.domElement.addEventListener("wheel",wheel,{passive:false}); resize();
      const projected = new THREE.Vector3(), world = new THREE.Vector3(), centerToCamera = new THREE.Vector3();
      const animate=()=>{if(!state.current)return;camera.position.lerp(cameraTarget,.06);moon.quaternion.slerp(rotationTarget,.075);if(!dragging&&!planningRef.current){rotationTarget.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.0012)).normalize()}centerToCamera.copy(camera.position).normalize();markers.forEach(marker=>{marker.getWorldPosition(world);marker.visible=world.clone().normalize().dot(centerToCamera)>.05});const active=selectedRef.current;if(active&&focusLabel.current){const marker=markers.get(active);if(marker){marker.getWorldPosition(projected);projected.project(camera);focusLabel.current.style.opacity=marker.visible?"1":"0";focusLabel.current.style.transform=`translate3d(${(projected.x*.5+.5)*container.clientWidth}px,${(-projected.y*.5+.5)*container.clientHeight}px,0) translate(-50%,-145%)`}}renderer.render(scene,camera);state.current.frame=requestAnimationFrame(animate)};animate();
      return()=>{removeEventListener("resize",resize);removeEventListener("pointermove",move);removeEventListener("pointerup",up);observer.disconnect();cancelAnimationFrame(state.current?.frame||0);renderer.dispose();markers.forEach(marker=>{marker.userData.normalTexture?.dispose();marker.userData.activeTexture?.dispose();marker.material.dispose()});renderer.domElement.remove();state.current=null};
    } catch {
      const fallback = document.createElement("div");
      fallback.className = "fallback";
      fallback.textContent = "3D Moon unavailable — the planner and all six locations remain accessible.";
      container.appendChild(fallback);
    }
  }, []);
  const polarQuaternion=()=>new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,-1,0),new THREE.Vector3(0,-.35,1).normalize());
  useEffect(()=>{if(!state.current)return;state.current.cameraTarget.set(0,planning?-.06:.5,planning?5.7:5.2);if(planning)state.current.rotationTarget.copy(polarQuaternion());},[planning]);
  useEffect(()=>{if(!state.current)return;state.current.markers.forEach((marker,id)=>{const active=id===selected;marker.material.map=active?marker.userData.activeTexture:marker.userData.normalTexture;marker.material.needsUpdate=true;marker.scale.setScalar(active ? .19 : .13)});if(selected){const marker=state.current.markers.get(selected);if(marker){const siteDirection=marker.position.clone().normalize();const viewDirection=new THREE.Vector3(0,-.14,1).normalize();state.current.rotationTarget.setFromUnitVectors(siteDirection,viewDirection);state.current.cameraTarget.set(0,-.04,3.8)}}else if(planning){state.current.rotationTarget.copy(polarQuaternion());state.current.cameraTarget.set(0,-.06,5.7)}},[selected,planning]);
  const selectedName=SITES.find(site=>site.id===selected)?.name;
  return <div className="moon-stage" ref={host} aria-label="Interactive 3D Moon. Drag to rotate and scroll to zoom."><div ref={focusLabel} className={`site-focus-label ${selected?"visible":""}`}><i/>{selectedName}</div><div className="map-tools"><button onClick={()=>{if(state.current){state.current.rotationTarget.copy(polarQuaternion());state.current.cameraTarget.set(0,-.06,5.7)}}}>South pole</button><span>Drag to rotate · Scroll to zoom</span></div></div>;
}

function MalapertDetail({cursor,setCursor}:{cursor:number;setCursor:(value:number)=>void}){
  const sample=malapertSampleAt(cursor),width=640,height=210,x=(az:number)=>az/360*width,y=(el:number)=>height-(el+8)/25*height;
  const horizon=MALAPERT_HORIZON.map(point=>`${x(point.azDeg)},${y(point.elDeg)}`).join(" ");
  return <><section className="detail-section"><div className="section-title"><div><small>REAL COMPUTED SERIES · 240 S</small><h3>Sun and Earth visibility</h3></div><span>{new Date(cursor).toISOString().slice(0,16).replace("T"," · ")} UTC</span></div><svg className="horizon" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Malapert local terrain horizon with computed Sun and Earth positions"><path d={`M0 ${height} L ${horizon} L${width} ${height}Z`} className="terrain"/><polyline points={horizon} className="ridge"/>{[0,90,180,270,360].map(a=><g key={a}><line x1={x(a)} y1="0" x2={x(a)} y2={height} className="grid"/><text x={x(a)+3} y={height-6}>{a}°</text></g>)}<circle cx={x(sample.sun_azimuth_deg)} cy={y(sample.sun_elevation_deg)} r="7" className="sun-dot"/><circle cx={x(sample.earth_azimuth_deg)} cy={y(sample.earth_elevation_deg)} r="7" className="earth-dot"/></svg><input className="science-cursor" aria-label="Observation time cursor" type="range" min={Date.parse(MALAPERT_SAMPLES[0].time_utc)} max={Date.parse(MALAPERT_SAMPLES[MALAPERT_SAMPLES.length-1].time_utc)} step={240000} value={cursor} onChange={event=>setCursor(Number(event.target.value))}/><div className="body-readout"><span className="sun"><i/><span><strong>Sun · {sample.sun_visibility_status.replace("_"," ")}</strong><small>Az {sample.sun_azimuth_deg.toFixed(1)}° · El {sample.sun_elevation_deg.toFixed(2)}° · terrain {sample.horizon_elevation_at_sun_deg.toFixed(2)}°</small></span></span><span className="earth"><i/><span><strong>Earth · {sample.earth_visibility_status.replace("_"," ")}</strong><small>Az {sample.earth_azimuth_deg.toFixed(1)}° · El {sample.earth_elevation_deg.toFixed(2)}° · terrain {sample.horizon_elevation_at_earth_deg.toFixed(2)}°</small></span></span></div></section></>;
}

function ComparisonRow({site,result,duration,limit,onSelect}:{site:(typeof SITES)[number];result:SiteMetrics;duration:number;limit:number;onSelect:()=>void}){
  const values=[
    {label:"Sunlight",value:result.sunlightHours,tone:"sun"},
    {label:"Earth visibility",value:result.earthHours,tone:"earth"},
    {label:"Sun + Earth",value:result.simultaneousHours,tone:"both"},
    {label:"Longest dark",value:result.longestDarknessHours,tone:"dark"}
  ];
  return <button className={`screening-row ${result.meets?"is-shortlisted":"is-review"}`} onClick={onSelect}><span className="site-code">{site.id}</span><span className="screening-name"><strong>{site.name}</strong><small>{site.latitude.toFixed(3)}° · {site.longitude.toFixed(3)}°</small></span><span className="screening-metrics">{values.map(metric=><span className={`screening-metric ${metric.tone}`} key={metric.label}><small>{metric.label}</small><strong>{fmt(metric.value)}</strong><i><b style={{width:`${Math.min(100,metric.value/duration*100)}%`}}/></i></span>)}</span><span className={`screening-verdict ${result.meets?"pass":"fail"}`}><i/>{result.meets?"Shortlist":`Review · >${fmt(limit)}`}</span><b className="screening-arrow">↗</b></button>;
}

export default function App(){
  const [planning,setPlanning]=useState(false),[selected,setSelected]=useState<SiteId|null>(null),[scenario,setScenario]=useState<ScenarioId>("baseline"),[limit,setLimit]=useState(12),[cursor,setCursor]=useState(Date.parse(MALAPERT_SAMPLES[0].time_utc)),[method,setMethod]=useState(false);
  const info=scenarioInfo(scenario),duration=info.duration,missionStart=info.start,missionEnd=info.end;
  const results=useMemo(()=>Object.fromEntries(SITES.map(s=>[s.id,metrics(s.id,scenario,limit)])) as Record<SiteId,SiteMetrics>,[scenario,limit]);
  const baseline=useMemo(()=>Object.fromEntries(SITES.map(s=>[s.id,metrics(s.id,"baseline",limit)])) as Record<SiteId,SiteMetrics>,[limit]);
  const reset=()=>{setPlanning(true);setSelected(null);setScenario("baseline");setLimit(12);setCursor(Date.parse(MALAPERT_SAMPLES[0].time_utc))};
  const scrollPanelTop=()=>requestAnimationFrame(()=>document.querySelector(".panel")?.scrollTo({top:0,behavior:"smooth"}));
  const choose=(id:SiteId)=>{setSelected(id);scrollPanelTop()};
  const showAllSites=()=>{setSelected(null);scrollPanelTop()};
  const selectedSite=SITES.find(s=>s.id===selected),selectedResult=selected?results[selected]:null;
  const shortlist=SITES.filter(s=>results[s.id].meets).length;
  const utc=(date:Date)=>date.toISOString().replace("T"," · ").slice(0,18)+" UTC";
  return <main className={planning?"planning":"opening"}>
    <Moon planning={planning} selected={selected} onSelect={choose}/>
    <header><div className="brand"><span className="brand-mark">A</span><span>AmTree</span></div>{planning&&<div className="header-actions"><span className="demo-badge real-data">LOLA terrain · SPICE ephemeris</span><button className="text-button" onClick={()=>setMethod(true)}>Data &amp; Method</button><button className="text-button" onClick={reset}>Reset</button></div>}</header>
    {!planning?<section className="hero"><p className="eyebrow">AMTREE LUNAR NAVIGATOR</p><h1>Lunar Navigator</h1><p>Compare computed lighting and Earth visibility conditions at the lunar south pole.</p><button className="primary" onClick={()=>setPlanning(true)}>Plan a landing <span>→</span></button></section>:<section className="planner">
      <div className="map-caption"><span>NASA LRO / LOLA terrain · Six study locations</span><strong>{selectedSite?.name||"South polar overview"}</strong></div>
      <aside className={`panel ${selectedSite?"site-detail-panel":"screening-dashboard"}`}>
        {!selectedSite?<>
          <div className="ops-head"><div><p className="ops-path">MISSION 01 <span>/</span> SOUTH POLAR SCREENING</p><h2>Landing site<br/>navigator</h2></div><span className="coverage-state valid"><i/>Computed dataset online</span></div>
          <section className="decision-banner"><div className="decision-score"><strong>{shortlist}</strong><span>/ 06</span></div><div className="decision-copy"><small>CURRENT SHORTLIST</small><h3>{shortlist===1?"One point meets":"Points meeting"} screening limits</h3><p>Longest darkness ≤ {limit} h across the shared {duration} h mission.</p></div><div className="decision-key"><span><i className="sun"/>Sun</span><span><i className="earth"/>Earth</span><span><i className="both"/>Both</span></div></section>
          <section className="mission-console">
            <div className="console-head"><div><small>SHARED MISSION WINDOW</small><strong>{utc(missionStart)}</strong></div><span>→</span><div><small>MISSION END</small><strong>{utc(missionEnd)}</strong></div></div>
            <div className="console-controls real-scenarios"><button className={scenario==="baseline"?"scenario-command active":"scenario-command"} onClick={()=>setScenario("baseline")}><small>BASELINE WINDOW</small><strong>10 Jan 2027 · 12:00 UTC</strong></button><button className={scenario==="delay48"?"scenario-command active":"scenario-command"} onClick={()=>setScenario("delay48")}><small>SHIFTED WINDOW</small><strong>Delay +48 h</strong></button><label><span>Duration</span><strong className="locked-value">72 hours · computed</strong></label><label><span>Darkness limit</span><select value={limit} onChange={e=>setLimit(+e.target.value)}><option value="6">6 hours</option><option value="12">12 hours</option><option value="18">18 hours</option><option value="24">24 hours</option></select></label></div>
          </section>
          {scenario==="delay48"&&<div className="impact-brief"><div><small>WINDOW CHANGE</small><strong>What changed after +48 h</strong></div><div className="impact-events">{(["Site01","Site23"] as SiteId[]).map(id=>{const site=SITES.find(item=>item.id===id)!;return <p key={id} className={id==="Site01"?"entered":"left"}><b>{id==="Site01"?"+":"−"}</b><span><strong>{site.name}</strong><small>Sun {baseline[id].sunlightHours.toFixed(1)} → {results[id].sunlightHours.toFixed(1)} h · Earth {baseline[id].earthHours.toFixed(1)} → {results[id].earthHours.toFixed(1)} h</small></span></p>})}</div></div>}
          <div className="screening-head"><div><small>SITE MATRIX</small><h3>Six documented study locations</h3></div><span>Select a row to inspect terrain and visibility →</span></div>
          <div className="screening-columns"><span>Location</span><span>Mission exposure</span><span>Decision</span></div>
          <div className="screening-list">{SITES.map(site=><ComparisonRow key={site.id} site={site} result={results[site.id]} duration={duration} limit={limit} onSelect={()=>choose(site.id)}/>)}</div>
          <div className="screening-rule"><span>SCREENING RULE</span><p>Shortlist means the longest continuous darkness period is at or below {limit} hours. These are study coordinates, not certified landing sites.</p></div>
        </>:<>
          <div className="detail-nav"><button className="back" onClick={showAllSites}>← All sites</button><span>{selectedSite.id}</span></div>
          <div className="detail-hero"><div><p className="eyebrow">COMPUTED STUDY POINT</p><h2>{selectedSite.name}</h2><p>{selectedSite.latitude}° latitude · {selectedSite.longitude}° east</p></div>{selectedResult&&<span className={`detail-status ${selectedResult.meets?"pass":"fail"}`}><i/>{selectedResult.meets?"Meets darkness limit":`Exceeds ${limit} h darkness limit`}</span>}</div>
          <section className="detail-window"><span><small>Landing</small><strong>{utc(missionStart)}</strong></span><span><small>Duration</small><strong>{duration} hours</strong></span><span><small>Mission end</small><strong>{utc(missionEnd)}</strong></span></section>
          <div className="detail-metrics">{selectedResult&&<><span className="sun"><small>Sunlight</small><strong>{fmt(selectedResult.sunlightHours)}</strong><em>{Math.round(selectedResult.sunlightHours/duration*100)}% of mission</em></span><span className="earth"><small>Earth visibility</small><strong>{fmt(selectedResult.earthHours)}</strong><em>{Math.round(selectedResult.earthHours/duration*100)}% of mission</em></span><span className="dark"><small>Longest darkness</small><strong>{fmt(selectedResult.longestDarknessHours)}</strong><em>{selectedResult.meets?"Within limit":"Above limit"}</em></span><span className="both"><small>Sun + Earth</small><strong>{fmt(selectedResult.simultaneousHours)}</strong><em>Simultaneous visibility</em></span></>}</div>
          {hasDetailedSeries(selectedSite.id,scenario)?<MalapertDetail cursor={cursor} setCursor={setCursor}/>:<section className="detail-section honest-empty"><small>DETAILED SERIES</small><h3>Summary metrics are available for this scenario</h3><p>The supplied scientific package contains the full 240-second Sun/Earth series and local terrain horizon only for Malapert Massif in the baseline window. No synthetic curve is shown.</p>{selectedSite.id==="Site23"&&scenario==="delay48"&&<button onClick={()=>setScenario("baseline")}>Open Malapert baseline series</button>}</section>}
          <section className="detail-section provenance-grid"><div><small>TERRAIN</small><strong>{SOURCE_SUMMARY.terrain}</strong></div><div><small>EPHEMERIS</small><strong>{SOURCE_SUMMARY.ephemeris}</strong></div><div><small>VISIBILITY</small><strong>{SOURCE_SUMMARY.visibility}</strong></div><div><small>OBSERVER</small><strong>{SOURCE_SUMMARY.observer}</strong></div></section>
        </>}
      </aside>
    </section>}
    {method&&<div className="modal" role="dialog" aria-modal="true" aria-label="Data and Method"><button className="modal-close" onClick={()=>setMethod(false)}>Close</button><p className="eyebrow">TRANSPARENT BY DESIGN</p><h2>Data &amp; Method</h2><h3>Official data families</h3><p>Terrain is derived from NASA GSFC PGDA LOLA south-pole DEM products. Sun and Earth geometry is reported as computed with NASA/JPL NAIF SPICE kernels in the lunar MOON_ME frame. USGS LGRS/ACC grids provide regional navigation extents.</p><h3>Visibility model</h3><p>The observer is 2 m above terrain. The horizon includes lunar curvature and terrain to 600 km. A body is visible when at least half of its sampled disc is above the terrain horizon.</p><h3>Scientific limits</h3><p>Near terrain is 80 m/pixel and far terrain 480 m/pixel. Small obstacles, lander-scale slope, power systems, antennas, link budgets, descent hazards and reachability are not modelled. The real-terrain horizon has not been independently validated.</p><h3>Included evidence</h3><p>Both 72-hour comparisons are complete. A full 240-second series is included only for the Malapert baseline scenario; the interface never fabricates missing detail.</p><p className="method-note">Prototype for site screening · not NASA-approved · not validated for flight operations.</p><a className="science-link" href="/science/SCIENCE_AND_LIMITS.md" target="_blank">Open complete science notes ↗</a></div>}
  </main>;
}
