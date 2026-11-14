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
  if(!result.valid)return <button className="screening-row invalid-row" onClick={onSelect}><span className="site-code">{site.id}</span><span className="screening-name"><strong>{site.name}</strong><small>{site.latitude.toFixed(4)}°, {site.longitude.toFixed(4)}°</small></span><span className="invalid">Mission outside data coverage</span><b className="screening-arrow">↗</b></button>;
  const values=[
    {label:"Sunlight",value:result.sunlightHours,tone:"sun"},
    {label:"Earth visibility",value:result.earthHours,tone:"earth"},
    {label:"Sun + Earth",value:result.simultaneousHours,tone:"both"},
    {label:"Longest dark",value:result.longestDarknessHours,tone:"dark"}
  ];
  return <button className={`screening-row ${result.meets?"is-shortlisted":"is-review"}`} onClick={onSelect}><span className="site-code">{site.id}</span><span className="screening-name"><strong>{site.name}</strong><small>{site.latitude.toFixed(3)}° · {site.longitude.toFixed(3)}°</small></span><span className="screening-metrics">{values.map(metric=><span className={`screening-metric ${metric.tone}`} key={metric.label}><small>{metric.label}</small><strong>{fmt(metric.value)}</strong><i><b style={{width:`${Math.min(100,metric.value/duration*100)}%`}}/></i></span>)}</span><span className={`screening-verdict ${result.meets?"pass":"fail"}`}><i/>{result.meets?"Shortlist":`Review · >${fmt(limit)}`}</span><b className="screening-arrow">↗</b></button>;
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
      <aside className={`panel ${selectedSite?"site-detail-panel":"screening-dashboard"}`}>
        {!selectedSite?<>
          <div className="ops-head"><div><p className="ops-path">MISSION 01 <span>/</span> SOUTH POLAR SCREENING</p><h2>Landing site<br/>navigator</h2></div><span className={`coverage-state ${inCoverage?"valid":"invalid"}`}><i/>{inCoverage?"168 h dataset online":"Outside coverage"}</span></div>
          <section className="decision-banner"><div className="decision-score"><strong>{shortlist}</strong><span>/ 06</span></div><div className="decision-copy"><small>CURRENT SHORTLIST</small><h3>{shortlist===1?"One site meets":"Sites meeting"} demo limits</h3><p>Longest darkness ≤ {limit} h across the shared {duration} h mission.</p></div><div className="decision-key"><span><i className="sun"/>Sun</span><span><i className="earth"/>Earth</span><span><i className="both"/>Both</span></div></section>
          <section className="mission-console">
            <div className="console-head"><div><small>SHARED MISSION WINDOW</small><strong>{utc(missionStart)}</strong></div><span>→</span><div><small>MISSION END</small><strong>{utc(missionEnd)}</strong></div></div>
            <div className="console-controls"><label><span>Landing <small>UTC</small></span><input type="datetime-local" value={dateValue(start)} onChange={e=>{setStart(hourFromDate(e.target.value));setCursor(hourFromDate(e.target.value));setDelayed(false)}}/></label><label><span>Duration</span><select value={duration} onChange={e=>setDuration(+e.target.value)}><option value="24">24 hours</option><option value="48">48 hours</option><option value="72">72 hours</option><option value="96">96 hours</option></select></label><label><span>Darkness limit</span><select value={limit} onChange={e=>setLimit(+e.target.value)}><option value="6">6 hours</option><option value="12">12 hours</option><option value="18">18 hours</option><option value="24">24 hours</option></select></label><button className="delay-command" onClick={()=>{setStart(v=>v+48);setCursor(v=>v+48);setDelayed(true)}}><small>SHIFT WINDOW</small><strong>Delay +48 h</strong><span>→</span></button></div>
          </section>
          {summary&&<div className="impact-brief"><div><small>WINDOW CHANGE</small><strong>What changed after +48 h</strong></div><div className="impact-events">{summary.left.map(s=><p key={s.id} className="left"><b>−</b><span><strong>{s.name}</strong><small>Left shortlist · darkness now {darknessFor(s.id)}, above {limit} h.</small></span></p>)}{summary.entered.map(s=><p key={s.id} className="entered"><b>+</b><span><strong>{s.name}</strong><small>Entered shortlist · darkness reduced to {darknessFor(s.id)}.</small></span></p>)}</div></div>}
          <div className="screening-head"><div><small>SITE MATRIX</small><h3>Six documented study locations</h3></div><span>Select a row to inspect terrain and visibility →</span></div>
          <div className="screening-columns"><span>Location</span><span>Mission exposure</span><span>Decision</span></div>
          <div className="screening-list">{SITES.map(site=><ComparisonRow key={site.id} site={site} result={results[site.id]} duration={duration} limit={limit} onSelect={()=>choose(site.id)}/>)}</div>
          <div className="screening-rule"><span>DEMO SCREENING RULE</span><p>Shortlist means the longest continuous darkness period is at or below {limit} hours. It does not mean safe to land.</p></div>
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
    {method&&<div className="modal" role="dialog" aria-modal="true" aria-label="Data and Method"><button className="modal-close" onClick={()=>setMethod(false)}>Close</button><p className="eyebrow">TRANSPARENT BY DESIGN</p><h2>Data &amp; Method</h2><h3>What this demo uses</h3><p>Official polar-enhanced 8K lunar color imagery from NASA’s Goddard Space Flight Center CGI Moon Kit, official LOLA elevation displacement, and study-location coordinates from NASA’s Lunar Surface Data Book, ACD-50044 Rev A.</p><h3>What is synthetic</h3><p>Sun and Earth positions, local horizon profiles, and visibility windows are deterministic illustrative conditions. They are not NASA predictions or MATLAB output.</p><h3>Future scientific integration</h3><p>The fixture schema is ready for MATLAB exports informed by higher-resolution LOLA terrain products and JPL Horizons. Moon Trek, QuickMap, and CSA mission context are reference resources only.</p><p className="method-note">No live APIs or external services are used at runtime.</p></div>}
  </main>;
}
