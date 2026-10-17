import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchApi,
  formatVnd,
  MobileAnalyticsEvent,
  MobileCatalogItem,
  MobileCategory,
  MobileFlashSaleConfig,
  MobilePopupConfig,
  MobilePromoBannerConfig,
  MobileShop,
  MobileShopOrder,
  MobileShopThemeConfig,
  supabase,
} from './src/lib/supabase';
import { MobileThemePalette, styles } from './src/styles/mobileStyles';
import { useShopRealtimeOrders } from './src/hooks/useShopRealtimeOrders';
import { useTabNavigation } from './src/hooks/useTabNavigation';
import { AuthScreen } from './src/components/AuthScreen';
import { ReceiptModal } from './src/components/ReceiptModal';
import { OrderFilterType, OrdersTab } from './src/components/tabs/OrdersTab';
import { OverviewTab } from './src/components/tabs/OverviewTab';
import { CatalogTab } from './src/components/tabs/CatalogTab';
import { PromotionsTab } from './src/components/tabs/PromotionsTab';
import { SettingsTab } from './src/components/tabs/SettingsTab';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    let authEventReceived = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      authEventReceived = true;
      if (alive) { setSession(next); setReady(true); }
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (alive && !authEventReceived) { setSession(error ? null : data.session); setReady(true); }
    }).catch(() => { if (alive && !authEventReceived) setReady(true); });
    const refresh = (state: string) => {
      if (state === 'active') supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    };
    refresh(AppState.currentState);
    const appState = AppState.addEventListener('change', refresh);
    return () => { alive = false; subscription.unsubscribe(); appState.remove(); supabase.auth.stopAutoRefresh(); };
  }, []);
  if (!ready) return <SafeAreaView><ActivityIndicator /></SafeAreaView>;
  if (!session) return <AuthScreen />;
  return <Workspace key={session.user.id} userId={session.user.id} />;
}

