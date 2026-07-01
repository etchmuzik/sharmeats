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
import { hotelsRepo } from './repositories/hotels';
import { menusRepo } from './repositories/menus';
import { ordersRepo } from './repositories/orders';
import { restaurantsRepo } from './repositories/restaurants';
import { rewardsRepo } from './repositories/rewards';
import { userRepo } from './repositories/user';

import { authRepoSupabase } from './supabase/auth';
import { hotelsRepoSupabase } from './supabase/hotels';
import { menusRepoSupabase } from './supabase/menus';
import { ordersRepoSupabase } from './supabase/orders';
import { restaurantsRepoSupabase } from './supabase/restaurants';
import { rewardsRepoSupabase } from './supabase/rewards';
import { userRepoSupabase } from './supabase/user';

const useSupabase = process.env.EXPO_PUBLIC_USE_SUPABASE === 'true';

export const db = useSupabase
  ? {
      auth: authRepoSupabase,
      restaurants: restaurantsRepoSupabase,
      menus: menusRepoSupabase,
      hotels: hotelsRepoSupabase,
      user: userRepoSupabase,
      orders: ordersRepoSupabase,
      rewards: rewardsRepoSupabase,
    }
  : {
      auth: authRepo,
      restaurants: restaurantsRepo,
      menus: menusRepo,
      hotels: hotelsRepo,
      user: userRepo,
      orders: ordersRepo,
      rewards: rewardsRepo,
    };

export type DB = typeof db;
export const isBackendLive = useSupabase;
