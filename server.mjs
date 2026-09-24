// Production static server for the portfolio.
// Zero dependencies (Node builtins only) - no `npm install` needed to run this.
//
//   PORT=4173 HOST=127.0.0.1 node server.mjs
//
// Serves with gzip, long-lived caching for immutable assets, ETag revalidation,
// HTTP Range support for video, and graceful shutdown for pm2 reloads.

import { createServer } from "node:http";
import { createReadStream, statSync, readFileSync } from "node:fs";
import { join, normalize, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { gzipSync, createGzip } from "node:zlib";
import { createHash } from "node:crypto";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

// Text types worth compressing. Images/video/fonts are already compressed.
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".mjs", ".json", ".svg", ".txt", ".xml"]);

// Content-addressed asset dirs never change without a filename change in practice;
// the frame sequence and clips are regenerated wholesale, so bust with a deploy.
const IMMUTABLE = /^\/(assets|fonts|vendor)\//;

// Deck screenshots are overwritten under the same filename whenever a project
// is redesigned, so they are carved out of the rule above.
const REPLACED_IN_PLACE = /^\/assets\/shots\//;

const etagCache = new Map();

function etagFor(file, st) {
  const key = `${file}:${st.mtimeMs}:${st.size}`;
  let tag = etagCache.get(key);
  if (!tag) {
    tag = `"${createHash("sha1").update(key).digest("base64url").slice(0, 20)}"`;
    if (etagCache.size > 2000) etagCache.clear();
    etagCache.set(key, tag);
  }
  return tag;
}

function cacheControl(urlPath, ext) {
  if (ext === ".html") return "no-cache";               // always revalidate the shell
  // A document like the CV lives under /assets but is replaced in place under
  // the same name, so it must not inherit the immutable year below.
  if (ext === ".pdf") return "public, max-age=3600, must-revalidate";
  if (REPLACED_IN_PLACE.test(urlPath)) return "public, max-age=3600, must-revalidate";
  if (IMMUTABLE.test(urlPath)) return "public, max-age=31536000, immutable";
  return "public, max-age=3600, must-revalidate";        // css/js: short, revalidated
}

const server = createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400).end("bad request");
    return;
  }
  const rawPath = urlPath;
  if (urlPath.endsWith("/")) urlPath += "index.html";

  let file = normalize(join(ROOT, urlPath));

  // path traversal + dotfile guard
  const safe = (f) => f.startsWith(ROOT + sep) && !f.split(sep).some((s) => s.startsWith("."));
  if (!safe(file)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  let st = null;
  try {
    const found = statSync(file);
    if (!found.isDirectory()) st = found;
  } catch {}

  // Pretty URLs: /works and /works/ both serve works.html. Extensionless only,
  // so this can never shadow a real file or reach outside ROOT.
  if (!st) {
    const bare = rawPath.replace(/\/+$/, "");
    if (bare && !extname(bare)) {
      const alt = normalize(join(ROOT, bare + ".html"));
      if (safe(alt)) {
        try {
          const found = statSync(alt);
          if (found.isFile()) {
            file = alt;
            urlPath = bare + ".html";
            st = found;
          }
        } catch {}
      }
    }
  }

  // Netlify serves 404.html for anything missing; do the same locally so the
  // styled page is what you develop against.
  if (!st) {
    const notFound = join(ROOT, "404.html");
    try {
      const body = readFileSync(notFound);
      res
        .writeHead(404, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
        })
        .end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 not found");
    }
    return;
  }

  const ext = extname(file).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const etag = etagFor(file, st);
  const lastModified = st.mtime.toUTCString();

  const baseHeaders = {
    "Content-Type": type,
    "Cache-Control": cacheControl(urlPath, ext),
    ETag: etag,
    "Last-Modified": lastModified,
    "X-Content-Type-Options": "nosniff",
  };

  // conditional request -> 304
  const inm = req.headers["if-none-match"];
  if (inm && inm.split(/,\s*/).includes(etag)) {
    res.writeHead(304, baseHeaders).end();
    return;
  }

  // range request (video scrubbing)
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : st.size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= st.size) {
        res.writeHead(416, { "Content-Range": `bytes */${st.size}` }).end();
        return;
      }
      res.writeHead(206, {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${st.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
      });
      if (req.method === "HEAD") return res.end();
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
  }

  const acceptsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
  const shouldCompress = acceptsGzip && COMPRESSIBLE.has(ext) && st.size > 1024;

  if (shouldCompress) {
    res.writeHead(200, { ...baseHeaders, "Content-Encoding": "gzip", Vary: "Accept-Encoding" });
    if (req.method === "HEAD") return res.end();
    createReadStream(file).pipe(createGzip()).pipe(res);
    return;
  }

  res.writeHead(200, { ...baseHeaders, "Content-Length": st.size, "Accept-Ranges": "bytes" });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`abtin-portfolio serving ${ROOT} on http://${HOST}:${PORT}`);
});

// graceful shutdown so `pm2 reload` does not drop in-flight requests
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`${sig} received, closing server`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
