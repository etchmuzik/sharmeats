/**
 * Runtime theming for the restaurant app.
 *
 * WHY THIS EXISTS AT ALL: `StyleSheet.create({ color: colors.ink })` — which
 * home.tsx, tier.tsx and Toast.tsx all use — evaluates ONCE, when the module is
 * first imported. The literal is copied into the style object and
 * nothing can change it afterwards — mutating the palette later does not
 * retroactively update styles that already read it. So dark mode cannot be a
 * palette swap; styles have to be a function of the active theme. That is what
 * `makeStyles` provides, and inline styles get the palette from
 * `useThemeColors()`.
 *
 * Usage:
 *
 *   const useStyles = makeStyles((colors) => ({
 *     card: { backgroundColor: colors.surface },
 *   }));
 *
 *   export function Card() {
 *     const colors = useThemeColors();   // inline / prop colors
 *     const styles = useStyles();        // StyleSheet colors
 *   }
 *
 * These are hooks, so every component in a file needs its own calls — they
 * cannot be hoisted to module scope.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  StyleSheet,
  useColorScheme,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import {
  darkColors,
  lightColors,
  resolveScheme,
  type ColorScheme,
  type Palette,
  type ThemeMode,
} from './theme';

export type { ColorScheme, ThemeMode };
export { resolveScheme };

const THEME_MODE_STORAGE_KEY = '@sharmeats/restaurant/theme-mode';

/** Order the header control cycles through. */
const MODE_CYCLE: ThemeMode[] = ['system', 'light', 'dark'];

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

interface ThemeValue {
  colors: Palette;
  /** The scheme actually being rendered, after resolving `system`. */
  scheme: ColorScheme;
  /** What staff picked, which may be `system`. */
  mode: ThemeMode;
  setMode: (next: ThemeMode) => void;
  /** Advance system → light → dark → system. */
  cycleMode: () => void;
}

/**
 * Defaulting to light matters: a component rendered outside the provider (a
 * test, or a screen mounted above it) gets the original look rather than
 * throwing or flashing an unstyled tree.
 */
const ThemeContext = createContext<ThemeValue>({
  colors: lightColors,
  scheme: 'light',
  mode: 'system',
  setMode: () => {},
  cycleMode: () => {},
});

/**
 * NOTE on the System option: `useColorScheme()` only ever reports 'dark' when
 * app.json sets `userInterfaceStyle: "automatic"`. With "light" the OS pins
 * every query to light and System silently does nothing — which is why this
 * change also flips that flag (and therefore needs a native build, not OTA).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  // Starts at 'system' rather than blocking the tree on a disk read. A tablet
  // that has never had the control touched shows the correct theme immediately;
  // only a device with an explicit override can catch a brief first frame in
  // the system theme before the stored value lands.
  const [mode, setModeState] = useState<ThemeMode>('system');
  const system = useColorScheme();

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(THEME_MODE_STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && isThemeMode(stored)) setModeState(stored);
      })
      // A preference we cannot read is not worth surfacing mid-service — the
      // tablet keeps the system theme and staff can re-pick from the header.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    // Fire-and-forget: the UI has already changed, and a failed write only
    // costs the preference on next launch.
    AsyncStorage.setItem(THEME_MODE_STORAGE_KEY, next).catch(() => {});
  }, []);

  const cycleMode = useCallback(() => {
    setModeState((current) => {
      const next = MODE_CYCLE[(MODE_CYCLE.indexOf(current) + 1) % MODE_CYCLE.length];
      AsyncStorage.setItem(THEME_MODE_STORAGE_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const scheme = resolveScheme(mode, system);

  const value = useMemo<ThemeValue>(
    () => ({
      colors: scheme === 'dark' ? darkColors : lightColors,
      scheme,
      mode,
      setMode,
      cycleMode,
    }),
    [scheme, mode, setMode, cycleMode],
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

/** The picked mode plus its setters, for the kitchen header control. */
export function useThemeMode(): Pick<ThemeValue, 'mode' | 'setMode' | 'cycleMode'> {
  const { mode, setMode, cycleMode } = useContext(ThemeContext);
  return { mode, setMode, cycleMode };
}

type NamedStyles = Record<string, ViewStyle | TextStyle | ImageStyle>;

/**
 * Turn a palette-consuming style factory into a hook.
 *
 * Memoised per palette, so switching themes rebuilds the sheet once rather than
 * on every render, and staying on one theme allocates nothing after the first.
 */
export function makeStyles<T extends NamedStyles>(factory: (colors: Palette) => T): () => T {
  return function useStyles(): T {
    const colors = useThemeColors();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

/**
 * Status bar that follows the theme. Replaces the hardcoded
 * `<StatusBar style="dark" />`: on a dark canvas, dark status-bar glyphs are
 * unreadable.
 */
export function ThemedStatusBar() {
  const scheme = useThemeScheme();
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />;
}
