BEGIN;

-- A row's scope must be its writer's own. The cloud functions find context by
-- scope_key alone (cloud agent runs, memory search, cloud sync), so a row
-- someone filed under another person's scope would read that person's
-- snapshot into their own agent run, or put chats and memory into the other
-- person's agent. Ownership was checked; the scope wasn't.
--   personal rows:  personal:<user>
--   workspace rows: workspace:<workspace>:member:<user>, and for shared
--                   memory workspace:<workspace>:memory (unchanged)
-- The cloud functions write these tables with the service role, which these
-- rules don't bind, and no app writes them directly; only direct API access
-- with a user's session changes.

DROP POLICY IF EXISTS "Users manage private workspace operations" ON public.timewarp_operations;
CREATE POLICY "Users manage private workspace operations" ON public.timewarp_operations
  FOR ALL TO authenticated
  USING (
    auth.uid() = user_id AND (
      (workspace_id IS NULL AND scope_key = 'personal:' || auth.uid()::text)
      OR (workspace_id IS NOT NULL AND public.timewarp_is_workspace_member(workspace_id)
          AND scope_key = 'workspace:' || workspace_id::text || ':member:' || auth.uid()::text)
    )
  )
  WITH CHECK (
    auth.uid() = user_id AND (
      (workspace_id IS NULL AND scope_key = 'personal:' || auth.uid()::text)
      OR (workspace_id IS NOT NULL AND public.timewarp_is_workspace_member(workspace_id)
          AND scope_key = 'workspace:' || workspace_id::text || ':member:' || auth.uid()::text)
    )
  );

DROP POLICY IF EXISTS "Users manage private workspace operation runs" ON public.timewarp_operation_runs;
CREATE POLICY "Users manage private workspace operation runs" ON public.timewarp_operation_runs
  FOR ALL TO authenticated
  USING (
    auth.uid() = user_id AND (
      (workspace_id IS NULL AND scope_key = 'personal:' || auth.uid()::text)
      OR (workspace_id IS NOT NULL AND public.timewarp_is_workspace_member(workspace_id)
          AND scope_key = 'workspace:' || workspace_id::text || ':member:' || auth.uid()::text)
    )
  )
  WITH CHECK (
    auth.uid() = user_id AND (
      (workspace_id IS NULL AND scope_key = 'personal:' || auth.uid()::text)
      OR (workspace_id IS NOT NULL AND public.timewarp_is_workspace_member(workspace_id)
          AND scope_key = 'workspace:' || workspace_id::text || ':member:' || auth.uid()::text)
    )
  );

DROP POLICY IF EXISTS "Users manage private workspace chats" ON public.timewarp_chat_sessions;
CREATE POLICY "Users manage private workspace chats" ON public.timewarp_chat_sessions
  FOR ALL TO authenticated
  USING (
    auth.uid() = user_id AND (
      (workspace_id IS NULL AND scope_key = 'personal:' || auth.uid()::text)
      OR (workspace_id IS NOT NULL AND public.timewarp_is_workspace_member(workspace_id)
          AND scope_key = 'workspace:' || workspace_id::text || ':member:' || auth.uid()::text)
    )
  )
  WITH CHECK (
    auth.uid() = user_id AND (
      (workspace_id IS NULL AND scope_key = 'personal:' || auth.uid()::text)
      OR (workspace_id IS NOT NULL AND public.timewarp_is_workspace_member(workspace_id)
          AND scope_key = 'workspace:' || workspace_id::text || ':member:' || auth.uid()::text)
    )
  );

DROP POLICY IF EXISTS "Users manage isolated cloud snapshots" ON public.timewarp_cloud_snapshots;
CREATE POLICY "Users manage isolated cloud snapshots" ON public.timewarp_cloud_snapshots
  FOR ALL TO authenticated
  USING (
    (workspace_id IS NULL AND auth.uid() = user_id AND scope_key = 'personal:' || auth.uid()::text)
    OR (
      workspace_id IS NOT NULL
      AND public.timewarp_is_workspace_member(workspace_id)
      AND (
        (auth.uid() = user_id AND scope_key = 'workspace:' || workspace_id::text || ':member:' || auth.uid()::text)
        OR scope_key = 'workspace:' || workspace_id::text || ':memory'
      )
    )
  )
  WITH CHECK (
    (workspace_id IS NULL AND auth.uid() = user_id AND scope_key = 'personal:' || auth.uid()::text)
    OR (
      workspace_id IS NOT NULL
      AND public.timewarp_is_workspace_member(workspace_id)
      AND (
        (auth.uid() = user_id AND scope_key = 'workspace:' || workspace_id::text || ':member:' || auth.uid()::text)
        OR scope_key = 'workspace:' || workspace_id::text || ':memory'
      )
    )
  );

DROP POLICY IF EXISTS "Members manage shared workspace memory facts" ON public.timewarp_memory_facts;
CREATE POLICY "Members manage shared workspace memory facts" ON public.timewarp_memory_facts
  FOR ALL TO authenticated
  USING (
    (workspace_id IS NULL AND auth.uid() = user_id AND scope_key = 'personal:' || auth.uid()::text)
    OR (workspace_id IS NOT NULL AND public.timewarp_is_workspace_member(workspace_id)
        AND scope_key = 'workspace:' || workspace_id::text || ':memory')
  )
  WITH CHECK (
    (workspace_id IS NULL AND auth.uid() = user_id AND scope_key = 'personal:' || auth.uid()::text)
    OR (workspace_id IS NOT NULL AND public.timewarp_is_workspace_member(workspace_id)
        AND scope_key = 'workspace:' || workspace_id::text || ':memory')
  );

DROP POLICY IF EXISTS "Members manage shared workspace memory episodes" ON public.timewarp_memory_episodes;
CREATE POLICY "Members manage shared workspace memory episodes" ON public.timewarp_memory_episodes
  FOR ALL TO authenticated
  USING (
    (workspace_id IS NULL AND auth.uid() = user_id AND scope_key = 'personal:' || auth.uid()::text)
    OR (workspace_id IS NOT NULL AND public.timewarp_is_workspace_member(workspace_id)
        AND scope_key = 'workspace:' || workspace_id::text || ':memory')
  )
  WITH CHECK (
    (workspace_id IS NULL AND auth.uid() = user_id AND scope_key = 'personal:' || auth.uid()::text)
    OR (workspace_id IS NOT NULL AND public.timewarp_is_workspace_member(workspace_id)
        AND scope_key = 'workspace:' || workspace_id::text || ':memory')
  );

-- A profile's own columns stay editable by its person: the previous app
-- writes its name and onboarding answers directly. created_at anchors the
-- billing period of a subscription that has no anchor of its own, so moving it
-- would restart the period's included usage; it and id stay with the server.
REVOKE INSERT, UPDATE ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT INSERT (user_id, email, name, interests, storage_preference, last_cloud_sync_at, work_stack, onboarded) ON public.profiles TO authenticated;
GRANT UPDATE (user_id, email, name, interests, storage_preference, last_cloud_sync_at, work_stack, onboarded) ON public.profiles TO authenticated;

COMMIT;
