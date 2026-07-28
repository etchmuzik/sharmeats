/**
 * The kitchen queue's control strip: open/closed, chime mute, and shortcuts to
 * Menu / Docs / Tier, plus the multi-brand filter chips.
 *
 * Two behaviours here exist because of production incidents and must be
 * preserved:
 *
 * 1. Staff below manager see the open/closed STATE but not a control. An RLS
 *    denial on UPDATE raises nothing at all — it silently changes no rows — so
 *    a visible-but-dead button would tell the kitchen it had paused when it had
 *    not.
 * 2. The brand chips FILTER the one list; they never split it into per-brand
 *    tabs. A ticket in an unselected tab is an invisible ticket. (The auto-reset
 *    when a new order lands in a filtered-out brand lives in the parent screen.)
 *
 * All targets are 44pt minimum — these are pressed with wet or gloved fingers.
 */
import { Pressable, Text, View } from 'react-native';
import type { KitchenContext } from '../orders';
import { staffRoleLabel } from '../capabilities';
import { colors, font, radius, spacing } from '../theme';
import { Icon } from './Icon';
import { selection, tapMedium } from '../lib/haptics';

const CONTROL_BASE = {
  // 48, not the 44pt iOS floor: these are pressed with wet or gloved hands on a
  // greasy counter tablet. A gloved contact patch is larger and less precise
  // than a bare fingertip, and 44 is calibrated for the latter. Also matches
  // Android's 48dp guidance, which is the primary platform here.
  minHeight: 48,
  paddingHorizontal: spacing.md,
  borderRadius: radius.pill,
  alignItems: 'center',
  justifyContent: 'center',
} as const;

type Props = {
  kitchen: KitchenContext;
  isOpen: boolean;
  mayToggleOpen: boolean;
  togglingOpen: boolean;
  onToggleOpen: () => void;
  muted: boolean;
  onToggleMuted: () => void;
  unreadMsgs: number;
  orders: { restaurant_id: string }[];
  brandFilter: 'all' | string;
  onBrandFilter: (next: 'all' | string) => void;
  compact: boolean;
  onNavigate: (path: '/menu' | '/kyc' | '/tier') => void;
};

