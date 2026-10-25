-- Remove what only the previous Timewarp app (the Desktop-APP repository) used:
-- its cloud agents and job runner, cloud sync and memory, MCP server and OAuth,
-- Twilio numbers, agent cards and wallets, Company Base, the old agent and chat
-- shares and credit auto-recharge, plus the first cloud conversation tables of
-- the rebuilt app (timewarp_energy_agents, _conversations, _runs) that the local
-- harness replaced. Nothing in the desktop app, the website, Agent ID or the
-- kept edge functions reads any of it, and none of these tables changed after
-- 2026-09-28.
--
-- Before applying: deploy the trimmed timewarp-agent-mail-webhook from this
-- repository (the old copy writes to timewarp_agent_mail_messages first). The
-- three storage buckets (agent-artifacts, timewarp-company-base,
-- timewarp-user-data) are emptied and deleted through the Storage API, because
-- Supabase refuses direct deletes from storage tables.
begin;

-- The per-minute jobs that call the old timewarp-personal-agent function, and
-- the cloud-agent tick the old runner scheduled while its agents were due.
select cron.unschedule(jobid) from cron.job
where jobname in ('timewarp-agent-jobs', 'timewarp-desktop-sweep', 'timewarp-cloud-agent-tick');

delete from vault.secrets
where name in ('agent_job_worker_key', 'timewarp_cloud_agent_runner_url', 'timewarp_cloud_agent_runner_secret');

drop function public.claim_due_timewarp_cloud_agents(p_limit integer);
drop function public.configure_agent_job_scheduler(project_url text, service_role_key text);
drop function public.invoke_timewarp_cloud_agent_tick();
drop function public.invoke_timewarp_desktop_sweep();
drop function public.list_timewarp_cloud_agent_runs(p_scope_key text, p_limit_per_agent integer);
drop function public.sync_timewarp_cloud_agent_tick_schedule();
drop function public.timewarp_add_agent_team_compute_credits(p_user_id uuid, p_team_id uuid, p_credits numeric);
drop function public.timewarp_append_personal_agent_run_event(p_user_id uuid, p_run_id uuid, p_root_run_id uuid, p_agent_id text, p_kind text, p_message text, p_status text, p_metadata jsonb);
drop function public.timewarp_approve_agent_card_payment_request(p_user_id uuid, p_agent_id text, p_request_id uuid);
drop function public.timewarp_begin_agent_card_payment_handoff(p_user_id uuid, p_agent_id text, p_request_id uuid);
drop function public.timewarp_cancel_agent_job(p_user_id uuid, p_agent_id text, p_request_id uuid);
drop function public.timewarp_checkpoint_agent_job(p_run_id uuid, p_holder uuid, p_checkpoint jsonb, p_phase text);
drop function public.timewarp_claim_agent_compute_lease(p_compute_id text, p_holder uuid, p_lease_seconds integer);
drop function public.timewarp_claim_agent_jobs(p_holder uuid, p_limit integer);
drop function public.timewarp_claim_agent_team_compute_interval(p_user_id uuid, p_team_id uuid, p_live_ended_at timestamp with time zone);
drop function public.timewarp_claim_credit_recharge(p_workspace_id uuid, p_owner_user_id uuid);
drop function public.timewarp_claim_legacy_personal_agent_continuation(p_user_id uuid, p_agent_id text, p_root_run_id uuid, p_token_hash text, p_expires_at timestamp with time zone);
drop function public.timewarp_claim_personal_agent_continuation(p_user_id uuid, p_agent_id text, p_root_run_id uuid, p_token_hash text, p_generation integer);
drop function public.timewarp_complete_agent_card_payment_handoff(p_user_id uuid, p_agent_id text, p_request_id uuid, p_result text);
drop function public.timewarp_create_agent_card_payment_request(p_user_id uuid, p_agent_id text, p_amount_cents bigint, p_currency text, p_merchant_url text, p_merchant_origin text, p_merchant_domain text, p_merchant_name text, p_purpose text);
drop function public.timewarp_credit_recharge_failed(p_workspace_id uuid, p_owner_user_id uuid, p_stripe_ref text);
drop function public.timewarp_deactivate_agent_card(p_user_id uuid, p_agent_id text);
drop function public.timewarp_deliver_workspace_chat(p_workspace_id uuid, p_sender_user_id uuid, p_recipient_user_id uuid, p_title text, p_messages jsonb, p_artifacts jsonb, p_context_usage jsonb, p_tokens_used integer, p_context_attachments jsonb);
drop function public.timewarp_energy_claim(p_holder uuid, p_run_id uuid);
drop function public.timewarp_energy_native_agent(p_user uuid, p_id uuid, p_name text, p_instructions text);
drop function public.timewarp_energy_native_submit(p_user uuid, p_conversation uuid, p_agent uuid, p_request uuid, p_prompt text, p_model text, p_start boolean);
drop function public.timewarp_enqueue_agent_job(p_user_id uuid, p_agent_id text, p_request_id uuid, p_task_id text, p_payload jsonb);
drop function public.timewarp_enqueue_owner_message(p_user_id uuid, p_agent_id text, p_run_id uuid, p_message_id text, p_text text, p_question_id text);
drop function public.timewarp_finish_agent_ai(p_id uuid, p_user_id uuid, p_model text, p_input integer, p_output integer, p_cost numeric, p_outcome text);
drop function public.timewarp_finish_agent_job(p_run_id uuid, p_holder uuid, p_status text, p_checkpoint jsonb, p_result jsonb, p_available_at timestamp with time zone);
drop function public.timewarp_heartbeat_agent_desktop(p_user_id uuid, p_compute_id text, p_agent_id text, p_session_id uuid, p_credits_per_second numeric, p_provider_usd_per_second numeric);
drop function public.timewarp_issue_personal_agent_continuation(p_user_id uuid, p_agent_id text, p_root_run_id uuid, p_token_hash text, p_generation integer, p_expires_at timestamp with time zone, p_predecessor_token_hash text);
drop function public.timewarp_merge_jsonb_records_by_id(p_old jsonb, p_new jsonb);
drop function public.timewarp_merge_scope_memory(p_scope_key text, p_user_id uuid, p_workspace_id uuid, p_facts jsonb, p_episodes jsonb);
drop function public.timewarp_merge_workspace_memory_snapshot(p_workspace_id uuid, p_user_id uuid, p_business_dna jsonb, p_memory_hub_tree jsonb, p_knowledge text);
drop function public.timewarp_record_ai_cost(p_user_id uuid, p_model text, p_prompt_tokens integer, p_response_tokens integer, p_cost_usd numeric, p_workspace_id uuid, p_paid_with text);
drop function public.timewarp_release_agent_compute_lease(p_compute_id text, p_holder uuid);
drop function public.timewarp_replace_scope_memory(p_scope_key text, p_user_id uuid, p_workspace_id uuid, p_facts jsonb, p_episodes jsonb);
drop function public.timewarp_resume_agent_job(p_user_id uuid, p_agent_id text, p_run_id uuid, p_revision integer, p_response jsonb);
drop function public.timewarp_set_credit_recharge(p_workspace_id uuid, p_owner_user_id uuid, p_user_id uuid, p_enabled boolean, p_pack_credits integer, p_threshold numeric);
drop function public.timewarp_settle_agent_compute_usage(p_user_id uuid, p_compute_id text, p_agent_id text, p_team_id uuid, p_started_at timestamp with time zone, p_finished_at timestamp with time zone, p_credits_per_second numeric, p_provider_usd_per_second numeric);
drop function public.timewarp_settle_agent_desktop_usage(p_user_id uuid, p_compute_id text, p_agent_id text, p_keepalive boolean, p_credits_per_second numeric, p_provider_usd_per_second numeric);
drop function public.timewarp_settle_credit_usage(p_user_id uuid, p_workspace_id uuid, p_usage_kind text, p_credits numeric, p_provider_cost_usd numeric);
drop function public.timewarp_spend_credits(p_user_id uuid, p_workspace_id uuid, p_credits numeric, p_model text, p_cost_usd numeric);
drop function public.timewarp_store_agent_card(p_user_id uuid, p_agent_id text, p_stripe_payment_method_id text, p_brand text, p_last4 text, p_exp_month integer, p_exp_year integer);
drop function public.timewarp_update_member_guarded(p_workspace_id uuid, p_member_id uuid, p_action text, p_new_role text);
drop function public.upsert_timewarp_cloud_snapshot(p_profile jsonb, p_business_dna jsonb, p_chats jsonb, p_knowledge text, p_work_stack jsonb, p_storage_objects jsonb);

