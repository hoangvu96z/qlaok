import { NextResponse } from 'next/server';
import { ensureSupabaseReadyAndSeeded, getSupabaseDbClient } from '@/lib/db';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { isR2Configured } from '@/lib/r2';
import { getGeminiClient } from '@/lib/gemini';

export async function GET() {
  const sbStatus = await ensureSupabaseReadyAndSeeded();
  const isReady = Boolean(sbStatus.ready && !sbStatus.error);
  const isSeeded = Boolean(isReady && sbStatus.seeded);

  let counts = {
    shops: 0,
    categories: 0,
    items: 0,
    posts: 0,
    analyticsEvents: 0,
    provinces: 34,
  };

  if (isReady) {
    const sb = getSupabaseDbClient();
    const [shopsC, catsC, itemsC, postsC, analyticsC, provsC] =
      await Promise.all([
        sb.from('shops').select('*', { count: 'exact', head: true }),
        sb.from('categories').select('*', { count: 'exact', head: true }),
        sb.from('items').select('*', { count: 'exact', head: true }),
        sb.from('posts').select('*', { count: 'exact', head: true }),
        sb.from('analytics_events').select('*', { count: 'exact', head: true }),
        sb.from('provinces').select('*', { count: 'exact', head: true }),
      ]);

    counts = {
      shops: shopsC.count ?? 0,
      categories: catsC.count ?? 0,
      items: itemsC.count ?? 0,
      posts: postsC.count ?? 0,
      analyticsEvents: analyticsC.count ?? 0,
      provinces: provsC.count ?? 34,
    };
  }

  return NextResponse.json(
    {
      status: isReady ? 'ok' : 'degraded',
      service: 'qlaok-backend',
      dataSource: 'supabase',
      timestamp: new Date().toISOString(),
      environment: {
        supabaseConfigured: isSupabaseConfigured(),
        supabaseTablesReady: isReady,
        supabaseSeeded: isSeeded,
        supabaseMessage: sbStatus.error
          ? sbStatus.error
          : !isReady
            ? 'Supabase not ready'
            : isSeeded
              ? 'Connected & seeded'
              : 'Connected (schema ready)',
        r2Configured: isR2Configured(),
        geminiConfigured: Boolean(getGeminiClient()),
        aiProvider: `9router (${getGeminiClient()?.baseUrl || 'https://vunph.click/v1'} • text: ${getGeminiClient()?.model || 'combo1'} • vision: ${getGeminiClient()?.visionModel || 'combo2'})`,
      },
      counts,
    },
    { status: isReady ? 200 : 503 }
  );
}

