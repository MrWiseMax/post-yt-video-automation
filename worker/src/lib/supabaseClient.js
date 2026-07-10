import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

/** Service-role client (bypasses RLS). Server-side only. */
export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // supabase-js v2.110+ requires a WebSocket implementation at client
    // construction even though the workers never use realtime. Node < 22 has
    // no native WebSocket, so fall back to the `ws` package there.
    realtime: { transport: globalThis.WebSocket ?? ws },
  });
}
