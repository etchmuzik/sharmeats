import { describe, expect, it } from 'vitest';
import { translate } from './i18n';
import { operationalErrorKey } from './operationalErrors';

describe('restaurant operational error copy', () => {
  it('maps every core failure to typed client-owned copy', () => {
    expect(operationalErrorKey('orderUpdate')).toBe('home.updateOrderError');
    expect(operationalErrorKey('brandToggle')).toBe('home.updateFailed');
    expect(operationalErrorKey('menuLoad')).toBe('menu.loadError');
    expect(operationalErrorKey('menuUpdate')).toBe('menu.updateError');
    expect(operationalErrorKey('orderLoad')).toBe('detail.loadError');
    expect(operationalErrorKey('logoUpload')).toBe('header.logoUploadError');
  });

  it('never returns a raw Supabase diagnostic to an Arabic operator', () => {
    const raw = 'PGRST204 relation menu_items violates internal policy';
    const copy = translate('ar', operationalErrorKey('menuUpdate'));

    expect(copy).toBe('تعذر تحديث العنصر');
    expect(copy).not.toContain(raw);
  });
});
