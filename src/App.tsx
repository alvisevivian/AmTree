"use client";

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ensureBrowserRuntime } from './runtimeReady';
import * as THREE from "three";
import { GroundFlight, type GroundStatus } from "./lib/ground";
import { LOCATIONS, REGIONS, SITES, type LocationId, type SiteId } from "./lib/sites";
import { KERNEL_START, KERNEL_END, SOLAR_START, SOLAR_END, SOLAR_STEP, malapertSampleAt, meetsDarknessLimit, metrics, regionMetrics, scenarioInfo, type GroundSolarSample, type WindowExposure } from "./lib/simulation";
import { DecisionDashboard } from "./DecisionDashboard";
import { LocationTimelapses, StationBars, TimePlayback, VisibilityGraph, type MissionSimulation, type Playback, type VisibilitySample } from "./SimulationResults";

// ★ Optional transition logo. Set false to revert the fading intro mark.
const SHOW_TRANSITION_LOGO = false;
// Starred: persistent transition navbar. Set false to revert.
const PERSISTENT_NAVBAR = true;

const fmt = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} h`;

const overviewCameraPosition = new THREE.Vector3(0, -.06, 4.7);
const approachDuration = 2100;
const arrivalHold = 280;
type Phase = "opening" | "approach" | "planning";

type Vector = [number, number, number];
export type FlybyPose = {
  eye: Vector;
  forward: Vector;
  right: Vector;
  up: Vector;
  lens: [number, number];
  moonCenter: Vector;
  moonRadius: number;
  moonLongitude: number;
  moonLatitude: number;
};

function Moon({ phase, introComplete, flybyPose, onReady, onArrival, selected, onSelect, solarSample, timeline }: {
  phase: Phase;
  introComplete: boolean;
  flybyPose: FlybyPose | null;
  onReady: (available: boolean) => void;
  onArrival: () => void;
  selected: LocationId | null;
  solarSample: GroundSolarSample | null;
  timeline: { start: number; end: number; cursor: number; step: number; ticks?: number[]; index: number; change: (value: number) => void; playback: Playback };
  onSelect: (id: LocationId) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const focusLabel = useRef<HTMLDivElement>(null);
  const selectedAt = useRef(0);
  const [groundEnabled, setGroundEnabled] = useState(false);
  const [groundDisplay, setGroundDisplay] = useState<{
    status: GroundStatus;
    altitude: string;
  }>({ status: "idle", altitude: "" });
  const state = useRef<{ ground: GroundFlight; moon: THREE.Group; markers: Map<LocationId, THREE.Sprite>; frame: number; cameraTarget: THREE.Vector3; rotationTarget: THREE.Quaternion } | null>(null);
  const entryRef = useRef({ phase, introComplete, flybyPose });
  useEffect(() => {
    entryRef.current = { phase, introComplete, flybyPose };
  }, [phase, introComplete, flybyPose]);
  const onSelectRef = useRef(onSelect);
  const selectedRef = useRef(selected);
  const solarSampleRef = useRef(solarSample);
  useEffect(() => { solarSampleRef.current = solarSample; }, [solarSample]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => {
    selectedRef.current = selected;
    selectedAt.current = performance.now();
    if (focusLabel.current) focusLabel.current.style.opacity = "0";
  }, [selected]);
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
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43.1, 1, .1, 100);
      camera.position.copy(overviewCameraPosition);
      const moon = new THREE.Group(); scene.add(moon);
      const loader = new THREE.TextureLoader();
      let disposed = false;
      let sceneReady = false;
      let polarMaterial: THREE.MeshBasicMaterial | undefined;
      Promise.all([
        loader.loadAsync(import.meta.env.BASE_URL + "intro/earth-to-moon/assets/moon.jpg"),
        loader.loadAsync(import.meta.env.BASE_URL + "assets/ldem_4.png"),
        loader.loadAsync(import.meta.env.BASE_URL + "assets/lola_south_pole_80m.webp"),
      ]).then(async ([moonTexture, displacement, polarRelief]) => {
        if (disposed) return;
        moonTexture.colorSpace = THREE.SRGBColorSpace;
        const anisotropy = renderer.capabilities.getMaxAnisotropy();
        moonTexture.anisotropy = anisotropy;
        displacement.anisotropy = anisotropy;
        displacement.minFilter = THREE.LinearMipmapLinearFilter;
        displacement.magFilter = THREE.LinearFilter;
        const geometry = new THREE.SphereGeometry(1.55, 384, 256);
        const material = new THREE.MeshStandardMaterial({ map: moonTexture, displacementMap: displacement, displacementScale: .018, displacementBias: -.009, roughness: .88, metalness: 0 });
        const sphere = new THREE.Mesh(geometry, material);
        moon.add(sphere);

        // A separate polar mesh preserves the 80 m/px NASA LOLA relief in the planner.
        polarRelief.colorSpace = THREE.SRGBColorSpace;
        polarRelief.anisotropy = anisotropy;
        polarRelief.minFilter = THREE.LinearMipmapLinearFilter;
        polarRelief.magFilter = THREE.LinearFilter;
        const polarSegments = 128, mapExtentM = 304000, lunarRadiusM = 1737400, polarRadius = 1.561;
        const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
        for (let row = 0; row <= polarSegments; row++) {
          const mapY = mapExtentM * (1 - row / polarSegments * 2);
          for (let column = 0; column <= polarSegments; column++) {
            const mapX = mapExtentM * (column / polarSegments * 2 - 1);
            const rho = Math.hypot(mapX, mapY);
            const colatitude = 2 * Math.atan(rho / (2 * lunarRadiusM));
            const horizontal = Math.sin(colatitude), scale = rho ? horizontal / rho : 0;
            positions.push(polarRadius * mapY * scale, -polarRadius * Math.cos(colatitude), -polarRadius * mapX * scale);
            uvs.push(column / polarSegments, 1 - row / polarSegments);
          }
        }
        for (let row = 0; row < polarSegments; row++) for (let column = 0; column < polarSegments; column++) {
          const a = row * (polarSegments + 1) + column, b = a + 1, c = a + polarSegments + 1, d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
        const polarGeometry = new THREE.BufferGeometry();
        polarGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        polarGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
        polarGeometry.setIndex(indices); polarGeometry.computeVertexNormals();
        const maskCanvas = document.createElement("canvas"); maskCanvas.width = maskCanvas.height = 512;
        const maskContext = maskCanvas.getContext("2d")!;
        const maskGradient = maskContext.createRadialGradient(256, 256, 0, 256, 256, 256);
        maskGradient.addColorStop(0, "white"); maskGradient.addColorStop(.68, "white"); maskGradient.addColorStop(1, "black");
        maskContext.fillStyle = maskGradient; maskContext.fillRect(0, 0, 512, 512);
        const polarMask = new THREE.CanvasTexture(maskCanvas);
        polarMaterial = new THREE.MeshBasicMaterial({ map: polarRelief, alphaMap: polarMask, color: 0xc7bca9, transparent: true, opacity: 0, alphaTest: .012, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
        const polarCap = new THREE.Mesh(polarGeometry, polarMaterial); polarCap.renderOrder = 2; moon.add(polarCap);
        await renderer.compileAsync(scene, camera);
        if (!disposed) sceneReady = true;
      }).catch(() => {
        if (!disposed) onReady(false);
      });
      scene.add(new THREE.HemisphereLight(0x7790ad, 0x010205, .22));
      const key = new THREE.DirectionalLight(0xfff7e8, 3.8); key.position.set(-4, 2.6, 5); scene.add(key);
      const rim = new THREE.DirectionalLight(0x608cc0, .72); rim.position.set(4,-2,-4); scene.add(rim);
      const markerTexture=(active=false, region=false)=>{const canvas=document.createElement("canvas");canvas.width=128;canvas.height=128;const context=canvas.getContext("2d")!;context.clearRect(0,0,128,128);const color=region?"#76cbef":"#f4b94f";context.strokeStyle=active?"#fff5df":color;context.fillStyle=color;context.lineWidth=active?8:7;context.lineCap="round";const corner=(x:number,y:number,sx:number,sy:number)=>{context.beginPath();context.moveTo(x+sx*25,y);context.lineTo(x,y);context.lineTo(x,y+sy*25);context.stroke()};corner(38,38,1,1);corner(90,38,-1,1);corner(38,90,1,-1);corner(90,90,-1,-1);context.save();context.translate(64,64);context.rotate(Math.PI/4);context.fillRect(active?-8:-5,active?-8:-5,active?16:10,active?16:10);context.restore();const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.minFilter=THREE.LinearFilter;return map};
      const markers = new Map<LocationId, THREE.Sprite>();
      for (const site of LOCATIONS) {
        const phi = THREE.MathUtils.degToRad(90 - site.latitude), theta = THREE.MathUtils.degToRad(site.longitude);
        const region = "elevationM" in site;
        const normalTexture=markerTexture(false, region),activeTexture=markerTexture(true, region);
        const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map:normalTexture,transparent:true,depthWrite:false,depthTest:true }));
        marker.scale.setScalar(region ? .046 : .036);
        marker.userData.normalTexture=normalTexture;marker.userData.activeTexture=activeTexture;
        marker.position.set(1.59*Math.sin(phi)*Math.cos(theta),1.59*Math.cos(phi),-1.59*Math.sin(phi)*Math.sin(theta));
        marker.userData.id = site.id;
        marker.userData.region = region;
        moon.add(marker);
        markers.set(site.id, marker);
      }
      const cameraTarget = overviewCameraPosition.clone();
      const rotationTarget = polarQuaternion();
      const ground = new GroundFlight((status, altitude) => setGroundDisplay({ status, altitude }));
      state.current = { ground, moon, markers, frame: 0, cameraTarget, rotationTarget };
      const canvas = renderer.domElement;
      const resize = () => {
        const { clientWidth: width, clientHeight: height } = canvas;
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(canvas);
      const ray = new THREE.Raycaster(), pointer = new THREE.Vector2(); let dragging=false, moved=false, px=0, py=0;
      const down = (event: PointerEvent) => {
        if (event.target !== canvas || entryRef.current.phase === "approach" || !event.isPrimary) return;
        dragging = true;
        moved = false;
        px = event.clientX;
        py = event.clientY;
        event.preventDefault();
      };
      const move = (event: PointerEvent) => {
        if (!dragging || !event.isPrimary || entryRef.current.phase === "approach") return;
        const dx = event.clientX - px, dy = event.clientY - py;
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        px = event.clientX;
        py = event.clientY;
        if (ground.busy) {
          if (ground.looking) ground.look(dx, dy);
          return;
        }
        const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(dy * .006, dx * .006, 0, "XYZ"));
        moon.quaternion.premultiply(delta).normalize();
        rotationTarget.copy(moon.quaternion);
      };
      const up = () => { dragging = false; };
      const click = (event: MouseEvent) => {
        if (moved || ground.busy || entryRef.current.phase !== "planning") return;
        const rect = canvas.getBoundingClientRect();
        pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        ray.setFromCamera(pointer, camera);
        const candidates = ray.intersectObjects([...markers.values()].filter(marker => marker.visible), false);
        let nearest: LocationId | null = null;
        let minDistance = Infinity;
        for (const { object } of candidates) {
          object.getWorldPosition(projected).project(camera);
          const distance = Math.hypot((projected.x - pointer.x) * rect.width, (projected.y - pointer.y) * rect.height);
          if (distance < minDistance) {
            minDistance = distance;
            nearest = object.userData.id;
          }
        }
        if (nearest) onSelectRef.current(nearest);
      };
      const wheel = (event: WheelEvent) => {
        if (entryRef.current.phase !== "planning") return;
        event.preventDefault();
        const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
        if (ground.busy) {
          ground.zoom(delta, selectedRef.current);
        } else if (selectedRef.current && delta < 0 && cameraTarget.z <= 2.05) {
          ground.descend(selectedRef.current, false, moon.quaternion);
        } else {
          cameraTarget.z = THREE.MathUtils.clamp(cameraTarget.z + delta * .002, 2.05, 6);
        }
      };
      const keydown = (event: KeyboardEvent) => {
        if (event.key === "Escape" && ground.busy) ground.ascend();
      };
      addEventListener("resize", resize);
      addEventListener("pointermove", move);
      addEventListener("pointerup", up);
      addEventListener("pointercancel", up);
      addEventListener("keydown", keydown);
      canvas.style.touchAction = "none";
      canvas.addEventListener("pointerdown", down);
      canvas.addEventListener("click", click);
      canvas.addEventListener("wheel", wheel, { passive: false });
      resize();
      const projected = new THREE.Vector3(), world = new THREE.Vector3(), centerToCamera = new THREE.Vector3();
      const overviewView = camera.clone();
      overviewView.position.copy(overviewCameraPosition);
      overviewView.lookAt(0, -.38, 0);
      const interactiveView = camera.clone();
      const orbitView = camera.clone();
      const overviewRotation = rotationTarget.clone();
      const entryPosition = new THREE.Vector3();
      const entryView = new THREE.Quaternion();
      const entryRotation = new THREE.Quaternion();
      const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
      let entryFov = camera.fov;
      let entryStart: number | undefined;
      let previewRendered = false;
      let arrived = false;
      let controlsStart: number | undefined;
      const animate = (now: number) => {
        if (!state.current) return;
        state.current.frame = requestAnimationFrame(animate);
        const { phase, introComplete, flybyPose } = entryRef.current;
        if (!introComplete || !sceneReady) return;

        if (!previewRendered) {
          if (flybyPose) {
            entryPosition.fromArray(flybyPose.eye).sub(world.fromArray(flybyPose.moonCenter))
              .multiplyScalar(1.55 / flybyPose.moonRadius);
            const viewBasis = new THREE.Matrix4().makeBasis(
              new THREE.Vector3(...flybyPose.right),
              new THREE.Vector3(...flybyPose.up),
              new THREE.Vector3(...flybyPose.forward).negate(),
            );
            entryView.setFromRotationMatrix(viewBasis);
            // Invert the flyby's texture rotations and align its longitude with SphereGeometry's UVs.
            entryRotation.setFromEuler(new THREE.Euler(
              -flybyPose.moonLatitude, flybyPose.moonLongitude + Math.PI / 2, .17, "YXZ",
            )).invert();
            entryFov = THREE.MathUtils.radToDeg(2 * Math.atan(flybyPose.lens[1]));
          } else {
            entryPosition.set(-4.15, 1.14, 9.37);
            camera.position.copy(entryPosition);
            camera.lookAt(0, 0, 0);
            entryView.copy(camera.quaternion);
          }
          camera.position.copy(entryPosition);
          camera.quaternion.copy(entryView);
          camera.fov = entryFov;
          camera.updateProjectionMatrix();
          moon.quaternion.copy(entryRotation);
          renderer.render(scene, camera);
          previewRendered = true;
          setGroundEnabled(true);
          onReady(true);
        }

        if (phase === "approach") {
          if (entryStart === undefined) {
            entryStart = now;
            dragging = false;
            entryPosition.copy(camera.position);
            entryView.copy(camera.quaternion);
            entryRotation.copy(moon.quaternion);
            entryFov = camera.fov;
            rotationTarget.copy(overviewRotation);
          }
          const elapsed = now - entryStart;
          const progress = reducedMotion.matches ? 1 : Math.min(elapsed / approachDuration, 1);
          const turn = THREE.MathUtils.smootherstep(progress, 0, 1);
          const dolly = THREE.MathUtils.smootherstep(progress, .08, 1);
          camera.position.lerpVectors(entryPosition, overviewCameraPosition, dolly);
          camera.quaternion.slerpQuaternions(entryView, overviewView.quaternion, dolly);
          moon.quaternion.slerpQuaternions(entryRotation, overviewRotation, turn);
          camera.fov = THREE.MathUtils.lerp(entryFov, overviewView.fov, dolly);
          camera.updateProjectionMatrix();
          if (polarMaterial) polarMaterial.opacity = .76 * THREE.MathUtils.smoothstep(progress, .25, .95);
          if (!arrived && (reducedMotion.matches || elapsed >= approachDuration + arrivalHold)) {
            arrived = true;
            onArrival();
          }
        } else if (phase === "planning") {
          controlsStart ??= now;
          if (controlsStart === now) {
            orbitView.position.copy(camera.position);
            orbitView.quaternion.copy(camera.quaternion);
          }
          const smoothing = reducedMotion.matches ? 1 : .12;
          orbitView.position.lerp(cameraTarget, smoothing);
          interactiveView.position.copy(orbitView.position);
          interactiveView.lookAt(0, selectedRef.current ? 0 : -.38, 0);
          orbitView.quaternion.slerp(interactiveView.quaternion, smoothing);
          camera.position.copy(orbitView.position);
          camera.quaternion.copy(orbitView.quaternion);
          if (!ground.busy) moon.quaternion.slerp(rotationTarget, reducedMotion.matches ? 1 : .075);
          ground.update(now, camera, moon, reducedMotion.matches, solarSampleRef.current);
        }
        const markerOpacity = controlsStart === undefined
          ? 0
          : reducedMotion.matches ? 1 : THREE.MathUtils.smoothstep(now - controlsStart, 350, 1350);
        const visibleMarkerOpacity = markerOpacity * ground.markerOpacity;
        centerToCamera.copy(camera.position).normalize();
        const focusOpacity = 1 - THREE.MathUtils.smoothstep(now - selectedAt.current, 1600, 2200);
        markers.forEach(marker => {
          const opacity = marker.userData.id === selectedRef.current ? visibleMarkerOpacity * focusOpacity : visibleMarkerOpacity;
          marker.getWorldPosition(world);
          marker.visible = opacity > 0 && world.normalize().dot(centerToCamera) > .05;
          marker.material.opacity = opacity;
        });
        const activeMarker = selectedRef.current && markers.get(selectedRef.current);
        if (activeMarker && focusLabel.current) {
          activeMarker.getWorldPosition(projected).project(camera);
          focusLabel.current.style.opacity = activeMarker.visible ? String(ground.markerOpacity * focusOpacity) : "0";
          const image = canvas.getBoundingClientRect();
          const stage = container.getBoundingClientRect();
          const x = image.left - stage.left + (projected.x * .5 + .5) * image.width;
          const y = image.top - stage.top + (-projected.y * .5 + .5) * image.height;
          focusLabel.current.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-145%)`;
        }
        ground.render(renderer, scene, camera);
      };
      state.current.frame = requestAnimationFrame(animate);
      return()=>{disposed=true;removeEventListener("resize",resize);removeEventListener("pointermove",move);removeEventListener("pointerup",up);removeEventListener("pointercancel",up);removeEventListener("keydown",keydown);ground.dispose();observer.disconnect();cancelAnimationFrame(state.current?.frame||0);renderer.dispose();markers.forEach(marker=>{marker.userData.normalTexture?.dispose();marker.userData.activeTexture?.dispose();marker.material.dispose()});renderer.domElement.remove();state.current=null};
    } catch {
      const fallback = document.createElement("div");
      fallback.className = "fallback";
      fallback.textContent = "3D Moon unavailable — the planner and region directory remain accessible.";
      container.appendChild(fallback);
      onReady(false);
      return () => fallback.remove();
    }
  }, [onReady, onArrival]);
  const polarQuaternion=()=>new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,-1,0),new THREE.Vector3(0,-.35,1).normalize());
  useEffect(() => {
    const controls = state.current;
    if (!controls) return;
    controls.ground.ascend();
    controls.markers.forEach((marker, id) => {
      const active = id === selected;
      marker.material.map = active ? marker.userData.activeTexture : marker.userData.normalTexture;
      marker.material.needsUpdate = true;
      marker.scale.setScalar(active ? .085 : marker.userData.region ? .046 : .036);
    });
    const marker = selected && controls.markers.get(selected);
    if (marker) {
      controls.rotationTarget.setFromUnitVectors(marker.position.clone().normalize(), new THREE.Vector3(0, -.14, 1).normalize());
      controls.cameraTarget.set(0, -.04, 2.3);
      controls.ground.preload(selected);
    } else {
      controls.rotationTarget.copy(polarQuaternion());
      controls.cameraTarget.copy(overviewCameraPosition);
    }
  }, [selected]);
  const selectedName = LOCATIONS.find(site => site.id === selected)?.name;
  const { status, altitude } = groundDisplay;
  const terrainVisible = status === "descending" || status === "surface" || status === "ascending" || status === "returning";
  const flying = status === "loading" || status === "descending" || status === "surface" || status === "ascending";
  const toggleGround = () => {
    const controls = state.current;
    if (!controls) return;
    if (flying) controls.ground.ascend();
    else if (selected) controls.ground.descend(selected, true, controls.moon.quaternion);
  };
  const overview = () => {
    const controls = state.current;
    if (!controls) return;
    controls.ground.ascend();
    controls.rotationTarget.copy(polarQuaternion());
    controls.cameraTarget.copy(overviewCameraPosition);
  };
  return <div className={`moon-stage ${terrainVisible ? "surface-flight" : ""}`} ref={host}
    aria-label="Interactive 3D Moon with NASA LOLA relief and ground-level views of study points and Artemis III region centers">
    <div ref={focusLabel} className={`site-focus-label ${selected ? "visible" : ""}`}><i/>{selectedName}</div>
    <div className="map-tools">
      <div className="map-tool-buttons">
        <button onClick={overview}>South pole</button>
        {groundEnabled && (selected || terrainVisible) && <button className="ground-button" onClick={toggleGround} disabled={!selected || status === "returning"}>
          {status === "returning" ? "Returning to orbit" : flying ? "Return to orbit" : "Ground level"}
        </button>}
        {status === "surface" && solarSample && <button onClick={() => state.current?.ground.aimAt("sun")}>Face Sun</button>}
        {status === "surface" && solarSample && <button onClick={() => state.current?.ground.aimAt("earth")}>Face Earth</button>}
      </div>
      {status === "surface" && timeline.end > timeline.start && <div className="ground-time">
        <div className="time-controls">
          <span>Time <time>{new Date(timeline.cursor).toISOString().slice(0, 19).replace("T", " · ")} UTC</time></span>
          <TimePlayback {...timeline.playback}/>
        </div>
        <input aria-label="Time" className="science-cursor" type="range"
          min={timeline.ticks ? 0 : timeline.start} max={timeline.ticks ? timeline.ticks.length - 1 : timeline.end}
          step={timeline.ticks ? 1 : timeline.step} value={timeline.ticks ? timeline.index : timeline.cursor}
          onChange={event => {
            const value = Number(event.target.value);
            timeline.change(timeline.ticks ? timeline.ticks[value] : value);
          }}/>
      </div>}
      <span>
        {status === "loading" ? "Loading LOLA terrain…"
          : status === "error" ? "Terrain unavailable · Select Ground level to retry"
          : status === "surface" ? "2 m above surface · Drag to look · Scroll out to ascend"
          : terrainVisible ? `${altitude || "Approaching"} above surface · Scroll to adjust`
          : "Drag to rotate · Scroll to zoom"}
      </span>
    </div>
  </div>;
}

