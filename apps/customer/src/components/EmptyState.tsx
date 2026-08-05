import { Text, View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { font, radius, spacing } from '../theme';
import { makeStyles } from '../themeProvider';

export interface EmptyStateProps {
  /** A quiet, contextual marker rather than a character illustration. */
  icon?: IconName;
  title: string;
  body?: string;
  cta?: { label: string; onPress: () => void };
}

export function EmptyState({ icon = 'search', title, body, cta }: EmptyStateProps) {
  const styles = useStyles();
  return (
    <View style={styles.wrap}>
      <View style={styles.visual} accessible={false}>
        <Icon name={icon} size={32} color={styles.visualIcon.color} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {cta ? (
        <PressableScale
          haptic="press"
          onPress={cta.onPress}
          accessibilityRole="button"
          accessibilityLabel={cta.label}
          style={styles.cta}>
          <Text style={styles.ctaLabel}>{cta.label}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxxl, gap: spacing.md },
  visual: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.seaSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visualIcon: { color: colors.sea },
  title: { fontSize: font.sizes['4xl'], fontWeight: font.weights.extrabold, color: colors.ink, textAlign: 'center', marginTop: spacing.sm },
  body: { fontSize: font.sizes.xl, color: colors.ink2, textAlign: 'center', lineHeight: 20 },
  cta: { marginTop: spacing.md, backgroundColor: colors.accent, paddingVertical: 14, paddingHorizontal: 28, borderRadius: radius.pill },
  ctaLabel: { color: colors.onAccent, fontWeight: font.weights.bold, fontSize: font.sizes.xl },
}));
