import * as THREE from "three";
import { EARTH_ATMOSPHERE_RADIUS, earthAppearance } from "./earthAppearance";
import { LOCATIONS, type LocationId } from "./sites";
import type { GroundSolarSample } from "./simulation";

const radius = 1_737_400;
const globeRadius = 1.561;
const globeScale = globeRadius / radius;
const departure = 580_000;
const eyeHeight = 2;
const sunDistance = 150_000;
const grids = [
  { step: 600, extent: 108_000 },
  { step: 120, extent: 18_000 },
  { step: 30, extent: 3_600 },
];

export type GroundStatus = "idle" | "loading" | "descending" | "surface" | "ascending" | "returning" | "error";
type Site = (typeof LOCATIONS)[number];

function frameFor(site: Site) {
  const lat = THREE.MathUtils.degToRad(site.latitude);
  const lon = THREE.MathUtils.degToRad(site.longitude);
  const up = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
  const east = new THREE.Vector3(-Math.sin(lon), 0, -Math.cos(lon));
  const south = new THREE.Vector3().crossVectors(east, up);
  const rho = 2 * radius * Math.tan((Math.PI / 2 + lat) / 2);
  return { up, east, south, x: rho * Math.sin(lon), y: rho * Math.cos(lon) };
}

function firstHeading(positions: Float32Array, n: number, step: number, longitude: number) {
  const lon = THREE.MathUtils.degToRad(longitude);
  const center = (n - 1) / 2;
  let score = -Infinity;
  let heading = 0;
  for (let angle = 0; angle < 2 * Math.PI; angle += Math.PI / 36) {
    let near = -Infinity;
    let far = -Infinity;
    for (let distance = 90; distance <= 3200; distance += 60) {
      const x = Math.round(center + Math.sin(angle + lon) * distance / step);
      const y = Math.round(center + Math.cos(angle + lon) * distance / step);
      const index = (y * n + x) * 3;
      const slope = (positions[index + 1] - eyeHeight) / Math.hypot(positions[index], positions[index + 2]);
      if (distance <= 510) near = Math.max(near, slope);
      else far = Math.max(far, slope);
    }
    // At eye level, favour a view past near slopes toward more distant relief.
    const viewScore = Math.min(.16, far - near) - Math.max(0, near) * 2 + Math.min(.035, far) * .25;
    if (viewScore > score) {
      score = viewScore;
      heading = angle;
    }
  }
  return heading;
}

function addSurfaceShading(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 groundXZ;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\ngroundXZ = position.xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec2 groundXZ;
        float groundHash(vec2 p) {
          vec3 h = fract(vec3(p.xyx) * 0.1031);
          h += dot(h, h.yzx + 33.33);
          return fract((h.x + h.y) * h.z);
        }
        float groundNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float noise = mix(mix(groundHash(i), groundHash(i + vec2(1, 0)), f.x),
                            mix(groundHash(i + vec2(0, 1)), groundHash(i + 1.0), f.x), f.y);
          return (noise - 0.5) * (1.0 - smoothstep(0.4, 1.8, length(fwidth(p))));
        }`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        diffuseColor.rgb *= 1.0 + 0.22 * groundNoise(groundXZ * 0.044)
                                + 0.18 * groundNoise(groundXZ * 0.55)
                                + 0.24 * groundNoise(groundXZ * 6.0);`);
  };
}