function ExposureBars({ result, duration }: { result: WindowExposure; duration: number }) {
  const values = [
    { label: "Sunlight", value: result.sunlightHours, tone: "sun" },
    { label: "Earth visibility", value: result.earthHours, tone: "earth" },
    { label: "Sun + Earth", value: result.simultaneousHours, tone: "both" },
    { label: "Longest dark", value: result.longestDarknessHours, tone: "dark" },
  ];
  return <span className="screening-metrics">
    {values.map(metric => <span className={`screening-metric ${metric.tone}`} key={metric.label}>
      <small>{metric.label}</small><strong>{fmt(metric.value)}</strong>
      <i><b style={{ width: `${Math.min(100, metric.value / duration * 100)}%` }}/></i>
    </span>)}
  </span>;
}

function ScreeningVerdict({ result, limit }: { result: WindowExposure; limit: number }) {
  const meets = meetsDarknessLimit(result, limit);
  return <span className={`screening-verdict ${meets ? "pass" : "fail"}`}>
    <i/>{meets ? "Shortlist" : result.unknownHours > 0 ? "Review" : `Review · >${fmt(limit)}`}
  </span>;
}

function SnapshotExposure({ sample }: { sample: VisibilitySample }) {
  return <div className="snapshot-exposure">
    <span><small>Sunlight</small><strong>{sample[1] >= sample[2] ? "Visible" : "Below terrain"}</strong></span>
    <span><small>Earth visibility</small><strong>{sample[4] >= sample[5] ? "Visible" : "Below terrain"}</strong></span>
    <StationBars mask={sample[6]}/>
  </div>;
}

