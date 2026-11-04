import { NextResponse } from 'next/server';
import {
  dbDeletePost,
  dbGetShopById,
  dbGetShopPosts,
  dbUpsertPost,
  getSupabaseDbClient,
} from '@/lib/db';
import {
  requireAuthenticatedUser,
  requireShopOwnerOrAdmin,
} from '@/lib/server-auth';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const shopId = (searchParams.get('shopId') || '').trim();
  if (!shopId) {
    return NextResponse.json(
      { error: 'Missing shopId', code: 'SHOP_ID_REQUIRED' },
      { status: 400 }
    );
  }
  try {
    const shop = await dbGetShopById(shopId);
    if (!shop || shop.is_published === false) {
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    }

    const posts = await dbGetShopPosts(shopId);
    return NextResponse.json({ posts: posts.filter((post) => post.is_active) });
  } catch {
    return NextResponse.json(
      { error: 'Unable to load shop posts', code: 'SHOP_POSTS_QUERY_FAILED' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const targetShopId = body.shop_id;
    const auth = await requireShopOwnerOrAdmin(req, targetShopId);
    if (auth.errorResponse) return auth.errorResponse;

    const post = await dbUpsertPost(body);
    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }
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

  const authentication = await requireAuthenticatedUser(req);
  if (authentication.errorResponse) return authentication.errorResponse;

  let post: { id: string; shop_id: string } | null;
  try {
    const sb = getSupabaseDbClient();
    const { data, error } = await sb
      .from('posts')
      .select('id, shop_id')
      .eq('id', postId)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        {
          error: 'Không thể kiểm tra thông báo để xóa. Vui lòng thử lại sau.',
          code: 'POST_LOOKUP_FAILED',
        },
        { status: 500 }
      );
    }
    post = data;
  } catch {
    return NextResponse.json(
      {
        error: 'Không thể kiểm tra thông báo để xóa. Vui lòng thử lại sau.',
        code: 'POST_LOOKUP_FAILED',
      },
      { status: 500 }
    );
  }

  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  }

  const auth = await requireShopOwnerOrAdmin(req, post.shop_id);
  if (auth.errorResponse) {
    if (auth.errorResponse.status === 403) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }
    return auth.errorResponse;
  }

  try {
    const deleted = await dbDeletePost(postId);
    if (!deleted) {
      return NextResponse.json(
        {
          deleted: false,
          error: 'Không thể xóa thông báo. Vui lòng tải lại và thử lại.',
          code: 'POST_DELETE_FAILED',
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json(
      {
        deleted: false,
        error: 'Không thể xóa thông báo. Vui lòng thử lại sau.',
        code: 'POST_DELETE_FAILED',
      },
      { status: 500 }
    );
  }
}
