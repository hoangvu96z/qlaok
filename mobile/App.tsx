import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Switch,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Vibration,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import {
  supabase,
  API_BASE_URL,
  MobileShop,
  MobileCategory,
  MobileCatalogItem,
  MobileAnalyticsEvent,
  MobileShopOrder,
  formatVnd,
} from './src/lib/supabase';

type TabType = 'orders' | 'overview' | 'catalog' | 'settings';

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(true);
  const [email, setEmail] = useState('chuquan@qlaok.vn');
  const [password, setPassword] = useState('qlaok123456');
  const [authLoading, setAuthLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<TabType>('orders');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [shops, setShops] = useState<MobileShop[]>([]);
  const [activeShopId, setActiveShopId] = useState<string>('');
  const [categories, setCategories] = useState<MobileCategory[]>([]);
  const [items, setItems] = useState<MobileCatalogItem[]>([]);
  const [events, setEvents] = useState<MobileAnalyticsEvent[]>([]);
  const [orders, setOrders] = useState<MobileShopOrder[]>([]);
  const [orderFilter, setOrderFilter] = useState<
    'active' | 'new' | 'preparing' | 'completed'
  >('active');

  // Realtime Mobile Notification Banner state
  const [liveOrderAlert, setLiveOrderAlert] = useState<{
    orderCode: string;
    tableLabel: string;
    totalAmount: number;
  } | null>(null);
  const knownNewOrderIdsRef = useRef<Set<string>>(new Set());
  const isFirstOrderPollRef = useRef(true);

  // Quick Add Item state
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemStock, setNewItemStock] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');

  // Settings form state
  const [editShopName, setEditShopName] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editWifiSsid, setEditWifiSsid] = useState('');
  const [editWifiPass, setEditWifiPass] = useState('');

  const activeShop =
    shops.find((s) => s.id === activeShopId) || shops[0] || null;

  const fetchOrdersFromApi = useCallback(
    async (shopId: string, silent = false) => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/orders?shopId=${encodeURIComponent(shopId)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        const loadedOrders: MobileShopOrder[] = data.orders || [];
        const newList = loadedOrders.filter((o) => o.status === 'new');

        if (!isFirstOrderPollRef.current) {
          const brandNew = newList.find(
            (o) => !knownNewOrderIdsRef.current.has(o.id)
          );
          if (brandNew) {
            try {
              Vibration.vibrate([0, 300, 150, 300]);
            } catch {
              // ignore vibration error on web/simulator
            }
            setLiveOrderAlert({
              orderCode: brandNew.order_code,
              tableLabel: brandNew.table_label,
              totalAmount: brandNew.total_amount,
            });
          }
        }

        knownNewOrderIdsRef.current = new Set(newList.map((o) => o.id));
        isFirstOrderPollRef.current = false;
        setOrders(loadedOrders);

        if (Array.isArray(data.items) && data.items.length > 0) {
          setItems(data.items);
        }
      } catch {
        if (!silent) {
          // Fallback if local Next.js API server is not reachable
        }
      }
    },
    []
  );

  const loadShopsAndData = useCallback(
    async (targetShopId?: string) => {
      try {
        const { data: shopsData, error: shopsErr } = await supabase
          .from('shops')
          .select('*')
          .order('created_at', { ascending: true });

        if (shopsErr) throw shopsErr;
        const loadedShops = (shopsData || []) as MobileShop[];
        setShops(loadedShops);

        const currentShop =
          loadedShops.find((s) => s.id === (targetShopId || activeShopId)) ||
          loadedShops[0];

        if (currentShop) {
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

          setCategories((catsRes.data || []) as MobileCategory[]);
          setItems(
            (itemsRes.data || []).map((i) => ({
              ...i,
              price: Number(i.price),
            })) as MobileCatalogItem[]
          );
          setEvents((eventsRes.data || []) as MobileAnalyticsEvent[]);

          await fetchOrdersFromApi(currentShop.id, true);
        }
      } catch (err) {
        Alert.alert(
          'Lỗi kết nối Supabase',
          err instanceof Error ? err.message : 'Không thể tải dữ liệu cửa hàng'
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [activeShopId, fetchOrdersFromApi]
  );

  useEffect(() => {
    if (isLoggedIn) {
      isFirstOrderPollRef.current = true;
      loadShopsAndData();
    }
  }, [isLoggedIn, loadShopsAndData]);

  // Poll new table orders every 3.5 seconds when logged in
  useEffect(() => {
    if (!isLoggedIn || !activeShop?.id) return;
    const interval = setInterval(() => {
      fetchOrdersFromApi(activeShop.id, true);
    }, 3500);
    return () => clearInterval(interval);
  }, [isLoggedIn, activeShop?.id, fetchOrdersFromApi]);

  const handleLogin = async (demo = false) => {
    if (demo) {
      setIsLoggedIn(true);
      return;
    }
    setAuthLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error && email.trim().toLowerCase() !== 'chuquan@qlaok.vn') {
        throw error;
      }
      setIsLoggedIn(true);
    } catch (err) {
      Alert.alert(
        'Đăng nhập thất bại',
        err instanceof Error
          ? err.message
          : 'Vui lòng kiểm tra lại email/mật khẩu'
      );
    } finally {
      setAuthLoading(false);
    }
  };

  const handleUpdateOrderStatus = async (
    orderId: string,
    status: 'new' | 'preparing' | 'completed' | 'cancelled',
    payment_status?: 'unpaid' | 'paid'
  ) => {
    if (!activeShop) return;
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? {
              ...o,
              status,
              payment_status: payment_status || o.payment_status,
            }
          : o
      )
    );

    try {
      await fetch(`${API_BASE_URL}/api/orders`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: activeShop.id,
          orderId,
          status,
          payment_status,
        }),
      });
      await fetchOrdersFromApi(activeShop.id, true);
    } catch {
      Alert.alert('Lỗi mạng', 'Không thể cập nhật trạng thái đơn hàng');
    }
  };

  const handleToggleItemAvailability = async (item: MobileCatalogItem) => {
    const nextVal = !item.is_available;
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, is_available: nextVal } : i))
    );

    const { error } = await supabase
      .from('items')
      .update({ is_available: nextVal, updated_at: new Date().toISOString() })
      .eq('id', item.id);

    if (error) {
      Alert.alert('Lỗi cập nhật', error.message);
      loadShopsAndData(activeShop?.id);
    }
  };

  const handleUpdateItemPrice = async (
    item: MobileCatalogItem,
    delta: number
  ) => {
    const nextPrice = Math.max(0, Number(item.price) + delta);
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, price: nextPrice } : i))
    );

    await supabase
      .from('items')
      .update({ price: nextPrice, updated_at: new Date().toISOString() })
      .eq('id', item.id);
  };

  const handleUpdateItemStock = async (
    item: MobileCatalogItem,
    nextStock: number | null
  ) => {
    const nextAvail =
      nextStock === 0 ? false : nextStock && nextStock > 0 ? true : item.is_available;

    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id
          ? { ...i, stock_quantity: nextStock, is_available: nextAvail }
          : i
      )
    );

    try {
      await fetch(`${API_BASE_URL}/api/catalog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...item,
            stock_quantity: nextStock,
            is_available: nextAvail,
          },
        }),
      });
    } catch {
      await supabase
        .from('items')
        .update({ is_available: nextAvail, updated_at: new Date().toISOString() })
        .eq('id', item.id);
    }
  };

  const handleQuickAddItem = async () => {
    if (!activeShop || !newItemName.trim()) return;
    const targetCatId =
      selectedCategoryId !== 'all' ? selectedCategoryId : categories[0]?.id;

    if (!targetCatId) {
      Alert.alert('Chưa có danh mục', 'Vui lòng tạo danh mục trước.');
      return;
    }

    const priceNum = Number(newItemPrice.replace(/[^0-9]/g, '')) || 35000;
    const stockNum =
      newItemStock.trim() === ''
        ? null
        : Math.max(0, Number(newItemStock.replace(/[^0-9]/g, '')));

    try {
      const res = await fetch(`${API_BASE_URL}/api/catalog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            shop_id: activeShop.id,
            category_id: targetCatId,
            price: priceNum,
            stock_quantity: stockNum,
            is_available: stockNum !== 0,
            is_featured: false,
            name_i18n: {
              vi: newItemName.trim(),
              en: newItemName.trim(),
            },
            desc_i18n: { vi: '' },
          },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.item) {
          setItems((prev) => [...prev, data.item]);
        }
        setNewItemName('');
        setNewItemPrice('');
        setNewItemStock('');
        return;
      }
    } catch {
      // fallback direct to supabase
    }

    const payload = {
      id: `item-${Date.now()}`,
      shop_id: activeShop.id,
      category_id: targetCatId,
      sort_order: items.length + 1,
      price: priceNum,
      is_available: true,
      is_featured: false,
      name_i18n: {
        vi: newItemName.trim(),
        en: newItemName.trim(),
      },
      desc_i18n: { vi: '' },
      view_count: 0,
    };

    const { data, error } = await supabase
      .from('items')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      Alert.alert('Không thể thêm món', error.message);
      return;
    }

    setItems((prev) => [...prev, { ...data, price: Number(data.price) }]);
    setNewItemName('');
    setNewItemPrice('');
    setNewItemStock('');
  };

  const handleSaveShopSettings = async () => {
    if (!activeShop) return;
    const { error } = await supabase
      .from('shops')
      .update({
        name: editShopName.trim(),
        city: editCity.trim(),
        phone_contact: editPhone.trim(),
        wifi_info: {
          ssid: editWifiSsid.trim(),
          password: editWifiPass.trim(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', activeShop.id);

    if (error) {
      Alert.alert('Lỗi lưu cài đặt', error.message);
      return;
    }

    Alert.alert('Thành công', 'Đã đồng bộ cài đặt cửa hàng lên Supabase!');
    loadShopsAndData(activeShop.id);
  };

  // ================= LOGIN SCREEN =================
  if (!isLoggedIn) {
    return (
      <SafeAreaView style={styles.authContainer}>
        <StatusBar style="light" />
        <View style={styles.authCard}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoText}>Q</Text>
          </View>
          <Text style={styles.authTitle}>Qlaok mPOS Mobile</Text>
          <Text style={styles.authSubtitle}>
            Ứng dụng Chủ quán &amp; Thu ngân nhận đơn QR tại bàn, quản lý tồn
            kho &amp; doanh thu trực tiếp
          </Text>

          <TouchableOpacity
            style={styles.demoButton}
            onPress={() => handleLogin(true)}
          >
            <Ionicons name="flash" size={16} color="#020617" style={{ marginRight: 6 }} />
            <Text style={styles.demoButtonText}>
              Vào Nhanh Quầy Thu Ngân mPOS Demo (1 Chạm)
            </Text>
          </TouchableOpacity>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email Chủ quán</Text>
            <TextInput
              style={styles.authInput}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Mật khẩu</Text>
            <TextInput
              style={styles.authInput}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>

          <TouchableOpacity
            style={styles.primaryAuthBtn}
            onPress={() => handleLogin(false)}
            disabled={authLoading}
          >
            <Text style={styles.primaryAuthBtnText}>
              {authLoading ? 'Đang kết nối Supabase...' : 'Đăng nhập Supabase'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Compute Analytics, Orders & Inventory metrics
  const newOrdersCount = orders.filter((o) => o.status === 'new').length;
  const preparingOrdersCount = orders.filter(
    (o) => o.status === 'preparing'
  ).length;
  const validOrders = orders.filter((o) => o.status !== 'cancelled');
  const todayPrefix = new Date().toISOString().slice(0, 10);
  const todayRevenue = validOrders
    .filter((o) => o.created_at.startsWith(todayPrefix))
    .reduce((sum, o) => sum + o.total_amount, 0);
  const totalRevenue = validOrders.reduce((sum, o) => sum + o.total_amount, 0);

  const lowStockCount = items.filter(
    (i) =>
      typeof i.stock_quantity === 'number' &&
      i.stock_quantity > 0 &&
      i.stock_quantity <= 5
  ).length;
  const outOfStockCount = items.filter(
    (i) => !i.is_available || i.stock_quantity === 0
  ).length;

  const scanDoorCount = events.filter((e) => e.event_type === 'scan_door').length;
  const scanTableCount = events.filter((e) => e.event_type === 'scan_table').length;

  const visibleItems =
    selectedCategoryId === 'all'
      ? items
      : items.filter((i) => i.category_id === selectedCategoryId);

  const visibleOrders = orders.filter((o) => {
    if (orderFilter === 'active')
      return o.status === 'new' || o.status === 'preparing';
    return o.status === orderFilter;
  });

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      {/* Top Header & Store Switcher */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <View style={styles.brandRow}>
            <View style={styles.smallLogo}>
              <Text style={styles.smallLogoText}>Q</Text>
            </View>
            <View>
              <Text style={styles.headerTitle}>
                {activeShop?.name || 'Qlaok mPOS'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                <Ionicons name="location" size={12} color="#10b981" style={{ marginRight: 3 }} />
                <Text style={styles.headerSub}>
                  {activeShop?.city || 'Đà Nẵng'} • Realtime mPOS
                </Text>
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={styles.logoutBtn}
            onPress={() => setIsLoggedIn(false)}
          >
            <Text style={styles.logoutBtnText}>Thoát</Text>
          </TouchableOpacity>
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
                style={[styles.shopPill, active && styles.shopPillActive]}
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
                    color={active ? '#ffffff' : '#64748b'}
                    style={{ marginRight: 5 }}
                  />
                  <Text
                    style={[
                      styles.shopPillText,
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
            setActiveTab('orders');
            setOrderFilter('active');
            setLiveOrderAlert(null);
          }}
        >
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="notifications" size={13} color="#ffffff" style={{ marginRight: 4 }} />
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
          <Text style={styles.loadingText}>Đang đồng bộ mPOS &amp; Supabase...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadShopsAndData(activeShop?.id);
              }}
            />
          }
        >
          {/* ================= TAB 1: COUNTER mPOS ORDERS ================= */}
          {activeTab === 'orders' && (
            <View style={styles.sectionStack}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {[
                  {
                    id: 'active',
                    label: `Đang xử lý (${newOrdersCount + preparingOrdersCount})`,
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
                      onPress={() =>
                        setOrderFilter(
                          f.id as 'active' | 'new' | 'preparing' | 'completed'
                        )
                      }
                      style={[styles.catChip, active && styles.catChipActive]}
                    >
                      <Text
                        style={[
                          styles.catChipText,
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
                <View style={styles.card}>
                  <Text style={styles.cardHeading}>
                    Chưa có đơn hàng nào trong mục này
                  </Text>
                  <Text style={styles.itemSub}>
                    Khi khách quét mã QR tại bàn và bấm gửi đơn, điện thoại sẽ
                    rung và hiện phiếu gọi món ngay tại đây.
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
                        isNew && styles.orderTicketNew,
                        isPreparing && styles.orderTicketPreparing,
                      ]}
                    >
                      <View style={styles.orderHeaderRow}>
                        <View>
                          <Text style={styles.orderTableBadge}>
                            {order.table_label} • #{order.order_code}
                          </Text>
                          <Text style={styles.itemSub}>
                            Ngôn ngữ khách: {order.visitor_lang.toUpperCase()} •{' '}
                            {order.payment_method === 'vietqr'
                              ? 'Chuyển khoản QR'
                              : 'Tiền mặt'}
                          </Text>
                        </View>
                        <Text style={styles.orderTotalText}>
                          {formatVnd(order.total_amount)}
                        </Text>
                      </View>

                      <View style={styles.orderItemsBox}>
                        {order.items.map((line, idx) => (
                          <View key={idx} style={styles.orderLineRow}>
                            <Text style={styles.orderLineQty}>
                              x{line.quantity}
                            </Text>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.itemTitle}>
                                {line.name_vi}
                              </Text>
                              {line.custom_note ? (
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                                  <Ionicons name="create-outline" size={11} color="#64748b" style={{ marginRight: 3 }} />
                                  <Text style={styles.orderNoteText}>
                                    {line.custom_note}
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                            <Text style={styles.viewCountText}>
                              {formatVnd(
                                (line.unit_price + line.extra_price) *
                                  line.quantity
                              )}
                            </Text>
                          </View>
                        ))}
                      </View>

                      {order.customer_note ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                          <Ionicons name="chatbubble-ellipses-outline" size={12} color="#64748b" style={{ marginRight: 4 }} />
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
                              onPress={() =>
                                handleUpdateOrderStatus(order.id, 'preparing')
                              }
                            >
                              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                                <Ionicons name="restaurant" size={13} color="#ffffff" style={{ marginRight: 4 }} />
                                <Text style={styles.btnPrepareText}>
                                  Nhận đơn &amp; Báo bếp
                                </Text>
                              </View>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.btnCancel}
                              onPress={() =>
                                handleUpdateOrderStatus(order.id, 'cancelled')
                              }
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
                                handleUpdateOrderStatus(
                                  order.id,
                                  'completed',
                                  'paid'
                                )
                              }
                            >
                              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                                <Ionicons name="checkmark-circle" size={14} color="#ffffff" style={{ marginRight: 4 }} />
                                <Text style={styles.btnCompleteText}>
                                  Đã phục vụ &amp; Thu tiền
                                </Text>
                              </View>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.btnCancel}
                              onPress={() =>
                                handleUpdateOrderStatus(order.id, 'cancelled')
                              }
                            >
                              <Text style={styles.btnCancelText}>Hủy</Text>
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          )}

          {/* ================= TAB 2: OVERVIEW, REVENUE & INVENTORY ================= */}
          {activeTab === 'overview' && (
            <View style={styles.sectionStack}>
              <View style={styles.revenueHeroCard}>
                <Text style={styles.revenueLabel}>
                  DOANH THU HÔM NAY (TỰ ĐỘNG TỪ QUẦY mPOS &amp; QR BÀN)
                </Text>
                <Text style={styles.revenueValue}>
                  {formatVnd(todayRevenue)}
                </Text>
                <Text style={styles.revenueSub}>
                  Tổng lũy kế: {formatVnd(totalRevenue)} ({validOrders.length}{' '}
                  đơn) • {items.filter((i) => i.is_available).length}/
                  {items.length} món đang mở bán
                </Text>
              </View>

              <View style={styles.kpiGrid}>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiNumber}>
                    {newOrdersCount + preparingOrdersCount}
                  </Text>
                  <Text style={styles.kpiTitle}>Đơn đang phục vụ</Text>
                  <Text style={styles.kpiHint}>
                    Mới: {newOrdersCount} • Đang làm: {preparingOrdersCount}
                  </Text>
                </View>

                <View style={styles.kpiCard}>
                  <Text style={styles.kpiNumber}>{lowStockCount}</Text>
                  <Text style={styles.kpiTitle}>Món sắp hết (&lt;=5)</Text>
                  <Text style={styles.kpiHint}>
                    Đã hết hàng: {outOfStockCount} món
                  </Text>
                </View>

                <View style={styles.kpiCard}>
                  <Text style={styles.kpiNumber}>
                    {scanDoorCount + scanTableCount}
                  </Text>
                  <Text style={styles.kpiTitle}>Tổng lượt quét QR</Text>
                  <Text style={styles.kpiHint}>
                    Cửa: {scanDoorCount} • Bàn: {scanTableCount}
                  </Text>
                </View>

                <View style={styles.kpiCard}>
                  <Text style={styles.kpiNumber}>
                    {activeShop?.supported_langs?.length || 5}
                  </Text>
                  <Text style={styles.kpiTitle}>Ngôn ngữ Menu AI</Text>
                  <Text style={styles.kpiHint}>VI • EN • KO • JA • ZH</Text>
                </View>
              </View>

              <View style={styles.card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                  <Ionicons name="flame" size={16} color="#f97316" style={{ marginRight: 6 }} />
                  <Text style={[styles.cardHeading, { marginBottom: 0 }]}>
                    Top món bán chạy &amp; Số lượng tồn kho
                  </Text>
                </View>
                {[...items]
                  .sort((a, b) => (b.sold_count || 0) - (a.sold_count || 0))
                  .slice(0, 6)
                  .map((item, idx) => (
                    <View key={item.id} style={styles.topItemRow}>
                      <Text style={styles.rankBadge}>#{idx + 1}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemTitle}>
                          {item.name_i18n?.vi}
                        </Text>
                        <Text style={styles.itemSub}>
                          {formatVnd(item.price)} • Đã bán:{' '}
                          {item.sold_count || 0}
                        </Text>
                      </View>
                      <Text style={styles.viewCountText}>
                        Tồn:{' '}
                        {item.stock_quantity === null ||
                        item.stock_quantity === undefined
                          ? '∞'
                          : item.stock_quantity}
                      </Text>
                    </View>
                  ))}
              </View>
            </View>
          )}

          {/* ================= TAB 3: CATALOG & STOCK QUANTITY ================= */}
          {activeTab === 'catalog' && (
            <View style={styles.sectionStack}>
              {/* Quick Add Bar */}
              <View style={styles.card}>
                <Text style={styles.cardHeading}>
                  + Thêm nhanh món &amp; Số lượng tồn
                </Text>
                <View style={styles.quickAddRow}>
                  <TextInput
                    style={[styles.input, { flex: 1.3 }]}
                    placeholder="Tên món (VD: Phở tái)"
                    value={newItemName}
                    onChangeText={setNewItemName}
                  />
                  <TextInput
                    style={[styles.input, { flex: 0.8 }]}
                    placeholder="Giá (35000)"
                    keyboardType="numeric"
                    value={newItemPrice}
                    onChangeText={setNewItemPrice}
                  />
                  <TextInput
                    style={[styles.input, { flex: 0.6 }]}
                    placeholder="Tồn (∞)"
                    keyboardType="numeric"
                    value={newItemStock}
                    onChangeText={setNewItemStock}
                  />
                  <TouchableOpacity
                    style={styles.addBtn}
                    onPress={handleQuickAddItem}
                  >
                    <Text style={styles.addBtnText}>Thêm</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Category Filter */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginBottom: 8 }}
              >
                <TouchableOpacity
                  onPress={() => setSelectedCategoryId('all')}
                  style={[
                    styles.catChip,
                    selectedCategoryId === 'all' && styles.catChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.catChipText,
                      selectedCategoryId === 'all' && styles.catChipTextActive,
                    ]}
                  >
                    Tất cả ({items.length})
                  </Text>
                </TouchableOpacity>
                {categories.map((cat) => {
                  const active = selectedCategoryId === cat.id;
                  return (
                    <TouchableOpacity
                      key={cat.id}
                      onPress={() => setSelectedCategoryId(cat.id)}
                      style={[styles.catChip, active && styles.catChipActive]}
                    >
                      <Text
                        style={[
                          styles.catChipText,
                          active && styles.catChipTextActive,
                        ]}
                      >
                        {cat.name_i18n?.vi}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Item List with 1-Tap Availability Switch, Price & Stock Adjust */}
              {visibleItems.map((item) => {
                const stock =
                  item.stock_quantity === undefined
                    ? null
                    : item.stock_quantity;
                return (
                  <View
                    key={item.id}
                    style={[
                      styles.itemCard,
                      !item.is_available && styles.itemCardSoldOut,
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemTitle}>{item.name_i18n?.vi}</Text>
                      <Text style={styles.itemSub}>
                        EN: {item.name_i18n?.en || '—'} • Đã bán:{' '}
                        {item.sold_count || 0}
                      </Text>

                      {/* Price Row */}
                      <View style={styles.priceRow}>
                        <Text style={styles.priceBadge}>
                          {formatVnd(item.price)}
                        </Text>
                        <TouchableOpacity
                          style={styles.priceStepBtn}
                          onPress={() => handleUpdateItemPrice(item, -5000)}
                        >
                          <Text style={styles.priceStepText}>-5k</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.priceStepBtn}
                          onPress={() => handleUpdateItemPrice(item, 5000)}
                        >
                          <Text style={styles.priceStepText}>+5k</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Stock Quantity Row */}
                      <View style={styles.priceRow}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Ionicons name="cube-outline" size={12} color="#0f766e" style={{ marginRight: 4 }} />
                          <Text style={styles.stockBadgeText}>
                            Tồn kho: {stock === null ? '∞' : stock}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={styles.priceStepBtn}
                          onPress={() =>
                            handleUpdateItemStock(
                              item,
                              Math.max(0, (stock ?? 10) - 1)
                            )
                          }
                        >
                          <Text style={styles.priceStepText}>-1</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.priceStepBtn}
                          onPress={() =>
                            handleUpdateItemStock(item, (stock ?? 0) + 5)
                          }
                        >
                          <Text style={styles.priceStepText}>+5</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.priceStepBtn}
                          onPress={() => handleUpdateItemStock(item, null)}
                        >
                          <Text style={styles.priceStepText}>∞</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    <View style={styles.switchColumn}>
                      <Switch
                        value={item.is_available}
                        onValueChange={() => handleToggleItemAvailability(item)}
                        trackColor={{ false: '#cbd5e1', true: '#10b981' }}
                      />
                      <Text
                        style={[
                          styles.stockStatusText,
                          { color: item.is_available ? '#059669' : '#e11d48' },
                        ]}
                      >
                        {item.is_available ? 'Còn món' : 'Hết hàng'}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* ================= TAB 4: STORE & WI-FI SETTINGS ================= */}
          {activeTab === 'settings' && (
            <View style={styles.sectionStack}>
              <View style={styles.card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                  <Ionicons name="storefront" size={16} color="#10b981" style={{ marginRight: 6 }} />
                  <Text style={[styles.cardHeading, { marginBottom: 0 }]}>
                    Cài đặt Cửa hàng &amp; Wi-Fi (Đồng bộ Supabase)
                  </Text>
                </View>

                <Text style={styles.fieldLabel}>Tên cửa hàng</Text>
                <TextInput
                  style={styles.input}
                  value={editShopName}
                  onChangeText={setEditShopName}
                />

                <Text style={styles.fieldLabel}>
                  Tỉnh / Thành phố (34 tỉnh thành)
                </Text>
                <TextInput
                  style={styles.input}
                  value={editCity}
                  onChangeText={setEditCity}
                />

                <Text style={styles.fieldLabel}>Số điện thoại / Zalo</Text>
                <TextInput
                  style={styles.input}
                  value={editPhone}
                  onChangeText={setEditPhone}
                />

                <Text style={styles.fieldLabel}>Tên Wi-Fi (SSID)</Text>
                <TextInput
                  style={styles.input}
                  value={editWifiSsid}
                  onChangeText={setEditWifiSsid}
                />

                <Text style={styles.fieldLabel}>Mật khẩu Wi-Fi</Text>
                <TextInput
                  style={styles.input}
                  value={editWifiPass}
                  onChangeText={setEditWifiPass}
                />

                <TouchableOpacity
                  style={styles.saveSettingsBtn}
                  onPress={handleSaveShopSettings}
                >
                  <Text style={styles.saveSettingsBtnText}>
                    Lưu Thay Đổi Lên Supabase
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      )}

      {/* Bottom Tab Navigation */}
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={styles.navTab}
          onPress={() => setActiveTab('orders')}
        >
          <Ionicons
            name={activeTab === 'orders' ? 'receipt' : 'receipt-outline'}
            size={22}
            color={activeTab === 'orders' ? '#10b981' : '#64748b'}
          />
          <Text
            style={[
              styles.navTabText,
              activeTab === 'orders' && styles.navTabTextActive,
            ]}
          >
            Đơn mPOS ({newOrdersCount})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navTab}
          onPress={() => setActiveTab('overview')}
        >
          <Ionicons
            name={activeTab === 'overview' ? 'bar-chart' : 'bar-chart-outline'}
            size={22}
            color={activeTab === 'overview' ? '#10b981' : '#64748b'}
          />
          <Text
            style={[
              styles.navTabText,
              activeTab === 'overview' && styles.navTabTextActive,
            ]}
          >
            Doanh thu
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navTab}
          onPress={() => setActiveTab('catalog')}
        >
          <Ionicons
            name={activeTab === 'catalog' ? 'restaurant' : 'restaurant-outline'}
            size={22}
            color={activeTab === 'catalog' ? '#10b981' : '#64748b'}
          />
          <Text
            style={[
              styles.navTabText,
              activeTab === 'catalog' && styles.navTabTextActive,
            ]}
          >
            Kho ({items.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navTab}
          onPress={() => setActiveTab('settings')}
        >
          <Ionicons
            name={activeTab === 'settings' ? 'settings' : 'settings-outline'}
            size={22}
            color={activeTab === 'settings' ? '#10b981' : '#64748b'}
          />
          <Text
            style={[
              styles.navTabText,
              activeTab === 'settings' && styles.navTabTextActive,
            ]}
          >
            Cài đặt
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  authContainer: {
    flex: 1,
    backgroundColor: '#020617',
    justifyContent: 'center',
    padding: 20,
  },
  authCard: {
    backgroundColor: '#0f172a',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  logoBadge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 12,
  },
  logoText: {
    fontSize: 24,
    fontWeight: '900',
    color: '#020617',
  },
  authTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#ffffff',
    textAlign: 'center',
  },
  authSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 18,
  },
  demoButton: {
    backgroundColor: '#10b981',
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  demoButtonText: {
    color: '#020617',
    fontWeight: '900',
    fontSize: 12,
  },
  inputGroup: {
    marginBottom: 12,
  },
  label: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  authInput: {
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: '#ffffff',
    fontSize: 13,
  },
  primaryAuthBtn: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 6,
  },
  primaryAuthBtnText: {
    color: '#020617',
    fontWeight: '900',
    fontSize: 13,
  },
  header: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  smallLogo: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallLogoText: {
    color: '#ffffff',
    fontWeight: '900',
    fontSize: 16,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  headerSub: {
    fontSize: 11,
    color: '#64748b',
  },
  logoutBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  logoutBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  shopPillsRow: {
    flexDirection: 'row',
  },
  shopPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    marginRight: 8,
  },
  shopPillActive: {
    backgroundColor: '#0f172a',
  },
  shopPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  shopPillTextActive: {
    color: '#ffffff',
  },
  liveAlertBanner: {
    backgroundColor: '#0f172a',
    borderBottomWidth: 2,
    borderBottomColor: '#fbbf24',
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  liveAlertBadge: {
    fontSize: 10,
    fontWeight: '900',
    color: '#fbbf24',
  },
  liveAlertTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
    marginTop: 2,
  },
  liveAlertCta: {
    backgroundColor: '#fbbf24',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  liveAlertCtaText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#020617',
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 12,
    color: '#64748b',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  sectionStack: {
    gap: 14,
    paddingBottom: 28,
  },
  orderTicketCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    borderWidth: 2,
    borderColor: '#e2e8f0',
    gap: 10,
  },
  orderTicketNew: {
    borderColor: '#fbbf24',
    backgroundColor: '#fffbeb',
  },
  orderTicketPreparing: {
    borderColor: '#60a5fa',
  },
  orderHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  orderTableBadge: {
    fontSize: 14,
    fontWeight: '900',
    color: '#0f172a',
  },
  orderTotalText: {
    fontSize: 15,
    fontWeight: '900',
    color: '#059669',
  },
  orderItemsBox: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 6,
  },
  orderLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  orderLineQty: {
    fontSize: 12,
    fontWeight: '900',
    color: '#059669',
    width: 26,
  },
  orderNoteText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#b45309',
    marginTop: 2,
  },
  orderActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  btnPrepare: {
    flex: 1,
    backgroundColor: '#2563eb',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnPrepareText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  btnComplete: {
    flex: 1,
    backgroundColor: '#059669',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnCompleteText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  btnCancel: {
    backgroundColor: '#ffe4e6',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnCancelText: {
    color: '#be123c',
    fontSize: 12,
    fontWeight: '800',
  },
  revenueHeroCard: {
    backgroundColor: '#0f172a',
    borderRadius: 20,
    padding: 18,
  },
  revenueLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#34d399',
    letterSpacing: 0.6,
  },
  revenueValue: {
    fontSize: 28,
    fontWeight: '900',
    color: '#ffffff',
    marginVertical: 6,
  },
  revenueSub: {
    fontSize: 11,
    color: '#94a3b8',
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  kpiCard: {
    width: '48%',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  kpiNumber: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0f172a',
  },
  kpiTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginTop: 2,
  },
  kpiHint: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 2,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardHeading: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 12,
  },
  topItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    gap: 10,
  },
  rankBadge: {
    fontSize: 12,
    fontWeight: '900',
    color: '#10b981',
    width: 24,
  },
  viewCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0f172a',
  },
  quickAddRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
    color: '#0f172a',
    marginBottom: 8,
  },
  addBtn: {
    backgroundColor: '#10b981',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 8,
  },
  addBtnText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 12,
  },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
    marginRight: 8,
  },
  catChipActive: {
    backgroundColor: '#10b981',
  },
  catChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  catChipTextActive: {
    color: '#ffffff',
  },
  itemCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  itemCardSoldOut: {
    backgroundColor: '#fff1f2',
    borderColor: '#fecdd3',
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  itemSub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  priceBadge: {
    fontSize: 13,
    fontWeight: '900',
    color: '#059669',
  },
  stockBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
  },
  priceStepBtn: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  priceStepText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  switchColumn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  stockStatusText: {
    fontSize: 10,
    fontWeight: '800',
    marginTop: 4,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 4,
    marginTop: 4,
  },
  saveSettingsBtn: {
    backgroundColor: '#10b981',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  saveSettingsBtnText: {
    color: '#ffffff',
    fontWeight: '900',
    fontSize: 13,
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  navTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  navTabText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    marginTop: 4,
  },
  navTabTextActive: {
    color: '#10b981',
    fontWeight: '900',
  },
});
