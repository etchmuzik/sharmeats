import { describe, expect, it } from 'vitest';
import {
  isSupportedLocale,
  localeDirection,
  localizedOperationalError,
  trackingNotificationCopy,
  translate,
  type TranslationKey,
} from './i18n';

describe('driver localization', () => {
  it('recognizes only supported persisted locale values', () => {
    expect(isSupportedLocale('en')).toBe(true);
    expect(isSupportedLocale('ar')).toBe(true);
    expect(isSupportedLocale('AR')).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
  });

  it('translates the same typed key in English and Arabic', () => {
    const key: TranslationKey = 'home.online';

    expect(translate('en', key)).toBe("You're online");
    expect(translate('ar', key)).toBe('أنت متصل الآن');
  });

  it('interpolates every repeated placeholder without changing identifiers', () => {
    expect(
      translate('ar', 'offer.acceptA11y', {
        restaurant: 'مطعم سينا',
        amount: '125',
      }),
    ).toBe('قبول العرض من مطعم سينا مقابل 125 ج.م');

    expect(translate('en', 'job.codeA11y', { code: 'SE-2048' })).toContain('SE-2048');
  });

  it('returns explicit local direction styles without requiring a native RTL restart', () => {
    expect(localeDirection('en')).toEqual({
      direction: 'ltr',
      textAlign: 'left',
      writingDirection: 'ltr',
    });
    expect(localeDirection('ar')).toEqual({
      direction: 'rtl',
      textAlign: 'right',
      writingDirection: 'rtl',
    });
  });

  it('maps known operational failures to actionable Arabic copy', () => {
    expect(
      localizedOperationalError('ar', 'signin', new Error('Invalid login credentials')),
    ).toBe('البريد الإلكتروني أو كلمة المرور غير صحيحة.');
    expect(
      localizedOperationalError('ar', 'signin', new Error('Unable to validate email address: invalid format')),
    ).toBe('أدخل بريدًا إلكترونيًا صحيحًا.');
    expect(
      localizedOperationalError('ar', 'offerAccept', new Error('offer has expired')),
    ).toBe('لم يعد هذا العرض متاحًا. جارٍ تحديث العروض.');
    expect(
      localizedOperationalError(
        'ar',
        'location',
        new Error('Background location permission denied'),
      ),
    ).toBe('اسمح للموقع بالعمل طوال الوقت من الإعدادات لبدء التوصيل.');
  });

  it('keeps raw diagnostics out of the primary localized error', () => {
    const raw = 'PGRST204 internal driver_respond diagnostic';

    expect(localizedOperationalError('ar', 'offerAccept', new Error(raw))).toBe(
      'تعذر قبول العرض. حدّث العروض وحاول مرة أخرى.',
    );
    expect(localizedOperationalError('ar', 'offerAccept', new Error(raw))).not.toContain(raw);
  });

  it('builds the Android tracking notification from a background-safe stored locale', () => {
    expect(trackingNotificationCopy('ar')).toEqual({
      title: 'توصيل شارم إيتس جارٍ',
      body: 'تتم مشاركة موقعك المباشر أثناء التوصيل النشط.',
    });
    expect(trackingNotificationCopy('unexpected')).toEqual({
      title: 'Sharm Eats delivery in progress',
      body: 'Sharing your live location for the active delivery.',
    });
  });
});
