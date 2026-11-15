(() => {
  "use strict";

  const vertex = `
    attribute vec2 corner;
    void main() { gl_Position = vec4(corner, 0.0, 1.0); }
  `;
  const fragment = `
    precision highp float;
    uniform vec2 screen;
    uniform vec3 eye, forward, right, up, moonCenter;
    uniform vec2 lens;
    uniform float moonRadius;
    uniform vec3 earthPose, moonPose;
    uniform float sceneTime;
    uniform sampler2D earthMap, cloudMap, moonMap, reliefMap;

    const float PI = 3.14159265359;
    const float polarRatio = 0.99665;
    const float cloudRadius = 1.012;
    const float atmosphereRadius = 1.075;
    const vec3 sun = vec3(-0.478, 0.518, 0.709);

    float noise(vec2 cell) {
      vec3 n = fract(vec3(cell.xyx) * .1031);
      n += dot(n, n.yzx + 33.33);
      return fract((n.x + n.y) * n.z);
    }
    vec3 starLayer(vec2 point, float cellSize, float density) {
      vec2 grid = point / cellSize;
      vec2 cell = floor(grid);
      if (noise(cell) < density) return vec3(0.);
      vec2 center = .13 + .74 * vec2(noise(cell + 49.), noise(cell - 71.));
      float size = mix(.45, 1.30, pow(noise(cell + 16.), 3.));
      float spot = exp(-3.3 * pow(length((fract(grid) - center) * cellSize) / size, 2.));
      vec3 tint = mix(vec3(.54, .69, 1.), vec3(1., .91, .78), noise(cell + 4.));
      return tint * spot * mix(.20, .76, pow(noise(cell + 9.), 2.));
    }

    vec3 tilt(vec3 n, vec3 pose) {
      float c = cos(pose.z), s = sin(pose.z);
      n.xy = mat2(c, s, -s, c) * n.xy;
      c = cos(pose.y); s = sin(pose.y);
      n.yz = mat2(c, -s, s, c) * n.yz;
      return n;
    }
    vec2 uvAt(vec3 n, vec3 pose) {
      vec3 t = tilt(n, pose);
      float longitude = atan(t.x, t.z) + pose.x;
      return vec2(fract(.5 + longitude / (2. * PI)), .5 - asin(clamp(t.y, -1., 1.)) / PI);
    }
    float cloud(vec2 uv) {
      float longitude = uv.x * 2. * PI;
      float latitude = uv.y * PI;
      // Different wind speeds at different latitudes shear the cloud bands.
      float wind = .0024 + .0016 * sin(3. * latitude);
      vec2 drift = vec2(sceneTime * wind, .004 * sin(3. * longitude - .7 * sceneTime) * sin(latitude));
      vec2 lowUV = uv + drift;
      vec2 highUV = uv + drift * 1.65 + vec2(.023, .013);
      float weather = texture2D(cloudMap, lowUV).r;
      float wisps = texture2D(cloudMap, highUV).r;
      float variation = .5 + .5 * sin(4. * longitude + 7. * latitude - .9 * sceneTime);
      return smoothstep(.025, .68, weather + wisps * (.14 + .18 * variation));
    }
    vec3 earthShape(vec3 p, vec3 axis) {
      return p + dot(p, axis) * axis * (1. / polarRatio - 1.);
    }
    vec3 earthNormal(vec3 p, vec3 axis) {
      return normalize(p + dot(p, axis) * axis * (1. / (polarRatio * polarRatio) - 1.));
    }
    vec3 intersectEarth(vec3 ray, vec3 axis) {
      vec3 origin = earthShape(eye, axis);
      vec3 direction = earthShape(ray, axis);
      float speed = length(direction);
      direction /= speed;
      float along = -dot(origin, direction);
      float closest = length(origin + direction * along);
      return vec3(closest, along, speed);
    }
    float earthDepth(vec3 hit, float radius) {
      return (hit.y - sqrt(max(0., radius * radius - hit.x * hit.x))) / hit.z;
    }
    vec2 cloudUV(vec3 p, vec3 axis) {
      return uvAt(normalize(earthShape(p, axis)), earthPose);
    }
    vec3 earthColor(vec3 point, vec3 normal, vec3 view, vec3 axis) {
      vec3 surface = texture2D(earthMap, cloudUV(point, axis), 1.75).rgb;
      float oceanMask = smoothstep(.03, .20, surface.b - surface.r);
      surface = mix(surface, vec3(.055, .13, .21), oceanMask * .22);
      float luminance = dot(surface, vec3(.2126, .7152, .0722));
      surface = mix(vec3(luminance), surface, .83);
      float light = dot(normal, sun);
      float daylight = smoothstep(-.075, .20, light);
      float lambert = max(0., light);

      float shadowDistance = cloudRadius * cloudRadius - 1.;
      float shadowLength = sqrt(lambert * lambert + shadowDistance) - lambert;
      float shadow = cloud(cloudUV(point + shadowLength * sun, axis)) * .30;
      float ocean = smoothstep(.04, .23, surface.b - surface.r) * (1. - smoothstep(.32, .54, surface.r));
      float reflected = max(0., dot(normal, normalize(sun + view)));
      float glint = pow(reflected, 95.) * .28 + pow(reflected, 30.) * .095;

      vec3 color = surface * (1. - shadow) * (.027 + daylight * (.42 + .71 * pow(lambert, .65)));
      color += vec3(.69, .76, .83) * glint * ocean;
      // Scatter light below the cloud deck to soften land and water first.
      float grazing = 1. - max(0., dot(normal, view));
      float lowHaze = .51 + .24 * grazing;
      vec3 blueHaze = vec3(.29, .44, .62) * daylight * (.68 + .32 * lambert);
      return mix(color, blueHaze, lowHaze * smoothstep(-.12, .09, light));
    }

    vec3 earthWithClouds(vec3 ray, vec3 hit, vec3 axis, vec3 color, float groundMask, float pixelScale) {
      if (groundMask > 0.) {
        vec3 point = eye + ray * earthDepth(hit, 1.);
        color = mix(color, earthColor(point, earthNormal(point, axis), -ray, axis), groundMask);
      }
      float cloudMask = 1. - smoothstep(cloudRadius - pixelScale, cloudRadius + pixelScale, hit.x);
      if (cloudMask > 0.) {
        vec3 point = eye + ray * earthDepth(hit, cloudRadius);
        vec3 normal = earthNormal(point, axis);
        float sunlight = dot(normal, sun);
        float day = smoothstep(-.08, .16, sunlight);
        float rim = pow(1. - max(0., dot(normal, -ray)), 2.5);
        vec3 lighting = vec3(.94, .95, .98) * (.017 + day * (.43 + .58 * max(0., sunlight)));
        lighting += vec3(.10, .16, .22) * rim * day;
        color = mix(color, lighting, cloud(cloudUV(point, axis)) * cloudMask * .91);
      }
      return color;
    }
    vec3 scatterAtmosphere(vec3 color, vec3 ray, vec3 hit, vec3 axis) {
      float altitude = max(0., hit.x - 1.);
      float halfChord = sqrt(max(0., atmosphereRadius * atmosphereRadius - hit.x * hit.x));
      float nearShell = hit.y - halfChord;
      float farShell = hit.y + halfChord;
      if (hit.x < 1.) farShell = hit.y - sqrt(1. - hit.x * hit.x);
      float path = max(0., farShell - max(0., nearShell));
      vec3 lightingPoint = normalize(eye + ray * (.5 * (nearShell + farShell) / hit.z));
      float sunHeight = dot(earthNormal(lightingPoint, axis), sun);
      float daylight = smoothstep(-.19, .56, sunHeight);
      float column = exp(-altitude * 90.) * path / (1. + 2. * path);
      float opacity = (1. - exp(-7.6 * column)) * (.02 + .98 * daylight);
      float limb = smoothstep(.72, 1., hit.x);
      vec3 blue = mix(vec3(.34, .46, .60), vec3(.59, .72, .84), limb);
      float halo = exp(-altitude * 62.) * smoothstep(0., .30, path);
      return mix(color, blue, opacity) + vec3(.14, .21, .30) * halo * daylight * limb * .20;
    }

    vec3 aurora(vec3 ray, vec3 hit, vec3 axis) {
      const float shell = 1.053;
      if (hit.x >= shell) return vec3(0.);
      float nearDepth = earthDepth(hit, shell);
      float farDepth = hit.x < cloudRadius ? earthDepth(hit, cloudRadius) : 2. * hit.y / hit.z - nearDepth;
      vec3 magneticAxis = normalize(axis + vec3(.10, .02, -.25));
      vec3 magneticEast = normalize(cross(magneticAxis, vec3(0., 0., 1.)));
      vec3 magneticNorth = cross(magneticEast, magneticAxis);
      float stepSize = (farDepth - nearDepth) / 8.;
      vec3 emission = vec3(0.);
      for (int i = 0; i < 8; i++) {
        vec3 point = earthShape(eye + ray * (nearDepth + (float(i) + .5) * stepSize), axis);
        float altitude = length(point) - 1.;
        vec3 n = normalize(point);
        float pole = dot(n, magneticAxis);
        float latitude = abs(pole);
        if (latitude < .76 || latitude > .98) continue;
        float longitude = atan(dot(n, magneticEast), dot(n, magneticNorth));
        float phase = longitude + .53 * sign(pole);
        float fold = .015 * sin(3. * phase + .28 * sceneTime)
          + .010 * sin(7. * phase - .38 * sceneTime) + .004 * sin(14. * phase);
        float oval = pole > 0. ? .892 : .822;
        float offset = latitude - oval - fold + .42 * (altitude - .021);
        float ribbon = exp(-pow(abs(offset) / .008, 2.));
        ribbon += .30 * exp(-pow(abs(offset - .017) / .011, 2.));
        float ripples = .75 + .25 * sin(36. * phase + 1.8 * sin(9. * phase) - .75 * sceneTime);
        float breaks = .22 + .78 * smoothstep(-.63, .53, sin(2. * phase - .26 * sceneTime) + .45 * sin(5. * phase));
        float height = .034 + .013 * (.5 + .5 * sin(9. * phase + sceneTime * .4));
        float vertical = smoothstep(.012, .019, altitude) * (1. - smoothstep(.022, height, altitude));
        float sunlight = dot(n, sun);
        float twilight = (1. - smoothstep(-.08, .35, sunlight)) * (.45 + .55 * smoothstep(-.72, -.23, sunlight));
        vec3 tint = mix(vec3(.07, .77, .36), vec3(.23, .58, .52), smoothstep(.022, .046, altitude));
        emission += tint * ribbon * ripples * breaks * vertical * (.10 + .90 * twilight);
      }
      return (1. - exp(-emission * stepSize * 34.)) * .68;
    }

    vec3 moonColor(vec3 n) {
      vec2 uv = uvAt(n, moonPose);
      float base = texture2D(reliefMap, uv).r;
      vec3 tangent = normalize(vec3(n.z, 0., -n.x) + vec3(.00001, 0., 0.));
      vec3 bitangent = cross(n, tangent);
      float dx = texture2D(reliefMap, uvAt(normalize(n + .007 * tangent), moonPose)).r - base;
      float dy = texture2D(reliefMap, uvAt(normalize(n + .007 * bitangent), moonPose)).r - base;
      vec3 texturedNormal = normalize(n - 1.3 * (dx * tangent + dy * bitangent));
      float exposure = dot(texturedNormal, sun);
      float light = smoothstep(-.07, .19, exposure);
      vec3 albedo = texture2D(moonMap, uv).rgb;
      return albedo * vec3(1., .985, .968) * (.028 + light * (.36 + .79 * pow(max(exposure, 0.), .62)));
    }

    vec3 intersection(vec3 direction, vec3 center, float radius) {
      vec3 toCenter = center - eye;
      float projected = dot(toCenter, direction);
      vec3 offset = toCenter - projected * direction;
      float closest = length(offset);
      float depth = projected - sqrt(max(0., radius * radius - closest * closest));
      return vec3(depth, closest, projected);
    }

    void main() {
      vec2 pixel = (2. * gl_FragCoord.xy / screen - 1.) * lens;
      vec3 ray = normalize(forward + pixel.x * right + pixel.y * up);
      vec2 sky = vec2(atan(ray.x, -ray.z), asin(ray.y)) * 1180.;
      vec3 color = starLayer(sky + 11., 36., .39) + starLayer(sky - 129., 74., .45) * .48;
      float pixelAngle = 2. * lens.y / screen.y;

      vec3 axis = normalize(vec3(.1275, .979, .1595));
      vec3 ground = intersectEarth(ray, axis);
      float groundDepth = earthDepth(ground, 1.);
      vec3 lunar = intersection(ray, moonCenter, moonRadius);
      float groundEdge = max(ground.y, .001) * pixelAngle;
      float lunarEdge = max(lunar.z, .001) * pixelAngle;
      float groundMask = (1. - smoothstep(1. - groundEdge, 1. + groundEdge, ground.x)) * step(0., groundDepth);
      float lunarMask = (1. - smoothstep(moonRadius - lunarEdge, moonRadius + lunarEdge, lunar.y)) * step(0., lunar.x);

      if (lunarMask > 0. && (groundMask < 1. || lunar.x < groundDepth)) {
        vec3 surface = normalize(eye + ray * lunar.x - moonCenter);
        color = mix(color, moonColor(surface), lunarMask);
      }
      if (ground.y > 0. && ground.x < atmosphereRadius && (lunarMask < 1. || groundDepth < lunar.x)) {
        color = earthWithClouds(ray, ground, axis, color, groundMask, groundEdge);
        color = scatterAtmosphere(color, ray, ground, axis);
        color += aurora(ray, ground, axis);
      }
      gl_FragColor = vec4(color, 1.);
    }
  `;

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not load " + url));
      image.src = url;
    });
  }

  async function create(canvas) {
    const gl = canvas.getContext("webgl", {
      alpha: false, antialias: false, depth: false, powerPreference: "high-performance"
    });
    if (!gl) throw new Error("WebGL is unavailable");

    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const corner = gl.getAttribLocation(program, "corner");
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

    const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const assets = [
      ["earthMap", "earth.jpg"], ["cloudMap", "clouds.jpg"],
      ["moonMap", "moon.jpg?v=wac"], ["reliefMap", "moon-height.jpg"]
    ];
    const imagery = await Promise.all(assets.map(([, file]) => loadImage("assets/" + file)));
    imagery.forEach((image, index) => {
      let source = image;
      if (image.width > maxSize || image.height > maxSize) {
        source = document.createElement("canvas");
        source.width = maxSize;
        source.height = Math.round(maxSize * image.height / image.width);
        source.getContext("2d").drawImage(image, 0, 0, source.width, source.height);
      }
      const texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.uniform1i(gl.getUniformLocation(program, assets[index][0]), index);
    });

    const uniforms = {};
    for (const name of ["screen", "eye", "forward", "right", "up", "moonCenter", "moonRadius", "lens", "earthPose", "moonPose", "sceneTime"]) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }

    return function draw(frame) {
      const { width, height } = frame;
      const ratio = Math.min(devicePixelRatio || 1, 1.65, Math.sqrt(2200000 / (width * height)));
      const w = Math.round(width * ratio);
      const h = Math.round(height * ratio);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uniforms.screen, w, h);
      for (const name of ["eye", "forward", "right", "up", "moonCenter"]) {
        gl.uniform3fv(uniforms[name], frame[name]);
      }
      gl.uniform2fv(uniforms.lens, frame.lens);
      gl.uniform1f(uniforms.moonRadius, frame.moonRadius);
      gl.uniform3f(uniforms.earthPose, frame.earthLongitude, .16, -.13);
      gl.uniform3f(uniforms.moonPose, frame.moonLongitude, frame.moonLatitude, .17);
      gl.uniform1f(uniforms.sceneTime, frame.sceneTime);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
  }

  window.createPlanetRenderer = create;
})();

