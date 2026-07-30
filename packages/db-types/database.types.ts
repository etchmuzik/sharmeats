export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      __pre_mig126_129_snapshot: {
        Row: {
          acl: string | null
          args: string | null
          def: string | null
          proname: unknown
          taken_at: string | null
        }
        Insert: {
          acl?: string | null
          args?: string | null
          def?: string | null
          proname?: unknown
          taken_at?: string | null
        }
        Update: {
          acl?: string | null
          args?: string | null
          def?: string | null
          proname?: unknown
          taken_at?: string | null
        }
        Relationships: []
      }
      acquisition_partners: {
        Row: {
          code: string
          created_at: string
          is_active: boolean
          label: string
        }
        Insert: {
          code: string
          created_at?: string
          is_active?: boolean
          label: string
        }
        Update: {
          code?: string
          created_at?: string
          is_active?: boolean
          label?: string
        }
        Relationships: []
      }
      acquisition_touches: {
        Row: {
          campaign: string | null
          claimed_at: string | null
          deep_link: string | null
          id: string
          install_id: string
          kind: string
          medium: string | null
          occurred_at: string
          partner_code: string | null
          source: string
          user_id: string | null
        }
        Insert: {
          campaign?: string | null
          claimed_at?: string | null
          deep_link?: string | null
          id?: string
          install_id: string
          kind: string
          medium?: string | null
          occurred_at?: string
          partner_code?: string | null
          source: string
          user_id?: string | null
        }
        Update: {
          campaign?: string | null
          claimed_at?: string | null
          deep_link?: string | null
          id?: string
          install_id?: string
          kind?: string
          medium?: string | null
          occurred_at?: string
          partner_code?: string | null
          source?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "acquisition_touches_partner_code_fkey"
            columns: ["partner_code"]
            isOneToOne: false
            referencedRelation: "acquisition_partners"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "acquisition_touches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      addresses: {
        Row: {
          apartment: string | null
          beach_name: string | null
          building: string | null
          created_at: string
          geo: unknown
          handoff: Database["public"]["Enums"]["handoff_type"] | null
          hotel_id: string | null
          hotel_name: string | null
          id: string
          is_default: boolean
          kind: Database["public"]["Enums"]["address_kind_type"]
          label: string
          landmark: string | null
          room_number: string | null
          street_text: string | null
          user_id: string
        }
        Insert: {
          apartment?: string | null
          beach_name?: string | null
          building?: string | null
          created_at?: string
          geo?: unknown
          handoff?: Database["public"]["Enums"]["handoff_type"] | null
          hotel_id?: string | null
          hotel_name?: string | null
          id?: string
          is_default?: boolean
          kind: Database["public"]["Enums"]["address_kind_type"]
          label: string
          landmark?: string | null
          room_number?: string | null
          street_text?: string | null
          user_id: string
        }
        Update: {
          apartment?: string | null
          beach_name?: string | null
          building?: string | null
          created_at?: string
          geo?: unknown
          handoff?: Database["public"]["Enums"]["handoff_type"] | null
          hotel_id?: string | null
          hotel_name?: string | null
          id?: string
          is_default?: boolean
          kind?: Database["public"]["Enums"]["address_kind_type"]
          label?: string
          landmark?: string | null
          room_number?: string | null
          street_text?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "addresses_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addresses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      batch_candidate_log: {
        Row: {
          dropoff_gap_m: number | null
          id: string
          observed_at: string
          order_a: string
          order_b: string
          pickup_gap_m: number | null
          ready_gap_min: number | null
          same_pickup: boolean | null
          same_restaurant: boolean
          zone: string | null
        }
        Insert: {
          dropoff_gap_m?: number | null
          id?: string
          observed_at?: string
          order_a: string
          order_b: string
          pickup_gap_m?: number | null
          ready_gap_min?: number | null
          same_pickup?: boolean | null
          same_restaurant: boolean
          zone?: string | null
        }
        Update: {
          dropoff_gap_m?: number | null
          id?: string
          observed_at?: string
          order_a?: string
          order_b?: string
          pickup_gap_m?: number | null
          ready_gap_min?: number | null
          same_pickup?: boolean | null
          same_restaurant?: boolean
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "batch_candidate_log_order_a_fkey"
            columns: ["order_a"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batch_candidate_log_order_b_fkey"
            columns: ["order_b"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      cities: {
        Row: {
          country_code: string
          created_at: string
          currency: string
          default_locale: string
          id: string
          is_active: boolean
          name: string
          slug: string
          timezone: string
        }
        Insert: {
          country_code?: string
          created_at?: string
          currency?: string
          default_locale?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          timezone?: string
        }
        Update: {
          country_code?: string
          created_at?: string
          currency?: string
          default_locale?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          timezone?: string
        }
        Relationships: []
      }
      credit_ledger: {
        Row: {
          actor_id: string | null
          created_at: string
          delta_egp: number
          id: number
          note: string | null
          reason: string
          ref_order_id: string | null
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          delta_egp: number
          id?: never
          note?: string | null
          reason: string
          ref_order_id?: string | null
          user_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          delta_egp?: number
          id?: never
          note?: string | null
          reason?: string
          ref_order_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_ledger_ref_order_id_fkey"
            columns: ["ref_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_carts: {
        Row: {
          expires_at: string
          items: Json
          kitchen_notes: string | null
          restaurant_id: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          expires_at?: string
          items?: Json
          kitchen_notes?: string | null
          restaurant_id?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          expires_at?: string
          items?: Json
          kitchen_notes?: string | null
          restaurant_id?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "customer_carts_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "ranking_integrity_audit"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "customer_carts_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_carts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_credit_balance: {
        Row: {
          balance_egp: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance_egp?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance_egp?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_credit_balance_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_loyalty: {
        Row: {
          points_balance: number
          points_rolling_12mo: number
          tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          points_balance?: number
          points_rolling_12mo?: number
          tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          points_balance?: number
          points_rolling_12mo?: number
          tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_loyalty_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_customer_pilot_access: {
        Row: {
          expires_at: string | null
          granted_at: string
          granted_by: string | null
          id: string
          reason: string | null
          revoked_at: string | null
          service_area_id: string
          status: string
          user_id: string
        }
        Insert: {
          expires_at?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          reason?: string | null
          revoked_at?: string | null
          service_area_id: string
          status?: string
          user_id: string
        }
        Update: {
          expires_at?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          reason?: string | null
          revoked_at?: string | null
          service_area_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_customer_pilot_access_service_area_id_fkey"
            columns: ["service_area_id"]
            isOneToOne: false
            referencedRelation: "service_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_customer_pilot_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_driver_pilot_access: {
        Row: {
          driver_id: string
          expires_at: string | null
          granted_at: string
          granted_by: string | null
          id: string
          reason: string | null
          revoked_at: string | null
          service_area_id: string
          status: string
        }
        Insert: {
          driver_id: string
          expires_at?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          reason?: string | null
          revoked_at?: string | null
          service_area_id: string
          status?: string
        }
        Update: {
          driver_id?: string
          expires_at?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          reason?: string | null
          revoked_at?: string | null
          service_area_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_driver_pilot_access_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_cash_balance"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "delivery_driver_pilot_access_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_driver_pilot_access_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "public_drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_driver_pilot_access_service_area_id_fkey"
            columns: ["service_area_id"]
            isOneToOne: false
            referencedRelation: "service_areas"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_fee_rules: {
        Row: {
          base_fee: number
          created_at: string
          free_over: number | null
          id: string
          min_fee: number
          per_km_fee: number
          vertical_id: string | null
          zone_id: Database["public"]["Enums"]["zone_type"] | null
        }
        Insert: {
          base_fee?: number
          created_at?: string
          free_over?: number | null
          id?: string
          min_fee?: number
          per_km_fee?: number
          vertical_id?: string | null
          zone_id?: Database["public"]["Enums"]["zone_type"] | null
        }
        Update: {
          base_fee?: number
          created_at?: string
          free_over?: number | null
          id?: string
          min_fee?: number
          per_km_fee?: number
          vertical_id?: string | null
          zone_id?: Database["public"]["Enums"]["zone_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_fee_rules_vertical_id_fkey"
            columns: ["vertical_id"]
            isOneToOne: false
            referencedRelation: "verticals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_fee_rules_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_merchant_pilot_access: {
        Row: {
          expires_at: string | null
          granted_at: string
          granted_by: string | null
          id: string
          reason: string | null
          restaurant_id: string
          revoked_at: string | null
          service_area_id: string
          status: string
        }
        Insert: {
          expires_at?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          reason?: string | null
          restaurant_id: string
          revoked_at?: string | null
          service_area_id: string
          status?: string
        }
        Update: {
          expires_at?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          reason?: string | null
          restaurant_id?: string
          revoked_at?: string | null
          service_area_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_merchant_pilot_access_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "ranking_integrity_audit"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "delivery_merchant_pilot_access_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_merchant_pilot_access_service_area_id_fkey"
            columns: ["service_area_id"]
            isOneToOne: false
            referencedRelation: "service_areas"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_parcel_bands: {
        Row: {
          band_code: string
          max_declared_value_egp: number
          max_weight_kg: number
          policy_version_id: string
        }
        Insert: {
          band_code: string
          max_declared_value_egp: number
          max_weight_kg: number
          policy_version_id: string
        }
        Update: {
          band_code?: string
          max_declared_value_egp?: number
          max_weight_kg?: number
          policy_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_parcel_bands_policy_version_id_fkey"
            columns: ["policy_version_id"]
            isOneToOne: false
            referencedRelation: "delivery_parcel_policy_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_parcel_categories: {
        Row: {
          category: string
          is_allowed: boolean
          policy_version_id: string
        }
        Insert: {
          category: string
          is_allowed: boolean
          policy_version_id: string
        }
        Update: {
          category?: string
          is_allowed?: boolean
          policy_version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_parcel_categories_policy_version_id_fkey"
            columns: ["policy_version_id"]
            isOneToOne: false
            referencedRelation: "delivery_parcel_policy_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_parcel_policy_versions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          id: string
          prohibited_goods_version: string
          status: string
          terms_version: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          prohibited_goods_version: string
          status?: string
          terms_version: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          id?: string
          prohibited_goods_version?: string
          status?: string
          terms_version?: string
        }
        Relationships: []
      }
      delivery_pricing_versions: {
        Row: {
          active_from: string | null
          approved_by: string | null
          base_fee_egp: number
          created_at: string
          currency: string
          distance_multiplier: number
          driver_base_earning_egp: number
          driver_per_started_km_egp: number
          id: string
          included_distance_m: number
          max_fee_egp: number
          min_fee_egp: number
          per_started_km_egp: number
          retired_at: string | null
          service_area_id: string
          status: string
        }
        Insert: {
          active_from?: string | null
          approved_by?: string | null
          base_fee_egp: number
          created_at?: string
          currency?: string
          distance_multiplier?: number
          driver_base_earning_egp: number
          driver_per_started_km_egp?: number
          id?: string
          included_distance_m?: number
          max_fee_egp: number
          min_fee_egp: number
          per_started_km_egp: number
          retired_at?: string | null
          service_area_id: string
          status?: string
        }
        Update: {
          active_from?: string | null
          approved_by?: string | null
          base_fee_egp?: number
          created_at?: string
          currency?: string
          distance_multiplier?: number
          driver_base_earning_egp?: number
          driver_per_started_km_egp?: number
          id?: string
          included_distance_m?: number
          max_fee_egp?: number
          min_fee_egp?: number
          per_started_km_egp?: number
          retired_at?: string | null
          service_area_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_pricing_versions_service_area_id_fkey"
            columns: ["service_area_id"]
            isOneToOne: false
            referencedRelation: "service_areas"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_service_configs: {
        Row: {
          default_merchant_exposure_limit_egp: number
          default_merchant_unsettled_job_limit: number
          driver_location_max_age_seconds: number
          intake_state: string
          launch_stage: string
          max_active_jobs_per_driver: number
          minimum_customer_build: number | null
          minimum_driver_build: number | null
          minimum_merchant_build: number | null
          offer_ttl_seconds: number
          otp_max_attempts: number
          otp_ttl_seconds: number
          parcel_policy_version_id: string | null
          payment_recovery_window_seconds: number
          pricing_version_id: string | null
          quote_ttl_seconds: number
          scheduling_enabled: boolean
          service_area_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          default_merchant_exposure_limit_egp?: number
          default_merchant_unsettled_job_limit?: number
          driver_location_max_age_seconds?: number
          intake_state?: string
          launch_stage?: string
          max_active_jobs_per_driver?: number
          minimum_customer_build?: number | null
          minimum_driver_build?: number | null
          minimum_merchant_build?: number | null
          offer_ttl_seconds?: number
          otp_max_attempts?: number
          otp_ttl_seconds?: number
          parcel_policy_version_id?: string | null
          payment_recovery_window_seconds?: number
          pricing_version_id?: string | null
          quote_ttl_seconds?: number
          scheduling_enabled?: boolean
          service_area_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          default_merchant_exposure_limit_egp?: number
          default_merchant_unsettled_job_limit?: number
          driver_location_max_age_seconds?: number
          intake_state?: string
          launch_stage?: string
          max_active_jobs_per_driver?: number
          minimum_customer_build?: number | null
          minimum_driver_build?: number | null
          minimum_merchant_build?: number | null
          offer_ttl_seconds?: number
          otp_max_attempts?: number
          otp_ttl_seconds?: number
          parcel_policy_version_id?: string | null
          payment_recovery_window_seconds?: number
          pricing_version_id?: string | null
          quote_ttl_seconds?: number
          scheduling_enabled?: boolean
          service_area_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_service_configs_service_area_id_fkey"
            columns: ["service_area_id"]
            isOneToOne: true
            referencedRelation: "service_areas"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_applications: {
        Row: {
          city: string | null
          created_at: string
          full_name: string
          id: string
          note: string | null
          phone: string
          provisioned_driver_id: string | null
          status: string
          vehicle: Database["public"]["Enums"]["vehicle_type"]
        }
        Insert: {
          city?: string | null
          created_at?: string
          full_name: string
          id?: string
          note?: string | null
          phone: string
          provisioned_driver_id?: string | null
          status?: string
          vehicle?: Database["public"]["Enums"]["vehicle_type"]
        }
        Update: {
          city?: string | null
          created_at?: string
          full_name?: string
          id?: string
          note?: string | null
          phone?: string
          provisioned_driver_id?: string | null
          status?: string
          vehicle?: Database["public"]["Enums"]["vehicle_type"]
        }
        Relationships: [
          {
            foreignKeyName: "driver_applications_provisioned_driver_id_fkey"
            columns: ["provisioned_driver_id"]
            isOneToOne: false
            referencedRelation: "driver_cash_balance"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "driver_applications_provisioned_driver_id_fkey"
            columns: ["provisioned_driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_applications_provisioned_driver_id_fkey"
            columns: ["provisioned_driver_id"]
            isOneToOne: false
            referencedRelation: "public_drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_cash_ledger: {
        Row: {
          actor_id: string | null
          created_at: string
          delta_egp: number
          driver_id: string
          id: string
          note: string | null
          reason: string
          ref_order_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          delta_egp: number
          driver_id: string
          id?: string
          note?: string | null
          reason: string
          ref_order_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          delta_egp?: number
          driver_id?: string
          id?: string
          note?: string | null
          reason?: string
          ref_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_cash_ledger_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_cash_balance"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "driver_cash_ledger_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_cash_ledger_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "public_drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_cash_ledger_ref_order_id_fkey"
            columns: ["ref_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_cod_limit_events: {
        Row: {
          created_at: string
          driver_id: string
          hard_limit_egp: number
          held_egp: number
          id: string
          mode: string
          order_id: string | null
          outcome: string
          prospective_egp: number
          soft_limit_egp: number
        }
        Insert: {
          created_at?: string
          driver_id: string
          hard_limit_egp: number
          held_egp: number
          id?: string
          mode: string
          order_id?: string | null
          outcome: string
          prospective_egp: number
          soft_limit_egp: number
        }
        Update: {
          created_at?: string
          driver_id?: string
          hard_limit_egp?: number
          held_egp?: number
          id?: string
          mode?: string
          order_id?: string | null
          outcome?: string
          prospective_egp?: number
          soft_limit_egp?: number
        }
        Relationships: [
          {
            foreignKeyName: "driver_cod_limit_events_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_cash_balance"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "driver_cod_limit_events_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_cod_limit_events_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "public_drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_cod_limit_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_cod_overrides: {
        Row: {
          created_at: string
          driver_id: string
          expires_at: string
          granted_by: string
          id: string
          reason: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          expires_at: string
          granted_by: string
          id?: string
          reason: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          expires_at?: string
          granted_by?: string
          id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_cod_overrides_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_cash_balance"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "driver_cod_overrides_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_cod_overrides_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "public_drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_cod_overrides_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_earnings: {
        Row: {
          bonus: number
          cod_collected: number
          created_at: string
          delivery_fee_share: number
          driver_id: string
          id: string
          order_id: string
          payout_batch_id: string | null
          tip: number
          total: number
        }
        Insert: {
          bonus?: number
          cod_collected?: number
          created_at?: string
          delivery_fee_share?: number
          driver_id: string
          id?: string
          order_id: string
          payout_batch_id?: string | null
          tip?: number
          total?: number
        }
        Update: {
          bonus?: number
          cod_collected?: number
          created_at?: string
          delivery_fee_share?: number
          driver_id?: string
          id?: string
          order_id?: string
          payout_batch_id?: string | null
          tip?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "driver_earnings_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_cash_balance"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "driver_earnings_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_earnings_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "public_drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_earnings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_loyalty: {
        Row: {
          acceptance_rate_snapshot: number
          bonus_per_delivery_egp: number
          deliveries_rolling_90d: number
          driver_id: string
          first_look_seconds: number
          rating_snapshot: number
          tier: string
          updated_at: string
        }
        Insert: {
          acceptance_rate_snapshot?: number
          bonus_per_delivery_egp?: number
          deliveries_rolling_90d?: number
          driver_id: string
          first_look_seconds?: number
          rating_snapshot?: number
          tier?: string
          updated_at?: string
        }
        Update: {
          acceptance_rate_snapshot?: number
          bonus_per_delivery_egp?: number
          deliveries_rolling_90d?: number
          driver_id?: string
          first_look_seconds?: number
          rating_snapshot?: number
          tier?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_loyalty_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: true
            referencedRelation: "driver_cash_balance"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "driver_loyalty_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: true
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_loyalty_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: true
            referencedRelation: "public_drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_settlements: {
        Row: {
          cod_collected_egp: number
          created_at: string
          delivery_count: number
          driver_id: string
          gross_earnings_egp: number
          id: string
          net_payable_egp: number
          paid_at: string | null
          paid_reference: string | null
          period_end: string
          period_start: string
          status: string
          updated_at: string
        }
        Insert: {
          cod_collected_egp?: number
          created_at?: string
          delivery_count?: number
          driver_id: string
          gross_earnings_egp?: number
          id?: string
          net_payable_egp?: number
          paid_at?: string | null
          paid_reference?: string | null
          period_end: string
          period_start: string
          status?: string
          updated_at?: string
        }
        Update: {
          cod_collected_egp?: number
          created_at?: string
          delivery_count?: number
          driver_id?: string
          gross_earnings_egp?: number
          id?: string
          net_payable_egp?: number
          paid_at?: string | null
          paid_reference?: string | null
          period_end?: string
          period_start?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_settlements_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_cash_balance"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "driver_settlements_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_settlements_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "public_drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          created_at: string
          current_geo: unknown
          home_zone: Database["public"]["Enums"]["zone_type"] | null
          id: string
          is_active: boolean
          is_verified: boolean
          last_ping_at: string | null
          name: string
          payout_bank_name: string | null
          payout_holder: string | null
          payout_iban: string | null
          payout_method: string | null
          payout_wallet: string | null
          phone: string
          photo: string
          plate: string
          profile_id: string | null
          rating: number
          status: string
          updated_at: string
          vehicle: Database["public"]["Enums"]["vehicle_type"]
        }
        Insert: {
          created_at?: string
          current_geo?: unknown
          home_zone?: Database["public"]["Enums"]["zone_type"] | null
          id?: string
          is_active?: boolean
          is_verified?: boolean
          last_ping_at?: string | null
          name: string
          payout_bank_name?: string | null
          payout_holder?: string | null
          payout_iban?: string | null
          payout_method?: string | null
          payout_wallet?: string | null
          phone?: string
          photo?: string
          plate?: string
          profile_id?: string | null
          rating?: number
          status?: string
          updated_at?: string
          vehicle?: Database["public"]["Enums"]["vehicle_type"]
        }
        Update: {
          created_at?: string
          current_geo?: unknown
          home_zone?: Database["public"]["Enums"]["zone_type"] | null
          id?: string
          is_active?: boolean
          is_verified?: boolean
          last_ping_at?: string | null
          name?: string
          payout_bank_name?: string | null
          payout_holder?: string | null
          payout_iban?: string | null
          payout_method?: string | null
          payout_wallet?: string | null
          phone?: string
          photo?: string
          plate?: string
          profile_id?: string | null
          rating?: number
          status?: string
          updated_at?: string
          vehicle?: Database["public"]["Enums"]["vehicle_type"]
        }
        Relationships: [
          {
            foreignKeyName: "drivers_home_zone_fkey"
            columns: ["home_zone"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drivers_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      e0_slice_provenance: {
        Row: {
          applied_at: string
          applied_thru: number
          slice: string
        }
        Insert: {
          applied_at?: string
          applied_thru: number
          slice: string
        }
        Update: {
          applied_at?: string
          applied_thru?: number
          slice?: string
        }
        Relationships: []
      }
      favorite_items: {
        Row: {
          created_at: string
          menu_item_id: string
          restaurant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          menu_item_id: string
          restaurant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          menu_item_id?: string
          restaurant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorite_items_item_fk"
            columns: ["menu_item_id", "restaurant_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id", "restaurant_id"]
          },
          {
            foreignKeyName: "favorite_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          created_at: string
          restaurant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          restaurant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          restaurant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "ranking_integrity_audit"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "favorites_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      fx_rates: {
        Row: {
          actor_id: string | null
          base_currency: string
          created_at: string
          effective_at: string
          fetched_at: string
          id: string
          note: string | null
          quote_currency: string
          rate: number
          source: string
          stale_after: string
          status: string
        }
        Insert: {
          actor_id?: string | null
          base_currency?: string
          created_at?: string
          effective_at?: string
          fetched_at?: string
          id?: string
          note?: string | null
          quote_currency: string
          rate: number
          source: string
          stale_after: string
          status?: string
        }
        Update: {
          actor_id?: string | null
          base_currency?: string
          created_at?: string
          effective_at?: string
          fetched_at?: string
          id?: string
          note?: string | null
          quote_currency?: string
          rate?: number
          source?: string
          stale_after?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "fx_rates_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      hotels: {
        Row: {
          brand: string | null
          created_at: string
          id: string
          name: string
          reception_phone: string
          verified: boolean
          zone: Database["public"]["Enums"]["zone_type"]
        }
        Insert: {
          brand?: string | null
          created_at?: string
          id?: string
          name: string
          reception_phone: string
          verified?: boolean
          zone: Database["public"]["Enums"]["zone_type"]
        }
        Update: {
          brand?: string | null
          created_at?: string
          id?: string
          name?: string
          reception_phone?: string
          verified?: boolean
          zone?: Database["public"]["Enums"]["zone_type"]
        }
        Relationships: [
          {
            foreignKeyName: "hotels_zone_fkey"
            columns: ["zone"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchens: {
        Row: {
          address: string | null
          created_at: string
          geo: unknown
          id: string
          is_active: boolean
          lease_end: string | null
          lease_start: string | null
          monthly_rent_egp: number
          name: string
          notes: string | null
          slug: string
          updated_at: string
          zone: Database["public"]["Enums"]["zone_type"]
        }
        Insert: {
          address?: string | null
          created_at?: string
          geo?: unknown
          id?: string
          is_active?: boolean
          lease_end?: string | null
          lease_start?: string | null
          monthly_rent_egp?: number
          name: string
          notes?: string | null
          slug: string
          updated_at?: string
          zone: Database["public"]["Enums"]["zone_type"]
        }
        Update: {
          address?: string | null
          created_at?: string
          geo?: unknown
          id?: string
          is_active?: boolean
          lease_end?: string | null
          lease_start?: string | null
          monthly_rent_egp?: number
          name?: string
          notes?: string | null
          slug?: string
          updated_at?: string
          zone?: Database["public"]["Enums"]["zone_type"]
        }
        Relationships: [
          {
            foreignKeyName: "kitchens_zone_fkey"
            columns: ["zone"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      kyc_documents: {
        Row: {
          created_at: string
          doc_type: string
          id: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["kyc_doc_status"]
          storage_path: string
          subject_id: string
          subject_type: Database["public"]["Enums"]["kyc_subject_type"]
        }
        Insert: {
          created_at?: string
          doc_type: string
          id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["kyc_doc_status"]
          storage_path: string
          subject_id: string
          subject_type: Database["public"]["Enums"]["kyc_subject_type"]
        }
        Update: {
          created_at?: string
          doc_type?: string
          id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["kyc_doc_status"]
          storage_path?: string
          subject_id?: string
          subject_type?: Database["public"]["Enums"]["kyc_subject_type"]
        }
        Relationships: [
          {
            foreignKeyName: "kyc_documents_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      lifecycle_sends: {
        Row: {
          decided_at: string
          holdout_group: string
          id: string
          lifecycle_event: string
          message_id: string | null
          mode: string
          subject_id: string | null
          suppression_reason: string | null
          user_id: string
          would_send: boolean
        }
        Insert: {
          decided_at?: string
          holdout_group: string
          id?: string
          lifecycle_event: string
          message_id?: string | null
          mode: string
          subject_id?: string | null
          suppression_reason?: string | null
          user_id: string
          would_send: boolean
        }
        Update: {
          decided_at?: string
          holdout_group?: string
          id?: string
          lifecycle_event?: string
          message_id?: string | null
          mode?: string
          subject_id?: string | null
          suppression_reason?: string | null
          user_id?: string
          would_send?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "lifecycle_sends_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "push_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lifecycle_sends_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_points_ledger: {
        Row: {
          created_at: string
          delta_points: number
          id: string
          reason: string
          ref_order_id: string | null
          subject_id: string
          subject_type: string
        }
        Insert: {
          created_at?: string
          delta_points: number
          id?: string
          reason: string
          ref_order_id?: string | null
          subject_id: string
          subject_type: string
        }
        Update: {
          created_at?: string
          delta_points?: number
          id?: string
          reason?: string
          ref_order_id?: string | null
          subject_id?: string
          subject_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_points_ledger_ref_order_id_fkey"
            columns: ["ref_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_availability_events: {
        Row: {
          actor_user_id: string | null
          changed_at: string
          id: string
          idempotency_key: string | null
          menu_item_id: string
          new_available: boolean
          previous_available: boolean | null
          reason_code: string | null
          restaurant_id: string
          source: string
        }
        Insert: {
          actor_user_id?: string | null
          changed_at?: string
          id?: string
          idempotency_key?: string | null
          menu_item_id: string
          new_available: boolean
          previous_available?: boolean | null
          reason_code?: string | null
          restaurant_id: string
          source?: string
        }
        Update: {
          actor_user_id?: string | null
          changed_at?: string
          id?: string
          idempotency_key?: string | null
          menu_item_id?: string
          new_available?: boolean
          previous_available?: boolean | null
          reason_code?: string | null
          restaurant_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_availability_events_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          barcode: string | null
          created_at: string
          description: string
          flags: Database["public"]["Enums"]["item_flag_type"][]
          id: string
          image: string
          is_available: boolean
          name: string
          price_egp: number
          requires_prescription: boolean
          restaurant_id: string
          section_id: string
          sku: string | null
          sort_order: number
          unit: string | null
        }
        Insert: {
          barcode?: string | null
          created_at?: string
          description?: string
          flags?: Database["public"]["Enums"]["item_flag_type"][]
          id?: string
          image?: string
          is_available?: boolean
          name: string
          price_egp: number
          requires_prescription?: boolean
          restaurant_id: string
          section_id: string
          sku?: string | null
          sort_order?: number
          unit?: string | null
        }
        Update: {
          barcode?: string | null
          created_at?: string
          description?: string
          flags?: Database["public"]["Enums"]["item_flag_type"][]
          id?: string
          image?: string
          is_available?: boolean
          name?: string
          price_egp?: number
          requires_prescription?: boolean
          restaurant_id?: string
          section_id?: string
          sku?: string | null
          sort_order?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "ranking_integrity_audit"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "menu_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "menu_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_sections: {
        Row: {
          id: string
          name: string
          restaurant_id: string
          sort_order: number
        }
        Insert: {
          id?: string
          name: string
          restaurant_id: string
          sort_order?: number
        }
        Update: {
          id?: string
          name?: string
          restaurant_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_sections_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "ranking_integrity_audit"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "menu_sections_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_staff: {
        Row: {
          created_at: string
          profile_id: string
          restaurant_id: string
          staff_role: string
        }
        Insert: {
          created_at?: string
          profile_id: string
          restaurant_id: string
          staff_role?: string
        }
        Update: {
          created_at?: string
          profile_id?: string
          restaurant_id?: string
          staff_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_staff_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "merchant_staff_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "ranking_integrity_audit"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "merchant_staff_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_vertical_events: {
        Row: {
          actor_user_id: string | null
          id: string
          new_vertical_id: string
          occurred_at: string
          previous_vertical_id: string | null
          reason: string
          restaurant_id: string
        }
        Insert: {
          actor_user_id?: string | null
          id?: string
          new_vertical_id: string
          occurred_at?: string
          previous_vertical_id?: string | null
          reason: string
          restaurant_id: string
        }
        Update: {
          actor_user_id?: string | null
          id?: string
          new_vertical_id?: string
          occurred_at?: string
          previous_vertical_id?: string | null
          reason?: string
          restaurant_id?: string
        }
        Relationships: []
      }
      modifier_options: {
        Row: {
          adds_flags: Database["public"]["Enums"]["item_flag_type"][] | null
          icon: string | null
          id: string
          image: string | null
          is_default: boolean
          modifier_id: string
          name: string
          popular: boolean
          price_delta_egp: number
          sort_order: number
          subtitle: string | null
        }
        Insert: {
          adds_flags?: Database["public"]["Enums"]["item_flag_type"][] | null
          icon?: string | null
          id?: string
          image?: string | null
          is_default?: boolean
          modifier_id: string
          name: string
          popular?: boolean
          price_delta_egp?: number
          sort_order?: number
          subtitle?: string | null
        }
        Update: {
          adds_flags?: Database["public"]["Enums"]["item_flag_type"][] | null
          icon?: string | null
          id?: string
          image?: string | null
          is_default?: boolean
          modifier_id?: string
          name?: string
          popular?: boolean
          price_delta_egp?: number
          sort_order?: number
          subtitle?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "modifier_options_modifier_id_fkey"
            columns: ["modifier_id"]
            isOneToOne: false
            referencedRelation: "modifiers"
            referencedColumns: ["id"]
          },
        ]
      }
      modifiers: {
        Row: {
          id: string
          item_id: string
          max_select: number
          min_select: number
          name: string
          required: boolean
          sort_order: number
          step: number | null
          style: string | null
          subtitle: string | null
        }
        Insert: {
          id?: string
          item_id: string
          max_select?: number
          min_select?: number
          name: string
          required?: boolean
          sort_order?: number
          step?: number | null
          style?: string | null
          subtitle?: string | null
        }
        Update: {
          id?: string
          item_id?: string
          max_select?: number
          min_select?: number
          name?: string
          required?: boolean
          sort_order?: number
          step?: number | null
          style?: string | null
          subtitle?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "modifiers_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_consent_events: {
        Row: {
          actor_id: string | null
          channel: string
          created_at: string
          granted: boolean
          id: string
          policy_version: string
          source: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          channel: string
          created_at?: string
          granted: boolean
          id?: string
          policy_version?: string
          source: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          channel?: string
          created_at?: string
          granted?: boolean
          id?: string
          policy_version?: string
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_consent_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_consent_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_prefs: {
        Row: {
          marketing: boolean
          marketing_consent_at: string | null
          marketing_consent_source: string | null
          quiet_hours_end: number | null
          quiet_hours_start: number | null
          timezone: string
          transactional: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          marketing?: boolean
          marketing_consent_at?: string | null
          marketing_consent_source?: string | null
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          timezone?: string
          transactional?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          marketing?: boolean
          marketing_consent_at?: string | null
          marketing_consent_source?: string | null
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          timezone?: string
          transactional?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_reads: {
        Row: {
          message_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          message_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          message_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_reads_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "push_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      order_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string
          assigned_by_id: string | null
          driver_id: string
          id: string
          offer_expires_at: string | null
          order_id: string
          responded_at: string | null
          status: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string
          assigned_by_id?: string | null
          driver_id: string
          id?: string
          offer_expires_at?: string | null
          order_id: string
          responded_at?: string | null
          status?: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          assigned_by_id?: string | null
          driver_id?: string
          id?: string
          offer_expires_at?: string | null
          order_id?: string
          responded_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_assignments_assigned_by_id_fkey"
            columns: ["assigned_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_assignments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "driver_cash_balance"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "order_assignments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_assignments_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "public_drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_assignments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_financials: {
        Row: {
          commission_egp: number
          commission_pct: number
          commission_vat_egp: number
          created_at: string
          delivered_at: string
          delivery_fee_egp: number
          discount_egp: number
          order_id: string
          payment_method: string
          restaurant_id: string
          subtotal_egp: number
        }
        Insert: {
          commission_egp: number
          commission_pct: number
          commission_vat_egp?: number
          created_at?: string
          delivered_at: string
          delivery_fee_egp?: number
          discount_egp?: number
          order_id: string
          payment_method: string
          restaurant_id: string
          subtotal_egp: number
        }
        Update: {
          commission_egp?: number
          commission_pct?: number
          commission_vat_egp?: number
          created_at?: string
          delivered_at?: string
          delivery_fee_egp?: number
          discount_egp?: number
          order_id?: string
          payment_method?: string
          restaurant_id?: string
          subtotal_egp?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_financials_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_financials_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "ranking_integrity_audit"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "order_financials_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_financials_failures: {
        Row: {
          failed_at: string
          message: string | null
          order_id: string
          resolved_at: string | null
          sqlstate: string | null
        }
        Insert: {
          failed_at?: string
          message?: string | null
          order_id: string
          resolved_at?: string | null
          sqlstate?: string | null
        }
        Update: {
          failed_at?: string
          message?: string | null
          order_id?: string
          resolved_at?: string | null
          sqlstate?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_financials_failures_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          barcode_snapshot: string | null
          catalog_item_id: string | null
          created_at: string
          id: string
          line_total: number
          modifiers_snapshot: Json
          name_snapshot: string
          notes: string | null
          order_id: string
          quantity: number
          requires_prescription_snapshot: boolean | null
          sku_snapshot: string | null
          unit_price_snapshot: number
          unit_snapshot: string | null
        }
        Insert: {
          barcode_snapshot?: string | null
          catalog_item_id?: string | null
          created_at?: string
          id?: string
          line_total: number
          modifiers_snapshot?: Json
          name_snapshot: string
          notes?: string | null
          order_id: string
          quantity: number
          requires_prescription_snapshot?: boolean | null
          sku_snapshot?: string | null
          unit_price_snapshot: number
          unit_snapshot?: string | null
        }
        Update: {
          barcode_snapshot?: string | null
          catalog_item_id?: string | null
          created_at?: string
          id?: string
          line_total?: number
          modifiers_snapshot?: Json
          name_snapshot?: string
          notes?: string | null
          order_id?: string
          quantity?: number
          requires_prescription_snapshot?: boolean | null
          sku_snapshot?: string | null
          unit_price_snapshot?: number
          unit_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          order_id: string
          read_at: string | null
          sender_id: string | null
          sender_role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          order_id: string
          read_at?: string | null
          sender_id?: string | null
          sender_role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          order_id?: string
          read_at?: string | null
          sender_id?: string | null
          sender_role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "order_messages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      order_refunds: {
        Row: {
          actor_id: string | null
          amount_egp: number
          created_at: string
          id: string
          order_id: string
          provider_detail: Json | null
          provider_ref: string | null
          reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          actor_id?: string | null
          amount_egp: number
          created_at?: string
          id?: string
          order_id: string
          provider_detail?: Json | null
          provider_ref?: string | null
          reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          actor_id?: string | null
          amount_egp?: number
          created_at?: string
          id?: string
          order_id?: string
          provider_detail?: Json | null
          provider_ref?: string | null
          reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_events: {
        Row: {
          actor_id: string | null
          actor_role: Database["public"]["Enums"]["app_role"] | null
          created_at: string
          id: string
          note: string | null
          order_id: string
          status: Database["public"]["Enums"]["order_status_type"]
        }
        Insert: {
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["app_role"] | null
          created_at?: string
          id?: string
          note?: string | null
          order_id: string
          status: Database["public"]["Enums"]["order_status_type"]
        }
        Update: {
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["app_role"] | null
          created_at?: string
          id?: string
          note?: string | null
          order_id?: string
          status?: Database["public"]["Enums"]["order_status_type"]
        }
        Relationships: [
          {
            foreignKeyName: "order_status_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          accepted_at: string | null
          acquisition_touch_id: string | null
          address_id: string | null
          address_snapshot: Json
          aggregate_allergens:
            | Database["public"]["Enums"]["allergy_key_type"][]
            | null
          anonymized_at: string | null
          assigned_driver_id: string | null
          cancel_reason: string | null
          commission_pct_snapshot: number | null
          customer_phone: string | null
          deleted_user_ref: string | null
          delivered_at: string | null
          delivery_fee_egp: number
          discount_egp: number
          dispatch_eligible_at: string | null
          dispatch_mode: string | null
          dropoff_geo: unknown
          dropoff_note: string | null
          dropoff_preference:
            | Database["public"]["Enums"]["dropoff_preference"]
            | null
          eta_at: string
          fulfillment_type: string
          history: Json
          id: string
          idempotency_key: string | null
          items: Json
          kitchen_notes: string | null
          payment_label: string
          payment_method: string
          payment_method_kind: Database["public"]["Enums"]["payment_kind_type"]
          payment_status: string
          paymob_order_ref: string | null
          paymob_txn_id: string | null
          picked_up_at: string | null
          placed_at: string
          promo_code: string | null
          rating_comment: string | null
          rating_delivery: number | null
          rating_food: number | null
          ready_at: string | null
          restaurant_id: string
          restaurant_name: string
          rider: Json | null
          scheduled_for: string | null
          service_fee_egp: number
          short_code: string
          sla_minutes: number
          small_order_fee_egp: number
          status: Database["public"]["Enums"]["order_status_type"]
          subtotal_egp: number
          tax_egp: number
          tip_egp: number
          total_egp: number
          updated_at: string
          user_id: string | null
          vertical_id: string
          zone: Database["public"]["Enums"]["zone_type"] | null
        }
        Insert: {
          accepted_at?: string | null
          acquisition_touch_id?: string | null
          address_id?: string | null
          address_snapshot: Json
          aggregate_allergens?:
            | Database["public"]["Enums"]["allergy_key_type"][]
            | null
          anonymized_at?: string | null
          assigned_driver_id?: string | null
          cancel_reason?: string | null
          commission_pct_snapshot?: number | null
          customer_phone?: string | null
          deleted_user_ref?: string | null
          delivered_at?: string | null
          delivery_fee_egp: number
          discount_egp?: number
          dispatch_eligible_at?: string | null
          dispatch_mode?: string | null
          dropoff_geo?: unknown
          dropoff_note?: string | null
          dropoff_preference?:
            | Database["public"]["Enums"]["dropoff_preference"]
            | null
          eta_at: string
          fulfillment_type?: string
          history?: Json
          id?: string
          idempotency_key?: string | null
          items: Json
          kitchen_notes?: string | null
          payment_label: string
          payment_method?: string
          payment_method_kind: Database["public"]["Enums"]["payment_kind_type"]
          payment_status?: string
          paymob_order_ref?: string | null
          paymob_txn_id?: string | null
          picked_up_at?: string | null
          placed_at?: string
          promo_code?: string | null
          rating_comment?: string | null
          rating_delivery?: number | null
          rating_food?: number | null
          ready_at?: string | null
          restaurant_id: string
          restaurant_name: string
          rider?: Json | null
          scheduled_for?: string | null
          service_fee_egp?: number
          short_code: string
          sla_minutes?: number
          small_order_fee_egp?: number
          status?: Database["public"]["Enums"]["order_status_type"]
          subtotal_egp: number
          tax_egp: number
          tip_egp?: number
          total_egp: number
          updated_at?: string
          user_id?: string | null
          vertical_id?: string
          zone?: Database["public"]["Enums"]["zone_type"] | null
        }
        Update: {
          accepted_at?: string | null
          acquisition_touch_id?: string | null
          address_id?: string | null
          address_snapshot?: Json
          aggregate_allergens?:
            | Database["public"]["Enums"]["allergy_key_type"][]
            | null
          anonymized_at?: string | null
          assigned_driver_id?: string | null
          cancel_reason?: string | null
          commission_pct_snapshot?: number | null
          customer_phone?: string | null
          deleted_user_ref?: string | null
          delivered_at?: string | null
          delivery_fee_egp?: number
          discount_egp?: number
          dispatch_eligible_at?: string | null
          dispatch_mode?: string | null
          dropoff_geo?: unknown
          dropoff_note?: string | null
          dropoff_preference?:
            | Database["public"]["Enums"]["dropoff_preference"]
            | null
          eta_at?: string
          fulfillment_type?: string
          history?: Json
          id?: string
          idempotency_key?: string | null
          items?: Json
          kitchen_notes?: string | null
          payment_label?: string
          payment_method?: string
          payment_method_kind?: Database["public"]["Enums"]["payment_kind_type"]
          payment_status?: string
          paymob_order_ref?: string | null
          paymob_txn_id?: string | null
          picked_up_at?: string | null
          placed_at?: string
          promo_code?: string | null
          rating_comment?: string | null
          rating_delivery?: number | null
          rating_food?: number | null
          ready_at?: string | null
          restaurant_id?: string
          restaurant_name?: string
          rider?: Json | null
          scheduled_for?: string | null
          service_fee_egp?: number
          short_code?: string
          sla_minutes?: number
          small_order_fee_egp?: number
          status?: Database["public"]["Enums"]["order_status_type"]
          subtotal_egp?: number
          tax_egp?: number
          tip_egp?: number
          total_egp?: number
          updated_at?: string
          user_id?: string | null
          vertical_id?: string
          zone?: Database["public"]["Enums"]["zone_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_acquisition_touch_id_fkey"
            columns: ["acquisition_touch_id"]
            isOneToOne: false
            referencedRelation: "acquisition_touches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_assigned_driver_id_fkey"
            columns: ["assigned_driver_id"]
            isOneToOne: false
            referencedRelation: "driver_cash_balance"
            referencedColumns: ["driver_id"]
          },
          {
            foreignKeyName: "orders_assigned_driver_id_fkey"
            columns: ["assigned_driver_id"]
            isOneToOne: false
            referencedRelation: "drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_assigned_driver_id_fkey"
            columns: ["assigned_driver_id"]
            isOneToOne: false
            referencedRelation: "public_drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "ranking_integrity_audit"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_zone_fkey"
            columns: ["zone"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_attempts: {
        Row: {
          amount_egp: number
          checkout_url: string | null
          client_secret: string | null
          created_at: string
          expires_at: string
          id: string
          integration_id: string
          last_error: string | null
          order_id: string
          provider_intention_id: string | null
          provider_order_id: string | null
          provider_txn_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_egp: number
          checkout_url?: string | null
          client_secret?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          integration_id: string
          last_error?: string | null
          order_id: string
          provider_intention_id?: string | null
          provider_order_id?: string | null
          provider_txn_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_egp?: number
          checkout_url?: string | null
          client_secret?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          integration_id?: string
          last_error?: string | null
          order_id?: string
          provider_intention_id?: string | null
          provider_order_id?: string | null
          provider_txn_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_attempts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          card_brand: string | null
          card_exp: string | null
          card_last4: string | null
          created_at: string
          id: string
          instapay_handle: string | null
          is_default: boolean
          kind: Database["public"]["Enums"]["payment_kind_type"]
          label: string
          subline: string
          user_id: string
          vodafone_msisdn: string | null
        }
        Insert: {
          card_brand?: string | null
          card_exp?: string | null
          card_last4?: string | null
          created_at?: string
          id?: string
          instapay_handle?: string | null
          is_default?: boolean
          kind: Database["public"]["Enums"]["payment_kind_type"]
          label: string
          subline?: string
          user_id: string
          vodafone_msisdn?: string | null
        }
        Update: {
          card_brand?: string | null
          card_exp?: string | null
          card_last4?: string | null
          created_at?: string
          id?: string
          instapay_handle?: string | null
          is_default?: boolean
          kind?: Database["public"]["Enums"]["payment_kind_type"]
          label?: string
          subline?: string
          user_id?: string
          vodafone_msisdn?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      promo_codes: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          kind: string
          max_discount_egp: number | null
          max_uses: number | null
          min_subtotal_egp: number | null
          owner_user_id: string | null
          per_user_limit: number | null
          valid_from: string | null
          valid_to: string | null
          value: number
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind: string
          max_discount_egp?: number | null
          max_uses?: number | null
          min_subtotal_egp?: number | null
          owner_user_id?: string | null
          per_user_limit?: number | null
          valid_from?: string | null
          valid_to?: string | null
          value: number
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          max_discount_egp?: number | null
          max_uses?: number | null
          min_subtotal_egp?: number | null
          owner_user_id?: string | null
          per_user_limit?: number | null
          valid_from?: string | null
          valid_to?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "promo_codes_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_redemptions: {
        Row: {
          code: string
          created_at: string
          discount_egp: number
          id: string
          order_id: string
          promo_id: string
          user_id: string | null
        }
        Insert: {
          code: string
          created_at?: string
          discount_egp: number
          id?: string
          order_id: string
          promo_id: string
          user_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          discount_egp?: number
          id?: string
          order_id?: string
          promo_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promo_redemptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_redemptions_promo_id_fkey"
            columns: ["promo_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_redemptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      push_attempts: {
        Row: {
          attempt_no: number
          claimed_at: string | null
          created_at: string
          error_code: string | null
          error_detail: string | null
          expo_ticket_id: string | null
          id: string
          message_id: string
          next_attempt_at: string | null
          push_token_id: string | null
          receipt_checked_at: string | null
          recipient_user_id: string | null
          sent_at: string | null
          settled_at: string | null
          status: string
          token_snapshot: string
        }
        Insert: {
          attempt_no?: number
          claimed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_detail?: string | null
          expo_ticket_id?: string | null
          id?: string
          message_id: string
          next_attempt_at?: string | null
          push_token_id?: string | null
          receipt_checked_at?: string | null
          recipient_user_id?: string | null
          sent_at?: string | null
          settled_at?: string | null
          status?: string
          token_snapshot: string
        }
        Update: {
          attempt_no?: number
          claimed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_detail?: string | null
          expo_ticket_id?: string | null
          id?: string
          message_id?: string
          next_attempt_at?: string | null
          push_token_id?: string | null
          receipt_checked_at?: string | null
          recipient_user_id?: string | null
          sent_at?: string | null
          settled_at?: string | null
          status?: string
          token_snapshot?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_attempts_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "push_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_attempts_push_token_id_fkey"
            columns: ["push_token_id"]
            isOneToOne: false
            referencedRelation: "push_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_attempts_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      push_campaigns: {
        Row: {
          body: string
          created_at: string
          delivery_detail: string | null
          delivery_status: string
          id: string
          idempotency_key: string | null
          net_request_id: number | null
          recipients: number
          segment: string
          segment_param: string | null
          segment_size: number | null
          sent_by: string | null
          settled_at: string | null
          suppressed_blocked: number
          suppressed_count: number
          suppressed_no_consent: number | null
          suppressed_no_token: number | null
          suppressed_quiet_hours: number | null
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          delivery_detail?: string | null
          delivery_status?: string
          id?: string
          idempotency_key?: string | null
          net_request_id?: number | null
          recipients?: number
          segment: string
          segment_param?: string | null
          segment_size?: number | null
          sent_by?: string | null
          settled_at?: string | null
          suppressed_blocked?: number
          suppressed_count?: number
          suppressed_no_consent?: number | null
          suppressed_no_token?: number | null
          suppressed_quiet_hours?: number | null
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          delivery_detail?: string | null
          delivery_status?: string
          id?: string
          idempotency_key?: string | null
          net_request_id?: number | null
          recipients?: number
          segment?: string
          segment_param?: string | null
          segment_size?: number | null
          sent_by?: string | null
          settled_at?: string | null
          suppressed_blocked?: number
          suppressed_count?: number
          suppressed_no_consent?: number | null
          suppressed_no_token?: number | null
          suppressed_quiet_hours?: number | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_campaigns_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      push_messages: {
        Row: {
          campaign_id: string | null
          category: string
          custom_body: string | null
          custom_title: string | null
          event: string
          expires_at: string
          id: string
          idempotency_key: string
          open_count: number
          opened_at: string | null
          order_id: string | null
          queued_at: string
          recipient_user_ids: string[] | null
          retain_until: string
          route: string | null
          settled_at: string | null
          status: string
          suppression_reason: string | null
          vertical: string | null
        }
        Insert: {
          campaign_id?: string | null
          category?: string
          custom_body?: string | null
          custom_title?: string | null
          event: string
          expires_at?: string
          id?: string
          idempotency_key: string
          open_count?: number
          opened_at?: string | null
          order_id?: string | null
          queued_at?: string
          recipient_user_ids?: string[] | null
          retain_until?: string
          route?: string | null
          settled_at?: string | null
          status?: string
          suppression_reason?: string | null
          vertical?: string | null
        }
        Update: {
          campaign_id?: string | null
          category?: string
          custom_body?: string | null
          custom_title?: string | null
          event?: string
          expires_at?: string
          id?: string
          idempotency_key?: string
          open_count?: number
          opened_at?: string | null
          order_id?: string | null
          queued_at?: string
          recipient_user_ids?: string[] | null
          retain_until?: string
          route?: string | null
          settled_at?: string | null
          status?: string
          suppression_reason?: string | null
          vertical?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_messages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      push_tokens: {
        Row: {
          created_at: string
          id: string
          platform: string | null
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          platform?: string | null
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          platform?: string | null
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          code: string
          created_at: string
          friend_discount_egp: number
          id: string
          order_id: string | null
          referred_id: string
          referrer_id: string
          reward_code: string | null
          reward_status: string
          rewarded_at: string | null
        }
        Insert: {
          code: string
          created_at?: string
          friend_discount_egp?: number
          id?: string
          order_id?: string | null
          referred_id: string
          referrer_id: string
          reward_code?: string | null
          reward_status?: string
          rewarded_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          friend_discount_egp?: number
          id?: string
          order_id?: string | null
          referred_id?: string
          referrer_id?: string
          reward_code?: string | null
          reward_status?: string
          rewarded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referrals_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referred_id_fkey"
            columns: ["referred_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_loyalty: {
        Row: {
          commission_discount_pct: number
          orders_rolling_90d: number
          restaurant_id: string
          tier: string
          updated_at: string
        }
        Insert: {
          commission_discount_pct?: number
          orders_rolling_90d?: number
          restaurant_id: string
          tier?: string
          updated_at?: string
        }
        Update: {
          commission_discount_pct?: number
          orders_rolling_90d?: number
          restaurant_id?: string
          tier?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_loyalty_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "ranking_integrity_audit"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "restaurant_loyalty_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_settlements: {
        Row: {
          card_sales_egp: number
          cod_sales_egp: number
          commission_egp: number
          created_at: string
          gross_sales_egp: number
          id: string
          net_payable_egp: number
          order_count: number
          paid_at: string | null
          paid_reference: string | null
          period_end: string
          period_start: string
          restaurant_id: string
          status: string
          updated_at: string
        }
        Insert: {
          card_sales_egp?: number
          cod_sales_egp?: number
          commission_egp?: number
          created_at?: string
          gross_sales_egp?: number
          id?: string
          net_payable_egp?: number
          order_count?: number
          paid_at?: string | null
          paid_reference?: string | null
          period_end: string
          period_start: string
          restaurant_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          card_sales_egp?: number
          cod_sales_egp?: number
          commission_egp?: number
          created_at?: string
          gross_sales_egp?: number
          id?: string
          net_payable_egp?: number
          order_count?: number
          paid_at?: string | null
          paid_reference?: string | null
          period_end?: string
          period_start?: string
          restaurant_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_settlements_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "ranking_integrity_audit"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "restaurant_settlements_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          accepts_card: boolean
          accepts_cash: boolean
          address: string | null
          busy_extra_minutes: number
          busy_until: string | null
          commission_pct: number
          cover_image: string
          created_at: string
          cuisine_label: string
          cuisines: Database["public"]["Enums"]["cuisine_type"][]
          delivery_fee_egp: number
          description: string
          distance_meters: number
          featured: boolean | null
          founding_rate_until: string | null
          fulfillment_type: string
          geo: unknown
          id: string
          is_active: boolean
          is_open: boolean
          is_open_24h: boolean | null
          kitchen_id: string | null
          logo: string | null
          merchant_type: Database["public"]["Enums"]["merchant_type"]
          min_order_egp: number
          name: string
          onboarding_rejection_reason: string | null
          onboarding_status: string
          payout_bank_name: string | null
          payout_holder: string | null
          payout_iban: string | null
          payout_method: string | null
          payout_wallet: string | null
          phone: string | null
          place_id: string | null
          prep_time_high: number
          prep_time_low: number
          promo: string | null
          rating: number
          rating_count: number
          slug: string
          terms_accepted_at: string | null
          terms_version: string | null
          tourist_safe: boolean
          updated_at: string
          vertical_id: string
          website: string | null
          zone: Database["public"]["Enums"]["zone_type"]
        }
        Insert: {
          accepts_card?: boolean
          accepts_cash?: boolean
          address?: string | null
          busy_extra_minutes?: number
          busy_until?: string | null
          commission_pct?: number
          cover_image: string
          created_at?: string
          cuisine_label?: string
          cuisines?: Database["public"]["Enums"]["cuisine_type"][]
          delivery_fee_egp?: number
          description?: string
          distance_meters?: number
          featured?: boolean | null
          founding_rate_until?: string | null
          fulfillment_type?: string
          geo?: unknown
          id?: string
          is_active?: boolean
          is_open?: boolean
          is_open_24h?: boolean | null
          kitchen_id?: string | null
          logo?: string | null
          merchant_type?: Database["public"]["Enums"]["merchant_type"]
          min_order_egp?: number
          name: string
          onboarding_rejection_reason?: string | null
          onboarding_status?: string
          payout_bank_name?: string | null
          payout_holder?: string | null
          payout_iban?: string | null
          payout_method?: string | null
          payout_wallet?: string | null
          phone?: string | null
          place_id?: string | null
          prep_time_high?: number
          prep_time_low?: number
          promo?: string | null
          rating?: number
          rating_count?: number
          slug: string
          terms_accepted_at?: string | null
          terms_version?: string | null
          tourist_safe?: boolean
          updated_at?: string
          vertical_id?: string
          website?: string | null
          zone: Database["public"]["Enums"]["zone_type"]
        }
        Update: {
          accepts_card?: boolean
          accepts_cash?: boolean
          address?: string | null
          busy_extra_minutes?: number
          busy_until?: string | null
          commission_pct?: number
          cover_image?: string
          created_at?: string
          cuisine_label?: string
          cuisines?: Database["public"]["Enums"]["cuisine_type"][]
          delivery_fee_egp?: number
          description?: string
          distance_meters?: number
          featured?: boolean | null
          founding_rate_until?: string | null
          fulfillment_type?: string
          geo?: unknown
          id?: string
          is_active?: boolean
          is_open?: boolean
          is_open_24h?: boolean | null
          kitchen_id?: string | null
          logo?: string | null
          merchant_type?: Database["public"]["Enums"]["merchant_type"]
          min_order_egp?: number
          name?: string
          onboarding_rejection_reason?: string | null
          onboarding_status?: string
          payout_bank_name?: string | null
          payout_holder?: string | null
          payout_iban?: string | null
          payout_method?: string | null
          payout_wallet?: string | null
          phone?: string | null
          place_id?: string | null
          prep_time_high?: number
          prep_time_low?: number
          promo?: string | null
          rating?: number
          rating_count?: number
          slug?: string
          terms_accepted_at?: string | null
          terms_version?: string | null
          tourist_safe?: boolean
          updated_at?: string
          vertical_id?: string
          website?: string | null
          zone?: Database["public"]["Enums"]["zone_type"]
        }
        Relationships: [
          {
            foreignKeyName: "restaurants_kitchen_id_fkey"
            columns: ["kitchen_id"]
            isOneToOne: false
            referencedRelation: "kitchens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurants_vertical_id_fkey"
            columns: ["vertical_id"]
            isOneToOne: false
            referencedRelation: "verticals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurants_zone_fkey"
            columns: ["zone"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_orders: {
        Row: {
          created_at: string
          id: string
          items: Json
          name: string
          restaurant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          items: Json
          name: string
          restaurant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          items?: Json
          name?: string
          restaurant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "ranking_integrity_audit"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "saved_orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      service_areas: {
        Row: {
          boundary: unknown
          city_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
        }
        Insert: {
          boundary: unknown
          city_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
        }
        Update: {
          boundary?: unknown
          city_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_areas_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
      }
      support_case_events: {
        Row: {
          actor_id: string | null
          case_id: string
          created_at: string
          event: string
          id: string
          metadata: Json
        }
        Insert: {
          actor_id?: string | null
          case_id: string
          created_at?: string
          event: string
          id?: string
          metadata?: Json
        }
        Update: {
          actor_id?: string | null
          case_id?: string
          created_at?: string
          event?: string
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "support_case_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_case_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "support_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      support_cases: {
        Row: {
          assigned_to: string | null
          closed_at: string | null
          customer_id: string
          first_responded_at: string | null
          first_response_due_at: string | null
          id: string
          last_message_at: string
          opened_at: string
          order_id: string | null
          priority: string
          reason_code: string
          resolution_code: string | null
          resolution_due_at: string | null
          resolution_note: string | null
          resolved_at: string | null
          status: string
        }
        Insert: {
          assigned_to?: string | null
          closed_at?: string | null
          customer_id: string
          first_responded_at?: string | null
          first_response_due_at?: string | null
          id?: string
          last_message_at?: string
          opened_at?: string
          order_id?: string | null
          priority?: string
          reason_code?: string
          resolution_code?: string | null
          resolution_due_at?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          status?: string
        }
        Update: {
          assigned_to?: string | null
          closed_at?: string | null
          customer_id?: string
          first_responded_at?: string | null
          first_response_due_at?: string | null
          id?: string
          last_message_at?: string
          opened_at?: string
          order_id?: string | null
          priority?: string
          reason_code?: string
          resolution_code?: string | null
          resolution_due_at?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_cases_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_cases_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_cases_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          author_id: string | null
          body: string
          case_id: string | null
          created_at: string
          from_support: boolean
          id: string
          read_at: string | null
          user_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          case_id?: string | null
          created_at?: string
          from_support?: boolean
          id?: string
          read_at?: string | null
          user_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          case_id?: string | null
          created_at?: string
          from_support?: boolean
          id?: string
          read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_messages_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "support_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          allergy_profile: Database["public"]["Enums"]["allergy_key_type"][]
          created_at: string
          default_address_id: string | null
          default_payment_method_id: string | null
          display_name: string
          email: string | null
          id: string
          is_blocked: boolean
          locale: Database["public"]["Enums"]["locale_type"]
          phone: string
          preferred_currency: Database["public"]["Enums"]["currency_type"]
          referral_code: string | null
          role: Database["public"]["Enums"]["app_role"]
          terms_accepted_at: string | null
          terms_accepted_version: string | null
          updated_at: string
        }
        Insert: {
          allergy_profile?: Database["public"]["Enums"]["allergy_key_type"][]
          created_at?: string
          default_address_id?: string | null
          default_payment_method_id?: string | null
          display_name: string
          email?: string | null
          id: string
          is_blocked?: boolean
          locale?: Database["public"]["Enums"]["locale_type"]
          phone: string
          preferred_currency?: Database["public"]["Enums"]["currency_type"]
          referral_code?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          terms_accepted_at?: string | null
          terms_accepted_version?: string | null
          updated_at?: string
        }
        Update: {
          allergy_profile?: Database["public"]["Enums"]["allergy_key_type"][]
          created_at?: string
          default_address_id?: string | null
          default_payment_method_id?: string | null
          display_name?: string
          email?: string | null
          id?: string
          is_blocked?: boolean
          locale?: Database["public"]["Enums"]["locale_type"]
          phone?: string
          preferred_currency?: Database["public"]["Enums"]["currency_type"]
          referral_code?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          terms_accepted_at?: string | null
          terms_accepted_version?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_default_address_fk"
            columns: ["default_address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_default_payment_method_fk"
            columns: ["default_payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      vertical_categories: {
        Row: {
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          slug: string
          vertical_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          slug: string
          vertical_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          slug?: string
          vertical_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vertical_categories_vertical_id_fkey"
            columns: ["vertical_id"]
            isOneToOne: false
            referencedRelation: "verticals"
            referencedColumns: ["id"]
          },
        ]
      }
      vertical_launch_events: {
        Row: {
          actor_user_id: string | null
          evidence_reference: string | null
          id: string
          new_is_active: boolean
          new_stage: string
          occurred_at: string
          previous_is_active: boolean | null
          previous_stage: string | null
          reason: string
          vertical_id: string
        }
        Insert: {
          actor_user_id?: string | null
          evidence_reference?: string | null
          id?: string
          new_is_active: boolean
          new_stage: string
          occurred_at?: string
          previous_is_active?: boolean | null
          previous_stage?: string | null
          reason: string
          vertical_id: string
        }
        Update: {
          actor_user_id?: string | null
          evidence_reference?: string | null
          id?: string
          new_is_active?: boolean
          new_stage?: string
          occurred_at?: string
          previous_is_active?: boolean | null
          previous_stage?: string | null
          reason?: string
          vertical_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vertical_launch_events_vertical_id_fkey"
            columns: ["vertical_id"]
            isOneToOne: false
            referencedRelation: "verticals"
            referencedColumns: ["id"]
          },
        ]
      }
      vertical_private_access: {
        Row: {
          cohort: string | null
          expires_at: string | null
          generation: number
          granted_at: string
          granted_by: string | null
          id: string
          reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          status: string
          user_id: string | null
          vertical_id: string
        }
        Insert: {
          cohort?: string | null
          expires_at?: string | null
          generation?: number
          granted_at?: string
          granted_by?: string | null
          id?: string
          reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          user_id?: string | null
          vertical_id: string
        }
        Update: {
          cohort?: string | null
          expires_at?: string | null
          generation?: number
          granted_at?: string
          granted_by?: string | null
          id?: string
          reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          status?: string
          user_id?: string | null
          vertical_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vertical_private_access_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vertical_private_access_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vertical_private_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vertical_private_access_vertical_id_fkey"
            columns: ["vertical_id"]
            isOneToOne: false
            referencedRelation: "verticals"
            referencedColumns: ["id"]
          },
        ]
      }
      vertical_private_access_events: {
        Row: {
          action: string
          actor_user_id: string | null
          grant_id: string
          id: string
          occurred_at: string
          reason: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          grant_id: string
          id?: string
          occurred_at?: string
          reason?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          grant_id?: string
          id?: string
          occurred_at?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vertical_private_access_events_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "vertical_private_access"
            referencedColumns: ["id"]
          },
        ]
      }
      verticals: {
        Row: {
          capabilities: Json
          copy_namespace: string | null
          created_at: string
          display_order: number
          icon: string | null
          id: string
          is_active: boolean
          launch_stage: string
          name_ar: string
          name_en: string
          sort_order: number
        }
        Insert: {
          capabilities?: Json
          copy_namespace?: string | null
          created_at?: string
          display_order?: number
          icon?: string | null
          id: string
          is_active?: boolean
          launch_stage?: string
          name_ar: string
          name_en: string
          sort_order?: number
        }
        Update: {
          capabilities?: Json
          copy_namespace?: string | null
          created_at?: string
          display_order?: number
          icon?: string | null
          id?: string
          is_active?: boolean
          launch_stage?: string
          name_ar?: string
          name_en?: string
          sort_order?: number
        }
        Relationships: []
      }
      waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
          ip: unknown
          locale: string
          referrer: string | null
          source: string
          user_agent: string | null
          whatsapp: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          ip?: unknown
          locale: string
          referrer?: string | null
          source?: string
          user_agent?: string | null
          whatsapp?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          ip?: unknown
          locale?: string
          referrer?: string | null
          source?: string
          user_agent?: string | null
          whatsapp?: string | null
        }
        Relationships: []
      }
      zones: {
        Row: {
          boundary: unknown
          centroid: unknown
          dispatch_mode: string | null
          id: Database["public"]["Enums"]["zone_type"]
          is_active: boolean
          name_ar: string
          name_en: string
        }
        Insert: {
          boundary?: unknown
          centroid?: unknown
          dispatch_mode?: string | null
          id: Database["public"]["Enums"]["zone_type"]
          is_active?: boolean
          name_ar: string
          name_en: string
        }
        Update: {
          boundary?: unknown
          centroid?: unknown
          dispatch_mode?: string | null
          id?: Database["public"]["Enums"]["zone_type"]
          is_active?: boolean
          name_ar?: string
          name_en?: string
        }
        Relationships: []
      }
    }
    Views: {
      driver_cash_balance: {
        Row: {
          balance_egp: number | null
          driver_id: string | null
          driver_name: string | null
          last_handin_at: string | null
          lifetime_collected_egp: number | null
          lifetime_handed_in_egp: number | null
        }
        Relationships: []
      }
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
      public_drivers: {
        Row: {
          id: string | null
          name: string | null
          photo: string | null
          rating: number | null
          vehicle: Database["public"]["Enums"]["vehicle_type"] | null
        }
        Insert: {
          id?: string | null
          name?: string | null
          photo?: string | null
          rating?: number | null
          vehicle?: Database["public"]["Enums"]["vehicle_type"] | null
        }
        Update: {
          id?: string | null
          name?: string | null
          photo?: string | null
          rating?: number | null
          vehicle?: Database["public"]["Enums"]["vehicle_type"] | null
        }
        Relationships: []
      }
      ranking_integrity_audit: {
        Row: {
          featured: boolean | null
          is_active: boolean | null
          kitchen_name: string | null
          merchant_type: Database["public"]["Enums"]["merchant_type"] | null
          name: string | null
          ranking_promise_held: boolean | null
          restaurant_id: string | null
        }
        Relationships: []
      }
      saved_orders_visible: {
        Row: {
          created_at: string | null
          id: string | null
          is_available: boolean | null
          items: Json | null
          name: string | null
          restaurant_id: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saved_orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "ranking_integrity_audit"
            referencedColumns: ["restaurant_id"]
          },
          {
            foreignKeyName: "saved_orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      abandoned_cart_sweep: { Args: never; Returns: number }
      acquisition_report: {
        Args: { p_days?: number }
        Returns: {
          campaign: string
          first_orders: number
          installs: number
          partner_code: string
          repeat_orders: number
          signed_up: number
          source: string
        }[]
      }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      admin_assign_merchant_vertical: {
        Args: {
          p_new_vertical_id: string
          p_reason: string
          p_restaurant_id: string
        }
        Returns: undefined
      }
      admin_delete_restaurant: { Args: { p_id: string }; Returns: undefined }
      admin_grant_cod_override: {
        Args: { p_driver_id: string; p_hours?: number; p_reason: string }
        Returns: string
      }
      admin_issue_credit: {
        Args: {
          p_amount_egp: number
          p_note?: string
          p_order_id?: string
          p_reason: string
          p_user_id: string
        }
        Returns: undefined
      }
      admin_resolve_user_names: {
        Args: { p_ids: string[] }
        Returns: {
          display_name: string
          id: string
        }[]
      }
      admin_set_commission: {
        Args: { p_pct: number; p_restaurant_id: string }
        Returns: undefined
      }
      admin_set_founding_rate_until: {
        Args: { p_restaurant_id: string; p_until: string }
        Returns: undefined
      }
      admin_set_fx_rate: {
        Args: {
          p_allow_jump?: boolean
          p_quote: string
          p_rate: number
          p_reason: string
          p_stale_hours?: number
        }
        Returns: string
      }
      admin_set_merchant_type: {
        Args: {
          p_inherit_geo?: boolean
          p_kitchen_id?: string
          p_restaurant_id: string
          p_type: Database["public"]["Enums"]["merchant_type"]
        }
        Returns: undefined
      }
      admin_test_ops_alert: { Args: never; Returns: string }
      admin_update_restaurant: {
        Args: {
          p_cover_image: string
          p_cuisine_label: string
          p_cuisines: Database["public"]["Enums"]["cuisine_type"][]
          p_delivery_fee_egp: number
          p_description: string
          p_featured: boolean
          p_id: string
          p_is_active: boolean
          p_is_open: boolean
          p_is_open_24h: boolean
          p_logo: string
          p_min_order_egp: number
          p_name: string
          p_prep_time_high: number
          p_prep_time_low: number
          p_promo: string
          p_tourist_safe: boolean
          p_zone: Database["public"]["Enums"]["zone_type"]
        }
        Returns: undefined
      }
      admin_upsert_kitchen: {
        Args: {
          p_address?: string
          p_is_active?: boolean
          p_lat?: number
          p_lease_end?: string
          p_lease_start?: string
          p_lng?: number
          p_monthly_rent_egp?: number
          p_name: string
          p_notes?: string
          p_slug: string
          p_zone: Database["public"]["Enums"]["zone_type"]
        }
        Returns: string
      }
      advance_order_status: {
        Args: {
          p_new_status: Database["public"]["Enums"]["order_status_type"]
          p_note?: string
          p_order_id: string
        }
        Returns: undefined
      }
      all_restaurant_scorecards: {
        Args: { p_days?: number }
        Returns: {
          acceptance_rate: number
          avg_food_rating: number
          avg_prep_minutes: number
          cancel_rate: number
          on_time_rate: number
          orders: number
          reject_rate: number
          restaurant_id: string
          restaurant_name: string
        }[]
      }
      anonymize_my_account: { Args: never; Returns: undefined }
      apply_as_restaurant: {
        Args: {
          p_address: string
          p_cuisines: Database["public"]["Enums"]["cuisine_type"][]
          p_description: string
          p_is_open_24h: boolean
          p_lat: number
          p_lng: number
          p_name: string
          p_payout_bank_name: string
          p_payout_holder: string
          p_payout_iban: string
          p_payout_method: string
          p_payout_wallet: string
          p_phone: string
          p_prep_high: number
          p_prep_low: number
          p_terms_version: string
          p_zone: Database["public"]["Enums"]["zone_type"]
        }
        Returns: string
      }
      approve_restaurant: {
        Args: { p_decision: string; p_reason?: string; p_restaurant_id: string }
        Returns: undefined
      }
      assert_grant_preconditions: {
        Args: { p_actor: string; p_capability: string; p_target: string }
        Returns: undefined
      }
      assert_live_grant_target: {
        Args: { p_capability?: string; p_user_id: string }
        Returns: undefined
      }
      assert_platform_capability: {
        Args: { p_capability: string; p_user_id: string }
        Returns: undefined
      }
      assert_platform_owner_locked: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      assign_driver: {
        Args: { p_driver_id: string; p_order_id: string }
        Returns: undefined
      }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      auto_accept_sweep: { Args: never; Returns: number }
      auto_advance_sweep: { Args: never; Returns: number }
      auto_assign_order: { Args: { p_order_id: string }; Returns: string }
      batch_candidates: {
        Args: never
        Returns: {
          dropoff_gap_m: number
          order_a: string
          order_b: string
          pickup_gap_m: number
          ready_gap_min: number
          same_pickup: boolean
          same_restaurant: boolean
          zone: string
        }[]
      }
      batch_shadow_sweep: { Args: never; Returns: number }
      brand_gate_report: {
        Args: { p_days?: number; p_restaurant_id: string }
        Returns: {
          gate_name: string
          gate_no: number
          measurable: boolean
          measured_value: string
          passed: boolean
          threshold: string
        }[]
      }
      can_access_order_thread: {
        Args: { p_order_id: string }
        Returns: boolean
      }
      can_view_vertical: { Args: { p_vertical_id: string }; Returns: boolean }
      claim_acquisition_touches: {
        Args: { p_install_id: string }
        Returns: undefined
      }
      claim_push_retries: {
        Args: { p_limit?: number }
        Returns: {
          attempt_id: string
          attempt_no: number
          custom_body: string
          custom_title: string
          event: string
          message_id: string
          order_id: string
          recipient_user_id: string
          route: string
          token: string
          vertical: string
        }[]
      }
      claim_support_case: { Args: { p_case_id: string }; Returns: undefined }
      clear_my_cart: { Args: never; Returns: undefined }
      current_fx_rates: {
        Args: never
        Returns: {
          effective_at: string
          quote_currency: string
          rate: number
          source: string
          stale: boolean
          stale_after: string
        }[]
      }
      delivery_feasibility: {
        Args: { p_dropoff: unknown; p_restaurant_id: string }
        Returns: {
          distance_m: number
          eta_minutes: number
          in_range: boolean
        }[]
      }
      disablelongtransactions: { Args: never; Returns: string }
      dispatch_sweep: { Args: never; Returns: number }
      dispatch_watchdog: { Args: never; Returns: undefined }
      driver_cod_capacity: {
        Args: { p_driver_id: string; p_order_id?: string }
        Returns: {
          hard_limit_egp: number
          held_egp: number
          mode: string
          outcome: string
          prospective_egp: number
          soft_limit_egp: number
        }[]
      }
      driver_ping: {
        Args: { p_lat: number; p_lng: number; p_status?: string }
        Returns: undefined
      }
      driver_respond: {
        Args: { p_accept: boolean; p_assignment_id: string }
        Returns: undefined
      }
      driver_settlement_sweep: { Args: never; Returns: number }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      enablelongtransactions: { Args: never; Returns: string }
      enqueue_push: {
        Args: {
          p_campaign_id?: string
          p_category?: string
          p_custom_body?: string
          p_custom_title?: string
          p_event: string
          p_expires_in?: string
          p_idempotency_key?: string
          p_order_id?: string
          p_recipient_user_ids?: string[]
          p_route?: string
          p_vertical?: string
        }
        Returns: string
      }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      expire_platform_capabilities: {
        Args: { p_limit?: number }
        Returns: number
      }
      expire_vertical_private_access: {
        Args: { p_limit?: number }
        Returns: number
      }
      expired_cart_sweep: { Args: never; Returns: number }
      finalize_driver_settlement: {
        Args: { p_settlement_id: string }
        Returns: undefined
      }
      finalize_full_card_refund: {
        Args: {
          p_provider_detail?: Json
          p_provider_ref: string
          p_refund_id: string
        }
        Returns: string
      }
      finalize_settlement: {
        Args: { p_settlement_id: string }
        Returns: undefined
      }
      founding_rate_report: {
        Args: never
        Returns: {
          commission_pct: number
          days_remaining: number
          delivered_orders: number
          food_egp_30d: number
          forgone_egp_30d: number
          founding_rate_until: string
          is_active: boolean
          name: string
          restaurant_id: string
          status: string
          zone: string
        }[]
      }
      fx_apply_observation: {
        Args: {
          p_actor: string
          p_allow_jump: boolean
          p_note: string
          p_quote: string
          p_rate: number
          p_source: string
          p_stale_hours: number
        }
        Returns: string
      }
      fx_rates_health_sweep: { Args: never; Returns: number }
      generate_driver_settlements: {
        Args: { p_period_end: string; p_period_start: string }
        Returns: number
      }
      generate_order_short_code: { Args: never; Returns: string }
      generate_referral_code: { Args: never; Returns: string }
      generate_settlements: {
        Args: { p_period_end: string; p_period_start: string }
        Returns: number
      }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      get_notification_prefs: {
        Args: never
        Returns: {
          marketing: boolean
          marketing_consent_at: string | null
          marketing_consent_source: string | null
          quiet_hours_end: number | null
          quiet_hours_start: number | null
          timezone: string
          transactional: boolean
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "notification_prefs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_restaurant_reviews: {
        Args: { p_limit?: number; p_restaurant_id: string }
        Returns: {
          comment: string
          rating_delivery: number
          rating_food: number
          reviewed_at: string
          reviewer: string
        }[]
      }
      gettransactionid: { Args: never; Returns: unknown }
      grant_delivery_pilot_access: {
        Args: {
          p_expires_at?: string
          p_reason: string
          p_service_area_id: string
          p_subject_id: string
          p_subject_kind: string
        }
        Returns: string
      }
      grant_platform_capability: {
        Args: {
          p_capability: string
          p_expires_at?: string
          p_reason: string
          p_user_id: string
        }
        Returns: string
      }
      grant_vertical_private_access: {
        Args: {
          p_cohort: string
          p_expires_at?: string
          p_reason: string
          p_user_id: string
          p_vertical_id: string
        }
        Returns: string
      }
      has_completed_order: { Args: { p_user: string }; Returns: boolean }
      has_platform_capability: {
        Args: { p_capability: string; p_user_id: string }
        Returns: boolean
      }
      i_have_platform_capability: {
        Args: { p_capability: string }
        Returns: boolean
      }
      in_quiet_hours: {
        Args: { p_end: number; p_start: number; p_tz: string }
        Returns: boolean
      }
      is_merchant_manager: {
        Args: { p_restaurant_id: string }
        Returns: boolean
      }
      is_merchant_staff: { Args: { p_restaurant_id: string }; Returns: boolean }
      is_notification_recipient: {
        Args: { p_message_id: string; p_user_id: string }
        Returns: boolean
      }
      is_platform_owner: { Args: { p_user_id: string }; Returns: boolean }
      is_within_service_area: {
        Args: { p_lat: number; p_lng: number }
        Returns: boolean
      }
      issue_credit: {
        Args: {
          p_amount_egp: number
          p_note?: string
          p_order_id?: string
          p_reason: string
          p_user_id: string
        }
        Returns: undefined
      }
      kyc_storage_path_indexed: { Args: { p_name: string }; Returns: boolean }
      lifecycle_eligible: {
        Args: { p_event: string; p_subject_id?: string; p_user_id: string }
        Returns: {
          allowed: boolean
          holdout_group: string
          reason: string
        }[]
      }
      lifecycle_holdout_group: {
        Args: { p_event: string; p_user_id: string }
        Returns: string
      }
      lifecycle_is_live: { Args: never; Returns: boolean }
      lifecycle_record: {
        Args: {
          p_event: string
          p_group: string
          p_message_id?: string
          p_reason: string
          p_subject_id: string
          p_user_id: string
          p_would_send: boolean
        }
        Returns: undefined
      }
      log_cod_limit_event: {
        Args: {
          p_driver_id: string
          p_hard: number
          p_held: number
          p_mode: string
          p_order_id: string
          p_outcome: string
          p_prospective: number
          p_soft: number
        }
        Returns: undefined
      }
      longtransactionsenabled: { Args: never; Returns: boolean }
      loyalty_tier_sweep: { Args: never; Returns: number }
      mark_cod_collected: {
        Args: { p_amount: number; p_order_id: string }
        Returns: undefined
      }
      mark_driver_settlement_paid: {
        Args: { p_reference: string; p_settlement_id: string }
        Returns: undefined
      }
      mark_notification_read: {
        Args: { p_message_id: string }
        Returns: undefined
      }
      mark_order_thread_read: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      mark_settlement_paid: {
        Args: { p_reference: string; p_settlement_id: string }
        Returns: undefined
      }
      mark_support_thread_read: {
        Args: { p_user_id?: string }
        Returns: undefined
      }
      marketing_allowed: { Args: { p_user_id: string }; Returns: boolean }
      marketing_suppression_reason: {
        Args: { p_user_id: string }
        Returns: string
      }
      marketplace_integrity_findings: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          entity_id: string
        }[]
      }
      marketplace_integrity_report: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          entity_id: string
        }[]
      }
      marketplace_integrity_sweep: { Args: never; Returns: number }
      menu_items_staff_writable_columns: { Args: never; Returns: string[] }
      my_cash_balance: { Args: never; Returns: number }
      my_cod_capacity: {
        Args: never
        Returns: {
          hard_limit_egp: number
          held_egp: number
          mode: string
          over_hard: boolean
          over_soft: boolean
          soft_limit_egp: number
        }[]
      }
      my_credit_balance: { Args: never; Returns: number }
      my_driver_settlements: {
        Args: { p_limit?: number }
        Returns: {
          cod_collected_egp: number
          created_at: string
          delivery_count: number
          driver_id: string
          gross_earnings_egp: number
          id: string
          net_payable_egp: number
          paid_at: string | null
          paid_reference: string | null
          period_end: string
          period_start: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "driver_settlements"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      my_driver_tier: {
        Args: never
        Returns: {
          acceptance_rate_snapshot: number
          bonus_per_delivery_egp: number
          deliveries_rolling_90d: number
          first_look_seconds: number
          rating_snapshot: number
          tier: string
        }[]
      }
      my_favorite_items: {
        Args: never
        Returns: {
          created_at: string
          image: string
          is_available: boolean
          item_description: string
          item_name: string
          menu_item_id: string
          price_egp: number
          restaurant_id: string
          restaurant_is_active: boolean
          restaurant_is_open: boolean
          restaurant_name: string
        }[]
      }
      my_kyc_documents: {
        Args: {
          p_subject_id: string
          p_subject_type: Database["public"]["Enums"]["kyc_subject_type"]
        }
        Returns: {
          created_at: string
          doc_type: string
          id: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["kyc_doc_status"]
          storage_path: string
          subject_id: string
          subject_type: Database["public"]["Enums"]["kyc_subject_type"]
        }[]
        SetofOptions: {
          from: "*"
          to: "kyc_documents"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      my_loyalty_history: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          delta_points: number
          id: string
          reason: string
          ref_order_id: string | null
          subject_id: string
          subject_type: string
        }[]
        SetofOptions: {
          from: "*"
          to: "loyalty_points_ledger"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      my_loyalty_status: {
        Args: never
        Returns: {
          points_balance: number
          points_rolling_12mo: number
          tier: string
        }[]
      }
      my_merchant_ids: { Args: never; Returns: string[] }
      my_notification_inbox: {
        Args: {
          p_before_id?: string
          p_before_queued?: string
          p_limit?: number
        }
        Returns: {
          category: string
          custom_body: string
          custom_title: string
          event: string
          id: string
          opened_at: string
          order_id: string
          queued_at: string
          read_at: string
          route: string
          vertical: string
        }[]
      }
      my_referral_code: { Args: never; Returns: string }
      my_restaurant_settlements: {
        Args: { p_limit?: number }
        Returns: {
          card_sales_egp: number
          cod_sales_egp: number
          commission_egp: number
          created_at: string
          gross_sales_egp: number
          id: string
          net_payable_egp: number
          order_count: number
          paid_at: string | null
          paid_reference: string | null
          period_end: string
          period_start: string
          restaurant_id: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "restaurant_settlements"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      my_restaurant_tier: {
        Args: never
        Returns: {
          commission_pct: number
          featured: boolean
          orders_rolling_90d: number
          tier: string
        }[]
      }
      my_support_unread_count: { Args: never; Returns: number }
      my_unread_message_count: { Args: never; Returns: number }
      my_unread_notification_count: { Args: never; Returns: number }
      nearest_drivers: {
        Args: { p_geo: unknown; p_limit?: number; p_radius_m?: number }
        Returns: {
          distance_m: number
          driver_id: string
          name: string
          status: string
          vehicle: Database["public"]["Enums"]["vehicle_type"]
        }[]
      }
      offboard_platform_owner: {
        Args: { p_reason: string; p_user_id: string }
        Returns: undefined
      }
      open_support_case: {
        Args: { p_message?: string; p_order_id?: string; p_reason_code: string }
        Returns: string
      }
      ops_alert: { Args: { p_text: string }; Returns: undefined }
      ops_daily_digest: { Args: never; Returns: undefined }
      ops_stats_text: { Args: { p_scope: string }; Returns: string }
      payment_reconciliation_findings: {
        Args: { p_days?: number }
        Returns: {
          age_days: number
          amount_egp: number
          detail: string
          ledger_id: string
          mismatch_class: string
          order_id: string
          payment_method: string
          provider_ref: string
          settlement_id: string
          short_code: string
        }[]
      }
      payment_reconciliation_report: {
        Args: { p_days?: number }
        Returns: {
          age_days: number
          amount_egp: number
          detail: string
          ledger_id: string
          mismatch_class: string
          order_id: string
          payment_method: string
          provider_ref: string
          settlement_id: string
          short_code: string
        }[]
      }
      payment_reconciliation_sweep: { Args: never; Returns: number }
      place_order: {
        Args: {
          p_address_id: string
          p_cart: Json
          p_customer_phone?: string
          p_dropoff_note?: string
          p_dropoff_preference?: Database["public"]["Enums"]["dropoff_preference"]
          p_idempotency_key?: string
          p_kitchen_notes?: string
          p_payment_method: string
          p_promo_code?: string
          p_restaurant_id: string
          p_scheduled_for?: string
          p_tip?: number
        }
        Returns: {
          id: string
          short_code: string
          total_egp: number
        }[]
      }
      platform_revenue_report: {
        Args: { p_period_end: string; p_period_start: string }
        Returns: {
          blended_take_rate_pct: number
          gmv_egp: number
          marketplace_take_rate_pct: number
          net_revenue_egp: number
          own_brand_gmv_egp: number
          own_brand_orders: number
          own_brand_revenue_egp: number
          third_party_commission_egp: number
          third_party_gmv_egp: number
          third_party_orders: number
        }[]
      }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      prepare_cart: {
        Args: { p_cart: Json; p_restaurant_id: string }
        Returns: {
          issues: Json
          minimum_order_egp: number
          prepared_items: Json
          restaurant_id: string
          restaurant_open: boolean
          subtotal_egp: number
        }[]
      }
      provision_driver: {
        Args: {
          p_name: string
          p_phone: string
          p_plate?: string
          p_profile_id: string
          p_vehicle?: Database["public"]["Enums"]["vehicle_type"]
        }
        Returns: string
      }
      push_headers: { Args: never; Returns: Json }
      push_receipt_sweep: { Args: never; Returns: number }
      quote_delivery_fee: {
        Args: {
          p_dropoff: unknown
          p_restaurant_id: string
          p_subtotal?: number
        }
        Returns: number
      }
      quote_delivery_job: {
        Args: {
          p_declared_value_egp: number
          p_dropoff_lat: number
          p_dropoff_lng: number
          p_fragile: boolean
          p_idempotency_key: string
          p_package_count: number
          p_parcel_band_code: string
          p_parcel_category: string
          p_pickup_lat: number
          p_pickup_lng: number
        }
        Returns: {
          billable_distance_m: number
          expires_at: string
          price_egp: number
          quote_id: string
        }[]
      }
      recent_push_campaigns: {
        Args: { p_limit?: number }
        Returns: {
          body: string
          created_at: string
          delivery_detail: string | null
          delivery_status: string
          id: string
          idempotency_key: string | null
          net_request_id: number | null
          recipients: number
          segment: string
          segment_param: string | null
          segment_size: number | null
          sent_by: string | null
          settled_at: string | null
          suppressed_blocked: number
          suppressed_count: number
          suppressed_no_consent: number | null
          suppressed_no_token: number | null
          suppressed_quiet_hours: number | null
          title: string
        }[]
        SetofOptions: {
          from: "*"
          to: "push_campaigns"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reconcile_push_campaigns: { Args: never; Returns: number }
      reconcile_stale_card_orders: { Args: never; Returns: number }
      record_acquisition_touch: {
        Args: {
          p_campaign?: string
          p_deep_link?: string
          p_install_id: string
          p_medium?: string
          p_partner_code?: string
          p_source: string
        }
        Returns: undefined
      }
      record_cash_handin: {
        Args: {
          p_amount_egp: number
          p_driver_id: string
          p_note?: string
          p_reason?: string
        }
        Returns: number
      }
      record_consent_event: {
        Args: {
          p_channel: string
          p_granted: boolean
          p_policy_version?: string
          p_source?: string
        }
        Returns: string
      }
      record_fx_observation: {
        Args: {
          p_allow_jump?: boolean
          p_quote: string
          p_rate: number
          p_source: string
          p_stale_hours?: number
        }
        Returns: string
      }
      record_notification_open: {
        Args: { p_message_id: string }
        Returns: undefined
      }
      record_terms_acceptance: {
        Args: { p_version: string }
        Returns: undefined
      }
      redeem_credit: { Args: { p_amount_egp: number }; Returns: string }
      redeem_points: { Args: { p_points: number }; Returns: string }
      reorder_cadence_sweep: { Args: never; Returns: number }
      reply_support_message: {
        Args: { p_body: string; p_user_id: string }
        Returns: {
          author_id: string | null
          body: string
          case_id: string | null
          created_at: string
          from_support: boolean
          id: string
          read_at: string | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "support_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_service_area: { Args: { p_point: unknown }; Returns: string }
      resolve_support_case: {
        Args: { p_case_id: string; p_note?: string; p_resolution_code: string }
        Returns: undefined
      }
      resolve_zone: {
        Args: { p_geo: unknown }
        Returns: Database["public"]["Enums"]["zone_type"]
      }
      resolve_zone_nearest: {
        Args: { p_geo: unknown }
        Returns: Database["public"]["Enums"]["zone_type"]
      }
      restaurant_scorecard: {
        Args: { p_days?: number; p_restaurant_id: string }
        Returns: {
          acceptance_rate: number
          accepted: number
          avg_food_rating: number
          avg_prep_minutes: number
          cancel_rate: number
          cancelled: number
          delivered: number
          on_time_rate: number
          orders: number
          reject_rate: number
          rejected: number
          restaurant_id: string
          window_days: number
        }[]
      }
      review_kyc_document: {
        Args: { p_approve: boolean; p_document_id: string; p_note?: string }
        Returns: undefined
      }
      revoke_delivery_pilot_access: {
        Args: {
          p_reason: string
          p_service_area_id: string
          p_subject_id: string
          p_subject_kind: string
        }
        Returns: undefined
      }
      revoke_platform_capability: {
        Args: { p_capability: string; p_reason: string; p_user_id: string }
        Returns: undefined
      }
      revoke_vertical_private_access: {
        Args: { p_reason: string; p_user_id: string; p_vertical_id: string }
        Returns: undefined
      }
      rider_snapshot: { Args: { p_driver_id: string }; Returns: Json }
      search_catalog: {
        Args: {
          p_after_id?: string
          p_after_name?: string
          p_limit?: number
          p_query: string
          p_restaurant_id?: string
          p_vertical?: string
        }
        Returns: {
          is_available: boolean
          item_id: string
          name: string
          price_egp: number
          restaurant_id: string
          sku: string
          unit: string
          vertical_id: string
        }[]
      }
      send_order_message: {
        Args: { p_body: string; p_order_id: string }
        Returns: {
          body: string
          created_at: string
          id: string
          order_id: string
          read_at: string | null
          sender_id: string | null
          sender_role: Database["public"]["Enums"]["app_role"]
        }
        SetofOptions: {
          from: "*"
          to: "order_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      send_push_campaign: {
        Args: {
          p_body: string
          p_dry_run?: boolean
          p_idempotency_key?: string
          p_segment: string
          p_segment_param?: string
          p_title: string
        }
        Returns: {
          campaign_id: string
          dry_run: boolean
          recipients: number
          segment_size: number
          suppressed_no_consent: number
          suppressed_no_token: number
          suppressed_quiet_hours: number
        }[]
      }
      send_support_message: {
        Args: { p_body: string }
        Returns: {
          author_id: string | null
          body: string
          case_id: string | null
          created_at: string
          from_support: boolean
          id: string
          read_at: string | null
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "support_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_busy_mode: {
        Args: {
          p_duration_minutes?: number
          p_extra_minutes: number
          p_restaurant_id: string
        }
        Returns: string
      }
      set_delivery_service_config: {
        Args: {
          p_intake_state?: string
          p_launch_stage?: string
          p_reason?: string
          p_service_area_id: string
        }
        Returns: undefined
      }
      set_notification_prefs: {
        Args: {
          p_clear_quiet_hours?: boolean
          p_marketing?: boolean
          p_quiet_hours_end?: number
          p_quiet_hours_start?: number
          p_source?: string
          p_timezone?: string
          p_transactional?: boolean
        }
        Returns: {
          marketing: boolean
          marketing_consent_at: string | null
          marketing_consent_source: string | null
          quiet_hours_end: number | null
          quiet_hours_start: number | null
          timezone: string
          transactional: boolean
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "notification_prefs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_vertical_launch_stage: {
        Args: {
          p_evidence_reference?: string
          p_is_active: boolean
          p_reason: string
          p_stage: string
          p_vertical_id: string
        }
        Returns: undefined
      }
      settle_paymob_payment: {
        Args: {
          p_amount_cents: number
          p_integration_id: string
          p_provider_order_id: string
          p_provider_txn_id: string
        }
        Returns: Json
      }
      settle_push_attempt: {
        Args: {
          p_attempt_id: string
          p_error_code?: string
          p_error_detail?: string
          p_status: string
          p_ticket_id?: string
        }
        Returns: undefined
      }
      settlement_sweep: { Args: never; Returns: number }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      unlockrows: { Args: { "": string }; Returns: number }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
      upsert_my_cart: {
        Args: {
          p_expected_version: number
          p_items: Json
          p_kitchen_notes: string
          p_restaurant_id: string
        }
        Returns: {
          expires_at: string
          updated_at: string
          version: number
        }[]
      }
      user_can_view_vertical: {
        Args: { p_user_id: string; p_vertical_id: string }
        Returns: boolean
      }
      validate_promo: {
        Args: { p_code: string; p_subtotal: number }
        Returns: number
      }
      vertical_assignment_blockers: {
        Args: { p_new_vertical_id: string; p_restaurant_id: string }
        Returns: {
          code: string
          detail: string
        }[]
      }
      vertical_effective_stage: {
        Args: { p_vertical_id: string }
        Returns: string
      }
      vertical_order_dimensions: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          commission_egp: number
          delivered_count: number
          gross_egp: number
          order_count: number
          vertical_id: string
        }[]
      }
    }
    Enums: {
      address_kind_type: "hotel" | "street" | "beach_pin"
      allergy_key_type:
        | "nuts"
        | "gluten"
        | "dairy"
        | "shellfish"
        | "eggs"
        | "soy"
        | "spicy"
        | "sesame"
      app_role:
        | "customer"
        | "driver"
        | "merchant_staff"
        | "dispatcher"
        | "admin"
      cuisine_type:
        | "italian"
        | "seafood"
        | "egyptian"
        | "sushi"
        | "healthy"
        | "burgers"
        | "cafe"
        | "asian"
        | "pizza"
        | "breakfast"
        | "late_night"
        | "street_food"
        | "sweets"
        | "grocery"
        | "pharmacy"
      currency_type: "EGP" | "EUR" | "USD" | "GBP" | "RUB"
      dropoff_preference:
        | "hand_to_me"
        | "leave_at_door"
        | "meet_outside"
        | "no_bell"
        | "call_on_arrival"
      handoff_type: "lobby" | "reception" | "poolside"
      item_flag_type:
        | "halal"
        | "vegetarian"
        | "vegan"
        | "contains_pork"
        | "contains_alcohol"
        | "contains_nuts"
        | "spicy"
        | "glutenfree"
      kyc_doc_status: "pending" | "approved" | "rejected"
      kyc_subject_type: "driver" | "restaurant"
      locale_type: "en" | "ar" | "ru" | "it" | "de"
      merchant_type: "third_party" | "own_brand"
      order_status_type:
        | "placed"
        | "accepted"
        | "preparing"
        | "ready"
        | "picked_up"
        | "out_for_delivery"
        | "delivered"
        | "cancelled"
        | "rejected"
      payment_kind_type:
        | "cash"
        | "fawry"
        | "vodafone_cash"
        | "instapay"
        | "card"
        | "apple_pay"
      vehicle_type: "scooter" | "motorbike" | "bicycle" | "car"
      zone_type:
        | "naama"
        | "hadaba"
        | "nabq"
        | "old_market"
        | "soho"
        | "sharks_bay"
        | "el_salam"
        | "mubarak_7"
        | "el_rowaisat"
        | "hay_el_nour"
        | "el_hadaba_residential"
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      address_kind_type: ["hotel", "street", "beach_pin"],
      allergy_key_type: [
        "nuts",
        "gluten",
        "dairy",
        "shellfish",
        "eggs",
        "soy",
        "spicy",
        "sesame",
      ],
      app_role: ["customer", "driver", "merchant_staff", "dispatcher", "admin"],
      cuisine_type: [
        "italian",
        "seafood",
        "egyptian",
        "sushi",
        "healthy",
        "burgers",
        "cafe",
        "asian",
        "pizza",
        "breakfast",
        "late_night",
        "street_food",
        "sweets",
        "grocery",
        "pharmacy",
      ],
      currency_type: ["EGP", "EUR", "USD", "GBP", "RUB"],
      dropoff_preference: [
        "hand_to_me",
        "leave_at_door",
        "meet_outside",
        "no_bell",
        "call_on_arrival",
      ],
      handoff_type: ["lobby", "reception", "poolside"],
      item_flag_type: [
        "halal",
        "vegetarian",
        "vegan",
        "contains_pork",
        "contains_alcohol",
        "contains_nuts",
        "spicy",
        "glutenfree",
      ],
      kyc_doc_status: ["pending", "approved", "rejected"],
      kyc_subject_type: ["driver", "restaurant"],
      locale_type: ["en", "ar", "ru", "it", "de"],
      merchant_type: ["third_party", "own_brand"],
      order_status_type: [
        "placed",
        "accepted",
        "preparing",
        "ready",
        "picked_up",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "rejected",
      ],
      payment_kind_type: [
        "cash",
        "fawry",
        "vodafone_cash",
        "instapay",
        "card",
        "apple_pay",
      ],
      vehicle_type: ["scooter", "motorbike", "bicycle", "car"],
      zone_type: [
        "naama",
        "hadaba",
        "nabq",
        "old_market",
        "soho",
        "sharks_bay",
        "el_salam",
        "mubarak_7",
        "el_rowaisat",
        "hay_el_nour",
        "el_hadaba_residential",
      ],
    },
  },
} as const
