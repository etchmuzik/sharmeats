import type { MetadataRoute } from 'next';
import { origin } from '@/components/search/routes';

export const dynamic = 'force-static';
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/track/', '/go/'] },
    sitemap: origin + '/sitemap.xml',
  };
}
