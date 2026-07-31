import { describe, it, expect, beforeEach, vi } from 'vitest';

// Native modules — mocked so the enrichment/deny-list LOGIC can be tested.
vi.mock('expo-constants', () => ({
  default: { expoConfig: { version: '1.1.0', ios: { buildNumber: '34' } } },
}));
vi.mock('expo-updates', () => ({
  updateId: null,
  channel: 'production',
  runtimeVersion: '1.1.0',
  isEmbeddedLaunch: true,
}));
vi.mock('@sentry/react-native', () => ({
  init: vi.fn(),
  setUser: vi.fn(),
  setContext: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock('posthog-react-native', () => ({ default: class {} }));

import {
  buildProperties,
  isBannedProperty,
  setAnalyticsContext,
  normaliseError,
  __resetAnalyticsContext,
} from './analytics';

beforeEach(() => {
  __resetAnalyticsContext();
});

describe('PII deny-list', () => {
  // Each of these is a real field this app holds. The spec forbids all of them
  // reaching analytics; this is the structural guarantee, not a style rule.
  it.each([
    'phone',
    'customer_phone',
    'email',
    'address',
    'delivery_address',
    'room',
    'roomNumber',
    'note',
    'notes',
    'kitchen_notes',
    'delivery_notes',
    'push_token',
    'token',
    'password',
    'message',
    'support_text',
    'lat',
    'lng',
    'coordinate',
  ])('rejects "%s"', (key) => {
    expect(isBannedProperty(key)).toBe(true);
  });

  it.each(['restaurant_id', 'order_id', 'zone', 'issue_code', 'quantity', 'campaign_id'])(
    'allows the legitimate property "%s"',
    (key) => {
      expect(isBannedProperty(key)).toBe(false);
    },
  );

  it('strips a banned property but still ships the rest of the event', () => {
    const props = buildProperties({ restaurant_id: 'r1', delivery_notes: 'ring twice, room 412' });
    expect(props.restaurant_id).toBe('r1');
    expect(props).not.toHaveProperty('delivery_notes');
  });

  it('leaks nothing when a call site passes only banned properties', () => {
    const props = buildProperties({ phone: '+201234567890', notes: 'leave at door' });
    const serialized = JSON.stringify(props);
    expect(serialized).not.toContain('201234567890');
    expect(serialized).not.toContain('leave at door');
  });

  it('is case-insensitive so camelCase cannot slip past', () => {
    expect(buildProperties({ roomNumber: '412' })).not.toHaveProperty('roomNumber');
    expect(buildProperties({ PushToken: 'x' })).not.toHaveProperty('PushToken');
  });

  it('does not throw when __DEV__ is undefined (regression)', () => {
    // The guard read the React Native `__DEV__` global bare, so hitting a
    // banned key OUTSIDE React Native threw a ReferenceError — the privacy
    // guard crashing the very call it was protecting.
    expect(typeof __DEV__).toBe('undefined');
    expect(() => buildProperties({ phone: '+20100' })).not.toThrow();
  });
});

describe('push-attribution id exemption (regression)', () => {
  // The 'message' fragment silently ate message_id and attributed_message_id in
  // PRODUCTION — every event lost the client half of P03-F push attribution,
  // while a comment claimed the ids "pass". These tests assert on the
  // post-buildProperties output, which is exactly what the old suite never did.
  const UUID = '3c9f5f2a-8f6e-4e6a-9d2b-1a2b3c4d5e6f';

  it('ships message_id when the value is a minted token', () => {
    const props = buildProperties({ message_id: UUID });
    expect(props.message_id).toBe(UUID);
  });

  it('ships attributed_message_id when the value is a minted token', () => {
    const props = buildProperties({ attributed_message_id: UUID });
    expect(props.attributed_message_id).toBe(UUID);
  });

  it('still DROPS an exempt key whose value is not a minted token', () => {
    // The exemption is structural, not a trust grant: free text under an
    // exempt key dies anyway.
    const props = buildProperties({ message_id: 'call me at +20100, room 412' });
    expect(props).not.toHaveProperty('message_id');
  });

  it('exempts by EXACT key only — fragment-adjacent keys still die', () => {
    for (const key of ['message', 'support_message', 'message_text', 'customer_message_id_note']) {
      expect(buildProperties({ [key]: UUID })).not.toHaveProperty(key);
    }
  });

  it('campaign ids never needed the exemption and still pass', () => {
    const props = buildProperties({ campaign_id: 'summer-24', attributed_campaign_id: 'summer-24' });
    expect(props.campaign_id).toBe('summer-24');
    expect(props.attributed_campaign_id).toBe('summer-24');
  });
});

describe('common property enrichment', () => {
  it('attaches release identity to every event', () => {
    const props = buildProperties();
    expect(props.app_version).toBe('1.1.0');
    expect(props.app_build).toBe('34');
    expect(props.app_channel).toBe('production');
    expect(props.app_is_embedded).toBe(true);
  });

  it('attaches locale, currency and auth state once set', () => {
    setAnalyticsContext({ locale: 'ar', currency: 'EUR', authState: 'signed_in' });
    const props = buildProperties();
    expect(props.locale).toBe('ar');
    expect(props.display_currency).toBe('EUR');
    expect(props.auth_state).toBe('signed_in');
  });

  it('records auth state without the identity behind it', () => {
    setAnalyticsContext({ authState: 'signed_in' });
    const serialized = JSON.stringify(buildProperties());
    expect(serialized).toContain('signed_in');
    expect(serialized).not.toMatch(/\+?\d{10,}/); // no phone-shaped value
  });

  it('lets a call site override context but never the deny-list', () => {
    setAnalyticsContext({ source: 'hotel' });
    const props = buildProperties({ acquisition_source: 'referral', phone: '+20100' });
    expect(props.acquisition_source).toBe('referral');
    expect(props).not.toHaveProperty('phone');
  });

  it('omits context keys that were never set rather than emitting undefined', () => {
    const props = buildProperties();
    expect(props).not.toHaveProperty('locale');
    expect(Object.values(props)).not.toContain(undefined);
  });

  it('drops undefined call-site values (PostHog rejects them)', () => {
    const props = buildProperties({ zone: undefined, restaurant_id: 'r1' });
    expect(props).not.toHaveProperty('zone');
    expect(props.restaurant_id).toBe('r1');
  });

  it('merges context updates instead of replacing them', () => {
    setAnalyticsContext({ locale: 'de' });
    setAnalyticsContext({ currency: 'USD' });
    const props = buildProperties();
    expect(props.locale).toBe('de');
    expect(props.display_currency).toBe('USD');
  });
});

describe('normaliseError', () => {
  // The bug this guards against: Sentry serialises non-Error values as
  // "Object captured as exception with keys: code, details, hint, message",
  // discarding the message and grouping unrelated failures together.
  it('turns a Supabase PostgrestError into an Error carrying its message', () => {
    const pg = {
      code: '23505',
      details: 'Key (phone)=(+201234567890) already exists.',
      hint: null,
      message: 'duplicate key value violates unique constraint',
    };
    const { error, extra } = normaliseError(pg);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('duplicate key value violates unique constraint');
    // Grouping key: distinct Postgres codes must not share one issue.
    expect(error.name).toBe('PostgrestError 23505');
    // Nothing is lost — details/hint survive as context.
    expect(extra).toEqual(pg);
  });

  it('gives different Postgres codes different grouping names', () => {
    const mk = (code: string) => ({ code, details: null, hint: null, message: 'boom' });
    expect(normaliseError(mk('23505')).error.name).toBe('PostgrestError 23505');
    expect(normaliseError(mk('PGRST202')).error.name).toBe('PostgrestError PGRST202');
  });

  it('passes real Errors through untouched so their stack survives', () => {
    const original = new TypeError('nope');
    const { error, extra } = normaliseError(original);
    expect(error).toBe(original);
    expect(error.name).toBe('TypeError');
    expect(extra).toBeUndefined();
  });

  it('does not mislabel an unrelated object that happens to have a code', () => {
    const { error, extra } = normaliseError({ code: 'X1', message: 'not postgrest' });
    expect(error.message).toBe('not postgrest');
    expect(error.name).toBe('Error');
    expect(extra).toEqual({ code: 'X1', message: 'not postgrest' });
  });

  it('handles a message-less object by serialising it', () => {
    const { error } = normaliseError({ a: 1 });
    expect(error.message).toBe('{"a":1}');
  });

  it('survives a circular object rather than throwing', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => normaliseError(circular)).not.toThrow();
    expect(normaliseError(circular).error).toBeInstanceOf(Error);
  });

  it.each([
    ['string', 'plain failure', 'plain failure'],
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
    ['number', 42, '42'],
  ])('wraps a bare %s', (_label, input, expected) => {
    const { error } = normaliseError(input);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(expected);
  });
});
