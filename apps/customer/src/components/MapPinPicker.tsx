import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
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
const SHARM_CENTER: LatLng = { lat: 27.9158, lng: 34.3299 };
const DEFAULT_DELTA = 0.04;

interface MapPinPickerProps {
  /** Current pin, or null if none placed yet. */
  value: LatLng | null;
  /** Called whenever the pin moves (drag, tap, or locate-me). */
  onChange: (coord: LatLng) => void;
  /** Localized strings (so the component stays i18n-agnostic). */
  labels: {
    hint: string; // shown before a pin exists
    pinned: string; // shown after, with coords appended by the parent if desired
    locateMe: string;
    locating: string;
    denied: string; // permission denied message
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
export function MapPinPicker({ value, onChange, labels, height = 240 }: MapPinPickerProps) {
  const mapRef = useRef<MapView | null>(null);
  const [locating, setLocating] = useState(false);
  const [denied, setDenied] = useState(false);

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
        { ...coord, latitude: coord.lat, longitude: coord.lng, latitudeDelta: DEFAULT_DELTA, longitudeDelta: DEFAULT_DELTA },
        350,
      );
    }
  };

  const locateMe = async () => {
    setDenied(false);
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setDenied(true);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      moveTo({ lat: pos.coords.latitude, lng: pos.coords.longitude }, true);
      success();
    } catch {
      setDenied(true);
    } finally {
      setLocating(false);
    }
  };

  return (
    <View style={{ gap: 8 }}>
      <View style={[styles.mapWrap, { height }]}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
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
      {denied && <Text style={styles.denied}>{labels.denied}</Text>}
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
  denied: { fontSize: font.sizes.base, color: colors.accentDark, fontWeight: font.weights.medium },
});
