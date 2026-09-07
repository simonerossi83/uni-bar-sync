export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      app_rate_limits: {
        Row: {
          identifier_hash: string;
          request_count: number;
          scope: string;
          updated_at: string;
          window_started_at: string;
        };
        Insert: {
          identifier_hash: string;
          request_count: number;
          scope: string;
          updated_at: string;
          window_started_at: string;
        };
        Update: {
          identifier_hash?: string;
          request_count?: number;
          scope?: string;
          updated_at?: string;
          window_started_at?: string;
        };
        Relationships: [];
      };
      menu_items: {
        Row: {
          available: boolean;
          category: string;
          created_at: string;
          description: string;
          id: string;
          initial_stock: number;
          name: string;
          price: number;
          sort_order: number;
          stock_quantity: number;
        };
        Insert: {
          available?: boolean;
          category: string;
          created_at?: string;
          description?: string;
          id?: string;
          initial_stock?: number;
          name: string;
          price: number;
          sort_order?: number;
          stock_quantity?: number;
        };
        Update: {
          available?: boolean;
          category?: string;
          created_at?: string;
          description?: string;
          id?: string;
          initial_stock?: number;
          name?: string;
          price?: number;
          sort_order?: number;
          stock_quantity?: number;
        };
        Relationships: [];
      };
      order_items: {
        Row: {
          created_at: string;
          id: string;
          menu_item_id: string | null;
          name: string;
          order_id: string;
          quantity: number;
          unit_price: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          menu_item_id?: string | null;
          name: string;
          order_id: string;
          quantity: number;
          unit_price: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          menu_item_id?: string | null;
          name?: string;
          order_id?: string;
          quantity?: number;
          unit_price?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_menu_item_id_fkey";
            columns: ["menu_item_id"];
            isOneToOne: false;
            referencedRelation: "menu_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          archived_at: string | null;
          client_request_id: string | null;
          created_at: string;
          customer_access_hash: string | null;
          estimated_ready_at: string | null;
          id: string;
          note: string | null;
          order_number: number;
          status: string;
          total: number;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          client_request_id?: string | null;
          created_at?: string;
          customer_access_hash?: string | null;
          estimated_ready_at?: string | null;
          id?: string;
          note?: string | null;
          order_number?: number;
          status?: string;
          total?: number;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          client_request_id?: string | null;
          created_at?: string;
          customer_access_hash?: string | null;
          estimated_ready_at?: string | null;
          id?: string;
          note?: string | null;
          order_number?: number;
          status?: string;
          total?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      advance_kitchen_batch: {
        Args: { p_preparation_seconds?: number };
        Returns: undefined;
      };
      create_bar_order: {
        Args: { p_client_request_id: string; p_lines: Json; p_note: string | null };
        Returns: {
          archived_at: string | null;
          created_at: string;
          estimated_ready_at: string | null;
          id: string;
          note: string | null;
          order_number: number;
          status: string;
          total: number;
          updated_at: string;
        }[];
      };
      create_bar_order_secured: {
        Args: {
          p_client_request_id: string;
          p_customer_access_hash: string;
          p_lines: Json;
          p_note: string | null;
        };
        Returns: {
          archived_at: string | null;
          created_at: string;
          estimated_ready_at: string | null;
          id: string;
          note: string | null;
          order_number: number;
          status: string;
          total: number;
          updated_at: string;
        }[];
      };
      consume_rate_limit: {
        Args: {
          p_identifier_hash: string;
          p_max_requests: number;
          p_scope: string;
          p_window_seconds: number;
        };
        Returns: {
          allowed: boolean;
          retry_after_seconds: number;
        }[];
      };
      get_customer_order_status: {
        Args: { p_access_token: string; p_order_id: string };
        Returns: {
          archived_at: string | null;
          estimated_ready_at: string | null;
          id: string;
          status: string;
          updated_at: string;
        }[];
      };
      restore_menu_stock: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
