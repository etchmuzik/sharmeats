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
  type Assignment,
  type EarningsSummary,
  type Job,
} from '../src/jobs';
import * as Notifications from 'expo-notifications';
import { isStreaming, pingOnce, stopStreaming } from '../src/location';
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
      const [job, offs, earn] = await Promise.all([
        getActiveJob(d.id),
        getOffers(d.id),
        getEarnings(d.id),
      ]);
      setActiveJob(job);
      setOffers(offs);
      setEarnings(earn);
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
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.xl, marginBottom: spacing.lg }}
          >
            <Icon name="receipt" size={14} color={colors.accent} />
            <Text style={{ color: colors.accent, fontWeight: '600', fontSize: font.sizes.sm }}>Delivery history</Text>
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
        </Pressable>
      )}

      {/* Offers */}
      <View style={{ paddingHorizontal: spacing.xl }}>
        <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: colors.ink2, textTransform: 'uppercase', marginBottom: spacing.md }}>
          {offers.length > 0 ? 'New offers' : 'No offers right now'}
        </Text>
        {offers.map((o) => (
          <View
            key={o.id}
            style={{ backgroundColor: colors.white, borderWidth: 1, borderColor: colors.accent, borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.md }}
          >
            <Text style={{ fontWeight: '700', color: colors.ink }}>New delivery offer</Text>
            <Text style={{ color: colors.ink2, fontSize: font.sizes.sm, marginTop: 2 }}>
              Tap accept to view pickup + drop-off details.
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
              <Pressable onPress={() => reject(o)} style={{ flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center' }}>
                <Text style={{ color: colors.red, fontWeight: '600' }}>Decline</Text>
              </Pressable>
              <Pressable onPress={() => accept(o)} style={{ flex: 1, backgroundColor: colors.green, borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center' }}>
                <Text style={{ color: colors.white, fontWeight: '700' }}>Accept</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
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
