import { handleOrderEventsRequest } from '@/lib/order-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  return handleOrderEventsRequest(req);
}
