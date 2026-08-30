// Extra checks: uncapped scrub FPS, mobile viewport, reduced motion.
// Usage: node scripts/verify-extra.mjs <outDir>
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://localhost:4173";
const OUT = process.argv[2] || "/tmp/shots";
mkdirSync(OUT, { recursive: true });

/* 1) uncapped scrub FPS */
{
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-first-run", "--mute-audio", "--disable-gpu-vsync", "--disable-frame-rate-limit"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(URL, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => document.body.classList.contains("is-ready"));
  await new Promise((r) => setTimeout(r, 1200));

  await page.evaluate(() => {
    window.__ft = [];
    let last = performance.now();
    const rec = (t) => {
      window.__ft.push(t - last);
      last = t;
      requestAnimationFrame(rec);
    };
    requestAnimationFrame(rec);
  });
  const cdp = await page.createCDPSession();
  for (let i = 0; i < 160; i++) {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 720, y: 450, deltaX: 0, deltaY: 120 });
    await new Promise((r) => setTimeout(r, 16));
  }
  const fps = await page.evaluate(() => {
    const ft = window.__ft.slice(5);
    const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
    const sorted = [...ft].sort((a, b) => a - b);
    return {
      frames: ft.length,
      avgMs: +avg.toFixed(2),
      fps: +(1000 / avg).toFixed(1),
      p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
      maxMs: +sorted[sorted.length - 1].toFixed(2),
      over34ms: ft.filter((d) => d > 34).length,
    };
  });
  console.log("uncapped scrub:", JSON.stringify(fps));
  await browser.close();
}

/* 2) mobile + reduced motion */
{
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-first-run", "--mute-audio"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(URL, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => document.body.classList.contains("is-ready"));
  await new Promise((r) => setTimeout(r, 1600));
  await page.screenshot({ path: `${OUT}/m1-hero.jpg`, type: "jpeg", quality: 82 });
  const m = await page.evaluate(() => {
    const hero = document.getElementById("hero");
    return {
      heroSpan: hero.offsetHeight - innerHeight,
      statsTop: document.querySelector(".stats").getBoundingClientRect().top + scrollY,
      workTop: document.querySelector(".work__content").getBoundingClientRect().top + scrollY,
      finaleTop: document.getElementById("contact").getBoundingClientRect().top + scrollY,
      docH: document.body.scrollHeight,
      hasHScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  console.log("mobile metrics:", JSON.stringify(m));
  const jump = async (y, n, w = 1100) => {
    await page.evaluate((v) => window.scrollTo(0, v), Math.round(y));
    await new Promise((r) => setTimeout(r, w));
    await page.screenshot({ path: `${OUT}/${n}.jpg`, type: "jpeg", quality: 82 });
  };
  await jump(m.heroSpan * 0.5, "m2-hero-mid");
  await jump(m.statsTop - 300, "m3-stats", 1500);
  await jump(m.workTop - 100, "m4-work", 1400);
  await jump(m.docH, "m5-footer", 1300);

  /* reduced motion smoke test on desktop size */
  await page.setViewport({ width: 1440, height: 900 });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForFunction(() => document.body.classList.contains("is-ready"));
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: `${OUT}/r1-reduced-hero.jpg`, type: "jpeg", quality: 82 });
  const rm = await page.evaluate(() => ({
    titleOpacity: getComputedStyle(document.querySelector(".hero__title")).opacity,
    letterTf: getComputedStyle(document.querySelector(".ltr")).transform,
  }));
  console.log("reduced motion:", JSON.stringify(rm));
  await browser.close();
}
