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

  function drawFrame(index) {
    const img = state.frames[index];
    if (!img || !img.complete || !img.naturalWidth) return;

    const cw = canvas.width;
    const ch = canvas.height;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const scale = Math.max(cw / iw, ch / ih);
    const dw = iw * scale;
    const dh = ih * scale;

    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    state.drawnIndex = index;
    state.needsDraw = false;
  }

  /* ---------- preload ---------- */

  function frameSrc(i) {
    return FRAMES_DIR + "frame_" + String(i + 1).padStart(4, "0") + ".webp";
  }

  async function preload() {
    const res = await fetch(FRAMES_DIR + "manifest.json");
    const manifest = await res.json();
    state.frameCount = manifest.count;
    state.frames = new Array(manifest.count);

    let loaded = 0;
    const onOne = () => {
      loaded += 1;
      preloaderPct.textContent = Math.round((loaded / state.frameCount) * 100);
    };

    // first frame first, so the hero can paint immediately
    await loadImage(0).then(onOne);
    drawFrame(0);

    const CONCURRENCY = 10;
    let next = 1;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (next < state.frameCount) {
          const i = next++;
          await loadImage(i).then(onOne);
        }
      })
    );
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

  function update(scroll) {
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
    if (idx !== state.pillarIndex) {
      pillars.forEach((el, i) => el.classList.toggle("is-active", i === idx));
      state.pillarIndex = idx;
    }
    railFill.style.transform = "scaleY(" + pp + ")";
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

    let resizeRaf = 0;
    window.addEventListener("resize", () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(measure);
    });

    const loop = (time) => {
      if (lenis) lenis.raf(time);
      update(window.scrollY);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    try {
      await preload();
    } finally {
      document.body.classList.add("is-loaded");
      // letters ride in right after the curtain lifts
      setTimeout(() => document.body.classList.add("is-ready"), reducedMotion ? 0 : 250);
    }
  }

  boot();
})();
