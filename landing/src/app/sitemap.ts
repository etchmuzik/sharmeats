import type { MetadataRoute } from 'next';
import { searchPaths } from '@/components/search/pages';
import {
  alternates,
  languages,
  localized,
  origin,
} from '@/components/search/routes';

export const dynamic = 'force-static';
export default function sitemap(): MetadataRoute.Sitemap {
  const marketing = searchPaths.flatMap((path) =>
    languages.map((lang) => ({
      url: origin + localized(lang, path),
      alternates: { languages: alternates(path) },
    })),
  );
  const policies = [
    'privacy',
    'terms',
    'partner-terms',
    'privacy-driver',
    'privacy-restaurant',
  ];
  return [
    ...marketing,
    ...policies.map((path) => ({ url: origin + '/' + path + '/' })),
  ];
}
