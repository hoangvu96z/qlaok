import React, { memo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  MAX_ORDER_REASON_LENGTH,
  MobileOrderReasonActionType,
  MobileOrderStatusUpdateOptions,
  normalizeOrderReason,
  validateOrderActionReason,
} from '../../lib/order-actions';
import {
  formatVnd,
  MobileOrderPaymentStatus,
  MobileShopOrder,
} from '../../lib/supabase';
import { MobileThemePalette, styles } from '../../styles/mobileStyles';
import { useMobileI18n } from '../MobileI18nProvider';

export type OrderFilterType = 'active' | 'new' | 'preparing' | 'completed';

interface OrdersTabProps {
  orders: MobileShopOrder[];
  orderFilter: OrderFilterType;
  onChangeOrderFilter: (filter: OrderFilterType) => void;
  onUpdateOrderStatus: (
    orderId: string,
    status: 'new' | 'preparing' | 'completed' | 'cancelled',
    payment_status?: MobileOrderPaymentStatus,
    options?: MobileOrderStatusUpdateOptions
  ) => void;
  onPrintOrder: (order: MobileShopOrder) => void;
  pendingOrderIds?: string[];
  fetchError?: string;
  onRetryFetchOrders?: () => void;
  canCollectPayment?: boolean;
  canRefundOrder?: boolean;
  canCancelOrder?: boolean;
  theme: MobileThemePalette;
}

