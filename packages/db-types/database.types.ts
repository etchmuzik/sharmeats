/**
 * Generated Supabase types — PLACEHOLDER (live DB exists; not yet generated).
 *
 * The Supabase project (ref: ilqpsebcfbaoaogimhud) is LIVE with migrations
 * 001–014 applied and seeded. This file is still the placeholder because
 * `supabase gen types` needs a management access token (not the anon key).
 *
 * To generate the real types (one-time):
 *   1. supabase login       # opens browser, stores access token
 *   2. npm run db:types      # writes the real Database type here (ref baked in)
 *
 * Nothing imports this yet — the apps use hand-written types in
 * apps/<app>/src/data/types.ts — so this placeholder blocks nothing.
 * Wire @sharmeats/db-types into the Supabase adapters after generating.
 *
 * Do not hand-edit; it is overwritten by `supabase gen types typescript`.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
