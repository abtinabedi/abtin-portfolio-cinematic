// Headless verification: screenshots of every section + hero scrub smoothness metrics.
// Usage: node scripts/verify.mjs <outDir>
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://localhost:4173";
const OUT = process.argv[2] || "/tmp/shots";
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-first-run", "--mute-audio", "--autoplay-policy=no-user-gesture-required"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
await page.waitForFunction(() => document.body.classList.contains("is-ready"), { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1600)); // let the letter animation finish

const metrics = await page.evaluate(() => {
  const top = (el) => el.getBoundingClientRect().top + window.scrollY;
  const hero = document.getElementById("hero");
  const pillars = document.getElementById("pillars");
  return {
    heroTop: top(hero),
    heroSpan: hero.offsetHeight - innerHeight,
    pillarsTop: top(pillars),
    pillarsSpan: pillars.offsetHeight - innerHeight,
    statsTop: top(document.querySelector(".stats")),
    workContentTop: top(document.querySelector(".work__content")),
    finaleTop: top(document.getElementById("contact")),
    docH: document.body.scrollHeight,
    ih: innerHeight,
  };
});

async function shotAt(scrollY, name, settle = 900) {
  await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, Math.round(scrollY)));
  await new Promise((r) => setTimeout(r, settle));
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 82 });
  return page.evaluate(() => {
    const c = document.getElementById("hero-canvas");
    const ctx = c.getContext("2d");
    const p = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
    return [p[0], p[1], p[2]];
  });
}

const px0 = await shotAt(0, "01-hero-start");
const px33 = await shotAt(metrics.heroTop + metrics.heroSpan * 0.33, "02-hero-33");
const px66 = await shotAt(metrics.heroTop + metrics.heroSpan * 0.66, "03-hero-66");
await shotAt(metrics.statsTop - metrics.ih * 0.25, "04-stats", 1600);
await shotAt(metrics.pillarsTop + metrics.pillarsSpan * 0.15, "05-pillar-1", 1100);
await shotAt(metrics.pillarsTop + metrics.pillarsSpan * 0.5, "06-pillar-2", 1100);
await shotAt(metrics.pillarsTop + metrics.pillarsSpan * 0.85, "07-pillar-3", 1100);
await shotAt(metrics.workContentTop - metrics.ih * 0.15, "08-work", 1400);
await shotAt(metrics.finaleTop - metrics.ih * 0.1, "09-finale", 1400);
await shotAt(metrics.docH, "10-footer", 1200);

/* scrub smoothness: real wheel events through the hero while timing rAF */
await page.evaluate(() => window.scrollTo(0, 0));
await new Promise((r) => setTimeout(r, 800));
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
  await new Promise((r) => setTimeout(r, 18));
}
await new Promise((r) => setTimeout(r, 600));

const result = await page.evaluate(() => {
  const ft = window.__ft.slice(5);
  const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
  const sorted = [...ft].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const jank = ft.filter((d) => d > 34).length;
  return {
    frames: ft.length,
    avgMs: +avg.toFixed(2),
    p95Ms: +p95.toFixed(2),
    jankOver34ms: jank,
    endScroll: window.scrollY,
  };
});

console.log(JSON.stringify({ metrics, scrub: result, canvasPixels: { px0, px33, px66 } }, null, 2));
await browser.close();
