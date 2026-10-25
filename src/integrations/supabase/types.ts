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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      agent_id_agent_clients: {
        Row: {
          agent_id: string
          app: string
          client_name: string | null
          client_version: string | null
          first_seen_at: string
          last_seen_at: string
        }
        Insert: {
          agent_id: string
          app: string
          client_name?: string | null
          client_version?: string | null
          first_seen_at?: string
          last_seen_at?: string
        }
        Update: {
          agent_id?: string
          app?: string
          client_name?: string | null
          client_version?: string | null
          first_seen_at?: string
          last_seen_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_id_agent_clients_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_id_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_id_agents: {
        Row: {
          client_name: string | null
          client_seen_at: string | null
          client_version: string | null
          created_at: string
          desktop_agent_id: string | null
          handle: string
          id: string
          last_seen_at: string | null
          name: string
          origin_detail: string | null
          owner_user_id: string
          runtime: string
          status: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          client_name?: string | null
          client_seen_at?: string | null
          client_version?: string | null
          created_at?: string
          desktop_agent_id?: string | null
          handle: string
          id: string
          last_seen_at?: string | null
          name: string
          origin_detail?: string | null
          owner_user_id: string
          runtime?: string
          status?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          client_name?: string | null
          client_seen_at?: string | null
          client_version?: string | null
          created_at?: string
          desktop_agent_id?: string | null
          handle?: string
          id?: string
          last_seen_at?: string | null
          name?: string
          origin_detail?: string | null
          owner_user_id?: string
          runtime?: string
          status?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_id_agents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_id_approvals: {
        Row: {
          agent_id: string
          created_at: string
          decided_at: string | null
          expires_at: string
          id: string
          kind: string
          owner_user_id: string
          reason: string | null
          request: Json
          result: Json | null
          status: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          decided_at?: string | null
          expires_at?: string
          id?: string
          kind: string
          owner_user_id: string
          reason?: string | null
          request: Json
          result?: Json | null
          status?: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          decided_at?: string | null
          expires_at?: string
          id?: string
          kind?: string
          owner_user_id?: string
          reason?: string | null
          request?: Json
          result?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_id_approvals_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_id_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_id_audit: {
        Row: {
          action: string
          actor: string
          agent_id: string | null
          at: string
          detail: Json
          id: number
          owner_user_id: string
        }
        Insert: {
          action: string
          actor: string
          agent_id?: string | null
          at?: string
          detail?: Json
          id?: never
          owner_user_id: string
        }
        Update: {
          action?: string
          actor?: string
          agent_id?: string | null
          at?: string
          detail?: Json
          id?: never
          owner_user_id?: string
        }
        Relationships: []
      }
      agent_id_bank_accounts: {
        Row: {
          bank_name: string | null
          created_at: string
          currency: string
          id: string
          last4: string
          owner_name: string | null
          provider_ref: string
          rail: string
          removed_at: string | null
          user_id: string
        }
        Insert: {
          bank_name?: string | null
          created_at?: string
          currency: string
          id: string
          last4: string
          owner_name?: string | null
          provider_ref: string
          rail: string
          removed_at?: string | null
          user_id: string
        }
        Update: {
          bank_name?: string | null
          created_at?: string
          currency?: string
          id?: string
          last4?: string
          owner_name?: string | null
          provider_ref?: string
          rail?: string
          removed_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      agent_id_bank_customers: {
        Row: {
          created_at: string
          customer_ref: string | null
          endorsements: Json
          kyc_link: string | null
          kyc_link_ref: string | null
          kyc_status: string
          provider: string
          rejection: string | null
          tos_link: string | null
          tos_status: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          customer_ref?: string | null
          endorsements?: Json
          kyc_link?: string | null
          kyc_link_ref?: string | null
          kyc_status?: string
          provider?: string
          rejection?: string | null
          tos_link?: string | null
          tos_status?: string
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          customer_ref?: string | null
          endorsements?: Json
          kyc_link?: string | null
          kyc_link_ref?: string | null
          kyc_status?: string
          provider?: string
          rejection?: string | null
          tos_link?: string | null
          tos_status?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_id_bank_deposits: {
        Row: {
          created_at: string
          currency: string
          instructions: Json
          provider_ref: string
          resource_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          currency: string
          instructions?: Json
          provider_ref: string
          resource_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          instructions?: Json
          provider_ref?: string
          resource_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_id_bank_deposits_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "agent_id_resources"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_id_businesses: {
        Row: {
          attested_at: string | null
          checks: Json
          country: string | null
          document_name: string | null
          document_path: string | null
          legal_name: string | null
          provider: string | null
          provider_ref: string | null
          registration_number: string | null
          representative_role: string | null
          review_note: string | null
          status: string
          submitted_by: string | null
          updated_at: string
          vat_number: string | null
          verified_at: string | null
          website: string | null
          workspace_id: string
        }
        Insert: {
          attested_at?: string | null
          checks?: Json
          country?: string | null
          document_name?: string | null
          document_path?: string | null
          legal_name?: string | null
          provider?: string | null
          provider_ref?: string | null
          registration_number?: string | null
          representative_role?: string | null
          review_note?: string | null
          status?: string
          submitted_by?: string | null
          updated_at?: string
          vat_number?: string | null
          verified_at?: string | null
          website?: string | null
          workspace_id: string
        }
        Update: {
          attested_at?: string | null
          checks?: Json
          country?: string | null
          document_name?: string | null
          document_path?: string | null
          legal_name?: string | null
          provider?: string | null
          provider_ref?: string | null
          registration_number?: string | null
          representative_role?: string | null
          review_note?: string | null
          status?: string
          submitted_by?: string | null
          updated_at?: string
          vat_number?: string | null
          verified_at?: string | null
          website?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_id_businesses_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_id_card_applications: {
        Row: {
          agent_id: string
          country: string | null
          created_at: string
          id: string
          monthly_spend: number | null
          owner_user_id: string
          status: string
          updated_at: string
          use_case: string
        }
        Insert: {
          agent_id: string
          country?: string | null
          created_at?: string
          id?: string
          monthly_spend?: number | null
          owner_user_id: string
          status?: string
          updated_at?: string
          use_case: string
        }
        Update: {
          agent_id?: string
          country?: string | null
          created_at?: string
          id?: string
          monthly_spend?: number | null
          owner_user_id?: string
          status?: string
          updated_at?: string
          use_case?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_id_card_applications_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agent_id_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_id_claims: {
        Row: {
          agent_id: string | null
          app: string | null
          client_name: string | null
          code: string
          created_at: string
          device: string | null
          email: string | null
          email_attempts: number
          email_code_expires_at: string | null
          email_code_hash: string | null
          email_code_sent_at: string | null
          email_sends: number
          email_verified_at: string | null
          expires_at: string
          id: string
          ip_hash: string | null
          key_delivered_at: string | null
          match_code: string
          name: string
          secret_hash: string
          session_hash: string | null
          started_by: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          agent_id?: string | null
          app?: string | null
          client_name?: string | null
          code: string
          created_at?: string
          device?: string | null
          email?: string | null
          email_attempts?: number
          email_code_expires_at?: string | null
          email_code_hash?: string | null
          email_code_sent_at?: string | null
          email_sends?: number
          email_verified_at?: string | null
          expires_at: string
          id?: string
          ip_hash?: string | null
          key_delivered_at?: string | null
          match_code: string
          name: string
          secret_hash: string
          session_hash?: string | null
          started_by: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          agent_id?: string | null
          app?: string | null
          client_name?: string | null
          code?: string
          created_at?: string
          device?: string | null
          email?: string | null
          email_attempts?: number
          email_code_expires_at?: string | null
          email_code_hash?: string | null
          email_code_sent_at?: string | null
          email_sends?: number
          email_verified_at?: string | null
          expires_at?: string
          id?: string
          ip_hash?: string | null
          key_delivered_at?: string | null
          match_code?: string
          name?: string
          secret_hash?: string
          session_hash?: string | null
          started_by?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_id_claims_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_id_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_id_contacts: {
        Row: {
          agent_id: string
          created_at: string
          email: string | null
          id: string
          name: string
          note: string | null
          phone: string | null
          updated_at: string
          wallet: string | null
        }
        Insert: {
          agent_id: string
          created_at?: string
          email?: string | null
          id?: string
          name: string
          note?: string | null
          phone?: string | null
          updated_at?: string
          wallet?: string | null
        }
        Update: {
          agent_id?: string
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          note?: string | null
          phone?: string | null
          updated_at?: string
          wallet?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_id_contacts_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_id_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_id_events: {
        Row: {
          agent_id: string
          amount_minor: number | null
          body: string | null
          counterparty: string | null
          currency: string | null
          data: Json
          direction: string
          folder: string | null
          id: string
          kind: string
          occurred_at: string
          owner_user_id: string
          provider_ref: string | null
          read_at: string | null
          resource_id: string | null
          status: string
          subject: string | null
          thread: string | null
        }
        Insert: {
          agent_id: string
          amount_minor?: number | null
          body?: string | null
          counterparty?: string | null
          currency?: string | null
          data?: Json
          direction: string
          folder?: string | null
          id?: string
          kind: string
          occurred_at?: string
          owner_user_id: string
          provider_ref?: string | null
          read_at?: string | null
          resource_id?: string | null
          status: string
          subject?: string | null
          thread?: string | null
        }
        Update: {
          agent_id?: string
          amount_minor?: number | null
          body?: string | null
          counterparty?: string | null
          currency?: string | null
          data?: Json
          direction?: string
          folder?: string | null
          id?: string
          kind?: string
          occurred_at?: string
          owner_user_id?: string
          provider_ref?: string | null
          read_at?: string | null
          resource_id?: string | null
          status?: string
          subject?: string | null
          thread?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_id_events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_id_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_id_events_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "agent_id_resources"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_id_files: {
        Row: {
          agent_id: string
          content_type: string
          created_at: string
          event_id: string | null
          filename: string
          id: string
          owner_user_id: string
          size: number
          storage_path: string
        }
        Insert: {
          agent_id: string
          content_type: string
          created_at?: string
          event_id?: string | null
          filename: string
          id?: string
          owner_user_id: string
          size: number
          storage_path: string
        }
        Update: {
          agent_id?: string
          content_type?: string
          created_at?: string
          event_id?: string | null
          filename?: string
          id?: string
          owner_user_id?: string
          size?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_id_files_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_id_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_id_files_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "agent_id_events"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_id_keys: {
        Row: {
          agent_id: string | null
          created_at: string
          hash: string
          id: string
          last_used_at: string | null
          name: string
          owner_user_id: string
          prefix: string
          revoked_at: string | null
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          hash: string
          id?: string
          last_used_at?: string | null
          name?: string
          owner_user_id: string
          prefix: string
          revoked_at?: string | null
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          hash?: string
          id?: string
          last_used_at?: string | null
          name?: string
          owner_user_id?: string
          prefix?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_id_keys_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_id_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_id_people: {
        Row: {
          cardholder_ref: string | null
          consent_at: string | null
          consent_version: string | null
          country: string | null
          last_error: string | null
          legal_name: string | null
          provider: string | null
          provider_ref: string | null
          status: string
          terms_accepted_at: string | null
          terms_version: string | null
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          cardholder_ref?: string | null
          consent_at?: string | null
          consent_version?: string | null
          country?: string | null
          last_error?: string | null
          legal_name?: string | null
          provider?: string | null
          provider_ref?: string | null
          status?: string
          terms_accepted_at?: string | null
          terms_version?: string | null
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          cardholder_ref?: string | null
          consent_at?: string | null
          consent_version?: string | null
          country?: string | null
          last_error?: string | null
          legal_name?: string | null
          provider?: string | null
          provider_ref?: string | null
          status?: string
          terms_accepted_at?: string | null
          terms_version?: string | null
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      agent_id_phone_applications: {
        Row: {
          agent_id: string
          country: string | null
          created_at: string
          owner_user_id: string
          status: string
          updated_at: string
          use_case: string
          uses: string[]
        }
        Insert: {
          agent_id: string
          country?: string | null
          created_at?: string
          owner_user_id: string
          status?: string
          updated_at?: string
          use_case: string
          uses?: string[]
        }
        Update: {
          agent_id?: string
          country?: string | null
          created_at?: string
          owner_user_id?: string
          status?: string
          updated_at?: string
          use_case?: string
          uses?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "agent_id_phone_applications_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agent_id_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_id_relying_parties: {
        Row: {
          audience: string
          created_at: string
          id: string
          name: string
          owner_user_id: string
          policy: Json
          revoked_at: string | null
          secret_hash: string
          secret_prefix: string
          workspace_id: string | null
        }
        Insert: {
          audience: string
          created_at?: string
          id: string
          name: string
          owner_user_id: string
          policy?: Json
          revoked_at?: string | null
          secret_hash: string
          secret_prefix: string
          workspace_id?: string | null
        }
        Update: {
          audience?: string
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
          policy?: Json
          revoked_at?: string | null
          secret_hash?: string
          secret_prefix?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_id_relying_parties_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_id_resources: {
        Row: {
          address: string | null
          agent_id: string
          balance_minor: number
          created_at: string
          currency: string | null
          id: string
          kind: string
          label: string | null
          mode: string
          owner_user_id: string
          provider: string
          provider_ref: string | null
          released_at: string | null
          settings: Json
          state: Json
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          agent_id: string
          balance_minor?: number
          created_at?: string
          currency?: string | null
          id?: string
          kind: string
          label?: string | null
          mode: string
          owner_user_id: string
          provider: string
          provider_ref?: string | null
          released_at?: string | null
          settings?: Json
          state?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          agent_id?: string
          balance_minor?: number
          created_at?: string
          currency?: string | null
          id?: string
          kind?: string
          label?: string | null
          mode?: string
          owner_user_id?: string
          provider?: string
          provider_ref?: string | null
          released_at?: string | null
          settings?: Json
          state?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_id_resources_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_id_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_id_settings: {
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
      agent_id_signing_keys: {
        Row: {
          agent_id: string
          created_at: string
          fingerprint: string
          id: string
          name: string
          public_key: string
          revoked_at: string | null
        }
        Insert: {
          agent_id: string
          created_at?: string
          fingerprint: string
          id?: string
          name?: string
          public_key: string
          revoked_at?: string | null
        }
        Update: {
          agent_id?: string
          created_at?: string
          fingerprint?: string
          id?: string
          name?: string
          public_key?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_id_signing_keys_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agent_id_agents"
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
      timewarp_energy_account_data: {
        Row: {
          key: string
          kind: string
          revision: number
          updated_at: string
          user_id: string
          value: Json | null
        }
        Insert: {
          key: string
          kind: string
          revision: number
          updated_at?: string
          user_id: string
          value?: Json | null
        }
        Update: {
          key?: string
          kind?: string
          revision?: number
          updated_at?: string
          user_id?: string
          value?: Json | null
        }
        Relationships: []
      }
      timewarp_energy_account_data_revisions: {
        Row: {
          revision: number
          user_id: string
        }
        Insert: {
          revision: number
          user_id: string
        }
        Update: {
          revision?: number
          user_id?: string
        }
        Relationships: []
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
      timewarp_shares: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          kind: string
          payload: Json | null
          recipient_user_id: string
          responded_at: string | null
          sender_user_id: string
          status: string
          summary: Json
          title: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          kind: string
          payload?: Json | null
          recipient_user_id: string
          responded_at?: string | null
          sender_user_id: string
          status?: string
          summary?: Json
          title: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          kind?: string
          payload?: Json | null
          recipient_user_id?: string
          responded_at?: string | null
          sender_user_id?: string
          status?: string
          summary?: Json
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "timewarp_shares_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "timewarp_workspaces"
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
      agent_id_card_authorize: {
        Args: {
          p_amount: number
          p_category: string
          p_currency: string
          p_data: Json
          p_merchant: string
          p_provider_ref: string
          p_resource: string
        }
        Returns: Json
      }
      agent_id_decide_approval: {
        Args: { p_approval: string; p_decision: string; p_owner: string }
        Returns: Json
      }
      agent_id_finish_transfer: {
        Args: {
          p_data: Json
          p_event: string
          p_ok: boolean
          p_provider_ref: string
        }
        Returns: Json
      }
      agent_id_limit: {
        Args: { p_key: string; p_limits: Json }
        Returns: number
      }
      agent_id_machine_lease: {
        Args: { p_holder: string; p_resource: string; p_seconds: number }
        Returns: boolean
      }
      agent_id_machine_release: {
        Args: { p_holder: string; p_resource: string }
        Returns: undefined
      }
      agent_id_record_event: {
        Args: {
          p_amount: number
          p_body: string
          p_counterparty: string
          p_currency: string
          p_data: Json
          p_direction: string
          p_folder?: string
          p_kind: string
          p_provider_ref: string
          p_resource: string
          p_status: string
          p_subject: string
          p_thread: string
        }
        Returns: Json
      }
      agent_id_test_fund: {
        Args: { p_amount: number; p_resource: string }
        Returns: Json
      }
      agent_id_user_by_email: { Args: { p_email: string }; Returns: string }
      agent_id_wallet_send: {
        Args: {
          p_agent: string
          p_amount: number
          p_approval: string
          p_counterparty: string
          p_memo: string
          p_to_resource: string
        }
        Returns: Json
      }
      agent_id_wallet_withdraw: {
        Args: {
          p_agent: string
          p_amount: number
          p_memo: string
          p_to: string
        }
        Returns: Json
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
      timewarp_accept_workspace_invite: {
        Args: { p_invite_id?: string; p_token_hash?: string; p_user_id: string }
        Returns: Json
      }
      timewarp_ai_usage: {
        Args: { p_user_id: string; p_workspace_id?: string }
        Returns: Json
      }
      timewarp_ai_usage_unreserved: {
        Args: { p_user_id: string; p_workspace_id?: string }
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
      timewarp_change_member_guarded: {
        Args: {
          p_action: string
          p_actor_user_id: string
          p_member_id: string
          p_new_role?: string
          p_workspace_id: string
        }
        Returns: string
      }
      timewarp_cloud_credit_usage: {
        Args: { p_user_id: string; p_workspace_id?: string }
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
      timewarp_create_shares: {
        Args: {
          p_kind: string
          p_payload: Json
          p_recipients: string[]
          p_sender: string
          p_summary: Json
          p_title: string
          p_workspace_id: string
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
      timewarp_credit_usage_summary: {
        Args: {
          p_period_start: string
          p_user_id: string
          p_workspace_id: string
        }
        Returns: Json
      }
      timewarp_energy_ai_reconciliation_status: { Args: never; Returns: Json }
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
      timewarp_energy_patch_settings: {
        Args: { p_patch: Json; p_user: string }
        Returns: undefined
      }
      timewarp_energy_put_account_data: {
        Args: { p_items: Json; p_user: string }
        Returns: Json
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
      timewarp_is_workspace_member: {
        Args: { p_workspace_id: string }
        Returns: boolean
      }
      timewarp_list_shares: { Args: { p_user: string }; Returns: Json }
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
      timewarp_open_share: {
        Args: { p_share_id: string; p_user: string }
        Returns: Json
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
      timewarp_reserve_agent_ai: {
        Args: { p_credits: number; p_id: string; p_user_id: string }
        Returns: boolean
      }
      timewarp_respond_share: {
        Args: { p_action: string; p_share_id: string; p_user: string }
        Returns: string
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
