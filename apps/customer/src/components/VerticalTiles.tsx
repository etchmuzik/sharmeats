import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { makeStyles, useThemeColors } from '../themeProvider';
import { font, radius } from '../theme';
import { Icon, type IconName } from './Icon';
import { db } from '../data';
import type { Vertical } from '../data/types';
import { useSession } from '../store/session';
import { useDirection } from '../lib/direction';
import { tap } from '../haptics';

/** DB verticals.icon slug → the app's semantic icon set. */
const TILE_ICON: Record<string, IconName> = {
  utensils: 'dish',
  'shopping-cart': 'cart',
  pill: 'pill',
};

/**
 * Vertical switcher (tile row under the home header). Renders NOTHING while
 * the account can only see one vertical: the server's launch_stage +
 * private-access gating decides the list, so a public user gets no hint that
 * grocery/pharmacy exist until they hold an active grant. Food is the current
 * screen, so its tile stays put; other verticals push their landing.
 */
export function VerticalTiles() {
  const styles = useStyles();
  const colors = useThemeColors();
  const router = useRouter();
  const locale = useSession((s) => s.locale);
  const dir = useDirection();
  const [verticals, setVerticals] = useState<Vertical[]>([]);

  useEffect(() => {
    let mounted = true;
    db.verticals
      .list()
      .then((vs) => {
        if (mounted) setVerticals(vs);
      })
      // Decorative for single-vertical accounts — a fetch failure hides the row.
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  if (verticals.length < 2) return null;

  return (
    <View style={[styles.row, dir.row]}>
      {verticals.map((v) => {
        const label = locale === 'ar' ? v.nameAr : v.nameEn;
        return (
          <Pressable
            key={v.id}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => {
              tap();
              if (v.id !== 'food') router.push(`/vertical/${v.id}` as never);
            }}
            style={styles.tile}>
            <Icon name={TILE_ICON[v.icon ?? ''] ?? 'dish'} size={22} color={colors.sea} />
            <Text style={styles.label} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 14 },
  tile: {
    flex: 1,
    minHeight: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  label: { fontSize: font.sizes.sm, color: colors.ink, fontWeight: font.weights.semibold },
}));
