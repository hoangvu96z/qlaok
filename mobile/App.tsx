import React, { useEffect, useState, useCallback } from 'react';
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
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  supabase,
  MobileShop,
  MobileCategory,
  MobileCatalogItem,
  MobileAnalyticsEvent,
  formatVnd,
} from './src/lib/supabase';

type TabType = 'overview' | 'catalog' | 'settings';

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [email, setEmail] = useState('chuquan@qlaok.vn');
  const [password, setPassword] = useState('qlaok123456');
  const [authLoading, setAuthLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [shops, setShops] = useState<MobileShop[]>([]);
  const [activeShopId, setActiveShopId] = useState<string>('');
  const [categories, setCategories] = useState<MobileCategory[]>([]);
  const [items, setItems] = useState<MobileCatalogItem[]>([]);
  const [events, setEvents] = useState<MobileAnalyticsEvent[]>([]);

  // Quick Add Item state
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');

  // Settings form state
  const [editShopName, setEditShopName] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editWifiSsid, setEditWifiSsid] = useState('');
  const [editWifiPass, setEditWifiPass] = useState('');

  const activeShop =
    shops.find((s) => s.id === activeShopId) || shops[0] || null;

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
    [activeShopId]
  );

  useEffect(() => {
    if (isLoggedIn) {
      loadShopsAndData();
    }
  }, [isLoggedIn, loadShopsAndData]);

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
        err instanceof Error ? err.message : 'Vui lòng kiểm tra lại email/mật khẩu'
      );
    } finally {
      setAuthLoading(false);
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

  const handleQuickAddItem = async () => {
    if (!activeShop || !newItemName.trim()) return;
    const targetCatId =
      selectedCategoryId !== 'all'
        ? selectedCategoryId
        : categories[0]?.id;

    if (!targetCatId) {
      Alert.alert('Chưa có danh mục', 'Vui lòng tạo danh mục trước.');
      return;
    }

    const priceNum = Number(newItemPrice.replace(/[^0-9]/g, '')) || 35000;
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
          <Text style={styles.authTitle}>Qlaok CMS Mobile</Text>
          <Text style={styles.authSubtitle}>
            Ứng dụng Chủ quán quản lý Thực đơn 5 ngôn ngữ, Bật/tắt hết món & Doanh thu
          </Text>

          <TouchableOpacity
            style={styles.demoButton}
            onPress={() => handleLogin(true)}
          >
            <Text style={styles.demoButtonText}>
              ⚡ Vào Nhanh Tài Khoản Chủ Quán Demo (1 Chạm)
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

  // Compute Analytics & Estimated Order Revenue
  const scanDoorCount = events.filter((e) => e.event_type === 'scan_door').length;
  const scanTableCount = events.filter((e) => e.event_type === 'scan_table').length;
  const showToStaffCount = events.filter(
    (e) => e.event_type === 'show_to_staff'
  ).length;
  const wifiCopyCount = events.filter((e) => e.event_type === 'wifi_copy').length;

  const avgItemPrice =
    items.length > 0
      ? items.reduce((sum, i) => sum + Number(i.price || 0), 0) / items.length
      : 50000;
  const estimatedOrderRevenue = Math.round(showToStaffCount * avgItemPrice * 1.8);

  const visibleItems =
    selectedCategoryId === 'all'
      ? items
      : items.filter((i) => i.category_id === selectedCategoryId);

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
                {activeShop?.name || 'Qlaok CMS'}
              </Text>
              <Text style={styles.headerSub}>
                📍 {activeShop?.city || 'Đà Nẵng'} • Supabase Live
              </Text>
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
                <Text
                  style={[
                    styles.shopPillText,
                    active && styles.shopPillTextActive,
                  ]}
                >
                  {shop.vertical === 'fnb'
                    ? '🍜 '
                    : shop.vertical === 'service'
                      ? '💆‍♀️ '
                      : '🛍️ '}
                  {shop.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#10b981" />
          <Text style={styles.loadingText}>Đang đồng bộ từ Supabase...</Text>
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
          {/* ================= TAB 1: OVERVIEW & REVENUE ================= */}
          {activeTab === 'overview' && (
            <View style={styles.sectionStack}>
              <View style={styles.revenueHeroCard}>
                <Text style={styles.revenueLabel}>
                  DOANH THU ƯỚC TÍNH TỪ KHÁCH QUÉT QR GỌI MÓN
                </Text>
                <Text style={styles.revenueValue}>
                  {formatVnd(estimatedOrderRevenue)}
                </Text>
                <Text style={styles.revenueSub}>
                  Dựa trên {showToStaffCount} lượt khách bấm &quot;Đưa Nhân Viên Xem&quot; •{' '}
                  {items.filter((i) => i.is_available).length}/{items.length} món đang mở bán
                </Text>
              </View>

              <View style={styles.kpiGrid}>
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
                  <Text style={styles.kpiNumber}>{showToStaffCount}</Text>
                  <Text style={styles.kpiTitle}>Lượt gọi món tại bàn</Text>
                  <Text style={styles.kpiHint}>Show to Staff</Text>
                </View>

                <View style={styles.kpiCard}>
                  <Text style={styles.kpiNumber}>{wifiCopyCount}</Text>
                  <Text style={styles.kpiTitle}>Khách kết nối Wi-Fi</Text>
                  <Text style={styles.kpiHint}>
                    SSID: {activeShop?.wifi_info?.ssid || 'Chưa đặt'}
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
                <Text style={styles.cardHeading}>
                  🔥 Top món khách xem nhiều nhất
                </Text>
                {[...items]
                  .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
                  .slice(0, 5)
                  .map((item, idx) => (
                    <View key={item.id} style={styles.topItemRow}>
                      <Text style={styles.rankBadge}>#{idx + 1}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemTitle}>
                          {item.name_i18n?.vi}
                        </Text>
                        <Text style={styles.itemSub}>
                          {formatVnd(item.price)} • {item.name_i18n?.en || ''}
                        </Text>
                      </View>
                      <Text style={styles.viewCountText}>
                        {item.view_count || 0} lượt xem
                      </Text>
                    </View>
                  ))}
              </View>
            </View>
          )}

          {/* ================= TAB 2: CATALOG & 1-TAP OUT OF STOCK ================= */}
          {activeTab === 'catalog' && (
            <View style={styles.sectionStack}>
              {/* Quick Add Bar */}
              <View style={styles.card}>
                <Text style={styles.cardHeading}>+ Thêm nhanh món / dịch vụ</Text>
                <View style={styles.quickAddRow}>
                  <TextInput
                    style={[styles.input, { flex: 1.4 }]}
                    placeholder="Tên món (VD: Phở tái nạm)"
                    value={newItemName}
                    onChangeText={setNewItemName}
                  />
                  <TextInput
                    style={[styles.input, { flex: 0.9 }]}
                    placeholder="Giá (35000)"
                    keyboardType="numeric"
                    value={newItemPrice}
                    onChangeText={setNewItemPrice}
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

              {/* Item List with 1-Tap Availability Switch & Price Adjust */}
              {visibleItems.map((item) => (
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
                      🇬🇧 {item.name_i18n?.en || '—'} • 🇰🇷{' '}
                      {item.name_i18n?.ko || '—'}
                    </Text>
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
              ))}
            </View>
          )}

          {/* ================= TAB 3: STORE & WI-FI SETTINGS ================= */}
          {activeTab === 'settings' && (
            <View style={styles.sectionStack}>
              <View style={styles.card}>
                <Text style={styles.cardHeading}>
                  🏪 Cài đặt Cửa hàng & Wi-Fi (Đồng bộ Supabase)
                </Text>

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
          onPress={() => setActiveTab('overview')}
        >
          <Text
            style={[
              styles.navTabText,
              activeTab === 'overview' && styles.navTabTextActive,
            ]}
          >
            📊 Doanh thu & QR
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navTab}
          onPress={() => setActiveTab('catalog')}
        >
          <Text
            style={[
              styles.navTabText,
              activeTab === 'catalog' && styles.navTabTextActive,
            ]}
          >
            🍜 Thực đơn ({items.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navTab}
          onPress={() => setActiveTab('settings')}
        >
          <Text
            style={[
              styles.navTabText,
              activeTab === 'settings' && styles.navTabTextActive,
            ]}
          >
            ⚙️ Cài đặt Quán
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
    alignItems: 'center',
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
    gap: 8,
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
    paddingHorizontal: 14,
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
    marginTop: 8,
  },
  priceBadge: {
    fontSize: 13,
    fontWeight: '900',
    color: '#059669',
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
    paddingHorizontal: 12,
  },
  navTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  navTabText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  navTabTextActive: {
    color: '#10b981',
    fontWeight: '900',
  },
});