function Workspace({ userId }: { userId: string }) {
  const isLoggedIn = true;
  const loadGeneration = useRef(0);
  const scopeRef = useRef('');
  const pendingOrders = useRef(new Set<string>());
  useEffect(() => () => { loadGeneration.current++; scopeRef.current = ''; }, []);
  const [isDarkMode, setIsDarkMode] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [shops, setShops] = useState<MobileShop[]>([]);
  const [activeShopId, setActiveShopId] = useState<string>('');
  const [categories, setCategories] = useState<MobileCategory[]>([]);
  const [items, setItems] = useState<MobileCatalogItem[]>([]);
  const [events, setEvents] = useState<MobileAnalyticsEvent[]>([]);

  const [orderFilter, setOrderFilter] = useState<OrderFilterType>('active');
  const [printingOrder, setPrintingOrder] = useState<MobileShopOrder | null>(
    null
  );

  // Storefront Theme & Basic Settings state
  const [editShopName, setEditShopName] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editWifiSsid, setEditWifiSsid] = useState('');
  const [editWifiPass, setEditWifiPass] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#10b981');
  const [layoutMode, setLayoutMode] = useState<'list' | 'grid'>('list');
  const [backgroundStyle, setBackgroundStyle] = useState<
    'clean' | 'warm' | 'dark' | 'custom_image'
  >('clean');
  const [previewLang, setPreviewLang] = useState<string>('vi');

  // Promotions & Flash Sale Studio state
  const [promoBanner, setPromoBanner] = useState<MobilePromoBannerConfig>({
    enabled: true,
    badgeText: '🔥 ƯU ĐÃI ĐẶC BIỆT',
    title: 'Giảm ngay 15% cho đơn từ 100.000đ',
    subtitle: 'Áp dụng toàn thực đơn khi đặt món qua QR',
    bgGradient: 'amber_rose',
    discountType: 'percent',
    discountValue: 15,
    minOrderAmount: 100000,
    applyScope: 'all',
    selectedItemIds: [],
    voucherCode: 'QLAOK15',
  });
  const [welcomePopup, setWelcomePopup] = useState<MobilePopupConfig>({
    enabled: false,
    badgeText: '🎁 VOUCHER CHÀO MỪNG',
    title: 'Giảm ngay 15% cho đơn từ 100.000đ',
    content: 'Áp dụng trực tiếp khi chọn món trên Menu QR',
    voucherCode: 'QLAOK15',
  });
  const todayIso = new Date().toISOString().slice(0, 10);
  const [flashSale, setFlashSale] = useState<MobileFlashSaleConfig>({
    enabled: false,
    badgeText: '⚡ FLASH SALE GIỜ VÀNG',
    title: 'Giờ Vàng Giá Sốc - Số Lượng Có Hạn',
    discountType: 'percent',
    discountValue: 25,
    startDate: todayIso,
    endDate: todayIso,
    startTime: '11:00',
    endTime: '22:00',
    itemIds: [],
  });

  const activeShop = useMemo(
    () => shops.find((s) => s.id === activeShopId) || shops[0] || null,
    [shops, activeShopId]
  );

  // Tab navigation with Android hardware back-stack & scroll preservation
  const handleCloseModal = useCallback(() => setPrintingOrder(null), []);
  const { activeTab, navigateTab, mountedTabs } = useTabNavigation({
    hasOpenModal: Boolean(printingOrder),
    onCloseModal: handleCloseModal,
  });

  // Supabase Realtime WebSocket Orders Hook (replaces 3.5s HTTP polling)
  const {
    orders,
    setOrders,
    liveOrderAlert,
    setLiveOrderAlert,
    realtimeStatus,
    fetchOrdersFromApi,
  } = useShopRealtimeOrders({
    isLoggedIn,
    shopId: activeShop?.id,
    onItemsSynced: setItems,
  });

  const hydrateThemeAndPromoState = useCallback(
    (shop: MobileShop, loadedItems: MobileCatalogItem[]) => {
      const tc = shop.theme_config;
      setPrimaryColor(tc?.primaryColor || '#10b981');
      setLayoutMode(
        tc?.layout || (shop.vertical === 'retail' ? 'grid' : 'list')
      );
      setBackgroundStyle(tc?.backgroundStyle || 'clean');

      setPromoBanner({ enabled: false, title: '', discountValue: 0, selectedItemIds: [] });
      setWelcomePopup({ enabled: false, title: '', content: '' });
      setFlashSale({ enabled: false, title: '', discountType: 'percent', discountValue: 0, itemIds: [] });
      if (tc?.promoBanner) {
        setPromoBanner({
          enabled: Boolean(tc.promoBanner.enabled),
          badgeText: tc.promoBanner.badgeText || '🔥 ƯU ĐÃI ĐẶC BIỆT',
          title:
            tc.promoBanner.title || 'Giảm ngay 15% cho đơn từ 100.000đ',
          subtitle:
            tc.promoBanner.subtitle ||
            'Áp dụng toàn thực đơn khi đặt món qua QR',
          bgGradient: tc.promoBanner.bgGradient || 'amber_rose',
          discountType: tc.promoBanner.discountType || 'percent',
          discountValue:
            typeof tc.promoBanner.discountValue === 'number'
              ? tc.promoBanner.discountValue
              : 15,
          minOrderAmount:
            typeof tc.promoBanner.minOrderAmount === 'number'
              ? tc.promoBanner.minOrderAmount
              : 0,
          applyScope: tc.promoBanner.applyScope || 'all',
          selectedItemIds: tc.promoBanner.selectedItemIds || [],
          voucherCode: tc.promoBanner.voucherCode || '',
        });
      }

      if (tc?.welcomePopup) {
        setWelcomePopup({
          enabled: Boolean(tc.welcomePopup.enabled),
          badgeText: tc.welcomePopup.badgeText || '🎁 VOUCHER CHÀO MỪNG',
          title: tc.welcomePopup.title || '',
          content: tc.welcomePopup.content || '',
          voucherCode: tc.welcomePopup.voucherCode || '',
        });
      }

      const defaultToday = new Date().toISOString().slice(0, 10);
      if (tc?.flashSale) {
        setFlashSale({
          enabled: Boolean(tc.flashSale.enabled),
          badgeText: tc.flashSale.badgeText || '⚡ FLASH SALE GIỜ VÀNG',
          title:
            tc.flashSale.title || 'Giờ Vàng Giá Sốc - Số Lượng Có Hạn',
          discountType: tc.flashSale.discountType || 'percent',
          discountValue:
            typeof tc.flashSale.discountValue === 'number'
              ? tc.flashSale.discountValue
              : 25,
          startDate: tc.flashSale.startDate || defaultToday,
          endDate:
            tc.flashSale.endDate || tc.flashSale.startDate || defaultToday,
          startTime: tc.flashSale.startTime || '11:00',
          endTime: tc.flashSale.endTime || '22:00',
          itemIds:
            tc.flashSale.itemIds?.length > 0
              ? tc.flashSale.itemIds
              : loadedItems.slice(0, 3).map((i) => i.id),
        });
      } else if (loadedItems.length > 0) {
        setFlashSale((prev) => ({
          ...prev,
          itemIds: loadedItems.slice(0, 3).map((i) => i.id),
        }));
      }
    },
    []
  );

  const loadShopsAndData = useCallback(
    async (targetShopId?: string) => {
      const generation = ++loadGeneration.current;
      const requestedShopId = targetShopId || scopeRef.current;
      scopeRef.current = requestedShopId;
      if (targetShopId) setActiveShopId(targetShopId);
      setLoading(true);
      setPrintingOrder(null);
      setOrderFilter('active');
      setCategories([]); setItems([]); setEvents([]); setOrders([]);
      try {
        const { data: shopsData, error: shopsErr } = await supabase
          .from('shops')
          .select('*')
          .eq('owner_id', userId)
          .order('created_at', { ascending: true });

        if (generation !== loadGeneration.current) return;
        if (shopsErr) throw shopsErr;
        const loadedShops = (shopsData || []) as MobileShop[];
        setShops(loadedShops);

        const currentShop =
          loadedShops.find((s) => s.id === requestedShopId) ||
          loadedShops[0];

        if (currentShop) {
          scopeRef.current = currentShop.id;
          setActiveShopId(currentShop.id);
          setEditShopName(currentShop.name);
          setEditCity(currentShop.city || 'Đà Nẵng');
          setEditPhone(currentShop.phone_contact || '');
          setEditWifiSsid(currentShop.wifi_info?.ssid || '');
          setEditWifiPass(currentShop.wifi_info?.password || '');

          const [catsRes, itemsRes, eventsRes] = await Promise.all([
            supabase
              .from('categories')
              .select('*')
              .eq('shop_id', currentShop.id)
              .order('sort_order', { ascending: true }),
            supabase
              .from('items')
              .select('*')
              .eq('shop_id', currentShop.id)
              .order('sort_order', { ascending: true }),
            supabase
              .from('analytics_events')
              .select('*')
              .eq('shop_id', currentShop.id)
              .order('created_at', { ascending: false }),
          ]);

          if (generation !== loadGeneration.current) return;
          for (const result of [catsRes, itemsRes, eventsRes]) if (result.error) throw result.error;
          const normalizedItems = (itemsRes.data || []).map((i) => ({
            ...i,
            price: Number(i.price),
          })) as MobileCatalogItem[];

          setCategories((catsRes.data || []) as MobileCategory[]);
          setItems(normalizedItems);
          setEvents((eventsRes.data || []) as MobileAnalyticsEvent[]);
          hydrateThemeAndPromoState(currentShop, normalizedItems);

          await fetchOrdersFromApi(currentShop.id, true);
        }
      } catch (err) {
        if (generation !== loadGeneration.current) return;
        Alert.alert(
          'Lỗi kết nối mạng',
          err instanceof Error ? err.message : 'Không thể tải dữ liệu cửa hàng'
        );
      } finally {
        if (generation !== loadGeneration.current) return;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [userId, setOrders, fetchOrdersFromApi, hydrateThemeAndPromoState]
  );

  useEffect(() => {
    if (isLoggedIn) {
      loadShopsAndData();
    }
  }, [isLoggedIn, loadShopsAndData]);

  const handleUpdateOrderStatus = useCallback(
    async (
      orderId: string,
      status: 'new' | 'preparing' | 'completed' | 'cancelled',
      payment_status?: 'unpaid' | 'paid'
    ) => {
      if (!activeShop) return;
      const shopId = activeShop.id;
      const generation = loadGeneration.current;
      if (scopeRef.current !== shopId || pendingOrders.current.has(orderId)) return;
      pendingOrders.current.add(orderId);
      try {
        const response = await fetchApi('/api/orders', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shop_id: shopId, orderId, status, payment_status }),
        });
        const { order } = await response.json();
        if (!order || order.id !== orderId || order.shop_id !== shopId) {
          throw new Error('Máy chủ trả về đơn hàng không hợp lệ');
        }
        if (scopeRef.current !== shopId || generation !== loadGeneration.current) return;
        setOrders((prev) => prev.map((o) => o.id === orderId ? order : o));
        if (payment_status === 'paid' && order.payment_status === 'paid') setPrintingOrder(order);
      } catch (error) {
        if (scopeRef.current === shopId && generation === loadGeneration.current) Alert.alert('Không thể cập nhật đơn', error instanceof Error ? error.message : 'Vui lòng thử lại');
      } finally {
        pendingOrders.current.delete(orderId);
      }
    },
    [activeShop, setOrders]
  );

  const handleSaveShopAndTheme = useCallback(async () => {
    if (!activeShop) return;
    const saveGeneration = loadGeneration.current;
    const nextThemeConfig: MobileShopThemeConfig = {
      ...activeShop.theme_config,
      primaryColor,
      layout: layoutMode,
      backgroundStyle,
      promoBanner,
      welcomePopup: {
        ...welcomePopup,
        voucherCode: promoBanner.voucherCode || welcomePopup.voucherCode,
      },
      flashSale,
    };

    try {
      await fetchApi('/api/shops', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: activeShop.id,
          name: editShopName.trim(),
          city: editCity.trim(),
          phone_contact: editPhone.trim(),
          wifi_info: {
            ssid: editWifiSsid.trim(),
            password: editWifiPass.trim(),
          },
          theme_config: nextThemeConfig,
        }),
      });
    } catch (error) {
      Alert.alert('Lỗi lưu cài đặt', error instanceof Error ? error.message : 'Không thể lưu cài đặt');
      return;
    }

    if (saveGeneration !== loadGeneration.current) return;
    Alert.alert(
      'Đã lưu thành công',
      'Giao diện, khuyến mãi, Flash Sale và cài đặt quán đã được áp dụng ngay!'
    );
    loadShopsAndData(activeShop.id);
  }, [
    activeShop,
    primaryColor,
    layoutMode,
    backgroundStyle,
    promoBanner,
    welcomePopup,
    flashSale,
    editShopName,
    editCity,
    editPhone,
    editWifiSsid,
    editWifiPass,
    loadShopsAndData,
  ]);

  const theme: MobileThemePalette = useMemo(
    () => ({
      bg: isDarkMode ? '#020617' : '#f8fafc',
      card: isDarkMode ? '#0f172a' : '#ffffff',
      subCard: isDarkMode ? '#1e293b' : '#f8fafc',
      border: isDarkMode ? '#1e293b' : '#e2e8f0',
      text: isDarkMode ? '#f8fafc' : '#0f172a',
      subText: isDarkMode ? '#94a3b8' : '#64748b',
    }),
    [isDarkMode]
  );

  const newOrdersCount = useMemo(
    () => orders.filter((o) => o.status === 'new').length,
    [orders]
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadShopsAndData(activeShop?.id);
  }, [loadShopsAndData, activeShop?.id]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />

      {/* Top Header & Store Switcher + Realtime WS Indicator + Light/Dark Toggle */}
      <View
        style={[
          styles.header,
          { backgroundColor: theme.card, borderBottomColor: theme.border },
        ]}
      >
        <View style={styles.headerTopRow}>
          <View style={styles.brandRow}>
            <View
              style={[styles.smallLogo, { backgroundColor: primaryColor }]}
            >
              <Text style={styles.smallLogoText}>Q</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.headerTitle, { color: theme.text }]}
                numberOfLines={1}
              >
                {activeShop?.name || 'Qlaok mPOS'}
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginTop: 2,
                }}
              >
                <Ionicons
                  name="location"
                  size={12}
                  color="#10b981"
                  style={{ marginRight: 3 }}
                />
                <Text
                  style={[styles.headerSub, { color: theme.subText }]}
                  numberOfLines={1}
                >
                  {activeShop?.city || 'Đà Nẵng'} • 8 Ngôn Ngữ • mPOS
                </Text>
              </View>
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {/* Supabase Realtime WebSocket Status Indicator */}
            <View
              style={[
                styles.realtimeBadge,
                {
                  backgroundColor:
                    realtimeStatus === 'connected'
                      ? 'rgba(16, 185, 129, 0.12)'
                      : 'rgba(245, 158, 11, 0.12)',
                  borderColor:
                    realtimeStatus === 'connected' ? '#10b981' : '#f59e0b',
                },
              ]}
            >
              <View
                style={[
                  styles.realtimeDot,
                  {
                    backgroundColor:
                      realtimeStatus === 'connected' ? '#10b981' : '#f59e0b',
                  },
                ]}
              />
              <Text
                style={[
                  styles.realtimeBadgeText,
                  {
                    color:
                      realtimeStatus === 'connected' ? '#059669' : '#d97706',
                  },
                ]}
              >
                {realtimeStatus === 'connected' ? 'Realtime' : 'Sync'}
              </Text>
            </View>

            {/* Light / Dark Mode Button */}
            <TouchableOpacity
              style={[
                styles.themeToggleBtn,
                { backgroundColor: theme.subCard, borderColor: theme.border },
              ]}
              onPress={() => setIsDarkMode((prev) => !prev)}
            >
              <Ionicons
                name={isDarkMode ? 'sunny' : 'moon'}
                size={15}
                color={isDarkMode ? '#fbbf24' : '#475569'}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.logoutBtn, { backgroundColor: theme.subCard }]}
              onPress={async () => {
                const { error } = await supabase.auth.signOut({ scope: 'local' });
                if (error) Alert.alert('Không thể đăng xuất', error.message);
              }}
            >
              <Text style={[styles.logoutBtnText, { color: theme.subText }]}>
                Thoát
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Horizontal Shop Selector Pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.shopPillsRow}
        >
          {shops.map((shop) => {
            const active = shop.id === activeShop?.id;
            return (
              <TouchableOpacity
                key={shop.id}
                onPress={() => loadShopsAndData(shop.id)}
                style={[
                  styles.shopPill,
                  { backgroundColor: theme.subCard },
                  active && { backgroundColor: primaryColor },
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons
                    name={
                      shop.vertical === 'fnb'
                        ? 'restaurant'
                        : shop.vertical === 'service'
                          ? 'sparkles'
                          : 'bag-handle'
                    }
                    size={13}
                    color={active ? '#ffffff' : theme.subText}
                    style={{ marginRight: 5 }}
                  />
                  <Text
                    style={[
                      styles.shopPillText,
                      { color: theme.subText },
                      active && styles.shopPillTextActive,
                    ]}
                  >
                    {shop.name}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* REALTIME NEW ORDER PUSH NOTIFICATION BANNER ON MOBILE */}
      {liveOrderAlert && (
        <TouchableOpacity
          style={styles.liveAlertBanner}
          onPress={() => {
            navigateTab('orders');
            setOrderFilter('active');
            setLiveOrderAlert(null);
          }}
        >
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons
                name="notifications"
                size={13}
                color="#ffffff"
                style={{ marginRight: 4 }}
              />
              <Text style={styles.liveAlertBadge}>
                KHÁCH VỪA GỬI ĐƠN MỚI TẠI BÀN!
              </Text>
            </View>
            <Text style={styles.liveAlertTitle}>
              {liveOrderAlert.tableLabel} • #{liveOrderAlert.orderCode} (
              {formatVnd(liveOrderAlert.totalAmount)})
            </Text>
          </View>
          <View style={styles.liveAlertCta}>
            <Text style={styles.liveAlertCtaText}>Xem đơn</Text>
          </View>
        </TouchableOpacity>
      )}

      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#10b981" />
          <Text style={[styles.loadingText, { color: theme.subText }]}>
            Đang tải dữ liệu cửa hàng &amp; kết nối Realtime mPOS...
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {/* Independent ScrollViews per tab so scroll position is preserved across tab switches */}
          {mountedTabs.orders && (
            <ScrollView
              style={[
                styles.content,
                { display: activeTab === 'orders' ? 'flex' : 'none' },
              ]}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                />
              }
            >
              <OrdersTab
                orders={orders}
                orderFilter={orderFilter}
                onChangeOrderFilter={setOrderFilter}
                onUpdateOrderStatus={handleUpdateOrderStatus}
                onPrintOrder={setPrintingOrder}
                theme={theme}
              />
            </ScrollView>
          )}

          {mountedTabs.overview && (
            <ScrollView
              style={[
                styles.content,
                { display: activeTab === 'overview' ? 'flex' : 'none' },
              ]}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                />
              }
            >
              <OverviewTab
                orders={orders}
                items={items}
                events={events}
                primaryColor={primaryColor}
                theme={theme}
              />
            </ScrollView>
          )}

          {mountedTabs.catalog && (
            <ScrollView
              style={[
                styles.content,
                { display: activeTab === 'catalog' ? 'flex' : 'none' },
              ]}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                />
              }
            >
              <CatalogTab key={activeShop?.id}
                activeShop={activeShop}
                categories={categories}
                items={items}
                setItems={setItems}
                onReloadShopData={loadShopsAndData}
                theme={theme}
              />
            </ScrollView>
          )}

          {mountedTabs.promotions && (
            <ScrollView
              style={[
                styles.content,
                { display: activeTab === 'promotions' ? 'flex' : 'none' },
              ]}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                />
              }
            >
              <PromotionsTab
                shopName={editShopName || activeShop?.name || ''}
                primaryColor={primaryColor}
                layoutMode={layoutMode}
                backgroundStyle={backgroundStyle}
                previewLang={previewLang}
                onChangePreviewLang={setPreviewLang}
                promoBanner={promoBanner}
                setPromoBanner={setPromoBanner}
                welcomePopup={welcomePopup}
                setWelcomePopup={setWelcomePopup}
                flashSale={flashSale}
                setFlashSale={setFlashSale}
                items={items}
                onSaveShopAndTheme={handleSaveShopAndTheme}
                theme={theme}
              />
            </ScrollView>
          )}

          {mountedTabs.settings && (
            <ScrollView
              style={[
                styles.content,
                { display: activeTab === 'settings' ? 'flex' : 'none' },
              ]}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                />
              }
            >
              <SettingsTab
                editShopName={editShopName}
                setEditShopName={setEditShopName}
                editCity={editCity}
                setEditCity={setEditCity}
                editPhone={editPhone}
                setEditPhone={setEditPhone}
                editWifiSsid={editWifiSsid}
                setEditWifiSsid={setEditWifiSsid}
                editWifiPass={editWifiPass}
                setEditWifiPass={setEditWifiPass}
                primaryColor={primaryColor}
                setPrimaryColor={setPrimaryColor}
                layoutMode={layoutMode}
                setLayoutMode={setLayoutMode}
                backgroundStyle={backgroundStyle}
                setBackgroundStyle={setBackgroundStyle}
                previewLang={previewLang}
                onChangePreviewLang={setPreviewLang}
                promoBanner={promoBanner}
                flashSale={flashSale}
                items={items}
                onSaveShopAndTheme={handleSaveShopAndTheme}
                theme={theme}
              />
            </ScrollView>
          )}
        </View>
      )}

      {/* Bottom Tab Navigation (5 Tabs including Khuyến mãi & Flash Sale) */}
      <View
        style={[
          styles.bottomNav,
          { backgroundColor: theme.card, borderTopColor: theme.border },
        ]}
      >
        <TouchableOpacity
          style={styles.navTab}
          onPress={() => navigateTab('orders')}
        >
          <Ionicons
            name={activeTab === 'orders' ? 'receipt' : 'receipt-outline'}
            size={20}
            color={activeTab === 'orders' ? '#10b981' : theme.subText}
          />
          <Text
            style={[
              styles.navTabText,
              { color: theme.subText },
              activeTab === 'orders' && styles.navTabTextActive,
            ]}
          >
            Đơn ({newOrdersCount})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navTab}
          onPress={() => navigateTab('overview')}
        >
          <Ionicons
            name={activeTab === 'overview' ? 'bar-chart' : 'bar-chart-outline'}
            size={20}
            color={activeTab === 'overview' ? '#10b981' : theme.subText}
          />
          <Text
            style={[
              styles.navTabText,
              { color: theme.subText },
              activeTab === 'overview' && styles.navTabTextActive,
            ]}
          >
            Doanh thu
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navTab}
          onPress={() => navigateTab('catalog')}
        >
          <Ionicons
            name={activeTab === 'catalog' ? 'restaurant' : 'restaurant-outline'}
            size={20}
            color={activeTab === 'catalog' ? '#10b981' : theme.subText}
          />
          <Text
            style={[
              styles.navTabText,
              { color: theme.subText },
              activeTab === 'catalog' && styles.navTabTextActive,
            ]}
          >
            Kho ({items.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navTab}
          onPress={() => navigateTab('promotions')}
        >
          <Ionicons
            name={activeTab === 'promotions' ? 'flash' : 'flash-outline'}
            size={20}
            color={activeTab === 'promotions' ? '#f59e0b' : theme.subText}
          />
          <Text
            style={[
              styles.navTabText,
              { color: theme.subText },
              activeTab === 'promotions' && {
                color: '#f59e0b',
                fontWeight: '900',
              },
            ]}
          >
            Khuyến mãi
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navTab}
          onPress={() => navigateTab('settings')}
        >
          <Ionicons
            name={
              activeTab === 'settings'
                ? 'color-palette'
                : 'color-palette-outline'
            }
            size={20}
            color={activeTab === 'settings' ? '#10b981' : theme.subText}
          />
          <Text
            style={[
              styles.navTabText,
              { color: theme.subText },
              activeTab === 'settings' && styles.navTabTextActive,
            ]}
          >
            Giao diện
          </Text>
        </TouchableOpacity>
      </View>

      {/* Thermal Receipt Preview & Print Modal (K80 / K58) */}
      <ReceiptModal
        order={printingOrder}
        shop={activeShop}
        onClose={handleCloseModal}
      />
    </SafeAreaView>
  );
}
