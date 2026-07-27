import { describe, expect, it } from 'vitest';
import {
  canToggleOpenAll,
  isManagerPlus,
  parseStaffRole,
  permissionDeniedMessage,
  staffRoleLabel,
  PERMISSION_DENIED_COPY,
  STAFF_ROLES,
} from './capabilities';

/**
 * These assertions encode the SECURITY CONTRACT of migration 136, not the
 * shape of this file. Each expectation is written as the DB tier it mirrors —
 * see the column comment on merchant_staff.staff_role, which is canonical. If
 * a tier ever changes in SQL, one of these must fail.
 */

describe('parseStaffRole — fail closed on anything unrecognised', () => {
  it('accepts exactly the mig-136 CHECK vocabulary', () => {
    expect(STAFF_ROLES).toEqual(['owner', 'manager', 'staff']);
    for (const role of STAFF_ROLES) expect(parseStaffRole(role)).toBe(role);
  });

  it.each([
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['a platform role, not a staff role', 'admin'],
    ['wrong case — the DB CHECK would reject it too', 'Owner'],
    ['out-of-vocabulary', 'chef'],
    ['whitespace variant', ' owner '],
  ])('returns null for %s', (_label, value) => {
    expect(parseStaffRole(value as string | null | undefined)).toBeNull();
  });
});

describe('the manager+ tier', () => {
  // Migration 136 collapses owner+manager into ONE capability tier. price_egp,
  // menu structure, modifiers, restaurants.is_open and payout_* all key off it.
  it.each([
    ['owner', true],
    ['manager', true],
    ['staff', false],
  ])('isManagerPlus(%s) === %s', (role, expected) => {
    expect(isManagerPlus(role)).toBe(expected);
  });

  // House rule 4's client analogue: an unknown role must DENY, never fail open.
  it.each([null, undefined, '', 'chef', 'Owner'])(
    'denies the unknown role %p rather than failing open',
    (value) => {
      expect(isManagerPlus(value as string | null | undefined)).toBe(false);
    },
  );
});

describe('canToggleOpenAll — the cloud-kitchen case', () => {
  it('allows when every brand is manager+', () => {
    expect(canToggleOpenAll(['owner', 'manager'])).toBe(true);
  });

  it('denies when ANY brand is staff-tier, because the toggle writes them all at once', () => {
    // Promise.all over per-brand writes must not half-succeed: some storefronts
    // would flip and others silently would not, leaving the tablet disagreeing
    // with the server about which brands are taking orders.
    expect(canToggleOpenAll(['owner', 'staff'])).toBe(false);
  });

  it('denies an empty brand list', () => {
    expect(canToggleOpenAll([])).toBe(false);
  });

  it('denies when a brand carries an unrecognised role', () => {
    expect(canToggleOpenAll(['owner', 'chef'])).toBe(false);
  });
});

describe('staffRoleLabel', () => {
  it('capitalises the known vocabulary', () => {
    expect(staffRoleLabel('owner')).toBe('Owner');
    expect(staffRoleLabel('manager')).toBe('Manager');
    expect(staffRoleLabel('staff')).toBe('Staff');
  });

  it('shows an unknown value verbatim rather than mislabelling it', () => {
    expect(staffRoleLabel('chef')).toBe('chef');
  });

  it('falls back to Staff for empty/null', () => {
    expect(staffRoleLabel('')).toBe('Staff');
    expect(staffRoleLabel(null)).toBe('Staff');
  });
});

describe('permissionDeniedMessage — must recognise what the DB actually raises', () => {
  it('maps the mig-136 trigger refusal (23514 + MANAGER_REQUIRED) to role copy', () => {
    // This is the headline case: a staff account editing a price. The trigger
    // raises errcode check_violation, which is 23514 — the SAME code as the
    // mig-132 price-bounds CHECK. The sentinel in the message, not the code,
    // is what separates them.
    const err = {
      code: '23514',
      message: 'MANAGER_REQUIRED: changing price_egp on a menu item requires an owner or manager',
    };
    expect(permissionDeniedMessage(err)).toBe(PERMISSION_DENIED_COPY);
  });

  it('maps the restaurants is_open trigger refusal to role copy', () => {
    const err = {
      code: '23514',
      message: 'MANAGER_REQUIRED: changing is_open on a restaurant requires an owner or manager',
    };
    expect(permissionDeniedMessage(err)).toBe(PERMISSION_DENIED_COPY);
  });

  it('maps a grant/RLS insert refusal (42501) to role copy', () => {
    expect(permissionDeniedMessage({ code: '42501', message: 'permission denied for table menu_items' }))
      .toBe(PERMISSION_DENIED_COPY);
    expect(permissionDeniedMessage({ message: 'new row violates row-level security policy' }))
      .toBe(PERMISSION_DENIED_COPY);
  });

  it('does NOT misreport a mig-132 price-bounds violation as a permission problem', () => {
    // Both mig 132's CHECK and mig 136's trigger raise SQLSTATE 23514, so the
    // CODE cannot discriminate them — only the MANAGER_REQUIRED sentinel can.
    // Getting this wrong tells an OWNER who typed 99999 EGP to go ask a
    // manager: wrong, unactionable, and it hides the real reason.
    const priceBounds = {
      code: '23514',
      message:
        'new row for relation "menu_items" violates check constraint "menu_items_price_bounds_chk"',
    };
    expect(permissionDeniedMessage(priceBounds)).toBeNull();
  });

  it('does NOT swallow a genuine fault — it keeps its own message', () => {
    // A network failure is not a permission problem and must not be reported
    // as one, or the merchant is told to call their manager about a dead wifi.
    expect(permissionDeniedMessage(new Error('network request failed'))).toBeNull();
    expect(permissionDeniedMessage(null)).toBeNull();
    expect(permissionDeniedMessage(undefined)).toBeNull();
  });
});
