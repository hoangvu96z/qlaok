import { NextResponse } from 'next/server';
import { readDb } from '@/lib/local-db';
import { ensureSupabaseReadyAndSeeded, getSupabaseDbClient } from '@/lib/db';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { isR2Configured } from '@/lib/r2';
import { getGeminiClient } from '@/lib/gemini';

export async function GET() {
  const db = readDb();
  const sbStatus = await ensureSupabaseReadyAndSeeded();
  const sb = getSupabaseDbClient();

  let counts = {
    shops: db.shops.length,
    categories: db.categories.length,
    items: db.items.length,
    posts: db.posts.length,
    analyticsEvents: db.analytics.length,
    provinces: 34,
  };

  if (sbStatus.ready && sb) {
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
      shops: shopsC.count ?? counts.shops,
      categories: catsC.count ?? counts.categories,
      items: itemsC.count ?? counts.items,
      posts: postsC.count ?? counts.posts,
      analyticsEvents: analyticsC.count ?? counts.analyticsEvents,
      provinces: provsC.count ?? 34,
    };
  }

  return NextResponse.json({
    status: 'ok',
    service: 'qlaok-backend',
    dataSource: sbStatus.ready ? 'supabase' : 'local',
    timestamp: new Date().toISOString(),
    environment: {
      localDbReady: true,
      supabaseConfigured: isSupabaseConfigured(),
      supabaseTablesReady: sbStatus.ready,
      supabaseMessage: sbStatus.error || 'Connected & seeded',
      r2Configured: isR2Configured(),
      geminiConfigured: Boolean(getGeminiClient()),
    },
    counts,
  });
}


