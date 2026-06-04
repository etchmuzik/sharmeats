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

### Vercel (fastest)
```bash
npx vercel --prod
```
Set env vars in Vercel dashboard.

### Hostinger VPS (matches your existing infra)
Build static + Node server:
```bash
pnpm build
pnpm start    # listens on $PORT (default 3000)
```
Front with nginx reverse-proxy + Let's Encrypt. Set env vars in `/etc/sharmeats-landing.env` and load via systemd unit.

## What's NOT here yet

- No 360dialog WhatsApp confirm-message integration (Phase 0 day 4 — see `../docs/whatsapp-business-setup.md`).
- No analytics (add Plausible or PostHog once domain is locked).
- No favicon / OG image (add when brand visual identity is decided).
- No real domain (currently runs at localhost).