function terrainFor(site: Site, bytes: ArrayBuffer, material: THREE.MeshStandardMaterial) {
  const side = ({ step, extent }: (typeof grids)[number]) => 2 * extent / step + 1;
  const counts = grids.map(grid => side(grid) ** 2);
  if (bytes.byteLength !== 2 * counts.reduce((sum, count) => sum + count, 0)) {
    throw new Error("Unexpected elevation tile size");
  }
  const data = new DataView(bytes);
  const height = (index: number) => data.getInt16(index * 2, true);
  const originHeight = height(counts[0] + counts[1] + (counts[2] - 1) / 2);
  const frame = frameFor(site);
  const point = new THREE.Vector3();
  const group = new THREE.Group();
  let offset = 0;
  let heading = 0;
  let previous: { positions: Float32Array; n: number; step: number; extent: number } | undefined;

  for (const [level, grid] of grids.entries()) {
    const { step, extent } = grid;
    const n = side(grid);
    const inner = grids[level + 1]?.extent ?? 0;
    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 4);
    const indices: number[] = [];

    for (let row = 0; row < n; row++) {
      const dy = row * step - extent;
      const y = frame.y + dy;
      for (let col = 0; col < n; col++) {
        const dx = col * step - extent;
        const x = frame.x + dx;
        const i = row * n + col;
        const k = i * 3;
        // Inverse south-polar stereographic projection, then rotate into local east/up/south.
        const t = (x * x + y * y) / (4 * radius * radius);
        const r = radius + height(offset + i);
        point.set(y / radius, t - 1, -x / radius).multiplyScalar(r / (1 + t));
        positions[k] = point.dot(frame.east);
        positions[k + 1] = point.dot(frame.up) - radius - originHeight;
        positions[k + 2] = point.dot(frame.south);

        const edge = extent - Math.max(Math.abs(dx), Math.abs(dy));
        if (previous && edge < previous.step * 2) {
          // Snap each fine edge to the surrounding mesh and soften the change in sampling.
          const u = (dx + previous.extent) / previous.step;
          const v = (dy + previous.extent) / previous.step;
          const a = Math.floor(u);
          const b = Math.floor(v);
          const blend = 1 - THREE.MathUtils.smoothstep(edge, 0, previous.step * 2);
          for (let axis = 0; axis < 3; axis++) {
            const p = (i: number, j: number) => previous!.positions[(j * previous!.n + i) * 3 + axis];
            const top = THREE.MathUtils.lerp(p(a, b), p(a + 1, b), u - a);
            const bottom = THREE.MathUtils.lerp(p(a, b + 1), p(a + 1, b + 1), u - a);
            positions[k + axis] = THREE.MathUtils.lerp(positions[k + axis], THREE.MathUtils.lerp(top, bottom, v - b), blend);
          }
        }
        const gray = THREE.MathUtils.clamp(.76 + (height(offset + i) - originHeight) / 18000, .58, .96);
        colors.set([gray, gray, gray, level ? 1 : THREE.MathUtils.smoothstep(edge, 0, 24_000)], i * 4);

        if (row === n - 1 || col === n - 1) continue;
        if (Math.abs(dx + step / 2) < inner && Math.abs(dy + step / 2) < inner) continue;
        indices.push(i, i + 1, i + n, i + 1, i + n + 1, i + n);
      }
    }

    if (level === grids.length - 1) heading = firstHeading(positions, n, step, site.longitude);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = level;
    group.add(mesh);
    previous = { positions, n, step, extent };
    offset += counts[level];
  }
  return { group, frame, heading };
}

