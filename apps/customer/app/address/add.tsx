import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../../src/components/BackButton';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { MapPinPicker, type LatLng } from '../../src/components/MapPinPicker';
import { colors, font, radius } from '../../src/theme';
import { useT } from '../../src/i18n';
import { db } from '../../src/data';
import type { Address, AddressKind, Hotel } from '../../src/data/types';
import { useSession } from '../../src/store/session';
import { selection, success } from '../../src/haptics';
import { useGoBack } from '../../src/lib/navigation';

export default function AddAddress() {
  const goBack = useGoBack('/address/picker');
  const insets = useSafeAreaInsets();
  const t = useT();
  const { kind: kindParam } = useLocalSearchParams<{ kind?: string }>();
  const kind: AddressKind = (kindParam as AddressKind) ?? 'hotel';
  const setSelectedAddressId = useSession((s) => s.setSelectedAddressId);

  const [hotelQuery, setHotelQuery] = useState('');
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [pickedHotel, setPickedHotel] = useState<Hotel | null>(null);
  const [room, setRoom] = useState('');
  const [handoff, setHandoff] = useState<'lobby' | 'reception' | 'poolside'>('lobby');

  const [street, setStreet] = useState('');
  const [block, setBlock] = useState('');
  const [floor, setFloor] = useState('');
  const [apt, setApt] = useState('');
  const [landmark, setLandmark] = useState('');

  const [beachName, setBeachName] = useState('');
  const [coords, setCoords] = useState<LatLng | null>(null);
  // While a finger is on the map, the page must not scroll — otherwise map
  // panning / pin dragging scrolls the form instead.
  const [mapActive, setMapActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const pinLabels = {
    hint: t('address.pinHint'),
    pinned: coords
      ? `${t('address.pinned')} (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`
      : t('address.pinned'),
    locateMe: t('address.locateMe'),
    locating: t('address.locating'),
    denied: t('address.locationDenied'),
    failed: t('address.locationFailed'),
  };

  useEffect(() => {
    if (kind === 'hotel') db.hotels.search(hotelQuery).then(setHotels);
  }, [hotelQuery, kind]);

  // A beach pin must have a location; hotels/street are saveable without one
  // (the pin is recommended, not required, since they have structured fields).
  const canSave =
    kind === 'hotel'
      ? !!pickedHotel && room.trim().length > 0
      : kind === 'street'
        ? street.trim().length > 0
        : beachName.trim().length > 0 && !!coords;

  const save = async () => {
    if (saving) return; // guard against double-tap → duplicate insert
    const geo = coords ? { lat: coords.lat, lng: coords.lng } : {};
    let a: Address;
    if (kind === 'hotel' && pickedHotel) {
      a = {
        id: `a-${Date.now()}`,
        kind: 'hotel',
        label: pickedHotel.name,
        hotelId: pickedHotel.id,
        hotelName: pickedHotel.name,
        roomNumber: room.trim(),
        handoff,
        ...geo,
      };
    } else if (kind === 'street') {
      const blockTrim = block.trim();
      const floorTrim = floor.trim();
      const aptTrim = apt.trim();
      a = {
        id: `a-${Date.now()}`,
        kind: 'street',
        label: t('address.street'),
        streetText: street.trim(),
        building: blockTrim ? `${t('address.block')} ${blockTrim}` : undefined,
        apartment:
          floorTrim || aptTrim
            ? [
                floorTrim ? `${t('address.floor')} ${floorTrim}` : '',
                aptTrim ? `${t('address.apt')} ${aptTrim}` : '',
              ]
                .filter(Boolean)
                .join(' · ')
            : undefined,
        landmark: landmark.trim() || undefined,
        ...geo,
      };
    } else {
      a = {
        id: `a-${Date.now()}`,
        kind: 'beach_pin',
        label: t('address.beachPin'),
        beachName: beachName.trim(),
        ...geo,
      };
    }

    setSaving(true);
    setSaveError(null);
    try {
      // Persist and use the SERVER-returned id (the DB assigns a real UUID;
      // the local `a-${Date.now()}` id is not the row's id). Selecting the
      // returned id ensures checkout points at the address that was just saved.
      const saved = await db.user.addAddress(a);
      setSelectedAddressId(saved.id);
      success();
      goBack();
    } catch {
      setSaveError(t('address.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <View style={[styles.head, { paddingTop: insets.top + 12 }]}>
        <BackButton fallback="/address/picker" />
        <Text style={styles.title}>{t('address.add')}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        scrollEnabled={!mapActive}
        contentContainerStyle={{ padding: 20, paddingBottom: 140 + insets.bottom, gap: 16 }}>
        {kind === 'hotel' && (
          <>
            <Text style={styles.label}>{t('address.searchHotel')}</Text>
            <TextInput
              value={hotelQuery}
              onChangeText={setHotelQuery}
              placeholder="Hilton, Marriott, …"
              placeholderTextColor={colors.ink3}
              style={styles.input}
            />
            <View style={{ gap: 8 }}>
              {hotels.map((h) => (
                <Pressable
                  key={h.id}
                  onPress={() => {
                    selection();
                    setPickedHotel(h);
                  }}
                  style={[
                    styles.hotelRow,
                    pickedHotel?.id === h.id && { borderColor: colors.accent, backgroundColor: colors.accentSoft },
                  ]}>
                  <Text style={styles.hotelIcon}>🏨</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.hotelName}>{h.name}</Text>
                    <Text style={styles.hotelMeta}>
                      {h.brand} · {h.zone.replace('_', ' ')}
                    </Text>
                  </View>
                  {h.verified && (
                    <View style={styles.verifiedTag}>
                      <Text style={styles.verifiedText}>✓ Verified</Text>
                    </View>
                  )}
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>{t('address.roomNumber')}</Text>
            <TextInput
              value={room}
              onChangeText={setRoom}
              placeholder="412"
              placeholderTextColor={colors.ink3}
              keyboardType="number-pad"
              style={styles.input}
            />

            <Text style={styles.label}>{t('address.handoff')}</Text>
            <View style={styles.segment}>
              {(['lobby', 'reception', 'poolside'] as const).map((h) => (
                <Pressable
                  key={h}
                  onPress={() => {
                    selection();
                    setHandoff(h);
                  }}
                  style={[styles.segBtn, handoff === h && styles.segBtnActive]}>
                  <Text style={[styles.segText, handoff === h && { color: colors.white }]}>
                    {h === 'lobby' ? t('address.lobby') : h === 'reception' ? t('address.reception') : t('address.poolside')}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {kind === 'street' && (
          <>
            <Text style={styles.label}>{t('address.streetText')}</Text>
            <TextInput value={street} onChangeText={setStreet} style={styles.input} placeholder="السلام، شارع الإمام علي" placeholderTextColor={colors.ink3} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.label}>{t('address.block')}</Text>
                <TextInput value={block} onChangeText={setBlock} style={styles.input} placeholder="14" placeholderTextColor={colors.ink3} keyboardType="number-pad" />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.label}>{t('address.floor')}</Text>
                <TextInput value={floor} onChangeText={setFloor} style={styles.input} placeholder="3" placeholderTextColor={colors.ink3} keyboardType="number-pad" />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.label}>{t('address.apt')}</Text>
                <TextInput value={apt} onChangeText={setApt} style={styles.input} placeholder="7" placeholderTextColor={colors.ink3} />
              </View>
            </View>
            <Text style={styles.label}>{t('address.landmark')}</Text>
            <TextInput value={landmark} onChangeText={setLandmark} style={styles.input} placeholder="جنب مسجد الرحمة" placeholderTextColor={colors.ink3} />
          </>
        )}

        {kind === 'beach_pin' && (
          <>
            <Text style={styles.label}>{t('address.beachName')}</Text>
            <TextInput
              value={beachName}
              onChangeText={setBeachName}
              style={styles.input}
              placeholder="Sharks Bay Beach Club"
              placeholderTextColor={colors.ink3}
            />
          </>
        )}

        {/* Interactive map pin — every address kind gets one so the driver always
            has a precise point. Required for a beach pin (no structured fields);
            recommended (but optional) for hotels & apartments. */}
        <Text style={styles.label}>{t('address.pinTitle')}</Text>
        {kind !== 'beach_pin' && !coords && (
          <Text style={styles.pinNudge}>{t('address.pinRecommended')}</Text>
        )}
        <MapPinPicker
          value={coords}
          onChange={setCoords}
          onInteractionChange={setMapActive}
          labels={pinLabels}
        />
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: 24 + insets.bottom }]}>
        {saveError && <Text style={styles.saveError}>{saveError}</Text>}
        <PrimaryButton
          label={saving ? t('address.saving') : t('common.save')}
          onPress={save}
          disabled={!canSave || saving}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  head: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bg,
  },
  title: { fontSize: font.sizes['5xl'], fontWeight: font.weights.extrabold, letterSpacing: -0.4, color: colors.ink },
  label: { fontSize: font.sizes.md, fontWeight: font.weights.bold, color: colors.ink2, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: font.sizes.xl,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  hotelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
  },
  hotelIcon: { fontSize: 20 },
  hotelName: { fontSize: font.sizes.xl, color: colors.ink, fontWeight: font.weights.bold },
  hotelMeta: { fontSize: font.sizes.md, color: colors.ink2, marginTop: 2 },
  verifiedTag: { backgroundColor: colors.seaSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  verifiedText: { color: colors.sea, fontSize: font.sizes.xs, fontWeight: font.weights.bold },
  segment: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  segBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: colors.bgSoft },
  segBtnActive: { backgroundColor: colors.ink },
  segText: { fontSize: font.sizes.lg, color: colors.ink, fontWeight: font.weights.bold },
  pinNudge: { fontSize: font.sizes.base, color: colors.ink2, marginTop: -6 },
  saveError: { fontSize: font.sizes.base, color: colors.accentDark, fontWeight: font.weights.medium, marginBottom: 10, textAlign: 'center' },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
});
