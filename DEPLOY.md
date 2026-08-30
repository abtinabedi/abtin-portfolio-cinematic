# Deploying

The site is **fully static** (HTML, CSS, JS, images, video). Production payload is
about **10 MB**. There is no build step and no runtime dependency: `server.mjs` uses
only Node builtins, so you never run `npm install` on the server.

## What to upload

Upload these:

```
index.html  css/  js/  vendor/  fonts/  assets/frames/  assets/video/
server.mjs  ecosystem.config.cjs  package.json
```

Do **not** upload (they are build/dev only, ~85 MB):

```
node_modules/        # nothing here is needed at runtime
assets/source/       # original master clips, only used to regenerate frames
scripts/             # frame extraction + headless verification
```

From your machine:

```bash
rsync -avz --delete \
  --exclude node_modules --exclude assets/source --exclude scripts \
  --exclude .DS_Store --exclude 'logs' \
  ./ user@your-server:/var/www/abtin-portfolio/
```

---

## Option A: serve it with nginx directly (recommended)

A static site does not need a Node process. This is faster, uses zero RAM, and
cannot crash. If you control the nginx config, do this and skip pm2 entirely.

```nginx
server {
    listen 80;
    server_name abtinabedi.com www.abtinabedi.com;
    root /var/www/abtin-portfolio;
    index index.html;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    # hashed/regenerated assets: cache hard
    location ~* ^/(assets|fonts|vendor)/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # the shell must always revalidate
    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    location / {
        try_files $uri $uri/ =404;
    }
}
```

Then `sudo nginx -t && sudo systemctl reload nginx`, and add HTTPS with
`sudo certbot --nginx -d abtinabedi.com -d www.abtinabedi.com`.

---

## Option B: run it under pm2

Use this if your host manages apps through pm2 and you do not edit nginx vhosts
yourself. `server.mjs` handles gzip, cache headers, ETag revalidation, HTTP Range
(so the videos scrub), and graceful shutdown for zero-downtime reloads.

```bash
cd /var/www/abtin-portfolio
mkdir -p logs

pm2 start ecosystem.config.cjs
pm2 save                 # persist across reboots
pm2 startup              # run the command it prints, once
```

Check it:

```bash
pm2 status
pm2 logs abtin-portfolio
curl -I http://127.0.0.1:4173/
```

Edit `cwd` in `ecosystem.config.cjs` if you upload somewhere other than
`/var/www/abtin-portfolio`.

### Put nginx in front of it

`ecosystem.config.cjs` binds to `127.0.0.1:4173`, so the Node process is not
exposed to the internet. Proxy to it:

```nginx
server {
    listen 80;
    server_name abtinabedi.com www.abtinabedi.com;

    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

To expose the port directly without nginx, set `HOST: "0.0.0.0"` in
`ecosystem.config.cjs` and open the port in your firewall. Prefer nginx, since it
terminates TLS and serves files faster than Node.

---

## Updating the site

```bash
# from your machine
rsync -avz --delete --exclude node_modules --exclude assets/source \
  --exclude scripts --exclude .DS_Store --exclude logs \
  ./ user@your-server:/var/www/abtin-portfolio/

# then on the server, only if using pm2
pm2 reload abtin-portfolio
```

`pm2 reload` drains in-flight requests before swapping, so visitors mid-scroll are
not dropped. With Option A (nginx static) you do not restart anything at all.

Note: assets are served with a one-year immutable cache. When you replace the hero
frames or clips, filenames stay the same, so hard-refresh once to confirm, or add a
query string to the asset URLs in `index.html` if you need to force-bust for
everyone.

---

## Regenerating media (on your machine, not the server)

```bash
npm install                    # dev tools: ffmpeg-static, puppeteer-core
npm run extract                # rebuild assets/frames/hero from assets/source
npm run verify /tmp/shots      # headless screenshots + scrub FPS check
```
