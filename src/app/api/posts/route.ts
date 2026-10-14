import { NextResponse } from 'next/server';
import { dbDeletePost, dbGetShopPosts, dbUpsertPost } from '@/lib/db';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const shopId = searchParams.get('shopId') || undefined;
  const posts = await dbGetShopPosts(shopId);
  return NextResponse.json({ posts });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const post = await dbUpsertPost(body);
    return NextResponse.json({ post });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save post';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const postId = searchParams.get('postId');
  if (!postId) {
    return NextResponse.json({ error: 'Missing postId' }, { status: 400 });
  }
  const deleted = await dbDeletePost(postId);
  return NextResponse.json({ deleted });
}

