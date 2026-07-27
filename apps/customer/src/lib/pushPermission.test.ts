import { describe, it, expect } from 'vitest';
import {
  decidePermissionAction,
  shouldShowPrimer,
  permissionAnalytics,
  type PermissionState,
} from './pushPermission';

const IOS = { isDevice: true, platform: 'ios' };
const ANDROID = { isDevice: true, platform: 'android' };

describe('decidePermissionAction', () => {
  it('registers without prompting when permission already exists', () => {
    // The returning-user path: startup must get a token and show NO dialog.
    expect(decidePermissionAction({ status: 'granted' }, IOS)).toBe('register');
    expect(decidePermissionAction({ status: 'granted' }, ANDROID)).toBe('register');
  });

  it('treats iOS provisional authorisation as registerable', () => {
    // status 3 = PROVISIONAL: notifications arrive quietly, no dialog is ever
    // shown, and a token IS obtainable. Treating it as "not granted" would
    // silently drop every provisional user.
    expect(
      decidePermissionAction({ status: 'undetermined', ios: { status: 3 } }, IOS),
    ).toBe('register');
  });

  it('does not treat Android as provisional (there is no such state)', () => {
    expect(
      decidePermissionAction({ status: 'undetermined', ios: { status: 3 } }, ANDROID),
    ).toBe('may_prompt');
  });

  it('allows a prompt only when the OS would actually show one', () => {
    expect(decidePermissionAction({ status: 'undetermined', canAskAgain: true }, IOS)).toBe(
      'may_prompt',
    );
  });

  it('never re-asks after a denial', () => {
    // iOS shows its dialog once. Asking again resolves instantly with no UI,
    // which would let us "ask" forever while the customer sees nothing.
    expect(decidePermissionAction({ status: 'denied' }, IOS)).toBe('settings_only');
  });

  it('respects canAskAgain=false even when the status is undetermined', () => {
    expect(
      decidePermissionAction({ status: 'undetermined', canAskAgain: false }, ANDROID),
    ).toBe('settings_only');
  });

  it('is unsupported on a simulator (a simulator cannot receive a push)', () => {
    expect(decidePermissionAction({ status: 'granted' }, { isDevice: false, platform: 'ios' })).toBe(
      'unsupported',
    );
  });

  it('is unsupported on web', () => {
    expect(decidePermissionAction({ status: 'granted' }, { isDevice: true, platform: 'web' })).toBe(
      'unsupported',
    );
  });

  it('falls back to may_prompt when the OS state cannot be read', () => {
    // Failing closed here would mean never asking; failing open shows a primer
    // the customer can decline. The primer is ours, so it is the safe default.
    expect(decidePermissionAction(null, IOS)).toBe('may_prompt');
  });

  it('grant wins over a stale canAskAgain=false', () => {
    expect(
      decidePermissionAction({ status: 'granted', canAskAgain: false }, IOS),
    ).toBe('register');
  });
});

describe('shouldShowPrimer', () => {
  it('shows the primer when the OS would respond and we have not asked', () => {
    expect(shouldShowPrimer('may_prompt', false)).toBe(true);
  });

  it('does not nag after the customer declined OUR primer', () => {
    // The OS would still show its dialog, but re-asking is how an app teaches
    // people to refuse reflexively.
    expect(shouldShowPrimer('may_prompt', true)).toBe(false);
  });

  it('never shows the primer when permission already exists', () => {
    expect(shouldShowPrimer('register', false)).toBe(false);
  });

  it('never shows the primer when only device settings can help', () => {
    expect(shouldShowPrimer('settings_only', false)).toBe(false);
  });

  it('never shows the primer on an unsupported platform', () => {
    expect(shouldShowPrimer('unsupported', false)).toBe(false);
  });
});

describe('permissionAnalytics', () => {
  it('emits bounded properties only', () => {
    const p = permissionAnalytics('first_order', 'granted');
    expect(p).toEqual({ context: 'first_order', result: 'granted' });
  });

  it('never carries a push token', () => {
    // Package 01 §4 forbids a token in analytics; the deny-list in track() is
    // the backstop, but this shape must not offer one in the first place.
    const p = permissionAnalytics('marketing_opt_in', 'denied') as Record<string, unknown>;
    expect(Object.keys(p).sort()).toEqual(['context', 'result']);
    expect(JSON.stringify(p)).not.toContain('ExponentPushToken');
  });
});
