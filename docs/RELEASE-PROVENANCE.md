# Release provenance — what code is each web surface running?

Package 01 §3. Companion to [`RESTORE-DRILL.md`](RESTORE-DRILL.md) (can we get
the data back?) and [`DATABASE-RELEASE-RUNBOOK.md`](DATABASE-RELEASE-RUNBOOK.md)
(what is in the database?).

## Status — 2026-07-27

**Tooling: built. Deployment: NOT done. No surface serves a manifest yet.**

Measured, not assumed:

| Surface | URL | Result |
|---|---|---|
| landing | `https://sharmeats.online/version.json` | **HTTP 404** |
| admin-web | `https://admin.sharmeats.online/version.json` | **HTTP 200 — but HTML, not JSON** |
| merchant-web | `https://merchant.sharmeats.online/version.json` | **HTTP 200 — but HTML, not JSON** |

The 200s are the trap. Both dashboards answer *every* unknown path with their
Next.js 404 **page**, which is a 200-with-HTML. A status-code-only probe reports
these as healthy. Always check the body:

```bash
curl -s https://admin.sharmeats.online/version.json | jq -e . >/dev/null \
  && echo "real manifest" || echo "NOT a manifest"
```

`production-drift.yml` already does exactly this (`jq -e .`, then an explicit
"not JSON — the manifest is probably not deployed" error), so it will report the
truth today rather than a false pass. It was checked against this case on
2026-07-27; no change was needed.

## Why nothing is deployed

The generator and its wiring landed in commit `636e3e0`, but none of the three
surfaces has been rebuilt and redeployed since. The manifest is emitted at
**build** time into `<surface>/public/version.json` and is `.gitignore`d
(committing it would dirty the tree on every build and then trip the script's
own strict check). So it exists only inside a build artifact — and no artifact
built after `636e3e0` has shipped.

This is a deploy gap, not a code gap.

## How it works

`scripts/write-version-manifest.mjs`, wired as `prebuild` in `landing`,
`apps/admin-web` and `apps/merchant-web`, so a plain `npm run build` cannot
produce an unidentifiable artifact.

```json
{
  "commit": "33ff42d8997114821164e91884e926da05197595",
  "builtAt": "2026-07-27T19:20:45.195Z",
  "surface": "admin-web",
  "dirty": false
}
```

Strict mode auto-enables under `NODE_ENV=production` or `CI=true` and **fails the
build** rather than emitting a manifest it cannot stand behind:

```
ERROR: the working tree is dirty, so the commit SHA would not describe what is
being built. Commit or stash first.
```

Verified 2026-07-27: on a dirty tree, strict mode refused and wrote **no file**.
A local (non-strict) run warns and records `dirty: true` instead.

## Deploying it (owner)

Requires a **clean tree** — strict mode is the point, do not work around it.

Hostinger surfaces (admin-web, merchant-web):

```bash
cd apps/admin-web && STATIC_EXPORT=1 npm run build
```

Confirm the manifest is inside the artifact before uploading:

```bash
cat apps/admin-web/out/version.json
```

Then upload the export as usual. Repeat for `apps/merchant-web`.

Landing deploys separately to Vercel; a normal deploy from a clean checkout runs
`prebuild` and includes the manifest.

After deploying, verify with a real fetch — not a status code:

```bash
for h in sharmeats.online admin.sharmeats.online merchant.sharmeats.online; do
  printf '%-32s ' "$h"
  curl -s --max-time 10 "https://$h/version.json" | jq -c '{commit,surface,dirty}' 2>/dev/null \
    || echo "NOT SERVING A MANIFEST"
done
```

Expect three JSON lines whose `commit` is the deployed SHA, whose `surface`
matches the host, and whose `dirty` is `false`. Then run `production-drift`
with that SHA as `expected_sha` to record the assertion in CI.

Stale `version.json` files may linger in a local `public/` from an earlier
build; any real build overwrites them. They are gitignored, so `git status` will
not show them — check the **artifact**, not the working tree.

## Not covered here

Mobile release identity (app version, build number, runtime version, update ID,
channel, git SHA) is Package 01 §3's other half and is tracked separately.
