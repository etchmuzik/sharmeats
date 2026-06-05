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
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../../src/components/BackButton';
import { PrimaryButton } from '../../src/components/PrimaryButton';
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
  const [pinPlaced, setPinPlaced] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  // Capture a real GPS pin so the driver always has a map point (every kind).
  const captureLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocating(false);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      setPinPlaced(true);
      selection();
    } catch {
      // keep silent; user can still save without a pin
    } finally {
      setLocating(false);
    }
  };

  useEffect(() => {
    if (kind === 'hotel') db.hotels.search(hotelQuery).then(setHotels);
  }, [hotelQuery, kind]);

  const canSave =
    kind === 'hotel'
      ? !!pickedHotel && room.trim().length > 0
      : kind === 'street'
        ? street.trim().length > 0
        : beachName.trim().length > 0 && pinPlaced;

  const save = async () => {
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
        label: 'Beach pin',
        beachName: beachName.trim(),
        ...geo,
      };
    }
    await db.user.addAddress(a);
    setSelectedAddressId(a.id);
    success();
    goBack();
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

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140 + insets.bottom, gap: 16 }}>
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
            <Text style={styles.label}>Location pin</Text>
            <Pressable onPress={captureLocation} style={styles.mapMock}>
              <Text style={{ fontSize: 32 }}>{coords ? '📍' : '🗺️'}</Text>
              <Text style={styles.mapText}>
                {locating
                  ? 'Getting your location…'
                  : coords
                    ? `Pinned (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`
                    : t('address.beachHint')}
              </Text>
            </Pressable>
          </>
        )}

        {/* Universal GPS pin — hotels & apartments get a pin too, so the driver
            always has a precise map point regardless of the structured fields. */}
        {kind !== 'beach_pin' && (
          <Pressable onPress={captureLocation} style={styles.pinRow}>
            <Text style={{ fontSize: 18 }}>{coords ? '📍' : '🧭'}</Text>
            <Text style={styles.pinRowText}>
              {locating
                ? 'Getting your location…'
                : coords
                  ? `Location pinned (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`
                  : 'Add a precise GPS pin (recommended)'}
            </Text>
          </Pressable>
        )}
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: 24 + insets.bottom }]}>
        <PrimaryButton label={t('common.save')} onPress={save} disabled={!canSave} />
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
  verifiedText: { color: colors.sea, fontSize: 10.5, fontWeight: font.weights.bold },
  segment: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  segBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: colors.bgSoft },
  segBtnActive: { backgroundColor: colors.ink },
  segText: { fontSize: font.sizes.lg, color: colors.ink, fontWeight: font.weights.bold },
  mapMock: {
    height: 180,
    backgroundColor: colors.seaSoft,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  mapText: { fontSize: font.sizes.lg, color: colors.sea, fontWeight: font.weights.semibold },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: colors.seaSoft,
    borderRadius: radius.lg,
  },
  pinRowText: { flex: 1, fontSize: font.sizes.base, color: colors.sea, fontWeight: font.weights.medium },
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
