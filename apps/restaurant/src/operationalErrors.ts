import type { TranslationKey } from './i18n';

export type RestaurantOperationalFailure =
  | 'orderUpdate'
  | 'brandToggle'
  | 'menuLoad'
  | 'menuUpdate'
  | 'orderLoad'
  | 'logoUpload';

const ERROR_KEYS: Record<RestaurantOperationalFailure, TranslationKey> = {
  orderUpdate: 'home.updateOrderError',
  brandToggle: 'home.updateFailed',
  menuLoad: 'menu.loadError',
  menuUpdate: 'menu.updateError',
  orderLoad: 'detail.loadError',
  logoUpload: 'header.logoUploadError',
};

/** Client-owned recovery copy; raw diagnostics belong in crash reporting only. */
export function operationalErrorKey(
  failure: RestaurantOperationalFailure,
): TranslationKey {
  return ERROR_KEYS[failure];
}
