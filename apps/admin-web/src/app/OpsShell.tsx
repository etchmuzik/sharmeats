'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { mfaGate, mfaRouteRedirect } from '@/lib/mfa';
import {
  NAV_GROUPS,
  activeNavHref,
  isChromelessRoute,
  visibleNavItems,
  type NavItem,
} from './navItems';

/**
 * Persistent navigation for the ops dashboard, plus the offset its own sidebar
 * requires.
 *
 * Nav and offset are ONE component on purpose. Rendering the nav in the layout
 * and the `lg:pl-56` on a sibling wrapper looked tidier and was wrong: the two
 * can disagree. On /login the nav correctly renders nothing while the padding
 * still applies, which shoves the centred sign-in card 14rem to the right on
 * any large screen. Deciding both from the same state makes that impossible.
 *
 * The shell lives in the root layout so it survives navigation, and resolves
 * its own session + role rather than being handed them. That repeats one `users`
 * lookup each page already does, which is the right trade: the alternative is
 * threading auth state from eleven independently-gated client pages up into a
 * layout that renders above all of them.
 *
 * It renders NOTHING until the role is known. A nav that appears and then
 * rearranges — or shows admin destinations for a second before settling to a
 * dispatcher's three — is a worse first frame than no nav at all.
 */
export function OpsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<string | null | undefined>(undefined);
  const [name, setName] = useState<string>('');

  const chromeless = isChromelessRoute(pathname ?? '');

  useEffect(() => {
    // Skip the lookup entirely on /login — an unauthenticated visitor should not
    // trigger a users select that is guaranteed to return nothing.
    if (chromeless) {
      setRole(null);
      return;
    }
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        if (!cancelled) setRole(null);
        return;
      }
      const [{ data: me, error: roleError }, { data: aal, error: aalError }] = await Promise.all([
        supabase
          .from('users')
          .select('role, display_name')
          .eq('id', session.user.id)
          .single(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);
      if (cancelled) return;
      if (roleError || aalError || !me?.role) {
        setRole(null);
        await supabase.auth.signOut();
        if (!cancelled) router.replace('/login');
        return;
      }

      const resolvedRole = me.role as string;
      const gate = mfaGate(aal?.currentLevel, aal?.nextLevel, {
        enrollmentRequired: resolvedRole === 'admin',
      });
      const redirect = mfaRouteRedirect(pathname ?? '', resolvedRole, gate);
      if (redirect) {
        setRole(null);
        // A session that owes a challenge must not linger at aal1. Enrollment
        // is different: keep that session so /security can create the factor.
        if (redirect === '/login') await supabase.auth.signOut();
        if (!cancelled) router.replace(redirect);
        return;
      }

      // A failed lookup leaves role null, and visibleNavItems fails closed on
      // it — no sidebar rather than a speculative one.
      // During mandatory enrollment the /security page remains usable, but the
      // shell exposes no privileged navigation until the session reaches aal2.
      setRole(gate === 'enrollment_required' ? null : resolvedRole);
      setName((me?.display_name as string | undefined) ?? '');
    })();

    return () => {
      cancelled = true;
    };
  }, [chromeless, pathname, router]);

  const items = visibleNavItems(role);
  const showNav = !chromeless && role !== undefined && items.length > 0;

  if (!showNav) return <>{children}</>;

  const active = activeNavHref(pathname ?? '');

  const signOut = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  };

  return (
    <>
      {/* Desktop: a fixed rail. Eleven destinations do not fit across a top bar
          at a legible size, and this is a dashboard people keep open all day. */}
      <nav
        aria-label="Ops sections"
        className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-line bg-white lg:flex"
      >
        <div className="border-b border-line px-5 py-4">
          <div className="text-lg font-extrabold">
            Sharm Eats <span className="text-accent">Ops</span>
          </div>
          {name ? <div className="mt-0.5 truncate text-xs text-ink3">{name}</div> : null}
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group) => {
            const inGroup = items.filter((i) => i.group === group);
            if (inGroup.length === 0) return null;
            return (
              <div key={group} className="mb-5">
                <div className="px-2 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-ink3">
                  {group}
                </div>
                <ul className="space-y-0.5">
                  {inGroup.map((item) => (
                    <li key={item.href}>
                      <NavLink item={item} active={item.href === active} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="border-t border-line p-3">
          <button
            onClick={signOut}
            className="w-full rounded-lg border border-line px-3 py-2 text-sm text-ink2 hover:bg-sand"
          >
            Sign out
          </button>
        </div>
      </nav>

      {/* Below lg: the same destinations as a scrolling strip. Deliberately NOT
          sticky — every page already pins its own header to top-0, and a second
          sticky bar at the same offset simply covers it. */}
      <nav
        aria-label="Ops sections"
        className="flex gap-1.5 overflow-x-auto border-b border-line bg-white px-3 py-2 lg:hidden"
      >
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.href === active ? 'page' : undefined}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold ${
              item.href === active ? 'bg-ink text-white' : 'text-ink2 hover:bg-sand'
            }`}
          >
            {item.label}
          </Link>
        ))}
        <button
          onClick={signOut}
          className="ml-auto whitespace-nowrap rounded-lg border border-line px-3 py-1.5 text-sm text-ink2 hover:bg-sand"
        >
          Sign out
        </button>
      </nav>

      <div className="lg:pl-56">{children}</div>
    </>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={`block rounded-lg px-3 py-2 text-sm font-semibold ${
        active ? 'bg-accentsoft text-accentdark' : 'text-ink2 hover:bg-sand hover:text-ink'
      }`}
    >
      {item.label}
    </Link>
  );
}
