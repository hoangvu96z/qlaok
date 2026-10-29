import React, { memo, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchApi,
  formatVnd,
  MobileCatalogItem,
  MobileCategory,
  MobileShop,
} from '../../lib/supabase';
import { MobileThemePalette, styles } from '../../styles/mobileStyles';
import { useMobileI18n } from '../MobileI18nProvider';

interface CatalogTabProps {
  activeShop: MobileShop | null;
  categories: MobileCategory[];
  items: MobileCatalogItem[];
  setItems: React.Dispatch<React.SetStateAction<MobileCatalogItem[]>>;
  onReloadShopData?: (shopId?: string) => void;
  canManageCatalog?: boolean;
  canAdjustInventory?: boolean;
  theme: MobileThemePalette;
}

export const CatalogTab = memo(function CatalogTab({
  activeShop,
  categories,
  items,
  setItems,
  onReloadShopData,
  canManageCatalog = true,
  canAdjustInventory = true,
  theme,
}: CatalogTabProps) {
  const { t, tb } = useMobileI18n();
  // Local state isolated inside CatalogTab so typing never triggers re-renders on other tabs!
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemStock, setNewItemStock] = useState('');
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');

  const reloadSeqRef = useRef(0);
  const activeShopRef = useRef(activeShop?.id);
  if (activeShopRef.current !== activeShop?.id) {
    activeShopRef.current = activeShop?.id;
    reloadSeqRef.current++;
  }

  const visibleItems =
    selectedCategoryId === 'all'
      ? items
      : items.filter((i) => i.category_id === selectedCategoryId);

  const reloadCatalogItemsSilently = async (shopId?: string) => {
    const targetShopId = shopId || activeShop?.id;
    if (!targetShopId || targetShopId !== activeShopRef.current) return;
    const seq = ++reloadSeqRef.current;
    try {
      const catalogRes = await fetchApi(
        `/api/catalog?shopId=${encodeURIComponent(targetShopId)}`
      );
      if (
        seq !== reloadSeqRef.current ||
        activeShopRef.current !== targetShopId
      ) {
        return;
      }
      const catalogPayload = (await catalogRes.json().catch(() => null)) as
        | { items?: MobileCatalogItem[] }
        | null;
      if (
        seq !== reloadSeqRef.current ||
        activeShopRef.current !== targetShopId
      ) {
        return;
      }
      if (catalogPayload && Array.isArray(catalogPayload.items)) {
        const refreshedItems = catalogPayload.items.map(
          (i: MobileCatalogItem) => ({
            ...i,
            price: Number(i.price),
          })
        );
        setItems(refreshedItems);
        return;
      }
      throw new Error('Invalid catalog payload');
    } catch {
      // Fall back to parent onReloadShopData only if scoped silent reload fails
      // and this shop is still the active shop and latest reload generation
      if (
        seq === reloadSeqRef.current &&
        activeShopRef.current === targetShopId
      ) {
        onReloadShopData?.(targetShopId);
      }
    }
  };

  const handleToggleItemAvailability = async (item: MobileCatalogItem) => {
    if (!canManageCatalog && !canAdjustInventory) return;
    const nextVal = !item.is_available;
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, is_available: nextVal } : i))
    );

    try {
      const res = await fetchApi('/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: item.id,
            shop_id: activeShop?.id ?? item.shop_id,
            category_id: item.category_id,
            is_available: nextVal,
          },
        }),
      });

      const data = await res.json().catch(() => null);
      const rawItem =
        data && typeof data === 'object'
          ? (data as { item?: unknown }).item
          : null;
      const isValidServerItem =
        rawItem !== null &&
        typeof rawItem === 'object' &&
        typeof (rawItem as { id?: unknown }).id === 'string' &&
        (rawItem as { id: string }).id === item.id &&
        typeof (rawItem as { is_available?: unknown }).is_available === 'boolean';

      if (!isValidServerItem) {
        setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
        Alert.alert(
          t('catalog.errUpdateTitle'),
          tb(
            'Phản hồi từ máy chủ không hợp lệ.',
            'Invalid response from server.'
          )
        );
        void reloadCatalogItemsSilently(activeShop?.id ?? item.shop_id);
        return;
      }

      const serverItem = rawItem as MobileCatalogItem;
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, ...serverItem } : i))
      );

      if (serverItem.is_available !== nextVal) {
        const itemName =
          (serverItem.name_i18n && typeof serverItem.name_i18n === 'object'
            ? serverItem.name_i18n.vi || serverItem.name_i18n.en
            : '') ||
          item.name_i18n?.vi ||
          item.name_i18n?.en ||
          '';

        Alert.alert(
          tb('Hết hàng', 'Sold Out'),
          tb(
            'Món "{name}" có tồn kho bằng 0 nên máy chủ tiếp tục giữ trạng thái hết hàng. Vui lòng kiểm tra tồn kho.',
            'Item "{name}" has 0 stock quantity, so the server kept it sold out. Please check inventory.',
            { name: itemName }
          )
        );
      }
    } catch (error) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
      Alert.alert(
        t('catalog.errUpdateTitle'),
        error instanceof Error ? error.message : t('common.tryAgain')
      );
      void reloadCatalogItemsSilently(activeShop?.id ?? item.shop_id);
    }
  };

  const handleUpdateItemPrice = async (
    item: MobileCatalogItem,
    delta: number
  ) => {
    if (!canManageCatalog) return;
    const nextPrice = Math.max(0, Number(item.price) + delta);
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, price: nextPrice } : i))
    );

    try {
      const response = await fetchApi('/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: item.id,
            shop_id: activeShop?.id ?? item.shop_id,
            category_id: item.category_id,
            price: nextPrice,
          },
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { item?: MobileCatalogItem }
        | null;
      if (
        !payload?.item ||
        payload.item.id !== item.id ||
        !Number.isFinite(Number(payload.item.price))
      ) {
        throw new Error(t('common.tryAgain'));
      }
      setItems((prev) =>
        prev.map((current) =>
          current.id === item.id ? { ...current, ...payload.item! } : current
        )
      );
    } catch (error) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
      Alert.alert(
        t('catalog.errPriceTitle'),
        error instanceof Error ? error.message : t('common.tryAgain')
      );
      void reloadCatalogItemsSilently(activeShop?.id ?? item.shop_id);
    }
  };

  const handleUpdateItemStock = async (
    item: MobileCatalogItem,
    nextStock: number | null
  ) => {
    if (!canAdjustInventory && !canManageCatalog) return;
    const prevStock =
      item.stock_quantity === undefined ? null : item.stock_quantity;
    const nextAvail =
      nextStock === 0
        ? false
        : nextStock !== null && nextStock > 0
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
      const response = await fetchApi('/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            id: item.id,
            shop_id: activeShop?.id ?? item.shop_id,
            category_id: item.category_id,
            stock_quantity: nextStock,
            expected_stock_quantity: prevStock,
            ...(nextStock !== null ? { is_available: nextAvail } : {}),
          },
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { item?: MobileCatalogItem }
        | null;
      if (!payload?.item || payload.item.id !== item.id) {
        throw new Error(t('common.tryAgain'));
      }
      setItems((prev) =>
        prev.map((current) =>
          current.id === item.id ? { ...current, ...payload.item! } : current
        )
      );
    } catch (error) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
      Alert.alert(
        t('catalog.errStockTitle'),
        error instanceof Error ? error.message : t('common.tryAgain')
      );
      void reloadCatalogItemsSilently(activeShop?.id ?? item.shop_id);
    }
  };

  const handleQuickAddItem = async () => {
    if (!canManageCatalog || !activeShop || isAddingItem) return;
    const trimmedName = newItemName.trim();
    if (!trimmedName) {
      Alert.alert(t('catalog.errAddItemTitle'), t('catalog.errInvalidNameDesc'));
      return;
    }

    const cleanedPrice = newItemPrice.trim().replace(/[^0-9]/g, '');
    const parsedPrice = Number(cleanedPrice);
    if (!cleanedPrice || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      Alert.alert(
        t('catalog.errAddItemTitle'),
        t('catalog.errInvalidPriceDesc')
      );
      return;
    }

    const targetCatId =
      selectedCategoryId !== 'all' ? selectedCategoryId : categories[0]?.id;

    if (!targetCatId) {
      Alert.alert(t('catalog.errNoCatTitle'), t('catalog.errNoCatDesc'));
      return;
    }

    const stockNum =
      newItemStock.trim() === ''
        ? null
        : Math.max(0, Number(newItemStock.replace(/[^0-9]/g, '')));

    setIsAddingItem(true);
    try {
      const res = await fetchApi('/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            shop_id: activeShop.id,
            category_id: targetCatId,
            price: parsedPrice,
            stock_quantity: stockNum,
            is_available: stockNum !== 0,
            is_featured: false,
            name_i18n: {
              vi: trimmedName,
              en: trimmedName,
            },
            desc_i18n: { vi: '' },
          },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (!data.item || typeof data.item.id !== 'string') {
          throw new Error(t('common.tryAgain'));
        }
        setItems((prev) => [...prev, data.item]);
        setNewItemName('');
        setNewItemPrice('');
        setNewItemStock('');
        return;
      }
    } catch (error) {
      Alert.alert(
        t('catalog.errAddItemTitle'),
        error instanceof Error ? error.message : t('common.tryAgain')
      );
    } finally {
      setIsAddingItem(false);
    }
  };

  return (
    <View style={styles.sectionStack}>
      {/* Quick Add Bar */}
      {canManageCatalog && (
        <View
          style={[
            styles.card,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.cardHeading, { color: theme.text }]}>
            {t('catalog.quickAddHeading')}
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
              placeholder={t('catalog.namePlaceholder')}
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
              placeholder={t('catalog.pricePlaceholder')}
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
              placeholder={t('catalog.stockPlaceholder')}
              placeholderTextColor={theme.subText}
              keyboardType="numeric"
              value={newItemStock}
              onChangeText={setNewItemStock}
            />
            <TouchableOpacity
              style={[styles.addBtn, isAddingItem && { opacity: 0.6 }]}
              onPress={handleQuickAddItem}
              disabled={isAddingItem}
            >
              <Text style={styles.addBtnText}>{t('catalog.addBtn')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

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
            {t('catalog.filterAll', { count: items.length })}
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
          item.stock_quantity === undefined ? null : item.stock_quantity;
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
                {t('catalog.itemEnSold', {
                  enName: item.name_i18n?.en || '—',
                  sold: item.sold_count || 0,
                })}
              </Text>

              {/* Price Row */}
              <View style={styles.priceRow}>
                <Text style={styles.priceBadge}>{formatVnd(item.price)}</Text>
                {canManageCatalog && (
                  <>
                    <TouchableOpacity
                      style={[
                        styles.priceStepBtn,
                        { backgroundColor: theme.subCard },
                      ]}
                      onPress={() => handleUpdateItemPrice(item, -5000)}
                    >
                      <Text
                        style={[styles.priceStepText, { color: theme.text }]}
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
                        style={[styles.priceStepText, { color: theme.text }]}
                      >
                        +5k
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
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
                    {t('catalog.stockLabel', {
                      stock: stock === null ? '∞' : stock,
                    })}
                  </Text>
                </View>
                <TouchableOpacity
                  disabled={stock === null || stock <= 0}
                  style={[
                    styles.priceStepBtn,
                    { backgroundColor: theme.subCard },
                    (stock === null || stock <= 0) && { opacity: 0.45 },
                  ]}
                  onPress={() => {
                    if (typeof stock !== 'number') return;
                    handleUpdateItemStock(item, Math.max(0, stock - 1));
                  }}
                >
                  <Text style={[styles.priceStepText, { color: theme.text }]}>
                    -1
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={stock === null}
                  style={[
                    styles.priceStepBtn,
                    { backgroundColor: theme.subCard },
                    stock === null && { opacity: 0.45 },
                  ]}
                  onPress={() => {
                    if (typeof stock !== 'number') return;
                    handleUpdateItemStock(item, stock + 5);
                  }}
                >
                  <Text style={[styles.priceStepText, { color: theme.text }]}>
                    +5
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.priceStepBtn,
                    { backgroundColor: theme.subCard },
                    stock === null && {
                      backgroundColor: '#ecfdf5',
                      borderWidth: 1,
                      borderColor: '#10b981',
                    },
                  ]}
                  onPress={() =>
                    handleUpdateItemStock(item, stock === null ? 20 : null)
                  }
                >
                  <Text
                    style={[
                      styles.priceStepText,
                      { color: stock === null ? '#059669' : theme.text },
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
                {item.is_available
                  ? t('catalog.statusInStock')
                  : t('catalog.statusSoldOut')}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
});
