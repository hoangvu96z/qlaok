// Run on the application server after migration/deploy. No credentials or order
// payloads are logged, and no test records are written to the production DB.
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';
const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Realtime backend configuration is missing');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const channel = client.channel('qlaok-deploy-realtime-check');
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime subscription timed out')), 15000);
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {}).subscribe((status, _error) => {
      if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error(`Realtime subscription failed (${status})`)); }
    });
  });
  console.log('Orders Realtime subscription verified.');
} finally { await client.removeChannel(channel); client.realtime.disconnect(); }
