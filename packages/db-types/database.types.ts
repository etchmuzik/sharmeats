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
      drivers: {
        Row: {
          created_at: string
          current_geo: unknown
          home_zone: Database["public"]["Enums"]["zone_type"] | null
          id: string
          is_active: boolean
          is_verified: boolean
          last_ping_at: string | null
          legacy_rider_id: string | null
          name: string
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
          legacy_rider_id?: string | null
          name: string
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
          legacy_rider_id?: string | null
          name?: string
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
            foreignKeyName: "drivers_legacy_rider_id_fkey"
            columns: ["legacy_rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
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
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
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
          created_at: string
          delivered_at: string
          delivery_fee_egp: number
          order_id: string
          payment_method: string
          restaurant_id: string
          subtotal_egp: number
        }
        Insert: {
          commission_egp: number
          commission_pct: number
          created_at?: string
          delivered_at: string
          delivery_fee_egp?: number
          order_id: string
          payment_method: string
          restaurant_id: string
          subtotal_egp: number
        }
        Update: {
          commission_egp?: number
          commission_pct?: number
          created_at?: string
          delivered_at?: string
          delivery_fee_egp?: number
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
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          catalog_item_id: string | null
          created_at: string
          id: string
          line_total: number
          modifiers_snapshot: Json
          name_snapshot: string
          notes: string | null
          order_id: string
          quantity: number
          unit_price_snapshot: number
        }
        Insert: {
          catalog_item_id?: string | null
          created_at?: string
          id?: string
          line_total: number
          modifiers_snapshot?: Json
          name_snapshot: string
          notes?: string | null
          order_id: string
          quantity: number
          unit_price_snapshot: number
        }
        Update: {
          catalog_item_id?: string | null
          created_at?: string
          id?: string
          line_total?: number
          modifiers_snapshot?: Json
          name_snapshot?: string
          notes?: string | null
          order_id?: string
          quantity?: number
          unit_price_snapshot?: number
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
          sender_id: string
          sender_role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          order_id: string
          read_at?: string | null
          sender_id: string
          sender_role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          order_id?: string
          read_at?: string | null
          sender_id?: string
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
          address_id: string | null
          address_snapshot: Json
          aggregate_allergens:
            | Database["public"]["Enums"]["allergy_key_type"][]
            | null
          anonymized_at: string | null
          assigned_driver_id: string | null
          cancel_reason: string | null
          customer_phone: string | null
          deleted_user_ref: string | null
          delivered_at: string | null
          delivery_fee_egp: number
          discount_egp: number
          dispatch_eligible_at: string | null
          dispatch_mode: string | null
          dropoff_geo: unknown
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
          short_code: string
          sla_minutes: number
          status: Database["public"]["Enums"]["order_status_type"]
          subtotal_egp: number
          tax_egp: number
          tip_egp: number
          total_egp: number
          updated_at: string
          user_id: string | null
          zone: Database["public"]["Enums"]["zone_type"] | null
        }
        Insert: {
          accepted_at?: string | null
          address_id?: string | null
          address_snapshot: Json
          aggregate_allergens?:
            | Database["public"]["Enums"]["allergy_key_type"][]
            | null
          anonymized_at?: string | null
          assigned_driver_id?: string | null
          cancel_reason?: string | null
          customer_phone?: string | null
          deleted_user_ref?: string | null
          delivered_at?: string | null
          delivery_fee_egp: number
          discount_egp?: number
          dispatch_eligible_at?: string | null
          dispatch_mode?: string | null
          dropoff_geo?: unknown
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
          short_code: string
          sla_minutes?: number
          status?: Database["public"]["Enums"]["order_status_type"]
          subtotal_egp: number
          tax_egp: number
          tip_egp?: number
          total_egp: number
          updated_at?: string
          user_id?: string | null
          zone?: Database["public"]["Enums"]["zone_type"] | null
        }
        Update: {
          accepted_at?: string | null
          address_id?: string | null
          address_snapshot?: Json
          aggregate_allergens?:
            | Database["public"]["Enums"]["allergy_key_type"][]
            | null
          anonymized_at?: string | null
          assigned_driver_id?: string | null
          cancel_reason?: string | null
          customer_phone?: string | null
          deleted_user_ref?: string | null
          delivered_at?: string | null
          delivery_fee_egp?: number
          discount_egp?: number
          dispatch_eligible_at?: string | null
          dispatch_mode?: string | null
          dropoff_geo?: unknown
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
          short_code?: string
          sla_minutes?: number
          status?: Database["public"]["Enums"]["order_status_type"]
          subtotal_egp?: number
          tax_egp?: number
          tip_egp?: number
          total_egp?: number
          updated_at?: string
          user_id?: string | null
          zone?: Database["public"]["Enums"]["zone_type"] | null
        }
        Relationships: [
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
          commission_pct: number
          cover_image: string
          created_at: string
          cuisine_label: string
          cuisines: Database["public"]["Enums"]["cuisine_type"][]
          delivery_fee_egp: number
          description: string
          distance_meters: number
          featured: boolean | null
          fulfillment_type: string
          geo: unknown
          id: string
          is_active: boolean
          is_open: boolean
          is_open_24h: boolean | null
          logo: string | null
          min_order_egp: number
          name: string
          phone: string | null
          place_id: string | null
          prep_time_high: number
          prep_time_low: number
          promo: string | null
          rating: number
          rating_count: number
          slug: string
          tourist_safe: boolean
          updated_at: string
          vertical_id: string | null
          website: string | null
          zone: Database["public"]["Enums"]["zone_type"]
        }
        Insert: {
          accepts_card?: boolean
          accepts_cash?: boolean
          address?: string | null
          commission_pct?: number
          cover_image: string
          created_at?: string
          cuisine_label?: string
          cuisines?: Database["public"]["Enums"]["cuisine_type"][]
          delivery_fee_egp?: number
          description?: string
          distance_meters?: number
          featured?: boolean | null
          fulfillment_type?: string
          geo?: unknown
          id?: string
          is_active?: boolean
          is_open?: boolean
          is_open_24h?: boolean | null
          logo?: string | null
          min_order_egp?: number
          name: string
          phone?: string | null
          place_id?: string | null
          prep_time_high?: number
          prep_time_low?: number
          promo?: string | null
          rating?: number
          rating_count?: number
          slug: string
          tourist_safe?: boolean
          updated_at?: string
          vertical_id?: string | null
          website?: string | null
          zone: Database["public"]["Enums"]["zone_type"]
        }
        Update: {
          accepts_card?: boolean
          accepts_cash?: boolean
          address?: string | null
          commission_pct?: number
          cover_image?: string
          created_at?: string
          cuisine_label?: string
          cuisines?: Database["public"]["Enums"]["cuisine_type"][]
          delivery_fee_egp?: number
          description?: string
          distance_meters?: number
          featured?: boolean | null
          fulfillment_type?: string
          geo?: unknown
          id?: string
          is_active?: boolean
          is_open?: boolean
          is_open_24h?: boolean | null
          logo?: string | null
          min_order_egp?: number
          name?: string
          phone?: string | null
          place_id?: string | null
          prep_time_high?: number
          prep_time_low?: number
          promo?: string | null
          rating?: number
          rating_count?: number
          slug?: string
          tourist_safe?: boolean
          updated_at?: string
          vertical_id?: string | null
          website?: string | null
          zone?: Database["public"]["Enums"]["zone_type"]
        }
        Relationships: [
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
      riders: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          photo: string
          plate: string
          rating: number
          user_id: string | null
          vehicle: Database["public"]["Enums"]["vehicle_type"]
          verified: boolean
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          photo?: string
          plate: string
          rating?: number
          user_id?: string | null
          vehicle?: Database["public"]["Enums"]["vehicle_type"]
          verified?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          photo?: string
          plate?: string
          rating?: number
          user_id?: string | null
          vehicle?: Database["public"]["Enums"]["vehicle_type"]
          verified?: boolean
        }
        Relationships: []
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
      support_messages: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          from_support: boolean
          id: string
          read_at: string | null
          user_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          from_support?: boolean
          id?: string
          read_at?: string | null
          user_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
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
      verticals: {
        Row: {
          created_at: string
          icon: string | null
          id: string
          is_active: boolean
          name_ar: string
          name_en: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          icon?: string | null
          id: string
          is_active?: boolean
          name_ar: string
          name_en: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean
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
      advance_order_status: {
        Args: {
          p_new_status: Database["public"]["Enums"]["order_status_type"]
          p_note?: string
          p_order_id: string
        }
        Returns: undefined
      }
      anonymize_my_account: { Args: never; Returns: undefined }
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
      can_access_order_thread: {
        Args: { p_order_id: string }
        Returns: boolean
      }
      disablelongtransactions: { Args: never; Returns: string }
      dispatch_sweep: { Args: never; Returns: number }
      dispatch_watchdog: { Args: never; Returns: undefined }
      driver_ping: {
        Args: { p_lat: number; p_lng: number; p_status?: string }
        Returns: undefined
      }
      driver_respond: {
        Args: { p_accept: boolean; p_assignment_id: string }
        Returns: undefined
      }
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
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      generate_order_short_code: { Args: never; Returns: string }
      generate_referral_code: { Args: never; Returns: string }
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
      has_completed_order: { Args: { p_user: string }; Returns: boolean }
      is_merchant_staff: { Args: { p_restaurant_id: string }; Returns: boolean }
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
      longtransactionsenabled: { Args: never; Returns: boolean }
      loyalty_tier_sweep: { Args: never; Returns: number }
      mark_cod_collected: {
        Args: { p_amount: number; p_order_id: string }
        Returns: undefined
      }
      mark_order_thread_read: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      mark_support_thread_read: {
        Args: { p_user_id?: string }
        Returns: undefined
      }
      my_credit_balance: { Args: never; Returns: number }
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
      my_referral_code: { Args: never; Returns: string }
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
      ops_alert: { Args: { p_text: string }; Returns: undefined }
      place_order: {
        Args: {
          p_address_id: string
          p_cart: Json
          p_customer_phone?: string
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
      quote_delivery_fee: {
        Args: {
          p_dropoff: unknown
          p_restaurant_id: string
          p_subtotal?: number
        }
        Returns: number
      }
      reconcile_stale_card_orders: { Args: never; Returns: number }
      redeem_credit: { Args: { p_amount_egp: number }; Returns: string }
      redeem_points: { Args: { p_points: number }; Returns: string }
      reply_support_message: {
        Args: { p_body: string; p_user_id: string }
        Returns: {
          author_id: string | null
          body: string
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
      resolve_zone: {
        Args: { p_geo: unknown }
        Returns: Database["public"]["Enums"]["zone_type"]
      }
      resolve_zone_nearest: {
        Args: { p_geo: unknown }
        Returns: Database["public"]["Enums"]["zone_type"]
      }
      rider_snapshot: { Args: { p_driver_id: string }; Returns: Json }
      send_order_message: {
        Args: { p_body: string; p_order_id: string }
        Returns: {
          body: string
          created_at: string
          id: string
          order_id: string
          read_at: string | null
          sender_id: string
          sender_role: Database["public"]["Enums"]["app_role"]
        }
        SetofOptions: {
          from: "*"
          to: "order_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      send_support_message: {
        Args: { p_body: string }
        Returns: {
          author_id: string | null
          body: string
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
      validate_promo: {
        Args: { p_code: string; p_subtotal: number }
        Returns: number
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
      locale_type: "en" | "ar" | "ru" | "it" | "de"
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
      locale_type: ["en", "ar", "ru", "it", "de"],
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
