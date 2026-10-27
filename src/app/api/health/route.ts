import { NextResponse } from 'next/server';
import { ensureSupabaseReadyAndSeeded, getSupabaseDbClient } from '@/lib/db';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { isGarageConfigured } from '@/lib/garage-storage';
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
      dataSource: 'self-hosted-postgres',
      timestamp: new Date().toISOString(),
      environment: {
        postgresConfigured: isSupabaseConfigured(),
        postgresTablesReady: isReady,
        postgresSeeded: isSeeded,
        postgresMessage: sbStatus.error
          ? sbStatus.error
          : !isReady
            ? 'PostgreSQL schema/API not ready'
            : isSeeded
              ? 'Connected & seeded'
              : 'Connected (schema ready)',
        garageConfigured: isGarageConfigured(),
        geminiConfigured: Boolean(getGeminiClient()),
        aiProvider: `9router (${getGeminiClient()?.baseUrl || 'https://vunph.click/v1'} • text: ${getGeminiClient()?.model || 'combo1'} • vision: ${getGeminiClient()?.visionModel || 'combo2'})`,
      },
      counts,
    },
    { status: isReady ? 200 : 503 }
  );
}

