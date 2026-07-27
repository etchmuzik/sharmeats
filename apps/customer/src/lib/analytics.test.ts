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

import { buildProperties, isBannedProperty, setAnalyticsContext, __resetAnalyticsContext } from './analytics';

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
