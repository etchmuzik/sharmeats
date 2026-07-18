import { useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  NativeSyntheticEvent,
  NativeScrollEvent,
  ImageSourcePropType,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { Mascot } from '../src/components/Mascot/Mascot';
import { colors, font } from '../src/theme';
import { useT, LOCALE_LABELS, ALL_LOCALES } from '../src/i18n';
import { useSession, type Locale } from '../src/store/session';
import { useDirection } from '../src/lib/direction';
import { selection } from '../src/haptics';

const { width } = Dimensions.get('window');

type Slide = {
  kind: 'mascot' | 'image';
  pose?: 'wave' | 'cheer';
  img?: ImageSourcePropType;
  titleKey: string;
  accentKey: string;
  descKey: string;
};

const SLIDES: Slide[] = [
  {
    kind: 'mascot',
    pose: 'wave',
    titleKey: 'onboarding.title1',
    accentKey: 'onboarding.accent1',
    descKey: 'onboarding.desc1',
  },
  {
    kind: 'mascot',
    pose: 'cheer',
    titleKey: 'onboarding.codTitle',
    accentKey: 'onboarding.codAccent',
    descKey: 'onboarding.codDesc',
  },
  {
    kind: 'image',
    // Bundled locally (was a runtime Unsplash URL) so the first-run screen
    // renders offline / on flaky hotel wifi.
    img: require('../assets/onboarding-dine.jpg'),
    titleKey: 'onboarding.title3',
    accentKey: 'onboarding.accent3',
    descKey: 'onboarding.desc3',
  },
];

export default function Onboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const dir = useDirection();
  const locale = useSession((s) => s.locale);
  const setLocale = useSession((s) => s.setLocale);
  const signIn = useSession((s) => s.signIn);
  const [index, setIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) {
      selection();
      setIndex(i);
    }
  };

  // Zero-friction guest entry: the app already holds an anonymous Supabase
  // session (see _layout ensureSession), so a guest can browse + order right
  // away. "Sign in" stays available for saving addresses/history across devices.
  const startAsGuest = () => {
    signIn('guest');
    router.replace('/(tabs)/home');
  };

  const next = (i: number) => {
    if (i >= SLIDES.length - 1) {
      startAsGuest();
      return;
    }
    scrollRef.current?.scrollTo({ x: (i + 1) * width, animated: true });
    setIndex(i + 1);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}>
        {SLIDES.map((s, i) => (
          <View key={i} style={{ width, flex: 1 }}>
            <View style={styles.imageWrap}>
              {s.kind === 'mascot' ? (
                <View style={styles.mascotWrap}>
                  <Mascot pose={s.pose} size={220} />
                </View>
              ) : (
                <Image source={s.img} style={styles.image} />
              )}
              <LinearGradient
                colors={['transparent', 'transparent', colors.bg]}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              {i < SLIDES.length - 1 && (
                <Pressable
                  onPress={startAsGuest}
                  style={[
                    styles.skip,
                    { top: insets.top + 16 },
                    // Pinned corners swap in RTL so "skip" sits at the trailing edge.
                    dir.isRtl ? { left: 20 } : { right: 20 },
                  ]}>
                  <Text style={styles.skipText}>{t('common.skip')}</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => setPickerOpen((o) => !o)}
                style={[
                  styles.langBtn,
                  { top: insets.top + 16 },
                  dir.isRtl ? { right: 20 } : { left: 20 },
                ]}>
                <Text style={styles.langText}>🌐 {LOCALE_LABELS[locale]}</Text>
              </Pressable>
              {pickerOpen && (
                <View
                  style={[
                    styles.langSheet,
                    { top: insets.top + 56 },
                    dir.isRtl ? { right: 20 } : { left: 20 },
                  ]}>
                  {ALL_LOCALES.map((l) => (
                    <Pressable
                      key={l}
                      onPress={() => {
                        setLocale(l as Locale);
                        setPickerOpen(false);
                      }}
                      style={[styles.langOpt, l === locale && styles.langOptActive]}>
                      <Text style={[styles.langOptText, l === locale && { color: colors.accent }]}>
                        {LOCALE_LABELS[l]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
            <View style={styles.body}>
              <Text style={[styles.title, dir.text]}>
                {t(s.titleKey)}
                <Text style={{ color: colors.accent }}>{t(s.accentKey)}</Text>
              </Text>
              <Text style={[styles.desc, dir.text]}>{t(s.descKey)}</Text>
              <View style={{ marginTop: 'auto' }}>
                <View style={styles.dots}>
                  {SLIDES.map((_, j) => (
                    <View
                      key={j}
                      style={[styles.dot, j === index && styles.dotOn, { width: j === index ? 22 : 8 }]}
                    />
                  ))}
                </View>
                <PrimaryButton
                  label={i === SLIDES.length - 1 ? t('onboarding.getStarted') : t('common.continue')}
                  onPress={() => next(i)}
                />
                {i === SLIDES.length - 1 && (
                  <Pressable onPress={() => router.replace('/signin')} style={styles.haveAccount}>
                    <Text style={styles.haveAccountText}>{t('onboarding.haveAccount')}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  imageWrap: { height: 460, position: 'relative' },
  image: { width: '100%', height: '100%' },
  mascotWrap: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  // NOTE: horizontal pinning (left/right 20) is applied inline per direction — see useDirection().
  skip: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 50,
  },
  skipText: { color: colors.white, fontSize: font.sizes.lg, fontWeight: font.weights.semibold },
  langBtn: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 50,
  },
  langText: { fontSize: font.sizes.md, fontWeight: font.weights.semibold, color: colors.ink },
  langSheet: {
    position: 'absolute',
    backgroundColor: colors.white,
    borderRadius: 12,
    paddingVertical: 6,
    minWidth: 160,
    shadowColor: colors.black,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  langOpt: { paddingHorizontal: 14, paddingVertical: 9 },
  langOptActive: { backgroundColor: colors.bgSoft },
  langOptText: { fontSize: font.sizes.lg, color: colors.ink },
  body: { flex: 1, paddingHorizontal: 28, paddingVertical: 32 },
  title: {
    fontSize: 30,
    fontWeight: font.weights.extrabold,
    letterSpacing: -0.7,
    lineHeight: 36,
    color: colors.ink,
    marginBottom: 14,
  },
  desc: { fontSize: font.sizes.xl, color: colors.ink2, lineHeight: 22, marginBottom: 24 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 20 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.line },
  dotOn: { width: 24, backgroundColor: colors.accent },
  haveAccount: { alignItems: 'center', paddingVertical: 14, marginTop: 2 },
  haveAccountText: { fontSize: font.sizes.lg, color: colors.ink2, fontWeight: font.weights.semibold },
});
