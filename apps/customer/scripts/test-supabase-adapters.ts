/**
 * Integration test for the Supabase adapter layer.
 *
 * Run: `npx tsx scripts/test-supabase-adapters.ts`
 *
 * Standalone — no test runner, no Expo runtime. Stubs supabase-js with a
 * canned client that returns rows shaped exactly like the migrations would.
 * Asserts every adapter method round-trips into the TypeScript domain types
 * the rest of the app consumes. If the adapter ever drifts from the
 * migration schema, this script fails fast.
 *
 * Why a custom client instead of pg-mem + real supabase-js: we don't need
 * to test PostgREST itself — we trust it. We need to prove our mappers
 * + adapters preserve every field across the wire.
 *
 * Writes that go through SECURITY DEFINER RPCs (place_order) are asserted by
 * RPC name + argument payload, not table ops: the server recomputes money and
 * status, so the only client-side contract worth pinning is "the right RPC,
 * with the right arg names and values". A renamed or dropped arg is exactly
 * how PGRST202 outages start (mig 212, mig 214).
 */

// ---------------------------------------------------------------------------
// 1. Fake supabase-js client. Captures query + RPC intent, returns canned rows.
// ---------------------------------------------------------------------------

interface QueryLog {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  filters: Record<string, unknown>;
  payload?: unknown;
}
const log: QueryLog[] = [];

interface RpcLog {
  name: string;
  args: Record<string, unknown>;
}
const rpcLog: RpcLog[] = [];

type RowProvider = (q: QueryLog) => unknown;
const tableRows: Record<string, RowProvider> = {};

type RpcProvider = (args: Record<string, unknown>) => unknown;
const rpcResults: Record<string, RpcProvider> = {};

function makeQuery(table: string, op: QueryLog['op'] = 'select', payload?: unknown) {
  const entry: QueryLog = { table, op, filters: {}, payload };
  log.push(entry);

  const chain: Record<string, unknown> = {};
  const noop = () => chain;
  const filter = (k: string) => (v: unknown) => {
    entry.filters[k] = v;
    return chain;
  };
  chain.select = noop;
  chain.eq = (col: string, val: unknown) => filter(`eq:${col}`)(val);
  chain.neq = (col: string, val: unknown) => filter(`neq:${col}`)(val);
  chain.in = (col: string, val: unknown) => filter(`in:${col}`)(val);
  chain.not = (col: string, op2: string, val: unknown) => filter(`not:${col}:${op2}`)(val);
  chain.ilike = (col: string, val: unknown) => filter(`ilike:${col}`)(val);
  chain.contains = (col: string, val: unknown) => filter(`contains:${col}`)(val);
  chain.order = (col: string, opts?: unknown) => filter(`order:${col}`)(opts ?? true);

  // Resolution: maybeSingle / single return a single row; otherwise array.
  const resolveArray = () => {
    const data = tableRows[table]?.(entry);
    return { data: Array.isArray(data) ? data : data == null ? [] : [data], error: null };
  };
  const resolveOne = () => {
    const data = tableRows[table]?.(entry);
    const row = Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
    return { data: row, error: null };
  };

  chain.maybeSingle = () => Promise.resolve(resolveOne());
  chain.single = () => Promise.resolve(resolveOne());

  // The base chain is itself thenable so `await sb.from(...).select(...).eq(...)`
  // resolves to an array result without needing .then().
  (chain as Record<string, unknown>).then = (onF: (v: unknown) => unknown) =>
    Promise.resolve(resolveArray()).then(onF);

  return chain;
}

const fakeAuthUser = { id: 'user-uuid-1234' };

const fakeSb = {
  from(table: string) {
    return {
      select: () => makeQuery(table, 'select'),
      insert: (payload: unknown) => ({
        select: () => makeQuery(table, 'insert', payload),
      }),
      update: (payload: unknown) => makeQuery(table, 'update', payload),
      delete: () => makeQuery(table, 'delete'),
    };
  },
  // supabase-js's rpc() builder is thenable; adapters only ever
  // `await sb.rpc(...)` and destructure { data, error }, so a plain
  // promise is a faithful stand-in.
  rpc(name: string, args: Record<string, unknown> = {}) {
    rpcLog.push({ name, args });
    return Promise.resolve({ data: rpcResults[name]?.(args) ?? null, error: null });
  },
  auth: {
    async getUser() {
      return { data: { user: fakeAuthUser }, error: null };
    },
  },
  // subscribe() sweeps existing channels for stale same-named ones before
  // creating a fresh one; an empty registry is enough for that sweep.
  getChannels() {
    return [] as { topic: string }[];
  },
  channel(_name: string) {
    return {
      on() {
        return this;
      },
      subscribe() {
        return this;
      },
    };
  },
  removeChannel() {},
};

