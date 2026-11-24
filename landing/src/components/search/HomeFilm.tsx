'use client';

import { useEffect, useRef } from 'react';

// The first frame is a responsive HTML image. The film is fetched only once a
// visitor scrolls the scene and only when their motion/data settings allow it.
export default function HomeFilm({ pin }: { pin: string }) {
  const layer = useRef<HTMLDivElement>(null);
  const film = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const root = layer.current;
    const video = film.current;
    const scene = root?.closest<HTMLElement>('[data-film-scene]');
    if (!root || !scene || !video) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const mobile = matchMedia('(max-width: 720px)');
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    let frame = 0;
    function update() {
      frame = 0;
      if (!root || !scene || !video) return;
      const bounds = scene.getBoundingClientRect();
      if (bounds.bottom < 0 || bounds.top > window.innerHeight) return;
      const travel = scene.offsetHeight - root.offsetHeight;
      const progress = Math.max(0, Math.min(1, -bounds.top / Math.max(1, travel)));
      const route = reduced.matches ? 1 : Math.max(0, Math.min(1, (progress - .34) / .55));
      root.style.setProperty('--draw', String(1 - route));
      root.style.setProperty('--pin', String(Math.max(0, (route - .8) * 5)));
      if (reduced.matches || connection?.saveData) {
        root.classList.remove('home-film-ready');
        return;
      }
      if (progress < .003 && !video.hasAttribute('src')) return;
      const src = '/home-media/' + (mobile.matches ? 'platter-mobile.mp4' : 'platter.mp4');
      if (video.getAttribute('src') !== src) {
        video.preload = 'auto';
        video.setAttribute('src', src);
        video.load();
        root.classList.remove('home-film-ready');
      }
      if (Number.isFinite(video.duration) && video.readyState >= 2 && !video.seeking) {
        const time = Math.min(Math.max(0, video.duration - .06), video.duration * progress);
        if (Math.abs(video.currentTime - time) > .075) video.currentTime = time;
        root.classList.add('home-film-ready');
      }
    }
    function request() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    request();
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request);
    reduced.addEventListener('change', request);
    mobile.addEventListener('change', request);
    video.addEventListener('loadeddata', request);
    video.addEventListener('seeked', request);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', request);
      window.removeEventListener('resize', request);
      reduced.removeEventListener('change', request);
      mobile.removeEventListener('change', request);
      video.removeEventListener('loadeddata', request);
      video.removeEventListener('seeked', request);
    };
  }, []);
  return <div className="home-film" ref={layer} aria-hidden="true">
    <picture>
      <source media="(max-width: 720px)" srcSet="/home-media/platter-mobile-poster.jpg" />
      <img src="/home-media/platter-poster.jpg" alt="" width="1920" height="1080" fetchPriority="high" />
    </picture>
    <video ref={film} muted playsInline preload="none" disableRemotePlayback />
    <svg className="home-route desktop-route" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice">
      <path pathLength="1" d="M1301 434 A184 184 0 0 1 1328 492 C1430 470 1480 520 1478 590 S1435 692 1450 748" />
      <g transform="translate(1450 764)"><circle r="16"/><text x="0" y="48" textAnchor="middle">{pin}</text></g>
    </svg>
    <svg className="home-route mobile-route" viewBox="0 0 1080 1920" preserveAspectRatio="xMidYMid slice">
      <path pathLength="1" d="M634 641 A276 276 0 0 1 735 705 C812 700 852 660 852 600 S800 520 820 480 Q834 452 868 430"/>
      <g transform="translate(868 418)"><circle r="15"/><text x="-26" y="6" textAnchor="end">{pin}</text></g>
    </svg>
  </div>;
}
