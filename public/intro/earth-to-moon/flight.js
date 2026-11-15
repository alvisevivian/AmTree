(() => {
  "use strict";

  const stage = document.querySelector(".stage");
  const canvas = document.getElementById("space");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const stills = {
    earth: document.getElementById("earth-still"),
    moon: document.getElementById("moon-still")
  };

  const duration = 7000;
  const openingHold = 500;
  const ease = (t) => t * t * (3 - 2 * t);

  const earthCenter = [0, 0, 0];
  const moonCenter = [10, .48, -2.6];
  const moonRadius = 1737.4 / 6371;


  const add = (a, b) => a.map((value, i) => value + b[i]);
  const subtract = (a, b) => a.map((value, i) => value - b[i]);
  const scale = (vector, amount) => vector.map((value) => value * amount);
  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  const length = (vector) => Math.hypot(...vector);
  const normalize = (vector) => scale(vector, 1 / length(vector));
  const cross = ([ax, ay, az], [bx, by, bz]) => [ay*bz - az*by, az*bx - ax*bz, ax*by - ay*bx];
  const mix = (a, b, t) => add(scale(a, 1 - t), scale(b, t));
  const ramp = (from, to, value) => ease(Math.max(0, Math.min(1, (value - from) / (to - from))));

  const sunDirection = normalize([-.478, .518, .709]);
  const worldUp = [0, 1, 0];
  const side = normalize(cross(worldUp, sunDirection));
  const startView = normalize(add(add(scale(sunDirection, .6), scale(side, .8)), scale(worldUp, .18)));
  const startPosition = scale(startView, 3.7);
  const endView = normalize(add(add(scale(sunDirection, .55), scale(normalize(moonCenter), -.45)), scale(worldUp, .28)));
  const endPosition = add(moonCenter, scale(endView, 1.35));
  const travelAxis = subtract(endPosition, startPosition);
  const outward = normalize(cross(worldUp, travelAxis));
  const controlPosition = add(add(mix(startPosition, endPosition, .5), scale(outward, -9.0)), scale(worldUp, 2.0));
  const startRight = normalize(cross(worldUp, startView));
  const endRight = normalize(cross(scale(endView, -1), worldUp));

  function camera(t, width, height) {
    const eye = mix(mix(startPosition, controlPosition, t), mix(controlPosition, endPosition, t), t);
    const aspect = width / height;
    const portrait = 1 - ramp(.63, 1.1, aspect);
    const startLook = scale(startRight, -.65 * (1 - portrait));
    const endLook = add(moonCenter, scale(endRight, -.16 * (1 - portrait)));
    const target = mix(startLook, endLook, ease(t));
    const forward = normalize(subtract(target, eye));
    const baseline = normalize(cross(forward, [0, 1, 0]));
    const vertical = normalize(cross(baseline, forward));
    const roll = 0;
    const right = add(scale(baseline, Math.cos(roll)), scale(vertical, Math.sin(roll)));
    const up = normalize(cross(right, forward));

    const focal = Math.tan(19 * Math.PI / 180);
    const lens = [focal * Math.max(aspect, 1), focal * Math.max(1 / aspect, 1)];
    return { width, height, eye, forward, right, up, lens, moonCenter, moonRadius };
  }

  function drawStills(frame) {
    for (const [image, center, radius] of [
      [stills.earth, earthCenter, 1], [stills.moon, moonCenter, moonRadius]
    ]) {
      const offset = subtract(center, frame.eye);
      const depth = dot(offset, frame.forward);
      image.hidden = depth <= 0;
      if (depth <= 0) continue;
      const x = .5 + dot(offset, frame.right) / (2 * frame.lens[0] * depth);
      const y = .5 - dot(offset, frame.up) / (2 * frame.lens[1] * depth);
      const normalizedRadius = radius / Math.sqrt(Math.max(.001, depth ** 2 - radius ** 2));
      image.style.left = x * frame.width + "px";
      image.style.top = y * frame.height + "px";
      image.style.width = 1.10 * normalizedRadius * frame.width / frame.lens[0] + "px";
    }
  }

  let draw;
  let started = false;
  let lastTime;
  let elapsed = 0;
  let playing = false;
  let moonLongitude = .21;
  let moonLatitude = .075;
  let currentFrame;
  let drag;
  let hoverPoint;

  function isOverMoon({ x, y }) {
    if (!draw || !currentFrame) return false;
    const { eye, forward, up, right, lens } = currentFrame;
    const bounds = canvas.getBoundingClientRect();
    const sx = (2 * (x - bounds.left) / bounds.width - 1) * lens[0];
    const sy = (1 - 2 * (y - bounds.top) / bounds.height) * lens[1];
    const ray = normalize(add(forward, add(scale(right, sx), scale(up, sy))));
    const offset = subtract(moonCenter, eye);
    const depth = dot(offset, ray);
    return depth > 0 && length(subtract(offset, scale(ray, depth))) <= moonRadius;
  }

  function rotateMoon(dx, dy) {
    moonLongitude = (moonLongitude - dx) % (2 * Math.PI);
    moonLatitude = Math.max(-1.25, Math.min(1.25, moonLatitude + dy));
    requestFrame();
  }

  function updateDragCursor() {
    canvas.classList.toggle("moon-hover", !!hoverPoint && isOverMoon(hoverPoint));
  }
  let pendingFrame = 0;

  function requestFrame() {
    if (!pendingFrame) pendingFrame = requestAnimationFrame(render);
  }

  function render(now) {
    pendingFrame = 0;
    const delta = lastTime === undefined ? 0 : Math.min(now - lastTime, 100);
    lastTime = now;
    if (playing) elapsed = Math.min(openingHold + duration, elapsed + delta);
    const linear = Math.max(0, (elapsed - openingHold) / duration);
    const progress = motion.matches ? Number(linear === 1) : ease(linear);
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;

    const frame = camera(progress, width, height);
    currentFrame = frame;
    updateDragCursor();
    if (draw) {
      draw({
        ...frame,
        earthLongitude: -.345 + progress * .34,
        moonLongitude,
        moonLatitude,
        sceneTime: elapsed / 1000
      });
    } else drawStills(frame);
    if (linear === 1 && window.parent !== window) {
      window.parent.postMessage({
        type: "earth-to-moon:pose",
        pose: { ...frame, moonLongitude, moonLatitude },
      }, window.location.origin);
    }
    if (linear === 1 && playing) {
      playing = false;
      if (window.parent !== window) {
        window.parent.postMessage("earth-to-moon:complete", window.location.origin);
      }
    }
    if (playing) requestFrame();
  }

  function begin() {
    if (started) return;
    started = true;
    if (motion.matches && window.parent !== window) elapsed = openingHold + duration;
    playing = true;
    requestFrame();
  }

  function prepareScene() {
    window.createPlanetRenderer(canvas).then((renderer) => {
      draw = renderer;
      stage.classList.add("ready");
      begin();
      requestFrame();
    }).catch(() => begin());
  }
  canvas.addEventListener("pointerdown", (event) => {
    const point = { x: event.clientX, y: event.clientY };
    if (drag || event.button !== 0 || !isOverMoon(point)) return;
    drag = { id: event.pointerId, ...point };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("moon-dragging");
  });
  canvas.addEventListener("pointermove", (event) => {
    hoverPoint = event.pointerType === "mouse" ? { x: event.clientX, y: event.clientY } : undefined;
    updateDragCursor();
    if (drag?.id !== event.pointerId) return;
    const speed = 3.6 / Math.min(currentFrame.width, currentFrame.height);
    rotateMoon((event.clientX - drag.x) * speed, (event.clientY - drag.y) * speed);
    drag.x = event.clientX;
    drag.y = event.clientY;
  });
  canvas.addEventListener("pointerleave", () => {
    hoverPoint = undefined;
    updateDragCursor();
  });
  canvas.addEventListener("lostpointercapture", () => {
    drag = undefined;
    canvas.classList.remove("moon-dragging");
    updateDragCursor();
  });
  const arrowRotation = { ArrowLeft: [-.12, 0], ArrowRight: [.12, 0], ArrowUp: [0, -.12], ArrowDown: [0, .12] };
  canvas.addEventListener("keydown", (event) => {
    if (!draw || !arrowRotation[event.key]) return;
    event.preventDefault();
    rotateMoon(...arrowRotation[event.key]);
  });
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    draw = undefined;
    stage.classList.remove("ready");
    requestFrame();
  });
  canvas.addEventListener("webglcontextrestored", prepareScene);
  document.addEventListener("visibilitychange", () => {
    lastTime = undefined;
    if (!document.hidden) requestFrame();
  });
  new ResizeObserver(requestFrame).observe(stage);
  motion.addEventListener("change", requestFrame);
  requestFrame();
  prepareScene();
  setTimeout(begin, 2500);
})();

