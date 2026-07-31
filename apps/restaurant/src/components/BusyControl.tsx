/**
 * Busy mode on the counter tablet — the client for migration 186.
 *
 * The server has shipped an honest, self-expiring prep bump since mig 186 and
 * nothing called it, so a slammed kitchen had exactly two options: quietly run
 * late against an ETA it could not meet, or close entirely. This control is the
 * missing middle.
 *
 * Shape, and why:
 *  · Presets, not a numeric field. This is pressed one-handed mid-rush; typing
 *    "25" into a text input during a Friday service does not happen.
 *  · The active state states the bump AND the minutes left, in text. Nobody has
 *    to remember to clear it — the RPC's busy_until expires on its own — but
 *    they must be able to see that it is still on.
 *  · Below manager, this renders as a read-only chip, matching the open/closed
 *    control: set_busy_mode raises MANAGER_REQUIRED, and a visible-but-dead
 *    button would tell a kitchen it had extended its prep time when it had not.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { font, radius, spacing } from '../theme';
import { useThemeColors } from '../themeProvider';
import { Icon } from './Icon';
import { selection, tapMedium } from '../lib/haptics';
import { useLocale } from '../locale';
import { BUSY_CLEAR, BUSY_DURATION_MINUTES, BUSY_PRESET_MINUTES } from '../busyMode';

const CONTROL_BASE = {
  // 48dp, as everywhere in this header: wet or gloved fingers.
  minHeight: 48,
  paddingHorizontal: spacing.md,
  borderRadius: radius.pill,
  alignItems: 'center',
  justifyContent: 'center',
} as const;

type Props = {
  active: boolean;
  extraMinutes: number;
  minutesRemaining: number;
  /** A set/clear call is in flight. */
  pending: boolean;
  mayEdit: boolean;
  compact: boolean;
  /** `0` clears busy mode. */
  onSet: (extraMinutes: number) => void;
};

export function BusyControl({
  active,
  extraMinutes,
  minutesRemaining,
  pending,
  mayEdit,
  compact,
  onSet,
}: Props) {
  const colors = useThemeColors();
  const { t } = useLocale();
  const [open, setOpen] = useState(false);

  const label = active
    ? t('busy.active', { extra: extraMinutes, remaining: minutesRemaining })
    : t('busy.normal');
  const tone = active ? colors.amberSoft : colors.bgSoft;
  const toneText = active ? colors.amberText : colors.accentText;

  if (!mayEdit) {
    return (
      <View
        accessibilityRole="text"
        accessibilityLabel={active ? t('busy.activeA11y', { extra: extraMinutes, remaining: minutesRemaining }) : t('busy.restricted')}
        style={[
          CONTROL_BASE,
          { flexDirection: 'row', gap: 5, backgroundColor: tone },
          compact && { flexGrow: 1, flexBasis: '46%' },
        ]}
      >
        <Icon name="clock" size={14} color={toneText} />
        <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: toneText }}>{label}</Text>
      </View>
    );
  }

  return (
    <>
      <Pressable
        onPress={() => {
          selection();
          setOpen((prev) => !prev);
        }}
        disabled={pending}
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled: pending, busy: pending }}
        accessibilityLabel={
          active
            ? t('busy.activeA11y', { extra: extraMinutes, remaining: minutesRemaining })
            : t('busy.normalA11y')
        }
        style={[
          CONTROL_BASE,
          { flexDirection: 'row', gap: 5, backgroundColor: tone },
          compact && { flexGrow: 1, flexBasis: '46%' },
        ]}
      >
        {pending ? (
          <ActivityIndicator color={toneText} />
        ) : (
          <>
            <Icon name="clock" size={14} color={toneText} />
            <Text style={{ fontSize: font.sizes.sm, fontWeight: '700', color: toneText }}>
              {label}
            </Text>
          </>
        )}
      </Pressable>

      {open && (
        <View
          style={{
            width: '100%',
            gap: spacing.sm,
            paddingVertical: spacing.sm,
          }}
        >
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {BUSY_PRESET_MINUTES.map((minutes) => (
              <Pressable
                key={minutes}
                onPress={() => {
                  tapMedium();
                  setOpen(false);
                  onSet(minutes);
                }}
                disabled={pending}
                accessibilityRole="button"
                accessibilityState={{ selected: active && extraMinutes === minutes }}
                accessibilityLabel={t('busy.presetA11y', {
                  minutes,
                  duration: BUSY_DURATION_MINUTES,
                })}
                style={[
                  CONTROL_BASE,
                  {
                    flexGrow: 1,
                    flexBasis: '28%',
                    borderWidth: 1,
                    borderColor:
                      active && extraMinutes === minutes ? colors.amber : colors.line,
                    backgroundColor:
                      active && extraMinutes === minutes ? colors.amberSoft : colors.surface,
                  },
                ]}
              >
                <Text style={{ fontSize: font.sizes.sm, fontWeight: '800', color: colors.ink }}>
                  {t('busy.preset', { minutes })}
                </Text>
              </Pressable>
            ))}
            {active && (
              <Pressable
                onPress={() => {
                  tapMedium();
                  setOpen(false);
                  onSet(BUSY_CLEAR);
                }}
                disabled={pending}
                accessibilityRole="button"
                accessibilityLabel={t('busy.clearA11y')}
                style={[
                  CONTROL_BASE,
                  {
                    flexGrow: 1,
                    flexBasis: '46%',
                    borderWidth: 1,
                    borderColor: colors.green,
                    backgroundColor: colors.greenSoft,
                  },
                ]}
              >
                <Text style={{ fontSize: font.sizes.sm, fontWeight: '800', color: colors.greenText }}>
                  {t('busy.clear')}
                </Text>
              </Pressable>
            )}
          </View>
          <Text style={{ fontSize: font.sizes.xs, color: colors.ink2 }}>
            {t('busy.explain', { duration: BUSY_DURATION_MINUTES })}
          </Text>
        </View>
      )}
    </>
  );
}
