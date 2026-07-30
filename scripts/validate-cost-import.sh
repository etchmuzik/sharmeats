#!/usr/bin/env bash
#
# validate-cost-import.sh — Package 06 Stage 1: makes the owner's recipe/cost
# spreadsheet trustworthy WITHOUT building an inventory system.
#
# The operating plan defers ERP until ~500 orders/month of invoices; until then
# costs live in a versioned CSV. This validator enforces the spec's rules —
# menu item ids exist AND belong to the stated restaurant, positive values, no
# duplicate (menu_item_id, effective_from) — and NEVER writes anything: the CSV
# is loaded into a TEMP table inside a transaction that always rolls back.
#
# CSV header (exact):
#   menu_item_id,restaurant_id,effective_from,food_cost_egp,packaging_cost_egp,source_invoice_refs,reviewer
#
# Usage:
#   DATABASE_URL=postgres://... scripts/validate-cost-import.sh costs.csv
#
# Exit: 0 valid, 1 validation failures, 2 misconfiguration.

set -euo pipefail

CSV="${1:-}"
if [[ -z "${DATABASE_URL:-}" || -z "$CSV" || ! -f "$CSV" ]]; then
  echo "usage: DATABASE_URL=... $0 <costs.csv>" >&2
  exit 2
fi

OUT="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qtA <<SQL
begin;
create temp table _cost_import (
  menu_item_id text, restaurant_id text, effective_from text,
  food_cost_egp text, packaging_cost_egp text,
  source_invoice_refs text, reviewer text
) on commit drop;
\\copy _cost_import from '$CSV' with (format csv, header true)

with parsed as (
  select row_number() over () as line, c.*,
         -- coalesce EVERYTHING: \copy turns empty CSV fields into NULL, and
         -- NULL ~ regex is NULL — without coalesce a blank id sailed through
         -- every check as neither-true-nor-false (caught by the functional
         -- test; the same fail-open class as house rule 4).
         coalesce(c.menu_item_id, '') ~ '^[0-9a-f-]{36}\$' as id_shape,
         coalesce(c.restaurant_id, '') ~ '^[0-9a-f-]{36}\$' as rest_shape,
         coalesce(c.effective_from, '') ~ '^\\d{4}-\\d{2}-\\d{2}\$' as date_shape,
         coalesce(c.food_cost_egp, '') ~ '^\\d+(\\.\\d+)?\$' as food_num,
         coalesce(c.packaging_cost_egp, '') ~ '^\\d+(\\.\\d+)?\$' as pack_num
    from _cost_import c
),
errors as (
  select line, 'malformed id/date/number' as err from parsed
   where not (id_shape and rest_shape and date_shape and food_num and pack_num)
  union all
  select line, 'food+packaging cost must be positive' from parsed
   where food_num and pack_num
     and (food_cost_egp::numeric <= 0 or packaging_cost_egp::numeric < 0)
  union all
  select line, 'menu item does not exist or does not belong to the stated restaurant'
    from parsed p
   where p.id_shape and p.rest_shape
     and not exists (select 1 from public.menu_items m
                      where m.id = p.menu_item_id::uuid
                        and m.restaurant_id = p.restaurant_id::uuid)
  union all
  select min(line), 'duplicate effective date for one menu item'
    from parsed where id_shape and date_shape
   group by menu_item_id, effective_from having count(*) > 1
  union all
  select line, 'reviewer is required — costs without a named reviewer are not evidence'
    from parsed where coalesce(btrim(reviewer), '') = ''
)
select coalesce(string_agg('line ' || line || ': ' || err, E'\\n' order by line),
                'VALID: ' || (select count(*) from parsed) || ' cost rows')
  from errors;
rollback;
SQL
)"

echo "$OUT"
[[ "$OUT" == VALID:* ]] || exit 1
