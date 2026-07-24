import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { Icon } from './Icon';
import { colors, font, radius } from '../theme';
import { selection, success } from '../haptics';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Naama Bay — the tourist heart of Sharm el-Sheikh. Sensible map center before GPS. */
export const SHARM_CENTER: LatLng = { lat: 27.9158, lng: 34.3299 };
const DEFAULT_DELTA = 0.04;

/** Give a fresh GPS fix this long before falling back (simulators with no
 *  simulated location and deep-indoor devices otherwise hang forever). */
const FIX_TIMEOUT_MS = 8000;

interface MapPinPickerProps {
  /** Current pin, or null if none placed yet. */
  value: LatLng | null;
  /** Called whenever the pin moves (drag, tap, or locate-me). */
  onChange: (coord: LatLng) => void;
  /**
   * Fires with `true` while a touch is on the map, `false` when it ends. The
   * parent screen must disable its ScrollView during interaction, otherwise
   * the page scrolls when the user tries to pan the map or drag the pin.
   */
  onInteractionChange?: (active: boolean) => void;
  /** Localized strings (so the component stays i18n-agnostic). */
  labels: {
    hint: string; // shown before a pin exists
    pinned: string; // shown after, with coords appended by the parent if desired
    locateMe: string;
    locating: string;
    denied: string; // permission denied — tappable, deep-links to Settings
    failed: string; // permission granted but no GPS fix (timeout / no signal)
  };
  /** Map height. */
  height?: number;
}

/**
 * An interactive Apple Maps (iOS) pin picker. The user can drag the marker, tap
 * the map to move it, or hit "use my location" to drop it on their GPS position.
 * No API key is required on iOS (Apple Maps); Android would need a Google Maps key.
 *
 * The pin is the single source of truth for delivery-zone resolution + fees, so
 * letting the user place it manually (not just GPS) matters for order-ahead.
 */
export function MapPinPicker({
  value,
  onChange,
  onInteractionChange,
  labels,
  height = 240,
}: MapPinPickerProps) {
  const mapRef = useRef<MapView | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<'denied' | 'failed' | null>(null);

  const region: Region = {
    latitude: value?.lat ?? SHARM_CENTER.lat,
    longitude: value?.lng ?? SHARM_CENTER.lng,
    latitudeDelta: DEFAULT_DELTA,
    longitudeDelta: DEFAULT_DELTA,
  };

  const moveTo = (coord: LatLng, recenter = false) => {
    onChange(coord);
    if (recenter) {
      mapRef.current?.animateToRegion(
        {
          latitude: coord.lat,
          longitude: coord.lng,
          latitudeDelta: DEFAULT_DELTA,
          longitudeDelta: DEFAULT_DELTA,
        },
        350,
      );
    }
  };

  const locateMe = async () => {
    setError(null);
    setLocating(true);
    let placed = false;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('denied');
        return;
      }

      // 1. Cached fix first: instant, good enough to center the map while the
      //    fresh fix comes in (or when it never does).
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last) {
        placed = true;
        moveTo({ lat: last.coords.latitude, lng: last.coords.longitude }, true);
      }

      // 2. Fresh fix, but never hang: race against a timeout. Balanced accuracy
      //    is plenty for a delivery pin and much faster than High indoors.
      const fresh = await Promise.race<Location.LocationObject>([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('gps-timeout')), FIX_TIMEOUT_MS),
        ),
      ]);
      placed = true;
      moveTo({ lat: fresh.coords.latitude, lng: fresh.coords.longitude }, true);
      success();
    } catch {
      // Permission was granted but we couldn't get a fix. If the cached
      // position already placed the pin, that's a fine outcome — stay quiet.
      if (!placed) setError('failed');
    } finally {
      setLocating(false);
    }
  };

  return (
    <View style={{ gap: 8 }}>
      <View
        style={[styles.mapWrap, { height }]}
        // Claim the gesture while a finger is on the map so the parent
        // ScrollView doesn't scroll the page mid-pan / mid-pin-drag.
        onTouchStart={() => onInteractionChange?.(true)}
        onTouchEnd={() => onInteractionChange?.(false)}
        onTouchCancel={() => onInteractionChange?.(false)}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          showsUserLocation
          showsMyLocationButton={false}
          onPress={(e) => {
            selection();
            moveTo({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude });
          }}>
          {value && (
            <Marker
              draggable
              coordinate={{ latitude: value.lat, longitude: value.lng }}
              onDragEnd={(e) => {
                selection();
                onChange({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude });
              }}
              pinColor={colors.accent}
            />
          )}
        </MapView>

        {/* Locate-me button overlaid on the map */}
        <Pressable
          onPress={locateMe}
          disabled={locating}
          accessibilityRole="button"
          accessibilityLabel={labels.locateMe}
          style={styles.locateBtn}>
          {locating ? (
            <ActivityIndicator size="small" color={colors.sea} />
          ) : (
            <Icon name="location" size={20} color={colors.sea} />
          )}
        </Pressable>
      </View>

      <Text style={styles.hint}>
        {locating ? labels.locating : value ? labels.pinned : labels.hint}
      </Text>
      {error === 'denied' && (
        <Pressable
          onPress={() => Linking.openSettings()}
          accessibilityRole="button"
          accessibilityLabel={labels.denied}>
          <Text style={[styles.error, styles.errorLink]}>{labels.denied}</Text>
        </Pressable>
      )}
      {error === 'failed' && <Text style={styles.error}>{labels.failed}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  mapWrap: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.line,
  },
  locateBtn: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
  },
  hint: { fontSize: font.sizes.base, color: colors.ink2, fontWeight: font.weights.medium },
  error: { fontSize: font.sizes.base, color: colors.accentDark, fontWeight: font.weights.medium },
  errorLink: { textDecorationLine: 'underline' },
});
