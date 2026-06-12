# Account Deletion — Apple Guideline 5.1.1(v)

Closes the App Review rejection for **Sharm Eats** (customer app, ASC appId `6776864451`):
the app supported account creation but had no in-app account-deletion option.

## What was added

| Layer | File | What it does |
|-------|------|--------------|
| DB | `supabase/migrations/022_account_deletion.sql` | Makes `orders.user_id` nullable + `ON DELETE SET NULL` (was `RESTRICT`), adds `orders.deleted_user_ref` + `anonymized_at`, and a `SECURITY DEFINER` RPC `anonymize_my_account()` that **blocks while an order is in flight**, detaches + PII-scrubs the caller's orders (allowlist rebuild of `address_snapshot`, wholesale-replace `rider`, scrub `order_status_events.note`). |
| Edge Function | `supabase/functions/delete-account/index.ts` | Verifies the user JWT → calls the RPC in the user's context → **hard-deletes** `auth.users` with the service-role key. The auth delete cascades to `public.users` and all `ON DELETE CASCADE` children (addresses, payment methods, push tokens, favourites, merchant_staff). |
| App data | `apps/customer/src/data/{supabase,repositories}/user.ts`, `.../repositories/auth.ts` | `db.user.deleteAccount()` (live: invokes the Edge Function; mock: resets in-memory state). Typed `AccountDeletionError('active_order' \| 'failed')`. |
| App UI | `apps/customer/app/delete-account.tsx`, `app/(tabs)/profile.tsx`, `app/_layout.tsx` | **Profile → Delete account** → dedicated confirmation screen (type `DELETE`), active-order guard, then sign out + clear analytics + redirect to onboarding. |
| i18n | `src/i18n/locales/{en,ar}.json` | `deleteAccount.*` + `profile.deleteAccount` (other locales fall back to EN). |
| Web | `landing/src/app/privacy/page.tsx` | Privacy policy now describes the in-app deletion path. |

**Data treatment:** the account and all personal data are permanently deleted. Completed
orders are **retained but de-identified** (name/phone/address/room/GPS removed) for legal/tax
reasons — Apple permits retaining records you're legally required to keep, as long as the
account itself is gone and the user can no longer sign in.

## Deploy (required BEFORE the new build is reviewed)

```bash
# from repo root, with the linked project ref
supabase db push                                   # applies migration 022
# OR apply 022_account_deletion.sql manually in the SQL editor

supabase functions deploy delete-account --project-ref <REF>
# delete-account is called by the client WITH the user JWT — keep JWT verification ON
# (do NOT use --no-verify-jwt). The function re-verifies via getUser() as defense-in-depth.
```

Secrets already present for other functions are reused: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (auto-injected by Supabase for Edge Functions).

### Pre-ship verification
1. `select distinct jsonb_object_keys(address_snapshot) from public.orders;` — confirm the
   allowlist (`kind`) keeps only coarse, non-PII fields. If any nested PII appears, collapse
   `address_snapshot` to `{"anonymized": true}` in the RPC.
2. On a fresh test account: Profile → Delete account → type DELETE → confirm. App returns to
   onboarding and is signed out.
3. Sign in again with the **same** phone — you get a clean, empty account (proves the old
   identity is gone, not reused).
4. Place an order, then try to delete — you should be blocked with the active-order message.

## App Review reply (paste into App Store Connect, attach the screen recording)

> Thank you for the review. Sharm Eats now supports full, self-service in-app account
> deletion. To reach it: open the app → **Profile** tab → **Delete account** → confirm by
> typing DELETE. This permanently deletes the user's account and personal data (profile,
> saved addresses, payment methods, favourites, notification settings) and signs the user
> out; the user can no longer sign in with that identity. For legal and tax obligations we
> retain records of completed orders, but we remove all personal identifiers (name, phone,
> address, room number, and GPS location) so they can no longer be linked to the user. No
> phone call, email, or website visit is required. A screen recording of the full flow on a
> physical device is attached.

**Record the screen capture on a physical device** showing: sign in with the demo account →
Profile → Delete account → the full confirmation flow → signed out. Put it in the **Notes**
field of App Review Information for future submissions.
