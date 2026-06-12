/**
 * Mock auth adapter — no real session needed in mock mode.
 *
 * The mock data layer doesn't gate on auth; the local Zustand session store
 * (src/store/session.ts) plays the "logged in" role for the UI. These methods
 * exist only so the mock and Supabase facades share one shape.
 */
import type { SessionInfo } from '../supabase/auth';

const MOCK_USER_ID = 'u-guest';

export const authRepo = {
  async currentUserId(): Promise<string | null> {
    return MOCK_USER_ID;
  },
  async ensureSession(): Promise<SessionInfo> {
    return { userId: MOCK_USER_ID, isAnonymous: true };
  },
  async signOut(): Promise<void> {
    /* no-op in mock mode */
  },
  async deleteAccount(): Promise<void> {
    /* no-op in mock mode — nothing to delete server-side */
  },
};
