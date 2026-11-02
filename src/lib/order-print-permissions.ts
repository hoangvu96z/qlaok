import type {
  OrderPaymentStatus,
  ShopPermission,
  TicketPrintType,
} from '@/types/qlaok';

/**
 * Mapping of ticket print type to required shop permission, matching POST /api/orders { action: 'record_print' }.
 * - kitchen & label: orders.print_kitchen
 * - provisional: orders.print_provisional
 * - receipt: orders.view (and order must be paid)
 */
export const PRINT_PERMISSION_BY_TICKET_TYPE: Record<TicketPrintType, ShopPermission> = {
  kitchen: 'orders.print_kitchen',
  label: 'orders.print_kitchen',
  provisional: 'orders.print_provisional',
  receipt: 'orders.view',
};

export const ORDER_PRINT_TICKET_TYPES: readonly TicketPrintType[] = [
  'kitchen',
  'provisional',
  'receipt',
  'label',
] as const;

export function getRequiredPrintPermission(ticketType: TicketPrintType): ShopPermission {
  return PRINT_PERMISSION_BY_TICKET_TYPE[ticketType] || 'orders.view';
}

/**
 * Checks whether an order ticket type can be printed based on:
 * 1. User permission (kitchen/label -> orders.print_kitchen, provisional -> orders.print_provisional, receipt -> orders.view)
 * 2. Order payment status (receipt requires paid)
 */
export function canPrintTicketType(params: {
  ticketType: TicketPrintType;
  paymentStatus?: OrderPaymentStatus | null;
  hasPermission: (permission: ShopPermission) => boolean;
}): boolean {
  const { ticketType, paymentStatus, hasPermission } = params;
  const required = getRequiredPrintPermission(ticketType);
  if (!hasPermission(required)) {
    return false;
  }
  if (ticketType === 'receipt' && paymentStatus !== 'paid') {
    return false;
  }
  return true;
}

/**
 * Returns the list of permitted ticket print types for the given order payment status and permission check.
 */
export function getAllowedTicketTypes(params: {
  paymentStatus?: OrderPaymentStatus | null;
  hasPermission: (permission: ShopPermission) => boolean;
}): TicketPrintType[] {
  return ORDER_PRINT_TICKET_TYPES.filter((type) =>
    canPrintTicketType({
      ticketType: type,
      paymentStatus: params.paymentStatus,
      hasPermission: params.hasPermission,
    })
  );
}

/**
 * Chooses the permitted default ticket type:
 * - If requested initialTicketType is permitted, use it.
 * - Otherwise, if paid and receipt is permitted, use receipt.
 * - Otherwise, if unpaid and provisional is permitted, use provisional.
 * - Otherwise, use the first permitted type among ['kitchen', 'provisional', 'receipt', 'label'].
 * - If no print type is allowed, returns null.
 */
export function resolvePermittedDefaultTicketType(params: {
  initialTicketType?: TicketPrintType;
  paymentStatus?: OrderPaymentStatus | null;
  hasPermission: (permission: ShopPermission) => boolean;
}): TicketPrintType | null {
  const { initialTicketType, paymentStatus, hasPermission } = params;
  const allowed = getAllowedTicketTypes({ paymentStatus, hasPermission });
  if (allowed.length === 0) {
    return null;
  }
  if (initialTicketType && allowed.includes(initialTicketType)) {
    return initialTicketType;
  }
  if (paymentStatus === 'paid' && allowed.includes('receipt')) {
    return 'receipt';
  }
  if (paymentStatus !== 'paid' && allowed.includes('provisional')) {
    return 'provisional';
  }
  return allowed[0];
}
