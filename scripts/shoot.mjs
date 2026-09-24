// Deck screenshots. Drives the local Chrome, captures the first screen of a
// live site and writes assets/shots/<slug>.webp at the exact ratio the deck
// frame expects, so the shot fills it without object-fit cropping anything off.
//
//   node scripts/shoot.mjs <slug> <url> [--mobile]
//   node scripts/shoot.mjs --list shots.txt      (one "slug url [--mobile]" per line)
//
// Desktop shots are taken at a real desktop viewport (1440x900, which is
// already 16:10) at 2x and downsampled, so text stays crisp without shipping a
// 2880px file. Mobile shots use a 360x640 viewport at 3x for the phone frame.

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = join(ROOT, "assets", "shots");
const CHROME = process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Matches the two deck frame templates in css/works.css.
const PRESET = {
  desktop: { width: 1440, height: 900, dpr: 2, out: [1600, 1000], mobile: false },
  mobile:  { width: 360,  height: 640, dpr: 3, out: [720, 1280],  mobile: true  },
};

// Consent walls sit on top of the hero and would be the whole screenshot.
// Clicking one is worth a try; anything cleverer belongs in a manual pass.
const CONSENT = /^(accept|accept all|allow all|i agree|agree|got it|ok|okay|kabul|kabul et|t[üu]m[üu]n[üu] kabul|tamam|onayla|anlad[ıi]m)$/i;

async function dismissConsent(page) {
  try {
    return await page.evaluate((source) => {
      const re = new RegExp(source.slice(1, source.lastIndexOf("/")), "i");
      const nodes = [...document.querySelectorAll('button, [role="button"], a')];
      for (const el of nodes) {
        const label = (el.innerText || el.textContent || "").trim();
        if (label && label.length < 40 && re.test(label)) {
          el.click();
          return label;
        }
      }
      return null;
    }, CONSENT.toString());
  } catch {
    return null;
  }
}

function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}: ${err}`))));
    p.on("error", rej);
  });
}

async function shoot(browser, { slug, url, kind }) {
  const preset = PRESET[kind];
  const page = await browser.newPage();
  await page.setViewport({
    width: preset.width,
    height: preset.height,
    deviceScaleFactor: preset.dpr,
    isMobile: preset.mobile,
    hasTouch: preset.mobile,
  });

  // Hold animations still so repeat runs of the same URL match.
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);

  await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });

  const clicked = await dismissConsent(page);
  if (clicked) await new Promise((r) => setTimeout(r, 600));

  // Lazy heroes and webfonts land after load; scroll back up in case the
  // consent click moved the page.
  try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch {}
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 1200));

  const raw = join(SHOTS, `${slug}.raw.png`);
  await page.screenshot({ path: raw, captureBeyondViewport: false });
  await page.close();

  const out = join(SHOTS, `${slug}.webp`);
  await run("cwebp", ["-q", "82", "-resize", String(preset.out[0]), String(preset.out[1]), raw, "-o", out]);
  rmSync(raw);

  const kb = Math.round(statSync(out).size / 1024);
  return { out: `assets/shots/${slug}.webp`, kb, clicked, size: preset.out.join("x") };
}

/* ---------- args ---------- */

const argv = process.argv.slice(2);
let jobs = [];

if (argv[0] === "--list") {
  const lines = readFileSync(resolve(argv[1]), "utf8").split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [slug, url, flag] = t.split(/\s+/);
    jobs.push({ slug, url, kind: flag === "--mobile" ? "mobile" : "desktop" });
  }
} else if (argv.length >= 2) {
  jobs = [{ slug: argv[0], url: argv[1], kind: argv.includes("--mobile") ? "mobile" : "desktop" }];
} else {
  console.error("usage: node scripts/shoot.mjs <slug> <url> [--mobile]");
  console.error("       node scripts/shoot.mjs --list shots.txt");
  process.exit(1);
}

mkdirSync(SHOTS, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-first-run", "--hide-scrollbars", "--mute-audio"],
});

let failed = 0;
for (const job of jobs) {
  try {
    const r = await shoot(browser, job);
    console.log(`  ok    ${job.slug}  ${r.size}  ${r.kb} KB  ->  ${r.out}` +
      (r.clicked ? `  [consent: "${r.clicked}"]` : ""));
  } catch (e) {
    console.error(`  FAIL  ${job.slug}  ${job.url}\n        ${e.message}`);
    failed++;
  }
}

await browser.close();
if (failed) {
  console.error(`\n${failed} shot(s) failed\n`);
  process.exit(1);
}
console.log(`\n${jobs.length} shot(s) written to assets/shots/\n`);
