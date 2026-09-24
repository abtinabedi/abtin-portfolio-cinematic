/* Abtin Abedi portfolio
   One rAF loop drives Lenis, the hero frame scrub and the pinned sections.
   No scroll event listeners, no per-frame layout reads. */

(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const $ = (sel) => document.querySelector(sel);

  const canvas = $("#hero-canvas");
  const ctx = canvas.getContext("2d");
  const heroSection = $("#hero");
  const lineA = $(".hero__line--a");
  const lineB = $(".hero__line--b");
  const heroTitle = $(".hero__title");
  const heroBar = $("#hero-progress-bar");
  const pillarsSection = $("#pillars");
  const pillars = [...document.querySelectorAll(".pillar")];
  const railFill = $("#pillars-rail-fill");
  const preloaderPct = $("#preloader-pct");
  const tiltCard = $(".work__all");

  const FRAMES_DIR = "assets/frames/hero/";

  const state = {
    frames: [],
    frameCount: 0,
    current: 0,
    target: 0,
    drawnIndex: -1,
    heroTop: 0,
    heroRange: 1,
    pillarsTop: 0,
    pillarsRange: 1,
    pillarIndex: -1,
    pillarBlur: -1,
    lastScroll: -1,
    vw: window.innerWidth,
    vh: window.innerHeight,
    needsDraw: true,
  };

  /* ---------- layout metrics (recomputed on resize only) ---------- */

  function measure() {
    state.vw = window.innerWidth;
    state.vh = window.innerHeight;

    const scroll = window.scrollY;
    const heroRect = heroSection.getBoundingClientRect();
    state.heroTop = heroRect.top + scroll;
    state.heroRange = Math.max(1, heroSection.offsetHeight - state.vh);

    const pillarsRect = pillarsSection.getBoundingClientRect();
    state.pillarsTop = pillarsRect.top + scroll;
    state.pillarsRange = Math.max(1, pillarsSection.offsetHeight - state.vh);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(state.vw * dpr);
    canvas.height = Math.round(state.vh * dpr);
    state.needsDraw = true;
  }

  /* ---------- canvas ---------- */

  const isReady = (img) => img && img.complete && img.naturalWidth;

  function drawFrame(index) {
    // Frames past the preloader gate stream in behind the page. Until the exact
    // one arrives, hold the nearest earlier frame and keep asking on each tick.
    let i = index;
    while (i > 0 && !isReady(state.frames[i])) i--;
    const img = state.frames[i];
    if (!isReady(img)) return;

    const cw = canvas.width;
    const ch = canvas.height;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const scale = Math.max(cw / iw, ch / ih);
    const dw = iw * scale;
    const dh = ih * scale;

    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    state.drawnIndex = i;
    state.needsDraw = i !== index;
  }

  /* ---------- preload ---------- */

  function frameSrc(i) {
    return FRAMES_DIR + "frame_" + String(i + 1).padStart(4, "0") + ".webp";
  }

  // The curtain lifts once this many frames are in, not all of them: the rest
  // load in order behind the page, well ahead of anyone scrolling to them.
  const PRELOAD_GATE = 24;

  async function preload() {
    const res = await fetch(FRAMES_DIR + "manifest.json");
    if (!res.ok) throw new Error("frame manifest: HTTP " + res.status);
    const manifest = await res.json();
    state.frameCount = manifest.count;
    state.frames = new Array(manifest.count);

    const gate = Math.min(PRELOAD_GATE, state.frameCount);
    let loaded = 0;
    let openGate;
    const gateOpen = new Promise((resolve) => (openGate = resolve));
    const onOne = () => {
      loaded += 1;
      preloaderPct.textContent = Math.min(100, Math.round((loaded / gate) * 100));
      if (loaded >= gate) openGate();
    };

    // first frame first, so the hero can paint immediately
    await loadImage(0).then(onOne);
    drawFrame(0);

    const CONCURRENCY = 10;
    let next = 1;
    const all = Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (next < state.frameCount) {
          const i = next++;
          await loadImage(i).then(onOne);
        }
      })
    );
    await Promise.race([gateOpen, all]);
  }

  function loadImage(i) {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        img.decode ? img.decode().catch(() => {}).then(() => resolve(img)) : resolve(img);
      };
      img.onerror = () => resolve(img);
      img.src = frameSrc(i);
      state.frames[i] = img;
    });
  }

  /* ---------- scroll choreography ---------- */

  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  // how blurred pillar copy gets at a hand-off, and where in its third of the
  // scroll the blur starts (out) or has cleared (in)
  const PILLAR_BLUR_MAX = 14;
  const PILLAR_BLUR_OUT = 0.7;
  const PILLAR_BLUR_IN = 0.25;

  function update(scroll) {
    // nothing moved and the scrub has settled: skip every style write
    if (scroll === state.lastScroll && state.current === state.target && !state.needsDraw) return;
    state.lastScroll = scroll;

    /* hero scrub */
    const hp = clamp01((scroll - state.heroTop) / state.heroRange);
    state.target = hp * (state.frameCount - 1);

    if (reducedMotion) {
      state.current = state.target;
    } else {
      state.current += (state.target - state.current) * 0.16;
      if (Math.abs(state.target - state.current) < 0.02) state.current = state.target;
    }

    const frameIndex = Math.round(state.current);
    if (frameIndex !== state.drawnIndex || state.needsDraw) drawFrame(frameIndex);

    heroBar.style.transform = "scaleX(" + hp + ")";

    /* hero type: name splits apart as the orbit runs */
    if (!reducedMotion) {
      const split = hp * state.vw * 0.34;
      lineA.style.transform = "translateX(" + -split + "px)";
      lineB.style.transform = "translateX(" + split + "px)";
    }
    heroTitle.style.opacity = String(1 - clamp01((hp - 0.55) / 0.3));

    /* pillars: one at a time */
    const pp = clamp01((scroll - state.pillarsTop) / state.pillarsRange);
    const idx = Math.min(2, Math.floor(pp * 3));
    const idxChanged = idx !== state.pillarIndex;
    if (idxChanged) {
      pillars.forEach((el, i) => el.classList.toggle("is-active", i === idx));
      state.pillarIndex = idx;
    }
    railFill.style.transform = "scaleY(" + pp + ")";

    /* pillars: copy blurs out toward the end of its third of the scroll and the
       next one sharpens in from the start of its own. The first holds sharp on
       the way in and the last on the way out, so the section opens and closes
       on readable type. */
    if (!reducedMotion) {
      const local = pp * 3 - idx; // 0..1 inside the active pillar's third
      let b = 0;
      if (idx < pillars.length - 1) b = Math.max(b, clamp01((local - PILLAR_BLUR_OUT) / (1 - PILLAR_BLUR_OUT)));
      if (idx > 0) b = Math.max(b, clamp01((PILLAR_BLUR_IN - local) / PILLAR_BLUR_IN));
      const px = Math.round(b * b * PILLAR_BLUR_MAX * 10) / 10;
      if (px !== state.pillarBlur || idxChanged) {
        pillars[idx].style.setProperty("--scroll-blur", px + "px");
        state.pillarBlur = px;
      }
    }
  }

  /* ---------- tilt on the projects card ----------
     The React Bits <TiltedCard /> leans on `motion` springs; this is the same
     spring, integrated by hand so it can ride the loop that is already running.
     Amplitude is well under the component default: a card this wide shears
     badly past about 8 degrees, and a 1.1x scale on a full-bleed banner reads
     as a glitch rather than a lift. */

  const SPRING = { stiffness: 100, damping: 30, mass: 2 };
  const ROTATE_AMPLITUDE = 7;
  const SCALE_ON_HOVER = 1.015;

  const tilt = {
    rx: { value: 0, velocity: 0, target: 0 },
    ry: { value: 0, velocity: 0, target: 0 },
    sc: { value: 1, velocity: 0, target: 1 },
    running: false,
  };

  function initTilt() {
    if (!tiltCard || reducedMotion) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    tiltCard.addEventListener("pointermove", (e) => {
      const rect = tiltCard.getBoundingClientRect();
      const offsetX = e.clientX - rect.left - rect.width / 2;
      const offsetY = e.clientY - rect.top - rect.height / 2;
      tilt.rx.target = (offsetY / (rect.height / 2)) * -ROTATE_AMPLITUDE;
      tilt.ry.target = (offsetX / (rect.width / 2)) * ROTATE_AMPLITUDE;
      tilt.running = true;
    });

    tiltCard.addEventListener("pointerenter", () => {
      tilt.sc.target = SCALE_ON_HOVER;
      tilt.running = true;
    });

    tiltCard.addEventListener("pointerleave", () => {
      tilt.rx.target = 0;
      tilt.ry.target = 0;
      tilt.sc.target = 1;
    });
  }

  function spring(s, dt) {
    const force = -SPRING.stiffness * (s.value - s.target) - SPRING.damping * s.velocity;
    s.velocity += (force / SPRING.mass) * dt;
    s.value += s.velocity * dt;
  }

  const atRest = (s, epsilon) =>
    Math.abs(s.value - s.target) < epsilon && Math.abs(s.velocity) < epsilon * 4;

  function updateTilt(dt) {
    if (!tilt.running) return;

    spring(tilt.rx, dt);
    spring(tilt.ry, dt);
    spring(tilt.sc, dt);

    tiltCard.style.transform =
      "rotateX(" + tilt.rx.value.toFixed(3) + "deg) rotateY(" +
      tilt.ry.value.toFixed(3) + "deg) scale(" + tilt.sc.value.toFixed(4) + ")";

    // settled back at rest: drop the inline transform and stop writing styles
    if (atRest(tilt.rx, 0.01) && atRest(tilt.ry, 0.01) && atRest(tilt.sc, 0.0002) &&
        tilt.rx.target === 0 && tilt.ry.target === 0 && tilt.sc.target === 1) {
      tiltCard.style.transform = "";
      tilt.running = false;
    }
  }

  /* ---------- observers ---------- */

  function initObservers() {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.2 }
    );
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

    const statsIo = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          countUp(entry.target);
          statsIo.unobserve(entry.target);
        }
      },
      { threshold: 0.5 }
    );
    document.querySelectorAll(".stat__count").forEach((el) => statsIo.observe(el));

    // the gradient border re-rasterises on every frame it turns
    if (tiltCard) {
      const borderIo = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            entry.target.classList.toggle("is-spinning", entry.isIntersecting);
          }
        },
        { threshold: 0 }
      );
      borderIo.observe(tiltCard);
    }

    // play background clips only while on screen
    const videoIo = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const v = entry.target;
          if (entry.isIntersecting) v.play().catch(() => {});
          else v.pause();
        }
      },
      { threshold: 0.05 }
    );
    document.querySelectorAll("video").forEach((v) => videoIo.observe(v));
  }

  function countUp(el) {
    const end = parseInt(el.dataset.count, 10);
    if (reducedMotion) {
      el.textContent = end;
      return;
    }
    const dur = 1100;
    const start = performance.now();
    const tick = (now) => {
      const t = clamp01((now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(eased * end);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* ---------- smooth anchors ---------- */

  function initAnchors(lenis) {
    document.querySelectorAll('a[href^="#"]').forEach((a) => {
      a.addEventListener("click", (e) => {
        const target = document.querySelector(a.getAttribute("href"));
        if (!target) return;
        e.preventDefault();
        if (lenis) lenis.scrollTo(target, { duration: 1.6 });
        else target.scrollIntoView();
      });
    });
  }

  /* ---------- boot ---------- */

  async function boot() {
    measure();

    let lenis = null;
    if (!reducedMotion && window.Lenis) {
      lenis = new window.Lenis({ autoRaf: false, lerp: 0.1 });
    }
    initAnchors(lenis);
    initObservers();
    initTilt();

    let resizeRaf = 0;
    window.addEventListener("resize", () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(measure);
    });

    let lastTime = performance.now();
    const loop = (time) => {
      const dt = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;
      if (lenis) lenis.raf(time);
      update(window.scrollY);
      updateTilt(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    try {
      await preload();
    } catch (err) {
      // no frames means a still hero, not a stuck preloader
      console.warn(err);
    } finally {
      document.body.classList.add("is-loaded");
      // letters ride in right after the curtain lifts
      setTimeout(() => document.body.classList.add("is-ready"), reducedMotion ? 0 : 250);
    }
  }

  boot();
})();
