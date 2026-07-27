/**
 * Push permission decisions, split out so they can be tested without the OS.
 *
 * WHY THIS EXISTS (Package 03 Slice B). registerForPush() used to do two
 * different jobs in one call: ASK the OS for permission, and REGISTER a token.
 * Because the root layout calls it on every launch, a brand-new customer saw
 * the system permission dialog before they had seen a single restaurant — with
 * no explanation of what they were being asked for. That is the single easiest
 * way to lose a permission permanently: iOS only ever shows the OS dialog once,
 * so a reflexive "Don't Allow" at first launch is unrecoverable in-app.
 *
 * Splitting the two jobs means:
 *   * startup can register a token WITHOUT prompting, whenever permission
 *     already exists (returning users, and anyone who enabled it in Settings);
 *   * the OS is asked only after a primer at a value moment, when the customer
 *     knows what they are agreeing to;
 *   * a denial is respected -- we never ask the OS again, because it would not
 *     show anything anyway. We show "open device settings" instead.
 *
 * It also fixes a real bug in the old flow: someone who denied, then enabled
 * notifications in iOS Settings, never got a token, because startup's only path
 * to registration ran through a request that the OS silently refused to show.
 */

/** The subset of expo-notifications' permission shape that we act on. */
export interface PermissionState {
  status: 'granted' | 'denied' | 'undetermined';
  /** iOS provisional authorisation: quiet notifications, no dialog shown. */
  ios?: { status?: number } | null;
  canAskAgain?: boolean;
}

export type PermissionDecision =
  /** Permission exists (or is provisional). Register a token; do not prompt. */
  | 'register'
  /** No permission yet and the OS will still show a dialog -- primer first. */
  | 'may_prompt'
  /** Denied, or the OS will not show a dialog again. Offer device settings. */
  | 'settings_only'
  /** Not applicable at all (simulator, web). */
  | 'unsupported';

export interface PermissionContext {
  isDevice: boolean;
  platform: 'ios' | 'android' | 'web' | string;
}

/**
 * What should happen given the current OS permission state.
 *
 * Deliberately a pure function of state: every branch is testable, and the
 * decision cannot drift between the startup path and the primer path because
 * both ask this.
 */
export function decidePermissionAction(
  perm: PermissionState | null,
  ctx: PermissionContext,
): PermissionDecision {
  // A simulator cannot receive a real push, and web is not a target here.
  if (!ctx.isDevice || ctx.platform === 'web') return 'unsupported';
  if (!perm) return 'may_prompt';

  if (perm.status === 'granted') return 'register';

  // iOS provisional (status 3 = PROVISIONAL): notifications are delivered
  // quietly with no dialog ever shown. A token IS obtainable, so treating this
  // as "not granted" would silently drop those users.
  if (ctx.platform === 'ios' && perm.ios?.status === 3) return 'register';

  // canAskAgain === false means the OS will not display a dialog, so calling
  // requestPermissionsAsync would resolve instantly with no user interaction --
  // indistinguishable from a fresh denial, and it would let us re-"ask" forever
  // while the customer sees nothing.
  if (perm.status === 'denied' || perm.canAskAgain === false) return 'settings_only';

  return 'may_prompt';
}

/**
 * Should the contextual primer be shown right now?
 *
 * The primer is the screen we control, shown BEFORE the OS dialog. It is worth
 * showing only when the OS would actually respond to a request.
 *
 * `alreadyAsked` is our own record, not the OS's: once the customer has
 * declined OUR primer we stop asking, even though the OS would still show its
 * dialog. Nagging is how an app trains people to refuse.
 */
export function shouldShowPrimer(
  decision: PermissionDecision,
  alreadyAsked: boolean,
): boolean {
  return decision === 'may_prompt' && !alreadyAsked;
}

/**
 * Bounded analytics label for a permission outcome.
 *
 * The token itself must NEVER be recorded (Package 01 §4 privacy rule), and
 * the prompt context is bounded so it cannot become free text.
 */
export type PrimerContext = 'first_order' | 'marketing_opt_in' | 'settings';

export function permissionAnalytics(
  context: PrimerContext,
  result: 'primer_shown' | 'primer_declined' | 'granted' | 'denied' | 'settings_opened',
): { context: PrimerContext; result: string } {
  return { context, result };
}
