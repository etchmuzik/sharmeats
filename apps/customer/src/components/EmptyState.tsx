import { Text, View } from 'react-native';
import { Mascot } from './Mascot/Mascot';
import type { MascotPose } from './Mascot/poses';
import { PressableScale } from './PressableScale';
import { font, radius, spacing } from '../theme';
import { makeStyles } from '../themeProvider';

export interface EmptyStateProps {
  pose?: MascotPose;
  title: string;
  body?: string;
  cta?: { label: string; onPress: () => void };
}

export function EmptyState({ pose = 'shrug', title, body, cta }: EmptyStateProps) {
  const styles = useStyles();
  return (
    <View style={styles.wrap}>
      <Mascot pose={pose} size={128} />
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {cta ? (
        <PressableScale haptic="press" onPress={cta.onPress} style={styles.cta}>
          <Text style={styles.ctaLabel}>{cta.label}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxxl, gap: spacing.md },
  title: { fontSize: font.sizes['4xl'], fontWeight: font.weights.extrabold, color: colors.ink, textAlign: 'center', marginTop: spacing.sm },
  body: { fontSize: font.sizes.xl, color: colors.ink2, textAlign: 'center', lineHeight: 20 },
  cta: { marginTop: spacing.md, backgroundColor: colors.accent, paddingVertical: 14, paddingHorizontal: 28, borderRadius: radius.pill },
  ctaLabel: { color: colors.onAccent, fontWeight: font.weights.bold, fontSize: font.sizes.xl },
}));
