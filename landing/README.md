# sharmeats — landing page

Next.js 15 App Router landing page with 5-language waitlist (EN / AR / RU / IT / DE).

## Development

```bash
pnpm install        # or npm install
cp .env.example .env.local
# fill NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
pnpm dev            # http://localhost:3000
```

## Stack

- Next.js 15 (App Router, RSC for layout, client component for the page to handle locale switching)
- React 19 RC
- Tailwind CSS 3
- Zod for input validation
- Supabase JS client (server-side only, in `/api/waitlist/route.ts`)

## Files

```
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                 client component, owns locale state
│   ├── globals.css
│   └── api/waitlist/route.ts    POST → Supabase insert
├── components/
│   ├── LocaleSwitcher.tsx
│   └── WaitlistForm.tsx
└── i18n/
    └── dictionaries.ts          5-language translations + RTL set
```

## Waitlist storage

Requires a `waitlist` table in Supabase. SQL is in `../supabase/migrations/001_waitlist.sql`.

API route uses the **service role key** (server-only) so the table can stay locked down to authenticated reads only — anon inserts go through the API route, which validates with Zod first.

## Deploy

**Production is Hostinger shared hosting, serving a static export.** Confirmed
2026-07-30 from the response headers of `sharmeats.online` (`platform: hostinger`,
`server: hcdn`), as well as `merchant.` and `admin.` (LiteSpeed/Hostinger).
There is no Vercel deployment and no Node server in production.

```bash
./scripts/build-hostinger.sh    # produces ./out
```

Then **upload the contents of `out/`** to `~/domains/sharmeats.online/public_html/`
via hPanel File Manager or FTP.

> The script builds and stops — it does **not** upload. That manual step is why
> production once drifted ~8 weeks behind `main` without anyone noticing: the
> build kept succeeding, so nothing ever looked broken. If you change this file,
> keep that warning.

Two things the script handles that a plain `next build` does not: it sets
`STATIC_EXPORT=1` (which switches on `output: 'export'` + `trailingSlash`), and it
quarantines the internal-only `/screenshots` and `/brand` **routes** out of
`src/app` for the duration of the build, restoring them afterwards even on
failure. `/screenshots` reads `searchParams`, which `output: export` cannot
build. Note that `public/screenshots/` and `public/brand/` are *assets* with the
same names and are still copied into `out/` — that is correct and expected.

`out/.htaccess` ships from `public/.htaccess` and supplies the AASA
`Content-Type` header that a static export cannot set through `headers()`.

## What's NOT here yet

- No 360dialog WhatsApp confirm-message integration (Phase 0 day 4 — see `../docs/whatsapp-business-setup.md`).
- No analytics (add Plausible or PostHog once domain is locked).
- No favicon / OG image (add when brand visual identity is decided).
- No real domain (currently runs at localhost).
