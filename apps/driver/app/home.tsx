import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
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
import {
  pingOnce,
  startIdleHeartbeat,
  stopIdleHeartbeat,
  stopStreaming,
  type LocationBlock,
} from '../src/location';
import { unreadCount } from '../src/messages';
import { configureNotificationHandler, registerForPush, unregisterPush } from '../src/push';
import { font, radius, spacing } from '../src/theme';
import { useThemeColors } from '../src/themeProvider';
import { Icon } from '../src/components/Icon';
import { useToast } from '../src/components/Toast';
import { LEGAL_URLS, openLegal } from '../src/legal';
import { OfferCard } from '../src/components/OfferCard';
import { OnlineToggle } from '../src/components/OnlineToggle';
import { ActiveJobCard } from '../src/components/ActiveJobCard';
import { EarningsGrid } from '../src/components/EarningsGrid';
import { AvatarButton } from '../src/components/AvatarButton';
import { ThemeToggle } from '../src/components/ThemeToggle';
import { notifyError, notifySuccess, tapLight, tapMedium } from '../src/lib/haptics';
import { LanguageToggle } from '../src/components/LanguageToggle';
import { useI18n } from '../src/i18n-context';
import type { TranslationKey } from '../src/i18n';
import { captureError } from '../src/lib/crash';

