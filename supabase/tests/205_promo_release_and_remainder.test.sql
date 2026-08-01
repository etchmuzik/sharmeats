\set ON_ERROR_STOP on

begin;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $roles$;

-- ============================================================================
-- Harness for migration 205 (promo release + remainder conservation).
--
-- Reproduces the prod shape the migration needs: promo_codes / promo_redemptions
-- (with 203h's redemption_seq + assign-seq trigger, so the release path is
-- proven to coexist with it), credit_ledger + customer_credit_balance with the
-- table-level reason CHECK, orders, and the helper functions the triggers call
-- (ops_alert, auth.uid). auth.uid returns a fixed owner so validate_promo's
-- owner guard is satisfiable.
-- ============================================================================

create schema if not exists auth;
create schema if not exists extensions;

create function auth.uid() returns uuid language sql stable as
  $$ select 'a0000000-0000-0000-0000-000000000001'::uuid $$;
create function public.auth_role() returns text language sql stable as $$ select 'customer'::text $$;
create function public.ops_alert(p_text text) returns void language sql as $$ select $$;
create function public.has_completed_order(uuid) returns boolean language sql stable as $$ select false $$;

create table public.users (id uuid primary key, referral_code text);
create table public.referrals (referred_id uuid);
create table public.platform_settings (key text primary key, value jsonb);

create table public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique, kind text check (kind in ('percent','fixed')), value int check (value > 0),
  min_subtotal_egp int, max_discount_egp int, valid_from timestamptz, valid_to timestamptz,
  max_uses int, per_user_limit int, is_active boolean default true,
  owner_user_id uuid references public.users(id)
);

create table public.orders (id uuid primary key, status text);

create table public.promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_id uuid references public.promo_codes(id),
  user_id uuid, order_id uuid not null references public.orders(id) unique,
  code text, discount_egp int, created_at timestamptz default now(),
  redemption_seq int
);

create table public.credit_ledger (
  id bigserial primary key, user_id uuid, delta_egp int check (delta_egp <> 0),
  reason text, ref_order_id uuid, note text, actor_id uuid, created_at timestamptz default now()
);
alter table public.credit_ledger add constraint credit_ledger_reason_check
  check (reason in ('refund','goodwill','sla_late','redeem','adjustment'));
create table public.customer_credit_balance (
  user_id uuid primary key, balance_egp int, updated_at timestamptz default now()
);

-- 203h's seq trigger — the release design must not break it.
create function public.promo_redemption_assign_seq() returns trigger
language plpgsql as $$
declare v_max int;
begin
  select max_uses into v_max from public.promo_codes where id = new.promo_id;
  if v_max is null then return new; end if;
  perform 1 from public.promo_codes where id = new.promo_id for update;
  select coalesce(max(redemption_seq),0)+1 into new.redemption_seq
    from public.promo_redemptions where promo_id = new.promo_id;
  if new.redemption_seq > v_max then raise exception 'PROMO_MAX_USES_EXCEEDED'; end if;
  return new;
end $$;
create trigger promo_redemptions_assign_seq before insert on public.promo_redemptions
  for each row execute function public.promo_redemption_assign_seq();

-- Seed: the owner (auth.uid), a minted fixed-100 code, a campaign code.
insert into public.users values ('a0000000-0000-0000-0000-000000000001', null);
insert into public.customer_credit_balance values ('a0000000-0000-0000-0000-000000000001', 0, now());
insert into public.promo_codes (id, code, kind, value, per_user_limit, max_uses, owner_user_id) values
  ('c0000000-0000-0000-0000-000000000001', 'CR-MINTED', 'fixed', 100, 1, null, 'a0000000-0000-0000-0000-000000000001'),
  ('c0000000-0000-0000-0000-000000000002', 'WELCOME10', 'percent', 10, 1, 5, null);

\ir ../migrations/205_promo_release_and_remainder.sql

-- ---------------------------------------------------------------------------
-- F-09: a minted 100 code spent for 80 refunds the 20 remainder at placement.
-- ---------------------------------------------------------------------------
insert into public.orders values ('00000000-0000-0000-0000-0000000000a1', 'placed');
insert into public.promo_redemptions (promo_id, user_id, order_id, code, discount_egp)
  values ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000a1', 'CR-MINTED', 80);
do $$
begin
  if (select balance_egp from public.customer_credit_balance where user_id='a0000000-0000-0000-0000-000000000001') <> 20 then
    raise exception 'F-09 FAIL: expected 20 EGP remainder refunded, got %',
      (select balance_egp from public.customer_credit_balance where user_id='a0000000-0000-0000-0000-000000000001');
  end if;
  if not exists (select 1 from public.credit_ledger where reason='promo_remainder' and delta_egp=20
                  and ref_order_id='00000000-0000-0000-0000-0000000000a1') then
    raise exception 'F-09 FAIL: no promo_remainder ledger row';
  end if;
  raise notice 'PASS F-09: 20 EGP remainder conserved to wallet on partial use';
