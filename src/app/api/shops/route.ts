import { NextResponse } from 'next/server';
import {
  dbCreateShop,
  dbGetAllShopsAndProfile,
  dbGetShopById,
  dbGetStorefrontBundle,
  dbUpdateShop,
} from '@/lib/db';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get('slug');
  const shopId = searchParams.get('shopId');
  const ownerId = searchParams.get('ownerId') || undefined;

  if (slug) {
    const bundle = await dbGetStorefrontBundle(slug);
    if (!bundle) {
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    }
    return NextResponse.json(bundle);
  }

  if (shopId) {
    const shop = await dbGetShopById(shopId);
    if (!shop) {
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    }
    return NextResponse.json({ shop });
  }

  const data = await dbGetAllShopsAndProfile(ownerId);
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const created = await dbCreateShop(body, body.owner_id);
    return NextResponse.json({ shop: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create shop';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id, ...patch } = body;
    if (!id) {
      return NextResponse.json({ error: 'Missing shop id' }, { status: 400 });
    }
    const updated = await dbUpdateShop(id, patch);
    if (!updated) {
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    }
    return NextResponse.json({ shop: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update shop';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

