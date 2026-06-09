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
      ajustes_caixa: {
        Row: {
          aplicado_em: string
          codigo_posicao: string
          codigo_produto: string
          criterio: string
          embal: number
          id: string
          inventario_id: string
          leitura_id: string
          numero_contagem: number
          quantidade_antiga: number
          quantidade_nova: number
        }
        Insert: {
          aplicado_em?: string
          codigo_posicao: string
          codigo_produto: string
          criterio: string
          embal: number
          id?: string
          inventario_id: string
          leitura_id: string
          numero_contagem: number
          quantidade_antiga: number
          quantidade_nova: number
        }
        Update: {
          aplicado_em?: string
          codigo_posicao?: string
          codigo_produto?: string
          criterio?: string
          embal?: number
          id?: string
          inventario_id?: string
          leitura_id?: string
          numero_contagem?: number
          quantidade_antiga?: number
          quantidade_nova?: number
        }
        Relationships: [
          {
            foreignKeyName: "ajustes_caixa_inventario_id_fkey"
            columns: ["inventario_id"]
            isOneToOne: false
            referencedRelation: "inventarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ajustes_caixa_leitura_id_fkey"
            columns: ["leitura_id"]
            isOneToOne: true
            referencedRelation: "leituras"
            referencedColumns: ["id"]
          },
        ]
      }
      estoque_wms_snapshot: {
        Row: {
          capturado_em: string
          codigo_posicao: string
          descricao: string | null
          dt_validade: string | null
          ean: string | null
          id: string
          inventario_id: string
          lote: string | null
          qtde_embal: number | null
          qtde_estoque: number | null
          qtde_unidades: number
          raw: Json | null
          sku: string
        }
        Insert: {
          capturado_em?: string
          codigo_posicao: string
          descricao?: string | null
          dt_validade?: string | null
          ean?: string | null
          id?: string
          inventario_id: string
          lote?: string | null
          qtde_embal?: number | null
          qtde_estoque?: number | null
          qtde_unidades?: number
          raw?: Json | null
          sku: string
        }
        Update: {
          capturado_em?: string
          codigo_posicao?: string
          descricao?: string | null
          dt_validade?: string | null
          ean?: string | null
          id?: string
          inventario_id?: string
          lote?: string | null
          qtde_embal?: number | null
          qtde_estoque?: number | null
          qtde_unidades?: number
          raw?: Json | null
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "estoque_wms_snapshot_inventario_id_fkey"
            columns: ["inventario_id"]
            isOneToOne: false
            referencedRelation: "inventarios"
            referencedColumns: ["id"]
          },
        ]
      }
      inventarios: {
        Row: {
          criado_em: string
          criado_por: string | null
          descricao: string | null
          encerrado_em: string | null
          id: string
          nome: string
          status: string
          wms_sincronizado_em: string | null
        }
        Insert: {
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          encerrado_em?: string | null
          id?: string
          nome: string
          status?: string
          wms_sincronizado_em?: string | null
        }
        Update: {
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          encerrado_em?: string | null
          id?: string
          nome?: string
          status?: string
          wms_sincronizado_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventarios_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "operadores"
            referencedColumns: ["id"]
          },
        ]
      }
      itens_pedidos_sap: {
        Row: {
          atualizado_em: string
          descricao: string | null
          id: string
          pedido: string | null
          qtde: number | null
          sku: string
        }
        Insert: {
          atualizado_em?: string
          descricao?: string | null
          id?: string
          pedido?: string | null
          qtde?: number | null
          sku: string
        }
        Update: {
          atualizado_em?: string
          descricao?: string | null
          id?: string
          pedido?: string | null
          qtde?: number | null
          sku?: string
        }
        Relationships: []
      }
      leituras: {
        Row: {
          codigo_posicao: string
          codigo_produto: string
          id: string
          inventario_id: string
          lido_em: string
          numero_contagem: number
          observacao: string | null
          operador_id: string | null
          quantidade: number
        }
        Insert: {
          codigo_posicao: string
          codigo_produto: string
          id?: string
          inventario_id: string
          lido_em?: string
          numero_contagem?: number
          observacao?: string | null
          operador_id?: string | null
          quantidade: number
        }
        Update: {
          codigo_posicao?: string
          codigo_produto?: string
          id?: string
          inventario_id?: string
          lido_em?: string
          numero_contagem?: number
          observacao?: string | null
          operador_id?: string | null
          quantidade?: number
        }
        Relationships: [
          {
            foreignKeyName: "leituras_inventario_id_fkey"
            columns: ["inventario_id"]
            isOneToOne: false
            referencedRelation: "inventarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leituras_operador_id_fkey"
            columns: ["operador_id"]
            isOneToOne: false
            referencedRelation: "operadores"
            referencedColumns: ["id"]
          },
        ]
      }
      leituras_bkp_dup1a_20260605: {
        Row: {
          backup_em: string | null
          codigo_posicao: string | null
          codigo_produto: string | null
          id: string
          inventario_id: string | null
          lido_em: string | null
          numero_contagem_antigo: number | null
          numero_contagem_novo: number | null
        }
        Insert: {
          backup_em?: string | null
          codigo_posicao?: string | null
          codigo_produto?: string | null
          id: string
          inventario_id?: string | null
          lido_em?: string | null
          numero_contagem_antigo?: number | null
          numero_contagem_novo?: number | null
        }
        Update: {
          backup_em?: string | null
          codigo_posicao?: string | null
          codigo_produto?: string | null
          id?: string
          inventario_id?: string | null
          lido_em?: string | null
          numero_contagem_antigo?: number | null
          numero_contagem_novo?: number | null
        }
        Relationships: []
      }
      operadores: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          nome: string
          pin: string | null
          tem_pin: boolean | null
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome: string
          pin?: string | null
          tem_pin?: boolean | null
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome?: string
          pin?: string | null
          tem_pin?: boolean | null
        }
        Relationships: []
      }
      produto_eans: {
        Row: {
          ean: string
          sku: string
          tipo: string | null
        }
        Insert: {
          ean: string
          sku: string
          tipo?: string | null
        }
        Update: {
          ean?: string
          sku?: string
          tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "produto_eans_sku_fkey"
            columns: ["sku"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["sku"]
          },
        ]
      }
      produtos: {
        Row: {
          atualizado_em: string
          criado_em: string
          descricao: string
          sku: string
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          descricao: string
          sku: string
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          descricao?: string
          sku?: string
        }
        Relationships: []
      }
      recontagens_solicitadas: {
        Row: {
          codigo_posicao: string
          codigo_produto: string
          id: string
          inventario_id: string
          numero_contagem_origem: number
          observacao: string | null
          solicitado_em: string
          solicitado_por: string | null
        }
        Insert: {
          codigo_posicao: string
          codigo_produto: string
          id?: string
          inventario_id: string
          numero_contagem_origem?: number
          observacao?: string | null
          solicitado_em?: string
          solicitado_por?: string | null
        }
        Update: {
          codigo_posicao?: string
          codigo_produto?: string
          id?: string
          inventario_id?: string
          numero_contagem_origem?: number
          observacao?: string | null
          solicitado_em?: string
          solicitado_por?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      verificar_pin_operador: {
        Args: { p_operador_id: string; p_pin: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
