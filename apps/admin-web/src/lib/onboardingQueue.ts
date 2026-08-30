/**
 * The onboarding queue includes negotiated commission rates. It must be read
 * through migration 220's MFA-gated exact-projection RPC, never directly from
 * `restaurants`: anonymous Supabase sessions have the authenticated database
 * role and therefore cannot be treated as administrator transport authority.
 */
export type OnboardingQueueStatus = 'submitted' | 'rejected';

export interface OnboardingQueueRow {
  id: string;
  name: string;
  zone: string;
  phone: string | null;
  created_at: string;
  onboarding_status: OnboardingQueueStatus;
  onboarding_rejection_reason: string | null;
  commission_pct: number;
}

interface OnboardingQueueResponse {
  data: OnboardingQueueRow[] | null;
  error: unknown | null;
}

export interface OnboardingQueueLoadResult {
  data: OnboardingQueueRow[];
  error: unknown | null;
}

/** The narrow part of SupabaseClient used here, keeping the sensitive RPC explicit. */
export interface OnboardingQueueClient {
  rpc(
    functionName: 'admin_onboarding_queue',
    args: { p_status: OnboardingQueueStatus },
  ): PromiseLike<OnboardingQueueResponse>;
}

export async function loadOnboardingQueue(
  client: OnboardingQueueClient,
  status: OnboardingQueueStatus,
): Promise<OnboardingQueueLoadResult> {
  const { data, error } = await client.rpc('admin_onboarding_queue', { p_status: status });

  // A real RPC failure must remain distinguishable from an empty queue; callers
  // use `error` to show an operator-visible failure instead of a false all-clear.
  return { data: data ?? [], error };
}
