import { Text, View } from 'react-native';
import { font, radius } from '../theme';
import { makeStyles, useThemeColors } from '../themeProvider';
import { formatEgp } from '../lib/format';
import { useDirection } from '../lib/direction';
import { useT } from '../i18n';
import type { Modifier } from '../data/types';
import { PressableScale } from './PressableScale';

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
  const s = useSStyles();
  const t = useT();
  const dir = useDirection();
  const style = m.style ?? 'list';
  return (
    <View style={s.group}>
      <View style={[s.head, dir.row]}>
        <Text style={[s.title, dir.text]}>{m.name}</Text>
        <Text style={[s.req, dir.text]}>
          {m.required ? t('modifier.required') : t('modifier.optional')}
          {m.maxSelect > 1 && style !== 'ingredients' ? ` · ${t('modifier.upTo', { count: m.maxSelect })}` : ''}
        </Text>
      </View>
      {m.subtitle ? <Text style={[s.sub, dir.text]}>{m.subtitle}</Text> : null}

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
  const s = useSStyles();
  const t = useT();
  const dir = useDirection();
  const single = m.maxSelect === 1;
  return (
    <View style={[s.sizeRow, dir.row]}>
      {m.options.map((o) => {
        const on = selected.has(o.id);
        return (
          <PressableScale
            key={o.id}
            haptic="selection"
            onPress={() => onToggle(o.id)}
            accessibilityRole={single ? 'radio' : 'checkbox'}
            accessibilityState={single ? { selected: on } : { checked: on }}
            accessibilityLabel={`${m.name}: ${o.name}`}
            accessibilityHint={on ? t('modifier.remove') : t('modifier.add')}
            style={[s.sizePill, on && s.sizePillOn]}>
            <Text style={[s.sizeName, on && s.sizeNameOn, dir.text]}>{o.name}</Text>
            {o.subtitle ? <Text style={[s.sizeSub, on && s.sizeSubOn, dir.text]}>{o.subtitle}</Text> : null}
            {o.priceDeltaEgp !== 0 && (
              <Text style={[s.sizeDelta, on && s.sizeSubOn, dir.text]}>
                {o.priceDeltaEgp > 0 ? '+' : ''}
                {formatEgp(o.priceDeltaEgp)}
              </Text>
            )}
          </PressableScale>
        );
      })}
    </View>
  );
}

