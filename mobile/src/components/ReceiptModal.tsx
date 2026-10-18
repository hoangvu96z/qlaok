import React, { memo, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  formatVnd,
  MobileShop,
  MobileShopOrder,
  MobileTicketPrintType,
} from '../lib/supabase';
import { useMobileI18n } from './MobileI18nProvider';

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
  const { t } = useMobileI18n();
  const [receiptPaperSize, setReceiptPaperSize] = useState<'80mm' | '58mm'>(
    '80mm'
  );
  const [ticketType, setTicketType] = useState<MobileTicketPrintType>('provisional');

  useEffect(() => {
    if (!order) return;
    setTicketType(order.payment_status === 'paid' ? 'receipt' : 'provisional');
  }, [order?.id, order?.payment_status]);

  if (!order || !shop) return null;

  const isPaid = order.payment_status === 'paid';
  const rawSubtotal = order.items.reduce(
    (sum, it) =>
      sum + (Number(it.unit_price || 0) + Number(it.extra_price || 0)) * Number(it.quantity || 1),
    0
  );
  const subtotalAmount =
    typeof order.subtotal_amount === 'number' && order.subtotal_amount > 0
      ? order.subtotal_amount
      : rawSubtotal;
  const discountAmount =
    typeof order.discount_amount === 'number' && order.discount_amount > 0
      ? order.discount_amount
      : Math.max(0, subtotalAmount - order.total_amount);

  const currentTypePrintCount =
    ticketType === 'kitchen'
      ? Number(order.kitchen_printed_count || 0)
      : ticketType === 'provisional'
        ? Number(order.provisional_printed_count || 0)
        : Number(order.receipt_printed_count || 0);
  const isReprint = currentTypePrintCount > 0;

  const paymentCfg =
    shop.theme_config?.paymentConfig || shop.theme_config?.paymentQr;
  const acctNo = (
    paymentCfg?.accountNumber ||
    paymentCfg?.accountNo ||
    ''
  ).trim();
  const customQr = (
    paymentCfg?.customQrUrl ||
    paymentCfg?.qrImageUrl ||
    ''
  ).trim();
  const isQrConfigured = Boolean(acctNo || customQr);

  const ticketHeaderLabel =
    ticketType === 'kitchen'
      ? t('receipt.headerKitchen')
      : ticketType === 'provisional'
        ? t('receipt.headerProvisional')
        : isPaid
          ? t('receipt.headerPaidReceipt')
          : t('receipt.headerUnpaidReceipt');

  const handlePreviewPrintAction = () => {
    Alert.alert(
      t('receipt.previewAlertTitle'),
      t('receipt.previewAlertBody', {
        ticket: ticketHeaderLabel,
        code: order.order_code,
        table: order.table_label,
        size: receiptPaperSize,
      })
    );
    onClose();
  };

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
          maxHeight: '92%',
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
            marginBottom: 10,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="print" size={18} color="#10b981" />
            <Text
              style={{ color: '#ffffff', fontSize: 13, fontWeight: '900' }}
            >
              {t('receipt.modalTitle', { size: receiptPaperSize })}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close-circle" size={24} color="#94a3b8" />
          </TouchableOpacity>
        </View>

        {/* 3 Ticket Types Switcher */}
        <View
          style={{
            flexDirection: 'row',
            gap: 6,
            marginBottom: 8,
          }}
        >
          {(
            [
              { id: 'kitchen', label: t('receipt.tabKitchen') },
              { id: 'provisional', label: t('receipt.tabProvisional') },
              { id: 'receipt', label: t('receipt.tabReceipt') },
            ] as const
          ).map((tItem) => {
            const active = ticketType === tItem.id;
            return (
              <TouchableOpacity
                key={tItem.id}
                onPress={() => setTicketType(tItem.id)}
                style={{
                  flex: 1,
                  paddingVertical: 6,
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
                  {tItem.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Paper Size Switcher */}
        <View
          style={{
            flexDirection: 'row',
            gap: 8,
            marginBottom: 10,
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
                  paddingVertical: 6,
                  borderRadius: 10,
                  backgroundColor: active ? '#334155' : '#1e293b',
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: '800',
                    color: active ? '#ffffff' : '#94a3b8',
                  }}
                >
                  {sz === '80mm'
                    ? t('receipt.paperSize80')
                    : t('receipt.paperSize58')}
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
            maxHeight: 360,
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
            {ticketType !== 'kitchen' ? (
              <>
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
                    {t('receipt.phonePrefix', { phone: shop.phone_contact })}
                  </Text>
                ) : null}
              </>
            ) : null}
            <Text
              style={{
                fontSize: 13,
                fontWeight: '900',
                color: '#000000',
                marginTop: 8,
              }}
            >
              {ticketHeaderLabel}
            </Text>
            {isReprint ? (
              <Text
                style={{
                  fontSize: 9,
                  fontWeight: '900',
                  color: '#0f172a',
                  marginTop: 2,
                }}
              >
                {t('receipt.reprintBadge', {
                  count: currentTypePrintCount + 1,
                })}
              </Text>
            ) : null}
            <Text style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
              {t('receipt.orderMeta', {
                code: order.order_code,
                table: order.table_label,
                version: order.bill_version || 1,
              })}
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
                {ticketType !== 'kitchen' ? (
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
                ) : null}
              </View>
            ))}
          </View>

          {/* Total Footer (hidden on kitchen ticket) */}
          {ticketType !== 'kitchen' ? (
            <View
              style={{
                borderTopWidth: 1,
                borderStyle: 'dashed',
                borderTopColor: '#0f172a',
                paddingTop: 8,
                marginBottom: 12,
              }}
            >
              {discountAmount > 0 ? (
                <>
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      marginBottom: 2,
                    }}
                  >
                    <Text style={{ fontSize: 11, color: '#334155' }}>
                      {t('receipt.subtotal')}
                    </Text>
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '700',
                        color: '#000000',
                      }}
                    >
                      {formatVnd(subtotalAmount)}
                    </Text>
                  </View>
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      marginBottom: 4,
                    }}
                  >
                    <Text style={{ fontSize: 11, color: '#334155' }}>
                      {t('receipt.discount')}
                    </Text>
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '800',
                        color: '#000000',
                      }}
                    >
                      -{formatVnd(discountAmount)}
                    </Text>
                  </View>
                </>
              ) : null}
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
                  {isPaid && ticketType === 'receipt'
                    ? t('receipt.totalPaid')
                    : t('receipt.totalDue')}
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
                {t('receipt.statusLine', {
                  status:
                    order.payment_status === 'paid'
                      ? t('receipt.statusPaid')
                      : order.payment_status === 'refunded'
                        ? t('receipt.statusRefunded')
                        : t('receipt.statusUnpaid'),
                  method:
                    order.payment_method === 'vietqr'
                      ? t('receipt.methodQr')
                      : t('receipt.methodCash'),
                })}
              </Text>
              {ticketType === 'provisional' && !isPaid && !isQrConfigured ? (
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: '700',
                    color: '#b45309',
                    marginTop: 6,
                    textAlign: 'center',
                  }}
                >
                  {t('receipt.qrNotConfiguredWarning')}
                </Text>
              ) : null}
              {shop.wifi_info?.ssid ? (
                <Text
                  style={{
                    fontSize: 10,
                    color: '#475569',
                    marginTop: 6,
                    textAlign: 'center',
                  }}
                >
                  {t('receipt.wifiLine', {
                    ssid: shop.wifi_info.ssid,
                    password:
                      shop.wifi_info.password || t('receipt.wifiFree'),
                  })}
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
                {t('receipt.thankYou')}
              </Text>
            </View>
          ) : null}
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
              {t('common.close')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handlePreviewPrintAction}
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
            <Ionicons name="document-text" size={16} color="#020617" />
            <Text
              style={{ color: '#020617', fontSize: 12, fontWeight: '900' }}
            >
              {t('receipt.printInfoBtn', { size: receiptPaperSize })}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
});
