# gocontroll-firmware Worker — `firmware.gocontroll.tech`

Public, read-only view of the R2 bucket **`gocontroll-firmware`** on **`firmware.gocontroll.tech`**.

Device traffic (software updates, tunnels) moves from `gocontroll.com` to `gocontroll.tech`, side by
side: both hostnames serve the same bucket until no client asks for the old one any more.

| Hostname | Served by | Since |
|----------|-----------|-------|
| `firmware.gocontroll.com` | R2 custom domain on `gocontroll-firmware` (R2 → bucket → Settings → Custom Domains) | 2026-03 |
| `firmware.gocontroll.tech` | this Worker, R2 binding `FIRMWARE_BUCKET` → `gocontroll-firmware` | 2026-10-21 |

The bucket is also public on its r2.dev URL (`pub-a18579515a9a4040a2f1ea0676240aab.r2.dev`); no
client uses that. The contract (paths, manifest format, which client reads what) is
`GOcontroll-Architecture/cloudflare/firmware/spec.md`.

## What it does

- `GET` / `HEAD` of an object key: the object as stored, with `ETag`, `Last-Modified`,
  `Content-Type` (and any other stored HTTP metadata) and `Accept-Ranges: bytes` — the same headers as
  the R2 custom domain.
- Conditional requests (`If-None-Match` / `If-Modified-Since` → 304, `If-Match` /
  `If-Unmodified-Since` → 412) and byte ranges (206, unsatisfiable → 416).
- No listing, no index page: the root, a path ending in `/` and any missing key are 404.
  Every other method is 405.

Publishing does not go through this Worker: the module repos (`.github/workflows/publish-firmware.yml`)
and this repo (`.github/workflows/deploy-brcm.yml`) write to the bucket over the S3 API, and since
2026-10-28 the intranet app Deploy (`deploy.gocontroll.tools`, tab *Firmware*, R2 binding
`FIRMWARE_BUCKET`) writes module firmware the way `publish_firmware.py` does
(`GOcontroll-Team/GOcontroll-Deploy/README.md` → *Module firmware*). An object is on both hostnames
as soon as it is in the bucket. The manifests hold paths relative to the host
(`modules/<id>/manifest.json`, `modules/<id>/<file>.srec`, `brcm/<file>`), so they are the same on
both hosts.

## Test, deploy, verify

```sh
npm test              # node --test, no dependencies
npm run deploy        # npm test, then wrangler deploy (custom domain firmware.gocontroll.tech)
python -I scripts/compare-hosts.py   # every manifest and file on .com and .tech: SHA-256, size, headers
```

`compare-hosts.py` walks `modules/manifest.json`, every per-module manifest and release file, and
`brcm/manifest.json` with its files, and checks each `.srec` against the `sha256` in its manifest.
Run it after a deploy and before switching a client over; it exits 1 on any difference.

TLS: `firmware.gocontroll.tech` uses the zone's certificate for `*.gocontroll.tech` (Let's Encrypt
at the time of writing, chain up to ISRG Root X1); `firmware.gocontroll.com` has its own R2
certificate (Google Trust Services, chain up to GlobalSign Root CA). No client pins a certificate;
they use the system / bundled CA store.

## Retiring `firmware.gocontroll.com`

Only when no controller, app build or image build asks for it any more (Cloudflare analytics of the
`gocontroll.com` zone, hostname `firmware.gocontroll.com`, at zero for a while). Then remove that
custom domain from the bucket. Mind the proxied `*.gocontroll.com` wildcard: without the custom
domain the hostname answers 200 with a placeholder instead of failing, so add an explicit redirect
to `firmware.gocontroll.tech` (or keep the custom domain) rather than just deleting it.

Should the bucket get its own R2 custom domain for `firmware.gocontroll.tech` instead of this
Worker, remove the route from `wrangler.toml` and deploy (or delete the Worker) first: a hostname
can be a Worker custom domain or an R2 custom domain, not both.
