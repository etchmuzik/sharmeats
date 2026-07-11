import { useEffect, useState } from 'react';
import { useSession } from '../store/session';
import { db, isBackendLive } from '../data';
import { CURRENT_TERMS_VERSION } from '../legal';
import { captureError } from '../lib/analytics';
import { TermsConsentModal } from './TermsConsentModal';

/**
 * Consent checkpoint. Mounted once (in the tabs layout) so it overlays the app
 * for a signed-in user whose recorded Terms acceptance is missing or stale, and
 * shows nothing for a returning user who already accepted the current version.
 *
 * Flow: on sign-in / app-open, read the user's terms_accepted_version. If it
 * doesn't match CURRENT_TERMS_VERSION, show the blocking sheet; "I agree" calls
 * record_terms_acceptance(CURRENT_TERMS_VERSION) and dismisses.
 *
 * Guests (unauthenticated browsing) are handled separately at checkout — this
 * gate only fires for a real, phone-verified session, so it doesn't nag anyone
 * who's merely browsing.
 */
export function TermsConsentGate() {
  const isSignedIn = useSession((s) => s.isSignedIn);
  const phone = useSession((s) => s.phone);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  // A "guest" session carries the sentinel phone 'guest' (see onboarding). Only
  // gate real, signed-in accounts here; guests consent at checkout instead.
  const isRealUser = isSignedIn && phone != null && phone !== 'guest';

  useEffect(() => {
    let cancelled = false;
    if (!isRealUser) {
      setNeedsConsent(false);
      return;
    }
    (async () => {
      try {
        const me = await db.user.getMe();
        if (cancelled) return;
        setNeedsConsent(me.termsAcceptedVersion !== CURRENT_TERMS_VERSION);
      } catch (e) {
        // Reading the profile failed (offline / transient). Fail OPEN — never
        // block the app over a fetch error; the checkpoint will re-evaluate on
        // the next app-open.
        if (!cancelled) setNeedsConsent(false);
        captureError(e, { where: 'consentGate.getMe' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isRealUser]);

  const agree = async () => {
    setBusy(true);
    try {
      await db.user.recordTermsAcceptance(CURRENT_TERMS_VERSION);
      setNeedsConsent(false);
    } catch (e) {
      captureError(e, { where: 'consentGate.record' });
      // In mock mode there's no backend; still dismiss so the demo isn't stuck.
      if (!isBackendLive) setNeedsConsent(false);
    } finally {
      setBusy(false);
    }
  };

  return <TermsConsentModal visible={needsConsent} busy={busy} onAgree={agree} />;
}
