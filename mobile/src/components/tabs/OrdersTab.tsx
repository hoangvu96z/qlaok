import React, { memo } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  formatVnd,
  MobileOrderPaymentStatus,
  MobileShopOrder,
} from '../../lib/supabase';
import { MobileThemePalette, styles } from '../../styles/mobileStyles';

export type OrderFilterType = 'active' | 'new' | 'preparing' | 'completed';

interface OrdersTabProps {
  orders: MobileShopOrder[];
  orderFilter: OrderFilterType;
  onChangeOrderFilter: (filter: OrderFilterType) => void;
  onUpdateOrderStatus: (
    orderId: string,
    status: 'new' | 'preparing' | 'completed' | 'cancelled',
    payment_status?: MobileOrderPaymentStatus
  ) => void;
  onPrintOrder: (order: MobileShopOrder) => void;
  canCollectPayment?: boolean;
  canRefundOrder?: boolean;
  theme: MobileThemePalette;
}

export const OrdersTab = memo(function OrdersTab({
  orders,
  orderFilter,
  onChangeOrderFilter,
  onUpdateOrderStatus,
  onPrintOrder,
  canCollectPayment = true,
  canRefundOrder = false,
  theme,
}: OrdersTabProps) {
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
            label: `Đang xử lý (${activeOrdersCount})`,
          },
          { id: 'new', label: `Mới chờ nhận (${newOrdersCount})` },
          {
            id: 'preparing',
            label: `Đang làm (${preparingOrdersCount})`,
          },
          { id: 'completed', label: 'Đã hoàn tất' },
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

      {visibleOrders.length === 0 ? (
        <View
          style={[
            styles.card,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.cardHeading, { color: theme.text }]}>
            Chưa có đơn hàng nào trong mục này
          </Text>
          <Text style={[styles.itemSub, { color: theme.subText }]}>
            Khi khách quét mã QR tại bàn và bấm gửi đơn, điện thoại sẽ nhận tín
            hiệu qua WebSocket Realtime, rung và hiện phiếu gọi món ngay tại
            đây.
          </Text>
        </View>
      ) : (
        visibleOrders.map((order) => {
          const isNew = order.status === 'new';
          const isPreparing = order.status === 'preparing';

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
                <View>
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
                    Ngôn ngữ khách: {order.visitor_lang.toUpperCase()} •{' '}
                    {order.payment_method === 'vietqr'
                      ? 'Chuyển khoản QR'
                      : 'Tiền mặt'}{' '}
                    •{' '}
                    {order.payment_status === 'paid'
                      ? '✓ Đã thu tiền'
                      : order.payment_status === 'refunded'
                        ? '↩ Đã hoàn tiền'
                        : 'Chưa thu tiền'}
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
                    Ghi chú bàn: {order.customer_note}
                  </Text>
                </View>
              ) : null}

              {/* Order Action Buttons */}
              <View style={styles.orderActionsRow}>
                {isNew && (
                  <>
                    <TouchableOpacity
                      style={styles.btnPrepare}
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
                          Nhận đơn &amp; Báo bếp
                        </Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.btnCancel}
                      onPress={() => onUpdateOrderStatus(order.id, 'cancelled')}
                    >
                      <Text style={styles.btnCancelText}>Hủy</Text>
                    </TouchableOpacity>
                  </>
                )}

                {isPreparing && (
                  <>
                    <TouchableOpacity
                      style={styles.btnComplete}
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
                          Đã phục vụ
                        </Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.btnCancel}
                      onPress={() => onUpdateOrderStatus(order.id, 'cancelled')}
                    >
                      <Text style={styles.btnCancelText}>Hủy</Text>
                    </TouchableOpacity>
                  </>
                )}

                {order.payment_status === 'unpaid' &&
                  order.status !== 'cancelled' &&
                  canCollectPayment && (
                    <TouchableOpacity
                      style={styles.btnComplete}
                      onPress={() =>
                        onUpdateOrderStatus(order.id, order.status, 'paid')
                      }
                    >
                      <Text style={styles.btnCompleteText}>
                        Xác nhận đã thu tiền
                      </Text>
                    </TouchableOpacity>
                  )}

                {order.payment_status === 'paid' && canRefundOrder && (
                  <TouchableOpacity
                    style={styles.btnCancel}
                    onPress={() =>
                      onUpdateOrderStatus(order.id, order.status, 'refunded')
                    }
                  >
                    <Text style={styles.btnCancelText}>Hoàn tiền</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[
                    styles.btnCancel,
                    {
                      backgroundColor:
                        order.status === 'completed' ? '#0f172a' : '#f1f5f9',
                      borderColor:
                        order.status === 'completed' ? '#0f172a' : '#cbd5e1',
                      flex: order.status === 'completed' ? 1 : 0,
                      paddingHorizontal: 12,
                    },
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
                        ? 'Xem hóa đơn'
                        : 'Xem phiếu in'}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
});
