/**
 * Generated Supabase types — PLACEHOLDER.
 *
 * Regenerate once the Supabase project exists and migrations are applied:
 *   SUPABASE_PROJECT_REF=<ref> npm run db:types
 * (from the monorepo root)
 *
 * Until then this empty Database type lets TypeScript compile. Do not hand-edit;
 * it is overwritten by `supabase gen types typescript`.
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
