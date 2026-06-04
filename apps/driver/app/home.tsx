import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { pingOnce } from '../src/location';
import { colors, font, radius, spacing } from '../src/theme';

export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();

  const [driver, setDriver] = useState<Awaited<ReturnType<typeof getMyDriver>>>(null);
  const [online, setOnlineState] = useState(false);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [offers, setOffers] = useState<Assignment[]>([]);
  const [earnings, setEarnings] = useState<EarningsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const d = await getMyDriver();
    setDriver(d);
    if (!d) {
      setLoading(false);
      return;
    }
    setOnlineState(d.status !== 'offline');
    const [job, offs, earn] = await Promise.all([
      getActiveJob(d.id),
      getOffers(d.id),
      getEarnings(d.id),
    ]);
    setActiveJob(job);
    setOffers(offs);
    setEarnings(earn);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function toggleOnline(next: boolean) {
    setOnlineState(next);
    try {
      await setOnline(next);
      if (next) await pingOnce('online');
    } catch {
      setOnlineState(!next); // revert on failure
    }
  }

  async function accept(a: Assignment) {
    try {
      await respondToOffer(a.id, true);
      await load();
      router.push(`/job/${a.order_id}`);
    } catch (e) {
      // surfaced minimally; a toast lib would be nicer
      console.warn(e);
    }
  }

  async function reject(a: Assignment) {
    try {
      await respondToOffer(a.id, false);
      setOffers((prev) => prev.filter((o) => o.id !== a.id));
    } catch (e) {
      console.warn(e);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} size="large" />
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
        <Pressable onPress={signOut} style={{ marginTop: 24, padding: 12 }}>
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
          <Text style={{ color: colors.ink2, fontSize: font.sizes.sm }}>
            {driver.vehicle} · ⭐ {driver.rating}
            {!driver.is_verified && '  · pending verification'}
          </Text>
        </View>
        <Pressable onPress={signOut}>
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
        <View style={{ flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.xl, marginBottom: spacing.lg }}>
          <Stat label="Today" value={`${earnings.todayTotal} EGP`} />
          <Stat label="Deliveries" value={`${earnings.todayCount}`} />
          <Stat label="COD owed" value={`${earnings.codOwed} EGP`} warn={earnings.codOwed > 0} />
        </View>
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
