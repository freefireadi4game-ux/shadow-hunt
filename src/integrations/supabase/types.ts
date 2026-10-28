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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      capture_reports: {
        Row: {
          id: string
          match_id: string
          reported_at: string
          reporter_id: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          target_id: string
        }
        Insert: {
          id?: string
          match_id: string
          reported_at?: string
          reporter_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          target_id: string
        }
        Update: {
          id?: string
          match_id?: string
          reported_at?: string
          reporter_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "capture_reports_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      location_reveals: {
        Row: {
          accuracy_m: number | null
          id: string
          kind: string
          lat: number | null
          lng: number | null
          match_id: string
          revealed_at: string
          user_id: string
        }
        Insert: {
          accuracy_m?: number | null
          id?: string
          kind: string
          lat?: number | null
          lng?: number | null
          match_id: string
          revealed_at?: string
          user_id: string
        }
        Update: {
          accuracy_m?: number | null
          id?: string
          kind?: string
          lat?: number | null
          lng?: number | null
          match_id?: string
          revealed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_reveals_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      match_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: number
          match_id: string
          payload: Json
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: never
          match_id: string
          payload?: Json
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: never
          match_id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "match_events_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      match_participants: {
        Row: {
          captures_made: number
          id: string
          joined_at: string
          last_seen_at: string
          match_id: string
          ready: boolean
          role: string | null
          status: string
          survival_seconds: number | null
          user_id: string
        }
        Insert: {
          captures_made?: number
          id?: string
          joined_at?: string
          last_seen_at?: string
          match_id: string
          ready?: boolean
          role?: string | null
          status?: string
          survival_seconds?: number | null
          user_id: string
        }
        Update: {
          captures_made?: number
          id?: string
          joined_at?: string
          last_seen_at?: string
          match_id?: string
          ready?: boolean
          role?: string | null
          status?: string
          survival_seconds?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_participants_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      match_results: {
        Row: {
          completed_at: string
          match_id: string
          stats: Json
          winner: string
        }
        Insert: {
          completed_at?: string
          match_id: string
          stats?: Json
          winner: string
        }
        Update: {
          completed_at?: string
          match_id?: string
          stats?: Json
          winner?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_results_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: true
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          code: string
          completed_at: string | null
          created_at: string
          ends_at: string | null
          grace_ends_at: string | null
          host_id: string
          hunter_last_reveal_at: string | null
          id: string
          paused_at: string | null
          paused_total_seconds: number
          settings: Json
          shadow_last_ping_at: string | null
          started_at: string | null
          status: string
          winner: string | null
          zone_center_lat: number | null
          zone_center_lng: number | null
          zone_initial_radius_m: number | null
          zone_last_shrink_at: string | null
          zone_min_radius_m: number | null
          zone_radius_m: number | null
        }
        Insert: {
          code: string
          completed_at?: string | null
          created_at?: string
          ends_at?: string | null
          grace_ends_at?: string | null
          host_id: string
          hunter_last_reveal_at?: string | null
          id?: string
          paused_at?: string | null
          paused_total_seconds?: number
          settings?: Json
          shadow_last_ping_at?: string | null
          started_at?: string | null
          status?: string
          winner?: string | null
          zone_center_lat?: number | null
          zone_center_lng?: number | null
          zone_initial_radius_m?: number | null
          zone_last_shrink_at?: string | null
          zone_min_radius_m?: number | null
          zone_radius_m?: number | null
        }
        Update: {
          code?: string
          completed_at?: string | null
          created_at?: string
          ends_at?: string | null
          grace_ends_at?: string | null
          host_id?: string
          hunter_last_reveal_at?: string | null
          id?: string
          paused_at?: string | null
          paused_total_seconds?: number
          settings?: Json
          shadow_last_ping_at?: string | null
          started_at?: string | null
          status?: string
          winner?: string | null
          zone_center_lat?: number | null
          zone_center_lng?: number | null
          zone_initial_radius_m?: number | null
          zone_last_shrink_at?: string | null
          zone_min_radius_m?: number | null
          zone_radius_m?: number | null
        }
        Relationships: []
      }
      player_positions: {
        Row: {
          accuracy_m: number | null
          flag_reason: string | null
          flagged: boolean
          heading: number | null
          lat: number
          lng: number
          match_id: string
          recorded_at: string
          speed_mps: number | null
          user_id: string
        }
        Insert: {
          accuracy_m?: number | null
          flag_reason?: string | null
          flagged?: boolean
          heading?: number | null
          lat: number
          lng: number
          match_id: string
          recorded_at?: string
          speed_mps?: number | null
          user_id: string
        }
        Update: {
          accuracy_m?: number | null
          flag_reason?: string | null
          flagged?: boolean
          heading?: number | null
          lat?: number
          lng?: number
          match_id?: string
          recorded_at?: string
          speed_mps?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_positions_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          username: string
        }
        Insert: {
          created_at?: string
          id: string
          username: string
        }
        Update: {
          created_at?: string
          id?: string
          username?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      complete_match: {
        Args: { _match: string; _winner: string }
        Returns: undefined
      }
      create_match: { Args: { _settings?: Json }; Returns: Json }
      haversine_m: {
        Args: { _lat1: number; _lat2: number; _lng1: number; _lng2: number }
        Returns: number
      }
      hn_settings: { Args: { _s: Json }; Returns: Json }
      join_match: { Args: { _code: string }; Returns: string }
      leave_match: { Args: { _match: string }; Returns: undefined }
      randomize_roles: { Args: { _match: string }; Returns: undefined }
      set_participant_role: {
        Args: { _match: string; _role: string; _target: string }
        Returns: undefined
      }
      set_ready: {
        Args: { _match: string; _ready: boolean }
        Returns: undefined
      }
      start_match: {
        Args: { _center_lat: number; _center_lng: number; _match: string }
        Returns: undefined
      }
      submit_position: {
        Args: {
          _accuracy: number
          _heading: number
          _lat: number
          _lng: number
          _match: string
          _speed: number
        }
        Returns: string
      }
      tick_match: { Args: { _match: string }; Returns: Json }
      update_match_settings: {
        Args: { _match: string; _settings: Json }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
