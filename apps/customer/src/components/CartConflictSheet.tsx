/**
 * "Two carts found" — cross-device cart conflict (Package 02 Slice D).
 *
 * Shown when this device and the server hold DIFFERENT baskets. The product rule
 * is that the customer always chooses: auto-adopting the newer cart would
 * silently discard whatever the other device added, and a basket that quietly
 * got shorter is indistinguishable from a bug. That holds even when both carts
 * are from the same restaurant — see decideRestore in lib/cartSync.ts.
 *
 * WHY THERE IS NO DISMISS. Both outcomes discard a basket, so there is no safe
 * "close without choosing": a stray tap on the backdrop must not pick for them.
 * The Android hardware back button maps to "keep this device's cart", the
 * conservative option, because it changes nothing the customer can currently see
 * and leaves the saved cart on the server to be offered again.
 *
 * The copy names the restaurant and distinguishes same- from cross-restaurant,
 * because the consequences differ: within one restaurant the customer is picking
 * between two versions of the same order, whereas across restaurants keeping the
 * saved cart replaces the whole basket.
 */
import { Modal, Pressable, Text, View } from 'react-native';
import { font, radius, shadow } from '../theme';
import { makeStyles, useThemeColors } from '../themeProvider';
import { useT } from '../i18n';
import { useDirection } from '../lib/direction';
import { Icon } from './Icon';

export interface CartConflictSheetProps {
  visible: boolean;
  /**
   * Name of the restaurant the SAVED cart belongs to. The sheet needs a label
   * even when the merchant lookup failed, so callers pass a fallback rather than
   * this ever being empty.
   */
  savedRestaurantName: string;
  /** Same restaurant on both sides? Changes the wording, never the choice. */
  sameRestaurant: boolean;
  /** Saved cart is past its TTL horizon — say so rather than hide it. */
  stale: boolean;
  /** Busy while the chosen cart is being reconciled through prepare_cart. */
  resolving?: boolean;
  onKeepLocal: () => void;
  onUseSaved: () => void;
}

export function CartConflictSheet({
  visible,
  savedRestaurantName,
  sameRestaurant,
  stale,
  resolving = false,
  onKeepLocal,
  onUseSaved,
}: CartConflictSheetProps) {
  const t = useT();
  const dir = useDirection();
  const styles = useStyles();
  const colors = useThemeColors();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // Android back = the conservative choice, not a silent dismiss.
      onRequestClose={onKeepLocal}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap} accessible={false}>
            <Icon name="cart" size={26} color={colors.sea} />
          </View>
          <Text style={[styles.title, dir.text, styles.center]}>{t('cart.conflictTitle')}</Text>

          <Text style={[styles.body, dir.text, styles.center]}>
            {sameRestaurant
              ? t('cart.conflictSameRestaurant', { name: savedRestaurantName })
              : t('cart.conflictOtherRestaurant', { name: savedRestaurantName })}
          </Text>

          {stale ? (
            <Text style={[styles.stale, dir.text, styles.center]}>{t('cart.conflictStale')}</Text>
          ) : null}

          <Pressable
            style={[styles.primary, resolving && styles.disabled]}
            onPress={onUseSaved}
            disabled={resolving}
            accessibilityRole="button"
            accessibilityState={{ disabled: resolving }}
            accessibilityLabel={t('cart.conflictUseSaved')}>
            <Text style={styles.primaryText}>{t('cart.conflictUseSaved')}</Text>
          </Pressable>

          <Pressable
            style={[styles.secondary, resolving && styles.disabled]}
            onPress={onKeepLocal}
            disabled={resolving}
            accessibilityRole="button"
            accessibilityState={{ disabled: resolving }}
            accessibilityLabel={t('cart.conflictKeepThis')}>
            <Text style={styles.secondaryText}>{t('cart.conflictKeepThis')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: 24,
    alignItems: 'center',
    ...shadow.card,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.seaSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  // dir.text supplies writingDirection (correct for mixed Arabic/Latin strings);
  // this sheet's copy is centred, so textAlign is overridden AFTER it.
  center: { textAlign: 'center' },
  title: {
    fontSize: font.sizes['4xl'],
    fontWeight: font.weights.bold,
    color: colors.ink,
    marginBottom: 10,
  },
  body: { fontSize: font.sizes.lg, color: colors.ink2, lineHeight: 21, marginBottom: 8 },
  // colors.red ON colors.redSoft, not on white. This is the pairing RxBadge
  // already uses for a warning, and it matters: #c8412a on white is ~4.0:1,
  // below AA for body text, whereas the tinted panel lifts it clear. A staleness
  // warning the customer cannot comfortably read is not a warning.
  stale: {
    fontSize: font.sizes.md,
    color: colors.red,
    backgroundColor: colors.redSoft,
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: 12,
    lineHeight: 19,
    marginBottom: 4,
    alignSelf: 'stretch',
  },
  primary: {
    marginTop: 12,
    alignSelf: 'stretch',
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: { color: colors.onAccent, fontWeight: font.weights.bold, fontSize: font.sizes.xl },
  secondary: { marginTop: 6, paddingVertical: 12, alignItems: 'center', alignSelf: 'stretch' },
  secondaryText: { color: colors.ink3, fontSize: font.sizes.lg },
  disabled: { opacity: 0.5 },
}));
