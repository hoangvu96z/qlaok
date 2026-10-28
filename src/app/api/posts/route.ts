import { NextResponse } from 'next/server';
import {
  dbDeletePost,
  dbGetShopPosts,
  dbUpsertPost,
  getSupabaseDbClient,
} from '@/lib/db';
import { requireShopOwnerOrAdmin } from '@/lib/server-auth';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const shopId = (searchParams.get('shopId') || '').trim();
  if (!shopId) {
    return NextResponse.json(
      { error: 'Missing shopId', code: 'SHOP_ID_REQUIRED' },
      { status: 400 }
    );
  }
  const posts = await dbGetShopPosts(shopId);
  return NextResponse.json({ posts: posts.filter((post) => post.is_active) });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const targetShopId = body.shop_id;
    const auth = await requireShopOwnerOrAdmin(req, targetShopId);
    if (auth.errorResponse) return auth.errorResponse;

    const post = await dbUpsertPost(body);
    return NextResponse.json({ post });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to save post';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const postId = searchParams.get('postId');
  if (!postId) {
    return NextResponse.json({ error: 'Missing postId' }, { status: 400 });
  }

  const sb = getSupabaseDbClient();
  const { data: post } = await sb
    .from('posts')
    .select('id, shop_id')
    .eq('id', postId)
    .maybeSingle();

  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  }

  const auth = await requireShopOwnerOrAdmin(req, post.shop_id);
  if (auth.errorResponse) return auth.errorResponse;

  const deleted = await dbDeletePost(postId);
  return NextResponse.json({ deleted });
}
