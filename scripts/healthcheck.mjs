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
import { join, dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fail = [];
const pass = [];

const ok = (m) => pass.push(m);
const bad = (m) => fail.push(m);

/* ---------- 1. referenced assets exist ---------- */

const PAGES = ["index.html", "works.html", "404.html"];
const STYLES = [join("css", "main.css"), join("css", "works.css")];

// comments carry example markup ("swap in <img src=...>"), which is
// documentation, not a reference to resolve
const stripComments = (t) => t.replace(/<!--[\s\S]*?-->/g, "");

const html = PAGES.map((f) => stripComments(readFileSync(join(ROOT, f), "utf8"))).join("\n");
const css = STYLES.map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");

// strip the in-page hash target off refs like works.html#fenbot before resolving
const htmlRefs = [...new Set(
  [...html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)]
    .map((m) => m[1].split("#")[0])
    .filter((u) => u && !/^(https?:|mailto:|tel:|data:|#)/.test(u))
)];

// url(../fonts/x.woff2) inside css/main.css resolves relative to css/.
// Strip data: URIs first: the inline SVG grain filter contains its own url(%23n)
// fragment reference, which is not a file on disk.
const cssNoData = css.replace(/url\(["']?data:[^)]*\)/g, "url(data:inline)");
const cssRefs = [...cssNoData.matchAll(/url\(["']?([^"')]+)["']?\)/g)]
  .map((m) => m[1])
  .filter((u) => !/^(https?:|data:|#|%23)/.test(u));

// Resolve a reference the way the site serves it: root-relative from the site
// root, "/" -> index.html, and an extensionless path -> the matching .html.
// server.mjs and netlify.toml both do this, so "/works" must resolve here too.
const resolveRef = (ref) => {
  let p = ref.startsWith("/") ? ref.slice(1) : ref;
  if (p === "") p = "index.html";
  if (existsSync(join(ROOT, p))) return true;
  return !extname(p) && existsSync(join(ROOT, `${p}.html`));
};

// The 404 page can be served under any URL, so a relative asset path there
// would resolve against the missing path instead of the site root.
const notFound = stripComments(readFileSync(join(ROOT, "404.html"), "utf8"));
const relOn404 = [...notFound.matchAll(/(?:src|href)="([^"#][^"]*)"/g)]
  .map((m) => m[1])
  .filter((u) => u && !/^(https?:|mailto:|tel:|data:|#|\/)/.test(u));
if (relOn404.length) {
  bad(`404.html uses relative path(s) that break under a deep URL: ${relOn404.join(", ")}`);
} else {
  ok("404.html references everything root-relative");
}

let missing = 0;
for (const ref of htmlRefs) {
  if (!resolveRef(ref)) {
    bad(`a page references a missing file: ${ref}`);
    missing++;
  }
}
for (const ref of cssRefs) {
  if (!existsSync(join(ROOT, "css", ref))) {
    bad(`a stylesheet references a missing file: ${ref}`);
    missing++;
  }
}
if (!missing) ok(`all ${htmlRefs.length + cssRefs.length} local asset references resolve`);

/* ---------- 1b. the CV the nav offers actually exists ---------- */

const cvRef = html.match(/href="([^"]*\.pdf)"/);
if (cvRef && !existsSync(join(ROOT, cvRef[1]))) {
  bad(`the nav offers a CV download but ${cvRef[1]} is not in the repo -- put the PDF there (exact filename) or drop the button`);
} else if (cvRef) {
  ok(`CV download resolves (${cvRef[1]})`);
}

/* ---------- 1c. the share card each page advertises exists ---------- */

const ogRefs = [...new Set(
  [...html.matchAll(/<meta (?:property|name)="(?:og|twitter):image" content="https:\/\/abtin\.works\/([^"]+)"/g)].map((m) => m[1])
)];
const ogMissing = ogRefs.filter((r) => !existsSync(join(ROOT, r)));
if (ogMissing.length) bad(`share image(s) missing from the repo: ${ogMissing.join(", ")}`);
else if (ogRefs.length) ok(`share image resolves (${ogRefs.join(", ")})`);

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
    "/works",
    "/works.html",
    "/css/main.css",
    "/css/works.css",
    "/js/main.js",
    "/js/works.js",
    "/vendor/lenis.min.js",
    "/fonts/anton-latin.woff2",
    "/assets/frames/hero/manifest.json",
    "/assets/frames/hero/frame_0001.webp",
    "/assets/video/builder.mp4",
    "/assets/cv/abtin-abedi-cv.pdf",
  ];

  let served = 0;
  for (const path of critical) {
    const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
    if (!r.ok) bad(`server returned ${r.status} for ${path}`);
    else served++;
  }
  if (served === critical.length) ok(`all ${served} critical paths serve 200`);

  // a missing URL must reach the styled 404, the same page Netlify serves
  const nf = await fetch(`http://127.0.0.1:${PORT}/no-such-page`);
  const nfBody = await nf.text();
  if (nf.status !== 404) bad(`expected 404 for an unknown path, got ${nf.status}`);
  else if (!nfBody.includes("nf__code")) bad("unknown paths do not serve 404.html");
  else ok("unknown paths serve the styled 404");

  // security guards must hold
  const dot = await fetch(`http://127.0.0.1:${PORT}/.gitignore`);
  if (dot.status !== 403) bad(`dotfile guard broken: expected 403, got ${dot.status}`);
  else ok("dotfile guard returns 403");
} catch (e) {
  bad(e.message);
} finally {
  shutdown();
}

/* ---------- 5. the project index and the decks agree ---------- */

const worksHtml = readFileSync(join(ROOT, "works.html"), "utf8");
const railTargets = [...worksHtml.matchAll(/class="wrk__link[^"]*" href="#([^"]+)"/g)].map((m) => m[1]);
const deckIds = [...worksHtml.matchAll(/<article class="deck[^"]*" id="([^"]+)"/g)].map((m) => m[1]);

// The rail also carries entries that are not decks (the experience section),
// so check both directions: every link must resolve to an id on the page, and
// every deck must be listed.
const pageIds = [...worksHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);

if (!railTargets.length) bad("works.html has no entries in the index rail");
else {
  const orphans = railTargets.filter((t) => !pageIds.includes(t));
  const unlisted = deckIds.filter((d) => !railTargets.includes(d));
  if (orphans.length) bad(`index rail links to missing target(s): ${orphans.join(", ")}`);
  if (unlisted.length) bad(`deck(s) missing from the index rail: ${unlisted.join(", ")}`);
  if (!orphans.length && !unlisted.length) {
    ok(`index rail resolves (${deckIds.length} projects, ${railTargets.length - deckIds.length} other)`);
  }
}

// an ongoing role's duration is recomputed from data-since; without it the
// hand-written value silently rots
const ongoing = [...worksHtml.matchAll(/data-since="(\d{4})-(\d{2})"/g)];
const currentRoles = (worksHtml.match(/cv__item--current/g) || []).length;
if (ongoing.length !== currentRoles) {
  bad(`${currentRoles} role(s) marked current but ${ongoing.length} carry data-since`);
} else if (ongoing.length) {
  const stale = ongoing.filter(([, y, m]) => new Date(+y, +m - 1) > new Date());
  if (stale.length) bad(`data-since is in the future: ${stale[0][0]}`);
  else ok(`${ongoing.length} ongoing role(s) recompute their duration`);
}

// every category in the rail needs the section it points at, and vice versa
const railCats = [...worksHtml.matchAll(/class="wrk__group" data-cat="([^"]+)"/g)].map((m) => m[1]);
const sectionCats = [...worksHtml.matchAll(/<section class="cat" id="([^"]+)"/g)].map((m) => m[1]);

if (!railCats.length) bad("works.html has no categories in the project index");
else {
  const missing = railCats.filter((c) => !sectionCats.includes(c));
  const unlisted = sectionCats.filter((c) => !railCats.includes(c));
  if (missing.length) bad(`project index names missing categor(ies): ${missing.join(", ")}`);
  if (unlisted.length) bad(`categor(ies) missing from the project index: ${unlisted.join(", ")}`);
  if (!missing.length && !unlisted.length) ok(`categories match (${sectionCats.length}: ${sectionCats.join(", ")})`);
}

// every deck picks exactly one frame template
const frames = [...worksHtml.matchAll(/class="deck__frame deck__frame--(mobile|desktop)"/g)].map((m) => m[1]);
if (frames.length !== deckIds.length) {
  bad(`${deckIds.length} deck(s) but ${frames.length} frame(s) tagged --mobile/--desktop`);
} else {
  ok(`every deck has a frame template (${frames.filter((f) => f === "desktop").length} desktop, ${frames.filter((f) => f === "mobile").length} mobile)`);
}

// every icon modifier used on either page needs a rule naming its file, and
// every icon span needs the .icon base class or the mask never applies
const usedIcons = [...new Set([...html.matchAll(/\bicon--([a-z0-9-]+)\b/g)].map((m) => m[1]))];
const unstyled = usedIcons.filter((i) => !css.includes(`.icon--${i} {`));
if (unstyled.length) bad(`icon class(es) with no rule: ${unstyled.map((i) => "icon--" + i).join(", ")}`);
else ok(`all ${usedIcons.length} icons are wired up`);

const bareIcons = [...html.matchAll(/class="([^"]*\bicon--[a-z0-9-]+[^"]*)"/g)]
  .map((m) => m[1])
  .filter((c) => !/(^|\s)icon(\s|$)/.test(c));
if (bareIcons.length) bad(`${bareIcons.length} icon span(s) missing the .icon base class, e.g. "${bareIcons[0]}"`);
else ok("every icon span carries the .icon base class");

// the home page must not link to a deck that is not there
const homeDeckLinks = [...readFileSync(join(ROOT, "index.html"), "utf8").matchAll(/href="\/works#([^"]+)"/g)].map((m) => m[1]);
const brokenHomeLinks = homeDeckLinks.filter((h) => !deckIds.includes(h));
if (brokenHomeLinks.length) bad(`index.html links to missing deck(s): ${brokenHomeLinks.join(", ")}`);
else if (homeDeckLinks.length) ok(`all ${homeDeckLinks.length} home page deck links resolve`);

/* ---------- report ---------- */

for (const p of pass) console.log(`  ok    ${p}`);
for (const f of fail) console.error(`  FAIL  ${f}`);

if (fail.length) {
  console.error(`\nhealthcheck failed: ${fail.length} problem(s)\n`);
  process.exit(1);
}
console.log(`\nhealthcheck passed: ${pass.length} checks\n`);
process.exit(0);
