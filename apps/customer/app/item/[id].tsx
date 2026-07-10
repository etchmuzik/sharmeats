import { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackButton } from '../../src/components/BackButton';
import { FlagBadge } from '../../src/components/FlagBadge';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { QuantityStepper } from '../../src/components/QuantityStepper';
import { AllergyChipRow } from '../../src/components/AllergyChipRow';
import { ModifierGroup } from '../../src/components/ModifierGroup';
import { colors, font, radius } from '../../src/theme';
import { db } from '../../src/data';
import {
  ALLERGY_TO_FLAG,
  type AllergyKey,
  type CartItemModifierChoice,
  type MenuItem,
  type Restaurant,
} from '../../src/data/types';
import { useCart } from '../../src/store/cart';
import { useT } from '../../src/i18n';
import { formatEgp } from '../../src/lib/format';
import { success, tap } from '../../src/haptics';
import { useGoBack } from '../../src/lib/navigation';
import { track } from '../../src/lib/analytics';

interface SelectionMap {
  // modifierId → Set of optionIds
  [modifierId: string]: Set<string>;
}

export default function ItemModal() {
  const { id, lineId } = useLocalSearchParams<{ id: string; lineId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const addToCart = useCart((s) => s.add);
  const updateLine = useCart((s) => s.updateLine);
  const editingLine = useCart((s) =>
    lineId ? s.lines.find((l) => l.lineId === lineId) ?? null : null,
  );
  const isEditing = !!editingLine;

  const [item, setItem] = useState<MenuItem | null>(null);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  // Dismiss to the parent restaurant when there's no history (deep link / cold
  // launch into the item modal); otherwise just pop the modal.
  const goBack = useGoBack(
    restaurant ? (`/restaurant/${restaurant.id}` as Href) : '/(tabs)/home',
  );
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const [sel, setSel] = useState<SelectionMap>({});
  const [allergies, setAllergies] = useState<AllergyKey[]>([]);
  const [profileAllergies, setProfileAllergies] = useState<AllergyKey[]>([]);
  const [bypassConflict, setBypassConflict] = useState(false);
  const [allergyOpen, setAllergyOpen] = useState(false);

  useEffect(() => {
    db.user.getMe().then((u) => {
      const profile = u.allergyProfile ?? [];
      setProfileAllergies(profile);
      // Edit mode: prefer the saved line's allergens. Fresh add: seed from profile.
      if (!editingLine) setAllergies(profile);
    });
  }, [editingLine]);

  useEffect(() => {
    if (!id) return;
    db.menus.getItem(id).then((i) => {
      setItem(i);
      if (i) {
        db.restaurants.get(i.restaurantId).then(setRestaurant);
        if (editingLine) {
          // Edit mode: rebuild selection state from saved line.
          const initial: SelectionMap = {};
          for (const m of i.modifiers) initial[m.id] = new Set();
          for (const c of editingLine.modifierChoices) {
            if (!initial[c.modifierId]) initial[c.modifierId] = new Set();
            initial[c.modifierId].add(c.optionId);
          }
          setSel(initial);
          setQty(editingLine.quantity);
          setNotes(editingLine.notes ?? '');
          setAllergies(editingLine.allergens ?? []);
        } else {
          // Fresh add: seed defaults.
          const initial: SelectionMap = {};
          for (const m of i.modifiers) {
            initial[m.id] = new Set(m.options.filter((o) => o.isDefault).map((o) => o.id));
          }
          setSel(initial);
        }
      }
    });
  }, [id, editingLine]);

  if (!item || !restaurant) {
    return (
      <View style={styles.loading}>
        <StatusBar style="dark" />
      </View>
    );
  }

  const toggleOption = (modifierId: string, optionId: string, maxSelect: number) => {
    setSel((prev) => {
      const cur = new Set(prev[modifierId] ?? []);
      if (cur.has(optionId)) {
        cur.delete(optionId);
      } else {
        if (maxSelect === 1) {
          cur.clear();
        } else if (cur.size >= maxSelect) {
          return prev;
        }
        cur.add(optionId);
      }
      return { ...prev, [modifierId]: cur };
    });
  };

  const choices: CartItemModifierChoice[] = [];
  let extras = 0;
  for (const m of item.modifiers) {
    const selectedOpts = sel[m.id] ?? new Set();
    for (const o of m.options) {
      if (selectedOpts.has(o.id)) {
        choices.push({
          modifierId: m.id,
          modifierName: m.name,
          optionId: o.id,
          optionName: o.name,
          priceDeltaEgp: o.priceDeltaEgp,
        });
        extras += o.priceDeltaEgp;
      }
    }
  }
  const linePrice = (item.priceEgp + extras) * qty;
  const requiredOk = item.modifiers.every(
    (m) => !m.required || (sel[m.id]?.size ?? 0) >= m.minSelect,
  );

  // Conflict = the selected allergens whose flag intersects this item's flags.
  const conflicts: AllergyKey[] = allergies.filter((a) => {
    const flag = ALLERGY_TO_FLAG[a];
    return flag ? item.flags.includes(flag) : false;
  });
  const hasConflict = conflicts.length > 0;
  const blocked = hasConflict && !bypassConflict;

  // Default ingredients (style 'ingredients') the user removed -> "No X" lines
  // for the kitchen. A removed ingredient is an isDefault option that's no
  // longer selected; these aren't priced choices, so they live in the note.
  const removedIngredients: string[] = [];
  for (const m of item.modifiers) {
    if (m.style !== 'ingredients') continue;
    const selectedOpts = sel[m.id] ?? new Set();
    for (const o of m.options) {
      if (o.isDefault && !selectedOpts.has(o.id)) removedIngredients.push(o.name);
    }
  }

  // Compose the notes sent to the kitchen: removed ingredients, then an allergen
  // line, then the user's free-text note.
  const composeNotes = (): string | undefined => {
    const lines: string[] = [];
    if (removedIngredients.length > 0) {
      lines.push(`No: ${removedIngredients.join(', ')}`);
    }
    if (allergies.length > 0) {
      lines.push(
        `⚠ ${t('cart.allergensPrefix')}: ${allergies.map((a) => t(`allergy.${a}`)).join(', ')}`,
      );
    }
    const userNote = notes.trim();
    if (userNote) lines.push(userNote);
    return lines.length > 0 ? lines.join('\n') : undefined;
  };

  const onSubmit = () => {
    const payload = {
      quantity: qty,
      modifierChoices: choices,
      notes: composeNotes(),
      allergens: allergies.length > 0 ? allergies : undefined,
    };
    if (isEditing && lineId) {
      updateLine(lineId, payload);
    } else {
      addToCart({
        itemId: item.id,
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        name: item.name,
        basePriceEgp: item.priceEgp,
        image: item.image,
        ...payload,
      });
      track('add_to_cart', {
        restaurantId: restaurant.id,
        itemId: item.id,
        priceEgp: item.priceEgp,
        qty,
      });
    }
    success();
    goBack();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ paddingBottom: 140 + insets.bottom }}>
        <View style={styles.hero}>
          <Image source={{ uri: item.image }} style={{ width: '100%', height: '100%' }} />
          <View style={[styles.navWrap, { top: insets.top + 6 }]}>
            <BackButton tint="light" onPress={goBack} />
          </View>
        </View>
        <View style={styles.body}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.desc}>{item.description}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.price}>{formatEgp(item.priceEgp)}</Text>
            {item.flags.map((f) => (
              <FlagBadge key={f} flag={f} />
            ))}
          </View>

          {item.modifiers.map((m) => (
            <ModifierGroup
              key={m.id}
              modifier={m}
              selected={sel[m.id] ?? new Set()}
              onToggle={(optionId) => toggleOption(m.id, optionId, m.maxSelect)}
            />
          ))}

          <View style={styles.allergyWrap}>
            <Pressable
              onPress={() => {
                tap();
                setAllergyOpen((o) => !o);
              }}
              style={styles.allergySummary}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modTitle}>{t('item.allergiesTitle')}</Text>
                <Text style={styles.allergySummaryText}>
                  {allergies.length === 0
                    ? t('allergy.summaryNone')
                    : allergies.map((a) => t(`allergy.${a}`)).join(' · ')}
                </Text>
              </View>
              <Text style={[styles.chev, allergyOpen && { transform: [{ rotate: '90deg' }] }]}>
                ›
              </Text>
            </Pressable>
            {allergyOpen && (
              <View style={{ marginTop: 12 }}>
                <Text style={styles.allergySub}>{t('item.allergiesSubtitle')}</Text>
                <View style={{ marginTop: 10 }}>
                  <AllergyChipRow
                    selected={allergies}
                    onChange={setAllergies}
                    conflictWith={conflicts}
                  />
                </View>
                <Pressable
                  onPress={() => {
                    tap();
                    router.push('/settings/allergies');
                  }}
                  hitSlop={8}
                  style={{ marginTop: 10 }}>
                  <Text style={styles.editLink}>{t('item.editAllergiesInSettings')} →</Text>
                </Pressable>
              </View>
            )}
            {hasConflict && (
              <View style={styles.conflictBox}>
                <Text style={styles.conflictTitle}>
                  {t('allergy.conflictWarning', {
                    allergens: conflicts.map((c) => t(`allergy.${c}`)).join(', '),
                  })}
                </Text>
                {!bypassConflict && (
                  <Pressable onPress={() => setBypassConflict(true)} hitSlop={6}>
                    <Text style={styles.bypassLink}>{t('item.addAnyway')} →</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>

          <View style={styles.notesWrap}>
            <Text style={styles.modTitle}>{t('item.specialInstructions')}</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder={t('item.notesPlaceholder')}
              placeholderTextColor={colors.ink3}
              multiline
              style={styles.notes}
            />
          </View>

          <View style={styles.qtyRow}>
            <Text style={styles.qtyLabel}>{t('item.quantity')}</Text>
            <QuantityStepper value={qty} onChange={setQty} min={1} max={20} />
          </View>
        </View>
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: 24 + insets.bottom }]}>
        <PrimaryButton
          label={
            isEditing
              ? t('item.updateLine', { amount: formatEgp(linePrice) })
              : t('item.addToCart', { amount: formatEgp(linePrice) })
          }
          onPress={onSubmit}
          disabled={!requiredOk || blocked}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, backgroundColor: colors.bg },
  hero: { height: 280, backgroundColor: '#222', position: 'relative' },
  navWrap: { position: 'absolute', left: 14, zIndex: 5 },
  body: { padding: 20 },
  name: { fontSize: 28, fontWeight: font.weights.extrabold, color: colors.ink, letterSpacing: -0.5 },
  desc: { fontSize: font.sizes.lg, color: colors.ink2, lineHeight: 22, marginTop: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  price: { fontSize: font.sizes['3xl'], fontWeight: font.weights.extrabold, color: colors.ink },
  modGroup: { marginTop: 22 },
  modHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  modTitle: { fontSize: font.sizes['2xl'], fontWeight: font.weights.bold, color: colors.ink },
  modReq: { fontSize: font.sizes.md, color: colors.ink2 },
  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.white },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  checkMark: { color: colors.white, fontSize: 14, lineHeight: 14, fontWeight: '900' as const },
  optLabel: { flex: 1, fontSize: font.sizes.xl, color: colors.ink },
  optPrice: { fontSize: font.sizes.lg, color: colors.ink2, fontWeight: font.weights.bold },
  notesWrap: { marginTop: 22 },
  notes: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
    fontSize: font.sizes.lg,
    color: colors.ink,
    backgroundColor: colors.white,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  qtyRow: {
    marginTop: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  qtyLabel: { fontSize: font.sizes['2xl'], fontWeight: font.weights.bold, color: colors.ink },
  allergyWrap: { marginTop: 22 },
  allergySummary: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    gap: 12,
  },
  allergySummaryText: {
    fontSize: font.sizes.md,
    color: colors.ink2,
    marginTop: 3,
  },
  chev: {
    fontSize: 22,
    color: colors.ink3,
    fontWeight: '600' as const,
  },
  allergyHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  allergySub: {
    fontSize: font.sizes.md,
    color: colors.ink2,
    marginTop: 4,
    lineHeight: 18,
  },
  editLink: {
    fontSize: font.sizes.md,
    color: colors.sea,
    fontWeight: font.weights.bold,
  },
  conflictBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.redSoft,
    borderWidth: 1,
    borderColor: colors.red,
  },
  conflictTitle: {
    fontSize: font.sizes.lg,
    color: colors.red,
    fontWeight: font.weights.bold,
  },
  bypassLink: {
    marginTop: 6,
    fontSize: font.sizes.md,
    color: colors.red,
    fontWeight: font.weights.bold,
    textDecorationLine: 'underline',
  },
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
