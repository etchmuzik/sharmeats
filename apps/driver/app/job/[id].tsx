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
import { parseWkbPoint } from '../../src/geo';
import { openDirections } from '../../src/navigation';
import { colors, font, radius, spacing } from '../../src/theme';
import { Icon } from '../../src/components/Icon';
import { HotelHandoffCard } from '../../src/components/HotelHandoffCard';
import { DropoffPreferenceCard } from '../../src/components/DropoffPreferenceCard';
import { useToast } from '../../src/components/Toast';

export default function JobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
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
        toast(e instanceof Error ? e.message : 'Could not update. Try again.', 'error');
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
                toast(e instanceof Error ? e.message : 'Something went wrong. Try again.', 'error');
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
      toast(e instanceof Error ? e.message : 'Something went wrong. Try again.', 'error');
    } finally {
      setBusy(false);
    }
  }, [id, job, router, toast]);

  const navigateTo = useCallback(
    async (kind: 'restaurant' | 'dropoff') => {
      if (!job) return;
      const point =
        kind === 'restaurant'
          ? parseWkbPoint(job.restaurant_geo)
          : parseWkbPoint(job.dropoff_geo);
      const label = kind === 'restaurant' ? job.restaurant_name : addrLineForNav(job);
      const ok = await openDirections({ point, label });
      if (!ok) toast('Could not open maps. Is a maps app installed?', 'error');
    },
    [job, toast],
  );

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
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: spacing.md }}
        >
          <Icon name="chevronBack" size={18} color={colors.accent} />
          <Text style={{ color: colors.accent, fontWeight: '600' }}>Back</Text>
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

        {/* Navigate — destination depends on whether we've picked up yet.
            Before pickup: head to the restaurant. After: head to the customer. */}
        {!['delivered', 'cancelled', 'rejected'].includes(job.status) && (
          <View style={{ marginTop: spacing.xl, flexDirection: 'row', gap: spacing.md }}>
            {beforePickup(job.status) ? (
              <NavButton
                icon="restaurant"
                label="Navigate to restaurant"
                onPress={() => navigateTo('restaurant')}
              />
            ) : (
              <NavButton
                icon="navigate"
                label="Navigate to customer"
                onPress={() => navigateTo('dropoff')}
              />
            )}
          </View>
        )}

        {/* Drop-off. Hotel deliveries get a dedicated handoff card (room number
            big, plain-language handoff) so the order lands with no phone call —
            the core Sharm tourist promise. Street/beach keep the compact line. */}
        {addr?.kind === 'hotel' ? (
          <HotelHandoffCard
            hotelName={addr.hotelName}
            roomNumber={addr.roomNumber}
            handoff={addr.handoff}
            landmark={addr.landmark}
          />
        ) : (
          <View style={{ marginTop: spacing.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.xl, padding: spacing.lg }}>
            <Text style={{ fontSize: font.sizes.xs, color: colors.ink3, fontWeight: '700', textTransform: 'uppercase' }}>
              Deliver to
            </Text>
            <Text style={{ fontSize: font.sizes.lg, color: colors.ink, marginTop: 4 }}>{addrLine}</Text>
            {addr?.landmark ? (
              <Text style={{ color: colors.ink2, fontSize: font.sizes.sm, marginTop: 2 }}>Landmark: {addr.landmark}</Text>
            ) : null}
          </View>
        )}

        <DropoffPreferenceCard preference={job.dropoff_preference} note={job.dropoff_note} />

        {/* Contact the customer. In-app chat is always available once assigned;
            the phone call is offered only while out for delivery (mig 028
            fetches customer_phone but it was never surfaced — the #1 buried
            feature: a driver at the door with no way to reach the customer). */}
        {!['delivered', 'cancelled', 'rejected'].includes(job.status) && (
          <View style={{ marginTop: spacing.md, flexDirection: 'row', gap: spacing.md }}>
            {job.customer_phone && job.status === 'out_for_delivery' && (
              <ContactButton
                icon="phone"
                label="Call customer"
                onPress={() => Linking.openURL(`tel:${job.customer_phone}`)}
              />
            )}
            <ContactButton
              icon="chat"
              label="Message"
              onPress={() => router.push(`/job/${id}/chat`)}
            />
          </View>
        )}

        {/* Customer's delivery note (kitchen_notes) — fetched but never shown
            before. Only render when the customer actually left one. */}
        {job.kitchen_notes?.trim() ? (
          <View style={{ marginTop: spacing.md, backgroundColor: colors.amberSoft, borderRadius: radius.xl, padding: spacing.lg }}>
            <Text style={{ fontSize: font.sizes.xs, color: colors.amber, fontWeight: '700', textTransform: 'uppercase' }}>
              Note from the customer
            </Text>
            <Text style={{ fontSize: font.sizes.base, color: colors.ink, marginTop: 4 }}>
              {job.kitchen_notes.trim()}
            </Text>
          </View>
        ) : null}

        {/* Order items — so the driver can verify the bag before leaving the restaurant. */}
        {job.items.length > 0 && (
          <View style={{ marginTop: spacing.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.xl, padding: spacing.lg }}>
            <Text style={{ fontSize: font.sizes.xs, color: colors.ink3, fontWeight: '700', textTransform: 'uppercase' }}>
              {job.items.length} {job.items.length === 1 ? 'item' : 'items'} in the bag
            </Text>
            <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
              {job.items.map((it, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
                  <Text style={{ color: colors.accent, fontWeight: '800', fontSize: font.sizes.base, minWidth: 22 }}>
                    {it.quantity ?? 1}×
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.ink, fontSize: font.sizes.base }}>{it.name}</Text>
                    {it.notes ? (
                      <Text style={{ color: colors.ink3, fontSize: font.sizes.sm }}>{it.notes}</Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Payment */}
        <View style={{ marginTop: spacing.md, backgroundColor: job.payment_method === 'cash_on_delivery' ? colors.amberSoft : colors.greenSoft, borderRadius: radius.xl, padding: spacing.lg }}>
          <Text style={{ fontWeight: '700', color: job.payment_method === 'cash_on_delivery' ? colors.amber : colors.green }}>
            {job.payment_method === 'cash_on_delivery'
              ? `Collect ${job.total_egp} EGP cash`
              : `Paid by card · ${job.total_egp} EGP`}
          </Text>
          {/* Tip (tip_egp) — fetched but never displayed, so the driver couldn't
              see the tip they earned on this delivery. */}
          {job.tip_egp > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
              <Icon name="star" size={13} color={colors.star} />
              <Text style={{ color: colors.ink2, fontSize: font.sizes.sm, fontWeight: '600' }}>
                Includes {job.tip_egp} EGP tip for you
              </Text>
            </View>
          )}
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
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            {job.status === 'delivered' && <Icon name="check" size={18} color={colors.green} />}
            <Text style={{ textAlign: 'center', color: colors.green, fontWeight: '700' }}>
              {job.status === 'delivered' ? 'Delivered' : job.status}
            </Text>
          </View>
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

function NavButton({
  icon,
  label,
  onPress,
}: {
  icon: 'restaurant' | 'navigate';
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        backgroundColor: colors.ink,
        borderRadius: radius.lg,
        paddingVertical: spacing.lg,
      }}
    >
      <Icon name={icon} size={18} color={colors.white} />
      <Text style={{ color: colors.white, fontWeight: '700', fontSize: font.sizes.base }}>{label}</Text>
    </Pressable>
  );
}

function ContactButton({
  icon,
  label,
  onPress,
}: {
  icon: 'phone' | 'chat';
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        backgroundColor: colors.accentSoft,
        borderWidth: 1,
        borderColor: colors.accent,
        borderRadius: radius.lg,
        paddingVertical: spacing.md,
      }}
    >
      <Icon name={icon} size={18} color={colors.accentDark} />
      <Text style={{ color: colors.accentDark, fontWeight: '700', fontSize: font.sizes.base }}>{label}</Text>
    </Pressable>
  );
}

/** True while the order is still at/awaiting the restaurant (pre-pickup). */
function beforePickup(status: Job['status']): boolean {
  return ['accepted', 'preparing', 'ready'].includes(status);
}

/** Compact one-line address for a maps free-text fallback (no exact pin). */
function addrLineForNav(job: Job): string {
  const a = job.address_snapshot;
  if (a?.kind === 'hotel') return [a.hotelName, a.roomNumber && `Room ${a.roomNumber}`].filter(Boolean).join(' ');
  if (a?.kind === 'street') return [a.streetText, a.building && `Bldg ${a.building}`].filter(Boolean).join(', ');
  if (a?.kind === 'beach_pin') return a.beachName ?? 'Beach';
  return a?.label ?? job.restaurant_name;
}

function stepLabel(s: 'ready' | 'picked_up' | 'out_for_delivery' | 'delivered'): string {
  return { ready: 'Ready for pickup', picked_up: 'Picked up', out_for_delivery: 'Out for delivery', delivered: 'Delivered' }[s];
}
