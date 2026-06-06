import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius } from '../theme';
import { formatEgp } from '../lib/format';
import type { Modifier } from '../data/types';

interface Props {
  modifier: Modifier;
  selected: Set<string>;
  onToggle: (optionId: string) => void;
}

/**
 * Renders one modifier group using the right UI for its `style`:
 *  - 'size'        segmented pill row
 *  - 'ingredients' included chips you tap to remove (cross out -> "No X")
 *  - 'addons'      visual cards with icon + price
 *  - 'list'/'builder'  classic radio/checkbox rows
 */
export function ModifierGroup({ modifier: m, selected, onToggle }: Props) {
  const style = m.style ?? 'list';
  return (
    <View style={s.group}>
      <View style={s.head}>
        <Text style={s.title}>{m.name}</Text>
        <Text style={s.req}>
          {m.required ? 'Required' : 'Optional'}
          {m.maxSelect > 1 && style !== 'ingredients' ? ` · up to ${m.maxSelect}` : ''}
        </Text>
      </View>
      {m.subtitle ? <Text style={s.sub}>{m.subtitle}</Text> : null}

      {style === 'size' && <SizeRow m={m} selected={selected} onToggle={onToggle} />}
      {style === 'ingredients' && <IngredientChips m={m} selected={selected} onToggle={onToggle} />}
      {style === 'addons' && <AddonCards m={m} selected={selected} onToggle={onToggle} />}
      {(style === 'list' || style === 'builder') && (
        <ListRows m={m} selected={selected} onToggle={onToggle} />
      )}
    </View>
  );
}

