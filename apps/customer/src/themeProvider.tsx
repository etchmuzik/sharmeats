/**
 * Runtime theming for the customer app.
 *
 * WHY THIS EXISTS AT ALL: `StyleSheet.create({ color: colors.ink })` at module
 * scope evaluates ONCE, when the module is first imported. The literal is
 * copied into the style object and nothing can change it afterwards — mutating
 * the palette later does not retroactively update styles that already read it.
 * So dark mode cannot be a palette swap; the styles themselves have to be a
 * function of the active theme. That is what `makeStyles` provides.
 *
 * Usage in a screen or component:
 *
 *   const useStyles = makeStyles((colors) => ({
 *     card: { backgroundColor: colors.surface },
 *   }));
 *
 *   export function Card() {
 *     const colors = useThemeColors();   // for inline / prop colors
 *     const styles = useStyles();        // for StyleSheet colors
 *     ...
 *   }
 *
 * Every component in a file that touches `styles` or `colors` needs its own
 * hook calls — they are hooks, so they cannot be hoisted to module scope.
 */
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import {
  StyleSheet,
  useColorScheme,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { darkColors, lightColors, type Palette, type ThemeMode } from './theme';
import { useSession } from './store/session';

export type ColorScheme = 'light' | 'dark';
export type { ThemeMode };

interface ThemeValue {
  colors: Palette;
  /** The scheme actually being rendered, after resolving `system`. */
  scheme: ColorScheme;
}

/**
 * Defaulting to light matters: a component rendered outside the provider (a
 * test, or a screen mounted above it) gets the old v2 look rather than throwing
 * or flashing an unstyled tree.
 */
const ThemeContext = createContext<ThemeValue>({
  colors: lightColors,
  scheme: 'light',
});

/**
 * Resolve the mode the user chose against what the OS reports.
 *
 * `useColorScheme()` returns null while the OS value is unknown; treating that
 * as light avoids a dark flash on a light device during the first frame.
 *
 * NOTE: this only ever reports 'dark' when app.json sets
 * `userInterfaceStyle: "automatic"`. With "light" the OS pins every query to
 * light and the System option silently does nothing.
 */
export function resolveScheme(mode: ThemeMode, system: ColorScheme | null | undefined): ColorScheme {
  if (mode === 'light' || mode === 'dark') return mode;
  return system === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const mode = useSession((s) => s.themeMode);
  const system = useColorScheme();
  const scheme = resolveScheme(mode, system);

  const value = useMemo<ThemeValue>(
    () => ({ colors: scheme === 'dark' ? darkColors : lightColors, scheme }),
    [scheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The active palette. Use for inline styles and color props. */
export function useThemeColors(): Palette {
  return useContext(ThemeContext).colors;
}

/** The active scheme — for the rare branch that needs to know (maps, status bar). */
export function useThemeScheme(): ColorScheme {
  return useContext(ThemeContext).scheme;
}

type NamedStyles = Record<string, ViewStyle | TextStyle | ImageStyle>;

/**
 * Turn a palette-consuming style factory into a hook.
 *
 * The result is memoised per scheme, so switching themes rebuilds the sheet
 * once rather than on every render, and staying on one theme allocates nothing
 * after the first render.
 */
export function makeStyles<T extends NamedStyles>(factory: (colors: Palette) => T): () => T {
  return function useStyles(): T {
    const colors = useThemeColors();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

/**
 * Status bar that follows the theme. Replaces the hardcoded
 * `<StatusBar style="dark" />` that every screen used to carry: on a dark
 * canvas, dark status-bar glyphs are unreadable.
 */
export function ThemedStatusBar() {
  const scheme = useThemeScheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}
