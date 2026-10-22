import React, { memo, useMemo } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  formatVnd,
  MobileAnalyticsEvent,
  MobileCatalogItem,
  MobileShopOrderStats,
} from '../../lib/supabase';
import { buildMobileOverviewMetrics } from '../../lib/overview-metrics';
import { MobileThemePalette, styles } from '../../styles/mobileStyles';
import { useMobileI18n } from '../MobileI18nProvider';

interface OverviewTabProps {
  stats?: MobileShopOrderStats | null;
  items: MobileCatalogItem[];
  events: MobileAnalyticsEvent[];
  primaryColor: string;
  theme: MobileThemePalette;
}

export const OverviewTab = memo(function OverviewTab({
  stats,
  items,
  events,
  primaryColor,
  theme,
}: OverviewTabProps) {
  const { t } = useMobileI18n();
  const metrics = useMemo(
    () => buildMobileOverviewMetrics({ stats, items, events }),
    [stats, items, events]
  );

  return (
    <View style={styles.sectionStack}>
      <View style={styles.revenueHeroCard}>
        <Text style={styles.revenueLabel}>{t('overview.heroLabel')}</Text>
        <Text style={styles.revenueValue}>
          {formatVnd(metrics.todayRevenue)}
        </Text>
        <Text style={styles.revenueSub}>
          {t('overview.heroSub', {
            totalRevenue: formatVnd(metrics.totalRevenue),
            paidCount: metrics.validOrdersCount,
            availableCount: items.filter((i) => i.is_available).length,
            totalItems: items.length,
          })}
        </Text>
      </View>

      {/* 7-Day Revenue Bar Chart */}
      <View
        style={[
          styles.card,
          { backgroundColor: theme.card, borderColor: theme.border },
        ]}
      >
        <Text style={[styles.cardHeading, { color: theme.text }]}>
          {t('overview.chartHeading')}
        </Text>
        <View style={styles.chartBarsContainer}>
          {metrics.sevenDayBars.map((bar) => {
            const heightPct = Math.max(
              12,
              Math.round((bar.revenue / metrics.maxDayRev) * 100)
            );
            return (
              <View key={bar.dateKey} style={styles.chartBarColumn}>
                <Text
                  style={{
                    fontSize: 9,
                    fontWeight: '700',
                    color: theme.subText,
                    marginBottom: 4,
                  }}
                >
                  {bar.revenue > 0
                    ? `${Math.round(bar.revenue / 1000)}k`
                    : '0'}
                </Text>
                <View style={styles.chartBarTrack}>
                  <View
                    style={{
                      width: '100%',
                      height: `${heightPct}%`,
                      backgroundColor: primaryColor,
                      borderRadius: 6,
                    }}
                  />
                </View>
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: '700',
                    color: theme.text,
                    marginTop: 4,
                  }}
                >
                  {bar.label}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.kpiGrid}>
        <View
          style={[
            styles.kpiCard,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.kpiNumber, { color: theme.text }]}>
            {metrics.newOrdersCount + metrics.preparingOrdersCount}
          </Text>
          <Text style={[styles.kpiTitle, { color: theme.text }]}>
            {t('overview.kpiActiveTitle')}
          </Text>
          <Text style={styles.kpiHint}>
            {t('overview.kpiActiveHint', {
              newCount: metrics.newOrdersCount,
              preparingCount: metrics.preparingOrdersCount,
            })}
          </Text>
        </View>

        <View
          style={[
            styles.kpiCard,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.kpiNumber, { color: theme.text }]}>
            {metrics.lowStockCount}
          </Text>
          <Text style={[styles.kpiTitle, { color: theme.text }]}>
            {t('overview.kpiLowStockTitle')}
          </Text>
          <Text style={styles.kpiHint}>
            {t('overview.kpiLowStockHint', {
              outCount: metrics.outOfStockCount,
            })}
          </Text>
        </View>

        <View
          style={[
            styles.kpiCard,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.kpiNumber, { color: theme.text }]}>
            {metrics.scanDoorCount + metrics.scanTableCount}
          </Text>
          <Text style={[styles.kpiTitle, { color: theme.text }]}>
            {t('overview.kpiQrScansTitle')}
          </Text>
          <Text style={styles.kpiHint}>
            {t('overview.kpiQrScansHint', {
              doorCount: metrics.scanDoorCount,
              tableCount: metrics.scanTableCount,
            })}
          </Text>
        </View>

        <View
          style={[
            styles.kpiCard,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.kpiNumber, { color: theme.text }]}>8</Text>
          <Text style={[styles.kpiTitle, { color: theme.text }]}>
            {t('overview.kpiLangsTitle')}
          </Text>
          <Text style={styles.kpiHint}>
            VN • EN • KO • JA • ZH • ES • IT • RU
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: theme.card, borderColor: theme.border },
        ]}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <Ionicons
            name="flame"
            size={16}
            color="#f97316"
            style={{ marginRight: 6 }}
          />
          <Text
            style={[
              styles.cardHeading,
              { marginBottom: 0, color: theme.text },
            ]}
          >
            {t('overview.topItemsHeading')}
          </Text>
        </View>
        {metrics.topItems.map((item, idx) => (
          <View
            key={item.id}
            style={[styles.topItemRow, { borderBottomColor: theme.border }]}
          >
            <Text style={styles.rankBadge}>#{idx + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemTitle, { color: theme.text }]}>
                {item.name_i18n?.vi}
              </Text>
              <Text style={[styles.itemSub, { color: theme.subText }]}>
                {t('overview.itemPriceSold', {
                  price: formatVnd(item.price),
                  sold: item.sold_count || 0,
                })}
              </Text>
            </View>
            <Text style={styles.viewCountText}>
              {t('overview.itemStock', {
                stock:
                  item.stock_quantity === null ||
                  item.stock_quantity === undefined
                    ? '∞'
                    : item.stock_quantity,
              })}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
});
