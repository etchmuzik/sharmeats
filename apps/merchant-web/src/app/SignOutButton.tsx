'use client';

import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export function SignOutButton() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  return (
    <button
      onClick={async () => {
        await supabase.auth.signOut();
        router.replace('/login');
        router.refresh();
      }}
      className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink2 hover:bg-sand"
    >
      Sign out
    </button>
  );
}
