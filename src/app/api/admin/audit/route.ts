import { NextResponse } from 'next/server';
import { queryAdminAuditLogs, requireSuperAdmin } from '@/lib/server-auth';

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth.errorResponse) return auth.errorResponse;

  const url = new URL(req.url);
  const rawLimit = url.searchParams.get('limit');
  let limit = 100;
  if (rawLimit !== null && rawLimit.trim() !== '') {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return NextResponse.json(
        {
          error: 'Tham số limit phải là số nguyên dương.',
          code: 'INVALID_AUDIT_LIMIT',
        },
        { status: 400 }
      );
    }
    limit = Math.min(500, parsed);
  }

  try {
    const auditLogs = await queryAdminAuditLogs(limit);
    return NextResponse.json({ auditLogs });
  } catch {
    return NextResponse.json(
      {
        error: 'Không thể tải nhật ký quản trị lúc này.',
        code: 'ADMIN_AUDIT_UNAVAILABLE',
      },
      { status: 503 }
    );
  }
}
