# Database tests

Two different kinds of file live here. Telling them apart matters, because for a
long time ten of them looked like forgotten work when they were not.

## 1. Self-contained harness tests — run in CI

Recognisable by a real include of their own migration:

```sql
\ir ../migrations/189_proof_of_delivery.sql
```

They stub the small slice of the Supabase surface they need (the `anon` /
`authenticated` / `service_role` roles, `auth.uid()`, the `storage` schema, the
handful of `public` tables the migration references), load the migration, assert,
and `rollback`. They run against an empty PostgreSQL instance that
`scripts/test-security-migrations.sh` spins up per file, and they are listed in
that script's `test_files` array.

**These must be listed.** The harness refuses to pass if a file contains an
`\ir ../migrations/` line but is absent from `test_files` — otherwise a test can
sit here for months without ever executing, which is exactly what happened.

Write new migration tests in this style.

## 2. Manual verification scripts — not runnable in the harness

These name their migration only inside a **comment**, as a recipe for a human:

```sql
--   BEGIN; \i supabase/migrations/151_support_cases.sql
--          \i supabase/tests/151_support_cases.test.sql
--   ROLLBACK;
```

They assume the migration is already applied *and* that a full production schema
exists around it — `public.users`, `restaurants`, `push_campaigns`,
`notification_prefs`, `platform_settings`, `auth.users`, a `private` schema. Run
against the harness's empty database they fail immediately on a missing relation,
which is why they are not listed.

Currently in this category:

| File | First blocking dependency |
|---|---|
| `145_prepare_cart.test.sql` | `public.restaurants` (row type) |
| `146_campaign_provider_accepted.test.sql` | `public.push_campaigns` |
| `147_notification_consent_events.test.sql` | `public.users` |
| `148_campaign_operator_truth.test.sql` | `public.notification_prefs` |
| `149_150_cod_ceiling.test.sql` | `public.platform_settings` |
| `151_support_cases.test.sql` | `public.users` |
| `152_153_vertical_authority.test.sql` | migrations 152→166 applied in order |
| `164_campaign_blocked.test.sql` | `auth.users` |
| `166_platform_owner_lock.test.sql` | `private` schema |

To run one, apply the migration stack to a database that has the production
schema (a Supabase branch is the cheapest way) and follow the recipe in the
file's header.

Converting one to category 1 means stubbing its dependencies and switching the
commented `\i` to a real `\ir`. That is worth doing per file when someone touches
the migration, rather than as a bulk change — the stubs have to be faithful to
production types or the test proves the wrong thing. `144_admin_test_ops_alert`
was converted this way: its migration applies standalone, so it needed only the
roles and an `auth.uid()` stub.

## Neither category

- `126_129_dryrun_prod.sql` — transaction-wrapped dry run against the **real
  production schema**. Generated; do not hand-edit.
- `pilot_lifecycle_assertions.sql` — read-only postconditions for a lifecycle
  driven through the real RPCs and apps. Contains no DDL or DML by design, and a
  "pass" manufactured by inserting rows would certify nothing.
- `136_staff_role_fixture.sql` / `136_staff_role_assertions.sql` — a fixture and
  assertion pair the harness runs together as a special case, after the loop.

## Running locally

```bash
./scripts/test-security-migrations.sh
```

Needs `pg_config` on `PATH` and a PostgreSQL server binary. It refuses to run as
root (so does `initdb`), so run it as an unprivileged user.