function IngredientChips({ m, selected, onToggle }: { m: Modifier; selected: Set<string>; onToggle: (id: string) => void }) {
  const s = useSStyles();
  const t = useT();
  return (
    <View style={s.chipWrap}>
      {m.options.map((o) => {
        const included = selected.has(o.id);
        return (
          <PressableScale
            key={o.id}
            haptic="selection"
            onPress={() => onToggle(o.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: included }}
            accessibilityLabel={`${m.name}: ${included ? o.name : `${t('modifier.no')} ${o.name}`}`}
            accessibilityHint={included ? t('modifier.remove') : t('modifier.add')}
            style={[s.chip, included ? s.chipOn : s.chipOff]}>
            <Text style={[s.chipText, !included && s.chipTextOff]}>
              {included ? '' : `${t('modifier.no')} `}
              {o.name}
            </Text>
            <Text style={[s.chipX, included ? s.chipXOn : s.chipXOff]}>{included ? '×' : '+'}</Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

function AddonCards({ m, selected, onToggle }: { m: Modifier; selected: Set<string>; onToggle: (id: string) => void }) {
  const s = useSStyles();
  const t = useT();
  const dir = useDirection();
  return (
    <View style={s.cardWrap}>
      {m.options.map((o) => {
        const on = selected.has(o.id);
        return (
          <PressableScale
            key={o.id}
            haptic="selection"
            onPress={() => onToggle(o.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${m.name}: ${o.name}`}
            accessibilityHint={on ? t('modifier.remove') : t('modifier.add')}
            style={[s.card, dir.row, on && s.cardOn]}>
            {o.icon ? <Text style={s.cardIcon}>{o.icon}</Text> : null}
            <View style={{ flex: 1 }}>
              <View style={[s.cardNameRow, dir.row]}>
                <Text style={[s.cardName, dir.text]} numberOfLines={1}>
                  {o.name}
                </Text>
                {o.popular ? (
                  <View style={s.popular}>
                    <Text style={s.popularText}>★ {t('modifier.popular')}</Text>
                  </View>
                ) : null}
              </View>
              {o.subtitle ? <Text style={[s.cardSub, dir.text]}>{o.subtitle}</Text> : null}
              {o.priceDeltaEgp !== 0 ? (
                <Text style={[s.cardPrice, dir.text]}>
                  {o.priceDeltaEgp > 0 ? '+' : ''}
                  {formatEgp(o.priceDeltaEgp)}
                </Text>
              ) : (
                <Text style={[s.cardFree, dir.text]}>{t('modifier.free')}</Text>
              )}
            </View>
            <View style={[s.cardCheck, on && s.cardCheckOn]}>
              {on ? <Text style={s.cardCheckMark}>✓</Text> : null}
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}

function ListRows({ m, selected, onToggle }: { m: Modifier; selected: Set<string>; onToggle: (id: string) => void }) {
  const colors = useThemeColors();
  const s = useSStyles();
  const t = useT();
  const dir = useDirection();
  const single = m.maxSelect === 1;
  return (
    <View>
      {m.options.map((o) => {
        const on = selected.has(o.id);
        return (
          <PressableScale
            key={o.id}
            haptic="selection"
            onPress={() => onToggle(o.id)}
            accessibilityRole={single ? 'radio' : 'checkbox'}
            accessibilityState={single ? { selected: on } : { checked: on }}
            accessibilityLabel={`${m.name}: ${o.name}`}
            accessibilityHint={on ? t('modifier.remove') : t('modifier.add')}
            style={[s.row, dir.row]}>
            <View style={[single ? s.radio : s.check, on && { backgroundColor: colors.accent, borderColor: colors.accent }]}>
              {on && (single ? <View style={s.radioDot} /> : <Text style={s.checkMark}>✓</Text>)}
            </View>
            <Text style={[s.rowLabel, dir.text]}>{o.name}</Text>
            {o.priceDeltaEgp !== 0 && (
              <Text style={[s.rowPrice, dir.text]}>
                {o.priceDeltaEgp > 0 ? '+' : ''}
                {formatEgp(o.priceDeltaEgp)}
              </Text>
            )}
          </PressableScale>
        );
      })}
    </View>
  );
}

const useSStyles = makeStyles((colors) => ({
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
    backgroundColor: colors.surface,
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
    backgroundColor: colors.surface,
  },
  cardOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  cardIcon: { fontSize: 26 },
  cardNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardName: { fontSize: font.sizes.lg, fontWeight: font.weights.semibold, color: colors.ink },
  cardSub: { fontSize: font.sizes.sm, color: colors.green, fontWeight: font.weights.semibold, marginTop: 1 },
  cardPrice: { fontSize: font.sizes.md, color: colors.ink2, fontWeight: font.weights.bold, marginTop: 2 },
  cardFree: { fontSize: font.sizes.md, color: colors.ink3, marginTop: 2 },
  popular: { backgroundColor: colors.star, borderRadius: radius.sm, paddingHorizontal: 5, paddingVertical: 1 },
  popularText: { fontSize: font.sizes.xs, color: colors.onAccent, fontWeight: font.weights.bold },
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
  cardCheckMark: { color: colors.onAccent, fontSize: 13, fontWeight: '900' },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.onAccent },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  checkMark: { color: colors.onAccent, fontSize: 14, fontWeight: '900' },
  rowLabel: { flex: 1, fontSize: font.sizes.xl, color: colors.ink },
  rowPrice: { fontSize: font.sizes.lg, color: colors.ink2, fontWeight: font.weights.bold },
}));
