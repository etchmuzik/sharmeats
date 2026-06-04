# supabase

Schema migrations for the sharmeats backend.

Currently Phase 0 only — just the `waitlist` table. Full schema (orders, restaurants, riders, etc.) lands in Phase 1.

## Apply migrations

### Option A — Supabase CLI (recommended)
```bash
brew install supabase/tap/supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

### Option B — Paste into Supabase SQL Editor
1. Open `https://supabase.com/dashboard/project/<your-project-ref>/sql/new`.
2. Paste contents of `migrations/001_waitlist.sql`.
3. Run.

## Provisioning checklist (one-time)

1. Create Supabase project — region: `eu-central-1` (closest to Egypt with low latency, and within EU data-sovereignty for IT/DE tourists).
2. Copy `NEXT_PUBLIC_SUPABASE_URL` from Project Settings → API → URL.
3. Copy `NEXT_PUBLIC_SUPABASE_ANON_KEY` from same screen (anon public key).
4. Copy `SUPABASE_SERVICE_ROLE_KEY` from same screen (service_role — keep secret, never commit).
5. Paste all three into `landing/.env.local` (see `landing/.env.example`).
6. Apply migration 001.
7. Test from landing page: submit a waitlist signup, then in SQL Editor: `select count(*) from waitlist;` → should be 1.

## RLS posture

- `waitlist`: RLS enabled with **no policies**. Only the service role key bypasses RLS.
- Anon clients cannot read or write the table directly. All writes go through `landing/src/app/api/waitlist/route.ts`.
- This pattern keeps the email list private even though the public anon key is shipped to browsers.
