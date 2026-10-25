import type { ServiceRequestNotificationRule, ServiceRequestType } from '@/types/qlaok';

export const DEFAULT_SERVICE_REQUEST_NOTIFICATION_RULE: ServiceRequestNotificationRule =
  'all_order_staff';

export function normalizeServiceRequestNotificationRule(
  value: unknown
): ServiceRequestNotificationRule {
  return value === 'owner_only' ? 'owner_only' : DEFAULT_SERVICE_REQUEST_NOTIFICATION_RULE;
}

export function getUnseenPendingServiceRequests<
  T extends { id: string; status: string },
>(requests: readonly T[], knownIds: ReadonlySet<string>): T[] {
  return requests.filter(
    (request) => request.status === 'pending' && !knownIds.has(request.id)
  );
}

export function shouldNotifyBrowserServiceRequest(params: {
  rule: unknown;
  requestType: ServiceRequestType;
  userId?: string | null;
  ownerId?: string | null;
}): boolean {
  if (
    params.requestType !== 'call_staff' ||
    normalizeServiceRequestNotificationRule(params.rule) !== 'owner_only'
  ) {
    return true;
  }

  return Boolean(params.userId && params.ownerId && params.userId === params.ownerId);
}