export class GroundFlight {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(43.1, 1, .3, 170_000);
  private material = new THREE.MeshStandardMaterial({
    color: 0x96928d, vertexColors: true, roughness: 1, transparent: true, depthWrite: true,
  });
  private sunlight = new THREE.DirectionalLight(0xfff4e4, 2.9);
  private fill = new THREE.HemisphereLight(0xe7efff, 0x464044, .88);
  private earthDirection = new THREE.Vector3();
  private earth = new THREE.Mesh(
    new THREE.PlaneGeometry(EARTH_ATMOSPHERE_RADIUS * 2, EARTH_ATMOSPHERE_RADIUS * 2),
    earthAppearance(),
  );
  private earthReady = false;
  private disposed = false;
  private sunDirection = new THREE.Vector3();
  private solarSample: GroundSolarSample | null = null;
  private surfaceSunlight = 1;
  private facing: "sun" | "earth" | null = null;
  private sun = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { cutoff: { value: -2 } },
    vertexShader: `
      varying vec2 disk;
      void main() {
        disk = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec2 disk;
      uniform float cutoff;
      void main() {
        float edge = max(length(disk) - 1.0, cutoff - disk.y);
        float aa = max(fwidth(edge), 0.001);
        float alpha = 1.0 - smoothstep(-aa, aa, edge);
        gl_FragColor = vec4(1.0, 0.97, 0.87, alpha);
        #include <colorspace_fragment>
      }`,
  }));
  private abort = new AbortController();
  private cache = new Map<LocationId, Promise<ArrayBuffer>>();
  private wanted: LocationId | null = null;
  private tile: (ReturnType<typeof terrainFor> & { id: LocationId }) | null = null;
  private status: GroundStatus = "idle";
  private logAltitude = Math.log(departure);
  private targetAltitude = this.logAltitude;
  private lastFrame = 0;
  private heading = 0;
  private pitch = -.075;
  private view = new THREE.Quaternion();
  private startRotation = new THREE.Quaternion();
  private siteRotation = new THREE.Quaternion();
  private globeBasis = new THREE.Matrix4();
  private globeView = new THREE.Quaternion();
  private position = new THREE.Vector3();
  private rotation = new THREE.Quaternion();
  private altitudeLabel = "";
  private coverage = 0;

  constructor(private onStatus: (status: GroundStatus, altitude: string) => void) {
    addSurfaceShading(this.material);
    this.sunlight.position.set(-1, .36, -1.35);
    this.sun.visible = false;
    this.sun.renderOrder = 8;
    this.earth.visible = false;
    this.earth.renderOrder = 7;
    const loader = new THREE.TextureLoader();
    const introAssets = import.meta.env.BASE_URL + "intro/earth-to-moon/assets/";
    const loadEarthMap = (name: "earthMap" | "cloudMap", path: string) => {
      loader.load(introAssets + path, texture => {
        if (this.disposed) {
          texture.dispose();
          return;
        }
        texture.wrapS = THREE.RepeatWrapping;
        this.earth.material.uniforms[name].value = texture;
        this.earthReady = !!this.earth.material.uniforms.earthMap.value && !!this.earth.material.uniforms.cloudMap.value;
      });
    };
    loadEarthMap("earthMap", "earth.jpg");
    loadEarthMap("cloudMap", "clouds.jpg");
    this.scene.add(this.sunlight, this.fill, this.sun, this.earth);
  }

  get busy() { return this.wanted !== null || this.tile !== null; }
  get looking() { return this.tile !== null && Math.exp(this.logAltitude) < 2200; }
  get markerOpacity() {
    return this.tile ? THREE.MathUtils.smoothstep(Math.exp(this.logAltitude), 135_000, 280_000) : 1;
  }

  private report(status: GroundStatus, altitude = "") {
    if (status === this.status && altitude === this.altitudeLabel) return;
    this.status = status;
    this.altitudeLabel = altitude;
    this.onStatus(status, altitude);
  }

  private read(id: LocationId) {
    const pending = this.cache.get(id);
    if (pending) return pending;
    const request = fetch(`${import.meta.env.BASE_URL}science/ground/${id}.bin`, { signal: this.abort.signal }).then(response => {
      if (!response.ok) throw new Error("Elevation tile unavailable");
      return response.arrayBuffer();
    });
    this.cache.set(id, request);
    void request.catch(() => this.cache.delete(id));
    return request;
  }

  preload(id: LocationId) { void this.read(id).catch(() => {}); }

  descend(id: LocationId, auto: boolean, rotation: THREE.Quaternion) {
    if (this.tile) {
      if (this.tile.id !== id) return;
      this.wanted = id;
      this.targetAltitude = Math.log(eyeHeight);
      return;
    }
    if (this.wanted === id) {
      if (auto) this.targetAltitude = Math.log(eyeHeight);
      return;
    }
    const site = LOCATIONS.find(point => point.id === id);
    if (!site) return;
    this.wanted = id;
    this.startRotation.copy(rotation);
    this.targetAltitude = Math.log(auto ? eyeHeight : 240_000);
    this.report("loading");
    void this.read(id).then(bytes => {
      if (this.wanted !== id || this.abort.signal.aborted || this.tile) return;
      this.tile = { ...terrainFor(site, bytes, this.material), id };
      this.scene.add(this.tile.group);
      this.siteRotation.setFromUnitVectors(this.tile.frame.up, new THREE.Vector3(0, -.14, 1).normalize());
      this.logAltitude = Math.log(departure);
      this.heading = this.tile.heading;
      this.pitch = -.075;
      this.report("descending");
    }).catch(() => {
      if (this.wanted !== id || this.abort.signal.aborted) return;
      this.wanted = null;
      this.report("error");
    });
  }

  ascend() {
    this.wanted = null;
    this.targetAltitude = Math.log(departure);
    if (this.tile) this.report("returning", this.altitudeLabel);
    else this.report("idle");
  }

  zoom(delta: number, selected: LocationId | null) {
    if (!this.wanted) {
      if (delta >= 0 || !this.tile || this.tile.id !== selected) return;
      this.wanted = this.tile.id;
    }
    this.targetAltitude = THREE.MathUtils.clamp(this.targetAltitude + delta * .008, Math.log(eyeHeight), Math.log(departure));
    if (this.targetAltitude >= Math.log(departure)) this.ascend();
  }

  private setSolarSample(sample: GroundSolarSample | null) {
    if (!this.tile || sample === this.solarSample) return;
    this.solarSample = sample;
    if (!sample) {
      this.sun.visible = false;
      this.earth.visible = false;
      this.facing = null;
      this.sunlight.position.set(-1, .36, -1.35);
      this.sunlight.intensity = 2.9;
      this.fill.intensity = .88;
      return;
    }

    if (this.tile.id === "Site23" && "sun_azimuth_deg" in sample) {
      const azimuth = THREE.MathUtils.degToRad(sample.sun_azimuth_deg);
      const elevation = THREE.MathUtils.degToRad(sample.sun_elevation_deg);
      this.sunDirection.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation));
      this.surfaceSunlight = sample.sun_disk_fraction_visible;
    } else {
      const [x, y, z] = "direction" in sample ? sample.direction : sample.sun_direction_moon_me;
      const moonDirection = new THREE.Vector3(x, z, -y);
      const { east, up, south } = this.tile.frame;
      this.sunDirection.set(moonDirection.dot(east), moonDirection.dot(up), moonDirection.dot(south)).normalize();
      const ray = new THREE.Raycaster(new THREE.Vector3(0, eyeHeight, 0), this.sunDirection);
      this.surfaceSunlight = ray.intersectObject(this.tile.group, true).length ? 0 : 1;
    }
    this.updateEarth(sample);
    this.sunlight.position.copy(this.sunDirection);
    const angularRadius = "radiusDeg" in sample ? sample.radiusDeg : sample.sun_angular_radius_deg;
    this.sun.scale.setScalar(sunDistance * Math.tan(THREE.MathUtils.degToRad(angularRadius)));
  }

  private updateEarth(sample: GroundSolarSample) {
    if (!this.tile) return;
    const live = "earthDirection" in sample;
    const direction = live ? sample.earthDirection : sample.earth_direction_moon_me;
    if (!direction) {
      this.earthDirection.set(0, 0, 0);
      return;
    }
    const { east, up, south } = this.tile.frame;
    const local = ([x, y, z]: number[]) => {
      const globeDirection = new THREE.Vector3(x, z, -y);
      return new THREE.Vector3(globeDirection.dot(east), globeDirection.dot(up), globeDirection.dot(south));
    };
    const angular = THREE.MathUtils.degToRad(live ? sample.earthRadiusDeg : sample.earth_angular_radius_deg);
    const distance = 6_378_137 / Math.sin(angular);
    this.earthDirection.copy(local(direction).normalize().multiplyScalar(distance));
    this.earthDirection.y -= radius + eyeHeight;
    this.earth.scale.setScalar(sunDistance * 6_378_137 / this.earthDirection.length());
    this.earthDirection.normalize();
    const pole = local(live ? sample.earthNorth : [0, 0, 1]).normalize();
    const prime = local(live ? sample.earthPrime : [1, 0, 0]).normalize();
    const uniforms = this.earth.material.uniforms;
    uniforms.east.value.crossVectors(pole, prime).normalize();
    uniforms.pole.value.copy(pole);
    uniforms.prime.value.copy(prime);
    uniforms.light.value.copy(this.sunDirection);
  }

  aimAt(body: "sun" | "earth") { this.facing = body; }

  look(dx: number, dy: number) {
    this.facing = null;
    this.heading -= dx * .0045;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * .0045, -1.35, 1.05);
  }

  update(now: number, globe: THREE.PerspectiveCamera, moon: THREE.Group, reducedMotion: boolean, sample: GroundSolarSample | null) {
    const dt = Math.min((now - this.lastFrame) / 1000, .05);
    this.lastFrame = now;
    if (!this.tile) return;
    if (globe.near !== .012) {
      globe.near = .012;
      globe.updateProjectionMatrix();
    }

    const gap = this.targetAltitude - this.logAltitude;
    // Limit speed in log altitude so a direct descent still passes through the approach.
    const maxMove = dt * 4.9;
    this.logAltitude += reducedMotion ? gap : THREE.MathUtils.clamp(gap * (1 - Math.exp(-dt * 11)), -maxMove, maxMove);
    if (Math.abs(this.targetAltitude - this.logAltitude) < .003) this.logAltitude = this.targetAltitude;
    const altitude = Math.exp(this.logAltitude);
    if (this.logAltitude === Math.log(departure)) {
      globe.near = .1;
      globe.updateProjectionMatrix();
      this.clearTile();
      this.report("idle");
      return;
    }

    const { up, east, south } = this.tile.frame;
    const alignment = 1 - THREE.MathUtils.smoothstep(this.logAltitude, Math.log(155_000), Math.log(departure));
    this.rotation.slerpQuaternions(this.startRotation, this.siteRotation, alignment);
    moon.quaternion.copy(this.rotation);
    this.setSolarSample(sample);
    if (sample && this.facing) {
      const direction = this.facing === "earth" ? this.earthDirection : this.sunDirection;
      const azimuth = Math.atan2(direction.x, -direction.z);
      const delta = Math.atan2(Math.sin(azimuth - this.heading), Math.cos(azimuth - this.heading));
      const follow = reducedMotion ? 1 : 1 - Math.exp(-dt * 9);
      this.heading += delta * follow;
      this.pitch = THREE.MathUtils.lerp(this.pitch, Math.asin(direction.y), follow);
    }
    const tilt = 1 - THREE.MathUtils.smoothstep(this.logAltitude, Math.log(8), Math.log(3200));
    const pitch = THREE.MathUtils.lerp(-Math.PI / 2 + .004, this.pitch, tilt);
    const heading = this.heading;
    this.camera.position.set(0, altitude, 0);
    this.camera.lookAt(
      Math.sin(heading) * Math.cos(pitch),
      altitude + Math.sin(pitch),
      -Math.cos(heading) * Math.cos(pitch),
    );

    if (sample) {
      const eyeLevel = this.tile.id === "Site23" && altitude <= eyeHeight + .01 && "sun_azimuth_deg" in sample;
      const direct = THREE.MathUtils.lerp(this.surfaceSunlight, 1, THREE.MathUtils.smoothstep(altitude, eyeHeight, 3500));
      this.sunlight.intensity = 2.9 * direct;
      this.fill.intensity = THREE.MathUtils.lerp(.18, .65, direct);
      this.sun.visible = altitude < 3500 && (!eyeLevel || this.surfaceSunlight > 0);
      this.sun.position.copy(this.camera.position).addScaledVector(this.sunDirection, sunDistance);
      this.sun.lookAt(this.camera.position);
      this.earth.visible = this.earthReady && altitude < 3500 && this.earthDirection.lengthSq() > 0;
      this.earth.position.copy(this.camera.position).addScaledVector(this.earthDirection, sunDistance);
      this.earth.lookAt(this.camera.position);
      // The modeled horizon is calibrated at the 2 m study point. Higher views use mesh depth.
      this.sun.material.depthTest = !eyeLevel;
      this.sun.material.uniforms.cutoff.value = eyeLevel && this.surfaceSunlight < 1
        ? (sample.horizon_elevation_at_sun_deg - sample.sun_elevation_deg) / sample.sun_angular_radius_deg : -2;
    }

    this.globeBasis.makeBasis(east, up, south);
    this.globeView.setFromRotationMatrix(this.globeBasis).premultiply(this.rotation);
    this.view.copy(this.camera.quaternion).premultiply(this.globeView);
    this.position.copy(up).multiplyScalar(globeRadius + altitude * globeScale).applyQuaternion(this.rotation);
    globe.position.lerp(this.position, alignment);
    globe.quaternion.slerp(this.view, alignment);

    this.coverage = 1 - THREE.MathUtils.smoothstep(altitude, 19_000, 89_000);
    this.material.opacity = this.coverage;
    if (this.camera.aspect !== globe.aspect || this.camera.fov !== globe.fov) {
      this.camera.aspect = globe.aspect;
      this.camera.fov = globe.fov;
      this.camera.updateProjectionMatrix();
    }

    const label = altitude >= 1000 ? `${(altitude / 1000).toFixed(altitude < 10_000 ? 1 : 0)} km` : `${Math.round(altitude)} m`;
    const status = !this.wanted ? "returning"
      : Math.abs(altitude - eyeHeight) < .01 ? "surface"
      : gap > .003 ? "ascending" : "descending";
    this.report(status, label);
  }

  render(renderer: THREE.WebGLRenderer, globeScene: THREE.Scene, globeCamera: THREE.PerspectiveCamera) {
    if (this.coverage < 1) renderer.render(globeScene, globeCamera);
    else renderer.clear();
    if (this.coverage <= 0) return;
    renderer.clearDepth();
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }

  private clearTile() {
    if (!this.tile) return;
    this.scene.remove(this.tile.group);
    this.tile.group.children.forEach(mesh => (mesh as THREE.Mesh).geometry.dispose());
    this.tile = null;
    this.solarSample = null;
    this.facing = null;
    this.sun.visible = false;
    this.earth.visible = false;
    this.sunlight.position.set(-1, .36, -1.35);
    this.sunlight.intensity = 2.9;
    this.fill.intensity = .88;
    this.coverage = 0;
  }

  dispose() {
    this.disposed = true;
    this.abort.abort();
    this.clearTile();
    this.material.dispose();
    this.sun.geometry.dispose();
    this.sun.material.dispose();
    this.earth.material.uniforms.earthMap.value?.dispose();
    this.earth.material.uniforms.cloudMap.value?.dispose();
    this.earth.material.dispose();
    this.earth.geometry.dispose();
  }
}
