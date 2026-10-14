import { NextResponse } from 'next/server';
import {
  dbCompletePaymentWebhook,
  dbCreatePaymentOrder,
  dbGetBillingData,
  dbSetProfilePlan,
} from '@/lib/db';
import { PlanTier } from '@/types/qlaok';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ownerId = searchParams.get('ownerId') || undefined;
  const data = await dbGetBillingData(ownerId);
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, ownerId } = body;

    if (action === 'create_order') {
      const targetPlan: PlanTier = body.targetPlan || 'premium';
      const amount = Number(
        body.amount ?? (targetPlan === 'basic' ? 39000 : 69000)
      );
      const transaction = await dbCreatePaymentOrder(
        targetPlan,
        amount,
        ownerId
      );
      return NextResponse.json({ transaction }, { status: 201 });
    }

    if (action === 'switch_plan_direct') {
      const plan: PlanTier = body.plan || 'premium';
      const profile = await dbSetProfilePlan(plan, ownerId);
      return NextResponse.json({ profile });
    }

    // SePay / PayOS webhook payload or local simulated webhook completion
    const orderCode =
      body.orderCode ||
      body.code ||
      (typeof body.content === 'string'
        ? body.content.match(/QLAOK[A-Z0-9]+/i)?.[0]
        : null);

    if (!orderCode) {
      return NextResponse.json(
        { error: 'Missing orderCode in webhook payload' },
        { status: 400 }
      );
    }

    const result = await dbCompletePaymentWebhook(
      orderCode,
      body.referenceCode || body.bankRefId,
      ownerId
    );
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Payment webhook error:', error);
    return NextResponse.json(
      { error: 'Payment processing failed' },
      { status: 500 }
    );
  }
}

