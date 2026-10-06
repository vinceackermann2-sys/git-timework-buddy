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
      agent_webhook_endpoints: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          token: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          token: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          token?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: []
      }
      agent_webhook_events: {
        Row: {
          agent_id: string
          attempt_count: number
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          delivered_at: string | null
          delivery_status: string
          endpoint_id: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          payload: Json | null
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          agent_id: string
          attempt_count?: number
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_status?: string
          endpoint_id: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          payload?: Json | null
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          agent_id?: string
          attempt_count?: number
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          delivery_status?: string
          endpoint_id?: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          payload?: Json | null
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_webhook_events_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "agent_webhook_endpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          provider: string | null
          provider_message_id: string | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          provider?: string | null
          provider_message_id?: string | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          provider?: string | null
          provider_message_id?: string | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      email_webhook_events: {
        Row: {
          event_created_at: string | null
          event_type: string
          payload: Json
          provider_message_id: string | null
          received_at: string
          svix_id: string
        }
        Insert: {
          event_created_at?: string | null
          event_type: string
          payload?: Json
          provider_message_id?: string | null
          received_at?: string
          svix_id: string
        }
        Update: {
          event_created_at?: string | null
          event_type?: string
          payload?: Json
          provider_message_id?: string | null
          received_at?: string
          svix_id?: string
        }
        Relationships: []
      }
      product_waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
          product: string
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          product: string
          source?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          product?: string
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          id: string
          interests: string | null
          last_cloud_sync_at: string | null
          name: string | null
          onboarded: boolean
          storage_preference: string
          updated_at: string
          user_id: string
          work_stack: Json | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          interests?: string | null
          last_cloud_sync_at?: string | null
          name?: string | null
          onboarded?: boolean
          storage_preference?: string
          updated_at?: string
          user_id: string
          work_stack?: Json | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          interests?: string | null
          last_cloud_sync_at?: string | null
          name?: string | null
          onboarded?: boolean
          storage_preference?: string
          updated_at?: string
          user_id?: string
          work_stack?: Json | null
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          ai_content: string | null
          app_version: string | null
          attachments: Json
          category: string
          created_at: string
          description: string
          diagnostics: string | null
          environment: string | null
          id: string
          platform: string | null
          priority: string
          reporter_email: string
          reporter_name: string
          source: string
          status: string
          ticket_number: number
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          ai_content?: string | null
          app_version?: string | null
          attachments?: Json
          category: string
          created_at?: string
          description: string
          diagnostics?: string | null
          environment?: string | null
          id?: string
          platform?: string | null
          priority?: string
          reporter_email: string
          reporter_name: string
          source?: string
          status?: string
          ticket_number?: number
          title: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          ai_content?: string | null
          app_version?: string | null
          attachments?: Json
          category?: string
          created_at?: string
          description?: string
          diagnostics?: string | null
          environment?: string | null
          id?: string
          platform?: string | null
          priority?: string
          reporter_email?: string
          reporter_name?: string
          source?: string
          status?: string
          ticket_number?: number
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      timewarp_agent_action_receipts: {
        Row: {
          action_id: string
          action_index: number
          arguments_hash: string
          completed_at: string | null
          error: string | null
          execution_key: string
          external_result_id: string | null
          id: string
          operation_id: string
          result: Json | null
          run_id: string | null
          started_at: string
          status: string
          tool: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          action_id: string
          action_index: number
          arguments_hash: string
          completed_at?: string | null
          error?: string | null
          execution_key: string
          external_result_id?: string | null
          id?: string
          operation_id: string
          result?: Json | null
          run_id?: string | null
          started_at?: string
          status?: string
          tool: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          action_id?: string
          action_index?: number
          arguments_hash?: string
          completed_at?: string | null
          error?: string | null
          execution_key?: string
          external_result_id?: string | null
          id?: string
          operation_id?: string
          result?: Json | null
          run_id?: string | null
          started_at?: string
          status?: string
          tool?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_agent_action_receipts_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "timewarp_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timewarp_agent_action_receipts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "timewarp_operation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timewarp_agent_action_receipts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_agent_ai_reservations: {
        Row: {
          created_at: string
          credits: number
          id: string
          settlement: Json | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credits: number
          id: string
          settlement?: Json | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          credits?: number
          id?: string
          settlement?: Json | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      timewarp_agent_artifacts: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          mime_type: string
          name: string
          run_id: string | null
          sha256: string
          size: number
          source_path: string
          source_scope: string
          storage_path: string
          user_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id: string
          mime_type: string
          name: string
          run_id?: string | null
          sha256: string
          size: number
          source_path: string
          source_scope: string
          storage_path: string
          user_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          mime_type?: string
          name?: string
          run_id?: string | null
          sha256?: string
          size?: number
          source_path?: string
          source_scope?: string
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_agent_artifacts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timewarp_agent_artifacts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_agent_card_payment_requests: {
        Row: {
          agent_id: string
          amount_cents: number
          approved_at: string | null
          card_brand: string
          card_exp_month: number
          card_exp_year: number
          card_last4: string
          card_payment_method_id: string
          completed_at: string | null
          created_at: string
          currency: string
          expires_at: string
          failure_code: string | null
          id: string
          merchant_domain: string
          merchant_name: string
          merchant_origin: string
          merchant_url: string
          purpose: string
          status: string
          updated_at: string
          user_id: string
          verification_status: string
        }
        Insert: {
          agent_id: string
          amount_cents: number
          approved_at?: string | null
          card_brand: string
          card_exp_month: number
          card_exp_year: number
          card_last4: string
          card_payment_method_id: string
          completed_at?: string | null
          created_at?: string
          currency: string
          expires_at: string
          failure_code?: string | null
          id?: string
          merchant_domain: string
          merchant_name: string
          merchant_origin: string
          merchant_url: string
          purpose: string
          status?: string
          updated_at?: string
          user_id: string
          verification_status?: string
        }
        Update: {
          agent_id?: string
          amount_cents?: number
          approved_at?: string | null
          card_brand?: string
          card_exp_month?: number
          card_exp_year?: number
          card_last4?: string
          card_payment_method_id?: string
          completed_at?: string | null
          created_at?: string
          currency?: string
          expires_at?: string
          failure_code?: string | null
          id?: string
          merchant_domain?: string
          merchant_name?: string
          merchant_origin?: string
          merchant_url?: string
          purpose?: string
          status?: string
          updated_at?: string
          user_id?: string
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_agent_card_payment_requests_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timewarp_agent_card_requests_owner_fk"
            columns: ["agent_id", "user_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agents"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      timewarp_agent_card_policies: {
        Row: {
          agent_id: string
          created_at: string
          currency: string
          daily_limit_cents: number
          monthly_limit_cents: number
          updated_at: string
          user_id: string
          weekly_limit_cents: number
        }
        Insert: {
          agent_id: string
          created_at?: string
          currency: string
          daily_limit_cents: number
          monthly_limit_cents: number
          updated_at?: string
          user_id: string
          weekly_limit_cents: number
        }
        Update: {
          agent_id?: string
          created_at?: string
          currency?: string
          daily_limit_cents?: number
          monthly_limit_cents?: number
          updated_at?: string
          user_id?: string
          weekly_limit_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_agent_card_policies_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "timewarp_personal_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timewarp_agent_card_policies_owner_fk"
            columns: ["agent_id", "user_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agents"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      timewarp_agent_cards: {
        Row: {
          active: boolean
          brand: string
          created_at: string
          exp_month: number
          exp_year: number
          last4: string
          stripe_payment_method_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          brand: string
          created_at?: string
          exp_month: number
          exp_year: number
          last4: string
          stripe_payment_method_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          brand?: string
          created_at?: string
          exp_month?: number
          exp_year?: number
          last4?: string
          stripe_payment_method_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      timewarp_agent_compute_clocks: {
        Row: {
          compute_id: string
          metered_at: string
          user_id: string
        }
        Insert: {
          compute_id: string
          metered_at: string
          user_id: string
        }
        Update: {
          compute_id?: string
          metered_at?: string
          user_id?: string
        }
        Relationships: []
      }
      timewarp_agent_compute_leases: {
        Row: {
          compute_id: string
          holder: string
          lease_expires_at: string
          updated_at: string
        }
        Insert: {
          compute_id: string
          holder: string
          lease_expires_at: string
          updated_at?: string
        }
        Update: {
          compute_id?: string
          holder?: string
          lease_expires_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      timewarp_agent_desktop_sessions: {
        Row: {
          agent_id: string
          compute_id: string
          credits_per_second: number | null
          display_number: number
          heartbeat_at: string
          metered_at: string
          port: number
          provider_usd_per_second: number | null
          revoked_at: string | null
          runtime_version: number
          session_id: string
          started_at: string
          team_id: string | null
          updated_at: string
          user_id: string
          vnc_port: number
        }
        Insert: {
          agent_id: string
          compute_id: string
          credits_per_second?: number | null
          display_number: number
          heartbeat_at?: string
          metered_at?: string
          port: number
          provider_usd_per_second?: number | null
          revoked_at?: string | null
          runtime_version?: number
          session_id?: string
          started_at?: string
          team_id?: string | null
          updated_at?: string
          user_id: string
          vnc_port: number
        }
        Update: {
          agent_id?: string
          compute_id?: string
          credits_per_second?: number | null
          display_number?: number
          heartbeat_at?: string
          metered_at?: string
          port?: number
          provider_usd_per_second?: number | null
          revoked_at?: string | null
          runtime_version?: number
          session_id?: string
          started_at?: string
          team_id?: string | null
          updated_at?: string
          user_id?: string
          vnc_port?: number
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_agent_desktop_sessions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timewarp_agent_desktop_sessions_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "timewarp_agent_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_agent_jobs: {
        Row: {
          agent_id: string
          available_at: string
          checkpoint: Json
          deadline: string
          holder: string | null
          lease_until: string | null
          payload: Json
          phase: string
          request_id: string
          result: Json
          revision: number
          run_id: string
          status: string
          task_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id: string
          available_at?: string
          checkpoint?: Json
          deadline?: string
          holder?: string | null
          lease_until?: string | null
          payload: Json
          phase?: string
          request_id: string
          result?: Json
          revision?: number
          run_id: string
          status?: string
          task_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          available_at?: string
          checkpoint?: Json
          deadline?: string
          holder?: string | null
          lease_until?: string | null
          payload?: Json
          phase?: string
          request_id?: string
          result?: Json
          revision?: number
          run_id?: string
          status?: string
          task_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_agent_jobs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timewarp_agent_jobs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "timewarp_personal_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timewarp_agent_jobs_run_id_user_id_agent_id_fkey"
            columns: ["run_id", "user_id", "agent_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agent_runs"
            referencedColumns: ["id", "user_id", "agent_id"]
          },
        ]
      }
      timewarp_agent_mail_messages: {
        Row: {
          agent_id: string
          attachments: Json
          cc: Json
          created_at: string
          deleted_at: string | null
          delivery_error: string | null
          delivery_status: string | null
          direction: string
          html_body: string | null
          id: string
          mailbox_folder: string
          provider_message_id: string
          read_at: string | null
          recipients: Json
          sender: Json
          sent_at: string
          subject: string | null
          text_body: string | null
          user_id: string
        }
        Insert: {
          agent_id: string
          attachments?: Json
          cc?: Json
          created_at?: string
          deleted_at?: string | null
          delivery_error?: string | null
          delivery_status?: string | null
          direction: string
          html_body?: string | null
          id: string
          mailbox_folder?: string
          provider_message_id: string
          read_at?: string | null
          recipients?: Json
          sender?: Json
          sent_at?: string
          subject?: string | null
          text_body?: string | null
          user_id: string
        }
        Update: {
          agent_id?: string
          attachments?: Json
          cc?: Json
          created_at?: string
          deleted_at?: string | null
          delivery_error?: string | null
          delivery_status?: string | null
          direction?: string
          html_body?: string | null
          id?: string
          mailbox_folder?: string
          provider_message_id?: string
          read_at?: string | null
          recipients?: Json
          sender?: Json
          sent_at?: string
          subject?: string | null
          text_body?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_agent_mail_messages_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_agent_messages: {
        Row: {
          client_message_id: string
          created_at: string
          id: string
          message: string
          recipient_agent_id: string
          sender_agent_id: string
          source_thread_id: string | null
          user_id: string
        }
        Insert: {
          client_message_id: string
          created_at?: string
          id?: string
          message: string
          recipient_agent_id: string
          sender_agent_id: string
          source_thread_id?: string | null
          user_id: string
        }
        Update: {
          client_message_id?: string
          created_at?: string
          id?: string
          message?: string
          recipient_agent_id?: string
          sender_agent_id?: string
          source_thread_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_agent_messages_user_id_recipient_agent_id_fkey"
            columns: ["user_id", "recipient_agent_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agents"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "timewarp_agent_messages_user_id_sender_agent_id_fkey"
            columns: ["user_id", "sender_agent_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agents"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      timewarp_agent_payment_customers: {
        Row: {
          created_at: string
          stripe_customer_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          stripe_customer_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          stripe_customer_id?: string
          user_id?: string
        }
        Relationships: []
      }
      timewarp_agent_shared_memory_entries: {
        Row: {
          author_agent_id: string | null
          content: string
          created_at: string
          id: string
          provenance: Json
          team_id: string
          title: string
          updated_at: string
        }
        Insert: {
          author_agent_id?: string | null
          content: string
          created_at?: string
          id?: string
          provenance?: Json
          team_id: string
          title: string
          updated_at?: string
        }
        Update: {
          author_agent_id?: string | null
          content?: string
          created_at?: string
          id?: string
          provenance?: Json
          team_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_agent_shared_memory_entries_author_agent_id_fkey"
            columns: ["author_agent_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timewarp_agent_shared_memory_entries_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "timewarp_agent_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_agent_shares: {
        Row: {
          accepted_at: string | null
          agent_name: string
          created_at: string
          id: string
          recipient_user_id: string
          sender_user_id: string
          source_agent_id: string
          source_agent_version: number
          status: string
          template: Json
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          agent_name: string
          created_at?: string
          id?: string
          recipient_user_id: string
          sender_user_id: string
          source_agent_id: string
          source_agent_version?: number
          status?: string
          template: Json
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          agent_name?: string
          created_at?: string
          id?: string
          recipient_user_id?: string
          sender_user_id?: string
          source_agent_id?: string
          source_agent_version?: number
          status?: string
          template?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_agent_shares_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_agent_teams: {
        Row: {
          compute_credits_spent: number
          compute_metered_at: string | null
          created_at: string
          id: string
          name: string
          shared_box_id: string | null
          shared_box_status: string | null
          shared_compute_id: string | null
          shared_compute_provider: string
          shared_compute_status: string | null
          shared_email: string | null
          shared_files_root: string
          shared_inbox_id: string | null
          shared_mail_owner_agent_id: string | null
          shared_memory: Json
          shared_phone: Json
          shared_wallet: Json
          shared_wallet_owner_agent_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          compute_credits_spent?: number
          compute_metered_at?: string | null
          created_at?: string
          id?: string
          name?: string
          shared_box_id?: string | null
          shared_box_status?: string | null
          shared_compute_id?: string | null
          shared_compute_provider?: string
          shared_compute_status?: string | null
          shared_email?: string | null
          shared_files_root?: string
          shared_inbox_id?: string | null
          shared_mail_owner_agent_id?: string | null
          shared_memory?: Json
          shared_phone?: Json
          shared_wallet?: Json
          shared_wallet_owner_agent_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          compute_credits_spent?: number
          compute_metered_at?: string | null
          created_at?: string
          id?: string
          name?: string
          shared_box_id?: string | null
          shared_box_status?: string | null
          shared_compute_id?: string | null
          shared_compute_provider?: string
          shared_compute_status?: string | null
          shared_email?: string | null
          shared_files_root?: string
          shared_inbox_id?: string | null
          shared_mail_owner_agent_id?: string | null
          shared_memory?: Json
          shared_phone?: Json
          shared_wallet?: Json
          shared_wallet_owner_agent_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      timewarp_ai_cost_events: {
        Row: {
          cost_usd: number
          credits_charged: number | null
          id: number
          model: string
          occurred_at: string
          paid_with: string
          prompt_tokens: number
          response_tokens: number
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          cost_usd?: number
          credits_charged?: number | null
          id?: number
          model?: string
          occurred_at?: string
          paid_with?: string
          prompt_tokens?: number
          response_tokens?: number
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          cost_usd?: number
          credits_charged?: number | null
          id?: number
          model?: string
          occurred_at?: string
          paid_with?: string
          prompt_tokens?: number
          response_tokens?: number
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_ai_cost_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_billing_customers: {
        Row: {
          created_at: string
          stripe_customer_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          stripe_customer_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          stripe_customer_id?: string
          user_id?: string
        }
        Relationships: []
      }
      timewarp_chat_sessions: {
        Row: {
          artifacts: Json
          context_attachments: Json
          context_usage: Json | null
          created_at: string
          id: string
          local_id: string
          messages: Json
          project_id: string | null
          scope_key: string
          sort_index: number
          starred: boolean
          title: string
          tokens_used: number | null
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          artifacts?: Json
          context_attachments?: Json
          context_usage?: Json | null
          created_at?: string
          id?: string
          local_id: string
          messages?: Json
          project_id?: string | null
          scope_key: string
          sort_index?: number
          starred?: boolean
          title?: string
          tokens_used?: number | null
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          artifacts?: Json
          context_attachments?: Json
          context_usage?: Json | null
          created_at?: string
          id?: string
          local_id?: string
          messages?: Json
          project_id?: string | null
          scope_key?: string
          sort_index?: number
          starred?: boolean
          title?: string
          tokens_used?: number | null
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_chat_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_cloud_mcp_credentials: {
        Row: {
          connection_key: string
          created_at: string
          encrypted_headers: string
          id: string
          initialization_vector: string
          scope_key: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          connection_key: string
          created_at?: string
          encrypted_headers: string
          id?: string
          initialization_vector: string
          scope_key: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          connection_key?: string
          created_at?: string
          encrypted_headers?: string
          id?: string
          initialization_vector?: string
          scope_key?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_cloud_mcp_credentials_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_cloud_snapshots: {
        Row: {
          business_dna: Json | null
          chats: Json
          created_at: string
          id: string
          knowledge: string
          profile: Json
          scope_key: string
          snapshot_version: number
          storage_objects: Json
          updated_at: string
          user_id: string
          work_stack: Json
          workspace_id: string | null
        }
        Insert: {
          business_dna?: Json | null
          chats?: Json
          created_at?: string
          id?: string
          knowledge?: string
          profile?: Json
          scope_key: string
          snapshot_version?: number
          storage_objects?: Json
          updated_at?: string
          user_id: string
          work_stack?: Json
          workspace_id?: string | null
        }
        Update: {
          business_dna?: Json | null
          chats?: Json
          created_at?: string
          id?: string
          knowledge?: string
          profile?: Json
          scope_key?: string
          snapshot_version?: number
          storage_objects?: Json
          updated_at?: string
          user_id?: string
          work_stack?: Json
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_cloud_snapshots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_cloud_sync_events: {
        Row: {
          created_at: string
          details: Json
          direction: string
          id: string
          scope_key: string | null
          status: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json
          direction: string
          id?: string
          scope_key?: string | null
          status: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json
          direction?: string
          id?: string
          scope_key?: string | null
          status?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_cloud_sync_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_credit_balances: {
        Row: {
          auto_recharge_enabled: boolean
          auto_recharge_pack_credits: number | null
          auto_recharge_threshold: number
          auto_recharge_user_id: string | null
          balance_credits: number
          created_at: string
          id: string
          owner_user_id: string
          recharge_claimed_at: string | null
          recharge_failed_at: string | null
          recharge_failures: number
          recharge_last_failure_ref: string | null
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          auto_recharge_enabled?: boolean
          auto_recharge_pack_credits?: number | null
          auto_recharge_threshold?: number
          auto_recharge_user_id?: string | null
          balance_credits?: number
          created_at?: string
          id?: string
          owner_user_id: string
          recharge_claimed_at?: string | null
          recharge_failed_at?: string | null
          recharge_failures?: number
          recharge_last_failure_ref?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          auto_recharge_enabled?: boolean
          auto_recharge_pack_credits?: number | null
          auto_recharge_threshold?: number
          auto_recharge_user_id?: string | null
          balance_credits?: number
          created_at?: string
          id?: string
          owner_user_id?: string
          recharge_claimed_at?: string | null
          recharge_failed_at?: string | null
          recharge_failures?: number
          recharge_last_failure_ref?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_credit_balances_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_credit_events: {
        Row: {
          cost_usd: number
          delta_credits: number
          id: number
          kind: string
          model: string
          occurred_at: string
          stripe_ref: string | null
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          cost_usd?: number
          delta_credits: number
          id?: number
          kind: string
          model?: string
          occurred_at?: string
          stripe_ref?: string | null
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          cost_usd?: number
          delta_credits?: number
          id?: number
          kind?: string
          model?: string
          occurred_at?: string
          stripe_ref?: string | null
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_credit_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_desktop_ai_settlements: {
        Row: {
          attempts: number
          cost_usd: number
          created_at: string
          input_tokens: number
          last_error_code: string | null
          model: string
          next_attempt_at: string
          outcome: string
          output_tokens: number
          reservation_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          cost_usd: number
          created_at?: string
          input_tokens: number
          last_error_code?: string | null
          model: string
          next_attempt_at?: string
          outcome: string
          output_tokens: number
          reservation_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          cost_usd?: number
          created_at?: string
          input_tokens?: number
          last_error_code?: string | null
          model?: string
          next_attempt_at?: string
          outcome?: string
          output_tokens?: number
          reservation_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_desktop_ai_settlements_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: true
            referencedRelation: "timewarp_agent_ai_reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_energy_agents: {
        Row: {
          archived: boolean
          conversation_id: string
          display_name: string
          id: string
          instructions: string
          is_default: boolean
          memory_mode: string | null
          sort_order: number
          starred: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          conversation_id: string
          display_name: string
          id?: string
          instructions?: string
          is_default?: boolean
          memory_mode?: string | null
          sort_order?: number
          starred?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          archived?: boolean
          conversation_id?: string
          display_name?: string
          id?: string
          instructions?: string
          is_default?: boolean
          memory_mode?: string | null
          sort_order?: number
          starred?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      timewarp_energy_conversations: {
        Row: {
          agent_id: string | null
          archived: boolean
          created_at: string
          id: string
          is_read: boolean
          model_settings: Json | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          archived?: boolean
          created_at?: string
          id?: string
          is_read?: boolean
          model_settings?: Json | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          archived?: boolean
          created_at?: string
          id?: string
          is_read?: boolean
          model_settings?: Json | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_energy_conversation_agent"
            columns: ["agent_id", "user_id"]
            isOneToOne: false
            referencedRelation: "timewarp_energy_agents"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      timewarp_energy_desktop_history: {
        Row: {
          agents: Json
          conversation: Json
          entries: Json
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agents?: Json
          conversation: Json
          entries?: Json
          id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agents?: Json
          conversation?: Json
          entries?: Json
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      timewarp_energy_runs: {
        Row: {
          attempts: number
          conversation_id: string
          created_at: string
          entry_sequence: number
          error: string | null
          id: string
          lease_id: string | null
          lease_until: string | null
          messages: Json
          model: string
          native_instructions: string
          native_reasoning: string
          prompt: string
          request_id: string
          result: string
          status: string
          steps: number
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          conversation_id: string
          created_at?: string
          entry_sequence?: never
          error?: string | null
          id?: string
          lease_id?: string | null
          lease_until?: string | null
          messages?: Json
          model?: string
          native_instructions?: string
          native_reasoning?: string
          prompt: string
          request_id: string
          result?: string
          status?: string
          steps?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          conversation_id?: string
          created_at?: string
          entry_sequence?: never
          error?: string | null
          id?: string
          lease_id?: string | null
          lease_until?: string | null
          messages?: Json
          model?: string
          native_instructions?: string
          native_reasoning?: string
          prompt?: string
          request_id?: string
          result?: string
          status?: string
          steps?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_energy_runs_conversation_id_user_id_fkey"
            columns: ["conversation_id", "user_id"]
            isOneToOne: false
            referencedRelation: "timewarp_energy_conversations"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      timewarp_energy_settings: {
        Row: {
          settings: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          settings?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          settings?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      timewarp_mcp_oauth_clients: {
        Row: {
          client_id: string
          client_name: string
          client_uri: string | null
          created_at: string
          grant_types: string[]
          metadata: Json
          redirect_uris: string[]
          response_types: string[]
          token_endpoint_auth_method: string
          updated_at: string
        }
        Insert: {
          client_id: string
          client_name?: string
          client_uri?: string | null
          created_at?: string
          grant_types?: string[]
          metadata?: Json
          redirect_uris: string[]
          response_types?: string[]
          token_endpoint_auth_method?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          client_name?: string
          client_uri?: string | null
          created_at?: string
          grant_types?: string[]
          metadata?: Json
          redirect_uris?: string[]
          response_types?: string[]
          token_endpoint_auth_method?: string
          updated_at?: string
        }
        Relationships: []
      }
      timewarp_mcp_oauth_codes: {
        Row: {
          client_id: string
          code_challenge: string
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          redirect_uri: string
          resource: string
          scopes: string[]
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          client_id: string
          code_challenge: string
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          redirect_uri: string
          resource: string
          scopes: string[]
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          client_id?: string
          code_challenge?: string
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          redirect_uri?: string
          resource?: string
          scopes?: string[]
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_mcp_oauth_codes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "timewarp_mcp_oauth_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "timewarp_mcp_oauth_codes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_mcp_oauth_requests: {
        Row: {
          client_id: string
          code_challenge: string
          code_challenge_method: string
          completed_at: string | null
          created_at: string
          expires_at: string
          id: string
          redirect_uri: string
          resource: string
          scopes: string[]
          state: string | null
          status: string
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          client_id: string
          code_challenge: string
          code_challenge_method?: string
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          redirect_uri: string
          resource: string
          scopes?: string[]
          state?: string | null
          status?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          client_id?: string
          code_challenge?: string
          code_challenge_method?: string
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          redirect_uri?: string
          resource?: string
          scopes?: string[]
          state?: string | null
          status?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_mcp_oauth_requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "timewarp_mcp_oauth_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "timewarp_mcp_oauth_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_mcp_oauth_tokens: {
        Row: {
          access_expires_at: string
          access_token_hash: string
          client_id: string
          created_at: string
          id: string
          last_used_at: string | null
          refresh_expires_at: string
          refresh_token_hash: string
          replaced_by: string | null
          resource: string
          revoked_at: string | null
          scopes: string[]
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          access_expires_at?: string
          access_token_hash: string
          client_id: string
          created_at?: string
          id?: string
          last_used_at?: string | null
          refresh_expires_at?: string
          refresh_token_hash: string
          replaced_by?: string | null
          resource: string
          revoked_at?: string | null
          scopes: string[]
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          access_expires_at?: string
          access_token_hash?: string
          client_id?: string
          created_at?: string
          id?: string
          last_used_at?: string | null
          refresh_expires_at?: string
          refresh_token_hash?: string
          replaced_by?: string | null
          resource?: string
          revoked_at?: string | null
          scopes?: string[]
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_mcp_oauth_tokens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "timewarp_mcp_oauth_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "timewarp_mcp_oauth_tokens_replaced_by_fkey"
            columns: ["replaced_by"]
            isOneToOne: false
            referencedRelation: "timewarp_mcp_oauth_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timewarp_mcp_oauth_tokens_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_memory_episodes: {
        Row: {
          created_at: string
          decisions_reached: Json
          id: string
          local_id: string
          outputs_created: Json
          scope_key: string
          source_chat_id: string
          summary: string
          tasks_completed: Json
          title: string | null
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          decisions_reached?: Json
          id?: string
          local_id: string
          outputs_created?: Json
          scope_key: string
          source_chat_id: string
          summary?: string
          tasks_completed?: Json
          title?: string | null
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          decisions_reached?: Json
          id?: string
          local_id?: string
          outputs_created?: Json
          scope_key?: string
          source_chat_id?: string
          summary?: string
          tasks_completed?: Json
          title?: string | null
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_memory_episodes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_memory_facts: {
        Row: {
          category: string
          confidence: number
          created_at: string
          effective_from: string | null
          effective_to: string | null
          id: string
          local_id: string
          predicate: string | null
          scope: string
          scope_key: string
          source: string
          source_ref: Json
          status: string
          subject: string | null
          supersedes_id: string | null
          text: string
          updated_at: string
          user_id: string
          value: string | null
          workspace_id: string | null
        }
        Insert: {
          category?: string
          confidence?: number
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          local_id: string
          predicate?: string | null
          scope?: string
          scope_key: string
          source?: string
          source_ref?: Json
          status?: string
          subject?: string | null
          supersedes_id?: string | null
          text: string
          updated_at?: string
          user_id: string
          value?: string | null
          workspace_id?: string | null
        }
        Update: {
          category?: string
          confidence?: number
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          local_id?: string
          predicate?: string | null
          scope?: string
          scope_key?: string
          source?: string
          source_ref?: Json
          status?: string
          subject?: string | null
          supersedes_id?: string | null
          text?: string
          updated_at?: string
          user_id?: string
          value?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_memory_facts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_operation_runs: {
        Row: {
          action_decisions: Json
          agent_version: number
          answered_emails: Json
          attempt_number: number
          checkpoint: Json | null
          completed_at: string | null
          cost_usd: number
          created_at: string
          definition_snapshot: Json
          error: string | null
          error_class: string | null
          execution_key: string | null
          id: string
          logs: Json
          metrics: Json
          model: string | null
          operation_id: string | null
          operation_local_id: string
          operation_results: Json
          prompt_tokens: number
          provider: string | null
          raw_output: Json
          response_tokens: number
          resume_deadline: string | null
          run_steps: Json
          scope_key: string
          setup_required: Json
          started_at: string
          status: string
          suspended_at: string | null
          trigger_source: string
          user_id: string
          webhook_event_id: string | null
          workspace_id: string | null
        }
        Insert: {
          action_decisions?: Json
          agent_version?: number
          answered_emails?: Json
          attempt_number?: number
          checkpoint?: Json | null
          completed_at?: string | null
          cost_usd?: number
          created_at?: string
          definition_snapshot?: Json
          error?: string | null
          error_class?: string | null
          execution_key?: string | null
          id?: string
          logs?: Json
          metrics?: Json
          model?: string | null
          operation_id?: string | null
          operation_local_id: string
          operation_results?: Json
          prompt_tokens?: number
          provider?: string | null
          raw_output?: Json
          response_tokens?: number
          resume_deadline?: string | null
          run_steps?: Json
          scope_key: string
          setup_required?: Json
          started_at?: string
          status?: string
          suspended_at?: string | null
          trigger_source?: string
          user_id: string
          webhook_event_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          action_decisions?: Json
          agent_version?: number
          answered_emails?: Json
          attempt_number?: number
          checkpoint?: Json | null
          completed_at?: string | null
          cost_usd?: number
          created_at?: string
          definition_snapshot?: Json
          error?: string | null
          error_class?: string | null
          execution_key?: string | null
          id?: string
          logs?: Json
          metrics?: Json
          model?: string | null
          operation_id?: string | null
          operation_local_id?: string
          operation_results?: Json
          prompt_tokens?: number
          provider?: string | null
          raw_output?: Json
          response_tokens?: number
          resume_deadline?: string | null
          run_steps?: Json
          scope_key?: string
          setup_required?: Json
          started_at?: string
          status?: string
          suspended_at?: string | null
          trigger_source?: string
          user_id?: string
          webhook_event_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_operation_runs_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "timewarp_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timewarp_operation_runs_webhook_event_id_fkey"
            columns: ["webhook_event_id"]
            isOneToOne: false
            referencedRelation: "agent_webhook_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timewarp_operation_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_operations: {
        Row: {
          agent_version: number
          claimed_at: string | null
          created_at: string
          dead_lettered_at: string | null
          enabled: boolean
          execution_key: string | null
          execution_target: string
          id: string
          last_error_class: string | null
          last_run_at: string | null
          last_run_id: string | null
          lease_expires_at: string | null
          local_id: string
          max_cost_per_day_usd: number
          max_cost_per_run_usd: number
          max_retries: number
          max_tool_calls_per_run: number
          next_run_at: string | null
          retry_count: number
          runner_status: string
          scope_key: string
          summary: string
          timezone: string
          title: string
          trigger_config: Json
          updated_at: string
          user_id: string
          workflow: Json
          workspace_id: string | null
        }
        Insert: {
          agent_version?: number
          claimed_at?: string | null
          created_at?: string
          dead_lettered_at?: string | null
          enabled?: boolean
          execution_key?: string | null
          execution_target?: string
          id?: string
          last_error_class?: string | null
          last_run_at?: string | null
          last_run_id?: string | null
          lease_expires_at?: string | null
          local_id: string
          max_cost_per_day_usd?: number
          max_cost_per_run_usd?: number
          max_retries?: number
          max_tool_calls_per_run?: number
          next_run_at?: string | null
          retry_count?: number
          runner_status?: string
          scope_key: string
          summary?: string
          timezone?: string
          title?: string
          trigger_config?: Json
          updated_at?: string
          user_id: string
          workflow?: Json
          workspace_id?: string | null
        }
        Update: {
          agent_version?: number
          claimed_at?: string | null
          created_at?: string
          dead_lettered_at?: string | null
          enabled?: boolean
          execution_key?: string | null
          execution_target?: string
          id?: string
          last_error_class?: string | null
          last_run_at?: string | null
          last_run_id?: string | null
          lease_expires_at?: string | null
          local_id?: string
          max_cost_per_day_usd?: number
          max_cost_per_run_usd?: number
          max_retries?: number
          max_tool_calls_per_run?: number
          next_run_at?: string | null
          retry_count?: number
          runner_status?: string
          scope_key?: string
          summary?: string
          timezone?: string
          title?: string
          trigger_config?: Json
          updated_at?: string
          user_id?: string
          workflow?: Json
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_operations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_personal_agent_continuations: {
        Row: {
          agent_id: string
          claimed_at: string | null
          created_at: string
          expires_at: string
          generation: number
          predecessor_token_hash: string | null
          root_run_id: string
          state: string
          token_hash: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id: string
          claimed_at?: string | null
          created_at?: string
          expires_at: string
          generation: number
          predecessor_token_hash?: string | null
          root_run_id: string
          state?: string
          token_hash: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          claimed_at?: string | null
          created_at?: string
          expires_at?: string
          generation?: number
          predecessor_token_hash?: string | null
          root_run_id?: string
          state?: string
          token_hash?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_personal_agent_continuatio_predecessor_token_hash_fkey"
            columns: ["predecessor_token_hash"]
            isOneToOne: true
            referencedRelation: "timewarp_personal_agent_continuations"
            referencedColumns: ["token_hash"]
          },
          {
            foreignKeyName: "timewarp_personal_agent_continuations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timewarp_personal_agent_continuations_root_owner_fk"
            columns: ["root_run_id", "user_id", "agent_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agent_runs"
            referencedColumns: ["id", "user_id", "agent_id"]
          },
        ]
      }
      timewarp_personal_agent_run_events: {
        Row: {
          agent_id: string
          created_at: string
          id: number
          kind: string
          message: string
          metadata: Json
          parent_run_id: string | null
          root_run_id: string
          run_id: string
          sequence: number
          status: string
          user_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: never
          kind: string
          message?: string
          metadata?: Json
          parent_run_id?: string | null
          root_run_id: string
          run_id: string
          sequence: number
          status?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: never
          kind?: string
          message?: string
          metadata?: Json
          parent_run_id?: string | null
          root_run_id?: string
          run_id?: string
          sequence?: number
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_personal_agent_run_events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timewarp_personal_agent_run_events_parent_owner_fk"
            columns: ["parent_run_id", "user_id", "agent_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agent_runs"
            referencedColumns: ["id", "user_id", "agent_id"]
          },
          {
            foreignKeyName: "timewarp_personal_agent_run_events_parent_run_id_fkey"
            columns: ["parent_run_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timewarp_personal_agent_run_events_root_owner_fk"
            columns: ["root_run_id", "user_id", "agent_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agent_runs"
            referencedColumns: ["id", "user_id", "agent_id"]
          },
          {
            foreignKeyName: "timewarp_personal_agent_run_events_root_run_id_fkey"
            columns: ["root_run_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timewarp_personal_agent_run_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timewarp_personal_agent_run_events_run_owner_fk"
            columns: ["run_id", "user_id", "agent_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agent_runs"
            referencedColumns: ["id", "user_id", "agent_id"]
          },
        ]
      }
      timewarp_personal_agent_runs: {
        Row: {
          agent_id: string
          client_request_id: string | null
          created_at: string
          depth: number
          finished_at: string | null
          id: string
          next_event_sequence: number
          parent_run_id: string | null
          prompt: string
          result: Json
          root_run_id: string
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id: string
          client_request_id?: string | null
          created_at?: string
          depth?: number
          finished_at?: string | null
          id?: string
          next_event_sequence?: number
          parent_run_id?: string | null
          prompt?: string
          result?: Json
          root_run_id: string
          started_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          client_request_id?: string | null
          created_at?: string
          depth?: number
          finished_at?: string | null
          id?: string
          next_event_sequence?: number
          parent_run_id?: string | null
          prompt?: string
          result?: Json
          root_run_id?: string
          started_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_personal_agent_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timewarp_personal_agent_runs_parent_owner_fk"
            columns: ["parent_run_id", "user_id", "agent_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agent_runs"
            referencedColumns: ["id", "user_id", "agent_id"]
          },
          {
            foreignKeyName: "timewarp_personal_agent_runs_parent_run_id_fkey"
            columns: ["parent_run_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timewarp_personal_agent_runs_root_owner_fk"
            columns: ["root_run_id", "user_id", "agent_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agent_runs"
            referencedColumns: ["id", "user_id", "agent_id"]
          },
          {
            foreignKeyName: "timewarp_personal_agent_runs_root_run_id_fkey"
            columns: ["root_run_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_personal_agents: {
        Row: {
          box_id: string | null
          box_status: string | null
          compute_credits_spent: number
          compute_id: string | null
          compute_metered_at: string | null
          compute_provider: string
          compute_status: string | null
          created_at: string
          email: string | null
          id: string
          inbox_id: string | null
          private_workspace_key: string | null
          profile: Json
          resource_sharing: Json
          status: string
          team_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          box_id?: string | null
          box_status?: string | null
          compute_credits_spent?: number
          compute_id?: string | null
          compute_metered_at?: string | null
          compute_provider?: string
          compute_status?: string | null
          created_at?: string
          email?: string | null
          id: string
          inbox_id?: string | null
          private_workspace_key?: string | null
          profile?: Json
          resource_sharing?: Json
          status?: string
          team_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          box_id?: string | null
          box_status?: string | null
          compute_credits_spent?: number
          compute_id?: string | null
          compute_metered_at?: string | null
          compute_provider?: string
          compute_status?: string | null
          created_at?: string
          email?: string | null
          id?: string
          inbox_id?: string | null
          private_workspace_key?: string | null
          profile?: Json
          resource_sharing?: Json
          status?: string
          team_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_personal_agents_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "timewarp_agent_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_subscription_checkouts: {
        Row: {
          attempt_id: string
          created_at: string
          expires_at: string
          owner_user_id: string
          request: Json
          scope_key: string
          session_id: string | null
          workspace_id: string | null
        }
        Insert: {
          attempt_id?: string
          created_at?: string
          expires_at?: string
          owner_user_id: string
          request: Json
          scope_key: string
          session_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          attempt_id?: string
          created_at?: string
          expires_at?: string
          owner_user_id?: string
          request?: Json
          scope_key?: string
          session_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_subscription_checkouts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          energy_monthly_extra_credits: number
          energy_monthly_usd: number | null
          id: string
          owner_user_id: string
          plan: string
          plan_anchor_at: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          energy_monthly_extra_credits?: number
          energy_monthly_usd?: number | null
          id?: string
          owner_user_id: string
          plan?: string
          plan_anchor_at?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          energy_monthly_extra_credits?: number
          energy_monthly_usd?: number | null
          id?: string
          owner_user_id?: string
          plan?: string
          plan_anchor_at?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_subscriptions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_twilio_calls: {
        Row: {
          created_at: string
          direction: string
          duration_seconds: number | null
          from_number: string
          id: string
          phone_number_id: string
          provider_call_sid: string
          recording_url: string | null
          spoken_text: string | null
          status: string
          to_number: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          direction: string
          duration_seconds?: number | null
          from_number: string
          id?: string
          phone_number_id: string
          provider_call_sid: string
          recording_url?: string | null
          spoken_text?: string | null
          status?: string
          to_number: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          direction?: string
          duration_seconds?: number | null
          from_number?: string
          id?: string
          phone_number_id?: string
          provider_call_sid?: string
          recording_url?: string | null
          spoken_text?: string | null
          status?: string
          to_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_twilio_calls_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "timewarp_twilio_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_twilio_connect_states: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          state_hash: string
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          state_hash: string
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          state_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      timewarp_twilio_connections: {
        Row: {
          account_label: string
          account_sid: string
          api_key_sid: string | null
          auth_mode: string
          created_at: string
          encrypted_api_key_secret: string | null
          id: string
          initialization_vector: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_label?: string
          account_sid: string
          api_key_sid?: string | null
          auth_mode?: string
          created_at?: string
          encrypted_api_key_secret?: string | null
          id?: string
          initialization_vector?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_label?: string
          account_sid?: string
          api_key_sid?: string | null
          auth_mode?: string
          created_at?: string
          encrypted_api_key_secret?: string | null
          id?: string
          initialization_vector?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      timewarp_twilio_messages: {
        Row: {
          body: string
          created_at: string
          direction: string
          error_code: string | null
          from_number: string
          id: string
          media_count: number
          phone_number_id: string
          provider_message_sid: string
          status: string
          to_number: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          direction: string
          error_code?: string | null
          from_number: string
          id?: string
          media_count?: number
          phone_number_id: string
          provider_message_sid: string
          status?: string
          to_number: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          direction?: string
          error_code?: string | null
          from_number?: string
          id?: string
          media_count?: number
          phone_number_id?: string
          provider_message_sid?: string
          status?: string
          to_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_twilio_messages_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "timewarp_twilio_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_twilio_numbers: {
        Row: {
          agent_id: string | null
          capabilities: Json
          country: string
          created_at: string
          friendly_name: string | null
          id: string
          inbound_greeting: string
          owner_user_id: string
          phone_number: string
          provider_connection_id: string | null
          provider_number_sid: string | null
          sharing_scope: string
          status: string
          team_id: string
          updated_at: string
          webhook_token_hash: string
        }
        Insert: {
          agent_id?: string | null
          capabilities?: Json
          country?: string
          created_at?: string
          friendly_name?: string | null
          id?: string
          inbound_greeting?: string
          owner_user_id: string
          phone_number: string
          provider_connection_id?: string | null
          provider_number_sid?: string | null
          sharing_scope?: string
          status?: string
          team_id: string
          updated_at?: string
          webhook_token_hash: string
        }
        Update: {
          agent_id?: string | null
          capabilities?: Json
          country?: string
          created_at?: string
          friendly_name?: string | null
          id?: string
          inbound_greeting?: string
          owner_user_id?: string
          phone_number?: string
          provider_connection_id?: string | null
          provider_number_sid?: string | null
          sharing_scope?: string
          status?: string
          team_id?: string
          updated_at?: string
          webhook_token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_twilio_numbers_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timewarp_twilio_numbers_provider_connection_id_fkey"
            columns: ["provider_connection_id"]
            isOneToOne: false
            referencedRelation: "timewarp_twilio_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timewarp_twilio_numbers_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "timewarp_agent_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_usage_counters: {
        Row: {
          bucket: string
          bucket_start: string
          count: number
          kind: string
          user_id: string
        }
        Insert: {
          bucket: string
          bucket_start: string
          count?: number
          kind: string
          user_id: string
        }
        Update: {
          bucket?: string
          bucket_start?: string
          count?: number
          kind?: string
          user_id?: string
        }
        Relationships: []
      }
      timewarp_wallet_checkout_links: {
        Row: {
          active: boolean
          agent_id: string | null
          amount_cents: number
          created_at: string
          created_by: string
          currency: string
          description: string
          id: string
          stripe_account_id: string
          stripe_payment_link_id: string
          stripe_price_id: string
          stripe_product_id: string
          title: string
          url: string
          user_id: string
        }
        Insert: {
          active?: boolean
          agent_id?: string | null
          amount_cents: number
          created_at?: string
          created_by?: string
          currency: string
          description?: string
          id?: string
          stripe_account_id: string
          stripe_payment_link_id: string
          stripe_price_id: string
          stripe_product_id: string
          title: string
          url: string
          user_id: string
        }
        Update: {
          active?: boolean
          agent_id?: string | null
          amount_cents?: number
          created_at?: string
          created_by?: string
          currency?: string
          description?: string
          id?: string
          stripe_account_id?: string
          stripe_payment_link_id?: string
          stripe_price_id?: string
          stripe_product_id?: string
          title?: string
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_wallet_checkout_account_fk"
            columns: ["user_id", "stripe_account_id"]
            isOneToOne: false
            referencedRelation: "timewarp_wallet_merchant_accounts"
            referencedColumns: ["user_id", "stripe_account_id"]
          },
          {
            foreignKeyName: "timewarp_wallet_checkout_agent_fk"
            columns: ["user_id", "agent_id"]
            isOneToOne: false
            referencedRelation: "timewarp_personal_agents"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      timewarp_wallet_checkout_requests: {
        Row: {
          created_at: string
          intent_hash: string
          provider_result: Json | null
          request_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          intent_hash: string
          provider_result?: Json | null
          request_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          intent_hash?: string
          provider_result?: Json | null
          request_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      timewarp_wallet_merchant_accounts: {
        Row: {
          created_at: string
          merchant_capability_status: string
          requirements_due: number
          stripe_account_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          merchant_capability_status?: string
          requirements_due?: number
          stripe_account_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          merchant_capability_status?: string
          requirements_due?: number
          stripe_account_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      timewarp_wallet_payment_receipts: {
        Row: {
          amount_cents: number
          checkout_link_id: string
          currency: string
          id: string
          livemode: boolean
          recorded_at: string
          stripe_account_id: string
          stripe_checkout_session_id: string
          stripe_payment_intent_id: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          checkout_link_id: string
          currency: string
          id?: string
          livemode: boolean
          recorded_at?: string
          stripe_account_id: string
          stripe_checkout_session_id: string
          stripe_payment_intent_id: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          checkout_link_id?: string
          currency?: string
          id?: string
          livemode?: boolean
          recorded_at?: string
          stripe_account_id?: string
          stripe_checkout_session_id?: string
          stripe_payment_intent_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_wallet_payment_recei_checkout_link_id_user_id_str_fkey"
            columns: ["checkout_link_id", "user_id", "stripe_account_id"]
            isOneToOne: false
            referencedRelation: "timewarp_wallet_checkout_links"
            referencedColumns: ["id", "user_id", "stripe_account_id"]
          },
        ]
      }
      timewarp_workspace_chat_shares: {
        Row: {
          created_at: string
          delivered_chat_local_id: string
          id: string
          recipient_user_id: string
          sender_user_id: string
          title: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          delivered_chat_local_id: string
          id?: string
          recipient_user_id: string
          sender_user_id: string
          title?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          delivered_chat_local_id?: string
          id?: string
          recipient_user_id?: string
          sender_user_id?: string
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_workspace_chat_shares_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_workspace_company_bases: {
        Row: {
          manifest: Json
          revision: number
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          manifest?: Json
          revision?: number
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          manifest?: Json
          revision?: number
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_workspace_company_bases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_workspace_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          email_error: string | null
          email_message_id: string | null
          email_sent: boolean
          expires_at: string
          id: string
          invited_by: string
          invited_by_email: string | null
          last_email_sent_at: string | null
          role: string
          status: string
          token_hash: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          email_error?: string | null
          email_message_id?: string | null
          email_sent?: boolean
          expires_at?: string
          id?: string
          invited_by: string
          invited_by_email?: string | null
          last_email_sent_at?: string | null
          role?: string
          status?: string
          token_hash: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          email_error?: string | null
          email_message_id?: string | null
          email_sent?: boolean
          expires_at?: string
          id?: string
          invited_by?: string
          invited_by_email?: string | null
          last_email_sent_at?: string | null
          role?: string
          status?: string
          token_hash?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_workspace_members: {
        Row: {
          created_at: string
          email: string
          id: string
          joined_at: string
          name: string | null
          role: string
          share_chat_memory_episodes: boolean
          share_connector_data_with_memory: boolean
          status: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          joined_at?: string
          name?: string | null
          role?: string
          share_chat_memory_episodes?: boolean
          share_connector_data_with_memory?: boolean
          status?: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          joined_at?: string
          name?: string | null
          role?: string
          share_chat_memory_episodes?: boolean
          share_connector_data_with_memory?: boolean
          status?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      timewarp_workspaces: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          settings: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          settings?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_due_timewarp_cloud_agents: {
        Args: { p_limit?: number }
        Returns: {
          agent_version: number
          claimed_at: string | null
          created_at: string
          dead_lettered_at: string | null
          enabled: boolean
          execution_key: string | null
          execution_target: string
          id: string
          last_error_class: string | null
          last_run_at: string | null
          last_run_id: string | null
          lease_expires_at: string | null
          local_id: string
          max_cost_per_day_usd: number
          max_cost_per_run_usd: number
          max_retries: number
          max_tool_calls_per_run: number
          next_run_at: string | null
          retry_count: number
          runner_status: string
          scope_key: string
          summary: string
          timezone: string
          title: string
          trigger_config: Json
          updated_at: string
          user_id: string
          workflow: Json
          workspace_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "timewarp_operations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      configure_agent_job_scheduler: {
        Args: { project_url: string; service_role_key: string }
        Returns: undefined
      }
      configure_email_queue_scheduler: {
        Args: { project_url: string; service_role_key: string }
        Returns: undefined
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      invoke_timewarp_cloud_agent_tick: { Args: never; Returns: undefined }
      invoke_timewarp_desktop_sweep: { Args: never; Returns: undefined }
      list_timewarp_cloud_agent_runs: {
        Args: { p_limit_per_agent?: number; p_scope_key: string }
        Returns: {
          created_at: string
          operation_local_id: string
          raw_output: Json
        }[]
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      sync_timewarp_cloud_agent_tick_schedule: {
        Args: never
        Returns: undefined
      }
      timewarp_add_agent_team_compute_credits: {
        Args: { p_credits: number; p_team_id: string; p_user_id: string }
        Returns: number
      }
      timewarp_ai_usage: {
        Args: { p_user_id: string; p_workspace_id?: string }
        Returns: Json
      }
      timewarp_ai_usage_unreserved: {
        Args: { p_user_id: string; p_workspace_id?: string }
        Returns: Json
      }
      timewarp_append_personal_agent_run_event: {
        Args: {
          p_agent_id: string
          p_kind: string
          p_message: string
          p_metadata: Json
          p_root_run_id: string
          p_run_id: string
          p_status: string
          p_user_id: string
        }
        Returns: number
      }
      timewarp_approve_agent_card_payment_request: {
        Args: { p_agent_id: string; p_request_id: string; p_user_id: string }
        Returns: Json
      }
      timewarp_begin_agent_card_payment_handoff: {
        Args: { p_agent_id: string; p_request_id: string; p_user_id: string }
        Returns: Json
      }
      timewarp_billing_period: {
        Args: { p_anchor: string; p_now: string }
        Returns: Record<string, unknown>
      }
      timewarp_can_manage_workspace: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      timewarp_cancel_agent_job: {
        Args: { p_agent_id: string; p_request_id: string; p_user_id: string }
        Returns: boolean
      }
      timewarp_checkpoint_agent_job: {
        Args: {
          p_checkpoint: Json
          p_holder: string
          p_phase: string
          p_run_id: string
        }
        Returns: boolean
      }
      timewarp_claim_agent_compute_lease: {
        Args: {
          p_compute_id: string
          p_holder: string
          p_lease_seconds?: number
        }
        Returns: boolean
      }
      timewarp_claim_agent_jobs: {
        Args: { p_holder: string; p_limit?: number }
        Returns: {
          agent_id: string
          available_at: string
          checkpoint: Json
          deadline: string
          holder: string | null
          lease_until: string | null
          payload: Json
          phase: string
          request_id: string
          result: Json
          revision: number
          run_id: string
          status: string
          task_id: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "timewarp_agent_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      timewarp_claim_agent_team_compute_interval: {
        Args: { p_live_ended_at?: string; p_team_id: string; p_user_id: string }
        Returns: Json
      }
      timewarp_claim_credit_recharge: {
        Args: { p_owner_user_id: string; p_workspace_id: string }
        Returns: Json
      }
      timewarp_claim_legacy_personal_agent_continuation: {
        Args: {
          p_agent_id: string
          p_expires_at: string
          p_root_run_id: string
          p_token_hash: string
          p_user_id: string
        }
        Returns: boolean
      }
      timewarp_claim_personal_agent_continuation: {
        Args: {
          p_agent_id: string
          p_generation: number
          p_root_run_id: string
          p_token_hash: string
          p_user_id: string
        }
        Returns: boolean
      }
      timewarp_cloud_credit_usage: {
        Args: { p_user_id: string; p_workspace_id?: string }
        Returns: Json
      }
      timewarp_complete_agent_card_payment_handoff: {
        Args: {
          p_agent_id: string
          p_request_id: string
          p_result: string
          p_user_id: string
        }
        Returns: Json
      }
      timewarp_consume_rate_limit: {
        Args: {
          p_kind: string
          p_max_per_day: number
          p_max_per_minute: number
          p_user_id: string
        }
        Returns: Json
      }
      timewarp_create_agent_card_payment_request: {
        Args: {
          p_agent_id: string
          p_amount_cents: number
          p_currency: string
          p_merchant_domain: string
          p_merchant_name: string
          p_merchant_origin: string
          p_merchant_url: string
          p_purpose: string
          p_user_id: string
        }
        Returns: Json
      }
      timewarp_create_workspace_guarded: {
        Args: {
          p_email: string
          p_name: string
          p_owner_name: string
          p_user_id: string
        }
        Returns: Json
      }
      timewarp_credit_recharge_failed: {
        Args: {
          p_owner_user_id: string
          p_stripe_ref?: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      timewarp_credit_usage_summary: {
        Args: {
          p_period_start: string
          p_user_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      timewarp_deactivate_agent_card: {
        Args: { p_agent_id: string; p_user_id: string }
        Returns: Json
      }
      timewarp_deliver_workspace_chat: {
        Args: {
          p_artifacts: Json
          p_context_attachments: Json
          p_context_usage: Json
          p_messages: Json
          p_recipient_user_id: string
          p_sender_user_id: string
          p_title: string
          p_tokens_used: number
          p_workspace_id: string
        }
        Returns: {
          chat_id: string
          share_id: string
        }[]
      }
      timewarp_energy_ai_reconciliation_status: { Args: never; Returns: Json }
      timewarp_energy_claim: {
        Args: { p_holder: string; p_run_id?: string }
        Returns: {
          attempts: number
          conversation_id: string
          created_at: string
          entry_sequence: number
          error: string | null
          id: string
          lease_id: string | null
          lease_until: string | null
          messages: Json
          model: string
          native_instructions: string
          native_reasoning: string
          prompt: string
          request_id: string
          result: string
          status: string
          steps: number
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "timewarp_energy_runs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      timewarp_energy_complete_ai: {
        Args: {
          p_cost: number
          p_id: string
          p_input: number
          p_model: string
          p_outcome: string
          p_output: number
          p_user_id: string
        }
        Returns: Json
      }
      timewarp_energy_finish_ai: {
        Args: {
          p_cost: number
          p_id: string
          p_input: number
          p_model: string
          p_outcome: string
          p_output: number
          p_user_id: string
        }
        Returns: Json
      }
      timewarp_energy_merge_history: {
        Args: {
          p_agents: Json
          p_conversation: Json
          p_entries: Json
          p_id: string
          p_user: string
        }
        Returns: undefined
      }
      timewarp_energy_monthly_allowance: {
        Args: { p_plan: string; p_user_id: string; p_workspace_id: string }
        Returns: number
      }
      timewarp_energy_native_agent: {
        Args: {
          p_id?: string
          p_instructions?: string
          p_name?: string
          p_user: string
        }
        Returns: {
          archived: boolean
          conversation_id: string
          display_name: string
          id: string
          instructions: string
          is_default: boolean
          memory_mode: string | null
          sort_order: number
          starred: boolean
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "timewarp_energy_agents"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      timewarp_energy_native_submit: {
        Args: {
          p_agent: string
          p_conversation: string
          p_model: string
          p_prompt: string
          p_request: string
          p_start: boolean
          p_user: string
        }
        Returns: {
          attempts: number
          conversation_id: string
          created_at: string
          entry_sequence: number
          error: string | null
          id: string
          lease_id: string | null
          lease_until: string | null
          messages: Json
          model: string
          native_instructions: string
          native_reasoning: string
          prompt: string
          request_id: string
          result: string
          status: string
          steps: number
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "timewarp_energy_runs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      timewarp_energy_patch_settings: {
        Args: { p_patch: Json; p_user: string }
        Returns: undefined
      }
      timewarp_energy_retry_ai_settlements: {
        Args: { p_limit?: number }
        Returns: Json
      }
      timewarp_energy_settle_ai_cost: {
        Args: {
          p_cost_usd: number
          p_model: string
          p_prompt_tokens: number
          p_response_tokens: number
          p_user_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      timewarp_energy_sync_monthly_credits: {
        Args: {
          p_extra_credits: number
          p_monthly_usd: number
          p_owner_user_id: string
          p_stripe_subscription_id: string
        }
        Returns: undefined
      }
      timewarp_enqueue_agent_job: {
        Args: {
          p_agent_id: string
          p_payload: Json
          p_request_id: string
          p_task_id: string
          p_user_id: string
        }
        Returns: string
      }
      timewarp_enqueue_owner_message: {
        Args: {
          p_agent_id: string
          p_message_id: string
          p_question_id?: string
          p_run_id: string
          p_text: string
          p_user_id: string
        }
        Returns: string
      }
      timewarp_finish_agent_ai: {
        Args: {
          p_cost: number
          p_id: string
          p_input: number
          p_model: string
          p_outcome: string
          p_output: number
          p_user_id: string
        }
        Returns: Json
      }
      timewarp_finish_agent_job: {
        Args: {
          p_available_at?: string
          p_checkpoint: Json
          p_holder: string
          p_result: Json
          p_run_id: string
          p_status: string
        }
        Returns: boolean
      }
      timewarp_grant_credits: {
        Args: {
          p_credits: number
          p_kind: string
          p_owner_user_id: string
          p_stripe_ref: string
          p_user_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      timewarp_heartbeat_agent_desktop: {
        Args: {
          p_agent_id: string
          p_compute_id: string
          p_credits_per_second: number
          p_provider_usd_per_second: number
          p_session_id: string
          p_user_id: string
        }
        Returns: Json
      }
      timewarp_is_workspace_member: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      timewarp_issue_personal_agent_continuation: {
        Args: {
          p_agent_id: string
          p_expires_at: string
          p_generation: number
          p_predecessor_token_hash: string
          p_root_run_id: string
          p_token_hash: string
          p_user_id: string
        }
        Returns: boolean
      }
      timewarp_lock_credit_balance: {
        Args: { p_owner_user_id: string; p_workspace_id: string }
        Returns: {
          auto_recharge_enabled: boolean
          auto_recharge_pack_credits: number | null
          auto_recharge_threshold: number
          auto_recharge_user_id: string | null
          balance_credits: number
          created_at: string
          id: string
          owner_user_id: string
          recharge_claimed_at: string | null
          recharge_failed_at: string | null
          recharge_failures: number
          recharge_last_failure_ref: string | null
          updated_at: string
          workspace_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "timewarp_credit_balances"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      timewarp_merge_jsonb_records_by_id: {
        Args: { p_new: Json; p_old: Json }
        Returns: Json
      }
      timewarp_merge_scope_memory: {
        Args: {
          p_episodes: Json
          p_facts: Json
          p_scope_key: string
          p_user_id: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      timewarp_merge_workspace_memory_snapshot: {
        Args: {
          p_business_dna: Json
          p_knowledge: string
          p_memory_hub_tree: Json
          p_user_id: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      timewarp_prepare_subscription_checkout: {
        Args: {
          p_previous_attempt?: string
          p_request: Json
          p_user_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      timewarp_record_ai_cost: {
        Args: {
          p_cost_usd: number
          p_model: string
          p_paid_with?: string
          p_prompt_tokens: number
          p_response_tokens: number
          p_user_id: string
          p_workspace_id?: string
        }
        Returns: undefined
      }
      timewarp_release_agent_compute_lease: {
        Args: { p_compute_id: string; p_holder: string }
        Returns: undefined
      }
      timewarp_replace_scope_memory: {
        Args: {
          p_episodes: Json
          p_facts: Json
          p_scope_key: string
          p_user_id: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      timewarp_reserve_agent_ai: {
        Args: { p_credits: number; p_id: string; p_user_id: string }
        Returns: boolean
      }
      timewarp_resume_agent_job: {
        Args: {
          p_agent_id: string
          p_response: Json
          p_revision: number
          p_run_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      timewarp_save_subscription_checkout: {
        Args: {
          p_attempt_id: string
          p_session_id: string
          p_user_id: string
          p_workspace_id: string
        }
        Returns: boolean
      }
      timewarp_set_credit_recharge: {
        Args: {
          p_enabled: boolean
          p_owner_user_id: string
          p_pack_credits: number
          p_threshold: number
          p_user_id: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      timewarp_settle_agent_compute_usage: {
        Args: {
          p_agent_id: string
          p_compute_id: string
          p_credits_per_second: number
          p_finished_at: string
          p_provider_usd_per_second: number
          p_started_at: string
          p_team_id: string
          p_user_id: string
        }
        Returns: Json
      }
      timewarp_settle_agent_desktop_usage: {
        Args: {
          p_agent_id: string
          p_compute_id: string
          p_credits_per_second: number
          p_keepalive: boolean
          p_provider_usd_per_second: number
          p_user_id: string
        }
        Returns: Json
      }
      timewarp_settle_ai_cost: {
        Args: {
          p_cost_usd: number
          p_model: string
          p_prompt_tokens: number
          p_response_tokens: number
          p_user_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      timewarp_settle_credit_usage: {
        Args: {
          p_credits: number
          p_provider_cost_usd?: number
          p_usage_kind: string
          p_user_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      timewarp_spend_credits: {
        Args: {
          p_cost_usd: number
          p_credits: number
          p_model: string
          p_user_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      timewarp_store_agent_card: {
        Args: {
          p_agent_id: string
          p_brand: string
          p_exp_month: number
          p_exp_year: number
          p_last4: string
          p_stripe_payment_method_id: string
          p_user_id: string
        }
        Returns: Json
      }
      timewarp_update_member_guarded: {
        Args: {
          p_action: string
          p_member_id: string
          p_new_role?: string
          p_workspace_id: string
        }
        Returns: string
      }
      timewarp_upsert_subscription: {
        Args: {
          p_cancel_at_period_end: boolean
          p_current_period_end: string
          p_owner_user_id: string
          p_plan: string
          p_plan_anchor_at: string
          p_stripe_customer_id: string
          p_stripe_subscription_id: string
          p_subscription_status: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      timewarp_workspace_member_role: {
        Args: { p_workspace_id: string }
        Returns: string
      }
      timewarp_workspace_role_for: {
        Args: { p_user_id: string; p_workspace_id: string }
        Returns: string
      }
      upsert_timewarp_cloud_snapshot: {
        Args: {
          p_business_dna: Json
          p_chats: Json
          p_knowledge: string
          p_profile: Json
          p_storage_objects?: Json
          p_work_stack: Json
        }
        Returns: {
          business_dna: Json | null
          chats: Json
          created_at: string
          id: string
          knowledge: string
          profile: Json
          scope_key: string
          snapshot_version: number
          storage_objects: Json
          updated_at: string
          user_id: string
          work_stack: Json
          workspace_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "timewarp_cloud_snapshots"
          isOneToOne: true
          isSetofReturn: false
        }
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
