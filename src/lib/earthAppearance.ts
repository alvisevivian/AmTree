import * as THREE from "three";

export const EARTH_ATMOSPHERE_RADIUS = 1.075;

export function earthAppearance() {
  const uniforms = {
    light: { value: new THREE.Vector3() },
    east: { value: new THREE.Vector3() },
    prime: { value: new THREE.Vector3() },
    pole: { value: new THREE.Vector3() },
    earthMap: { value: null as THREE.Texture | null },
    cloudMap: { value: null as THREE.Texture | null },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    vertexShader: `
      varying vec2 disk;
      varying vec3 skyRight, skyUp, towardEye;
      void main() {
        disk = position.xy;
        skyRight = normalize(modelMatrix[0].xyz);
        skyUp = normalize(modelMatrix[1].xyz);
        towardEye = normalize(modelMatrix[2].xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 light, east, prime, pole;
      uniform sampler2D earthMap, cloudMap;
      varying vec2 disk;
      varying vec3 skyRight, skyUp, towardEye;
      const float pi = 3.14159265359;
      const float atmosphereRadius = ${EARTH_ATMOSPHERE_RADIUS};
      const float cloudRadius = 1.012;

      vec2 surfaceUV(vec3 p) {
        vec3 n = normalize(p);
        return vec2(fract(.5 + atan(dot(n, east), dot(n, prime)) / (2. * pi)),
          .5 + asin(clamp(dot(n, pole), -1., 1.)) / pi);
      }

      float cloud(vec3 p) {
        vec2 uv = surfaceUV(p);
        float weather = texture2D(cloudMap, uv).r;
        float wisps = texture2D(cloudMap, uv + vec2(.023, .013)).r;
        float variation = .5 + .5 * sin(8. * pi * uv.x + 7. * pi * (1. - uv.y));
        return smoothstep(.025, .68, weather + wisps * (.14 + .18 * variation));
      }

      // Match the opening flyby's surface haze, cloud tint and atmospheric scattering.
      void main() {
        vec3 view = normalize(towardEye);
        vec3 p = skyRight * disk.x + skyUp * disk.y;
        float impact = length(disk);
        if (impact >= atmosphereRadius) discard;
        float aa = max(.001, .55 * fwidth(impact));
        float surfaceMask = 1. - smoothstep(1. - aa, 1. + aa, impact);
        vec3 point = p + view * sqrt(max(0., 1. - impact * impact));
        vec3 normal = normalize(point);
        vec3 surface = texture2D(earthMap, surfaceUV(point), 1.75).rgb;
        float oceanMask = smoothstep(.03, .20, surface.b - surface.r);
        surface = mix(surface, vec3(.055, .13, .21), oceanMask * .22);
        surface = mix(vec3(dot(surface, vec3(.2126, .7152, .0722))), surface, .83);
        float altitudeOfSun = dot(normal, light);
        float daylight = smoothstep(-.075, .20, altitudeOfSun);
        float lambert = max(0., altitudeOfSun);
        float shadowLength = sqrt(lambert * lambert + cloudRadius * cloudRadius - 1.) - lambert;
        float shadow = cloud(point + shadowLength * light) * .30;
        float ocean = smoothstep(.04, .23, surface.b - surface.r) * (1. - smoothstep(.32, .54, surface.r));
        float reflected = max(0., dot(normal, normalize(light + view + vec3(1.e-6))));
        float glint = pow(reflected, 95.) * .28 + pow(reflected, 30.) * .095;
        vec3 color = surface * (1. - shadow) * (.027 + daylight * (.42 + .71 * pow(lambert, .65)));
        color += vec3(.69, .76, .83) * glint * ocean;
        float grazing = 1. - max(0., dot(normal, view));
        float lowHaze = .51 + .24 * grazing;
        vec3 blueHaze = vec3(.29, .44, .62) * daylight * (.68 + .32 * lambert);
        color = mix(color, blueHaze, lowHaze * smoothstep(-.12, .09, altitudeOfSun)) * surfaceMask;

        float cloudMask = 1. - smoothstep(cloudRadius - aa, cloudRadius + aa, impact);
        vec3 cloudPoint = p + view * sqrt(max(0., cloudRadius * cloudRadius - impact * impact));
        vec3 cloudNormal = normalize(cloudPoint);
        float cloudSun = dot(cloudNormal, light);
        float cloudDay = smoothstep(-.08, .16, cloudSun);
        float rim = pow(1. - max(0., dot(cloudNormal, view)), 2.5);
        vec3 cloudTint = vec3(.94, .95, .98) * (.017 + cloudDay * (.43 + .58 * max(0., cloudSun)));
        cloudTint += vec3(.10, .16, .22) * rim * cloudDay;
        float cloudOpacity = cloud(cloudPoint) * cloudMask * .91;
        color = mix(color, cloudTint, cloudOpacity);
        float alpha = mix(surfaceMask, 1., cloudOpacity);

        float altitude = max(0., impact - 1.);
        float nearShell = sqrt(max(0., atmosphereRadius * atmosphereRadius - impact * impact));
        float farShell = impact < 1. ? sqrt(1. - impact * impact) : -nearShell;
        float path = nearShell - farShell;
        float sunHeight = dot(normalize(p + view * (.5 * (nearShell + farShell))), light);
        float shellDay = smoothstep(-.19, .56, sunHeight);
        float column = exp(-altitude * 90.) * path / (1. + 2. * path);
        float opacity = (1. - exp(-7.6 * column)) * (.02 + .98 * shellDay);
        float limb = smoothstep(.72, 1., impact);
        vec3 blue = mix(vec3(.34, .46, .60), vec3(.59, .72, .84), limb);
        float halo = exp(-altitude * 62.) * smoothstep(0., .30, path);
        color = mix(color, blue, opacity) + vec3(.14, .21, .30) * halo * shellDay * limb * .20;
        alpha = max(mix(alpha, 1., opacity), length(color) * .6);
        gl_FragColor = vec4(color / max(alpha, 1.e-5), alpha);
      }`,
  });
}
