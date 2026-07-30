import { useCallback, useEffect, useRef, useState } from 'react';
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
import * as ImagePicker from 'expo-image-picker';
import { advance, collectCod, fetchJob, type Job } from '../../src/jobs';
import { isProofRequired, recordProof } from '../../src/proofOfDelivery';
import { startStreaming, stopStreaming } from '../../src/location';
import { parseWkbPoint } from '../../src/geo';
import { openDirections } from '../../src/navigation';
import { font, radius, spacing } from '../../src/theme';
import { useThemeColors } from '../../src/themeProvider';
import { Icon } from '../../src/components/Icon';
import { HotelHandoffCard } from '../../src/components/HotelHandoffCard';
import { DropoffPreferenceCard } from '../../src/components/DropoffPreferenceCard';
import { DeliveryCountdown } from '../../src/components/DeliveryCountdown';
import { useToast } from '../../src/components/Toast';

export default function JobScreen() {
  const colors = useThemeColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Handoff photo, held locally until the delivery is confirmed. Capture is
  // instant and offline; the UPLOAD deliberately happens after the status
  // advance, so a weak signal can never strand a completed delivery.
  const [proof, setProof] = useState<{ uri: string; mime?: string | null; size?: number | null } | null>(
    null,
  );
  const [capturing, setCapturing] = useState(false);
  const trackingErrorShown = useRef(false);

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
      startStreaming(id).catch((error) => {
        if (trackingErrorShown.current) return;
        trackingErrorShown.current = true;
        toast(
          error instanceof Error
            ? error.message
            : 'Live location could not start. Check location permissions.',
          'error',
        );
      });
    } else {
      stopStreaming().catch(() => {});
    }
  }, [job?.status, id, toast]);

  const doAdvance = useCallback(
    async (next: Job['status']) => {
      if (!id) return;
      setBusy(true);
      try {
        // Give the driver a prominent disclosure immediately before Android/iOS
        // asks for background access. Do not advance to picked_up if tracking
        // cannot start: the customer and dispatch would otherwise see stale GPS.
        if (next === 'picked_up') {
          const accepted = await confirmBackgroundTracking();
          if (!accepted) return;
          await startStreaming(id);
        }
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

  const capturePhoto = useCallback(async () => {
    setCapturing(true);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Camera needed',
          'Allow camera access to photograph the handoff. This is the only record that the order arrived.',
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        // 0.6 keeps a doorway legible while staying well inside the bucket's
        // 5 MB ceiling on a slow connection.
        quality: 0.6,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const asset = result.assets[0];
      setProof({ uri: asset.uri, mime: asset.mimeType, size: asset.fileSize });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't open the camera.", 'error');
    } finally {
      setCapturing(false);
    }
  }, [toast]);

  /**
   * Index the captured photo AFTER the delivery is already recorded.
   *
   * Never throws: the delivery has happened and the driver is done. A failed
   * upload is surfaced as a warning and left for ops
   * (ops_deliveries_missing_proof) rather than being allowed to undo or block
   * anything the driver already completed.
   */
  const uploadProofBestEffort = useCallback(
    async (orderId: string) => {
      if (!proof) return;
      try {
        await recordProof(orderId, proof.uri, Date.now(), proof.mime, proof.size);
      } catch {
        toast('Delivered, but the photo did not upload. Ops has been flagged.', 'error');
      }
    },
    [proof, toast],
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
                // After the advance, on purpose: the photo must never gate the
                // status change (see src/proofOfDelivery.ts).
                await uploadProofBestEffort(id);
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
      await uploadProofBestEffort(id);
      await stopStreaming();
      router.replace('/home');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Something went wrong. Try again.', 'error');
    } finally {
      setBusy(false);
    }
  }, [id, job, router, toast, uploadProofBestEffort]);

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
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingTop: spacing.lg, paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl }}
      >
        <Text style={{ fontSize: font.sizes.xxl, fontWeight: '800', color: colors.ink }}>
          {job.short_code}
        </Text>
        <Text style={{ color: colors.ink2, fontSize: font.sizes.base }}>{job.restaurant_name}</Text>

        {/* Phase-aware countdown: "pick up by" before pickup, "deliver by" after.
            Only while the job is active (a terminal status has no clock). */}
        {!['delivered', 'cancelled', 'rejected'].includes(job.status) && (
          <DeliveryCountdown etaAt={job.eta_at} beforePickup={beforePickup(job.status)} />
        )}

        {/* Status timeline */}
        <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
          {(['ready', 'picked_up', 'out_for_delivery', 'delivered'] as const).map((s) => {
            const order = ['ready', 'picked_up', 'out_for_delivery', 'delivered'];
            const done = order.indexOf(job.status) >= order.indexOf(s);
            return (
              <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <View
                  accessible
                  accessibilityLabel={`${stepLabel(s)}: ${done ? 'complete' : 'not complete'}`}
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
          <View style={{ marginTop: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.xl, padding: spacing.lg }}>
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
            the phone call is offered from pickup onward (picked_up +
            out_for_delivery) — a driver heading over often needs to call about a
            gate code or hotel wing, not just at the door. Kept off pre-pickup for
            privacy (the driver shouldn't hold the customer's number while the
            order is still at the restaurant); customer_phone is also only surfaced
            for an accepted, non-terminal job, so the presence check below is the
            natural backstop. mig 028 fetches customer_phone but it was long
            unsurfaced — the #1 buried feature. */}
        {!['delivered', 'cancelled', 'rejected'].includes(job.status) && (
          <View style={{ marginTop: spacing.md, flexDirection: 'row', gap: spacing.md }}>
            {job.customer_phone && !beforePickup(job.status) && (
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
            <Text style={{ fontSize: font.sizes.xs, color: colors.amberText, fontWeight: '700', textTransform: 'uppercase' }}>
              Note from the customer
            </Text>
            <Text style={{ fontSize: font.sizes.base, color: colors.ink, marginTop: 4 }}>
              {job.kitchen_notes.trim()}
            </Text>
          </View>
        ) : null}

        {/* Order items — so the driver can verify the bag before leaving the restaurant. */}
        {job.items.length > 0 && (
          <View style={{ marginTop: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.xl, padding: spacing.lg }}>
            <Text style={{ fontSize: font.sizes.xs, color: colors.ink3, fontWeight: '700', textTransform: 'uppercase' }}>
              {job.items.length} {job.items.length === 1 ? 'item' : 'items'} in the bag
            </Text>
            <View style={{ marginTop: spacing.sm, gap: spacing.xs }}>
              {job.items.map((it, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
                  <Text style={{ color: colors.accentText, fontWeight: '800', fontSize: font.sizes.base, minWidth: 22 }}>
                    {it.quantity ?? 1}×
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.ink, fontSize: font.sizes.base }}>{it.name}</Text>
                    {it.notes ? (
                      <Text style={{ color: colors.ink3, fontSize: font.sizes.sm }}>{it.notes}</Text>
                    ) : null}
                    {/* The driver is the last person between the pharmacy and
                        the customer, so this is where the requirement can still
                        be acted on. Deliberately states the ACTION ("check the
                        prescription"), not just the property — a driver
                        scanning a bag list needs to know what to DO. */}
                    {it.requiresPrescription ? (
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 4,
                          marginTop: 4,
                          alignSelf: 'flex-start',
                          paddingHorizontal: 8,
                          paddingVertical: 3,
                          borderRadius: radius.md,
                          backgroundColor: colors.redSoft,
                          borderWidth: 1,
                          borderColor: colors.red,
                        }}
                        accessibilityRole="text"
                        accessibilityLabel="Prescription required — check before handover">
                        <Text
                          style={{
                            // redText, not red: the theme documents redText as
                            // 5.53:1 on redSoft where plain red is only 4.04:1.
                            // A safety warning has to clear AA.
                            color: colors.redText,
                            fontSize: font.sizes.sm,
                            fontWeight: '800',
                          }}>
                          Rx — check prescription before handover
                        </Text>
                      </View>
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
      <View style={{ padding: spacing.xl, paddingBottom: insets.bottom + spacing.md, borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.surface }}>
        {job.status === 'ready' && (
          <Action label="Picked up from restaurant" busy={busy} onPress={() => doAdvance('picked_up')} />
        )}
        {job.status === 'picked_up' && (
          <Action label="Start delivery" busy={busy} onPress={() => doAdvance('out_for_delivery')} />
        )}
        {job.status === 'out_for_delivery' && (
          <View style={{ gap: spacing.md }}>
            {/* Handoff photo. Required only where nobody is at the door to
                receive the order — for an in-person handoff the customer is the
                witness, and demanding a photo of them would be worse than
                useless. isProofRequired mirrors mig 180's SQL definition. */}
            <ProofRow
              required={isProofRequired(job.dropoff_preference)}
              captured={proof !== null}
              capturing={capturing}
              onCapture={capturePhoto}
              onRetake={capturePhoto}
            />
            <Action
              label="Complete delivery"
              busy={busy}
              disabled={isProofRequired(job.dropoff_preference) && proof === null}
              onPress={completeDelivery}
            />
          </View>
        )}
        {['accepted', 'preparing'].includes(job.status) && (
          <Text style={{ textAlign: 'center', color: colors.ink2 }}>
            Waiting for the restaurant to finish preparing…
          </Text>
        )}
        {['delivered', 'cancelled', 'rejected'].includes(job.status) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            {job.status === 'delivered' && <Icon name="check" size={18} color={colors.green} />}
            <Text style={{ textAlign: 'center', color: colors.greenText, fontWeight: '700' }}>
              {job.status === 'delivered' ? 'Delivered' : job.status}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function confirmBackgroundTracking(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Live delivery location',
      'While this delivery is active, Sharm Eats uses your location in the background so the customer can follow the driver and dispatch can keep the delivery safe. Android shows a persistent notification. Tracking stops when the delivery ends or you go offline.',
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Continue', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

function Action({
  label,
  busy,
  disabled = false,
  onPress,
}: {
  label: string;
  busy: boolean;
  /** Not allowed YET (e.g. a required photo is missing) — distinct from `busy`. */
  disabled?: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const blocked = busy || disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: blocked, busy }}
      style={{ backgroundColor: colors.accent, borderRadius: radius.lg, paddingVertical: spacing.lg, alignItems: 'center', opacity: blocked ? 0.6 : 1 }}
    >
      {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={{ color: colors.onAccent, fontSize: font.sizes.lg, fontWeight: '700' }}>{label}</Text>}
    </Pressable>
  );
}

/**
 * Handoff-photo control.
 *
 * When a photo is REQUIRED the copy says why, because a driver who does not know
 * why the Complete button is dim will read it as a broken app and call dispatch.
 * When it is optional the control is still offered — a driver who senses a
 * dispute coming should be able to protect themselves.
 */
function ProofRow({
  required,
  captured,
  capturing,
  onCapture,
  onRetake,
}: {
  required: boolean;
  captured: boolean;
  capturing: boolean;
  onCapture: () => void;
  onRetake: () => void;
}) {
  const colors = useThemeColors();

  if (captured) {
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          backgroundColor: colors.greenSoft,
          borderRadius: radius.lg,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
        }}
      >
        <Icon name="check" size={18} color={colors.greenText} />
        <Text style={{ flex: 1, color: colors.greenText, fontWeight: '700', fontSize: font.sizes.base }}>
          Handoff photo ready
        </Text>
        <Pressable
          onPress={onRetake}
          accessibilityRole="button"
          accessibilityLabel="Retake the handoff photo"
          hitSlop={8}
          style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm }}
        >
          <Text style={{ color: colors.accentText, fontWeight: '700', fontSize: font.sizes.sm }}>
            Retake
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      onPress={onCapture}
      disabled={capturing}
      accessibilityRole="button"
      accessibilityLabel={required ? 'Take the required handoff photo' : 'Take an optional handoff photo'}
      accessibilityState={{ busy: capturing, disabled: capturing }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        minHeight: 52,
        borderWidth: required ? 2 : 1,
        borderColor: required ? colors.amber : colors.line,
        backgroundColor: required ? colors.amberSoft : colors.surface,
        borderRadius: radius.lg,
        paddingHorizontal: spacing.lg,
        opacity: capturing ? 0.6 : 1,
      }}
    >
      {capturing ? (
        <ActivityIndicator color={required ? colors.amberText : colors.accentText} />
      ) : (
        <Icon name="camera" size={18} color={required ? colors.amberText : colors.accentText} />
      )}
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: required ? colors.amberText : colors.ink,
            fontWeight: '700',
            fontSize: font.sizes.base,
          }}
        >
          {required ? 'Photo required' : 'Add a handoff photo'}
        </Text>
        <Text style={{ color: colors.ink2, fontSize: font.sizes.xs }}>
          {required
            ? 'Nobody is there to receive it — photograph where you left the order'
            : 'Optional, but it protects you if the order is disputed'}
        </Text>
      </View>
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
  const colors = useThemeColors();
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
      {/* onInk: this button is filled with `ink`, which inverts to near-white. */}
      <Icon name={icon} size={18} color={colors.onInk} />
      <Text style={{ color: colors.onInk, fontWeight: '700', fontSize: font.sizes.base }}>{label}</Text>
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
  const colors = useThemeColors();
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
        minHeight: 48,
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
