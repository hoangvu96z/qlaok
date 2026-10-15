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
  MobilePromoBannerConfig,
  MobileFlashSaleConfig,
  MobilePopupConfig,
  MobileShopThemeConfig,
  formatVnd,
} from './src/lib/supabase';

type TabType = 'orders' | 'overview' | 'catalog' | 'promotions' | 'settings';

// Pure color swatches — no text labels needed
const BRAND_COLOR_SWATCHES = [
  '#10b981',
  '#f59e0b',
  '#f43f5e',
  '#ef4444',
  '#8b5cf6',
  '#0ea5e9',
  '#ec4899',
  '#92400e',
  '#1e293b',
];

const BANNER_GRADIENT_SWATCHES: Array<{
  id: NonNullable<MobilePromoBannerConfig['bgGradient']>;
  hex: string;
}> = [
  { id: 'amber_rose', hex: '#f97316' },
  { id: 'emerald_teal', hex: '#0d9488' },
  { id: 'violet_fuchsia', hex: '#9333ea' },
  { id: 'royal_gold', hex: '#b45309' },
];

const ALL_8_LANGS = [
  { code: 'vi', short: 'VN', flag: '🇻🇳' },
  { code: 'en', short: 'EN', flag: '🇬🇧' },
  { code: 'ko', short: 'KO', flag: '🇰🇷' },
  { code: 'ja', short: 'JA', flag: '🇯🇵' },
  { code: 'zh', short: 'ZH', flag: '🇨🇳' },
  { code: 'es', short: 'ES', flag: '🇪🇸' },
  { code: 'it', short: 'IT', flag: '🇮🇹' },
  { code: 'ru', short: 'RU', flag: '🇷🇺' },
];

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(false);
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
  const [printingOrder, setPrintingOrder] = useState<MobileShopOrder | null>(
    null
  );
  const [receiptPaperSize, setReceiptPaperSize] = useState<'80mm' | '58mm'>(
    '80mm'
  );

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
  const [promoSubTab, setPromoSubTab] = useState<'discount' | 'flash_sale'>(
    'discount'
  );
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

  const activeShop =
    shops.find((s) => s.id === activeShopId) || shops[0] || null;

  const hydrateThemeAndPromoState = useCallback(
    (shop: MobileShop, loadedItems: MobileCatalogItem[]) => {
      const tc = shop.theme_config;
      setPrimaryColor(tc?.primaryColor || '#10b981');
      setLayoutMode(
        tc?.layout || (shop.vertical === 'retail' ? 'grid' : 'list')
      );
      setBackgroundStyle(tc?.backgroundStyle || 'clean');

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
          // Fallback if local API server is not reachable
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
        Alert.alert(
          'Lỗi kết nối mạng',
          err instanceof Error ? err.message : 'Không thể tải dữ liệu cửa hàng'
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [activeShopId, fetchOrdersFromApi, hydrateThemeAndPromoState]
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
    const existingOrder = orders.find((o) => o.id === orderId);
    const updatedLocal: MobileShopOrder | null = existingOrder
      ? {
          ...existingOrder,
          status,
          payment_status: payment_status || existingOrder.payment_status,
        }
      : null;

    setOrders((prev) =>
      prev.map((o) => (o.id === orderId && updatedLocal ? updatedLocal : o))
    );

    if (payment_status === 'paid' && updatedLocal) {
      setPrintingOrder(updatedLocal);
    }

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
      nextStock === 0
        ? false
        : nextStock && nextStock > 0
          ? true
          : item.is_available;

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
      // fallback direct to database
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

  // Auto-generate friendly banner text when discount rules change
  const syncBannerRule = (next: MobilePromoBannerConfig) => {
    const valStr =
      next.discountType === 'percent'
        ? `${next.discountValue || 0}%`
        : formatVnd(next.discountValue || 0);
    const minStr =
      (next.minOrderAmount || 0) > 0
        ? ` cho đơn từ ${formatVnd(next.minOrderAmount || 0)}`
        : '';
    const scopeStr =
      next.applyScope === 'selected_items'
        ? ` (${(next.selectedItemIds || []).length} món ưu đãi)`
        : ' toàn thực đơn';

    const autoTitle = `Giảm ngay ${valStr}${minStr}`;
    const autoSub = `Áp dụng${scopeStr} khi đặt món qua QR`;

    setPromoBanner({
      ...next,
      title: autoTitle,
      subtitle: autoSub,
    });
    setWelcomePopup((prev) => ({
      ...prev,
      title: autoTitle,
      voucherCode: next.voucherCode || prev.voucherCode,
    }));
  };

  const toggleBannerSelectedItem = (itemId: string) => {
    const curr = promoBanner.selectedItemIds || [];
    const nextIds = curr.includes(itemId)
      ? curr.filter((id) => id !== itemId)
      : [...curr, itemId];
    syncBannerRule({
      ...promoBanner,
      selectedItemIds: nextIds,
    });
  };

  const toggleFlashSaleItem = (itemId: string) => {
    const curr = flashSale.itemIds || [];
    const nextIds = curr.includes(itemId)
      ? curr.filter((id) => id !== itemId)
      : [...curr, itemId];
    setFlashSale((prev) => ({
      ...prev,
      itemIds: nextIds,
    }));
  };

  const handleSaveShopAndTheme = async () => {
    if (!activeShop) return;
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
      await fetch(`${API_BASE_URL}/api/shops`, {
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
    } catch {
      // also persist directly via Supabase client
    }

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
        theme_config: nextThemeConfig,
        updated_at: new Date().toISOString(),
      })
      .eq('id', activeShop.id);

    if (error) {
      Alert.alert('Lỗi lưu cài đặt', error.message);
      return;
    }

    Alert.alert(
      'Đã lưu thành công',
      'Giao diện, khuyến mãi, Flash Sale và cài đặt quán đã được áp dụng ngay!'
    );
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
            Ứng dụng Chủ quán &amp; Thu ngân nhận đơn QR tại bàn, quản lý khuyến
            mãi, Flash Sale &amp; doanh thu trực tiếp
          </Text>

          <TouchableOpacity
            style={styles.demoButton}
            onPress={() => handleLogin(true)}
          >
            <Ionicons
              name="flash"
              size={16}
              color="#020617"
              style={{ marginRight: 6 }}
            />
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
              {authLoading ? 'Đang đăng nhập...' : 'Đăng nhập Quản lý Quán'}
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

  // Build 7-Day Revenue Series for Mobile Chart
  const sevenDayBars = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const dateKey = d.toISOString().slice(0, 10);
    const label = `${d.getDate()}/${d.getMonth() + 1}`;
    const dayRev = validOrders
      .filter((o) => o.created_at.startsWith(dateKey))
      .reduce((s, o) => s + o.total_amount, 0);
    return { dateKey, label, revenue: dayRev };
  });
  const maxDayRev = Math.max(...sevenDayBars.map((b) => b.revenue), 100000);

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

  // Dynamic Light / Dark Mode palette
  const theme = {
    bg: isDarkMode ? '#020617' : '#f8fafc',
    card: isDarkMode ? '#0f172a' : '#ffffff',
    subCard: isDarkMode ? '#1e293b' : '#f8fafc',
    border: isDarkMode ? '#1e293b' : '#e2e8f0',
    text: isDarkMode ? '#f8fafc' : '#0f172a',
    subText: isDarkMode ? '#94a3b8' : '#64748b',
  };

  // Interactive Phone Viewer Component inside Mobile App (for Promotions & Settings tabs)
  const renderLivePhoneViewer = () => {
    const previewSurfaceBg =
      backgroundStyle === 'dark'
        ? '#0f172a'
        : backgroundStyle === 'warm'
          ? '#fdf8ee'
          : '#ffffff';
    const previewTextCol =
      backgroundStyle === 'dark' ? '#f8fafc' : '#0f172a';

    return (
      <View
        style={[
          styles.phoneViewerFrame,
          { backgroundColor: previewSurfaceBg, borderColor: '#0f172a' },
        ]}
      >
        {/* Top Notch + Header */}
        <View style={styles.phoneViewerHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View
              style={[
                styles.phoneViewerLogo,
                { backgroundColor: primaryColor },
              ]}
            >
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '900' }}>
                Q
              </Text>
            </View>
            <Text
              style={{ fontSize: 12, fontWeight: '900', color: '#0f172a' }}
              numberOfLines={1}
            >
              {editShopName || activeShop?.name || 'Tên Quán'}
            </Text>
          </View>
          <Text style={{ fontSize: 10, fontWeight: '800', color: '#10b981' }}>
            📱 Xem trước trực tiếp
          </Text>
        </View>

        {/* 1-Tap 8-Language Flag Strip inside Viewer */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            backgroundColor: '#ffffff',
            borderBottomWidth: 1,
            borderBottomColor: '#e2e8f0',
          }}
        >
          {ALL_8_LANGS.map((l) => {
            const active = previewLang === l.code;
            return (
              <TouchableOpacity
                key={l.code}
                onPress={() => setPreviewLang(l.code)}
                style={[
                  styles.langPreviewPill,
                  active && { backgroundColor: primaryColor },
                ]}
              >
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: '800',
                    color: active ? '#ffffff' : '#334155',
                  }}
                >
                  {l.flag} {l.short}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Phone Body */}
        <View style={{ padding: 10, gap: 8 }}>
          {(() => {
            const MOBILE_PROMO_I18N: Record<
              string,
              {
                promoBadge: string;
                promoTitle: (val: string) => string;
                promoSub: string;
                flashTitle: string;
                timePrefix: string;
              }
            > = {
              vi: {
                promoBadge: promoBanner.badgeText || '🔥 ƯU ĐÃI HÔM NAY',
                promoTitle: () => promoBanner.title,
                promoSub: promoBanner.subtitle,
                flashTitle: flashSale.title || 'Giờ Vàng Giá Sốc',
                timePrefix: 'Khung giờ',
              },
              en: {
                promoBadge: '🔥 TODAY’S SPECIAL',
                promoTitle: (v) => `Get ${v} OFF on your order`,
                promoSub: 'Discount automatically applied at table checkout',
                flashTitle: 'Golden Hour Flash Sale',
                timePrefix: 'Time',
              },
              ko: {
                promoBadge: '🔥 오늘의 프로모션',
                promoTitle: (v) => `주문 시 ${v} 즉시 할인`,
                promoSub: '테이블 주문 시 할인이 자동 적용됩니다',
                flashTitle: '타임세일 한정 특가',
                timePrefix: '시간',
              },
              ja: {
                promoBadge: '🔥 本日のキャンペーン',
                promoTitle: (v) => `ご注文で ${v} 割引`,
                promoSub: 'ご注文時に割引が自動適用されます',
                flashTitle: '時間限定タイムセール',
                timePrefix: '時間',
              },
              zh: {
                promoBadge: '🔥 今日特惠活动',
                promoTitle: (v) => `扫码点餐立减 ${v}`,
                promoSub: '点餐结算时系统自动减免',
                flashTitle: '黄金时段限时秒杀',
                timePrefix: '时段',
              },
              es: {
                promoBadge: '🔥 OFERTA DE HOY',
                promoTitle: (v) => `${v} de descuento en tu pedido`,
                promoSub: 'Descuento aplicado automáticamente en mesa',
                flashTitle: 'Oferta Flash Hora Dorada',
                timePrefix: 'Horario',
              },
              it: {
                promoBadge: '🔥 PROMO DI OGGI',
                promoTitle: (v) => `Sconto di ${v} sul tuo ordine`,
                promoSub: 'Lo sconto viene applicato automaticamente al tavolo',
                flashTitle: 'Offerta Lampo Ora d’Oro',
                timePrefix: 'Orario',
              },
              ru: {
                promoBadge: '🔥 АКЦИЯ ДНЯ',
                promoTitle: (v) => `Скидка ${v} на ваш заказ`,
                promoSub: 'Скидка применяется автоматически при заказе',
                flashTitle: 'Flash-акция Счастливые часы',
                timePrefix: 'Время',
              },
            };

            const locText =
              MOBILE_PROMO_I18N[previewLang] || MOBILE_PROMO_I18N.vi;
            const discValStr =
              promoBanner.discountType === 'percent'
                ? `${promoBanner.discountValue || 15}%`
                : formatVnd(promoBanner.discountValue || 20000);

            return (
              <>
                {/* Promo Banner Preview */}
                {promoBanner.enabled && (
                  <View
                    style={[
                      styles.previewBannerBox,
                      {
                        backgroundColor:
                          BANNER_GRADIENT_SWATCHES.find(
                            (s) => s.id === promoBanner.bgGradient
                          )?.hex || '#f97316',
                      },
                    ]}
                  >
                    <Text
                      style={{
                        fontSize: 9,
                        fontWeight: '900',
                        color: '#fef08a',
                      }}
                    >
                      {locText.promoBadge}
                      {promoBanner.voucherCode
                        ? ` • ${promoBanner.voucherCode}`
                        : ''}
                    </Text>
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: '900',
                        color: '#ffffff',
                        marginTop: 2,
                      }}
                    >
                      {locText.promoTitle(discValStr)}
                    </Text>
                    {locText.promoSub ? (
                      <Text
                        style={{ fontSize: 10, color: '#ffedd5', marginTop: 1 }}
                      >
                        {locText.promoSub}
                      </Text>
                    ) : null}
                  </View>
                )}

                {/* Flash Sale Preview */}
                {flashSale.enabled && (
                  <View style={styles.previewFlashBox}>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: '900',
                          color: '#ffffff',
                          flex: 1,
                        }}
                      >
                        ⚡ {locText.flashTitle} (
                        {flashSale.discountType === 'percent'
                          ? `-${flashSale.discountValue}%`
                          : `-${formatVnd(flashSale.discountValue)}`}
                        )
                      </Text>
                      <Text
                        style={{
                          fontSize: 10,
                          fontWeight: '900',
                          color: '#fde047',
                        }}
                      >
                        ⏱ {locText.timePrefix}: {flashSale.startTime} -{' '}
                        {flashSale.endTime}
                      </Text>
                    </View>
                  </View>
                )}
              </>
            );
          })()}

          {/* Sample Menu Items inside Phone Viewer */}
          <View
            style={
              layoutMode === 'grid'
                ? { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }
                : { gap: 6 }
            }
          >
            {items.slice(0, 2).map((it) => {
              const isFs =
                flashSale.enabled && flashSale.itemIds.includes(it.id);
              const isPromoSelected =
                promoBanner.enabled &&
                promoBanner.applyScope === 'selected_items' &&
                (promoBanner.selectedItemIds || []).includes(it.id);
              let effPrice = it.price;
              if (isFs) {
                effPrice =
                  flashSale.discountType === 'percent'
                    ? Math.round(
                        (it.price * (100 - flashSale.discountValue)) / 100
                      )
                    : Math.max(0, it.price - flashSale.discountValue);
              } else if (isPromoSelected) {
                effPrice =
                  promoBanner.discountType === 'percent'
                    ? Math.round(
                        (it.price *
                          (100 - (promoBanner.discountValue || 0))) /
                          100
                      )
                    : Math.max(
                        0,
                        it.price - (promoBanner.discountValue || 0)
                      );
              }

              return (
                <View
                  key={it.id}
                  style={[
                    styles.previewItemRow,
                    layoutMode === 'grid' && { width: '48%' },
                    {
                      backgroundColor:
                        backgroundStyle === 'dark' ? '#1e293b' : '#ffffff',
                      borderColor:
                        backgroundStyle === 'dark' ? '#334155' : '#e2e8f0',
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: '800',
                        color: previewTextCol,
                      }}
                      numberOfLines={1}
                    >
                      {it.name_i18n?.[previewLang] || it.name_i18n?.vi}
                    </Text>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        marginTop: 2,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: '900',
                          color: primaryColor,
                        }}
                      >
                        {formatVnd(effPrice)}
                      </Text>
                      {effPrice < it.price && (
                        <Text
                          style={{
                            fontSize: 9,
                            color: '#94a3b8',
                            textDecorationLine: 'line-through',
                          }}
                        >
                          {formatVnd(it.price)}
                        </Text>
                      )}
                    </View>
                  </View>
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 7,
                      backgroundColor: primaryColor,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{
                        color: '#ffffff',
                        fontSize: 13,
                        fontWeight: '900',
                      }}
                    >
                      +
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />

      {/* Top Header & Store Switcher + Light/Dark Toggle */}
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
            <View>
              <Text style={[styles.headerTitle, { color: theme.text }]}>
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
                <Text style={[styles.headerSub, { color: theme.subText }]}>
                  {activeShop?.city || 'Đà Nẵng'} • 8 Ngôn Ngữ • mPOS
                </Text>
              </View>
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
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
              onPress={() => setIsLoggedIn(false)}
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
            setActiveTab('orders');
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
            Đang tải dữ liệu cửa hàng &amp; mPOS...
          </Text>
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
                              : 'Tiền mặt'}
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
                            <Text style={styles.orderLineQty}>
                              x{line.quantity}
                            </Text>
                            <View style={{ flex: 1 }}>
                              <Text
                                style={[
                                  styles.itemTitle,
                                  { color: theme.text },
                                ]}
                              >
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
                                (line.unit_price + line.extra_price) *
                                  line.quantity
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
                              onPress={() =>
                                handleUpdateOrderStatus(order.id, 'preparing')
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
                                  Thu tiền &amp; In bill
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

                        <TouchableOpacity
                          style={[
                            styles.btnCancel,
                            {
                              backgroundColor:
                                order.status === 'completed'
                                  ? '#0f172a'
                                  : '#f1f5f9',
                              borderColor:
                                order.status === 'completed'
                                  ? '#0f172a'
                                  : '#cbd5e1',
                              flex: order.status === 'completed' ? 1 : 0,
                              paddingHorizontal: 12,
                            },
                          ]}
                          onPress={() => setPrintingOrder(order)}
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
                                order.status === 'completed'
                                  ? '#ffffff'
                                  : '#0f172a'
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
                                ? 'In hóa đơn'
                                : 'In bill'}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          )}

          {/* ================= TAB 2: OVERVIEW, 7-DAY CHART & INVENTORY ================= */}
          {activeTab === 'overview' && (
            <View style={styles.sectionStack}>
              <View style={styles.revenueHeroCard}>
                <Text style={styles.revenueLabel}>
                  DOANH THU HÔM NAY (QUẦY mPOS &amp; ĐƠN QR BÀN)
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

              {/* 7-Day Revenue Bar Chart */}
              <View
                style={[
                  styles.card,
                  { backgroundColor: theme.card, borderColor: theme.border },
                ]}
              >
                <Text style={[styles.cardHeading, { color: theme.text }]}>
                  📊 Biểu Đồ Doanh Thu 7 Ngày Gần Nhất
                </Text>
                <View style={styles.chartBarsContainer}>
                  {sevenDayBars.map((bar) => {
                    const heightPct = Math.max(
                      12,
                      Math.round((bar.revenue / maxDayRev) * 100)
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
                    {newOrdersCount + preparingOrdersCount}
                  </Text>
                  <Text style={[styles.kpiTitle, { color: theme.text }]}>
                    Đơn đang phục vụ
                  </Text>
                  <Text style={styles.kpiHint}>
                    Mới: {newOrdersCount} • Đang làm: {preparingOrdersCount}
                  </Text>
                </View>

                <View
                  style={[
                    styles.kpiCard,
                    { backgroundColor: theme.card, borderColor: theme.border },
                  ]}
                >
                  <Text style={[styles.kpiNumber, { color: theme.text }]}>
                    {lowStockCount}
                  </Text>
                  <Text style={[styles.kpiTitle, { color: theme.text }]}>
                    Món sắp hết (&lt;=5)
                  </Text>
                  <Text style={styles.kpiHint}>
                    Đã hết hàng: {outOfStockCount} món
                  </Text>
                </View>

                <View
                  style={[
                    styles.kpiCard,
                    { backgroundColor: theme.card, borderColor: theme.border },
                  ]}
                >
                  <Text style={[styles.kpiNumber, { color: theme.text }]}>
                    {scanDoorCount + scanTableCount}
                  </Text>
                  <Text style={[styles.kpiTitle, { color: theme.text }]}>
                    Tổng lượt quét QR
                  </Text>
                  <Text style={styles.kpiHint}>
                    Cửa: {scanDoorCount} • Bàn: {scanTableCount}
                  </Text>
                </View>

                <View
                  style={[
                    styles.kpiCard,
                    { backgroundColor: theme.card, borderColor: theme.border },
                  ]}
                >
                  <Text style={[styles.kpiNumber, { color: theme.text }]}>
                    8
                  </Text>
                  <Text style={[styles.kpiTitle, { color: theme.text }]}>
                    Ngôn ngữ Quốc tế
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
                    Top món bán chạy &amp; Số lượng tồn kho
                  </Text>
                </View>
                {[...items]
                  .sort((a, b) => (b.sold_count || 0) - (a.sold_count || 0))
                  .slice(0, 6)
                  .map((item, idx) => (
                    <View
                      key={item.id}
                      style={[
                        styles.topItemRow,
                        { borderBottomColor: theme.border },
                      ]}
                    >
                      <Text style={styles.rankBadge}>#{idx + 1}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.itemTitle, { color: theme.text }]}>
                          {item.name_i18n?.vi}
                        </Text>
                        <Text
                          style={[styles.itemSub, { color: theme.subText }]}
                        >
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
              <View
                style={[
                  styles.card,
                  { backgroundColor: theme.card, borderColor: theme.border },
                ]}
              >
                <Text style={[styles.cardHeading, { color: theme.text }]}>
                  + Thêm nhanh món &amp; Số lượng tồn
                </Text>
                <View style={styles.quickAddRow}>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        flex: 1.3,
                        backgroundColor: theme.subCard,
                        borderColor: theme.border,
                        color: theme.text,
                      },
                    ]}
                    placeholder="Tên món (VD: Phở tái)"
                    placeholderTextColor={theme.subText}
                    value={newItemName}
                    onChangeText={setNewItemName}
                  />
                  <TextInput
                    style={[
                      styles.input,
                      {
                        flex: 0.8,
                        backgroundColor: theme.subCard,
                        borderColor: theme.border,
                        color: theme.text,
                      },
                    ]}
                    placeholder="Giá (35000)"
                    placeholderTextColor={theme.subText}
                    keyboardType="numeric"
                    value={newItemPrice}
                    onChangeText={setNewItemPrice}
                  />
                  <TextInput
                    style={[
                      styles.input,
                      {
                        flex: 0.6,
                        backgroundColor: theme.subCard,
                        borderColor: theme.border,
                        color: theme.text,
                      },
                    ]}
                    placeholder="Tồn (∞)"
                    placeholderTextColor={theme.subText}
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
                    { backgroundColor: theme.card, borderColor: theme.border },
                    selectedCategoryId === 'all' && styles.catChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.catChipText,
                      { color: theme.subText },
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
                      {
                        backgroundColor: theme.card,
                        borderColor: theme.border,
                      },
                      !item.is_available && styles.itemCardSoldOut,
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.itemTitle, { color: theme.text }]}>
                        {item.name_i18n?.vi}
                      </Text>
                      <Text style={[styles.itemSub, { color: theme.subText }]}>
                        EN: {item.name_i18n?.en || '—'} • Đã bán:{' '}
                        {item.sold_count || 0}
                      </Text>

                      {/* Price Row */}
                      <View style={styles.priceRow}>
                        <Text style={styles.priceBadge}>
                          {formatVnd(item.price)}
                        </Text>
                        <TouchableOpacity
                          style={[
                            styles.priceStepBtn,
                            { backgroundColor: theme.subCard },
                          ]}
                          onPress={() => handleUpdateItemPrice(item, -5000)}
                        >
                          <Text
                            style={[
                              styles.priceStepText,
                              { color: theme.text },
                            ]}
                          >
                            -5k
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.priceStepBtn,
                            { backgroundColor: theme.subCard },
                          ]}
                          onPress={() => handleUpdateItemPrice(item, 5000)}
                        >
                          <Text
                            style={[
                              styles.priceStepText,
                              { color: theme.text },
                            ]}
                          >
                            +5k
                          </Text>
                        </TouchableOpacity>
                      </View>

                      {/* Stock Quantity Row */}
                      <View style={styles.priceRow}>
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                          }}
                        >
                          <Ionicons
                            name="cube-outline"
                            size={12}
                            color="#0f766e"
                            style={{ marginRight: 4 }}
                          />
                          <Text style={styles.stockBadgeText}>
                            Tồn kho: {stock === null ? '∞' : stock}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={[
                            styles.priceStepBtn,
                            { backgroundColor: theme.subCard },
                          ]}
                          onPress={() =>
                            handleUpdateItemStock(
                              item,
                              Math.max(0, (stock ?? 10) - 1)
                            )
                          }
                        >
                          <Text
                            style={[
                              styles.priceStepText,
                              { color: theme.text },
                            ]}
                          >
                            -1
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.priceStepBtn,
                            { backgroundColor: theme.subCard },
                          ]}
                          onPress={() =>
                            handleUpdateItemStock(item, (stock ?? 0) + 5)
                          }
                        >
                          <Text
                            style={[
                              styles.priceStepText,
                              { color: theme.text },
                            ]}
                          >
                            +5
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.priceStepBtn,
                            { backgroundColor: theme.subCard },
                          ]}
                          onPress={() => handleUpdateItemStock(item, null)}
                        >
                          <Text
                            style={[
                              styles.priceStepText,
                              { color: theme.text },
                            ]}
                          >
                            ∞
                          </Text>
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

          {/* ================= TAB 4: PROMOTIONS, DISCOUNTS & FLASH SALE STUDIO ================= */}
          {activeTab === 'promotions' && (
            <View style={styles.sectionStack}>
              {/* Live Phone Viewer at Top */}
              {renderLivePhoneViewer()}

              {/* Sub-tab Switcher: Discount Banner vs Flash Sale */}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  onPress={() => setPromoSubTab('discount')}
                  style={[
                    styles.subTabBtn,
                    promoSubTab === 'discount' && {
                      backgroundColor: '#0f172a',
                    },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '900',
                      color:
                        promoSubTab === 'discount' ? '#ffffff' : '#475569',
                    }}
                  >
                    🔥 Giảm Giá &amp; Banner
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setPromoSubTab('flash_sale')}
                  style={[
                    styles.subTabBtn,
                    promoSubTab === 'flash_sale' && {
                      backgroundColor: '#e11d48',
                    },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '900',
                      color:
                        promoSubTab === 'flash_sale' ? '#ffffff' : '#475569',
                    }}
                  >
                    ⚡ Flash Sale Giờ Vàng
                  </Text>
                </TouchableOpacity>
              </View>

              {promoSubTab === 'discount' ? (
                <View
                  style={[
                    styles.card,
                    { backgroundColor: theme.card, borderColor: theme.border },
                  ]}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 8,
                    }}
                  >
                    <Text style={[styles.cardHeading, { color: theme.text }]}>
                      🔥 Giảm Giá Hóa Đơn / Theo Món
                    </Text>
                    <Switch
                      value={promoBanner.enabled}
                      onValueChange={(v: boolean) =>
                        setPromoBanner((prev) => ({ ...prev, enabled: v }))
                      }
                      trackColor={{ false: '#cbd5e1', true: '#10b981' }}
                    />
                  </View>

                  {/* Discount Type: % vs VND */}
                  <Text style={[styles.fieldLabel, { color: theme.subText }]}>
                    Hình thức giảm giá
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      onPress={() =>
                        syncBannerRule({
                          ...promoBanner,
                          discountType: 'percent',
                          discountValue: 15,
                        })
                      }
                      style={[
                        styles.choiceBtn,
                        promoBanner.discountType !== 'fixed_amount' &&
                          styles.choiceBtnActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.choiceBtnText,
                          promoBanner.discountType !== 'fixed_amount' &&
                            styles.choiceBtnTextActive,
                        ]}
                      >
                        Giảm theo %
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() =>
                        syncBannerRule({
                          ...promoBanner,
                          discountType: 'fixed_amount',
                          discountValue: 20000,
                        })
                      }
                      style={[
                        styles.choiceBtn,
                        promoBanner.discountType === 'fixed_amount' &&
                          styles.choiceBtnActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.choiceBtnText,
                          promoBanner.discountType === 'fixed_amount' &&
                            styles.choiceBtnTextActive,
                        ]}
                      >
                        Giảm số tiền (đ)
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Quick Discount Value Chips */}
                  <Text style={[styles.fieldLabel, { color: theme.subText }]}>
                    Mức giảm nhanh
                  </Text>
                  <View
                    style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}
                  >
                    {(promoBanner.discountType === 'fixed_amount'
                      ? [10000, 20000, 30000, 50000]
                      : [10, 15, 20, 30]
                    ).map((val) => {
                      const active = promoBanner.discountValue === val;
                      return (
                        <TouchableOpacity
                          key={val}
                          onPress={() =>
                            syncBannerRule({
                              ...promoBanner,
                              discountValue: val,
                            })
                          }
                          style={[
                            styles.miniChip,
                            active && { backgroundColor: '#10b981' },
                          ]}
                        >
                          <Text
                            style={{
                              fontSize: 11,
                              fontWeight: '800',
                              color: active ? '#ffffff' : '#334155',
                            }}
                          >
                            {promoBanner.discountType === 'fixed_amount'
                              ? `-${val / 1000}k`
                              : `-${val}%`}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Min Order Chips */}
                  <Text style={[styles.fieldLabel, { color: theme.subText }]}>
                    Đơn tối thiểu
                  </Text>
                  <View
                    style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}
                  >
                    {[
                      { label: '0đ (Mọi đơn)', val: 0 },
                      { label: 'Từ 50k', val: 50000 },
                      { label: 'Từ 100k', val: 100000 },
                      { label: 'Từ 200k', val: 200000 },
                    ].map((chip) => {
                      const active =
                        (promoBanner.minOrderAmount || 0) === chip.val;
                      return (
                        <TouchableOpacity
                          key={chip.val}
                          onPress={() =>
                            syncBannerRule({
                              ...promoBanner,
                              minOrderAmount: chip.val,
                            })
                          }
                          style={[
                            styles.miniChip,
                            active && { backgroundColor: '#0f172a' },
                          ]}
                        >
                          <Text
                            style={{
                              fontSize: 11,
                              fontWeight: '800',
                              color: active ? '#ffffff' : '#334155',
                            }}
                          >
                            {chip.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Apply Scope: All vs Selected Items */}
                  <Text style={[styles.fieldLabel, { color: theme.subText }]}>
                    Phạm vi áp dụng
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      onPress={() =>
                        syncBannerRule({ ...promoBanner, applyScope: 'all' })
                      }
                      style={[
                        styles.choiceBtn,
                        promoBanner.applyScope !== 'selected_items' &&
                          styles.choiceBtnActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.choiceBtnText,
                          promoBanner.applyScope !== 'selected_items' &&
                            styles.choiceBtnTextActive,
                        ]}
                      >
                        Toàn bộ Menu
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() =>
                        syncBannerRule({
                          ...promoBanner,
                          applyScope: 'selected_items',
                        })
                      }
                      style={[
                        styles.choiceBtn,
                        promoBanner.applyScope === 'selected_items' &&
                          styles.choiceBtnActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.choiceBtnText,
                          promoBanner.applyScope === 'selected_items' &&
                            styles.choiceBtnTextActive,
                        ]}
                      >
                        Chọn món ({(promoBanner.selectedItemIds || []).length})
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {promoBanner.applyScope === 'selected_items' && (
                    <View style={{ gap: 6, marginTop: 8 }}>
                      {items.map((it) => {
                        const checked = (
                          promoBanner.selectedItemIds || []
                        ).includes(it.id);
                        return (
                          <TouchableOpacity
                            key={it.id}
                            onPress={() => toggleBannerSelectedItem(it.id)}
                            style={[
                              styles.selectableItemRow,
                              checked && {
                                borderColor: '#10b981',
                                backgroundColor: '#ecfdf5',
                              },
                            ]}
                          >
                            <Ionicons
                              name={
                                checked ? 'checkbox' : 'square-outline'
                              }
                              size={18}
                              color={checked ? '#10b981' : '#94a3b8'}
                            />
                            <Text
                              style={{
                                flex: 1,
                                fontSize: 12,
                                fontWeight: '700',
                                color: '#0f172a',
                              }}
                            >
                              {it.name_i18n?.vi}
                            </Text>
                            <Text
                              style={{
                                fontSize: 11,
                                fontWeight: '800',
                                color: '#059669',
                              }}
                            >
                              {formatVnd(it.price)}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}

                  {/* Pure Round Banner Color Swatches (No Cluttered Titles) */}
                  <Text style={[styles.fieldLabel, { color: theme.subText }]}>
                    Màu Banner
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                    {BANNER_GRADIENT_SWATCHES.map((sw) => {
                      const active = promoBanner.bgGradient === sw.id;
                      return (
                        <TouchableOpacity
                          key={sw.id}
                          onPress={() =>
                            setPromoBanner((prev) => ({
                              ...prev,
                              bgGradient: sw.id,
                            }))
                          }
                          style={[
                            styles.colorCircle,
                            { backgroundColor: sw.hex },
                            active && styles.colorCircleActive,
                          ]}
                        >
                          {active && (
                            <Ionicons
                              name="checkmark"
                              size={16}
                              color="#ffffff"
                            />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Welcome Popup Toggle */}
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: 14,
                      paddingTop: 10,
                      borderTopWidth: 1,
                      borderTopColor: theme.border,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: '800',
                        color: theme.text,
                        flex: 1,
                      }}
                    >
                      🎁 Bật thêm Popup Chào Mừng khi khách quét QR
                    </Text>
                    <Switch
                      value={welcomePopup.enabled}
                      onValueChange={(v: boolean) =>
                        setWelcomePopup((prev) => ({ ...prev, enabled: v }))
                      }
                      trackColor={{ false: '#cbd5e1', true: '#10b981' }}
                    />
                  </View>

                  <TouchableOpacity
                    style={styles.saveSettingsBtn}
                    onPress={handleSaveShopAndTheme}
                  >
                    <Text style={styles.saveSettingsBtnText}>
                      Lưu &amp; Áp Dụng Khuyến Mãi
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View
                  style={[
                    styles.card,
                    { backgroundColor: theme.card, borderColor: theme.border },
                  ]}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 8,
                    }}
                  >
                    <Text style={[styles.cardHeading, { color: theme.text }]}>
                      ⚡ Flash Sale Giờ Vàng
                    </Text>
                    <Switch
                      value={flashSale.enabled}
                      onValueChange={(v: boolean) =>
                        setFlashSale((prev) => ({ ...prev, enabled: v }))
                      }
                      trackColor={{ false: '#cbd5e1', true: '#e11d48' }}
                    />
                  </View>

                  <Text style={[styles.fieldLabel, { color: theme.subText }]}>
                    Mức giảm Flash Sale (%)
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {[15, 20, 25, 30, 50].map((pct) => {
                      const active =
                        flashSale.discountType === 'percent' &&
                        flashSale.discountValue === pct;
                      return (
                        <TouchableOpacity
                          key={pct}
                          onPress={() =>
                            setFlashSale((prev) => ({
                              ...prev,
                              discountType: 'percent',
                              discountValue: pct,
                            }))
                          }
                          style={[
                            styles.miniChip,
                            active && { backgroundColor: '#e11d48' },
                          ]}
                        >
                          <Text
                            style={{
                              fontSize: 11,
                              fontWeight: '800',
                              color: active ? '#ffffff' : '#334155',
                            }}
                          >
                            -{pct}%
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Multi-Day Date Range Presets */}
                  <Text style={[styles.fieldLabel, { color: theme.subText }]}>
                    📅 Thời hạn chiến dịch Flash Sale (Nhiều ngày)
                  </Text>
                  <View
                    style={{
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      gap: 6,
                      marginTop: 4,
                    }}
                  >
                    {[
                      { label: 'Chỉ hôm nay', days: 0 },
                      { label: '3 Ngày tới', days: 2 },
                      { label: '7 Ngày', days: 6 },
                      { label: '14 Ngày', days: 13 },
                      { label: '30 Ngày', days: 29 },
                    ].map((preset) => {
                      const dStart = new Date();
                      const startIso = dStart.toISOString().slice(0, 10);
                      const dEnd = new Date();
                      dEnd.setDate(dEnd.getDate() + preset.days);
                      const endIso = dEnd.toISOString().slice(0, 10);
                      const isActive =
                        flashSale.startDate === startIso &&
                        flashSale.endDate === endIso;
                      return (
                        <TouchableOpacity
                          key={preset.label}
                          onPress={() =>
                            setFlashSale((prev) => ({
                              ...prev,
                              startDate: startIso,
                              endDate: endIso,
                            }))
                          }
                          style={[
                            styles.miniChip,
                            isActive && { backgroundColor: '#e11d48' },
                          ]}
                        >
                          <Text
                            style={{
                              fontSize: 10,
                              fontWeight: '800',
                              color: isActive ? '#ffffff' : '#334155',
                            }}
                          >
                            {preset.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.fieldLabel, { color: theme.subText }]}
                      >
                        Từ ngày (YYYY-MM-DD)
                      </Text>
                      <TextInput
                        style={[
                          styles.input,
                          {
                            backgroundColor: theme.subCard,
                            borderColor: theme.border,
                            color: theme.text,
                          },
                        ]}
                        value={flashSale.startDate}
                        onChangeText={(d: string) =>
                          setFlashSale((prev) => ({ ...prev, startDate: d }))
                        }
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.fieldLabel, { color: theme.subText }]}
                      >
                        Đến hết ngày (YYYY-MM-DD)
                      </Text>
                      <TextInput
                        style={[
                          styles.input,
                          {
                            backgroundColor: theme.subCard,
                            borderColor: theme.border,
                            color: theme.text,
                          },
                        ]}
                        value={flashSale.endDate}
                        onChangeText={(d: string) =>
                          setFlashSale((prev) => ({ ...prev, endDate: d }))
                        }
                      />
                    </View>
                  </View>

                  {/* Quick Time Slot Presets */}
                  <Text style={[styles.fieldLabel, { color: theme.subText }]}>
                    ⏰ Khung giờ vàng mỗi ngày
                  </Text>
                  <View
                    style={{
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      gap: 6,
                      marginTop: 4,
                    }}
                  >
                    {[
                      { label: '🍱 Trưa 11:00–14:00', s: '11:00', e: '14:00' },
                      { label: '🧋 Chiều 14:00–17:00', s: '14:00', e: '17:00' },
                      { label: '🍻 Tối 18:00–22:00', s: '18:00', e: '22:00' },
                      { label: '🔥 Cả ngày 00:00–23:45', s: '00:00', e: '23:45' },
                    ].map((slot) => {
                      const isActive =
                        flashSale.startTime === slot.s &&
                        flashSale.endTime === slot.e;
                      return (
                        <TouchableOpacity
                          key={slot.label}
                          onPress={() =>
                            setFlashSale((prev) => ({
                              ...prev,
                              startTime: slot.s,
                              endTime: slot.e,
                            }))
                          }
                          style={[
                            styles.miniChip,
                            isActive && { backgroundColor: '#0f172a' },
                          ]}
                        >
                          <Text
                            style={{
                              fontSize: 10,
                              fontWeight: '800',
                              color: isActive ? '#ffffff' : '#334155',
                            }}
                          >
                            {slot.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.fieldLabel, { color: theme.subText }]}
                      >
                        Giờ bắt đầu
                      </Text>
                      <TextInput
                        style={[
                          styles.input,
                          {
                            backgroundColor: theme.subCard,
                            borderColor: theme.border,
                            color: theme.text,
                          },
                        ]}
                        value={flashSale.startTime}
                        onChangeText={(t: string) =>
                          setFlashSale((prev) => ({ ...prev, startTime: t }))
                        }
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.fieldLabel, { color: theme.subText }]}
                      >
                        Giờ kết thúc
                      </Text>
                      <TextInput
                        style={[
                          styles.input,
                          {
                            backgroundColor: theme.subCard,
                            borderColor: theme.border,
                            color: theme.text,
                          },
                        ]}
                        value={flashSale.endTime}
                        onChangeText={(t: string) =>
                          setFlashSale((prev) => ({ ...prev, endTime: t }))
                        }
                      />
                    </View>
                  </View>

                  <Text style={[styles.fieldLabel, { color: theme.subText }]}>
                    Tích chọn sản phẩm chạy Flash Sale ({flashSale.itemIds.length}{' '}
                    món):
                  </Text>
                  <View style={{ gap: 6, marginTop: 6 }}>
                    {items.map((it) => {
                      const checked = flashSale.itemIds.includes(it.id);
                      const salePrice = Math.max(
                        0,
                        Math.round(
                          (it.price * (100 - flashSale.discountValue)) / 100
                        )
                      );
                      return (
                        <TouchableOpacity
                          key={it.id}
                          onPress={() => toggleFlashSaleItem(it.id)}
                          style={[
                            styles.selectableItemRow,
                            checked && {
                              borderColor: '#e11d48',
                              backgroundColor: '#fff1f2',
                            },
                          ]}
                        >
                          <Ionicons
                            name={checked ? 'checkbox' : 'square-outline'}
                            size={18}
                            color={checked ? '#e11d48' : '#94a3b8'}
                          />
                          <Text
                            style={{
                              flex: 1,
                              fontSize: 12,
                              fontWeight: '700',
                              color: '#0f172a',
                            }}
                          >
                            {it.name_i18n?.vi}
                          </Text>
                          <Text
                            style={{
                              fontSize: 11,
                              fontWeight: '900',
                              color: '#e11d48',
                            }}
                          >
                            ⚡ {formatVnd(salePrice)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.saveSettingsBtn,
                      { backgroundColor: '#e11d48' },
                    ]}
                    onPress={handleSaveShopAndTheme}
                  >
                    <Text style={styles.saveSettingsBtnText}>
                      Lưu &amp; Kích Hoạt Flash Sale
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* ================= TAB 5: THEME DESIGNER & STORE SETTINGS ================= */}
          {activeTab === 'settings' && (
            <View style={styles.sectionStack}>
              {/* Live Phone Viewer */}
              {renderLivePhoneViewer()}

              {/* Theme & Color Customizer (No Cluttered Text Titles) */}
              <View
                style={[
                  styles.card,
                  { backgroundColor: theme.card, borderColor: theme.border },
                ]}
              >
                <Text style={[styles.cardHeading, { color: theme.text }]}>
                  🎨 Giao Diện &amp; Màu Sắc Màn Hình Quán
                </Text>

                <Text style={[styles.fieldLabel, { color: theme.subText }]}>
                  Màu chủ đạo
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    gap: 12,
                    marginTop: 6,
                  }}
                >
                  {BRAND_COLOR_SWATCHES.map((hex) => {
                    const selected =
                      primaryColor.toLowerCase() === hex.toLowerCase();
                    return (
                      <TouchableOpacity
                        key={hex}
                        onPress={() => setPrimaryColor(hex)}
                        style={[
                          styles.colorCircle,
                          { backgroundColor: hex },
                          selected && styles.colorCircleActive,
                        ]}
                      >
                        {selected && (
                          <Ionicons
                            name="checkmark"
                            size={16}
                            color="#ffffff"
                          />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={[styles.fieldLabel, { color: theme.subText }]}>
                  Nền màn hình khách
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                  {[
                    { id: 'clean', label: '☀️ Sáng' },
                    { id: 'warm', label: '🏮 Kem Ấm' },
                    { id: 'dark', label: '🌙 Tối' },
                  ].map((bg) => {
                    const active = backgroundStyle === bg.id;
                    return (
                      <TouchableOpacity
                        key={bg.id}
                        onPress={() =>
                          setBackgroundStyle(
                            bg.id as 'clean' | 'warm' | 'dark'
                          )
                        }
                        style={[
                          styles.choiceBtn,
                          active && styles.choiceBtnActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.choiceBtnText,
                            active && styles.choiceBtnTextActive,
                          ]}
                        >
                          {bg.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={[styles.fieldLabel, { color: theme.subText }]}>
                  Bố cục hiển thị món
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                  <TouchableOpacity
                    onPress={() => setLayoutMode('list')}
                    style={[
                      styles.choiceBtn,
                      layoutMode === 'list' && styles.choiceBtnActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.choiceBtnText,
                        layoutMode === 'list' && styles.choiceBtnTextActive,
                      ]}
                    >
                      Danh sách ngang
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => setLayoutMode('grid')}
                    style={[
                      styles.choiceBtn,
                      layoutMode === 'grid' && styles.choiceBtnActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.choiceBtnText,
                        layoutMode === 'grid' && styles.choiceBtnTextActive,
                      ]}
                    >
                      Lưới ảnh 2 cột
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Basic Store Info & Wi-Fi */}
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
                    name="storefront"
                    size={16}
                    color="#10b981"
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[
                      styles.cardHeading,
                      { marginBottom: 0, color: theme.text },
                    ]}
                  >
                    Thông Tin Quán &amp; Wi-Fi 1 Chạm
                  </Text>
                </View>

                <Text style={[styles.fieldLabel, { color: theme.subText }]}>
                  Tên cửa hàng
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: theme.subCard,
                      borderColor: theme.border,
                      color: theme.text,
                    },
                  ]}
                  value={editShopName}
                  onChangeText={setEditShopName}
                />

                <Text style={[styles.fieldLabel, { color: theme.subText }]}>
                  Tỉnh / Thành phố
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: theme.subCard,
                      borderColor: theme.border,
                      color: theme.text,
                    },
                  ]}
                  value={editCity}
                  onChangeText={setEditCity}
                />

                <Text style={[styles.fieldLabel, { color: theme.subText }]}>
                  Số điện thoại / Zalo
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: theme.subCard,
                      borderColor: theme.border,
                      color: theme.text,
                    },
                  ]}
                  value={editPhone}
                  onChangeText={setEditPhone}
                />

                <Text style={[styles.fieldLabel, { color: theme.subText }]}>
                  Tên Wi-Fi (SSID)
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: theme.subCard,
                      borderColor: theme.border,
                      color: theme.text,
                    },
                  ]}
                  value={editWifiSsid}
                  onChangeText={setEditWifiSsid}
                />

                <Text style={[styles.fieldLabel, { color: theme.subText }]}>
                  Mật khẩu Wi-Fi
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: theme.subCard,
                      borderColor: theme.border,
                      color: theme.text,
                    },
                  ]}
                  value={editWifiPass}
                  onChangeText={setEditWifiPass}
                />

                <TouchableOpacity
                  style={styles.saveSettingsBtn}
                  onPress={handleSaveShopAndTheme}
                >
                  <Text style={styles.saveSettingsBtnText}>
                    Lưu Tất Cả Cài Đặt
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
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
          onPress={() => setActiveTab('orders')}
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
          onPress={() => setActiveTab('overview')}
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
          onPress={() => setActiveTab('catalog')}
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
          onPress={() => setActiveTab('promotions')}
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
              activeTab === 'promotions' && { color: '#f59e0b', fontWeight: '900' },
            ]}
          >
            Khuyến mãi
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navTab}
          onPress={() => setActiveTab('settings')}
        >
          <Ionicons
            name={
              activeTab === 'settings' ? 'color-palette' : 'color-palette-outline'
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
      {printingOrder && activeShop && (
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
              <TouchableOpacity onPress={() => setPrintingOrder(null)}>
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
                  {activeShop.name}
                </Text>
                <Text
                  style={{
                    fontSize: 11,
                    color: '#334155',
                    textAlign: 'center',
                    marginTop: 2,
                  }}
                >
                  {activeShop.address || activeShop.city}
                </Text>
                {activeShop.phone_contact ? (
                  <Text style={{ fontSize: 11, color: '#334155' }}>
                    ĐT: {activeShop.phone_contact}
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
                  {printingOrder.payment_status === 'paid'
                    ? 'HÓA ĐƠN THANH TOÁN'
                    : 'PHIẾU TẠM TÍNH'}
                </Text>
                <Text style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
                  Mã: #{printingOrder.order_code} • {printingOrder.table_label}
                </Text>
              </View>

              {/* Items List */}
              <View style={{ gap: 6, marginBottom: 10 }}>
                {printingOrder.items.map((line, idx) => (
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
                    {formatVnd(printingOrder.total_amount)}
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
                  {printingOrder.payment_status === 'paid'
                    ? '✓ ĐÃ THANH TOÁN'
                    : 'CHƯA THANH TOÁN'}{' '}
                  ({printingOrder.payment_method === 'vietqr' ? 'VietQR' : 'Tiền mặt'})
                </Text>
                {activeShop.wifi_info?.ssid ? (
                  <Text
                    style={{
                      fontSize: 10,
                      color: '#475569',
                      marginTop: 6,
                      textAlign: 'center',
                    }}
                  >
                    Wi-Fi: {activeShop.wifi_info.ssid} (Pass:{' '}
                    {activeShop.wifi_info.password || 'Miễn phí'})
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
                onPress={() => setPrintingOrder(null)}
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
                    `Đang in phiếu #${printingOrder.order_code} (${printingOrder.table_label}) ra máy in nhiệt khổ ${receiptPaperSize}.`
                  );
                  setPrintingOrder(null);
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
      )}
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
  themeToggleBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  chartBarsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 120,
    paddingTop: 12,
  },
  chartBarColumn: {
    flex: 1,
    alignItems: 'center',
  },
  chartBarTrack: {
    width: 22,
    height: 75,
    backgroundColor: '#e2e8f0',
    borderRadius: 6,
    justifyContent: 'flex-end',
    overflow: 'hidden',
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
    marginTop: 4,
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
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  rankBadge: {
    width: 28,
    fontSize: 12,
    fontWeight: '900',
    color: '#10b981',
  },
  itemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  itemSub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  viewCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0f766e',
  },
  quickAddRow: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12,
    color: '#0f172a',
  },
  addBtn: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  catChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginRight: 8,
  },
  catChipActive: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  catChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
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
    opacity: 0.6,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
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
    borderRadius: 8,
  },
  priceStepText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  switchColumn: {
    alignItems: 'center',
    gap: 4,
  },
  stockStatusText: {
    fontSize: 10,
    fontWeight: '800',
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginTop: 10,
    marginBottom: 4,
  },
  saveSettingsBtn: {
    backgroundColor: '#10b981',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  saveSettingsBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  phoneViewerFrame: {
    borderRadius: 26,
    borderWidth: 4,
    overflow: 'hidden',
  },
  phoneViewerHeader: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  phoneViewerLogo: {
    width: 20,
    height: 20,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  langPreviewPill: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    marginRight: 6,
  },
  previewBannerBox: {
    borderRadius: 14,
    padding: 10,
  },
  previewFlashBox: {
    backgroundColor: '#e11d48',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  previewItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  subTabBtn: {
    flex: 1,
    backgroundColor: '#e2e8f0',
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  choiceBtn: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
  },
  choiceBtnActive: {
    backgroundColor: '#ecfdf5',
    borderColor: '#10b981',
  },
  choiceBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
  },
  choiceBtnTextActive: {
    color: '#065f46',
  },
  miniChip: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  selectableItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  colorCircle: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorCircleActive: {
    borderWidth: 3,
    borderColor: '#0f172a',
  },
  bottomNav: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    flexDirection: 'row',
    paddingVertical: 8,
  },
  navTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  navTabText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
  },
  navTabTextActive: {
    color: '#10b981',
    fontWeight: '800',
  },
});
