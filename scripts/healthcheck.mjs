// Pre-deploy validation. Runs in CI before anything touches the server.
// Exits non-zero on failure, which stops the deploy job.
//
//   node scripts/healthcheck.mjs
//
// Checks:
//   1. every local asset referenced by index.html / main.css actually exists
//   2. the hero frame manifest count matches the files on disk
//   3. frames are numbered contiguously from 1 (a gap would freeze the scrub)
//   4. server.mjs boots and serves the critical paths

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fail = [];
const pass = [];

const ok = (m) => pass.push(m);
const bad = (m) => fail.push(m);

/* ---------- 1. referenced assets exist ---------- */

const html = readFileSync(join(ROOT, "index.html"), "utf8");
const css = readFileSync(join(ROOT, "css", "main.css"), "utf8");

const htmlRefs = [...html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)]
  .map((m) => m[1])
  .filter((u) => !/^(https?:|mailto:|data:|#)/.test(u));

// url(../fonts/x.woff2) inside css/main.css resolves relative to css/.
// Strip data: URIs first: the inline SVG grain filter contains its own url(%23n)
// fragment reference, which is not a file on disk.
const cssNoData = css.replace(/url\(["']?data:[^)]*\)/g, "url(data:inline)");
const cssRefs = [...cssNoData.matchAll(/url\(["']?([^"')]+)["']?\)/g)]
  .map((m) => m[1])
  .filter((u) => !/^(https?:|data:|#|%23)/.test(u));

let missing = 0;
for (const ref of htmlRefs) {
  if (!existsSync(join(ROOT, ref))) {
    bad(`index.html references missing file: ${ref}`);
    missing++;
  }
}
for (const ref of cssRefs) {
  if (!existsSync(join(ROOT, "css", ref))) {
    bad(`main.css references missing file: ${ref}`);
    missing++;
  }
}
if (!missing) ok(`all ${htmlRefs.length + cssRefs.length} local asset references resolve`);

/* ---------- 2 + 3. frame sequence integrity ---------- */

const framesDir = join(ROOT, "assets", "frames", "hero");
const manifestPath = join(framesDir, "manifest.json");

if (!existsSync(manifestPath)) {
  bad("assets/frames/hero/manifest.json is missing; run `npm run extract`");
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const files = readdirSync(framesDir).filter((f) => f.endsWith(".webp")).sort();

  if (files.length !== manifest.count) {
    bad(`manifest says ${manifest.count} frames but ${files.length} .webp files exist`);
  } else {
    ok(`frame manifest matches disk (${files.length} frames)`);
  }

  // contiguity: frame_0001 .. frame_000N with no gaps
  const gaps = [];
  for (let i = 1; i <= files.length; i++) {
    const name = `frame_${String(i).padStart(4, "0")}.webp`;
    if (!existsSync(join(framesDir, name))) gaps.push(name);
  }
  if (gaps.length) bad(`frame sequence has ${gaps.length} gap(s), first: ${gaps[0]}`);
  else ok("frame sequence is contiguous from frame_0001");
}

/* ---------- 4. server boots and serves ---------- */

const PORT = 4199;
const child = spawn(process.execPath, [join(ROOT, "server.mjs")], {
  env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverErr = "";
child.stderr.on("data", (d) => (serverErr += d));

const shutdown = () => {
  try {
    child.kill("SIGTERM");
  } catch {}
};

try {
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("server did not start within 8s")), 8000);
    child.stdout.on("data", (d) => {
      if (String(d).includes("serving")) {
        clearTimeout(t);
        res();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(t);
      rej(new Error(`server exited early with code ${code}: ${serverErr}`));
    });
  });
  ok("server.mjs boots");

  const critical = [
    "/",
    "/css/main.css",
    "/js/main.js",
    "/vendor/lenis.min.js",
    "/fonts/anton-latin.woff2",
    "/assets/frames/hero/manifest.json",
    "/assets/frames/hero/frame_0001.webp",
    "/assets/video/builder.mp4",
  ];

  let served = 0;
  for (const path of critical) {
    const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
    if (!r.ok) bad(`server returned ${r.status} for ${path}`);
    else served++;
  }
  if (served === critical.length) ok(`all ${served} critical paths serve 200`);

  // security guards must hold
  const dot = await fetch(`http://127.0.0.1:${PORT}/.gitignore`);
  if (dot.status !== 403) bad(`dotfile guard broken: expected 403, got ${dot.status}`);
  else ok("dotfile guard returns 403");
} catch (e) {
  bad(e.message);
} finally {
  shutdown();
}

/* ---------- report ---------- */

for (const p of pass) console.log(`  ok    ${p}`);
for (const f of fail) console.error(`  FAIL  ${f}`);

if (fail.length) {
  console.error(`\nhealthcheck failed: ${fail.length} problem(s)\n`);
  process.exit(1);
}
console.log(`\nhealthcheck passed: ${pass.length} checks\n`);
process.exit(0);