// Inject fakes by poisoning require.cache BEFORE any adapter imports the
// real modules. tsx runs in CJS mode by default, so require.cache is
// authoritative.
import { createRequire } from 'node:module';
const req = createRequire(__filename);

function stubModule(specifier: string, exports: Record<string, unknown>) {
  const resolved = req.resolve(specifier);
  req.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
    children: [],
    paths: [],
    // @ts-expect-error — partial Module shape, enough for downstream require.
    parent: null,
  };
}

stubModule('../src/data/supabase/client.ts', {
  getSupabase: () => fakeSb as unknown,
  isSupabaseConfigured: () => true,
});

// orders.ts localises place_order errors via t(), and the real i18n module
// imports the zustand session store + AsyncStorage — a react-native chain
// that cannot load under plain Node. Error copy is not under test here;
// returning the key is enough.
stubModule('../src/i18n/index.ts', {
  t: (key: string) => key,
});

// ---------------------------------------------------------------------------
// 2. Canned rows — shaped to match migrations 002, 003, 004.
// ---------------------------------------------------------------------------

const restaurantRow = {
  id: 'r-1', slug: 'koshary-el-hadaba', name: 'Koshary El-Hadaba',
  description: 'Street koshary, 24/7',
  cuisines: ['street_food', 'egyptian'], cuisine_label: 'Street food · Egyptian',
  cover_image: 'https://x/cover.jpg', logo: null, zone: 'el_hadaba_residential',
  rating: 4.6, rating_count: 320, prep_time_low: 10, prep_time_high: 20,
  delivery_fee_egp: 15, min_order_egp: 35, distance_meters: 800,
  tourist_safe: false, is_open: true, is_open_24h: true, featured: true,
  promo: null,
};

const hotelRow = {
  id: 'h-1', name: 'Hilton Sharks Bay', brand: 'Hilton', zone: 'sharks_bay',
  reception_phone: '+201001234567', verified: true,
};

const userRow = {
  id: fakeAuthUser.id, phone: '+201111111111', display_name: 'Ahmed Hassan',
  email: null, default_address_id: 'a-1', default_payment_method_id: 'pm-cash',
  preferred_currency: 'EGP', locale: 'ar', allergy_profile: ['nuts'],
  created_at: '2026-05-01T10:00:00Z',
};

const addressRow = {
  id: 'a-1', kind: 'street', label: 'Home',
  hotel_id: null, hotel_name: null, room_number: null, handoff: null,
  street_text: 'El-Salam, Block 14', building: '14', apartment: '3',
  landmark: 'Near Mosque', beach_name: null, is_default: true,
};

const paymentMethodRow = {
  id: 'pm-cash', kind: 'cash', label: 'Cash on delivery', subline: '', is_default: true,
};

const sectionRow = { id: 's-1', name: 'Mains' };
const itemRow = {
  id: 'i-1', restaurant_id: 'r-1', section_id: 's-1',
  name: 'Koshary Large', description: 'Lentils + rice + pasta',
  price_egp: 35, image: 'https://x/i.jpg', flags: ['vegetarian'], is_available: true,
};

const orderRow = {
  id: 'o-1', short_code: 'SE-ABC123', user_id: fakeAuthUser.id,
  restaurant_id: 'r-1', restaurant_name: 'Koshary El-Hadaba',
  address_id: 'a-1', address_snapshot: addressRow as unknown,
  items: [] as unknown[], subtotal_egp: 70, delivery_fee_egp: 15,
  tax_egp: 10, tip_egp: 0, total_egp: 95,
  payment_method_kind: 'cash', payment_label: 'Cash on delivery',
  status: 'placed', history: [{ status: 'placed', at: 1747500000000 }],
  rider: null, placed_at: '2026-05-17T19:00:00Z', delivered_at: null,
  eta_at: '2026-05-17T19:30:00Z', sla_minutes: 30,
  rating_food: null, rating_delivery: null, rating_comment: null,
  kitchen_notes: null, aggregate_allergens: ['nuts'],
  scheduled_for: null,
};

