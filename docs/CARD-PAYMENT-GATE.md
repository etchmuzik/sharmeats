# Card payments — what is actually deployed, and what gates enabling them

Package 04 Slice B. Cards are **dark** and must stay dark until every gate below
is satisfied. This document exists because the planning spec's "current
evidence" describes a card rail that is **not in production**.

## The repo/production gap (measured 2026-07-28)

The spec lists these as built. They exist **in the repository only**:

| Component | Repo | Production |
|---|---|---|
| `paymob-webhook` (Edge Function) | yes | **deployed, v5** |
| `paymob-create-intention` (Edge Function) | yes | **NOT deployed** |
| `paymob-refund` (Edge Function) | yes | **NOT deployed** |
| `settle_paymob_payment` (RPC) | mig 121 | **absent** |
| `finalize_full_card_refund` (RPC) | mig 121 | **absent** |
| `order_refunds` (table) | applied | present, **0 rows** |
| Card orders ever placed | — | **0** |

Verified by querying `pg_proc` and listing deployed Edge Functions directly, not
by reading migration files.

**Migration 121 was never applied.** This is the same class of defect as the
2026-07-03 incident where migration 041 was unapplied and `place_order` answered
PGRST202 on every checkout — repo code that reads as shipped because the file
exists. The difference is that this one is harmless *today*, precisely because
cards are dark: nothing calls the missing functions.

It would stop being harmless the moment someone flips
`EXPO_PUBLIC_PAYMENTS_CARD_ENABLED` to `true` without applying 121 first. A
customer would reach Paymob, pay, and the webhook would have no
`settle_paymob_payment` to call.

### What this means for the acceptance gate

The gate is not "turn on the flag". The deploy order is:

1. apply migration 121 (settlement + full-refund RPCs) — validated by a
   transaction-wrapped dry run, like every other migration here;
2. deploy `paymob-create-intention` and `paymob-refund`;
3. verify secrets exist **without printing them**;
4. only then begin the controlled pilot below.

## Owner prerequisites — none of these are code

Claude cannot satisfy, verify or fake any of these. They are recorded so the
gate is explicit rather than assumed.

| # | Prerequisite | Owner | Status |
|---|---|---|---|
| 1 | Paymob commercial + KYC approval completed | Owner | ☐ |
| 2 | Production integration ID, public key, secret key, HMAC secret stored in the approved secrets manager (never in git, never in `eas.json`) | Owner | ☐ |
| 3 | Webhook URL registered with Paymob and tested end to end | Owner | ☐ |
| 4 | Named finance owner and named refund operator | Owner | ☐ |
| 5 | Written dispute, refund and customer-support policy | Owner | ☐ |
| 6 | Settlement bank account verified with a real transfer | Owner | ☐ |

## Verification commands (safe — print no secrets)

Which Edge Functions are deployed, and at what version:

```bash
npx supabase functions list --project-ref ilqpsebcfbaoaogimhud
```

Whether the settlement/refund RPCs exist at all:

```sql
select proname from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in ('settle_paymob_payment', 'finalize_full_card_refund');
```

Whether the secrets are **present** (never their values):

```sql
select name, (decrypted_secret is not null and decrypted_secret <> '') as is_set
from vault.decrypted_secrets
where name in ('paymob_hmac_secret', 'paymob_secret_key', 'push_internal_secret');
```

Run 2026-07-28: returns **only** `push_internal_secret`. No Paymob secret of any
kind exists in the vault, which independently confirms prerequisite 2 is
outstanding — the webhook could not verify an HMAC today even if it were called.

## Acceptance gate — all must hold before cards expand

- [ ] Migration 121 applied and verified in production
- [ ] `paymob-create-intention` and `paymob-refund` deployed
- [ ] Paymob **test-mode** scenarios pass, including a **tampered** callback and
      a **replayed** callback
- [ ] ≥20 controlled low-value live transactions across success, failure,
      abandonment, refund and duplicate-callback paths
- [ ] Every one reconciled to Paymob ↔ order ↔ refund rows ↔ merchant settlement
- [ ] **Zero unexplained variance**
- [ ] A duplicate callback is provably harmless
- [ ] A duplicate intention cannot create a second chargeable order
- [ ] Failed/abandoned orders never reach the kitchen
- [ ] A late success after local timeout is visible to operations and does not
      revive a cancelled kitchen order
- [ ] The named refund operator has completed and reconciled one real refund
- [ ] Sentry and ops alerting proven deliberately (see `OPS-RUNBOOK.md` §5.1)

## Two rules that are not negotiable

**The customer must never see "paid" because of a browser redirect.** Only the
signed, amount-checked server webhook settles a payment. A redirect proves the
customer's browser reached a URL; it proves nothing about money.

**Cohort control must be server-side.** A client boolean is not an authority —
anyone can flip it. Expanding beyond the pilot means a server-side allow-list,
not a wider default in `eas.json`.

## Current state

`EXPO_PUBLIC_PAYMENTS_CARD_ENABLED=false` in every build profile. COD is the
only live payment method, and 100% of the 23 orders ever placed are COD.

Nothing in this repository should be read as evidence that cards work. They have
never processed a single real transaction.