end $$;

-- ---------------------------------------------------------------------------
-- F-08 (minted): cancelling that order re-credits the applied 80 AND re-opens
-- the code for the owner; the code is deactivated.
-- ---------------------------------------------------------------------------
update public.orders set status='cancelled' where id='00000000-0000-0000-0000-0000000000a1';
do $$
begin
  if (select balance_egp from public.customer_credit_balance where user_id='a0000000-0000-0000-0000-000000000001') <> 100 then
    raise exception 'F-08 FAIL: expected wallet back to 100 (20 remainder + 80 release), got %',
      (select balance_egp from public.customer_credit_balance where user_id='a0000000-0000-0000-0000-000000000001');
  end if;
  if (select released_at from public.promo_redemptions where order_id='00000000-0000-0000-0000-0000000000a1') is null then
    raise exception 'F-08 FAIL: redemption not marked released';
  end if;
  if (select is_active from public.promo_codes where id='c0000000-0000-0000-0000-000000000001') then
    raise exception 'F-08 FAIL: minted code still active after release';
  end if;
  raise notice 'PASS F-08 minted: 80 released to wallet, code retired, redemption released';
end $$;

-- Idempotency: a second cancel-fire (or re-run) must not double-credit.
update public.orders set status='cancelled' where id='00000000-0000-0000-0000-0000000000a1';
do $$
begin
  if (select balance_egp from public.customer_credit_balance where user_id='a0000000-0000-0000-0000-000000000001') <> 100 then
    raise exception 'IDEMPOTENCY FAIL: wallet changed on second cancel';
  end if;
  if (select count(*) from public.credit_ledger where reason='promo_release'
       and ref_order_id='00000000-0000-0000-0000-0000000000a1') <> 1 then
    raise exception 'IDEMPOTENCY FAIL: duplicate promo_release row';
  end if;
  raise notice 'PASS idempotency: second cancel is a no-op';
end $$;

-- ---------------------------------------------------------------------------
-- F-08 (campaign): cancelling a WELCOME10 order frees per_user_limit but does
-- NOT touch any wallet (marketing budget).
-- ---------------------------------------------------------------------------
insert into public.orders values ('00000000-0000-0000-0000-0000000000b1', 'placed');
insert into public.promo_redemptions (promo_id, user_id, order_id, code, discount_egp)
  values ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-0000000000b1', 'WELCOME10', 12);
do $$ declare v_before int;
begin
  v_before := (select count(*) from public.credit_ledger);
  update public.orders set status='rejected' where id='00000000-0000-0000-0000-0000000000b1';
  if (select count(*) from public.credit_ledger) <> v_before then
    raise exception 'F-08 campaign FAIL: a campaign cancel wrote to the credit ledger';
  end if;
  if (select released_at from public.promo_redemptions where order_id='00000000-0000-0000-0000-0000000000b1') is null then
    raise exception 'F-08 campaign FAIL: campaign redemption not released';
  end if;
  -- validate_promo must now see the code as available again for this user
  -- (per_user_limit re-opened). discount for a 200 basket = 20.
  if public.validate_promo('WELCOME10', 200) <> 20 then
    raise exception 'F-08 campaign FAIL: per_user_limit not re-opened after release (got %)',
      public.validate_promo('WELCOME10', 200);
  end if;
  raise notice 'PASS F-08 campaign: per_user_limit re-opened, no wallet movement';
end $$;

-- ---------------------------------------------------------------------------
-- NEGATIVE CONTROL: max_uses is NOT re-opened by release (a released row still
-- counts globally). Fill WELCOME10 to its cap of 5 with released rows and
-- confirm validate_promo returns 0.
-- ---------------------------------------------------------------------------
do $$ declare i int;
begin
  for i in 1..4 loop
    insert into public.orders values (('00000000-0000-0000-0000-00000000c10'||i)::uuid, 'placed');
    insert into public.promo_redemptions (promo_id, user_id, order_id, code, discount_egp, released_at)
      values ('c0000000-0000-0000-0000-000000000002',
              ('00000000-0000-0000-0000-0000000000d'||i)::uuid,
              ('00000000-0000-0000-0000-00000000c10'||i)::uuid, 'WELCOME10', 10, now());
  end loop;
  -- 5 redemptions now exist for WELCOME10 (1 from the campaign test + 4 here),
  -- all but caring: max_uses=5 reached. A DIFFERENT user must be refused.
end $$;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select 'a0000000-0000-0000-0000-000000000099'::uuid $$;
do $$
begin
  if public.validate_promo('WELCOME10', 200) <> 0 then
    raise exception 'NEG CONTROL FAIL: released rows did not count toward max_uses (got %)',
      public.validate_promo('WELCOME10', 200);
  end if;
  raise notice 'PASS neg: released rows still count toward max_uses (global cap held)';
end $$;

rollback;
select 'migration 205 test finished' as done;
