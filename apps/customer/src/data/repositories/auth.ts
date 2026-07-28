/**
 * Mock auth adapter — no real session needed in mock mode.
 *
 * The mock data layer doesn't gate on auth; the local Zustand session store
 * (src/store/session.ts) plays the "logged in" role for the UI. These methods
 * exist only so the mock and Supabase facades share one shape.
 */
import type { SessionInfo } from '../supabase/auth';

const MOCK_USER_ID = 'u-guest';

/**
 * Mock-mode credential state.
 *
 * Mock mode has no real session, but identity teardown asks whether a
 * credential survived sign-out and then decides whether to establish a fresh
 * one. If this always answered "yes, still signed in", teardown would
 * permanently report a residual credential and never bootstrap. Tracking a
 * simple flag keeps the mock faithful to the CONTRACT rather than to the
 * transport.
 */
let mockSignedOut = false;

export const authRepo = {
  async currentUserId(): Promise<string | null> {
    return mockSignedOut ? null : MOCK_USER_ID;
  },
  async hasLocalCredential(): Promise<boolean> {
    return !mockSignedOut;
  },
  async ensureSession(): Promise<SessionInfo> {
    return { userId: MOCK_USER_ID, isAnonymous: true };
  },
  async sendOtp(_phone: string): Promise<void> {
    /* mock mode: pretend the SMS was sent. Any 6-digit code verifies. */
  },
  async verifyOtp(phone: string, _code: string): Promise<{ userId: string; phone: string }> {
    return { userId: MOCK_USER_ID, phone };
  },
  async signOut(): Promise<void> {
    mockSignedOut = true;
  },
  async deleteAccount(): Promise<void> {
    /* no-op in mock mode — nothing to delete server-side */
  },
};
