-- Apply to the Timewarp staging project, then production during the rollout.
-- The Supabase Cron extension must be enabled in that project first.
-- Idempotently installs a database-local job; no service key is embedded.
SELECT cron.schedule('timewarp-desktop-ai-reconciliation','* * * * *',
  $$SELECT public.timewarp_energy_retry_ai_settlements(100);$$);