tableRows.restaurants = (q) => {
  if (q.filters['eq:id']) return restaurantRow;
  if (q.filters['eq:slug']) return restaurantRow;
  return [restaurantRow];
};
tableRows.hotels = (q) => (q.filters['eq:id'] ? hotelRow : [hotelRow]);
tableRows.users = () => userRow;
tableRows.addresses = () => [addressRow];
tableRows.payment_methods = () => [paymentMethodRow];
tableRows.menu_sections = () => [sectionRow];
tableRows.menu_items = (q) => (q.filters['eq:id'] ? itemRow : [itemRow]);
tableRows.orders = (q) => {
  if (q.op === 'insert' || q.op === 'update') return orderRow;
  if (q.filters['eq:id']) return orderRow;
  return [orderRow];
};

// place_order RETURNS TABLE(id, short_code, total_egp) — PostgREST hands the
// adapter an array of one row, and the adapter re-reads the full order by id.
rpcResults.place_order = () => [{ id: 'o-1', short_code: 'SE-ABC123', total_egp: 95 }];

// ---------------------------------------------------------------------------
// 3. Test harness — minimal pass/fail printer.
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function run() {
  // Dynamic imports AFTER the mock is registered.
  const { restaurantsRepoSupabase } = await import('../src/data/supabase/restaurants');
  const { hotelsRepoSupabase } = await import('../src/data/supabase/hotels');
  const { menusRepoSupabase } = await import('../src/data/supabase/menus');
  const { userRepoSupabase } = await import('../src/data/supabase/user');
  const { ordersRepoSupabase } = await import('../src/data/supabase/orders');

  console.log('\nrestaurants adapter');
  const rs = await restaurantsRepoSupabase.list();
  check('list returns array', Array.isArray(rs) && rs.length === 1);
  check('list maps cuisineLabel', rs[0]?.cuisineLabel === 'Street food · Egyptian');
  check('list maps isOpen24h', rs[0]?.isOpen24h === true);
  const feat = await restaurantsRepoSupabase.listFeatured();
  check('listFeatured filters featured', log.some(
    (q) => q.table === 'restaurants' && q.filters['eq:featured'] === true,
  ));
  check('listFeatured returns array', Array.isArray(feat));
  const r1 = await restaurantsRepoSupabase.get('r-1');
  check('get returns mapped Restaurant', r1?.name === 'Koshary El-Hadaba');
  const rSlug = await restaurantsRepoSupabase.getBySlug('koshary-el-hadaba');
  check('getBySlug returns mapped Restaurant', rSlug?.id === 'r-1');

  console.log('\nhotels adapter');
  const hs = await hotelsRepoSupabase.list();
  check('list filters verified', log.some(
    (q) => q.table === 'hotels' && q.filters['eq:verified'] === true,
  ));
  check('list maps Hotel', hs[0]?.receptionPhone === '+201001234567');
  const h1 = await hotelsRepoSupabase.get('h-1');
  check('get returns mapped Hotel', h1?.brand === 'Hilton');
  const hSearch = await hotelsRepoSupabase.search('Hil');
  check('search uses ilike', log.some(
    (q) => q.table === 'hotels' && q.filters['ilike:name'] === '%Hil%',
  ));
  check('search returns array', Array.isArray(hSearch));

  console.log('\nmenus adapter');
  const m = await menusRepoSupabase.forRestaurant('r-1');
  check('forRestaurant returns sections + items', m.sections.length === 1 && m.items.length === 1);
  check('forRestaurant filters is_available', log.some(
    (q) => q.table === 'menu_items' && q.filters['eq:is_available'] === true,
  ));
  check('forRestaurant maps MenuItem', m.items[0]?.priceEgp === 35);
  const it = await menusRepoSupabase.getItem('i-1');
  check('getItem maps MenuItem', it?.name === 'Koshary Large');

  console.log('\nuser adapter');
  const me = await userRepoSupabase.getMe();
  check('getMe maps User', me.displayName === 'Ahmed Hassan');
  check('getMe maps allergyProfile', JSON.stringify(me.allergyProfile) === '["nuts"]');
  check('getMe maps createdAt as epoch ms', typeof me.createdAt === 'number');
  await userRepoSupabase.update({ displayName: 'New Name', allergyProfile: ['gluten'] });
  const updateLog = log.find((q) => q.table === 'users' && q.op === 'update');
  check('update writes display_name', (updateLog?.payload as Record<string, unknown>)?.display_name === 'New Name');
  check('update writes allergy_profile', Array.isArray((updateLog?.payload as Record<string, unknown>)?.allergy_profile));
  const addrs = await userRepoSupabase.listAddresses();
  check('listAddresses maps Address', addrs[0]?.streetText === 'El-Salam, Block 14');
  const pms = await userRepoSupabase.listPaymentMethods();
  check('listPaymentMethods maps PaymentMethod', pms[0]?.kind === 'cash');

  console.log('\norders adapter');
  const createInput = {
    restaurantId: 'r-1',
    restaurantName: 'Koshary El-Hadaba',
    items: [],
    address: { id: 'a-1', kind: 'street', label: 'Home', streetText: 'x', isDefault: true } as never,
    payment: { kind: 'cash' as const, label: 'Cash on delivery' },
    deliveryFeeEgp: 15,
    aggregateAllergens: ['nuts' as const],
    scheduledFor: 1747500000000,
  };
  const created = await ordersRepoSupabase.create(createInput);
  const placeCall = rpcLog.find((c) => c.name === 'place_order');
  check('create calls place_order RPC, not a direct insert',
    placeCall !== undefined && !log.some((q) => q.table === 'orders' && q.op === 'insert'));
  check('create passes restaurant + address ids',
    placeCall?.args.p_restaurant_id === 'r-1' && placeCall?.args.p_address_id === 'a-1');
  check('create maps cash to cash_on_delivery',
    placeCall?.args.p_payment_method === 'cash_on_delivery');
  check('create passes p_scheduled_for as ISO string',
    placeCall?.args.p_scheduled_for === new Date(1747500000000).toISOString());
  check('create passes p_aggregate_allergens through (mig 214)',
    JSON.stringify(placeCall?.args.p_aggregate_allergens) === '["nuts"]');
  check('create returns mapped Order (re-read by id)', created.shortCode === 'SE-ABC123');

  // An empty allergen list must reach the RPC as null, not [] — the adapter
  // normalises "nothing to brief" to the parameter's default so the column
  // stays NULL instead of storing an empty array.
  await ordersRepoSupabase.create({ ...createInput, aggregateAllergens: [] });
  const placeCall2 = rpcLog.filter((c) => c.name === 'place_order')[1];
  check('create nulls p_aggregate_allergens for an empty list',
    placeCall2 !== undefined && placeCall2.args.p_aggregate_allergens === null);

  const got = await ordersRepoSupabase.get('o-1');
  check('get maps Order', got?.totalEgp === 95);
  check('get maps history (jsonb)', Array.isArray(got?.history) && got!.history[0]?.status === 'placed');
  check('get maps placedAt as epoch ms', typeof got?.placedAt === 'number');

  const active = await ordersRepoSupabase.listActive();
  check('listActive uses not-in filter', log.some(
    (q) => q.table === 'orders' && q.filters['not:status:in'] === '(delivered,cancelled,rejected)',
  ));
  check('listActive returns array', Array.isArray(active));

  const past = await ordersRepoSupabase.listPast();
  check('listPast uses in filter', log.some(
    (q) => q.table === 'orders' && Array.isArray(q.filters['in:status']),
  ));
  check('listPast returns array', Array.isArray(past));

  const forced = await ordersRepoSupabase.forceDelivered('o-1');
  check('forceDelivered returns mapped Order', forced?.id === 'o-1');

  const reviewed = await ordersRepoSupabase.submitReview('o-1', 5, 4, 'Great');
  check('submitReview returns mapped Order', reviewed?.id === 'o-1');
  const reviewLog = [...log].reverse().find((q) => q.table === 'orders' && q.op === 'update');
  check('submitReview writes rating_food', (reviewLog?.payload as Record<string, unknown>)?.rating_food === 5);

  const unsub = ordersRepoSupabase.subscribe('o-1', () => {});
  check('subscribe returns unsubscribe fn', typeof unsub === 'function');
  unsub();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error('Adapter test crashed:', e);
  process.exit(1);
});
