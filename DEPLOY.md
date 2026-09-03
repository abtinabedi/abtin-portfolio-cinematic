# Deploying

The site is **fully static** (HTML, CSS, JS, images, video). Production payload is
about **10 MB** across ~220 files. There is no build step and no runtime
dependency: nothing here needs `npm install` to serve.

Production runs on **Netlify**, deployed from the `main` branch of the GitHub repo.
`server.mjs` still exists and still matters, but only as the local dev server and
as the fallback for a self-hosted setup (Option B below).

---

## Option A: Netlify (this is what production uses)

### One-time setup

1. Netlify → **Add new site** → **Import an existing project** → GitHub → pick this
   repo.
2. Leave every build setting alone. `netlify.toml` in the repo root already
   declares them:

   | Setting | Value | Why |
   |---|---|---|
   | Publish directory | `.` | The repo root *is* the site. Nothing is compiled. |
   | Build command | `node scripts/healthcheck.mjs` | The gate. A missing asset or a gap in the frame sequence fails the build, so it never goes live. |
   | `NODE_VERSION` | `20` | Pinned so a Netlify image bump cannot change behaviour. |
   | `NPM_FLAGS` | `--ignore-scripts` | Netlify installs dependencies because a `package.json` is present. `ffmpeg-static`'s postinstall would download a ~50 MB binary the build never uses. |

3. **Domain settings** → add `abtin.works` and `www.abtin.works`, then point DNS at
   Netlify. HTTPS is provisioned automatically. Netlify redirects `www` → apex by
   default; leave it that way, the canonical tags say apex.

After that, deploying is `git push origin main`. Netlify builds, runs the health
check, and publishes. Pull requests get their own deploy preview URL.

### What `netlify.toml` reproduces

Netlify serves files from its CDN; `server.mjs` does not run there. The config
restores everything that mattered:

| server.mjs did | On Netlify |
|---|---|
| gzip | automatic (brotli too) |
| HTTP Range, so the videos scrub | supported by the CDN |
| `/works` → `works.html` | explicit rewrite rule, so it does not depend on a dashboard toggle |
| one-year immutable cache on assets | `[[headers]]` rules — without these Netlify would revalidate all 193 hero frames on every repeat visit |
| `no-cache` on the page shells | `[[headers]]` rules, listed per page |
| `X-Content-Type-Options` | `[[headers]]`, plus CSP, frame-options, referrer and permissions policy |
| dotfile guard | not needed; dotfiles are not published |

It also 404s the repo plumbing that shares the publish directory with the site
(`scripts/`, `server.mjs`, `ecosystem.config.cjs`, `package.json`, the `.md` docs)
so the deploy process is not readable from the web.

### Rolling back

Netlify keeps every deploy. **Deploys** → pick a previous one → **Publish deploy**.
Instant, no rebuild. For a permanent fix, `git revert` and push.

### Watch the bandwidth

The two autoplaying clips are 7.4 MB and the hero frames another 3 MB, so a cold
visit is ~10 MB. Netlify's free tier is 100 GB/month, i.e. roughly 10,000 cold
visits. The immutable cache headers mean repeat visits cost almost nothing.

---

## Option B: self-host on a VPS

Still supported, and `server.mjs` / `ecosystem.config.cjs` are kept for it. Upload:

```
index.html  works.html  404.html  robots.txt  sitemap.xml
css/  js/  vendor/  fonts/  assets/frames/  assets/video/  assets/icons/  assets/cv/
server.mjs  ecosystem.config.cjs  package.json
```

Do **not** upload `node_modules/` (dev only), `assets/source/` (master clips) or
`scripts/`.

```bash
rsync -avz --delete \
  --exclude node_modules --exclude assets/source --exclude scripts \
  --exclude .DS_Store --exclude logs --exclude netlify.toml \
  ./ user@your-server:/var/www/abtin-portfolio/
```

### B1: nginx serving the files directly

```nginx
server {
    listen 80;
    server_name abtin.works www.abtin.works;
    root /var/www/abtin-portfolio;
    index index.html;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    location ~* ^/(assets|fonts|vendor)/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    location ~* \.html$ {
        add_header Cache-Control "no-cache";
    }

    error_page 404 /404.html;

    # extensionless pretty URLs: /works serves works.html, matching server.mjs
    location / {
        try_files $uri $uri.html $uri/ =404;
    }
}
```

Then `sudo nginx -t && sudo systemctl reload nginx`, and add HTTPS with
`sudo certbot --nginx -d abtin.works -d www.abtin.works`.

### B2: pm2 running server.mjs behind nginx

```bash
cd /var/www/abtin-portfolio
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup      # run the command it prints, once
```

`ecosystem.config.cjs` binds `127.0.0.1:4173`, so proxy to it:

```nginx
location / {
    proxy_pass http://127.0.0.1:4173;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`pm2 reload abtin-portfolio` drains in-flight requests before swapping.

---

## Working on it locally

```bash
npm run serve            # or: node server.mjs   -> http://127.0.0.1:4173
node scripts/healthcheck.mjs
```

`server.mjs` matches Netlify deliberately: same pretty URLs, same cache policy,
same styled 404 for unknown paths. If a page works locally it works on Netlify.

## Regenerating media (on your machine, not in CI)

```bash
npm install                    # dev tools: ffmpeg-static, puppeteer-core
npm run extract                # rebuild assets/frames/hero from assets/source
npm run verify /tmp/shots      # headless screenshots + scrub FPS check
```

`assets/source/` is gitignored, so back it up somewhere outside the repo. Frames
are committed as build output; regenerating them in CI would add minutes to every
deploy for something that changes a few times a year.
