import React, { memo, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatVnd, MobileShop, MobileShopOrder } from '../lib/supabase';

interface ReceiptModalProps {
  order: MobileShopOrder | null;
  shop: MobileShop | null;
  onClose: () => void;
}

export const ReceiptModal = memo(function ReceiptModal({
  order,
  shop,
  onClose,
}: ReceiptModalProps) {
  const [receiptPaperSize, setReceiptPaperSize] = useState<'80mm' | '58mm'>(
    '80mm'
  );

  if (!order || !shop) return null;

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(2, 6, 23, 0.78)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16,
        zIndex: 999,
      }}
    >
      <View
        style={{
          width: '100%',
          maxWidth: 380,
          maxHeight: '90%',
          backgroundColor: '#0f172a',
          borderRadius: 24,
          padding: 16,
          borderWidth: 1,
          borderColor: '#334155',
        }}
      >
        {/* Modal Header */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="print" size={18} color="#10b981" />
            <Text
              style={{ color: '#ffffff', fontSize: 14, fontWeight: '900' }}
            >
              In Hóa Đơn Thanh Toán ({receiptPaperSize})
            </Text>
          </View>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close-circle" size={24} color="#94a3b8" />
          </TouchableOpacity>
        </View>

        {/* Paper Size Switcher */}
        <View
          style={{
            flexDirection: 'row',
            gap: 8,
            marginBottom: 12,
          }}
        >
          {(['80mm', '58mm'] as const).map((sz) => {
            const active = receiptPaperSize === sz;
            return (
              <TouchableOpacity
                key={sz}
                onPress={() => setReceiptPaperSize(sz)}
                style={{
                  flex: 1,
                  paddingVertical: 7,
                  borderRadius: 10,
                  backgroundColor: active ? '#10b981' : '#1e293b',
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: '800',
                    color: active ? '#020617' : '#cbd5e1',
                  }}
                >
                  Khổ {sz === '80mm' ? 'K80 (80mm)' : 'K58 (58mm)'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Crisp White Thermal Paper Ticket */}
        <ScrollView
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 14,
            padding: 16,
            maxHeight: 380,
          }}
        >
          <View
            style={{
              borderBottomWidth: 1,
              borderStyle: 'dashed',
              borderBottomColor: '#0f172a',
              paddingBottom: 10,
              marginBottom: 10,
              alignItems: 'center',
            }}
          >
            <Text
              style={{
                fontSize: 15,
                fontWeight: '900',
                color: '#000000',
                textTransform: 'uppercase',
                textAlign: 'center',
              }}
            >
              {shop.name}
            </Text>
            <Text
              style={{
                fontSize: 11,
                color: '#334155',
                textAlign: 'center',
                marginTop: 2,
              }}
            >
              {shop.address || shop.city}
            </Text>
            {shop.phone_contact ? (
              <Text style={{ fontSize: 11, color: '#334155' }}>
                ĐT: {shop.phone_contact}
              </Text>
            ) : null}
            <Text
              style={{
                fontSize: 13,
                fontWeight: '900',
                color: '#000000',
                marginTop: 8,
              }}
            >
              {order.payment_status === 'paid'
                ? 'HÓA ĐƠN THANH TOÁN'
                : 'PHIẾU TẠM TÍNH'}
            </Text>
            <Text style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
              Mã: #{order.order_code} • {order.table_label}
            </Text>
          </View>

          {/* Items List */}
          <View style={{ gap: 6, marginBottom: 10 }}>
            {order.items.map((line, idx) => (
              <View
                key={idx}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                }}
              >
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '800',
                      color: '#000000',
                    }}
                  >
                    {line.quantity}x {line.name_vi}
                  </Text>
                  {line.custom_note ? (
                    <Text style={{ fontSize: 10, color: '#475569' }}>
                      * {line.custom_note}
                    </Text>
                  ) : null}
                </View>
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '800',
                    color: '#000000',
                  }}
                >
                  {formatVnd(
                    (line.unit_price + line.extra_price) * line.quantity
                  )}
                </Text>
              </View>
            ))}
          </View>

          {/* Total Footer */}
          <View
            style={{
              borderTopWidth: 1,
              borderStyle: 'dashed',
              borderTopColor: '#0f172a',
              paddingTop: 8,
              marginBottom: 12,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '900',
                  color: '#000000',
                }}
              >
                TỔNG CỘNG:
              </Text>
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: '900',
                  color: '#000000',
                }}
              >
                {formatVnd(order.total_amount)}
              </Text>
            </View>
            <Text
              style={{
                fontSize: 10,
                fontWeight: '700',
                color: '#334155',
                marginTop: 4,
              }}
            >
              Trạng thái:{' '}
              {order.payment_status === 'paid'
                ? '✓ ĐÃ THANH TOÁN'
                : 'CHƯA THANH TOÁN'}{' '}
              ({order.payment_method === 'vietqr' ? 'VietQR' : 'Tiền mặt'})
            </Text>
            {shop.wifi_info?.ssid ? (
              <Text
                style={{
                  fontSize: 10,
                  color: '#475569',
                  marginTop: 6,
                  textAlign: 'center',
                }}
              >
                Wi-Fi: {shop.wifi_info.ssid} (Pass:{' '}
                {shop.wifi_info.password || 'Miễn phí'})
              </Text>
            ) : null}
            <Text
              style={{
                fontSize: 10,
                fontWeight: '800',
                color: '#0f172a',
                textAlign: 'center',
                marginTop: 6,
              }}
            >
              Cảm ơn Quý khách &amp; Hẹn gặp lại!
            </Text>
          </View>
        </ScrollView>

        {/* Print Action Buttons */}
        <View
          style={{
            flexDirection: 'row',
            gap: 8,
            marginTop: 12,
          }}
        >
          <TouchableOpacity
            onPress={onClose}
            style={{
              flex: 1,
              paddingVertical: 11,
              borderRadius: 14,
              backgroundColor: '#1e293b',
              alignItems: 'center',
            }}
          >
            <Text
              style={{ color: '#cbd5e1', fontSize: 12, fontWeight: '800' }}
            >
              Đóng
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              Alert.alert(
                '🖨️ Đã gửi lệnh in hóa đơn',
                `Đang in phiếu #${order.order_code} (${order.table_label}) ra máy in nhiệt khổ ${receiptPaperSize}.`
              );
              onClose();
            }}
            style={{
              flex: 2,
              flexDirection: 'row',
              gap: 6,
              paddingVertical: 11,
              borderRadius: 14,
              backgroundColor: '#10b981',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="print" size={16} color="#020617" />
            <Text
              style={{ color: '#020617', fontSize: 12, fontWeight: '900' }}
            >
              In Hóa Đơn Ngay ({receiptPaperSize})
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
});