export function KitchenHeader({
  kitchen,
  isOpen,
  mayToggleOpen,
  togglingOpen,
  onToggleOpen,
  muted,
  onToggleMuted,
  unreadMsgs,
  orders,
  brandFilter,
  onBrandFilter,
  compact,
  onNavigate,
}: Props) {
  const openLabel = togglingOpen
    ? '…'
    : kitchen.isMultiBrand
      ? isOpen
        ? 'Open · pause all'
        : 'Closed · open all'
      : isOpen
        ? 'Open · pause'
        : 'Closed · open';

  return (
    <View
      style={{
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.md,
        backgroundColor: colors.white,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
        gap: spacing.sm,
      }}
    >
      <View
        style={{
          width: '100%',
          maxWidth: 840,
          alignSelf: 'center',
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            selectable
            numberOfLines={2}
            style={{ fontSize: font.sizes.xl, fontWeight: '800', color: colors.ink }}
          >
            {kitchen.isMultiBrand
              ? `Kitchen · ${kitchen.brands.length} brands`
              : kitchen.brands[0]?.name}
          </Text>
          <Text style={{ marginTop: 2, fontSize: font.sizes.xs, color: colors.ink3 }}>
            {kitchen.isMultiBrand
              ? kitchen.brands.map((b) => b.shortName).join(' · ')
              : `Restaurant · ${staffRoleLabel(kitchen.brands[0]?.staffRole)}`}
          </Text>
        </View>
        {unreadMsgs > 0 && (
          <View
            accessibilityLabel={`${unreadMsgs} unread customer messages. Open an order to reply.`}
            style={{
              minWidth: 44,
              minHeight: 44,
              paddingHorizontal: spacing.sm,
              borderRadius: radius.pill,
              backgroundColor: colors.accentSoft,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
            }}
          >
            <Icon name="chat" size={16} color={colors.accentDark} />
            <Text style={{ fontSize: font.sizes.sm, fontWeight: '800', color: colors.accentDark }}>
              {unreadMsgs}
            </Text>
          </View>
        )}
      </View>

      <View
        style={{
          width: '100%',
          maxWidth: 840,
          alignSelf: 'center',
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: spacing.sm,
        }}
      >
        {mayToggleOpen ? (
          <Pressable
            onPress={() => {
              tapMedium();
              onToggleOpen();
            }}
            disabled={togglingOpen}
            accessibilityRole="switch"
            accessibilityLabel={
              kitchen.isMultiBrand ? 'All brands accepting orders' : 'Restaurant accepting orders'
            }
            accessibilityState={{ checked: isOpen, disabled: togglingOpen, busy: togglingOpen }}
            style={[
              CONTROL_BASE,
              { backgroundColor: isOpen ? colors.greenSoft : colors.redSoft },
              compact && { flexGrow: 1, flexBasis: '46%' },
            ]}
          >
            <Text
              style={{
                fontSize: font.sizes.sm,
                fontWeight: '700',
                color: isOpen ? colors.greenText : colors.redText,
              }}
            >
              {openLabel}
            </Text>
          </Pressable>
        ) : (
          <View
            accessibilityRole="text"
            accessibilityLabel={
              isOpen
                ? 'Accepting orders. Only an owner or manager can pause.'
                : 'Not accepting orders. Only an owner or manager can reopen.'
            }
            style={[
              CONTROL_BASE,
              { backgroundColor: isOpen ? colors.greenSoft : colors.redSoft },
              compact && { flexGrow: 1, flexBasis: '46%' },
            ]}
          >
            <Text
              style={{
                fontSize: font.sizes.sm,
                fontWeight: '700',
                color: isOpen ? colors.greenText : colors.redText,
              }}
            >
              {isOpen ? 'Open' : 'Closed'}
            </Text>
          </View>
        )}

        {/* [H-REST3] Mute the new-order chime (and its repeat). Distinct muted
            state so staff can see at a glance the counter is silent. */}
        <Pressable
          onPress={() => {
            selection();
            onToggleMuted();
          }}
          accessibilityRole="switch"
          accessibilityState={{ checked: muted }}
          accessibilityLabel={
            muted
              ? 'Sound off — tap to turn new-order chime on'
              : 'Sound on — tap to mute new-order chime'
          }
          style={[
            CONTROL_BASE,
            {
              flexDirection: 'row',
              gap: 5,
              backgroundColor: muted ? colors.redSoft : colors.greenSoft,
            },
            compact && { flexGrow: 1, flexBasis: '46%' },
          ]}
        >
          <Icon name={muted ? 'mute' : 'sound'} size={14} color={muted ? colors.redText : colors.greenText} />
          <Text
            style={{
              fontSize: font.sizes.sm,
              fontWeight: '700',
              color: muted ? colors.redText : colors.greenText,
            }}
          >
            {muted ? 'Muted' : 'Sound'}
          </Text>
        </Pressable>

        <NavControl label="Menu" a11y="Menu availability" compact={compact} onPress={() => onNavigate('/menu')} />
        <NavControl label="Docs" a11y="Verification documents" compact={compact} onPress={() => onNavigate('/kyc')} />
        <NavControl label="Tier" a11y="View tier status" compact={compact} onPress={() => onNavigate('/tier')} />
      </View>

      {kitchen.isMultiBrand && (
        <View
          style={{
            width: '100%',
            maxWidth: 840,
            alignSelf: 'center',
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: spacing.sm,
            marginTop: spacing.sm,
          }}
        >
          <BrandChip
            label={`All · ${orders.length}`}
            a11y={`Show all brands, ${orders.length} active orders`}
            selected={brandFilter === 'all'}
            onPress={() => onBrandFilter('all')}
          />
          {kitchen.brands.map((b) => {
            const count = orders.filter((o) => o.restaurant_id === b.restaurantId).length;
            const selected = brandFilter === b.restaurantId;
            return (
              <BrandChip
                key={b.restaurantId}
                label={`${b.shortName} · ${count}`}
                a11y={`Filter to ${b.name}, ${count} active orders${b.isOpen ? '' : ', paused'}`}
                selected={selected}
                closed={!b.isOpen}
                onPress={() => onBrandFilter(selected ? 'all' : b.restaurantId)}
              />
            );
          })}
        </View>
      )}
    </View>
  );
}

function NavControl({
  label,
  a11y,
  compact,
  onPress,
}: {
  label: string;
  a11y: string;
  compact: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        selection();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={[
        CONTROL_BASE,
        { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bgSoft },
        compact && { flexGrow: 1, flexBasis: '28%' },
      ]}
    >
      <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: colors.accent }}>{label}</Text>
    </Pressable>
  );
}

function BrandChip({
  label,
  a11y,
  selected,
  closed,
  onPress,
}: {
  label: string;
  a11y: string;
  selected: boolean;
  closed?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        selection();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={a11y}
      style={[
        CONTROL_BASE,
        {
          borderWidth: 1,
          borderColor: selected ? colors.accent : colors.line,
          backgroundColor: selected ? colors.accentSoft : colors.white,
        },
      ]}
    >
      <Text
        style={{
          fontSize: font.sizes.sm,
          fontWeight: '700',
          color: selected ? colors.accentDark : colors.ink2,
          textDecorationLine: closed ? 'line-through' : 'none',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
