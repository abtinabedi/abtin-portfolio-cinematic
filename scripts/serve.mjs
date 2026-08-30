// Minimal static server for the portfolio (with Range support for video).
// Usage: node scripts/serve.mjs [port]
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] || 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/") path = "/index.html";
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }

  let st;
  try {
    st = statSync(file);
    if (st.isDirectory()) throw new Error("dir");
  } catch {
    res.writeHead(404).end("not found");
    return;
  }

  const type = MIME[extname(file).toLowerCase()] || "application/octet-stream";
  const range = req.headers.range;

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? parseInt(m[2], 10) : st.size - 1;
    res.writeHead(206, {
      "Content-Type": type,
      "Content-Range": `bytes ${start}-${end}/${st.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
    });
    createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": st.size,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
    });
    createReadStream(file).pipe(res);
  }
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
