# CI/CD: automatic deploy on push

Goal: you `git push`, and 60 seconds later the live site is updated. You never run
rsync or pm2 by hand again.

---

## 1. The idea

**CI (Continuous Integration)** = every time you push code, a machine automatically
checks it is not broken.

**CD (Continuous Deployment)** = if those checks pass, that same machine ships it
to production.

The important word is **gate**. Deployment only happens if verification passed. A
pipeline without a gate is just a slower way to break your site.

Our pipeline has two jobs:

```
   you: git push origin main
            |
            v
   [ job 1: verify ]  <- runs on a GitHub machine, touches nothing of yours
            |             - do all referenced files exist?
            |             - does the frame sequence have gaps?
            |             - does server.mjs boot and serve?
            |
        passed? --no--> STOP. Server untouched. You get an email.
            |
           yes
            |
            v
   [ job 2: deploy ]  <- SSH into your server
            |             - rsync the files
            |             - pm2 reload (drains in-flight requests)
            |             - curl the live URL to confirm 200
            v
      live site updated
```

Job 2 declares `needs: verify`. That one line is the gate.

---

## 2. Why an SSH *deploy key*, not your password

GitHub's machine needs to log into your server. Two rules:

- **Never put a password in CI.** It cannot be scoped or revoked cleanly.
- **Do not reuse your personal SSH key.** If GitHub is ever compromised, you want to
  revoke *one* key used for *one* purpose, not the key you use for everything.

So we generate a dedicated keypair:

- the **public** key goes on your server, in `~/.ssh/authorized_keys` (safe to share)
- the **private** key goes into GitHub Secrets (never shown, never committed)

Secrets are encrypted, hidden from logs, and unavailable to pull requests from forks.

---

## 3. Setup

### 3a. Generate the deploy key

On your Mac:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/abtin_portfolio_deploy -N "" -C "github-actions-deploy"
```

That writes two files: `abtin_portfolio_deploy` (private) and
`abtin_portfolio_deploy.pub` (public).

### 3b. Authorize the public key on your server

```bash
ssh-copy-id -i ~/.ssh/abtin_portfolio_deploy.pub user@your-server
```

Or manually append the contents of the `.pub` file to
`~/.ssh/authorized_keys` on the server.

Test that it works before touching GitHub:

```bash
ssh -i ~/.ssh/abtin_portfolio_deploy user@your-server "echo connected"
```

If that does not print `connected`, fix it now. CI cannot fix an SSH problem.

### 3c. Capture the server's host key

This prevents a man-in-the-middle from impersonating your server:

```bash
ssh-keyscan -H your-server.com
```

Copy the whole output.

### 3d. Add the secrets on GitHub

Repo -> **Settings** -> **Secrets and variables** -> **Actions** -> **New repository secret**.

| Secret | Value | Required |
|---|---|---|
| `SSH_PRIVATE_KEY` | full contents of `~/.ssh/abtin_portfolio_deploy`, including the BEGIN/END lines | yes |
| `SSH_HOST` | your server IP or hostname | yes |
| `SSH_USER` | the SSH user you log in as | yes |
| `DEPLOY_PATH` | e.g. `/var/www/abtin-portfolio` | yes |
| `SSH_KNOWN_HOSTS` | output of `ssh-keyscan` from 3c | strongly recommended |
| `SSH_PORT` | only if your SSH is not on 22 | no |
| `SITE_URL` | e.g. `https://abtinabedi.com`, enables the post-deploy smoke test | no |

To read the private key for copying, without it appearing in your terminal history:

```bash
pbcopy < ~/.ssh/abtin_portfolio_deploy
```

That puts it straight on your clipboard. Paste into GitHub, then never think about
it again.

---

## 4. Run it

```bash
git add -A
git commit -m "feat: add CI/CD pipeline"
git push origin main
```

Open the **Actions** tab. You will see the run, both jobs, and every step's log.

You can also trigger it by hand from that tab (the `workflow_dispatch` trigger)
without pushing anything, which is useful for testing.

---

## 5. Safety features in this pipeline

**The gate.** `needs: verify` means a broken frame sequence or a missing font stops
the deploy before your server is touched.

**Concurrency control.** `cancel-in-progress: false` means two rapid pushes queue up
rather than one killing the other halfway through an rsync, which would leave your
site half-copied.

**Deploy path guard.** The workflow refuses to run `rsync --delete` into `/`,
`/root`, `/var` and friends. `--delete` removes files at the destination that are
not in the source, so a typo'd path could otherwise be destructive.

**Key cleanup.** The private key is removed from the runner with `if: always()`,
so it is wiped even when a previous step failed.

**Post-deploy smoke test.** After pm2 reloads, CI curls your live URL. If the site
does not return 200, the run is marked failed and you get notified, rather than
finding out from a client.

---

## 6. Rolling back

Your git history *is* your rollback mechanism. To undo the last deploy:

```bash
git revert HEAD
git push origin main
```

That creates a new commit undoing the change, which triggers a normal deploy of the
previous state. Preferred over `git reset --hard` because it does not rewrite
history that is already pushed.

---

## 7. Troubleshooting

**`Permission denied (publickey)`** — the public key is not in the server's
`authorized_keys`, or `SSH_PRIVATE_KEY` was pasted incompletely. It must include
the `-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END-----` lines.

**`Host key verification failed`** — `SSH_KNOWN_HOSTS` is missing or stale. Re-run
`ssh-keyscan` and update the secret.

**`pm2: command not found`** — pm2 is installed for your login shell but the SSH
command runs non-interactively. Use the absolute path in the workflow (find it with
`which pm2` on the server), or symlink it into `/usr/local/bin`.

**Site still shows the old version** — assets are cached for a year by design.
Hard-refresh (Cmd+Shift+R). Only the HTML is set to always revalidate.

---

## 8. What is deliberately *not* automated

Regenerating the hero frames does **not** happen in CI. `assets/source/` (the master
clips) is gitignored, and frame extraction needs ffmpeg and several minutes. Frames
are generated on your machine with `npm run extract` and committed as build output.

This is a deliberate tradeoff: it keeps deploys to seconds instead of minutes, and
the clips change very rarely. Back up `assets/source/` somewhere outside the repo,
since git does not have it.
