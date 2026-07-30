'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { SignOutButton } from './SignOutButton';

interface NavItem {
  href: string;
  label: string;
}

interface NavGroup {
  label: string;
  items: readonly NavItem[];
}

const RESTAURANT_ITEMS: readonly NavItem[] = [
  { href: '/onboarding', label: 'Onboarding' },
  { href: '/menu', label: 'Menus' },
  { href: '/kyc', label: 'KYC review' },
  { href: '/scorecards', label: 'Scorecards' },
  { href: '/founding-rates', label: 'Founding rates' },
];

const FINANCE_ITEMS: readonly NavItem[] = [
  { href: '/finance', label: 'Restaurant settlements' },
  { href: '/driver-finance', label: 'Driver payouts' },
  { href: '/cash', label: 'Cash reconciliation' },
];

const MOBILE_GROUPS: readonly NavGroup[] = [
  { label: 'Operations', items: [{ href: '/', label: 'Dispatch' }] },
  { label: 'Restaurants', items: RESTAURANT_ITEMS },
  { label: 'Finance', items: FINANCE_ITEMS },
  { label: 'Growth', items: [{ href: '/campaigns', label: 'Campaigns' }] },
  { label: 'Support', items: [{ href: '/support', label: 'Support inbox' }] },
];

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

function DesktopLink({
  href,
  label,
  pathname,
  primary = false,
}: NavItem & { pathname: string; primary?: boolean }) {
  const active = isActive(pathname, href);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        active
          ? primary
            ? 'bg-ink text-white'
            : 'bg-sand text-ink'
          : 'text-ink2 hover:bg-sand hover:text-ink'
      }`}
    >
      {label}
    </Link>
  );
}

function DesktopGroup({
  label,
  items,
  pathname,
}: NavGroup & {
  pathname: string;
}) {
  const active = items.some((item) => isActive(pathname, item.href));
  return (
    <details className="group relative">
      <summary
        className={`flex cursor-pointer list-none items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors marker:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          active ? 'bg-sand text-ink' : 'text-ink2 hover:bg-sand hover:text-ink'
        }`}
      >
        {label}
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          aria-hidden="true"
          className="transition-transform group-open:rotate-180"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </summary>
      <div className="absolute left-0 top-full z-20 mt-2 min-w-56 overflow-hidden rounded-xl border border-line bg-white p-1.5 shadow-[0_12px_30px_rgba(16,14,18,0.12)]">
        {items.map((item) => {
          const itemActive = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={itemActive ? 'page' : undefined}
              className={`block rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${
                itemActive
                  ? 'bg-sand font-semibold text-ink'
                  : 'text-ink2 hover:bg-sand hover:text-ink'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </details>
  );
}

function MobileNav({ pathname }: { pathname: string }) {
  const activeItem =
    MOBILE_GROUPS.flatMap((group) => group.items).find((item) => isActive(pathname, item.href)) ??
    MOBILE_GROUPS[0].items[0];

  return (
    <details className="group border-t border-line md:hidden">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between py-2 text-sm font-semibold marker:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        <span>Navigation</span>
        <span className="flex items-center gap-2 text-ink2">
          {activeItem.label}
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            aria-hidden="true"
            className="transition-transform group-open:rotate-180"
          >
            <path d="m4 6 4 4 4-4" />
          </svg>
        </span>
      </summary>
      <nav aria-label="Admin navigation" className="grid gap-4 pb-4 sm:grid-cols-2">
        {MOBILE_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wider text-ink3">
              {group.label}
            </div>
            <div className="grid gap-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`rounded-lg px-2 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${
                      active
                        ? 'bg-sand font-semibold text-ink'
                        : 'text-ink2 hover:bg-sand hover:text-ink'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </details>
  );
}

export function AdminHeader({
  title,
  description,
  displayName,
  contextAction,
}: {
  title: string;
  description: string;
  displayName: string;
  contextAction?: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
      <div className="px-4 sm:px-6">
        <div className="flex min-h-16 items-center gap-3 py-2">
          <Link
            href="/"
            className="shrink-0 rounded leading-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label="Sharm Eats operations home"
          >
            <span className="block text-base font-extrabold">
              Sharm Eats <span className="text-accent">Ops</span>
            </span>
          </Link>
          <div className="hidden h-8 w-px bg-line sm:block" aria-hidden="true" />
          <div className="min-w-0 flex-1 leading-tight">
            <h1 className="truncate text-sm font-bold text-ink">{title}</h1>
            <div className="truncate text-xs text-ink3">
              {description} · {displayName}
            </div>
          </div>
          {contextAction && <div className="hidden shrink-0 sm:block">{contextAction}</div>}
          <SignOutButton />
        </div>

        {contextAction && <div className="pb-2 sm:hidden">{contextAction}</div>}

        <nav aria-label="Admin navigation" className="hidden items-center gap-1 border-t border-line py-2 md:flex">
          <DesktopLink href="/" label="Dispatch" pathname={pathname} primary />
          <DesktopGroup label="Restaurants" items={RESTAURANT_ITEMS} pathname={pathname} />
          <DesktopGroup label="Finance" items={FINANCE_ITEMS} pathname={pathname} />
          <DesktopLink href="/campaigns" label="Growth" pathname={pathname} />
          <DesktopLink href="/support" label="Support" pathname={pathname} />
        </nav>

        <MobileNav pathname={pathname} />
      </div>
    </header>
  );
}
