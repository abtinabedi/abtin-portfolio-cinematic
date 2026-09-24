/* All Projects page.
   Keeps the index rail in sync with whichever deck holds the viewport,
   scrolls smoothly on click, and reveals deck copy on entry.
   Same rules as the home page: one rAF loop, no scroll listeners. */

(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Arm the reveal styles only now, so a JS failure can never hide the content.
  document.body.classList.add("wrk-js");

  const links = [...document.querySelectorAll(".wrk__link")];
  const decks = links
    .map((a) => document.querySelector(a.getAttribute("href")))
    .filter(Boolean);
  const groups = [...document.querySelectorAll(".wrk__group")];
  const railScroller = document.querySelector(".wrk__nav");

  // which category each project belongs to, read off the rail so the markup
  // stays the single source of truth for the grouping
  const groupOfLink = links.map((a) => a.closest(".wrk__group"));

  let activeIndex = -1;

  /* ---------- index rail follows the scroll ---------- */

  function setActive(i) {
    if (i === activeIndex || i < 0) return;
    links.forEach((a, n) => a.classList.toggle("is-active", n === i));

    const currentGroup = groupOfLink[i];
    groups.forEach((g) => g.classList.toggle("is-current", g === currentGroup));

    activeIndex = i;

    // on the mobile strip, keep the active chip in view
    if (railScroller && railScroller.scrollWidth > railScroller.clientWidth) {
      const chip = links[i];
      const target =
        chip.getBoundingClientRect().left -
        railScroller.getBoundingClientRect().left +
        railScroller.scrollLeft -
        (railScroller.clientWidth - chip.offsetWidth) / 2;
      railScroller.scrollTo({ left: Math.max(0, target), behavior: reducedMotion ? "auto" : "smooth" });
    }
  }

  function initSpy() {
    if (!decks.length) return;

    // A deck is "current" once it crosses the middle of the viewport.
    const spy = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const i = decks.indexOf(entry.target);
          if (i !== -1) setActive(i);
        }
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    );
    decks.forEach((d) => spy.observe(d));

    setActive(0);
  }

  /* ---------- reveal ---------- */

  function initReveal() {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      },
      { threshold: 0.15 }
    );
    document.querySelectorAll(".wrk-reveal").forEach((el) => io.observe(el));
  }

  /* ---------- pagespeed dials ----------
     The markup already carries the finished arc and numeral, so the scores are
     correct with JS off, blocked or broken. Arming is what winds them back to
     zero; an observer then plays them once the deck is on screen, the way the
     PageSpeed report plays its own dials.

     Arc and numeral run off one loop and one easing curve rather than a CSS
     transition plus a separate counter, so the ring closes on the exact frame
     the number lands instead of the two drifting apart. */

  const DIAL_DURATION = 1100; // same as the stat counters on the home page

  function initDials() {
    const blocks = [...document.querySelectorAll(".psi")];
    if (!blocks.length || reducedMotion) return;

    const armed = new Map();

    for (const block of blocks) {
      const gauges = [...block.querySelectorAll(".gauge")].map((gauge) => {
        const arc = gauge.querySelector(".gauge__arc");
        const value = gauge.querySelector(".gauge__value");
        const empty = parseFloat(arc.getAttribute("stroke-dasharray"));
        const full = parseFloat(arc.getAttribute("stroke-dashoffset"));
        const score = parseInt(value.textContent, 10);

        arc.setAttribute("stroke-dashoffset", empty);
        value.textContent = "0";
        return { arc, value, empty, full, score };
      });
      if (gauges.length) armed.set(block, gauges);
    }

    const play = (gauges) => {
      const start = performance.now();
      const tick = (now) => {
        const t = Math.min((now - start) / DIAL_DURATION, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        for (const g of gauges) {
          g.arc.setAttribute("stroke-dashoffset", g.empty + (g.full - g.empty) * eased);
          g.value.textContent = Math.round(g.score * eased);
        }
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const gauges = armed.get(entry.target);
          if (gauges) play(gauges);
          io.unobserve(entry.target);
        }
      },
      { threshold: 0.35 }
    );
    armed.forEach((_, block) => io.observe(block));
  }

  /* ---------- ongoing roles ----------
     A hand-written "3 mos" is wrong three months later. The markup keeps a
     readable value so the page is correct without JS; this recomputes it from
     data-since on load. Counting is inclusive of both end months, which is what
     the written durations already assume. */

  function humanDuration(months) {
    const years = Math.floor(months / 12);
    const rest = months % 12;
    const parts = [];
    if (years) parts.push(years + (years === 1 ? " yr" : " yrs"));
    if (rest || !years) parts.push(rest + (rest === 1 ? " mo" : " mos"));
    return parts.join(" ");
  }

  function initTenure() {
    const now = new Date();
    document.querySelectorAll("[data-since]").forEach((el) => {
      const [year, month] = el.dataset.since.split("-").map(Number);
      if (!year || !month) return;
      const months = (now.getFullYear() - year) * 12 + (now.getMonth() + 1 - month) + 1;
      if (months > 0) el.textContent = humanDuration(months);
    });
  }

  /* ---------- smooth in-page anchors ---------- */

  // How far a deck stops short of the top is a layout question, so it lives in
  // CSS as .deck { scroll-margin-top }. Both paths below honour that property,
  // which is why neither passes an offset of its own.
  function initAnchors(lenis) {
    document.querySelectorAll('a[href^="#"]').forEach((a) => {
      a.addEventListener("click", (e) => {
        const href = a.getAttribute("href");
        if (href === "#") return;
        const target = document.querySelector(href);
        if (!target) return;
        e.preventDefault();
        if (lenis) lenis.scrollTo(target, { duration: 1.2 });
        else target.scrollIntoView({ block: "start" });
        history.replaceState(null, "", href);
      });
    });
  }

  /* ---------- boot ---------- */

  function boot() {
    initTenure();
    initSpy();
    initReveal();
    initDials();

    let lenis = null;
    if (!reducedMotion && window.Lenis) {
      lenis = new window.Lenis({ autoRaf: false, lerp: 0.1 });
      const loop = (time) => {
        lenis.raf(time);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    initAnchors(lenis);

    // land on the right deck when arriving with a hash from the home page
    if (location.hash) {
      const target = document.querySelector(location.hash);
      if (target) {
        const i = decks.indexOf(target);
        if (i !== -1) setActive(i);
      }
    }
  }

  boot();
})();