drop table
  public.agent_webhook_endpoints,
  public.agent_webhook_events,
  public.timewarp_agent_action_receipts,
  public.timewarp_agent_artifacts,
  public.timewarp_agent_card_payment_requests,
  public.timewarp_agent_card_policies,
  public.timewarp_agent_cards,
  public.timewarp_agent_compute_clocks,
  public.timewarp_agent_compute_leases,
  public.timewarp_agent_desktop_sessions,
  public.timewarp_agent_jobs,
  public.timewarp_agent_mail_messages,
  public.timewarp_agent_messages,
  public.timewarp_agent_payment_customers,
  public.timewarp_agent_shared_memory_entries,
  public.timewarp_agent_shares,
  public.timewarp_agent_teams,
  public.timewarp_chat_sessions,
  public.timewarp_cloud_mcp_credentials,
  public.timewarp_cloud_snapshots,
  public.timewarp_cloud_sync_events,
  public.timewarp_energy_agents,
  public.timewarp_energy_conversations,
  public.timewarp_energy_runs,
  public.timewarp_mcp_oauth_clients,
  public.timewarp_mcp_oauth_codes,
  public.timewarp_mcp_oauth_requests,
  public.timewarp_mcp_oauth_tokens,
  public.timewarp_memory_episodes,
  public.timewarp_memory_facts,
  public.timewarp_operation_runs,
  public.timewarp_operations,
  public.timewarp_personal_agent_continuations,
  public.timewarp_personal_agent_run_events,
  public.timewarp_personal_agent_runs,
  public.timewarp_personal_agents,
  public.timewarp_twilio_calls,
  public.timewarp_twilio_connect_states,
  public.timewarp_twilio_connections,
  public.timewarp_twilio_messages,
  public.timewarp_twilio_numbers,
  public.timewarp_wallet_checkout_links,
  public.timewarp_wallet_checkout_requests,
  public.timewarp_wallet_merchant_accounts,
  public.timewarp_wallet_payment_receipts,
  public.timewarp_workspace_chat_shares,
  public.timewarp_workspace_company_bases;

-- Trigger functions, once their tables are gone.
drop function public.refresh_timewarp_cloud_agent_tick_schedule();
drop function public.timewarp_enforce_agent_card_spend_windows();

drop policy if exists "Users read own timewarp storage" on storage.objects;
drop policy if exists "Users upload own timewarp storage" on storage.objects;
drop policy if exists "Users update own timewarp storage" on storage.objects;
drop policy if exists "Users delete own timewarp storage" on storage.objects;

commit;
