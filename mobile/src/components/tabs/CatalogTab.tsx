import React, { memo, useState } from 'react';
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

interface CatalogTabProps {
  activeShop: MobileShop | null;
  categories: MobileCategory[];
  items: MobileCatalogItem[];
  setItems: React.Dispatch<React.SetStateAction<MobileCatalogItem[]>>;
  onReloadShopData: (shopId?: string) => void;
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
  // Local state isolated inside CatalogTab so typing never triggers re-renders on other tabs!
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemStock, setNewItemStock] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');

  const visibleItems =
    selectedCategoryId === 'all'
      ? items
      : items.filter((i) => i.category_id === selectedCategoryId);

  const handleToggleItemAvailability = async (item: MobileCatalogItem) => {
    if (!canManageCatalog && !canAdjustInventory) return;
    const nextVal = !item.is_available;
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, is_available: nextVal } : i))
    );

    try {
      await fetchApi('/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...item,
            is_available: nextVal,
          },
        }),
      });
    } catch (error) {
      Alert.alert(
        'Lỗi cập nhật',
        error instanceof Error ? error.message : 'Vui lòng thử lại'
      );
      onReloadShopData(activeShop?.id);
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
      await fetchApi('/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert_item',
          item: {
            ...item,
            price: nextPrice,
          },
        }),
      });
    } catch (error) {
      Alert.alert(
        'Không thể cập nhật giá',
        error instanceof Error ? error.message : 'Vui lòng thử lại'
      );
      onReloadShopData(activeShop?.id);
    }
  };

  const handleUpdateItemStock = async (
    item: MobileCatalogItem,
    nextStock: number | null
  ) => {
    if (!canAdjustInventory && !canManageCatalog) return;
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
      await fetchApi('/api/catalog', {
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
    } catch (error) {
      Alert.alert('Không thể cập nhật tồn', error instanceof Error ? error.message : 'Vui lòng thử lại');
      onReloadShopData(activeShop?.id);
    }
  };

  const handleQuickAddItem = async () => {
    if (!canManageCatalog) return;
    if (!activeShop || !newItemName.trim()) return;
    const targetCatId =
      selectedCategoryId !== 'all' ? selectedCategoryId : categories[0]?.id;

    if (!targetCatId) {
      Alert.alert('Chưa có danh mục', 'Vui lòng tạo danh mục trước.');
      return;
    }

    const cleanedPrice = newItemPrice.replace(/[^0-9]/g, '');
    const parsedPrice = Number(cleanedPrice);
    const priceNum =
      cleanedPrice !== '' && Number.isFinite(parsedPrice)
        ? Math.max(0, parsedPrice)
        : 35000;
    const stockNum =
      newItemStock.trim() === ''
        ? null
        : Math.max(0, Number(newItemStock.replace(/[^0-9]/g, '')));

    try {
      const res = await fetchApi('/api/catalog', {
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
    } catch (error) {
      Alert.alert('Không thể thêm món', error instanceof Error ? error.message : 'Vui lòng thử lại');
    }
  };

  return (
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
          <TouchableOpacity style={styles.addBtn} onPress={handleQuickAddItem}>
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
                EN: {item.name_i18n?.en || '—'} • Đã bán: {item.sold_count || 0}
              </Text>

              {/* Price Row */}
              <View style={styles.priceRow}>
                <Text style={styles.priceBadge}>{formatVnd(item.price)}</Text>
                <TouchableOpacity
                  style={[
                    styles.priceStepBtn,
                    { backgroundColor: theme.subCard },
                  ]}
                  onPress={() => handleUpdateItemPrice(item, -5000)}
                >
                  <Text style={[styles.priceStepText, { color: theme.text }]}>
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
                  <Text style={[styles.priceStepText, { color: theme.text }]}>
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
                    handleUpdateItemStock(item, Math.max(0, (stock ?? 10) - 1))
                  }
                >
                  <Text style={[styles.priceStepText, { color: theme.text }]}>
                    -1
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.priceStepBtn,
                    { backgroundColor: theme.subCard },
                  ]}
                  onPress={() => handleUpdateItemStock(item, (stock ?? 0) + 5)}
                >
                  <Text style={[styles.priceStepText, { color: theme.text }]}>
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
                  <Text style={[styles.priceStepText, { color: theme.text }]}>
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
  );
});
