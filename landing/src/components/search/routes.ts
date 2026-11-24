export const languages = ['en', 'ar', 'ru', 'it', 'de'] as const;
export type Lang = (typeof languages)[number];
export const origin = 'https://sharmeats.online';
export const appStoreUrl =
  'https://apps.apple.com/eg/app/sharm-eats/id6776864451';

export function localized(lang: Lang, path = '') {
  const clean = path.replace(/^\/+|\/+$/g, '');
  const prefix = lang === 'en' ? '' : '/' + lang;
  return prefix + (clean ? '/' + clean : '') + '/';
}

export function parseRoute(parts: string[] = []) {
  const locale = languages.find((lang) => lang !== 'en' && parts[0] === lang);
  return {
    lang: locale ?? 'en',
    path: (locale ? parts.slice(1) : parts).join('/'),
  };
}

export function alternates(path: string) {
  return Object.fromEntries([
    ...languages.map((lang) => [lang, origin + localized(lang, path)]),
    ['x-default', origin + localized('en', path)],
  ]);
}
