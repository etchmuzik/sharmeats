import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, radius } from '../../src/theme';
import { ThemedStatusBar, makeStyles, useThemeColors } from '../../src/themeProvider';
import { CuisinePill } from '../../src/components/CuisinePill';
import { CuisineChip } from '../../src/components/CuisineChip';
import { RestaurantCard } from '../../src/components/RestaurantCard';
import { Icon } from '../../src/components/Icon';
import { db } from '../../src/data';
import type { Cuisine, MenuSearchHit, Restaurant } from '../../src/data/types';
import { useT } from '../../src/i18n';
import { useDirection } from '../../src/lib/direction';
import { formatEgp } from '../../src/lib/format';
import { effectiveIsOpen } from '../../src/lib/openHours';
import { tap } from '../../src/haptics';
import { track } from '../../src/lib/analytics';
import { useSession } from '../../src/store/session';

/**
 * Debounce a changing value so effects fire after typing settles, not on every
 * keystroke. Used to throttle the search_performed analytics event.
 */
function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

const CUISINES: { key: Cuisine | 'all'; tKey: string; emoji: string }[] = [
  { key: 'all', tKey: 'cuisine.all', emoji: '' },
  { key: 'breakfast', tKey: 'cuisine.breakfast', emoji: '🍳' },
  { key: 'street_food', tKey: 'cuisine.street_food', emoji: '🥙' },
  { key: 'egyptian', tKey: 'cuisine.egyptian', emoji: '🍲' },
  { key: 'sweets', tKey: 'cuisine.sweets', emoji: '🍯' },
  // grocery/pharmacy chips removed (Package 07 Program A): a vertical is a
  // commerce WORKFLOW, not a cuisine. Their discovery surface arrives with the
  // vertical navigation work; a chip filtering the food list to zero rows only
  // taught customers the categories are broken.
  { key: 'italian', tKey: 'cuisine.italian', emoji: '🍝' },
  { key: 'seafood', tKey: 'cuisine.seafood', emoji: '🐟' },
  { key: 'sushi', tKey: 'cuisine.sushi', emoji: '🍣' },
  { key: 'healthy', tKey: 'cuisine.healthy', emoji: '🥗' },
  { key: 'burgers', tKey: 'cuisine.burgers', emoji: '🍔' },
  { key: 'pizza', tKey: 'cuisine.pizza', emoji: '🍕' },
];

// Search results come back as MenuSearchHit — six fields, one round trip. The
// old shape held a whole MenuItem plus its Restaurant, which is what forced the
// per-restaurant fetch loop in the first place.

// Halal is the default in Egypt — no filter needed. Keep vegetarian + GF only.
const FLAG_FILTERS: { key: 'vegetarian' | 'glutenfree'; tKey: string; emoji: string }[] = [
  { key: 'vegetarian', tKey: 'flag.vegetarian', emoji: '🥬' },
  { key: 'glutenfree', tKey: 'flag.glutenfree', emoji: '🌾' },
];

type SortKey = 'recommended' | 'rating' | 'fee' | 'fastest';

// 'recommended' keeps the backend's default ordering (rating-weighted).
const SORTS: { key: SortKey; tKey: string; emoji: string }[] = [
  { key: 'recommended', tKey: 'browse.sortRecommended', emoji: '' },
  { key: 'rating', tKey: 'browse.sortRating', emoji: '⭐' },
  { key: 'fee', tKey: 'browse.sortFee', emoji: '🛵' },
  { key: 'fastest', tKey: 'browse.sortFastest', emoji: '⏱' },
];

