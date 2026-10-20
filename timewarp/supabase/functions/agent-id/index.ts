// Timewarp Agent ID on Supabase Edge Functions. The service itself is app.ts.
import { createClient } from 'npm:@supabase/supabase-js@2.106.2';
import { createHandler } from './app.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', {
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(createHandler({ admin, env: name => Deno.env.get(name) || '' }));
