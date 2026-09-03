# CI/CD: automatic deploy on push

Goal: you `git push`, and a minute later the live site is updated. You never run
rsync or pm2 by hand.

---

## 1. The shape of it

**CI (Continuous Integration)** = every push is checked by a machine before anyone
sees it. **CD (Continuous Deployment)** = if the checks pass, that same machine
ships it.

The important word is **gate**. Deployment only happens if verification passed. A
pipeline without a gate is just a faster way to break your site.

```
   you: git push origin main
            |
            +---------------------------+
            |                           |
            v                           v
   [ GitHub Actions: CI ]      [ Netlify: build + deploy ]
     .github/workflows/ci.yml    netlify.toml
            |                           |
   node scripts/healthcheck.mjs   build command is the SAME
            |                     healthcheck. Fails -> nothing
            |                     is published, the previous
            v                     deploy stays live.
     green/red tick on                 |
     the commit and on PRs             v
                                 live site updated
```

Two runners, one gate, deliberately. GitHub Actions gives you the tick on the
commit and on pull requests. Netlify runs the same script as its **build command**,
which is what actually blocks a bad commit from going live — a green tick that does
not stop a deploy is decoration.

---

## 2. What the gate actually checks

`scripts/healthcheck.mjs` — pure Node builtins, no dependencies, so it runs
anywhere in seconds:

- every local file referenced by `index.html`, `works.html`, `404.html` and the
  stylesheets exists, resolved the way the site serves it (`/works` → `works.html`)
- `404.html` references everything root-relative, since it is served under
  arbitrary URLs and a relative path there would resolve against the missing path
- the CV the nav offers is actually in the repo
- the hero frame manifest count matches the files on disk, with no gaps in the
  sequence (a gap freezes the scroll scrub)
- `server.mjs` boots and serves every critical path, returns the styled 404 for an
  unknown path, and 403s dotfiles
- the project index rail and the decks on `works.html` agree in both directions
- every icon class has a rule naming its file, and every icon span carries the
  `.icon` base class
- the home page does not link to a deck that is not there

Run it yourself any time:

```bash
node scripts/healthcheck.mjs
```

---

## 3. Netlify setup

One-time, in the Netlify UI: **Add new site → Import an existing project → GitHub →
this repo**. Do not fill in the build settings by hand; `netlify.toml` declares
them, and a value typed into the dashboard silently overrides the file.

Everything else — publish directory, build command, Node version, cache headers,
security headers, redirects — lives in `netlify.toml`, in the repo, reviewable in a
diff. See `DEPLOY.md` for the table.

No secrets are needed. Netlify authenticates to GitHub through the app connection,
so there is no SSH key to generate, rotate, or leak.

---

## 4. Deploy previews

Every pull request gets its own URL with the full site built from that branch.
Open it, scroll the hero, click through to `/works`, check the console. Merging is
then a decision about something you have actually looked at.

---

## 5. Rolling back

Two options, use the first:

**Netlify → Deploys → pick a previous deploy → Publish deploy.** Instant, no
rebuild, no git archaeology. This is the one to reach for when the site is broken
right now.

**`git revert HEAD && git push`** for the permanent fix, once you are not under
pressure. Preferred over `git reset --hard` because it does not rewrite history
that is already pushed.

---

## 6. Troubleshooting

**Build fails with `healthcheck failed`** — read the `FAIL` lines in the Netlify
deploy log. They name the exact file or check. The previous deploy is still live,
so nothing is broken for visitors; fix and push again.

**Build fails during dependency install** — `NPM_FLAGS = "--ignore-scripts"` in
`netlify.toml` is what keeps `ffmpeg-static` from downloading a ~50 MB binary that
the build never uses. If someone removes that line, this is the first thing to
check.

**A page 404s that should not** — the catch-all redirect in `netlify.toml` is last
and not forced, so real files always win. Check the file is actually committed:
untracked files exist on your machine and nowhere else.

**Site still shows the old version** — assets are cached for a year by design. The
HTML always revalidates, so a hard refresh (Cmd+Shift+R) settles it. If an asset
genuinely changed under the same filename, it needs a new filename or a query
string.

**Styling or scripts break only on the deployed site** — check the browser console
for a Content-Security-Policy violation. The CSP in `netlify.toml` allows no
third-party origins and no inline `<script>`; adding either means updating that
header.

---

## 7. What is deliberately *not* automated

Regenerating the hero frames does not happen in CI. `assets/source/` (the master
clips) is gitignored, and frame extraction needs ffmpeg and several minutes. Frames
are generated on your machine with `npm run extract` and committed as build output.

That keeps deploys at seconds instead of minutes, for input that changes a few
times a year. Back up `assets/source/` somewhere outside the repo, since git does
not have it.