export default function BrowseTab() {
  const colors = useThemeColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const dir = useDirection();
  const [cuisine, setCuisine] = useState<Cuisine | 'all'>('all');
  const [query, setQuery] = useState('');
  const [all, setAll] = useState<Restaurant[]>([]);
  const [menuMatches, setMenuMatches] = useState<MenuSearchHit[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFlags, setActiveFlags] = useState<Set<'vegetarian' | 'glutenfree'>>(new Set());
  const [sort, setSort] = useState<SortKey>('recommended');
  const [openNow, setOpenNow] = useState(false);
  // Restaurant ids that satisfy EVERY active dietary filter, resolved server-side
  // in one query. This replaced a per-restaurant loop that fetched whole menus
  // (with modifier trees it never read) just to union their flags.
  const [flagMatchIds, setFlagMatchIds] = useState<Set<string>>(new Set());

  const recentSearches = useSession((s) => s.recentSearches);
  const rememberSearch = useSession((s) => s.rememberSearch);
  const forgetSearch = useSession((s) => s.forgetSearch);
  const clearRecentSearches = useSession((s) => s.clearRecentSearches);

  // Sorted+joined so the effect re-runs when the flag SET CHANGES, not merely
  // when its size does: swapping vegetarian for gluten-free keeps size at 1, and
  // keying on `.size` left the previous filter's ids in place.
  const activeFlagKey = [...activeFlags].sort().join(',');

  useEffect(() => {
    const flags = activeFlagKey ? activeFlagKey.split(',') : [];
    if (flags.length === 0) {
      setFlagMatchIds(new Set());
      return;
    }
    let cancelled = false;
    db.menus
      .restaurantsWithFlags(flags)
      .then((ids) => {
        if (!cancelled) setFlagMatchIds(ids);
      })
      // A failed index must not strand the list: fall back to matching nothing,
      // which is visibly "no results for this filter" rather than silently
      // showing restaurants that may not qualify.
      .catch(() => {
        if (!cancelled) setFlagMatchIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [activeFlagKey]);

  // Distinguishes "the catalogue is empty" from "the catalogue has not arrived
  // yet". Without it the list is empty on the very first render, so an empty
  // state flashes — now telling the user their search matched nothing before a
  // search has even run.
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await db.restaurants.list();
      setAll(r);
    } finally {
      // Set even on failure: a fetch that errored has still finished, and
      // leaving the screen blank forever is worse than showing the empty state.
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // One debounced value drives BOTH the query and the analytics event.
  //
  // The search effect used to key on the raw `query`, so it fired on every
  // keystroke while only the analytics call was debounced. Combined with a
  // per-restaurant fetch loop that cost four round trips each, a single typed
  // word issued hundreds of requests, most of them for prefixes the user had
  // already moved past.
  const debouncedQuery = useDebounce(query, 300);

  // Cross-restaurant dish search — one round trip via db.menus.search.
  useEffect(() => {
    const q = debouncedQuery.trim();
    if (q.length < 2) {
      setMenuMatches([]);
      return;
    }
    let cancelled = false;
    db.menus
      .search(q, 12)
      .then((hits) => {
        // A slower earlier request must not overwrite a newer result.
        if (!cancelled) setMenuMatches(hits);
      })
      .catch(() => {
        if (!cancelled) setMenuMatches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  // Analytics: one event per settled search rather than one per keystroke. We log
  // only the query length — never the raw text — to avoid capturing PII.
  useEffect(() => {
    const q = debouncedQuery.trim();
    if (q.length < 2) return;
    track('search_performed', { queryLength: q.length });
  }, [debouncedQuery]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const result = all.filter((r) => {
      if (openNow && !effectiveIsOpen(r)) return false;
      if (cuisine !== 'all' && !r.cuisines.includes(cuisine as Cuisine)) return false;
      // flagMatchIds is empty until the index resolves, which correctly shows
      // "no results" for a moment rather than briefly showing restaurants that
      // may not qualify.
      if (activeFlags.size > 0 && !flagMatchIds.has(r.id)) return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || r.cuisineLabel.toLowerCase().includes(q);
    });
    // filter() already copied, so in-place sort is safe. Catalog is small
    // (curated ~20 merchants) — client-side sorting is fine.
    if (sort === 'rating') result.sort((a, b) => b.rating - a.rating);
    else if (sort === 'fee') result.sort((a, b) => a.deliveryFeeEgp - b.deliveryFeeEgp);
    else if (sort === 'fastest') result.sort((a, b) => a.prepTimeLow - b.prepTimeLow);
    return result;
  }, [all, cuisine, query, activeFlags, flagMatchIds, openNow, sort]);

  const trimmedQuery = query.trim();

  // How many filters are narrowing the list. This drives the empty state:
  // "nothing matches what you typed" and "your filters excluded everything" are
  // different problems, and only the second one has a fix the user can act on.
  // Sort is excluded — it reorders, it never removes.
  const activeFilterCount = (openNow ? 1 : 0) + activeFlags.size + (cuisine !== 'all' ? 1 : 0);

  const clearFilters = useCallback(() => {
    tap();
    setOpenNow(false);
    setActiveFlags(new Set());
    setCuisine('all');
  }, []);

  /**
   * Record a query the user COMMITTED to — submitted from the keyboard, or
   * followed through to a dish or a restaurant.
   *
   * Deliberately NOT the debounced query. Recording what people type would fill
   * an eight-slot list with "piz" and "pizz" and evict the searches actually
   * worth keeping; committing is the only signal that a query meant something.
   */
  const commitSearch = useCallback(
    (q: string) => {
      rememberSearch(q);
    },
    [rememberSearch],
  );

  /** Replay a saved search. Re-recording it promotes it back to the top. */
  const runRecentSearch = useCallback(
    (q: string) => {
      tap();
      setQuery(q);
      rememberSearch(q);
      // Length only, never the text — see the analytics deny-list.
      track('search_recent_used', { queryLength: q.length });
    },
    [rememberSearch],
  );

  // Shown whenever the box is empty rather than while it is focused. Gating on
  // focus would race the blur that fires when a row is tapped: the panel would
  // unmount before the press landed.
  const showRecents = trimmedQuery.length === 0 && recentSearches.length > 0;
  const isSearching = trimmedQuery.length > 0 || activeFilterCount > 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ThemedStatusBar />
      <View style={[styles.top, { paddingTop: insets.top + 14 }]}>
        <Text style={styles.title}>{t('browse.title')}</Text>
        <View style={styles.searchBox}>
          <Icon name="search" size={16} color={colors.ink3} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('home.searchHint')}
            placeholderTextColor={colors.ink3}
            style={styles.input}
            accessibilityLabel={t('home.searchHint')}
            returnKeyType="search"
            onSubmitEditing={() => commitSearch(query)}
          />
          {trimmedQuery.length > 0 && (
            <Pressable
              onPress={() => {
                tap();
                setQuery('');
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('browse.clearSearch')}>
              <Icon name="close" size={16} color={colors.ink3} />
            </Pressable>
          )}
        </View>
        {/* [App v2] circular category chips — the arc picker's lighter, all-13
            interpretation. RTL is mirrored explicitly because this app never
            engages native forceRTL (see src/lib/direction.ts). */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[
            styles.cuisineRow,
            { flexDirection: dir.isRtl ? 'row-reverse' : 'row' },
          ]}>
          {CUISINES.map((c) => (
            <CuisineChip
              key={c.key}
              label={t(c.tKey)}
              emoji={c.emoji}
              active={cuisine === c.key}
              onPress={() => setCuisine(c.key as Cuisine | 'all')}
            />
          ))}
        </ScrollView>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.flagRow}>
          <CuisinePill
            label={t('browse.openNow')}
            emoji="🟢"
            active={openNow}
            onPress={() => setOpenNow((v) => !v)}
          />
          {FLAG_FILTERS.map((f) => (
            <CuisinePill
              key={f.key}
              label={t(f.tKey)}
              emoji={f.emoji}
              active={activeFlags.has(f.key)}
              onPress={() => {
                setActiveFlags((prev) => {
                  const next = new Set(prev);
                  if (next.has(f.key)) next.delete(f.key);
                  else next.add(f.key);
                  return next;
                });
              }}
            />
          ))}
          <View style={styles.sortDivider} />
          {SORTS.map((s) => (
            <CuisinePill
              key={s.key}
              label={t(s.tKey)}
              emoji={s.emoji}
              active={sort === s.key}
              onPress={() => setSort(s.key)}
            />
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 120 + insets.bottom, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View>
            {showRecents && (
              <View style={styles.recentWrap}>
                <View style={styles.recentHead}>
                  <Text style={styles.sectionTitle}>{t('browse.recent')}</Text>
                  <Pressable
                    onPress={() => {
                      tap();
                      clearRecentSearches();
                      track('search_recents_cleared', { count: recentSearches.length });
                    }}
                    hitSlop={8}
                    accessibilityRole="button">
                    <Text style={styles.recentClear}>{t('browse.clearAll')}</Text>
                  </Pressable>
                </View>
                {recentSearches.map((q) => (
                  <Pressable
                    key={q.toLowerCase()}
                    onPress={() => runRecentSearch(q)}
                    style={({ pressed }) => [
                      styles.recentRow,
                      { flexDirection: dir.isRtl ? 'row-reverse' : 'row' },
                      pressed && { opacity: 0.85 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={t('browse.searchAgain', { query: q })}>
                    <Icon name="history" size={16} color={colors.ink3} />
                    <Text style={styles.recentText} numberOfLines={1}>
                      {q}
                    </Text>
                    <Pressable
                      onPress={() => {
                        tap();
                        forgetSearch(q);
                      }}
                      hitSlop={12}
                      accessibilityRole="button"
                      accessibilityLabel={t('browse.forgetSearch', { query: q })}>
                      <Icon name="close" size={15} color={colors.ink3} />
                    </Pressable>
                  </Pressable>
                ))}
              </View>
            )}

            {menuMatches.length > 0 && (
              <View style={styles.menuMatchWrap}>
                <Text style={styles.sectionTitle}>
                  {t('browse.dishesCount', { count: menuMatches.length })}
                </Text>
                {menuMatches.map((m) => (
                  <Pressable
                    key={m.itemId}
                    onPress={() => {
                      tap();
                      // Following a dish through is a completed search, even
                      // though the user never pressed the keyboard's search key.
                      commitSearch(query);
                      router.push(`/item/${m.itemId}` as never);
                    }}
                    style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.85 }]}>
                    <Image source={{ uri: m.itemImage }} style={styles.menuImg} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.menuName} numberOfLines={1}>
                        {m.itemName}
                      </Text>
                      <Text style={styles.menuSub} numberOfLines={1}>
                        {m.restaurantName}
                      </Text>
                    </View>
                    <Text style={styles.menuPrice}>{formatEgp(m.priceEgp)}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {/* A count, and the heading that separates dishes from places. Both
                only once something is actually narrowing the list — an
                unfiltered browse does not need to be told how many merchants
                exist. */}
            {isSearching && filtered.length > 0 && (
              <Text style={styles.sectionTitle}>
                {t('browse.restaurantsCount', { count: filtered.length })}
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <RestaurantCard
            restaurant={item}
            // Opening a restaurant off the back of a query is the strongest
            // signal the search was worth remembering. Gated on the QUERY, not
            // on isSearching — arriving via a filter alone is not a search.
            onOpen={trimmedQuery.length > 0 ? () => commitSearch(query) : undefined}
          />
        )}
        ListEmptyComponent={
          // Nothing at all until the first load resolves: an empty state that
          // appears before the catalogue arrives says the search matched
          // nothing when no search has run.
          !loaded ? null : (
            <View style={styles.emptyWrap}>
              {menuMatches.length > 0 ? (
                // Dishes DID match, so this is not a dead end and does not
                // deserve the full treatment — just an explanation of why the
                // places list under the dishes is empty.
                <Text style={styles.emptyBody}>{t('browse.emptyDishesOnly')}</Text>
              ) : (
                <>
                  <Text style={styles.emptyTitle}>
                    {activeFilterCount > 0
                      ? t('browse.emptyFiltered')
                      : trimmedQuery.length > 0
                        ? t('browse.emptyQuery', { query: trimmedQuery })
                        : t('browse.empty')}
                  </Text>
                  {/* Filters are the only empty state with a fix the user can
                      act on, so it gets a button rather than a suggestion. */}
                  {activeFilterCount > 0 ? (
                    <Pressable
                      onPress={clearFilters}
                      style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.9 }]}
                      accessibilityRole="button">
                      <Text style={styles.emptyBtnText}>{t('browse.clearFilters')}</Text>
                    </Pressable>
                  ) : (
                    trimmedQuery.length > 0 && (
                      <Text style={styles.emptyBody}>{t('browse.emptyQueryHint')}</Text>
                    )
                  )}
                </>
              )}
            </View>
          )
        }
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  top: {
    paddingHorizontal: 20,
    paddingBottom: 6,
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  title: {
    fontSize: 32,
    fontWeight: font.weights.extrabold,
    letterSpacing: -0.8,
    color: colors.ink,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    height: 46,
    marginTop: 14,
  },
  input: { flex: 1, fontSize: font.sizes.lg, color: colors.ink, paddingVertical: 0 },
  cuisineRow: { gap: 6, paddingTop: 14, paddingBottom: 8, paddingHorizontal: 2 },
  flagRow: { gap: 8, paddingTop: 4, paddingBottom: 14, alignItems: 'center' },
  sortDivider: { width: 1, height: 22, backgroundColor: colors.line2, marginHorizontal: 4 },
  menuMatchWrap: { gap: 6, marginBottom: 14 },
  sectionTitle: {
    fontSize: font.sizes.sm,
    color: colors.ink3,
    fontWeight: font.weights.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingTop: 10,
    paddingBottom: 4,
  },
  recentWrap: { gap: 2, marginBottom: 10 },
  recentHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // ink2, not ink3: this is the only way to remove history, so it has to be
  // legible rather than decorative. ink3 is a 5.2:1 hint colour; a control that
  // destroys data should not read as a hint.
  recentClear: {
    fontSize: font.sizes.sm,
    color: colors.ink2,
    fontWeight: font.weights.bold,
  },
  recentRow: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderRadius: radius.md,
  },
  recentText: { flex: 1, fontSize: font.sizes.lg, color: colors.ink },
  emptyWrap: { paddingTop: 48, alignItems: 'center', gap: 10, paddingHorizontal: 24 },
  emptyTitle: {
    fontSize: font.sizes.lg,
    color: colors.ink,
    fontWeight: font.weights.bold,
    textAlign: 'center',
  },
  emptyBody: { fontSize: font.sizes.md, color: colors.ink2, textAlign: 'center', lineHeight: 20 },
  emptyBtn: {
    marginTop: 4,
    backgroundColor: colors.ink,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: radius.lg,
  },
  // onInk, not white: `ink` inverts between themes, so a label pinned to
  // near-white disappears on the light fill the dark theme uses.
  emptyBtnText: { color: colors.onInk, fontWeight: font.weights.bold, fontSize: font.sizes.md },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  menuImg: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.bgSoft },
  menuName: { fontSize: font.sizes.lg, color: colors.ink, fontWeight: font.weights.bold },
  menuSub: { fontSize: font.sizes.sm, color: colors.ink2, marginTop: 2 },
  menuPrice: { fontSize: font.sizes.md, color: colors.ink, fontWeight: font.weights.bold },
}));