export default function Home() {
  const colors = useThemeColors();
  const router = useRouter();
  const { signOut } = useAuth();
  const { toast } = useToast();
  const { direction, errorMessage, t } = useI18n();

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
  // Why this driver is unreachable by dispatch despite the switch, or null.
  const [locationBlock, setLocationBlock] = useState<LocationBlock | null>(null);
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
      captureError(e, { where: 'driver.home.load' });
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
        // Re-seed current_geo (status preserved — pass nothing) and re-check
        // that location still works: permission can be revoked from Settings
        // while we are backgrounded, which would silently drop this driver out
        // of dispatch with the switch still showing green.
        void pingOnce().then((result) => {
          if (!onlineRef.current) return;
          setLocationBlock(result === 'ok' ? null : result);
        });
        // Reconcile unconditionally, not only while streaming: load() re-reads
        // drivers.status, which is the only thing that can settle a
        // disagreement between the switch on screen and the row in the DB.
        load();
      }
    });
    return () => sub.remove();
  }, [load]);

  // [P1] Idle heartbeat. Between jobs nothing else pings, so mig 201's 300s
  // freshness window would quietly drop an online driver out of dispatch — and
  // the push that would tell them is the push that stops arriving. Only runs
  // while online; the location module skips a tick if a delivery is already
  // streaming its own pings.
  useEffect(() => {
    if (!online) {
      stopIdleHeartbeat();
      return;
    }
    startIdleHeartbeat((result) => {
      setLocationBlock(result === 'ok' ? null : result);
    });
    return stopIdleHeartbeat;
  }, [online]);

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

  /**
   * Force the app and `drivers.status` back into agreement.
   *
   * A failed toggle used to revert only the LOCAL switch, leaving the row saying
   * one thing and the driver believing another with nothing to resolve it — a
   * driver "online" in the app but offline in the DB earns nothing all shift and
   * has no way to find out. Re-assert the intended value, then let a fresh read
   * of the row have the final word over both.
   */
  const reconcileOnline = useCallback(async (intended: boolean) => {
    try {
      await setOnline(intended);
    } catch {
      // The read below is the real reconciliation; a failed compensating write
      // just means the DB keeps whatever it already had.
    }
    try {
      const d = await getMyDriver();
      if (d) {
        setDriver(d);
        setOnlineState(d.status !== 'offline');
        onlineRef.current = d.status !== 'offline';
        return;
      }
    } catch (e) {
      captureError(e, { where: 'driver.home.reconcileOnline' });
    }
    setOnlineState(intended);
    onlineRef.current = intended;
  }, []);

  async function toggleOnline(next: boolean) {
    tapMedium();
    const previous = onlineRef.current;
    setOnlineState(next);
    onlineRef.current = next;
    try {
      if (next) {
        // Prove the phone can actually report a position BEFORE claiming to be
        // online. Since mig 201, dispatch ignores any driver without a recent
        // ping, so a driver with denied permission or device location off is
        // invisible no matter what the status column says. pingOnce seeds
        // current_geo + last_ping_at + status in one call, so a successful ping
        // IS going online; a failed one must not be dressed up as success.
        const result = await pingOnce('online');
        if (result !== 'ok') {
          setLocationBlock(result);
          setOnlineState(false);
          onlineRef.current = false;
          // Best-effort: undo any partial claim so the row can't say online.
          await reconcileOnline(false);
          notifyError();
          toast(locationBlockMessage(result, t), 'error');
          return;
        }
        setLocationBlock(null);
        await setOnline(true);
      } else {
        setLocationBlock(null);
        await setOnline(false);
        // [H-DRV3] Going offline MUST stop any running location stream. Otherwise
        // its throttled driver_ping keeps writing (and, before this fix, re-stamped
        // status back to on_job), so the driver could never actually go offline.
        await stopStreaming();
        await pingOnce('offline');
      }
    } catch (e) {
      captureError(e, { where: 'driver.home.toggleOnline', next });
      notifyError();
      toast(errorMessage('online', e), 'error');
      await reconcileOnline(previous);
    }
  }

  // Unregister this device's push token before signing out so the next driver on
  // the same device doesn't receive the previous account's offers.
  async function handleSignOut() {
    // [H-DRV3] Stop the stream first so a sign-out mid-delivery doesn't leave the
    // GPS watcher + pings running for the signed-out account. Same for the idle
    // heartbeat: explicit rather than relying on the unmount cleanup, because a
    // ping loop outliving its session is exactly the class of bug this fixes.
    stopIdleHeartbeat();
    await stopStreaming();
    await unregisterPush();
    await signOut();
  }

  async function accept(a: Assignment) {
    try {
      await respondToOffer(a.id, true);
      notifySuccess();
      await load();
      router.push(`/job/${a.order_id}`);
    } catch (e) {
      // A silently-failed accept could cost the driver a job — always surface it.
      captureError(e, {
        where: 'driver.home.acceptOffer',
        assignmentId: a.id,
        orderId: a.order_id,
      });
      notifyError();
      toast(errorMessage('offerAccept', e), 'error');
      await load();
    }
  }

  async function reject(a: Assignment) {
    try {
      await respondToOffer(a.id, false);
      setOffers((prev) => prev.filter((o) => o.id !== a.id));
    } catch (e) {
      captureError(e, {
        where: 'driver.home.declineOffer',
        assignmentId: a.id,
        orderId: a.order_id,
      });
      notifyError();
      toast(errorMessage('offerDecline', e), 'error');
      await load();
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
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.sm }}
        style={{ flex: 1, backgroundColor: colors.bg }}
      >
        <Text style={{ fontSize: font.sizes.xl, fontWeight: '700', color: colors.ink, textAlign: 'center', writingDirection: direction.writingDirection }}>
          {t('home.profileLoadTitle')}
        </Text>
        <Text style={{ color: colors.ink2, textAlign: 'center', writingDirection: direction.writingDirection }}>
          {t('home.profileLoadBody')}
        </Text>
        <Pressable
          onPress={() => {
            setLoading(true);
            load();
          }}
          accessibilityRole="button"
          accessibilityLabel={t('home.retryA11y')}
          style={{ marginTop: spacing.lg, minHeight: 48, justifyContent: 'center', backgroundColor: colors.accent, borderRadius: radius.lg, borderCurve: 'continuous', paddingHorizontal: spacing.xl }}
        >
          <Text style={{ color: colors.onAccent, fontWeight: '700' }}>{t('common.retry')}</Text>
        </Pressable>
        <Pressable onPress={handleSignOut} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md }}>
          <Text style={{ color: colors.ink3, fontWeight: '600' }}>{t('common.signOut')}</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (!driver) {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.sm }}
        style={{ flex: 1, backgroundColor: colors.bg }}
      >
        <Text style={{ fontSize: font.sizes.xl, fontWeight: '700', color: colors.ink, textAlign: 'center', writingDirection: direction.writingDirection }}>
          {t('home.notRegisteredTitle')}
        </Text>
        <Text style={{ color: colors.ink2, textAlign: 'center', writingDirection: direction.writingDirection }}>
          {t('home.notRegisteredBody')}
        </Text>
        <Pressable onPress={handleSignOut} accessibilityRole="button" style={{ marginTop: spacing.lg, minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md }}>
          <Text style={{ color: colors.accentText, fontWeight: '600' }}>{t('common.signOut')}</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // The switch being on is not the same as being reachable: dispatch only sees
  // drivers with a fresh position. Every "you're ready for work" affordance
  // below reads this, not `online`, so the empty state can never promise offers
  // that cannot arrive.
  const receivingOffers = online && locationBlock === null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        paddingBottom: spacing.xxxl,
        direction: direction.direction,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.accent}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      {/* Identity strip. The screen TITLE lives in the native header, but the
          driver's own name must stay on screen: these devices are shared between
          riders, and earnings plus COD liability are per-driver. "Whose account
          is this?" has to be answerable without opening a menu. */}
      <View style={{ paddingHorizontal: spacing.xl, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <AvatarButton name={driver.name} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text selectable style={{ fontSize: font.sizes.xxl, fontWeight: '800', color: colors.ink, textAlign: direction.textAlign, writingDirection: direction.writingDirection }}>
            {driver.name?.split(' ')[0] ?? t('common.driver')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ color: colors.ink2, fontSize: font.sizes.sm }}>{driver.vehicle} ·</Text>
            <Icon name="star" size={12} color={colors.star} />
            <Text style={{ color: colors.ink2, fontSize: font.sizes.sm }}>
              {driver.rating}
              {!driver.is_verified && `  · ${t('home.pendingVerification')}`}
            </Text>
          </View>
        </View>
        <LanguageToggle />
        {/* Appearance override lives here rather than behind a menu: a shift
            spans full sun to full dark, and neither theme is readable in both. */}
        <ThemeToggle />
      </View>

      <OnlineToggle
        online={online}
        verified={driver.is_verified}
        warning={locationBlock ? locationBlockMessage(locationBlock, t) : null}
        onToggle={toggleOnline}
      />

      {earnings && (
        <>
          <EarningsGrid earnings={earnings} />
          <View style={{ paddingHorizontal: spacing.xl, marginTop: spacing.md, marginBottom: spacing.lg, gap: spacing.xs }}>
            <QuickLink icon="receipt" label={t('home.deliveryHistory')} onPress={() => router.push('/history')} />
            <QuickLink icon="trophy" label={t('home.myTier')} onPress={() => router.push('/tier')} />
            <QuickLink icon="person" label={t('home.verificationDocuments')} onPress={() => router.push('/kyc')} />
          </View>
        </>
      )}

      {activeJob && (
        <ActiveJobCard
          job={activeJob}
          unreadMsgs={unreadMsgs}
          onOpen={() => router.push(`/job/${activeJob.id}`)}
          onOpenChat={() => router.push(`/job/${activeJob.id}/chat`)}
        />
      )}

      {/* Offers */}
      <View style={{ paddingHorizontal: spacing.xl }}>
        <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: colors.ink2, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: spacing.md }}>
          {offers.length > 0
            ? t('home.newOffers', { count: offers.length })
            : receivingOffers
              ? t('home.waitingOffers')
              : t('home.offersPaused')}
        </Text>
        {/* A plain View, not Animated. Twice now an entering/layout animation
            has left content INVISIBLE on iOS rather than fading it in — this
            card and the OnlineToggle heading, both verified on a simulator.
            An empty state is the only thing on screen when it shows; it must
            never depend on an animation completing in order to be readable.
            Motion stays on the offer cards, where arrival genuinely needs
            explaining. */}
        {offers.length === 0 && (
          <View
            accessibilityLabel={
              receivingOffers
                ? t('home.onlineEmptyA11y')
                : t('home.offlineEmptyA11y')
            }
            style={{
              minHeight: 128,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: radius.xl,
              borderCurve: 'continuous',
              padding: spacing.xl,
              gap: spacing.xs,
            }}
          >
            <Icon
              name={receivingOffers ? 'bell' : 'quiet'}
              size={28}
              color={receivingOffers ? colors.accent : colors.ink3}
            />
            <Text style={{ marginTop: spacing.xs, color: colors.ink, fontSize: font.sizes.base, fontWeight: '700', textAlign: 'center' }}>
              {receivingOffers ? t('home.onlineEmptyTitle') : t('home.offlineEmptyTitle')}
            </Text>
            <Text style={{ color: colors.ink2, fontSize: font.sizes.sm, textAlign: 'center' }}>
              {receivingOffers ? t('home.onlineEmptyBody') : t('home.offlineEmptyBody')}
            </Text>
          </View>
        )}
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

      {/* Legal */}
      <View style={{ marginTop: spacing.xxl, paddingHorizontal: spacing.xl }}>
        <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: colors.ink2, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: spacing.xs }}>
          {t('common.legal')}
        </Text>
        <Pressable
          onPress={() => openLegal(LEGAL_URLS.terms)}
          accessibilityRole="link"
          accessibilityLabel={t('common.terms')}
          style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48 }}
        >
          <Text style={{ flex: 1, color: colors.ink, fontSize: font.sizes.lg, fontWeight: '600', textAlign: direction.textAlign }}>{t('common.terms')}</Text>
          <Icon name={direction.direction === 'rtl' ? 'chevronBack' : 'chevronForward'} size={16} color={colors.ink3} />
        </Pressable>
        <View style={{ height: 1, backgroundColor: colors.line }} />
        <Pressable
          onPress={() => openLegal(LEGAL_URLS.privacy)}
          accessibilityRole="link"
          accessibilityLabel={t('common.privacy')}
          style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48 }}
        >
          <Text style={{ flex: 1, color: colors.ink, fontSize: font.sizes.lg, fontWeight: '600', textAlign: direction.textAlign }}>{t('common.privacy')}</Text>
          <Icon name={direction.direction === 'rtl' ? 'chevronBack' : 'chevronForward'} size={16} color={colors.ink3} />
        </Pressable>
      </View>

      <Pressable
        onPress={handleSignOut}
        accessibilityRole="button"
        accessibilityLabel={t('common.signOut')}
        style={{ marginTop: spacing.xl, marginHorizontal: spacing.xl, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ color: colors.ink3, fontSize: font.sizes.base, fontWeight: '600' }}>{t('common.signOut')}</Text>
      </Pressable>
    </ScrollView>
  );
}

/**
 * Why dispatch cannot see this driver, in their language. Separated because the
 * two causes need different remedies: one is an app permission, the other is a
 * device setting, and "location error" tells a driver neither.
 */
function locationBlockMessage(
  result: LocationBlock,
  t: (key: TranslationKey) => string,
): string {
  return result === 'permission_denied'
    ? t('home.locationBlockedPermission')
    : t('home.locationBlockedUnavailable');
}

/** A labelled row that pushes a secondary screen. 48pt target, chevron affordance. */
function QuickLink({
  icon,
  label,
  onPress,
}: {
  icon: 'receipt' | 'trophy' | 'person';
  label: string;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const { direction } = useI18n();

  return (
    <Pressable
      onPress={() => {
        tapLight();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: 48,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={16} color={colors.accentText} />
      <Text style={{ flex: 1, color: colors.accentText, fontWeight: '600', fontSize: font.sizes.base, textAlign: direction.textAlign }}>
        {label}
      </Text>
      <Icon name={direction.direction === 'rtl' ? 'chevronBack' : 'chevronForward'} size={14} color={colors.accentText} />
    </Pressable>
  );
}
