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
import { parseStaffRole } from '../capabilities';
import { colors, font, radius, spacing } from '../theme';
import { Icon } from './Icon';
import { LogoButton } from './LogoButton';
import { selection, tapMedium } from '../lib/haptics';
import { useLocale } from '../locale';

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
  const { direction, locale, t, toggleLocale } = useLocale();
  const rawRole = kitchen.brands[0]?.staffRole;
  const role = parseStaffRole(rawRole);
  const roleLabel = role ? t(`role.${role}`) : rawRole?.trim() || t('role.staff');
  const openLabel = togglingOpen
    ? '…'
    : kitchen.isMultiBrand
      ? isOpen
        ? t('header.openPauseAll')
        : t('header.closedOpenAll')
      : isOpen
        ? t('header.openPause')
        : t('header.closedOpen');

  return (
    <View
      style={{
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.md,
        backgroundColor: colors.white,
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
        gap: spacing.sm,
        direction,
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
        {/* Logo is single-brand only: a cloud kitchen would need one per brand,
            and a header can honestly represent only one. Multi-brand logo
            management belongs in a per-brand screen when that exists. */}
        {!kitchen.isMultiBrand && kitchen.brands[0] && (
          <LogoButton
            restaurantId={kitchen.brands[0].restaurantId}
            name={kitchen.brands[0].name}
          />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            selectable
            numberOfLines={2}
            style={{ fontSize: font.sizes.xl, fontWeight: '800', color: colors.ink }}
          >
            {kitchen.isMultiBrand
              ? t('header.kitchenBrandCount', { count: kitchen.brands.length })
              : kitchen.brands[0]?.name}
          </Text>
          <Text style={{ marginTop: 2, fontSize: font.sizes.xs, color: colors.ink3 }}>
            {kitchen.isMultiBrand
              ? kitchen.brands.map((b) => b.shortName).join(' · ')
              : t('header.restaurantRole', { role: roleLabel })}
          </Text>
        </View>
        {unreadMsgs > 0 && (
          <View
            accessibilityLabel={t('header.unreadMessages', { count: unreadMsgs })}
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
        <Pressable
          onPress={() => {
            selection();
            toggleLocale();
          }}
          accessibilityRole="button"
          accessibilityLabel={
            locale === 'en' ? t('locale.switchToArabic') : t('locale.switchToEnglish')
          }
          style={[
            CONTROL_BASE,
            {
              minWidth: 64,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: colors.bgSoft,
            },
          ]}
        >
          <Text
            style={{
              fontSize: font.sizes.sm,
              fontWeight: '800',
              color: colors.accentDark,
              writingDirection: locale === 'en' ? 'rtl' : 'ltr',
            }}
          >
            {locale === 'en' ? 'العربية' : 'English'}
          </Text>
        </Pressable>
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
              kitchen.isMultiBrand
                ? t('header.acceptingAllA11y')
                : t('header.acceptingRestaurantA11y')
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
                ? t('header.openRestricted')
                : t('header.closedRestricted')
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
              {isOpen ? t('header.open') : t('header.closed')}
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
              ? t('header.soundOffA11y')
              : t('header.soundOnA11y')
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
            {muted ? t('header.muted') : t('header.sound')}
          </Text>
        </Pressable>

        <NavControl label={t('nav.menu')} a11y={t('header.menuA11y')} compact={compact} onPress={() => onNavigate('/menu')} />
        <NavControl label={t('header.docs')} a11y={t('header.docsA11y')} compact={compact} onPress={() => onNavigate('/kyc')} />
        <NavControl label={t('nav.tier')} a11y={t('header.tierA11y')} compact={compact} onPress={() => onNavigate('/tier')} />
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
            label={t('header.allOrders', { count: orders.length })}
            a11y={t('header.allOrdersA11y', { count: orders.length })}
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
                a11y={t('header.brandFilterA11y', {
                  brand: b.name,
                  count,
                  paused: b.isOpen ? '' : t('header.pausedSuffix'),
                })}
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
