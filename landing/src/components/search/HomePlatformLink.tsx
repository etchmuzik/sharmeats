'use client';

import { useEffect, useState } from 'react';

type Props = {
  iphoneHref: string; iphoneLabel: string;
  androidHref: string; androidLabel: string;
};

export default function HomePlatformLink({ iphoneHref, iphoneLabel, androidHref, androidLabel }: Props) {
  const [android, setAndroid] = useState(false);
  useEffect(() => { setAndroid(/\bAndroid\b/i.test(navigator.userAgent)); }, []);
  return <a className="home-btn home-nav-app" href={android ? androidHref : iphoneHref}>
    {android ? androidLabel : iphoneLabel} <span aria-hidden="true">↗</span>
  </a>;
}