function ExposureMetrics({ result, duration }: { result: WindowExposure; duration: number }) {
  return <div className="detail-metrics">
    <span className="sun"><small>Sunlight</small><strong>{fmt(result.sunlightHours)}</strong><em>{Math.round(result.sunlightHours / duration * 100)}% of mission</em></span>
    <span className="earth"><small>Earth visibility</small><strong>{fmt(result.earthHours)}</strong><em>{Math.round(result.earthHours / duration * 100)}% of mission</em></span>
    <span className="dark"><small>Longest darkness</small><strong>{fmt(result.longestDarknessHours)}</strong></span>
    <span className="both"><small>Sun + Earth</small><strong>{fmt(result.simultaneousHours)}</strong></span>
  </div>;
}

const dateInput = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 16);

export default function App({ initialIntroComplete = false, initialPose = null, onVisualReady }: { initialIntroComplete?: boolean; initialPose?: FlybyPose | null; onVisualReady?: () => void } = {}){
  const [phase, setPhase] = useState<Phase>("opening");
  const planning = phase === "planning";
  const [selected, setSelected] = useState<LocationId | null>(null);
  const [limitInput, setLimitInput] = useState("");
  const [cursor, setCursor] = useState(SOLAR_START);
  const [playing, setPlaying] = useState(false);
  const [method, setMethod] = useState(false);
  const [custom, setCustom] = useState<MissionSimulation | null>(null);
  const [mode, setMode] = useState<"static" | "dynamic">("dynamic");
  const [landingInput, setLandingInput] = useState(dateInput(SOLAR_START));
  const [endInput, setEndInput] = useState(dateInput(SOLAR_END));
  const [interval, setInterval] = useState("240");
  const [intervalUnit, setIntervalUnit] = useState<"seconds" | "hours" | "days">("seconds");
  const [windowStatus, setWindowStatus] = useState("");
  const [loadingWindow, setLoadingWindow] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  const [introComplete, setIntroComplete] = useState(initialIntroComplete);
  const [moonAvailable, setMoonAvailable] = useState<boolean | null>(null);
  const [showFlyby, setShowFlyby] = useState(!initialIntroComplete);
  const introFrame = useRef<HTMLIFrameElement>(null);
  const flybyPose = useRef<FlybyPose | null>(initialPose);
  const plannerHeading = useRef<HTMLHeadingElement>(null);
  const handleMoonReady = useCallback((available: boolean) => { setMoonAvailable(available); onVisualReady?.(); }, [onVisualReady]);
  const handleArrival = useCallback(() => setPhase("planning"), []);
  const heroReady = introComplete && (!showFlyby || moonAvailable === false);

  useEffect(() => {
    if (!moonAvailable) return;
    const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 520;
    const timer = window.setTimeout(() => setShowFlyby(false), duration);
    return () => window.clearTimeout(timer);
  }, [moonAvailable]);

  useEffect(() => {
    if (planning) plannerHeading.current?.focus({ preventScroll: true });
    if (planning) void ensureBrowserRuntime().catch(() => {});
  }, [planning]);
  useEffect(() => {
    const complete = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== introFrame.current?.contentWindow) return;
      if (event.data?.type === "earth-to-moon:pose") flybyPose.current = event.data.pose;
      if (event.data === "earth-to-moon:complete") setIntroComplete(true);
    };
    window.addEventListener("message", complete);
    return () => window.removeEventListener("message", complete);
  }, []);
  const info = custom ?? scenarioInfo("baseline");
  const { duration, start: missionStart, end: missionEnd } = info;
  const limit = limitInput.trim() === "" ? null : Number(limitInput);
  const staticResult = custom?.mode === "static";

  const applyWindow = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const start = new Date(landingInput + "Z");
    const end = mode === "static" ? start : new Date(endInput + "Z");
    const cadence = mode === "static" ? 240 : Number(interval) * { seconds: 1, hours: 3600, days: 86400 }[intervalUnit];
    if (!Number.isSafeInteger(cadence) || cadence < 1) {
      setWindowStatus("Enter an interval equal to at least one whole second.");
      return;
    }
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) ||
        (mode === "dynamic" && end <= start) || start.getTime() < KERNEL_START || end.getTime() > KERNEL_END) {
      setWindowStatus("Enter valid UTC dates. In Dynamic mode the end time must be later than the start.");
      return;
    }
    const steps = Math.ceil((end.getTime() - start.getTime()) / (1000 * cadence));
    if (steps + 1 > 4096) {
      setWindowStatus(`Increase the interval to at least ${Math.ceil((end.getTime() - start.getTime()) / 4095000)} seconds for this period.`);
      return;
    }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoadingWindow(true);
    setWindowStatus("");
    try {
      await ensureBrowserRuntime();
      const query = new URLSearchParams({ mode, start: start.toISOString(), end: end.toISOString(), interval: String(cadence) }).toString();
      const response = await fetch(`/api/mission-window?${query}`, { signal: controller.signal });
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("Unable to load the browser calculation engine. Reload AmTree and try again.");
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not calculate this simulation.");
      if (controller.signal.aborted) return;
      setCustom({ mode, start, end, duration: (end.getTime() - start.getTime()) / 3600000,
        cadence, query, results: payload.results, solar: payload.solar, details: payload.details });
      setCursor(start.getTime());
      setPlaying(false);
      setWindowStatus("Simulation complete. Select a location to see visibility and exports.");
    } catch (error) {
      if (!controller.signal.aborted) setWindowStatus(error instanceof Error ? error.message : "Could not calculate this simulation.");
    } finally {
      if (!controller.signal.aborted) setLoadingWindow(false);
    }
  };
  const reset = () => {
    requestRef.current?.abort();
    setSelected(null);
    setCustom(null);
    setMode("dynamic");
    setLandingInput(dateInput(SOLAR_START));
    setEndInput(dateInput(SOLAR_END));
    setInterval("240");
    setIntervalUnit("seconds");
    setLimitInput("");
    setCursor(SOLAR_START);
    setPlaying(false);
    setWindowStatus("");
    setLoadingWindow(false);
  };
  const scrollPanelTop=()=>requestAnimationFrame(()=>document.querySelector(".panel")?.scrollTo({top:0,behavior:"smooth"}));
  const choose=(id:LocationId)=>{setSelected(id);scrollPanelTop()};
  const showAllSites=()=>{setSelected(null);setPlaying(false);scrollPanelTop()};
  const selectedSite = SITES.find(site => site.id === selected);
  const selectedRegion = REGIONS.find(region => region.id === selected);
  const solarStart = missionStart.getTime();
  const solarEnd = missionEnd.getTime();
  const solarCursor = Math.min(solarEnd, Math.max(solarStart, cursor));
  useEffect(() => {
    if (!playing || solarEnd === solarStart) return;
    const samples = custom?.solar;
    const length = samples?.length ?? (Math.round((solarEnd - solarStart) / SOLAR_STEP) + 1);
    const stride = Math.max(1, Math.ceil((length - 1) / 120));
    const timer = window.setInterval(() => {
      setCursor(value => {
        if (!custom || !samples) return Math.min(value + stride * SOLAR_STEP, solarEnd);
        const index = Math.min(length - 1, Math.floor((value - solarStart) / (custom.cadence * 1000)) + stride);
        return solarStart + samples[index].offsetSeconds * 1000;
      });
    }, 180);
    return () => window.clearInterval(timer);
  }, [playing, selected, custom, solarStart, solarEnd]);
  useEffect(() => {
    if (playing && solarCursor >= solarEnd) setPlaying(false);
  }, [playing, solarCursor, solarEnd]);
  const playback = {
    playing,
    toggle: () => {
      if (!playing && solarCursor >= solarEnd) setCursor(solarStart);
      setPlaying(!playing);
    },
  };
  let sampleIndex = 0;
  if (custom && custom.solar.length > 1) {
    const offset = (solarCursor - solarStart) / 1000;
    const before = Math.min(Math.floor(offset / custom.cadence), custom.solar.length - 1);
    const after = Math.min(before + 1, custom.solar.length - 1);
    sampleIndex = offset - custom.solar[before].offsetSeconds <= custom.solar[after].offsetSeconds - offset ? before : after;
  }
  const solarSample = planning && selected ? (custom ? custom.solar[sampleIndex] : malapertSampleAt(solarCursor)) : null;
  const exposureAt = (location: (typeof LOCATIONS)[number]): WindowExposure => custom
    ? custom.results[location.id]
    : "analysisPointId" in location ? metrics(location.id, "baseline", limit ?? Infinity) : regionMetrics(location.id, "baseline");
  const locationDetails = (location: (typeof LOCATIONS)[number]) => <>
    {staticResult && custom ? <SnapshotExposure sample={custom.details[location.id].samples[0]}/> :
      <ExposureMetrics result={exposureAt(location)} duration={duration}/>}
    {custom ? <VisibilityGraph key={location.id} simulation={custom} siteId={location.id} sampleIndex={sampleIndex} playback={playback}
      onSelectSample={index => setCursor(solarStart + custom.solar[index].offsetSeconds * 1000)}/> :
      <section className="detail-section"><p>Run a simulation to view the Sun, Earth and DSN geometry at this location.</p></section>}
  </>;
  const locationRow = (location: (typeof LOCATIONS)[number]) => {
    const result = exposureAt(location);
    const region = "elevationM" in location;
    return <button className={`screening-row simulation-row ${region ? "region-row" : ""}`} key={location.id} onClick={() => choose(location.id)}>
      <span className="screening-name"><strong>{location.name}</strong><small>{location.latitude.toFixed(4)}° · {location.longitude.toFixed(4)}° E</small></span>
      {staticResult && custom ? <SnapshotExposure sample={custom.details[location.id].samples[0]}/> :
        <ExposureBars result={result} duration={duration}/>}
      {!staticResult && limit !== null && <ScreeningVerdict result={result} limit={limit}/>}
      <b className="screening-arrow" aria-hidden="true">↗</b>
    </button>;
  };
  const utc=(date:Date)=>date.toISOString().replace("T"," · ").slice(0,18)+" UTC";
  const stage = planning ? "planning" : `opening ${phase === "approach" ? "approach" : heroReady ? "intro-reveal" : "intro-running"}`;
  return <main className={stage}>
    <Moon phase={phase} introComplete={introComplete} flybyPose={flybyPose.current} onReady={handleMoonReady} onArrival={handleArrival} selected={selected} onSelect={choose} solarSample={solarSample} timeline={{ start: solarStart, end: solarEnd, cursor: solarCursor, step: SOLAR_STEP, index: sampleIndex, ticks: custom?.solar.map(sample => solarStart + sample.offsetSeconds * 1000), change: setCursor, playback }}/>
    {showFlyby&&!planning&&<iframe ref={introFrame} className={`opening-flight${moonAvailable ? " flight-finished" : ""}`} src={import.meta.env.BASE_URL + "intro/earth-to-moon/index.html"} title="Earth-to-Moon flyby" inert={moonAvailable === true} tabIndex={heroReady ? 0 : -1}/>}
    {SHOW_TRANSITION_LOGO && !planning && <div className={`transition-logo ${moonAvailable ? "fading" : ""}`} aria-hidden="true"><span className="navigator-logo"><img src={import.meta.env.BASE_URL + "assets/amtree-logo.svg"} alt=""/></span></div>}
    <header className={PERSISTENT_NAVBAR ? "persistent-navbar" : ""}><div className="brand">{planning || PERSISTENT_NAVBAR ? <span className="navigator-logo"><img src={import.meta.env.BASE_URL + "assets/amtree-logo.svg"} alt="AmTree"/></span> : <><span className="brand-mark">A</span><span>AmTree</span></>}</div>{planning&&<div className="header-actions"><span className="demo-badge real-data">LOLA terrain · SPICE ephemeris</span><button className="text-button" onClick={()=>setMethod(true)}>Team</button><button className="text-button" onClick={reset}>Reset</button></div>}</header>
    <section className="hero" inert={phase !== "opening" || !heroReady}><p className="eyebrow">AMTREE LUNAR NAVIGATOR</p><h1>Lunar Navigator</h1><p>Compare computed lighting and Earth visibility conditions at the lunar south pole.</p><button className="primary" onClick={()=>setPhase(moonAvailable ? "approach" : "planning")}>Plan a landing <span>→</span></button></section>
    {planning&&<section className="planner">
      <div className="map-caption"><span className="orbit-caption">NASA LRO imagery · LOLA 80 m polar relief</span><span className="surface-caption">NASA LOLA elevations · 30 m near field</span><strong>{selectedRegion?.name ?? selectedSite?.name ?? "South polar overview"}</strong></div>
      <aside className={`panel ${selected ? "site-detail-panel" : "screening-dashboard"}`}>
        {selectedRegion ? <>
          <div className="detail-nav"><button className="back" onClick={showAllSites}>← All locations</button></div>
          <div className="detail-hero">
            <div><p className="eyebrow">REGION CENTROID</p><h2>{selectedRegion.name}</h2>
              <p>{selectedRegion.latitude.toFixed(4)}° latitude · {selectedRegion.longitude.toFixed(4)}° east</p>
            </div>
            {!staticResult && limit !== null && <ScreeningVerdict result={exposureAt(selectedRegion)} limit={limit}/>}
          </div>
          <section className="detail-window region-elevation">
            <span><small>Elevation from supplied table</small><strong>{selectedRegion.elevationM.toFixed(3)} m</strong></span>
            <span><small>LOLA elevation at centroid</small><strong>{selectedRegion.terrainElevationM} m</strong></span>
          </section>
          {locationDetails(selectedRegion)}
          <LocationTimelapses siteId={selectedRegion.id} start={missionStart} end={missionEnd} simulation={custom}/>
        </> : !selectedSite ? <>
          <div className="ops-head"><div><p className="ops-path">Lunar south pole</p><h2 ref={plannerHeading} tabIndex={-1}>Lunar Landing Site Navigator</h2></div><a className="region-jump" href="#artemis-regions">Artemis III regions ↓</a></div>
          <section className="mission-console">
            <div className="console-head"><div><small>{custom ? "SIMULATION START" : "SAVED BASELINE"}</small><strong>{utc(missionStart)}</strong></div>
              {!staticResult && <><span>→</span><div><small>END</small><strong>{utc(missionEnd)}</strong></div></>}
            </div>
            <form className="simulation-form" onSubmit={applyWindow}>
              <fieldset className="simulation-modes">
                <legend>Simulation mode</legend>
                <label><input type="radio" name="simulation-mode" checked={mode === "static"} onChange={() => setMode("static")}/> <span>Static <small>One instant</small></span></label>
                <label><input type="radio" name="simulation-mode" checked={mode === "dynamic"} onChange={() => setMode("dynamic")}/> <span>Dynamic <small>Samples over time</small></span></label>
              </fieldset>
              <div className="simulation-fields">
                <label>{mode === "static" ? "Time (UTC)" : "Start time (UTC)"}
                  <input type="datetime-local" required step="1" value={landingInput}
                    min={dateInput(KERNEL_START)} max={dateInput(KERNEL_END)} onChange={event => setLandingInput(event.target.value)}/>
                </label>
                {mode === "dynamic" && <>
                  <label>End time (UTC)<input type="datetime-local" required step="1" value={endInput}
                    min={dateInput(KERNEL_START)} max={dateInput(KERNEL_END)} onChange={event => setEndInput(event.target.value)}/></label>
                  <div className="sample-interval">
                    <label>Sample interval<input type="number" required step="any" min="0"
                      value={interval} onChange={event => setInterval(event.target.value)}/></label>
                    <label>Unit<select aria-label="Sample interval unit" value={intervalUnit} onChange={event => setIntervalUnit(event.target.value as typeof intervalUnit)}>
                      <option value="days">Days</option><option value="hours">Hours</option><option value="seconds">Seconds</option>
                    </select></label>
                  </div>
                  <label>Darkness limit (hours, optional)<input type="number" min="0" max="24" step="any"
                    value={limitInput} placeholder="0–24" onChange={event => {
                      const value = event.target.value;
                      setLimitInput(value === "" ? "" : String(Math.min(24, Math.max(0, Number(value)))));
                    }}/></label>
                </>}
              </div>
              <button className="run-simulation" type="submit" disabled={loadingWindow}>{loadingWindow ? "Simulating…" : "Run simulation"}</button>
              <p role="status">{windowStatus}</p>
            </form>
          </section>
          <DecisionDashboard simulation={custom} index={sampleIndex} playback={playback} onTime={index => custom && setCursor(solarStart + custom.solar[index].offsetSeconds * 1000)} onSelect={choose}/>
          <div className="screening-head"><div><h3>Study points</h3></div><span>{staticResult ? "Snapshot visibility" : "Mission exposure"}</span></div>
          <div className="screening-list">{SITES.map(locationRow)}</div>
          <div className="screening-head"><div><h3 id="artemis-regions" tabIndex={-1}>Artemis III regions</h3></div><span>{staticResult ? "Snapshot visibility" : "Mission exposure at region centers"}</span></div>
          <div className="screening-list">{REGIONS.map(locationRow)}</div>
        </>:<>
          <div className="detail-nav"><button className="back" onClick={showAllSites}>← All locations</button><span>{selectedSite.id}</span></div>
          <div className="detail-hero"><div><p className="eyebrow">STUDY POINT</p><h2>{selectedSite.name}</h2>
            <p>{selectedSite.latitude}° latitude · {selectedSite.longitude}° east</p></div>
            {!staticResult && limit !== null && <ScreeningVerdict result={exposureAt(selectedSite)} limit={limit}/>}
          </div>
          {locationDetails(selectedSite)}
          <LocationTimelapses siteId={selectedSite.id} start={missionStart} end={missionEnd} simulation={custom}/>
        </>}
      </aside>
    </section>}
    {method && <div className="modal" role="dialog" aria-modal="true" aria-label="AmTree team">
      <button className="modal-close" onClick={() => setMethod(false)}>Close</button>
      <h2>Team AmTree</h2>
      <p>AmTree was created for the NASA Space Apps Challenge 2026 hackathon in Milan.</p>
      <ul><li>Alvise Vivian</li><li>Daniel Matthew Panganiban</li><li>Ahmet Orhun Sivaslı</li><li>Mustapha Bouhka</li><li>Mohamed Nassiri</li></ul>
      <img className="challenge-logo" src={import.meta.env.BASE_URL + "assets/nasa-space-apps-milano-2026.png"} alt="NASA Space Apps Milano" />
    </div>}
  </main>;
}
