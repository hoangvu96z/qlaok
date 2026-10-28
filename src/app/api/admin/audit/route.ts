import { NextResponse } from 'next/server';
import { readAdminAuditLog, requireSuperAdmin } from '@/lib/server-auth';

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth.errorResponse) return auth.errorResponse;

  const requestedLimit = Number(new URL(req.url).searchParams.get('limit') || 200);
  const events = readAdminAuditLog(requestedLimit);
  return NextResponse.json({ events });
}
