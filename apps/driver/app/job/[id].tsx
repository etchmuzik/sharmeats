import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { advance, collectCod, fetchJob, type Job } from '../../src/jobs';
import { startStreaming, stopStreaming } from '../../src/location';
import { colors, font, radius, spacing } from '../../src/theme';

export default function JobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const j = await fetchJob(id);
    setJob(j);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Ensure streaming matches the job state when the screen mounts/updates:
  // stream between picked_up and out_for_delivery; stop once delivered/terminal.
  useEffect(() => {
    if (!job || !id) return;
    const shouldStream = job.status === 'picked_up' || job.status === 'out_for_delivery';
    if (shouldStream) {
      startStreaming(id).catch(() => {});
    } else {
      stopStreaming().catch(() => {});
    }
  }, [job?.status, id]);

  const doAdvance = useCallback(
    async (next: Job['status']) => {
      if (!id) return;
      setBusy(true);
      try {
        // Start GPS right as we pick up so the customer sees movement immediately.
        if (next === 'picked_up') await startStreaming(id).catch(() => {});
        await advance(id, next);
        await load();
      } catch (e) {
        Alert.alert('Could not update', e instanceof Error ? e.message : 'Try again');
      } finally {
        setBusy(false);
      }
    },
    [id, load],
  );

  const completeDelivery = useCallback(async () => {
    if (!id || !job) return;
    // COD: confirm cash collected before marking delivered.
    if (job.payment_method === 'cash_on_delivery' && job.payment_status !== 'paid') {
      Alert.alert(
        'Collect cash',
        `Collect ${job.total_egp} EGP from the customer?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: `Collected ${job.total_egp} EGP`,
            onPress: async () => {
              setBusy(true);
              try {
                await collectCod(id, job.total_egp);
                await advance(id, 'delivered');
                await stopStreaming();
                router.replace('/home');
              } catch (e) {
                Alert.alert('Error', e instanceof Error ? e.message : 'Try again');
              } finally {
                setBusy(false);
              }
            },
          },
        ],
      );
      return;
    }
    // Card (already paid): just deliver.
    setBusy(true);
    try {
      await advance(id, 'delivered');
      await stopStreaming();
      router.replace('/home');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Try again');
    } finally {
      setBusy(false);
    }
  }, [id, job, router]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }
  if (!job) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <Text style={{ color: colors.ink2 }}>Job not found.</Text>
      </View>
    );
  }

  const addr = job.address_snapshot;
  const addrLine =
    addr?.kind === 'hotel'
      ? `${addr.hotelName ?? 'Hotel'} · Room ${addr.roomNumber ?? '—'}${addr.handoff ? ` · ${addr.handoff}` : ''}`
      : addr?.kind === 'street'
        ? `${addr.streetText ?? ''}${addr.building ? `, Bldg ${addr.building}` : ''}${addr.apartment ? `, Apt ${addr.apartment}` : ''}`
        : addr?.kind === 'beach_pin'
          ? `Beach pin · ${addr.beachName ?? ''}`
          : (addr?.label ?? 'Address');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl }}>
        <Pressable onPress={() => router.back()} style={{ marginBottom: spacing.md }}>
          <Text style={{ color: colors.accent, fontWeight: '600' }}>‹ Back</Text>
        </Pressable>

        <Text style={{ fontSize: font.sizes.xxl, fontWeight: '800', color: colors.ink }}>
          {job.short_code}
        </Text>
        <Text style={{ color: colors.ink2, fontSize: font.sizes.base }}>{job.restaurant_name}</Text>

        {/* Status timeline */}
        <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
          {(['ready', 'picked_up', 'out_for_delivery', 'delivered'] as const).map((s) => {
            const order = ['ready', 'picked_up', 'out_for_delivery', 'delivered'];
            const done = order.indexOf(job.status) >= order.indexOf(s);
            return (
              <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <View
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    backgroundColor: done ? colors.accent : colors.line,
                  }}
                />
                <Text style={{ color: done ? colors.ink : colors.ink3, fontWeight: done ? '600' : '400' }}>
                  {stepLabel(s)}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Drop-off */}
        <View style={{ marginTop: spacing.xl, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.xl, padding: spacing.lg }}>
          <Text style={{ fontSize: font.sizes.xs, color: colors.ink3, fontWeight: '700', textTransform: 'uppercase' }}>
            Deliver to
          </Text>
          <Text style={{ fontSize: font.sizes.lg, color: colors.ink, marginTop: 4 }}>{addrLine}</Text>
          {addr?.landmark ? (
            <Text style={{ color: colors.ink2, fontSize: font.sizes.sm, marginTop: 2 }}>Landmark: {addr.landmark}</Text>
          ) : null}
        </View>

        {/* Payment */}
        <View style={{ marginTop: spacing.md, backgroundColor: job.payment_method === 'cash_on_delivery' ? colors.amberSoft : colors.greenSoft, borderRadius: radius.xl, padding: spacing.lg }}>
          <Text style={{ fontWeight: '700', color: job.payment_method === 'cash_on_delivery' ? colors.amber : colors.green }}>
            {job.payment_method === 'cash_on_delivery'
              ? `Collect ${job.total_egp} EGP cash`
              : `Paid by card · ${job.total_egp} EGP`}
          </Text>
        </View>
      </ScrollView>

      {/* Action bar */}
      <View style={{ padding: spacing.xl, paddingBottom: insets.bottom + spacing.md, borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.white }}>
        {job.status === 'ready' && (
          <Action label="Picked up from restaurant" busy={busy} onPress={() => doAdvance('picked_up')} />
        )}
        {job.status === 'picked_up' && (
          <Action label="Start delivery" busy={busy} onPress={() => doAdvance('out_for_delivery')} />
        )}
        {job.status === 'out_for_delivery' && (
          <Action label="Complete delivery" busy={busy} onPress={completeDelivery} />
        )}
        {['accepted', 'preparing'].includes(job.status) && (
          <Text style={{ textAlign: 'center', color: colors.ink2 }}>
            Waiting for the restaurant to finish preparing…
          </Text>
        )}
        {['delivered', 'cancelled', 'rejected'].includes(job.status) && (
          <Text style={{ textAlign: 'center', color: colors.green, fontWeight: '700' }}>
            {job.status === 'delivered' ? 'Delivered ✓' : job.status}
          </Text>
        )}
      </View>
    </View>
  );
}

function Action({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={{ backgroundColor: colors.accent, borderRadius: radius.lg, paddingVertical: spacing.lg, alignItems: 'center', opacity: busy ? 0.6 : 1 }}
    >
      {busy ? <ActivityIndicator color={colors.white} /> : <Text style={{ color: colors.white, fontSize: font.sizes.lg, fontWeight: '700' }}>{label}</Text>}
    </Pressable>
  );
}

function stepLabel(s: 'ready' | 'picked_up' | 'out_for_delivery' | 'delivered'): string {
  return { ready: 'Ready for pickup', picked_up: 'Picked up', out_for_delivery: 'Out for delivery', delivered: 'Delivered' }[s];
}
