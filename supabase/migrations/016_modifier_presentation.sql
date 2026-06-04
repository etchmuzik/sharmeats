-- 016_modifier_presentation.sql
-- Add the presentation columns the customer app's rich item UI relies on.
--
-- The app's TypeScript Modifier/ModifierOption types (apps/customer/src/data/
-- types.ts) carry `style`, `subtitle`, `step` (modifier) and `icon`, `subtitle`,
-- `popular`, `image`, `adds_flags` (option) — these drive the size pills,
-- ingredient chips ("No onions"), and add-on cards. But migration 002 only
-- created the bare modifier columns, so in live mode every group fell back to
-- the default 'list' style and the rich UI was lost.
--
-- These columns are additive and nullable; existing rows/RPCs are unaffected.
-- place_order does not read them (it sums price_delta_egp + snapshots name), so
-- pricing/authority is unchanged.

alter table public.modifiers
  add column if not exists style    text,            -- 'list'|'ingredients'|'addons'|'builder'|'size' (null => 'list')
  add column if not exists subtitle text,            -- helper line under the group title
  add column if not exists step     int;             -- builder-flow step order

alter table public.modifiers
  add constraint modifiers_style_chk
    check (style is null or style in ('list','ingredients','addons','builder','size')) not valid;
alter table public.modifiers validate constraint modifiers_style_chk;

alter table public.modifier_options
  add column if not exists icon      text,           -- emoji/icon for add-on cards ('🧀','🥓')
  add column if not exists subtitle  text,           -- tagline under the option name
  add column if not exists popular   boolean not null default false,  -- highlight a recommended option
  add column if not exists image     text,           -- optional thumbnail URL
  add column if not exists adds_flags item_flag_type[];            -- flags this option adds (e.g. bacon → contains_pork)

comment on column public.modifiers.style is
  'Presentation hint for the item modal: list (default radio/checkbox), ingredients (tap-to-remove chips), addons (cards), builder (labeled step), size (segmented pills).';
comment on column public.modifier_options.popular is
  'When true, the add-on card shows a ★ Popular badge.';
