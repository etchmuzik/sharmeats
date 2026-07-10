import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth';
import {
  DriverFetchError,
  getActiveJob,
  getEarnings,
  getMyDriver,
  getOffers,
  respondToOffer,
  setOnline,
  subscribeOffers,
  type Assignment,
  type EarningsSummary,
  type Job,
} from '../src/jobs';
import * as Notifications from 'expo-notifications';
import { isStreaming, pingOnce, stopStreaming } from '../src/location';
import { unreadCount } from '../src/messages';
import { configureNotificationHandler, registerForPush, unregisterPush } from '../src/push';
import { colors, font, radius, spacing } from '../src/theme';
import { Icon } from '../src/components/Icon';
import { useToast } from '../src/components/Toast';

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { toast } = useToast();

  const [driver, setDriver] = useState<Awaited<ReturnType<typeof getMyDriver>>>(null);
  const [online, setOnlineState] = useState(false);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [offers, setOffers] = useState<Assignment[]>([]);
  const [earnings, setEarnings] = useState<EarningsSummary | null>(null);
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // [H-BIZ1] true = a fetch failed (network), distinct from "not a driver".
  const [loadError, setLoadError] = useState(false);
  const onlineRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const d = await getMyDriver();
      setDriver(d);
      setLoadError(false);
      if (!d) {
        setLoading(false);
        return;
      }
      setOnlineState(d.status !== 'offline');
      onlineRef.current = d.status !== 'offline';
      const [job, offs, earn, unread] = await Promise.all([
        getActiveJob(d.id),
        getOffers(d.id),
        getEarnings(d.id),
        // Badge is advisory — a count failure must not fail the whole load.
        unreadCount().catch(() => 0),
      ]);
      setActiveJob(job);
      setOffers(offs);
      setEarnings(earn);
      setUnreadMsgs(unread);
    } catch (e) {
      // [H-BIZ1] A transient fetch failure must NOT masquerade as "not a
      // registered driver". Flag an error state (retry) and keep prior data.
      if (e instanceof DriverFetchError || e instanceof Error) setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // [H-DRV1] When the app returns to the foreground (e.g. the driver came back
  // from Google Maps after navigating), re-seed the authoritative position and
  // restart the location watcher if a stream is meant to be running. Foreground
  // watchPositionAsync stops emitting while backgrounded, so current_geo would
  // otherwise stay frozen at the pickup point for the whole ride.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        // Re-seed current_geo (status preserved — pass nothing).
        pingOnce().catch(() => {});
        // If a delivery stream is active, refresh the active-job view so any
        // status change (or reassignment) while backgrounded is reflected.
        if (isStreaming()) load();
      }
    });
    return () => sub.remove();
  }, [load]);

  // Live offer sync via Realtime (order_assignments), independent of push. Makes
  // a new offer appear the instant dispatch creates it even when the app is open
  // and push is disabled — the previous paths (focus/foreground/push-tap) left a
  // gap for an idle-but-open driver. Subscribes once we know the driver; the
  // subscription self-resyncs on (re)connect so nothing is missed across drops.
  useEffect(() => {
    if (!driver) return;
    const unsub = subscribeOffers(driver.id, (offs) => setOffers(offs));
    return unsub;
  }, [driver?.id]);

  // Push notifications: register this device for delivery-offer pushes (H1) and
  // refresh the offer list when the driver taps a `new_offer` notification. Runs
  // once on the home screen, which is only reachable post-auth (so auth.uid() is
  // available for token registration). Best-effort — never blocks the screen.
  useEffect(() => {
    configureNotificationHandler();
    registerForPush();
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response: Notifications.NotificationResponse) => {
        const event = response.notification.request.content.data?.event;
        if (event === 'new_offer') load();
      },
    );
    return () => sub.remove();
  }, [load]);

  async function toggleOnline(next: boolean) {
    setOnlineState(next);
    onlineRef.current = next;
    try {
      await setOnline(next);
      if (next) {
        await pingOnce('online');
      } else {
        // [H-DRV3] Going offline MUST stop any running location stream. Otherwise
        // its throttled driver_ping keeps writing (and, before this fix, re-stamped
        // status back to on_job), so the driver could never actually go offline.
        await stopStreaming();
        await pingOnce('offline');
      }
    } catch {
      setOnlineState(!next); // revert on failure
      onlineRef.current = !next;
      toast("Couldn't update your status. Check your connection.", 'error');
    }
  }

  // Unregister this device's push token before signing out so the next driver on
  // the same device doesn't receive the previous account's offers.
  async function handleSignOut() {
    // [H-DRV3] Stop the stream first so a sign-out mid-delivery doesn't leave the
    // GPS watcher + pings running for the signed-out account.
    await stopStreaming();
    await unregisterPush();
    await signOut();
  }

  async function accept(a: Assignment) {
    try {
      await respondToOffer(a.id, true);
      await load();
      router.push(`/job/${a.order_id}`);
    } catch (e) {
      // A silently-failed accept could cost the driver a job — always surface it.
      toast(e instanceof Error ? e.message : "Couldn't accept the offer. Try again.", 'error');
    }
  }

  async function reject(a: Assignment) {
    try {
      await respondToOffer(a.id, false);
      setOffers((prev) => prev.filter((o) => o.id !== a.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't decline the offer.", 'error');
    }
  }

  // The countdown reached zero: dispatch_sweep has already expired this offer
  // server-side, so we just drop it locally — no reject RPC (that would send a
  // spurious decline). The Realtime subscription also refetches on the expiring
  // UPDATE, so this is belt-and-suspenders.
  function dismissOffer(assignmentId: string) {
    setOffers((prev) => prev.filter((o) => o.id !== assignmentId));
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  // [H-BIZ1] A fetch failed (network) — offer a retry rather than the terminal
  // "not a registered driver" screen. Only show "not registered" when the load
  // SUCCEEDED and there genuinely is no driver row.
  if (!driver && loadError) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg }}>
        <Text style={{ fontSize: font.sizes.xl, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
          Couldn't load your profile
        </Text>
        <Text style={{ marginTop: 8, color: colors.ink2, textAlign: 'center' }}>
          Check your connection and try again.
        </Text>
        <Pressable
          onPress={() => {
            setLoading(true);
            load();
          }}
          style={{ marginTop: 24, backgroundColor: colors.accent, borderRadius: radius.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.xl }}
        >
          <Text style={{ color: colors.white, fontWeight: '700' }}>Retry</Text>
        </Pressable>
        <Pressable onPress={handleSignOut} style={{ marginTop: 12, padding: 12 }}>
          <Text style={{ color: colors.ink3, fontWeight: '600' }}>Sign out</Text>
        </Pressable>
      </View>
    );
  }

  if (!driver) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg }}>
        <Text style={{ fontSize: font.sizes.xl, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
          Not a registered driver
        </Text>
        <Text style={{ marginTop: 8, color: colors.ink2, textAlign: 'center' }}>
          Your account isn't linked to a driver profile yet. Contact Sharm Eats ops to get set up.
        </Text>
        <Pressable onPress={handleSignOut} style={{ marginTop: 24, padding: 12 }}>
          <Text style={{ color: colors.accent, fontWeight: '600' }}>Sign out</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + 40 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      {/* Header */}
      <View style={{ paddingHorizontal: spacing.xl, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View>
          <Text style={{ fontSize: font.sizes.xxl, fontWeight: '800', color: colors.ink }}>
            Hi, {driver.name?.split(' ')[0] ?? 'Driver'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <Text style={{ color: colors.ink2, fontSize: font.sizes.sm }}>{driver.vehicle} ·</Text>
            <Icon name="star" size={12} color={colors.star} />
            <Text style={{ color: colors.ink2, fontSize: font.sizes.sm }}>
              {driver.rating}
              {!driver.is_verified && '  · pending verification'}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push('/tier')}
            accessibilityRole="button"
            accessibilityLabel="View my loyalty tier"
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}
          >
            <Icon name="trophy" size={14} color={colors.accent} />
            <Text style={{ color: colors.accent, fontWeight: '600', fontSize: font.sizes.sm }}>My tier</Text>
          </Pressable>
        </View>
        <Pressable onPress={handleSignOut} accessibilityRole="button" accessibilityLabel="Sign out">
          <Text style={{ color: colors.ink3, fontSize: font.sizes.sm }}>Sign out</Text>
        </Pressable>
      </View>

      {/* Online toggle */}
      <View
        style={{
          margin: spacing.xl,
          backgroundColor: online ? colors.accentSoft : colors.white,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: online ? colors.accent : colors.line,
          padding: spacing.xl,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <View>
          <Text style={{ fontSize: font.sizes.xl, fontWeight: '700', color: online ? colors.accentDark : colors.ink }}>
            {online ? "You're online" : "You're offline"}
          </Text>
          <Text style={{ color: colors.ink2, fontSize: font.sizes.sm, marginTop: 2 }}>
            {online ? 'Receiving delivery offers' : 'Go online to receive offers'}
          </Text>
        </View>
        <Switch
          value={online}
          onValueChange={toggleOnline}
          trackColor={{ true: colors.accent, false: colors.line }}
          disabled={!driver.is_verified}
        />
      </View>

      {/* Earnings */}
      {earnings && (
        <>
          <View style={{ flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.xl, marginBottom: spacing.md }}>
            <Stat label="Today" value={`${earnings.todayTotal} EGP`} />
            <Stat label="Deliveries" value={`${earnings.todayCount}`} />
            <Stat label="Tips today" value={`${earnings.todayTips} EGP`} />
            <Stat label="COD owed" value={`${earnings.codOwed} EGP`} warn={earnings.codOwed > 0} />
          </View>
          <Pressable
            onPress={() => router.push('/history')}
            accessibilityRole="button"
            accessibilityLabel="View delivery history"
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.xl, marginBottom: spacing.md }}
          >
            <Icon name="receipt" size={14} color={colors.accent} />
            <Text style={{ color: colors.accent, fontWeight: '600', fontSize: font.sizes.sm }}>Delivery history</Text>
            <Icon name="chevronForward" size={14} color={colors.accent} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/kyc')}
            accessibilityRole="button"
            accessibilityLabel="Verification documents"
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.xl, marginBottom: spacing.lg }}
          >
            <Icon name="person" size={14} color={colors.accent} />
            <Text style={{ color: colors.accent, fontWeight: '600', fontSize: font.sizes.sm }}>Verification documents</Text>
            <Icon name="chevronForward" size={14} color={colors.accent} />
          </Pressable>
        </>
      )}

      {/* Active job */}
      {activeJob && (
        <Pressable
          onPress={() => router.push(`/job/${activeJob.id}`)}
          style={{
            marginHorizontal: spacing.xl,
            marginBottom: spacing.lg,
            backgroundColor: colors.ink,
            borderRadius: radius.xl,
            padding: spacing.xl,
          }}
        >
          <Text style={{ color: colors.accentSoft, fontSize: font.sizes.xs, fontWeight: '700', textTransform: 'uppercase' }}>
            Active delivery
          </Text>
          <Text style={{ color: colors.white, fontSize: font.sizes.xl, fontWeight: '700', marginTop: 4 }}>
            {activeJob.short_code} · {activeJob.restaurant_name}
          </Text>
          <Text style={{ color: '#cfd6da', fontSize: font.sizes.sm, marginTop: 2 }}>
            {statusLabel(activeJob.status)} · tap to continue →
          </Text>
          {unreadMsgs > 0 && (
            <Pressable
              onPress={() => router.push(`/job/${activeJob.id}/chat`)}
              accessibilityRole="button"
              accessibilityLabel={`${unreadMsgs} unread messages — open chat`}
              style={{
                marginTop: spacing.md,
                alignSelf: 'flex-start',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                backgroundColor: colors.accent,
                borderRadius: radius.xl,
                paddingHorizontal: spacing.md,
                paddingVertical: 6,
              }}
            >
              <Icon name="chat" size={14} color={colors.ink} />
              <Text style={{ color: colors.ink, fontWeight: '700', fontSize: font.sizes.sm }}>
                {unreadMsgs} new message{unreadMsgs === 1 ? '' : 's'}
              </Text>
            </Pressable>
          )}
        </Pressable>
      )}

      {/* Offers */}
      <View style={{ paddingHorizontal: spacing.xl }}>
        <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: colors.ink2, textTransform: 'uppercase', marginBottom: spacing.md }}>
          {offers.length > 0 ? 'New offers' : 'No offers right now'}
        </Text>
        {offers.map((o) => (
          <OfferCard
            key={o.id}
            offer={o}
            onAccept={() => accept(o)}
            onDecline={() => reject(o)}
            onExpire={() => dismissOffer(o.id)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

/**
 * Live seconds-remaining until `expiresAt`, ticking once per second. Returns
 * null when there's no expiry timestamp (legacy rows). Clamps at 0. Fires
 * `onZero` exactly once, the first tick that reaches 0, so the parent can drop
 * the offer without fighting the server (dispatch_sweep already expired it).
 */
function useCountdown(expiresAt: string | null, onZero: () => void): number | null {
  const targetMs = expiresAt ? new Date(expiresAt).getTime() : null;
  const compute = () =>
    targetMs === null ? null : Math.max(0, Math.round((targetMs - Date.now()) / 1000));
  const [seconds, setSeconds] = useState<number | null>(compute);
  const firedRef = useRef(false);

  useEffect(() => {
    if (targetMs === null) {
      setSeconds(null);
      return;
    }
    firedRef.current = false;
    setSeconds(Math.max(0, Math.round((targetMs - Date.now()) / 1000)));
    const id = setInterval(() => {
      const remaining = Math.max(0, Math.round((targetMs - Date.now()) / 1000));
      setSeconds(remaining);
      if (remaining <= 0 && !firedRef.current) {
        firedRef.current = true;
        onZero();
      }
    }, 1000);
    return () => clearInterval(id);
    // Re-arm only when the expiry instant changes; onZero is a fresh closure each
    // render but the firedRef guard makes re-runs harmless.
  }, [targetMs]);

  return seconds;
}

/** Format seconds as m:ss, e.g. 42 -> "0:42", 90 -> "1:30". */
function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * A pending delivery offer. Shows the pickup restaurant, the driver's payout
 * (delivery fee + tip), and a live expiry countdown so drivers accept fast and
 * fewer offers silently lapse. The customer address/phone are intentionally NOT
 * shown pre-accept ([H-DRV2]) — only after accepting.
 */
function OfferCard({
  offer,
  onAccept,
  onDecline,
  onExpire,
}: {
  offer: Assignment;
  onAccept: () => void;
  onDecline: () => void;
  onExpire: () => void;
}) {
  const seconds = useCountdown(offer.offer_expires_at, onExpire);
  const payout = offer.delivery_fee_egp + offer.tip_egp;
  const urgent = seconds !== null && seconds <= 10;
  const expired = seconds !== null && seconds <= 0;

  return (
    <View
      style={{ backgroundColor: colors.white, borderWidth: 1, borderColor: colors.accent, borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.md }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: spacing.md }}>
          <Text style={{ fontSize: font.sizes.xs, fontWeight: '700', color: colors.ink2, textTransform: 'uppercase' }}>
            Pickup
          </Text>
          <Text style={{ fontWeight: '700', color: colors.ink, fontSize: font.sizes.lg, marginTop: 2 }}>
            {offer.restaurant_name}
          </Text>
        </View>
        {seconds !== null && (
          <View
            accessibilityLabel={expired ? 'Offer expired' : `Expires in ${formatCountdown(seconds)}`}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              backgroundColor: urgent ? colors.redSoft : colors.accentSoft,
              borderRadius: radius.lg,
              paddingHorizontal: spacing.md,
              paddingVertical: 4,
            }}
          >
            <Icon name="clock" size={13} color={urgent ? colors.red : colors.accentDark} />
            <Text style={{ color: urgent ? colors.red : colors.accentDark, fontWeight: '700', fontSize: font.sizes.sm }}>
              {expired ? 'Expired' : formatCountdown(seconds)}
            </Text>
          </View>
        )}
      </View>

      <Text style={{ color: colors.green, fontSize: font.sizes.base, fontWeight: '700', marginTop: spacing.md }}>
        You earn {payout} EGP
      </Text>

      <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
        <Pressable onPress={onDecline} style={{ flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center' }}>
          <Text style={{ color: colors.red, fontWeight: '600' }}>Decline</Text>
        </Pressable>
        <Pressable onPress={onAccept} style={{ flex: 1, backgroundColor: colors.green, borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center' }}>
          <Text style={{ color: colors.white, fontWeight: '700' }}>Accept</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: spacing.md }}>
      <Text style={{ fontSize: font.sizes.lg, fontWeight: '800', color: warn ? colors.amber : colors.ink }}>{value}</Text>
      <Text style={{ fontSize: font.sizes.xs, color: colors.ink2 }}>{label}</Text>
    </View>
  );
}

function statusLabel(s: Job['status']): string {
  return (
    {
      placed: 'Placed',
      accepted: 'Accepted',
      preparing: 'Preparing',
      ready: 'Ready for pickup',
      picked_up: 'Picked up',
      out_for_delivery: 'Out for delivery',
      delivered: 'Delivered',
      cancelled: 'Cancelled',
      rejected: 'Rejected',
    } as const
  )[s];
}
