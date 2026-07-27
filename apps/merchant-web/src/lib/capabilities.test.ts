import { describe, expect, it } from 'vitest';
import {
  canEditMenu,
  canToggleOpen,
  deniedByNoRows,
  isManagerPlus,
  parseStaffRole,
  permissionDeniedCopy,
  staffRoleLabel,
  PERMISSION_DENIED_COPY,
} from './capabilities';

/**
 * These expectations are the DATABASE's tiers, not this module's code. The
 * source of truth is migration 136 (the column comment on
 * merchant_staff.staff_role) and its assertion suite at
 * supabase/tests/136_staff_role_assertions.sql, which was run against a local
 * Postgres: 40/40 passing. If a tier ever changes in SQL, these tests should
 * fail — that is the point of writing them this way round.
 */
describe('capability tiers match migration 136', () => {
  const cases: { role: string; managerPlus: boolean; why: string }[] = [
    { role: 'owner', managerPlus: true, why: 'seeded by apply_as_restaurant (123:157)' },
    { role: 'manager', managerPlus: true, why: 'collapsed with owner into one tier by mig 136' },
    { role: 'staff', managerPlus: false, why: 'line-cook tier: 86 + advance orders only' },
  ];

  it.each(cases)('$role → managerPlus=$managerPlus ($why)', ({ role, managerPlus }) => {
    expect(isManagerPlus(role)).toBe(managerPlus);
    // The privileged capabilities are one tier, so they must never disagree.
    expect(canEditMenu(role)).toBe(managerPlus);
    expect(canToggleOpen(role)).toBe(managerPlus);
  });

  // The DB assertion "staff CANNOT rewrite restaurants.payout_iban" and
  // "staff CANNOT change menu_items.price_egp" both passed; a staff account
  // that saw an enabled control would be shown a button that silently does
  // nothing (policy denials do not raise — see permissionDeniedCopy's doc).
  it('never offers a privileged control to the staff tier', () => {
    expect(canToggleOpen('staff')).toBe(false);
    expect(canEditMenu('staff')).toBe(false);
  });
});

describe('parseStaffRole fails closed', () => {
  it.each([undefined, null, '', '   ', 'Owner', 'OWNER', 'cook', 'admin', 'manager '])(
    'denies privileges for %p',
    (raw) => {
      expect(parseStaffRole(raw as string | null | undefined)).toBeNull();
      expect(isManagerPlus(raw as string | null | undefined)).toBe(false);
    },
  );

  it('does not treat a truthy unknown role as permission', () => {
    // The classic fail-open bug is `role !== 'staff'` — which passes for
    // garbage. Guard against that shape specifically.
    expect(isManagerPlus('supervisor')).toBe(false);
  });
});

describe('staffRoleLabel', () => {
  it('titlecases known roles', () => {
    expect(staffRoleLabel('owner')).toBe('Owner');
    expect(staffRoleLabel('manager')).toBe('Manager');
    expect(staffRoleLabel('staff')).toBe('Staff');
  });

  it('shows an unknown value through rather than lying about it', () => {
    expect(staffRoleLabel('cook')).toBe('cook');
  });

  it('falls back to Staff when there is nothing to show', () => {
    expect(staffRoleLabel('')).toBe('Staff');
    expect(staffRoleLabel(null)).toBe('Staff');
  });
});

describe('permissionDeniedCopy recognises how Postgres actually refuses', () => {
  // Shape 1: the menu_items trigger. Verified message text from
  // supabase/migrations/136_merchant_staff_role_enforcement.sql.
  it('matches the trigger sentinel', () => {
    expect(
      permissionDeniedCopy({
        code: '23514',
        message:
          'MANAGER_REQUIRED: changing price_egp on a menu item requires an owner or manager (you are staff)',
      }),
    ).toBe(PERMISSION_DENIED_COPY);
  });

  it('matches a bare grant refusal (42501)', () => {
    expect(permissionDeniedCopy({ code: '42501', message: 'permission denied for table restaurants' }))
      .toBe(PERMISSION_DENIED_COPY);
  });

  // The trap: mig 132's price CHECK and mig 136's trigger BOTH raise SQLSTATE
  // 23514, so the code cannot tell them apart — only the MANAGER_REQUIRED
  // sentinel can. Matching on the bare code would tell an OWNER who typed
  // 99999 EGP to "ask the restaurant owner or a manager": wrong advice, and it
  // buries the real reason (the price is out of range).
  it('does NOT misreport a mig-132 price-bounds violation as a permission problem', () => {
    expect(
      permissionDeniedCopy({
        code: '23514',
        message:
          'new row for relation "menu_items" violates check constraint "menu_items_price_bounds_chk"',
      }),
    ).toBeNull();
  });

  // Never swallow an unrelated failure — repo rule: errors are not silently
  // absorbed, and a network blip must keep its own message.
  it('returns null for errors that are not permission problems', () => {
    expect(permissionDeniedCopy({ code: '23505', message: 'duplicate key value' })).toBeNull();
    expect(permissionDeniedCopy({ message: 'Failed to fetch' })).toBeNull();
    expect(permissionDeniedCopy(null)).toBeNull();
    expect(permissionDeniedCopy(undefined)).toBeNull();
  });
});

describe('deniedByNoRows covers the silent RLS denial', () => {
  // This is the case with NO error object at all: Postgres filters the row out
  // of an UPDATE/DELETE and reports success. Confirmed against a local replica
  // on 2026-07-27 — a staff account's `update restaurants set is_open=false`
  // raised nothing and changed nothing.
  it('treats no-error + zero-rows as a refusal', () => {
    expect(deniedByNoRows(null, [])).toBe(true);
  });

  it('treats a row coming back as success', () => {
    expect(deniedByNoRows(null, [{ id: 'x' }])).toBe(false);
  });

  it('defers to the error path when there IS an error', () => {
    expect(deniedByNoRows({ code: '23514' }, [])).toBe(false);
  });

  it('reports nothing when rows were not selected (cannot know)', () => {
    // Without a chained .select('id') PostgREST returns null on success too;
    // reporting a denial there would be a false alarm.
    expect(deniedByNoRows(null, null)).toBe(false);
    expect(deniedByNoRows(null, undefined)).toBe(false);
  });
});
