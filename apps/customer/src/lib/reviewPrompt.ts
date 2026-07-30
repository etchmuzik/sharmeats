/**
 * Store-review prompt policy (Package 05 Slice F).
 *
 * The prompt already fires only at a genuinely positive moment — the customer
 * just rated a DELIVERED order >= 4/4 in the in-app review, which is direct
 * evidence, not an "are you happy?" pre-screen (everyone sees the same review
 * screen and the same Support path; nobody is routed away from the store).
 *
 * What was missing was CLIENT-side frequency discipline: every high-rated
 * review re-requested and only the OS throttled. This module adds the local
 * review_prompt_state the spec asks for:
 *   * cooldown — at most one request per COOLDOWN_DAYS;
 *   * once per app version after the first — a new version is a fair new ask,
 *     an unchanged one is nagging;
 *   * a hard lifetime cap, because a customer who has been asked three times
 *     has answered, whatever the OS showed.
 * Analytics keeps recording eligibility and the request only — never a claimed
 * displayed/reviewed outcome (the OS decides silently).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const KEY = '@sharmeats:reviewPrompt:v1';
const COOLDOWN_DAYS = 60;
const LIFETIME_CAP = 3;

interface PromptState {
  lastPromptedAt: string | null;
  promptCount: number;
  lastVersion: string | null;
}

async function read(): Promise<PromptState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<PromptState>;
      return {
        lastPromptedAt: typeof p.lastPromptedAt === 'string' ? p.lastPromptedAt : null,
        promptCount: typeof p.promptCount === 'number' ? p.promptCount : 0,
        lastVersion: typeof p.lastVersion === 'string' ? p.lastVersion : null,
      };
    }
  } catch {
    // corrupt state reads as "never prompted" — the OS still rate-limits
  }
  return { lastPromptedAt: null, promptCount: 0, lastVersion: null };
}

function appVersion(): string {
  return Constants.expoConfig?.version ?? 'unknown';
}

/** May we ask the OS this time? Returns the refusal reason for analytics. */
export async function reviewPromptEligibility(): Promise<
  { eligible: true } | { eligible: false; reason: 'cooldown' | 'same_version' | 'lifetime_cap' }
> {
  const s = await read();
  if (s.promptCount >= LIFETIME_CAP) return { eligible: false, reason: 'lifetime_cap' };
  if (s.lastPromptedAt) {
    const ageMs = Date.now() - Date.parse(s.lastPromptedAt);
    if (Number.isFinite(ageMs) && ageMs < COOLDOWN_DAYS * 86_400_000) {
      return { eligible: false, reason: 'cooldown' };
    }
    if (s.lastVersion === appVersion()) return { eligible: false, reason: 'same_version' };
  }
  return { eligible: true };
}

/** Record that we asked the OS (regardless of what it silently decided). */
export async function recordReviewPrompt(): Promise<void> {
  const s = await read();
  const next: PromptState = {
    lastPromptedAt: new Date().toISOString(),
    promptCount: s.promptCount + 1,
    lastVersion: appVersion(),
  };
  await AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
}