function SizeRow({ m, selected, onToggle }: { m: Modifier; selected: Set<string>; onToggle: (id: string) => void }) {
  return (
    <View style={s.sizeRow}>
      {m.options.map((o) => {
        const on = selected.has(o.id);
        return (
          <Pressable key={o.id} onPress={() => onToggle(o.id)} style={[s.sizePill, on && s.sizePillOn]}>
            <Text style={[s.sizeName, on && s.sizeNameOn]}>{o.name}</Text>
            {o.subtitle ? <Text style={[s.sizeSub, on && s.sizeSubOn]}>{o.subtitle}</Text> : null}
            {o.priceDeltaEgp !== 0 && (
              <Text style={[s.sizeDelta, on && s.sizeSubOn]}>
                {o.priceDeltaEgp > 0 ? '+' : ''}
                {formatEgp(o.priceDeltaEgp)}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function IngredientChips({ m, selected, onToggle }: { m: Modifier; selected: Set<string>; onToggle: (id: string) => void }) {
  return (
    <View style={s.chipWrap}>
      {m.options.map((o) => {
        const included = selected.has(o.id);
        return (
          <Pressable key={o.id} onPress={() => onToggle(o.id)} style={[s.chip, included ? s.chipOn : s.chipOff]}>
            <Text style={[s.chipText, !included && s.chipTextOff]}>
              {included ? '' : 'No '}
              {o.name}
            </Text>
            <Text style={[s.chipX, included ? s.chipXOn : s.chipXOff]}>{included ? '×' : '+'}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function AddonCards({ m, selected, onToggle }: { m: Modifier; selected: Set<string>; onToggle: (id: string) => void }) {
  return (
    <View style={s.cardWrap}>
      {m.options.map((o) => {
        const on = selected.has(o.id);
        return (
          <Pressable key={o.id} onPress={() => onToggle(o.id)} style={[s.card, on && s.cardOn]}>
            {o.icon ? <Text style={s.cardIcon}>{o.icon}</Text> : null}
            <View style={{ flex: 1 }}>
              <View style={s.cardNameRow}>
                <Text style={s.cardName} numberOfLines={1}>
                  {o.name}
                </Text>
                {o.popular ? (
                  <View style={s.popular}>
                    <Text style={s.popularText}>★ Popular</Text>
                  </View>
                ) : null}
              </View>
              {o.subtitle ? <Text style={s.cardSub}>{o.subtitle}</Text> : null}
              {o.priceDeltaEgp !== 0 ? (
                <Text style={s.cardPrice}>
                  {o.priceDeltaEgp > 0 ? '+' : ''}
                  {formatEgp(o.priceDeltaEgp)}
                </Text>
              ) : (
                <Text style={s.cardFree}>Free</Text>
              )}
            </View>
            <View style={[s.cardCheck, on && s.cardCheckOn]}>
              {on ? <Text style={s.cardCheckMark}>✓</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function ListRows({ m, selected, onToggle }: { m: Modifier; selected: Set<string>; onToggle: (id: string) => void }) {
  const single = m.maxSelect === 1;
  return (
    <View>
      {m.options.map((o) => {
        const on = selected.has(o.id);
        return (
          <Pressable key={o.id} onPress={() => onToggle(o.id)} style={s.row}>
            <View style={[single ? s.radio : s.check, on && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
              {on && (single ? <View style={s.radioDot} /> : <Text style={s.checkMark}>✓</Text>)}
            </View>
            <Text style={s.rowLabel}>{o.name}</Text>
            {o.priceDeltaEgp !== 0 && (
              <Text style={s.rowPrice}>
                {o.priceDeltaEgp > 0 ? '+' : ''}
                {formatEgp(o.priceDeltaEgp)}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  group: { marginTop: 24 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { fontSize: font.sizes['2xl'], fontWeight: font.weights.bold, color: colors.ink },
  req: { fontSize: font.sizes.md, color: colors.ink3 },
  sub: { fontSize: font.sizes.md, color: colors.ink2, marginTop: 2, marginBottom: 4 },

  sizeRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  sizePill: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.white,
    alignItems: 'center',
  },
  sizePillOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  sizeName: { fontSize: font.sizes.lg, fontWeight: font.weights.bold, color: colors.ink },
  sizeNameOn: { color: colors.accentDark },
  sizeSub: { fontSize: font.sizes.xs, color: colors.ink3, marginTop: 2 },
  sizeSubOn: { color: colors.accentDark },
  sizeDelta: { fontSize: font.sizes.sm, color: colors.ink2, marginTop: 3, fontWeight: font.weights.semibold },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  chipOn: { backgroundColor: colors.greenSoft, borderColor: colors.green },
  chipOff: { backgroundColor: colors.bgSoft, borderColor: colors.line },
  chipText: { fontSize: font.sizes.base, color: colors.ink, fontWeight: font.weights.medium },
  chipTextOff: { color: colors.ink3, textDecorationLine: 'line-through' },
  chipX: { fontSize: font.sizes.lg, fontWeight: font.weights.bold },
  chipXOn: { color: colors.green },
  chipXOff: { color: colors.ink3 },

  cardWrap: { gap: 8, marginTop: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  cardOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  cardIcon: { fontSize: 26 },
  cardNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardName: { fontSize: font.sizes.lg, fontWeight: font.weights.semibold, color: colors.ink },
  cardSub: { fontSize: font.sizes.sm, color: colors.green, fontWeight: font.weights.semibold, marginTop: 1 },
  cardPrice: { fontSize: font.sizes.md, color: colors.ink2, fontWeight: font.weights.bold, marginTop: 2 },
  cardFree: { fontSize: font.sizes.md, color: colors.ink3, marginTop: 2 },
  popular: { backgroundColor: colors.star, borderRadius: radius.sm, paddingHorizontal: 5, paddingVertical: 1 },
  popularText: { fontSize: 9, color: colors.white, fontWeight: font.weights.bold },
  cardCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardCheckOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  cardCheckMark: { color: colors.white, fontSize: 13, fontWeight: '900' },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.white },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  checkMark: { color: colors.white, fontSize: 14, fontWeight: '900' },
  rowLabel: { flex: 1, fontSize: font.sizes.xl, color: colors.ink },
  rowPrice: { fontSize: font.sizes.lg, color: colors.ink2, fontWeight: font.weights.bold },
});
