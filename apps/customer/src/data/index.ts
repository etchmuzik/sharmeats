/**
 * Single data-layer entry point.
 *
 * The whole app calls `db.restaurants.list()`, never the mock/supabase files
 * directly. The active adapter is chosen at import time by the
 * EXPO_PUBLIC_USE_SUPABASE env flag (default: mock).
 *
 * Set EXPO_PUBLIC_USE_SUPABASE=true plus EXPO_PUBLIC_SUPABASE_URL +
 * EXPO_PUBLIC_SUPABASE_ANON_KEY to flip to the live backend. The UI does not
 * change.
 */
import { authRepo } from './repositories/auth';
import { cartRepo } from './repositories/cart';
import { fxRepo } from './repositories/fx';
import { acquisitionRepo } from './repositories/acquisition';
import { hotelsRepo } from './repositories/hotels';
import { menusRepo } from './repositories/menus';
import { messagesRepo } from './repositories/messages';
import { ordersRepo } from './repositories/orders';
import { restaurantsRepo } from './repositories/restaurants';
import { rewardsRepo } from './repositories/rewards';
import { savedOrdersRepo } from './repositories/savedOrders';
import { supportRepo } from './repositories/support';
import { userRepo } from './repositories/user';

import { authRepoSupabase } from './supabase/auth';
import { cartRepoSupabase } from './supabase/cart';
import { fxRepoSupabase } from './supabase/fx';
import { acquisitionRepoSupabase } from './supabase/acquisition';
import { hotelsRepoSupabase } from './supabase/hotels';
import { menusRepoSupabase } from './supabase/menus';
import { messagesRepoSupabase } from './supabase/messages';
import { ordersRepoSupabase } from './supabase/orders';
import { restaurantsRepoSupabase } from './supabase/restaurants';
import { rewardsRepoSupabase } from './supabase/rewards';
import { savedOrdersRepoSupabase } from './supabase/savedOrders';
import { supportRepoSupabase } from './supabase/support';
import { userRepoSupabase } from './supabase/user';

const useSupabase = process.env.EXPO_PUBLIC_USE_SUPABASE === 'true';

export const db = useSupabase
  ? {
      auth: authRepoSupabase,
      restaurants: restaurantsRepoSupabase,
      menus: menusRepoSupabase,
      hotels: hotelsRepoSupabase,
      user: userRepoSupabase,
      savedOrders: savedOrdersRepoSupabase,
      orders: ordersRepoSupabase,
      rewards: rewardsRepoSupabase,
      messages: messagesRepoSupabase,
      support: supportRepoSupabase,
      cart: cartRepoSupabase,
      fx: fxRepoSupabase,
      acquisition: acquisitionRepoSupabase,
    }
  : {
      auth: authRepo,
      restaurants: restaurantsRepo,
      menus: menusRepo,
      hotels: hotelsRepo,
      user: userRepo,
      savedOrders: savedOrdersRepo,
      orders: ordersRepo,
      rewards: rewardsRepo,
      messages: messagesRepo,
      support: supportRepo,
      cart: cartRepo,
      fx: fxRepo,
      acquisition: acquisitionRepo,
    };

export type DB = typeof db;
export const isBackendLive = useSupabase;
