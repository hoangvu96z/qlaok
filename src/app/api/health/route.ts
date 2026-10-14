import { NextResponse } from 'next/server';
import { readDb } from '@/lib/local-db';
import { ensureSupabaseReadyAndSeeded } from '@/lib/db';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { isR2Configured } from '@/lib/r2';
import { getGeminiClient } from '@/lib/gemini';

export async function GET() {
  const db = readDb();
  const sbStatus = await ensureSupabaseReadyAndSeeded();

  return NextResponse.json({
    status: 'ok',
    service: 'qlaok-backend',
    timestamp: new Date().toISOString(),
    environment: {
      localDbReady: true,
      supabaseConfigured: isSupabaseConfigured(),
      supabaseTablesReady: sbStatus.ready,
      supabaseMessage: sbStatus.error || 'Connected & seeded',
      r2Configured: isR2Configured(),
      geminiConfigured: Boolean(getGeminiClient()),
    },
    counts: {
      shops: db.shops.length,
      categories: db.categories.length,
      items: db.items.length,
      posts: db.posts.length,
      analyticsEvents: db.analytics.length,
    },
  });
}

