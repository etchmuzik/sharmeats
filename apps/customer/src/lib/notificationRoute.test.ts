/**
 * Notification route allow-list (Package 03 Slice F).
 *
 * A push payload is unsigned remote input, and before this the rule was
 * `startsWith('/') && !startsWith('//')` — a shape check that accepted traversal,
 * query/fragment smuggling, and two real screens that must never be push-reachable
 * (/signin, /delete-account).
 *
 * The tests below are split into three groups on purpose:
 *   * the destinations that MUST work, or notifications silently stop routing;
 *   * the destinations that MUST NOT work, which is the security boundary;
 *   * the payload precedence rules, so old senders and old binaries keep working.
 */
import { describe, it, expect } from 'vitest';
import { isAllowedRoute, routeDestination, routeForNotification } from './notificationRoute';

const UUID = '11111111-2222-3333-4444-555555555555';

describe('routes that must be reachable', () => {
  const allowed = [
    `/order/${UUID}`,
    `/order/${UUID}/chat`,
    `/order/${UUID}/review`,
    `/item/${UUID}`,
    `/restaurant/${UUID}`,
    '/support',
    '/saved',
    '/invite',
    '/help',
    '/settings',
    '/home',
    '/(tabs)/home',
    '/orders',
    '/(tabs)/orders',
    '/browse',
    '/rewards',
    '/profile',
    '/',
  ];
  for (const route of allowed) {
    it(`allows ${route}`, () => {
      expect(isAllowedRoute(route)).toBe(true);
    });
  }
});

describe('routes that must NOT be reachable', () => {
  const denied: Array<[string, string]> = [
    ['/signin', 'a push that opens a sign-in prompt is a credential-phishing shape'],
    ['/otp', 'same reason as /signin'],
    ['/delete-account', 'destructive, never push-initiated'],
    ['/checkout', 'money-adjacent; a tap must not enter a payment flow'],
    ['/onboarding', 'resets first-run state'],
    ['/address/add', 'mutates saved personal data'],
    ['/address/picker', 'mutates saved personal data'],
    ['/payment/picker', 'mutates saved payment data'],
    ['/edit-profile', 'mutates personal data'],
    ['/settings/allergies', 'not anchored on the allow-list; only /settings is'],
  ];
  for (const [route, why] of denied) {
    it(`denies ${route} — ${why}`, () => {
      expect(isAllowedRoute(route)).toBe(false);
    });
  }
});

describe('malicious and malformed routes', () => {
  const attacks: Array<[string, string]> = [
    ['//evil.com', 'protocol-relative URL'],
    ['///evil.com', 'protocol-relative with extra slash'],
    ['https://evil.com', 'absolute URL, not an in-app path'],
    ['/../../admin', 'traversal'],
    ['/order/../signin', 'traversal to a denied screen'],
    ['/support/../signin', 'traversal past an allowed prefix'],
    ['/%2e%2e/signin', 'encoded traversal'],
    ['/%2E%2E/signin', 'encoded traversal, upper case'],
    ['/order\\..\\signin', 'backslash traversal'],
    [`/order/${UUID}?next=/signin`, 'query smuggling'],
    [`/order/${UUID}#/../signin`, 'fragment smuggling'],
    ['/support?x=1', 'query on an allowed route'],
    ['/support ', 'trailing whitespace'],
    [' /support', 'leading whitespace'],
    ['/sup port', 'internal whitespace'],
    ['', 'empty string'],
    ['support', 'no leading slash'],
    ['/order/not-a-uuid', 'order id that is not a uuid'],
    ['/order/', 'order route with no id'],
    [`/order/${UUID}/edit`, 'unknown sub-route under a known prefix'],
    [`/item/${UUID}/../signin`, 'traversal after a valid id'],
    ['/HOME', 'case must not be widened'],
    [`/${'a'.repeat(300)}`, 'absurdly long path'],
  ];
  for (const [route, why] of attacks) {
    it(`rejects ${JSON.stringify(route)} — ${why}`, () => {
      expect(isAllowedRoute(route)).toBe(false);
    });
  }

  it('rejects a control character used to sneak past a naive comparison', () => {
    // The classic trick: a NUL, newline or DEL that a string check ignores but a
    // downstream parser does not. Built with escapes so the bytes survive editing.
    expect(isAllowedRoute('/support' + String.fromCharCode(0))).toBe(false);
    expect(isAllowedRoute('/support' + String.fromCharCode(10) + '/signin')).toBe(false);
    expect(isAllowedRoute('/support' + String.fromCharCode(13))).toBe(false);
    expect(isAllowedRoute('/support' + String.fromCharCode(9))).toBe(false);
    expect(isAllowedRoute('/support' + String.fromCharCode(127))).toBe(false);
    expect(isAllowedRoute(String.fromCharCode(0) + '/support')).toBe(false);
  });

  it('still allows the (tabs) group form, whose parentheses are legitimate', () => {
    // Guards against a character-class fix that over-rejects and silently breaks
    // every tab-targeted notification.
    expect(isAllowedRoute('/(tabs)/home')).toBe(true);
    expect(isAllowedRoute('/(tabs)/rewards')).toBe(true);
  });
});

describe('routeForNotification precedence', () => {
  it('prefers an explicit allow-listed route', () => {
    expect(routeForNotification({ route: '/rewards', orderId: UUID })).toBe('/rewards');
  });

  it('falls back to the order route when the explicit one is not allowed', () => {
    // A sender naming a bad route must not break routing entirely — the historical
    // orderId path still works, which is what old notifications rely on.
    expect(routeForNotification({ route: '/signin', orderId: UUID })).toBe(`/order/${UUID}`);
  });

  it('routes support_reply to /support with no order', () => {
    expect(routeForNotification({ event: 'support_reply' })).toBe('/support');
  });

  it('routes new_message to the order chat', () => {
    expect(routeForNotification({ event: 'new_message', orderId: UUID })).toBe(
      `/order/${UUID}/chat`,
    );
  });

  it('validates the DERIVED route too — a junk orderId yields null, not /order/junk', () => {
    // orderId is as untrusted as `route`. Before the allow-list this built
    // `/order/<junk>` and handed it to the router.
    expect(routeForNotification({ orderId: 'not-a-uuid' })).toBeNull();
    expect(routeForNotification({ event: 'new_message', orderId: '../signin' })).toBeNull();
  });

  it('returns null for an empty or absent payload', () => {
    expect(routeForNotification(undefined)).toBeNull();
    expect(routeForNotification({})).toBeNull();
  });

  it('ignores non-string payload fields rather than coercing them', () => {
    expect(routeForNotification({ route: 42, orderId: null } as never)).toBeNull();
  });
});

describe('routeDestination', () => {
  it('reduces an order route to its first segment, carrying no id', () => {
    const dest = routeDestination(`/order/${UUID}`);
    expect(dest).toBe('order');
    expect(dest).not.toContain(UUID);
  });

  it('unwraps the (tabs) group so the destination is the real screen', () => {
    expect(routeDestination('/(tabs)/home')).toBe('home');
  });

  it('handles the root route', () => {
    expect(routeDestination('/')).toBe('unknown');
  });
});
