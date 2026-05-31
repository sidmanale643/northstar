export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      sessions: {
        Row: {
          id: string
          created_at: string
          ended_at: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          ended_at?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          ended_at?: string | null
        }
        Relationships: []
      }
      traces: {
        Row: {
          id: string
          session_id: string
          run_id: string
          created_at: string
        }
        Insert: {
          id?: string
          session_id: string
          run_id?: string
          created_at?: string
        }
        Update: {
          id?: string
          session_id?: string
          run_id?: string
          created_at?: string
        }
        Relationships: []
      }
      tool_calls: {
        Row: {
          id: string
          trace_id: string
          name: string | null
          params: Json
          output: string | null
          created_at: string
        }
        Insert: {
          id?: string
          trace_id: string
          name?: string | null
          params?: Json
          output?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          trace_id?: string
          name?: string | null
          params?: Json
          output?: string | null
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      create_or_rotate_project_api_key: {
        Args: {
          p_project_id: string
          p_project_name: string
          p_key_id: string
          p_key_hash: string
        }
        Returns: {
          result_project_id: string
          result_created_at: string
        }[]
      }
      get_session_stats: {
        Args: Record<string, never>
        Returns: {
          session_id: string
          trace_count: number
          tool_call_count: number
        }[]
      }
    }
  }
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']