export const OrdersTab = memo(function OrdersTab({
  orders,
  orderFilter,
  onChangeOrderFilter,
  onUpdateOrderStatus,
  onPrintOrder,
  pendingOrderIds = [],
  fetchError = '',
  onRetryFetchOrders,
  canCollectPayment = true,
  canRefundOrder = false,
  canCancelOrder = false,
  theme,
}: OrdersTabProps) {
  const { t } = useMobileI18n();
  const [reasonPrompt, setReasonPrompt] = useState<{
    action: MobileOrderReasonActionType;
    order: MobileShopOrder;
  } | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const [reasonError, setReasonError] = useState('');

  const newOrdersCount = orders.filter((o) => o.status === 'new').length;
  const preparingOrdersCount = orders.filter(
    (o) => o.status === 'preparing'
  ).length;
  const activeOrdersCount = orders.filter(
    (o) =>
      o.status === 'new' ||
      o.status === 'preparing' ||
      (o.status !== 'cancelled' && o.payment_status === 'unpaid')
  ).length;

  const closeReasonPrompt = () => {
    setReasonPrompt(null);
    setReasonDraft('');
    setReasonError('');
  };

  const confirmCancelOrder = (order: MobileShopOrder) => {
    setReasonPrompt({ action: 'cancel', order });
    setReasonDraft('');
    setReasonError('');
  };

  const confirmMarkPaid = (order: MobileShopOrder) => {
    Alert.alert(
      t('orders.confirmPaidTitle'),
      t('orders.confirmPaidDesc', {
        code: order.order_code,
        total: formatVnd(order.total_amount),
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('orders.actionConfirmPaid'),
          onPress: () => onUpdateOrderStatus(order.id, order.status, 'paid'),
        },
      ]
    );
  };

  const confirmRefundOrder = (order: MobileShopOrder) => {
    setReasonPrompt({ action: 'refund', order });
    setReasonDraft('');
    setReasonError('');
  };

  const submitReasonPrompt = () => {
    if (!reasonPrompt) return;
    const validation = validateOrderActionReason(
      reasonPrompt.action,
      reasonDraft
    );
    if (!validation.ok) {
      if (validation.code === 'REASON_TOO_LONG') {
        setReasonError(
          t('orders.reasonTooLong', { max: MAX_ORDER_REASON_LENGTH })
        );
      } else {
        setReasonError(
          t(
            reasonPrompt.action === 'refund'
              ? 'orders.refundReasonRequired'
              : 'orders.cancelReasonRequired'
          )
        );
      }
      return;
    }

    const targetOrder = reasonPrompt.order;
    const action = reasonPrompt.action;
    const reason = validation.reason;
    closeReasonPrompt();

    if (action === 'refund') {
      onUpdateOrderStatus(targetOrder.id, targetOrder.status, 'refunded', {
        refundReason: reason,
      });
      return;
    }

    onUpdateOrderStatus(targetOrder.id, 'cancelled', undefined, {
      cancelledReason: reason,
      restockItems: targetOrder.status === 'new',
    });
  };

  const visibleOrders = orders.filter((o) => {
    if (orderFilter === 'active') {
      return (
        o.status === 'new' ||
        o.status === 'preparing' ||
        (o.status !== 'cancelled' && o.payment_status === 'unpaid')
      );
    }
    return o.status === orderFilter;
  });

  return (
    <View style={styles.sectionStack}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {[
          {
            id: 'active',
            label: t('orders.filterActive', { count: activeOrdersCount }),
          },
          {
            id: 'new',
            label: t('orders.filterNew', { count: newOrdersCount }),
          },
          {
            id: 'preparing',
            label: t('orders.filterPreparing', {
              count: preparingOrdersCount,
            }),
          },
          { id: 'completed', label: t('orders.filterCompleted') },
        ].map((f) => {
          const active = orderFilter === f.id;
          return (
            <TouchableOpacity
              key={f.id}
              onPress={() => onChangeOrderFilter(f.id as OrderFilterType)}
              style={[
                styles.catChip,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.border,
                },
                active && styles.catChipActive,
              ]}
            >
              <Text
                style={[
                  styles.catChipText,
                  { color: theme.subText },
                  active && styles.catChipTextActive,
                ]}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {fetchError ? (
        <View
          accessibilityRole="alert"
          style={[
            styles.card,
            {
              backgroundColor: '#fef2f2',
              borderColor: '#fecaca',
            },
          ]}
        >
          <Text style={[styles.cardHeading, { color: '#991b1b', marginBottom: 4 }]}>
            {t('orders.fetchErrorTitle')}
          </Text>
          <Text style={[styles.itemSub, { color: '#b91c1c', marginBottom: 12 }]}>
            {fetchError}
          </Text>
          {onRetryFetchOrders && (
            <TouchableOpacity
              accessibilityRole="button"
              style={[
                styles.btnPrepare,
                { backgroundColor: '#dc2626', minWidth: 120, flex: 0, alignSelf: 'flex-start', paddingHorizontal: 16 },
              ]}
              onPress={onRetryFetchOrders}
            >
              <Text style={styles.btnPrepareText}>{t('orders.retryBtn')}</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : null}

      {visibleOrders.length === 0 && !fetchError ? (
        <View
          style={[
            styles.card,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.cardHeading, { color: theme.text }]}>
            {t('orders.emptyTitle')}
          </Text>
          <Text style={[styles.itemSub, { color: theme.subText }]}>
            {t('orders.emptyDesc')}
          </Text>
        </View>
      ) : (
        visibleOrders.map((order) => {
          const isNew = order.status === 'new';
          const isPreparing = order.status === 'preparing';
          const isOrderPending = pendingOrderIds.includes(order.id);

          return (
            <View
              key={order.id}
              style={[
                styles.orderTicketCard,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.border,
                },
                isNew && styles.orderTicketNew,
                isPreparing && styles.orderTicketPreparing,
              ]}
            >
              <View style={styles.orderHeaderRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={[
                      styles.orderTableBadge,
                      { color: isNew ? '#0f172a' : theme.text },
                    ]}
                  >
                    {order.table_label} • #{order.order_code}
                  </Text>
                  <Text
                    style={[
                      styles.itemSub,
                      { color: isNew ? '#475569' : theme.subText },
                    ]}
                  >
                    {t('orders.guestLang', {
                      lang: order.visitor_lang.toUpperCase(),
                    })}{' '}
                    •{' '}
                    {order.payment_method === 'vietqr'
                      ? t('orders.methodQr')
                      : t('orders.methodCash')}{' '}
                    •{' '}
                    {order.payment_status === 'paid'
                      ? t('orders.statusPaid')
                      : order.payment_status === 'refunded'
                        ? t('orders.statusRefunded')
                        : t('orders.statusUnpaid')}
                  </Text>
                </View>
                <Text style={styles.orderTotalText}>
                  {formatVnd(order.total_amount)}
                </Text>
              </View>

              <View
                style={[
                  styles.orderItemsBox,
                  {
                    backgroundColor: theme.subCard,
                    borderColor: theme.border,
                  },
                ]}
              >
                {order.items.map((line, idx) => (
                  <View key={idx} style={styles.orderLineRow}>
                    <Text style={styles.orderLineQty}>x{line.quantity}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.itemTitle, { color: theme.text }]}>
                        {line.name_vi}
                      </Text>
                      {line.custom_note ? (
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            marginTop: 2,
                          }}
                        >
                          <Ionicons
                            name="create-outline"
                            size={11}
                            color="#64748b"
                            style={{ marginRight: 3 }}
                          />
                          <Text style={styles.orderNoteText}>
                            {line.custom_note}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.viewCountText}>
                      {formatVnd(
                        (line.unit_price + line.extra_price) * line.quantity
                      )}
                    </Text>
                  </View>
                ))}
              </View>

              {order.customer_note ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginTop: 4,
                  }}
                >
                  <Ionicons
                    name="chatbubble-ellipses-outline"
                    size={12}
                    color="#64748b"
                    style={{ marginRight: 4 }}
                  />
                  <Text style={styles.orderNoteText}>
                    {t('orders.tableNote', { note: order.customer_note })}
                  </Text>
                </View>
              ) : null}

              {order.refund_reason ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginTop: 4,
                  }}
                >
                  <Ionicons
                    name="return-down-back-outline"
                    size={12}
                    color="#b91c1c"
                    style={{ marginRight: 4 }}
                  />
                  <Text style={[styles.orderNoteText, { color: '#b91c1c' }]}>
                    {t('orders.reasonBadgeRefund', {
                      reason: order.refund_reason,
                    })}
                  </Text>
                </View>
              ) : null}

              {order.cancelled_reason ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginTop: 4,
                  }}
                >
                  <Ionicons
                    name="close-circle-outline"
                    size={12}
                    color="#b91c1c"
                    style={{ marginRight: 4 }}
                  />
                  <Text style={[styles.orderNoteText, { color: '#b91c1c' }]}>
                    {t('orders.reasonBadgeCancel', {
                      reason: order.cancelled_reason,
                    })}
                  </Text>
                </View>
              ) : null}

              {/* Order Action Buttons */}
              <View style={styles.orderActionsRow}>
                {isOrderPending && (
                  <View
                    style={{
                      width: '100%',
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingVertical: 4,
                      gap: 6,
                    }}
                  >
                    <ActivityIndicator size="small" color="#10b981" />
                  </View>
                )}

                {isNew && (
                  <>
                    <TouchableOpacity
                      disabled={isOrderPending}
                      style={[
                        styles.btnPrepare,
                        isOrderPending && { opacity: 0.6 },
                      ]}
                      onPress={() => onUpdateOrderStatus(order.id, 'preparing')}
                    >
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Ionicons
                          name="restaurant"
                          size={13}
                          color="#ffffff"
                          style={{ marginRight: 4 }}
                        />
                        <Text style={styles.btnPrepareText}>
                          {t('orders.actionAccept')}
                        </Text>
                      </View>
                    </TouchableOpacity>
                    {canCancelOrder && order.payment_status === 'unpaid' && (
                      <TouchableOpacity
                        disabled={isOrderPending}
                        style={[
                          styles.btnCancel,
                          isOrderPending && { opacity: 0.6 },
                        ]}
                        onPress={() => confirmCancelOrder(order)}
                      >
                        <Text style={styles.btnCancelText}>
                          {t('orders.actionCancel')}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}

                {isPreparing && (
                  <>
                    <TouchableOpacity
                      disabled={isOrderPending}
                      style={[
                        styles.btnComplete,
                        isOrderPending && { opacity: 0.6 },
                      ]}
                      onPress={() =>
                        onUpdateOrderStatus(order.id, 'completed')
                      }
                    >
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Ionicons
                          name="checkmark-circle"
                          size={14}
                          color="#ffffff"
                          style={{ marginRight: 4 }}
                        />
                        <Text style={styles.btnCompleteText}>
                          {t('orders.actionServed')}
                        </Text>
                      </View>
                    </TouchableOpacity>
                    {canCancelOrder && order.payment_status === 'unpaid' && (
                      <TouchableOpacity
                        disabled={isOrderPending}
                        style={[
                          styles.btnCancel,
                          isOrderPending && { opacity: 0.6 },
                        ]}
                        onPress={() => confirmCancelOrder(order)}
                      >
                        <Text style={styles.btnCancelText}>
                          {t('orders.actionCancel')}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}

                {order.payment_status === 'unpaid' &&
                  order.status !== 'cancelled' &&
                  canCollectPayment && (
                    <TouchableOpacity
                      disabled={isOrderPending}
                      style={[
                        styles.btnComplete,
                        isOrderPending && { opacity: 0.6 },
                      ]}
                      onPress={() => confirmMarkPaid(order)}
                    >
                      <Text style={styles.btnCompleteText}>
                        {t('orders.actionConfirmPaid')}
                      </Text>
                    </TouchableOpacity>
                  )}

                {order.payment_status === 'paid' && canRefundOrder && (
                  <TouchableOpacity
                    disabled={isOrderPending}
                    style={[
                      styles.btnCancel,
                      isOrderPending && { opacity: 0.6 },
                    ]}
                    onPress={() => confirmRefundOrder(order)}
                  >
                    <Text style={styles.btnCancelText}>
                      {t('orders.actionRefund')}
                    </Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  disabled={isOrderPending}
                  style={[
                    styles.btnCancel,
                    {
                      backgroundColor:
                        order.status === 'completed' ? '#0f172a' : '#f1f5f9',
                      borderColor:
                        order.status === 'completed' ? '#0f172a' : '#cbd5e1',
                      flexGrow: 1,
                      flexBasis: 120,
                      paddingHorizontal: 12,
                    },
                    isOrderPending && { opacity: 0.6 },
                  ]}
                  onPress={() => onPrintOrder(order)}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                    }}
                  >
                    <Ionicons
                      name="print-outline"
                      size={13}
                      color={
                        order.status === 'completed' ? '#ffffff' : '#0f172a'
                      }
                    />
                    <Text
                      style={[
                        styles.btnCancelText,
                        {
                          color:
                            order.status === 'completed'
                              ? '#ffffff'
                              : '#0f172a',
                        },
                      ]}
                    >
                      {order.payment_status === 'paid'
                        ? t('orders.actionViewReceipt')
                        : t('orders.actionViewTicket')}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}

      <Modal
        visible={Boolean(reasonPrompt)}
        transparent
        animationType="fade"
        onRequestClose={closeReasonPrompt}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(15, 23, 42, 0.55)',
            justifyContent: 'center',
            paddingHorizontal: 18,
          }}
        >
          <View
            style={{
              backgroundColor: theme.card,
              borderRadius: 18,
              padding: 18,
              borderWidth: 1,
              borderColor: theme.border,
              gap: 10,
            }}
          >
            <Text
              style={{
                fontSize: 16,
                fontWeight: '900',
                color: theme.text,
              }}
            >
              {reasonPrompt?.action === 'refund'
                ? t('orders.confirmRefundTitle')
                : t('orders.confirmCancelTitle')}
            </Text>

            <Text
              style={{
                fontSize: 13,
                color: theme.subText,
                lineHeight: 19,
              }}
            >
              {reasonPrompt?.action === 'refund'
                ? t('orders.confirmRefundDesc', {
                    code: reasonPrompt.order.order_code,
                    total: formatVnd(reasonPrompt.order.total_amount),
                  })
                : t('orders.confirmCancelDesc', {
                    code: reasonPrompt?.order.order_code ?? '',
                    table: reasonPrompt?.order.table_label ?? '',
                  })}
            </Text>

            <Text
              style={[
                styles.fieldLabel,
                { color: theme.subText, marginTop: 4, marginBottom: 2 },
              ]}
            >
              {reasonPrompt?.action === 'refund'
                ? t('orders.refundReasonLabel')
                : t('orders.cancelReasonLabel')}
            </Text>

            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: theme.subCard,
                  borderColor: reasonError ? '#ef4444' : theme.border,
                  color: theme.text,
                  minHeight: 72,
                  textAlignVertical: 'top',
                },
              ]}
              placeholder={
                reasonPrompt?.action === 'refund'
                  ? t('orders.refundReasonPlaceholder')
                  : t('orders.cancelReasonPlaceholder')
              }
              placeholderTextColor={theme.subText}
              value={reasonDraft}
              onChangeText={(text) => {
                setReasonDraft(text);
                if (reasonError) setReasonError('');
              }}
              maxLength={MAX_ORDER_REASON_LENGTH}
              multiline
              autoFocus
            />

            {reasonError ? (
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '700',
                  color: '#ef4444',
                }}
              >
                {reasonError}
              </Text>
            ) : null}

            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'flex-end',
                gap: 10,
                marginTop: 6,
              }}
            >
              <TouchableOpacity
                style={[
                  styles.btnCancel,
                  {
                    backgroundColor: '#f1f5f9',
                    borderColor: '#cbd5e1',
                    borderWidth: 1,
                    flex: 1,
                  },
                ]}
                onPress={closeReasonPrompt}
              >
                <Text style={[styles.btnCancelText, { color: '#334155' }]}>
                  {t('common.cancel')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.btnCancel,
                  {
                    backgroundColor: '#dc2626',
                    flex: 1,
                  },
                  !normalizeOrderReason(reasonDraft) && { opacity: 0.6 },
                ]}
                onPress={submitReasonPrompt}
              >
                <Text style={[styles.btnCancelText, { color: '#ffffff' }]}>
                  {reasonPrompt?.action === 'refund'
                    ? t('orders.actionRefund')
                    : t('orders.actionCancel')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
});
