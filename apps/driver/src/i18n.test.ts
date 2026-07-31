import { describe, expect, it } from 'vitest';
import {
  isSupportedLocale,
  localeDirection,
  localizedOperationalError,
  matchSupportedLocale,
  operationalErrorKey,
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
    expect(localizedOperationalError('ar', 'avatarUpload', new Error(raw))).toBe(
      'تعذر رفع الصورة. حاول مرة أخرى.',
    );
  });

  // THE REGRESSION. Every server-side failure in this system is a
  // SCREAMING_SNAKE_CASE sentinel, while the classifier matched space-separated
  // prose — so no branch ever fired and every field failure showed the same
  // generic "try again", regardless of whether the driver needed to refresh,
  // head home, or call ops.
  it('classifies the SCREAMING_SNAKE_CASE sentinels the server actually raises', () => {
    // driver_respond (mig 030)
    expect(operationalErrorKey('offerAccept', new Error('ALREADY_RESPONDED'))).toBe(
      'offer.noLongerAvailable',
    );
    expect(operationalErrorKey('offerAccept', new Error('NOT_YOUR_ASSIGNMENT'))).toBe(
      'offer.noLongerAvailable',
    );
    expect(operationalErrorKey('offerAccept', new Error('ASSIGNMENT_NOT_FOUND'))).toBe(
      'offer.noLongerAvailable',
    );
    expect(
      operationalErrorKey('offerAccept', new Error('OFFER_EXPIRED: this offer is no longer available')),
    ).toBe('offer.noLongerAvailable');
    expect(
      operationalErrorKey('offerAccept', new Error('ORDER_NOT_AVAILABLE: this order is already cancelled')),
    ).toBe('offer.noLongerAvailable');
    expect(
      operationalErrorKey(
        'offerAccept',
        new Error('DRIVER_NOT_ELIGIBLE: driver must be active and verified to accept'),
      ),
    ).toBe('home.notEligible');

    // advance_order_status (mig 103)
    expect(
      operationalErrorKey('jobUpdate', new Error('ILLEGAL_TRANSITION: preparing -> delivered')),
    ).toBe('job.statusChanged');
    expect(operationalErrorKey('jobUpdate', new Error('NOT_ASSIGNED_DRIVER'))).toBe(
      'job.assignmentChanged',
    );
    expect(operationalErrorKey('jobComplete', new Error('ORDER_NOT_FOUND'))).toBe('job.notFound');

    // Any SECURITY DEFINER RPC with a dead session.
    expect(operationalErrorKey('jobUpdate', new Error('AUTH_REQUIRED'))).toBe(
      'common.sessionExpired',
    );
  });

  it('maps a device locale tag to a locale we actually ship', () => {
    expect(matchSupportedLocale('ar-EG')).toBe('ar');
    expect(matchSupportedLocale('ar_EG')).toBe('ar');
    expect(matchSupportedLocale('en-GB')).toBe('en');
    // Nothing we ship: the caller keeps its own default rather than a bad guess.
    expect(matchSupportedLocale('ru-RU')).toBeNull();
    expect(matchSupportedLocale(undefined)).toBeNull();
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

  it('localizes the structured cash-change instruction without changing amounts', () => {
    expect(
      translate('en', 'cashChange.instruction', { tender: 600, change: 28 }),
    ).toBe('Customer will pay 600 EGP. Bring 28 EGP change.');
    expect(
      translate('ar', 'cashChange.instruction', { tender: 600, change: 28 }),
    ).toBe('سيدفع العميل 600 ج.م. أحضر 28 ج.م فكة.');
  });
});
