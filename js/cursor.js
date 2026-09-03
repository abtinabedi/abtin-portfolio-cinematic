/* Glow cursor trail.

   Ported from the React Bits <GlowCursor /> component. The fragment shader is
   kept as it was written; what changed is the plumbing around it. The original
   leans on React for the lifecycle and on `ogl` for a renderer, a program and a
   fullscreen triangle — this site has neither, and pulling in a framework plus a
   WebGL library to draw one quad would cost more than the effect. So the ~60
   lines of raw WebGL that ogl was wrapping are written out below instead, and
   the whole thing runs off one fixed, full-viewport canvas that follows the
   window pointer rather than a React-managed container.

   Colours come from the site palette: emerald at the head, cream into the tail.
   Brightness and opacity are dialled below the component's demo defaults so the
   trail reads as an accent over the content rather than a light show on top of
   it. */

(() => {
  "use strict";

  /* A pointer trail is meaningless without a pointer, and unwelcome for anyone
     who has asked the browser to calm down. Bail before touching the GPU. */
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

  const MAX_POINTS = 64;

  const CONFIG = {
    color: "#19c98c",           // emerald, at the bright head
    secondaryColor: "#f2ede3",  // cream, blended into the tail
    /* Shorter, tighter and dimmer than the component's demo defaults. At the
       demo values the trail streaks the full width of the viewport and washes
       out any heading it crosses, which on a page this type-heavy costs more
       than it adds. */
    trailLength: 26,
    trailWidth: 6,
    trailTaper: 0.95,
    followSpeed: 0.24,
    glowIntensity: 1.25,
    glowSpread: 0.85,
    hotspot: 0.4,
    brightness: 0.85,
    opacity: 0.62,
    pulseSpeed: 1.1,
    noiseStrength: 0.035,
    idleTimeout: 700,
    fadeDuration: 900,
    maxDevicePixelRatio: 1.25,
  };

  /* ---------- shaders ---------- */

  const VERTEX_SHADER = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

  const FRAGMENT_SHADER = `
precision highp float;

#define MAX_POINTS 64

uniform vec2 uResolution;
uniform vec2 uPoints[MAX_POINTS];
uniform float uPointCount;
uniform vec3 uColor;
uniform vec3 uSecondaryColor;
uniform float uTrailWidth;
uniform float uTaper;
uniform float uGlowIntensity;
uniform float uGlowSpread;
uniform float uHotspot;
uniform float uBrightness;
uniform float uOpacity;
uniform float uPulseSpeed;
uniform float uNoiseStrength;
uniform float uTime;
uniform float uFade;

varying vec2 vUv;

float sRGB(float x) {
  if (x <= 0.00031308) return 12.92 * x;
  return 1.055 * pow(x, 1.0 / 2.4) - 0.055;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float filmGrain(vec2 p, float time) {
  float frame = time * 18.0;
  float frameIndex = mod(floor(frame), 256.0);
  float nextFrameIndex = mod(frameIndex + 1.0, 256.0);
  float blend = fract(frame);
  blend = blend * blend * (3.0 - 2.0 * blend);
  vec2 pixel = floor(p);
  float current = hash(pixel + vec2(frameIndex * 17.0, frameIndex * 31.0));
  float next = hash(pixel + vec2(nextFrameIndex * 17.0, nextFrameIndex * 31.0));
  return mix(current, next, blend) * 2.0 - 1.0;
}

void main() {
  vec2 pixel = vUv * uResolution;
  float denominator = max(uPointCount - 1.0, 1.0);
  float strongest = 0.0;
  float strongestCore = 0.0;
  float colorWeight = 0.0;
  vec3 colorSum = vec3(0.0);

  for (int i = 0; i < MAX_POINTS - 1; i++) {
    float index = float(i);
    float active = 1.0 - step(uPointCount - 1.0, index);
    vec2 start = uPoints[i];
    vec2 end = uPoints[i + 1];
    vec2 toPixel = pixel - start;
    vec2 segment = end - start;
    float along = clamp(dot(toPixel, segment) / max(dot(segment, segment), 0.0001), 0.0, 1.0);
    float progress = clamp((index + along) / denominator, 0.0, 1.0);
    float life = pow(max(1.0 - progress, 0.0), mix(0.55, 1.25, uTaper));
    float width = uTrailWidth * mix(1.0, 0.25, pow(progress, mix(0.55, 1.6, uTaper)));
    float distanceToTrail = length(toPixel - segment * along);
    float falloff = max(width * (0.8 + uGlowSpread * 1.4), 0.5);
    float beam = min(1.0, (falloff * falloff) / (distanceToTrail * distanceToTrail + falloff * falloff));
    float core = exp(-pow(distanceToTrail / max(width, 0.5), 2.0) * 2.5);
    float pulseAmount = min(abs(uPulseSpeed), 1.0);
    float pulse = 1.0 + sin(uTime * uPulseSpeed * 3.0 - progress * 11.0) * 0.16 * pulseAmount;
    float intensity = (core + beam * uGlowIntensity * 0.55) * life * pulse * active;
    vec3 segmentColor = mix(uColor, uSecondaryColor, progress);

    strongest = max(strongest, intensity);
    strongestCore = max(strongestCore, core * life * active);
    colorSum += segmentColor * intensity;
    colorWeight += intensity;
  }

  float grain = filmGrain(pixel, uTime);
  float noiseAmount = (1.0 - exp(-uNoiseStrength * 2.2)) * 0.4;
  float alpha = clamp(strongest * uOpacity * uFade, 0.0, 1.0);
  if (alpha < 0.0005) discard;

  vec3 color = colorSum / max(colorWeight, 0.0001);
  color = mix(color, vec3(1.0), smoothstep(0.25, 0.95, strongestCore) * uHotspot);
  float luminance = sRGB(clamp(strongest * uBrightness, 0.0, 1.0));
  luminance *= 1.0 + grain * noiseAmount;
  gl_FragColor = vec4(color * luminance, alpha);
}
`;

  /* ---------- helpers ---------- */

  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

  const hexToRgb = (hex) => {
    let value = (hex || "").replace("#", "").trim();
    if (value.length === 3) value = value.split("").map((c) => c + c).join("");
    const parsed = Number.parseInt(value || "000000", 16);
    return [((parsed >> 16) & 255) / 255, ((parsed >> 8) & 255) / 255, (parsed & 255) / 255];
  };

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  /* ---------- boot ---------- */

  const canvas = document.createElement("canvas");
  canvas.className = "cursor-glow";
  canvas.setAttribute("aria-hidden", "true");

  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl) return; // no WebGL: the site is fine without the trail

  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = vs && fs && gl.createProgram();
  if (!program) return;

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;

  document.body.appendChild(canvas);
  gl.useProgram(program);

  // one oversized triangle covers the viewport with no index buffer
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 0, 0, 3, -1, 2, 0, -1, 3, 0, 2]),
    gl.STATIC_DRAW
  );

  const stride = 4 * 4;
  const aPosition = gl.getAttribLocation(program, "position");
  const aUv = gl.getAttribLocation(program, "uv");
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, stride, 8);

  const u = {};
  for (const name of [
    "uResolution", "uPoints", "uPointCount", "uColor", "uSecondaryColor",
    "uTrailWidth", "uTaper", "uGlowIntensity", "uGlowSpread", "uHotspot",
    "uBrightness", "uOpacity", "uPulseSpeed", "uNoiseStrength", "uTime", "uFade",
  ]) {
    u[name] = gl.getUniformLocation(program, name);
  }

  // everything that never changes at runtime is set once
  gl.uniform1f(u.uPointCount, clamp(Math.round(CONFIG.trailLength), 2, MAX_POINTS));
  gl.uniform3fv(u.uColor, hexToRgb(CONFIG.color));
  gl.uniform3fv(u.uSecondaryColor, hexToRgb(CONFIG.secondaryColor));
  gl.uniform1f(u.uTrailWidth, Math.max(CONFIG.trailWidth, 0.1));
  gl.uniform1f(u.uTaper, clamp(CONFIG.trailTaper, 0, 1));
  gl.uniform1f(u.uGlowIntensity, Math.max(CONFIG.glowIntensity, 0));
  gl.uniform1f(u.uGlowSpread, Math.max(CONFIG.glowSpread, 0));
  gl.uniform1f(u.uHotspot, clamp(CONFIG.hotspot, 0, 1));
  gl.uniform1f(u.uBrightness, Math.max(CONFIG.brightness, 0));
  gl.uniform1f(u.uOpacity, clamp(CONFIG.opacity, 0, 1));
  gl.uniform1f(u.uPulseSpeed, CONFIG.pulseSpeed);
  gl.uniform1f(u.uNoiseStrength, clamp(CONFIG.noiseStrength, 0, 1));

  gl.clearColor(0, 0, 0, 0);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  /* ---------- state ---------- */

  const pointData = new Float32Array(MAX_POINTS * 2);
  const points = Array.from({ length: MAX_POINTS }, () => ({ x: 0, y: 0 }));
  const target = { x: 0, y: 0 };
  const head = { x: 0, y: 0 };

  let width = 1;
  let height = 1;
  let initialized = false;
  let pointerInside = false;
  let fade = 0;
  let idle = false;
  let lastInputTime = performance.now();
  let lastFrameTime = performance.now();

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxDevicePixelRatio);
    width = Math.max(window.innerWidth, 1);
    height = Math.max(window.innerHeight, 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(u.uResolution, width, height);
  }

  function seed(x, y) {
    target.x = head.x = x;
    target.y = head.y = y;
    for (const p of points) {
      p.x = x;
      p.y = y;
    }
    initialized = true;
    fade = 1;
  }

  // the shader works in pixels with the origin bottom-left, the pointer does not
  function onPointerMove(event) {
    const x = clamp(event.clientX, 0, width);
    const y = clamp(height - event.clientY, 0, height);
    if (!initialized) seed(x, y);
    target.x = x;
    target.y = y;
    pointerInside = true;
    lastInputTime = performance.now();
  }

  function onPointerLeave() {
    pointerInside = false;
    lastInputTime = performance.now();
  }

  /* ---------- loop ---------- */

  function render(now) {
    requestAnimationFrame(render);

    const delta = Math.min((now - lastFrameTime) / 16.667, 3);
    lastFrameTime = now;

    if (initialized) {
      const headEase = 1 - Math.pow(1 - clamp(CONFIG.followSpeed, 0.01, 0.99), delta);
      const chainBase = clamp(0.28 + CONFIG.followSpeed * 0.35, 0.08, 0.92);
      const chainEase = 1 - Math.pow(1 - chainBase, delta);

      head.x += (target.x - head.x) * headEase;
      head.y += (target.y - head.y) * headEase;
      points[0].x = head.x;
      points[0].y = head.y;

      for (let i = 1; i < MAX_POINTS; i++) {
        points[i].x += (points[i - 1].x - points[i].x) * chainEase;
        points[i].y += (points[i - 1].y - points[i].y) * chainEase;
      }
      for (let i = 0; i < MAX_POINTS; i++) {
        pointData[i * 2] = points[i].x;
        pointData[i * 2 + 1] = points[i].y;
      }
    }

    const idleFor = now - lastInputTime;
    const shouldFade = !pointerInside || idleFor > CONFIG.idleTimeout;
    const fadeStep = (16.667 * delta) / Math.max(CONFIG.fadeDuration, 16);
    const fadeTarget = initialized && !shouldFade ? 1 : 0;
    fade += (fadeTarget - fade) * Math.min(1, fadeStep * 7);

    // faded out and standing still: nothing to draw, so skip the GPU entirely.
    // The attribute is only touched on the transition, never per frame.
    if (fade < 0.001 && fadeTarget === 0) {
      if (!idle) {
        idle = true;
        gl.clear(gl.COLOR_BUFFER_BIT);
        canvas.dataset.idle = "1";
      }
      return;
    }
    if (idle) {
      idle = false;
      canvas.dataset.idle = "0";
    }

    gl.uniform2fv(u.uPoints, pointData);
    gl.uniform1f(u.uTime, now * 0.001);
    gl.uniform1f(u.uFade, fade);

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("pointerleave", onPointerLeave);
  window.addEventListener("blur", onPointerLeave);
  requestAnimationFrame(render);
})();
