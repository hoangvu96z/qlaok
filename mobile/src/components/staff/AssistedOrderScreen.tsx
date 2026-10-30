import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MobileThemePalette } from '../../styles/mobileStyles';
import { useMobileI18n } from '../MobileI18nProvider';
import {
  AssistedOrderPayload,
  buildAssistedOrderPayload,
  calculateCartItemCount,
  calculateCartSubtotal,
  calculateLineExtraPrice,
  calculateLineTotal,
  calculateLineUnitPrice,
  createCartLine,
  createTableSelection,
  createTakeawaySelection,
  filterActiveTables,
  generateAssistedOrderIdempotencyKey,
  getDefaultOptionChoices,
  isTakeawaySelection,
  removeCartLine,
  resolveI18nText,
  StaffCartLine,
  StaffCatalogItem,
  StaffCategory,
  StaffOptionChoice,
  StaffOptionGroup,
  StaffTable,
  StaffTableSelection,
  toggleOptionChoice,
  updateCartLineQuantity,
  validateAssistedOrderDraft,
  validateItemRequiredOptions,
} from '../../lib/staff-ordering';

export interface AssistedOrderScreenProps {
  shopId: string;
  shopName: string;
  tables: StaffTable[];
  categories: StaffCategory[];
  items: StaffCatalogItem[];
  submitting?: boolean;
  onSubmit: (payload: AssistedOrderPayload) => Promise<void>;
  idempotencyKey?: string;
  onCancel?: () => void;
  initialTableId?: string | null;
  theme?: MobileThemePalette;
}

const DEFAULT_THEME: MobileThemePalette = {
  bg: '#f8fafc',
  card: '#ffffff',
  subCard: '#f1f5f9',
  border: '#e2e8f0',
  text: '#0f172a',
  subText: '#64748b',
};

function formatVndPreview(amount: number): string {
  return `${Number(amount || 0).toLocaleString('vi-VN')}đ`;
}

export const AssistedOrderScreen = memo(function AssistedOrderScreen({
  shopId,
  shopName,
  tables,
  categories,
  items,
  submitting = false,
  onSubmit,
  idempotencyKey,
  onCancel,
  initialTableId,
  theme = DEFAULT_THEME,
}: AssistedOrderScreenProps) {
  const { locale, tb } = useMobileI18n();

  // Active tables list (filtering out archived / inactive)
  const activeTables = useMemo(() => filterActiveTables(tables), [tables]);

  // Initial table selection
  const [selectedTable, setSelectedTable] = useState<StaffTableSelection | null>(() => {
    if (initialTableId) {
      const match = tables.find((t) => t.id === initialTableId && t.is_active !== false && !t.is_archived);
      if (match) return createTableSelection(match);
    }
    return null;
  });

  // State: Cart lines
  const [cart, setCart] = useState<StaffCartLine[]>([]);

  // State: Category and Search filters
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // State: Modals
  const [isTablePickerOpen, setIsTablePickerOpen] = useState<boolean>(false);
  const [isCartReviewOpen, setIsCartReviewOpen] = useState<boolean>(false);

  // State: Item Option Customizer Modal
  const [activeConfigItem, setActiveConfigItem] = useState<StaffCatalogItem | null>(null);
  const [configQuantity, setConfigQuantity] = useState<number>(1);
  const [configChoices, setConfigChoices] = useState<StaffOptionChoice[]>([]);
  const [configNote, setConfigNote] = useState<string>('');
  const [configError, setConfigError] = useState<string>('');

  // State: Submission feedback & Success Modal
  const [submissionError, setSubmissionError] = useState<string>('');
  const [successOrderSummary, setSuccessOrderSummary] = useState<{
    tableLabel: string;
    totalPreview: number;
    itemCount: number;
  } | null>(null);

  // Stable idempotency key fallback per session/order attempt
  const localIdempKeyRef = useRef<string>(generateAssistedOrderIdempotencyKey(shopId));

  // Filtered categories (only active or with items)
  const activeCategories = useMemo(() => {
    return (categories || []).filter((c) => c && c.is_active !== false);
  }, [categories]);

  // Filtered catalog items based on category and search query
  const filteredItems = useMemo(() => {
    let result = (items || []).filter((i) => i && i.is_available !== false);

    if (selectedCategoryId !== 'all') {
      result = result.filter((i) => i.category_id === selectedCategoryId);
    }

    const query = searchQuery.trim().toLowerCase();
    if (query) {
      result = result.filter((i) => {
        const nameVi = (i.name_i18n?.vi || '').toLowerCase();
        const nameEn = (i.name_i18n?.en || '').toLowerCase();
        const localized = resolveI18nText(i.name_i18n, locale).toLowerCase();
        return nameVi.includes(query) || nameEn.includes(query) || localized.includes(query);
      });
    }

    return result;
  }, [items, selectedCategoryId, searchQuery, locale]);

  // Cart metrics
  const cartSubtotal = useMemo(() => calculateCartSubtotal(cart), [cart]);
  const cartItemCount = useMemo(() => calculateCartItemCount(cart), [cart]);

  // Handle open item customizer
  const handleOpenItemConfig = useCallback(
    (item: StaffCatalogItem) => {
      setActiveConfigItem(item);
      setConfigQuantity(1);
      setConfigChoices(getDefaultOptionChoices(item));
      setConfigNote('');
      setConfigError('');
    },
    []
  );

  // Handle option choice toggle in customizer
  const handleToggleChoice = useCallback(
    (group: StaffOptionGroup, choice: StaffOptionChoice) => {
      setConfigChoices((prev) => toggleOptionChoice(prev, group, choice));
      setConfigError('');
    },
    []
  );

  // Confirm adding item to cart
  const handleConfirmAddToCart = useCallback(() => {
    if (!activeConfigItem) return;

    // Validate required option groups
    const check = validateItemRequiredOptions(activeConfigItem, configChoices);
    if (!check.valid) {
      const missingGroupNames = check.missingGroups
        .map((g) => resolveI18nText(g.name_i18n, locale))
        .join(', ');
      setConfigError(
        tb(
          `Vui lòng chọn tùy chọn bắt buộc: ${missingGroupNames}`,
          `Please select required options: ${missingGroupNames}`
        )
      );
      return;
    }

    const newLine = createCartLine(
      activeConfigItem,
      configQuantity,
      configChoices,
      configNote
    );

    setCart((prev) => [...prev, newLine]);
    setActiveConfigItem(null);
    setConfigError('');
  }, [activeConfigItem, configChoices, configQuantity, configNote, locale, tb]);

  // Handle cart line quantity changes
  const handleUpdateLineQty = useCallback((lineId: string, delta: number) => {
    setCart((prev) => {
      const target = prev.find((l) => l.lineId === lineId);
      if (!target) return prev;
      return updateCartLineQuantity(prev, lineId, target.quantity + delta);
    });
  }, []);

  // Handle cart line removal
  const handleRemoveLine = useCallback((lineId: string) => {
    setCart((prev) => removeCartLine(prev, lineId));
  }, []);

  // Handle submitting order
  const handleSubmitOrder = useCallback(async () => {
    setSubmissionError('');

    // Pre-validate table selection
    if (!selectedTable) {
      setSubmissionError(
        tb(
          'Vui lòng chọn bàn đang phục vụ hoặc chọn Mang về trước khi gửi đơn.',
          'Please select a table or Takeaway before sending the order.'
        )
      );
      setIsTablePickerOpen(true);
      return;
    }

    // Pre-validate cart
    if (cart.length === 0) {
      setSubmissionError(
        tb('Giỏ hàng đang trống. Vui lòng chọn món trước.', 'Cart is empty. Please select items first.')
      );
      return;
    }

    const activeIdempKey = idempotencyKey?.trim() || localIdempKeyRef.current;

    // Full draft validation
    const draftValidation = validateAssistedOrderDraft({
      shopId,
      table: selectedTable,
      cart,
      idempotencyKey: activeIdempKey,
    });

    if (!draftValidation.ok) {
      setSubmissionError(
        locale === 'en' ? draftValidation.message.en : draftValidation.message.vi
      );
      return;
    }

    try {
      const payload = buildAssistedOrderPayload({
        shopId,
        table: selectedTable,
        cart,
        idempotencyKey: activeIdempKey,
        visitorLang: locale,
      });

      // Invoke parent submission callback
      await onSubmit(payload);

      // On success: capture summary, clear cart, close review, show confirmation
      setSuccessOrderSummary({
        tableLabel: selectedTable.tableLabel,
        totalPreview: cartSubtotal,
        itemCount: cartItemCount,
      });
      setCart([]);
      setIsCartReviewOpen(false);
      setSubmissionError('');
      // Generate fresh idempotency key for the next order
      localIdempKeyRef.current = generateAssistedOrderIdempotencyKey(shopId);
    } catch (err) {
      // On failure: KEEP CART INTACT and display clear error message
      const msg =
        err instanceof Error && err.message
          ? err.message
          : tb('Không thể gửi đơn hàng. Vui lòng thử lại.', 'Failed to submit order. Please try again.');
      setSubmissionError(msg);
    }
  }, [
    selectedTable,
    cart,
    idempotencyKey,
    shopId,
    locale,
    onSubmit,
    cartSubtotal,
    cartItemCount,
    tb,
  ]);

  // Start fresh order for next guest
  const handleStartNewOrder = useCallback(() => {
    setSuccessOrderSummary(null);
    setCart([]);
    setSelectedTable(null);
    setSubmissionError('');
    localIdempKeyRef.current = generateAssistedOrderIdempotencyKey(shopId);
  }, [shopId]);

  return (
    <SafeAreaView style={[compStyles.safeArea, { backgroundColor: theme.bg }]}>
      <KeyboardAvoidingView
        style={compStyles.flex1}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Top Header */}
        <View style={[compStyles.headerBar, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={compStyles.headerLeft}>
            {onCancel && (
              <TouchableOpacity
                onPress={onCancel}
                style={compStyles.backBtn}
                accessibilityRole="button"
                accessibilityLabel={tb('Quay lại', 'Go back')}
              >
                <Ionicons name="arrow-back" size={20} color={theme.text} />
              </TouchableOpacity>
            )}
            <View>
              <Text style={[compStyles.shopNameText, { color: theme.text }]} numberOfLines={1}>
                {shopName || tb('Hỗ trợ gọi món tại bàn', 'Assisted Table Order')}
              </Text>
              <View style={compStyles.unpaidTagRow}>
                <Ionicons name="receipt-outline" size={12} color="#0284c7" />
                <Text style={compStyles.unpaidTagText}>
                  {tb('Đơn gửi Bếp/Quầy • Chưa thanh toán', 'Sent to Kitchen/Counter • Unpaid')}
                </Text>
              </View>
            </View>
          </View>

          {/* Prominent Table Picker Trigger */}
          <TouchableOpacity
            style={[
              compStyles.tableSelectorBtn,
              selectedTable
                ? compStyles.tableSelectorBtnActive
                : compStyles.tableSelectorBtnMissing,
            ]}
            onPress={() => setIsTablePickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={tb('Chọn bàn phục vụ', 'Select service table')}
          >
            <Ionicons
              name={isTakeawaySelection(selectedTable) ? 'bag-handle-outline' : 'restaurant-outline'}
              size={15}
              color={selectedTable ? '#065f46' : '#991b1b'}
            />
            <Text
              style={[
                compStyles.tableSelectorBtnText,
                { color: selectedTable ? '#065f46' : '#991b1b' },
              ]}
              numberOfLines={1}
            >
              {selectedTable ? selectedTable.tableLabel : tb('Chọn bàn *', 'Select table *')}
            </Text>
            <Ionicons
              name="chevron-down"
              size={13}
              color={selectedTable ? '#065f46' : '#991b1b'}
            />
          </TouchableOpacity>
        </View>

        {/* Informative Guidance Banner */}
        <View style={compStyles.infoBanner}>
          <Ionicons name="information-circle" size={15} color="#0369a1" />
          <Text style={compStyles.infoBannerText}>
            {tb(
              'Nhân viên ghi món hộ khách. Đơn tạo sẽ được gửi tới bếp/quầy và giữ nguyên chưa thanh toán.',
              'Staff placing order for guest. Order is sent unpaid to kitchen/counter.'
            )}
          </Text>
        </View>

        {/* Search Bar */}
        <View style={[compStyles.searchBarContainer, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Ionicons name="search-outline" size={16} color={theme.subText} style={compStyles.searchIcon} />
          <TextInput
            style={[compStyles.searchInput, { color: theme.text }]}
            placeholder={tb('Tìm món theo tên...', 'Search items by name...')}
            placeholderTextColor={theme.subText}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {searchQuery.length > 0 && Platform.OS !== 'ios' && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={compStyles.clearSearchBtn}>
              <Ionicons name="close-circle" size={16} color={theme.subText} />
            </TouchableOpacity>
          )}
        </View>

        {/* Categories Horizontal Bar */}
        <View style={compStyles.categoriesContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={compStyles.categoriesScroll}
          >
            <TouchableOpacity
              style={[
                compStyles.categoryPill,
                selectedCategoryId === 'all' && compStyles.categoryPillActive,
              ]}
              onPress={() => setSelectedCategoryId('all')}
              accessibilityRole="button"
            >
              <Text
                style={[
                  compStyles.categoryPillText,
                  selectedCategoryId === 'all' && compStyles.categoryPillTextActive,
                ]}
              >
                {tb('Tất cả', 'All')} ({items.length})
              </Text>
            </TouchableOpacity>

            {activeCategories.map((cat) => {
              const count = items.filter((i) => i.category_id === cat.id).length;
              const isSelected = selectedCategoryId === cat.id;
              const label = resolveI18nText(cat.name_i18n, locale, 'Danh mục');
              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[
                    compStyles.categoryPill,
                    isSelected && compStyles.categoryPillActive,
                  ]}
                  onPress={() => setSelectedCategoryId(cat.id)}
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      compStyles.categoryPillText,
                      isSelected && compStyles.categoryPillTextActive,
                    ]}
                  >
                    {label} ({count})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Catalog Items List */}
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={compStyles.catalogListContent}
          ListEmptyComponent={
            <View style={compStyles.emptyContainer}>
              <Ionicons name="file-tray-outline" size={38} color={theme.subText} />
              <Text style={[compStyles.emptyText, { color: theme.subText }]}>
                {searchQuery
                  ? tb('Không tìm thấy món phù hợp', 'No matching items found')
                  : tb('Không có món nào trong danh mục này', 'No items in this category')}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const itemName = resolveI18nText(item.name_i18n, locale, 'Món');
            const itemDesc = resolveI18nText(item.desc_i18n, locale, '');
            const hasOptions = Array.isArray(item.options_json) && item.options_json.length > 0;
            const requiredOptionsCount = (item.options_json || []).filter((g) => g.required).length;

            return (
              <View
                style={[
                  compStyles.itemCard,
                  { backgroundColor: theme.card, borderColor: theme.border },
                ]}
              >
                <TouchableOpacity
                  style={compStyles.itemInfoCol}
                  onPress={() => handleOpenItemConfig(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`${itemName}, ${formatVndPreview(item.price)}`}
                >
                  <View style={compStyles.itemNameRow}>
                    <Text style={[compStyles.itemNameText, { color: theme.text }]}>
                      {itemName}
                    </Text>
                    {hasOptions && (
                      <View style={compStyles.optionsBadge}>
                        <Text style={compStyles.optionsBadgeText}>
                          {requiredOptionsCount > 0
                            ? tb(`${requiredOptionsCount} bắt buộc`, `${requiredOptionsCount} required`)
                            : tb('Tùy chọn', 'Options')}
                        </Text>
                      </View>
                    )}
                  </View>

                  {itemDesc ? (
                    <Text style={[compStyles.itemDescText, { color: theme.subText }]} numberOfLines={2}>
                      {itemDesc}
                    </Text>
                  ) : null}

                  <Text style={compStyles.itemPriceText}>{formatVndPreview(item.price)}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={compStyles.itemAddBtn}
                  onPress={() => handleOpenItemConfig(item)}
                  accessibilityRole="button"
                  accessibilityLabel={tb('Chọn món', 'Choose item')}
                >
                  <Ionicons name="add" size={18} color="#ffffff" />
                  <Text style={compStyles.itemAddBtnText}>{tb('Chọn', 'Add')}</Text>
                </TouchableOpacity>
              </View>
            );
          }}
        />

        {/* Floating Cart Review Bar */}
        {cart.length > 0 && (
          <View style={[compStyles.floatingCartBar, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={compStyles.cartBarSummary}>
              <View style={compStyles.cartCountBadge}>
                <Ionicons name="cart" size={15} color="#ffffff" />
                <Text style={compStyles.cartCountText}>{cartItemCount}</Text>
              </View>
              <View>
                <Text style={compStyles.cartSubtotalLabel}>
                  {tb('Tạm tính (chưa thanh toán)', 'Estimated (Unpaid)')}
                </Text>
                <Text style={compStyles.cartSubtotalVal}>{formatVndPreview(cartSubtotal)}</Text>
              </View>
            </View>

            <TouchableOpacity
              style={compStyles.openReviewBtn}
              onPress={() => setIsCartReviewOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={tb('Xem lại đơn và gửi', 'Review order and send')}
            >
              <Text style={compStyles.openReviewBtnText}>
                {tb('Xem đơn gọi món', 'Review Order')}
              </Text>
              <Ionicons name="arrow-forward" size={16} color="#020617" />
            </TouchableOpacity>
          </View>
        )}

        {/* MODAL 1: Table Picker Modal */}
        <Modal
          visible={isTablePickerOpen}
          animationType="slide"
          transparent
          onRequestClose={() => setIsTablePickerOpen(false)}
        >
          <View style={compStyles.modalBackdrop}>
            <View style={[compStyles.modalContainer, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={compStyles.modalHeader}>
                <View style={compStyles.modalHeaderTitleRow}>
                  <Ionicons name="restaurant" size={20} color="#10b981" />
                  <Text style={[compStyles.modalTitle, { color: theme.text }]}>
                    {tb('Chọn bàn đang phục vụ', 'Select Service Table')}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setIsTablePickerOpen(false)}
                  style={compStyles.modalCloseBtn}
                  accessibilityRole="button"
                >
                  <Ionicons name="close" size={22} color={theme.subText} />
                </TouchableOpacity>
              </View>

              <Text style={[compStyles.modalSubtitle, { color: theme.subText }]}>
                {tb(
                  'Chọn bàn để bếp và phục vụ biết địa điểm mang món, hoặc chọn Mang về.',
                  'Select table for serving location, or select Takeaway.'
                )}
              </Text>

              <ScrollView style={compStyles.tableModalScroll}>
                {/* Takeaway Option Card */}
                <TouchableOpacity
                  style={[
                    compStyles.tableCard,
                    isTakeawaySelection(selectedTable) && compStyles.tableCardActive,
                  ]}
                  onPress={() => {
                    setSelectedTable(createTakeawaySelection(tb('Mang về', 'Takeaway')));
                    setIsTablePickerOpen(false);
                  }}
                  accessibilityRole="button"
                >
                  <View style={compStyles.tableCardIconBox}>
                    <Ionicons name="bag-handle" size={22} color="#f59e0b" />
                  </View>
                  <View style={compStyles.flex1}>
                    <Text style={[compStyles.tableCardName, { color: theme.text }]}>
                      {tb('Mang về (Takeaway)', 'Takeaway')}
                    </Text>
                    <Text style={[compStyles.tableCardMeta, { color: theme.subText }]}>
                      {tb('Khách không ngồi tại bàn • Đóng gói mang đi', 'No dine-in table • Packed to-go')}
                    </Text>
                  </View>
                  {isTakeawaySelection(selectedTable) && (
                    <Ionicons name="checkmark-circle" size={22} color="#10b981" />
                  )}
                </TouchableOpacity>

                <View style={compStyles.tableDividerRow}>
                  <View style={compStyles.tableDividerLine} />
                  <Text style={[compStyles.tableDividerText, { color: theme.subText }]}>
                    {tb('Bàn tại quán', 'Dine-in tables')}
                  </Text>
                  <View style={compStyles.tableDividerLine} />
                </View>

                {/* Dine-in Tables Grid */}
                {activeTables.length === 0 ? (
                  <View style={compStyles.emptyTablesBox}>
                    <Text style={[compStyles.emptyTablesText, { color: theme.subText }]}>
                      {tb('Chưa có bàn hoạt động', 'No active tables')}
                    </Text>
                  </View>
                ) : (
                  <View style={compStyles.tablesGrid}>
                    {activeTables.map((tbl) => {
                      const isSelected = selectedTable?.tableId === tbl.id;
                      return (
                        <TouchableOpacity
                          key={tbl.id}
                          style={[
                            compStyles.gridTableCard,
                            isSelected && compStyles.gridTableCardActive,
                          ]}
                          onPress={() => {
                            setSelectedTable(createTableSelection(tbl));
                            setIsTablePickerOpen(false);
                          }}
                          accessibilityRole="button"
                        >
                          <Text
                            style={[
                              compStyles.gridTableName,
                              { color: isSelected ? '#065f46' : theme.text },
                            ]}
                            numberOfLines={1}
                          >
                            {tbl.name}
                          </Text>
                          {tbl.section ? (
                            <Text style={compStyles.gridTableSection} numberOfLines={1}>
                              {tbl.section}
                            </Text>
                          ) : null}
                          {isSelected && (
                            <View style={compStyles.gridTableCheck}>
                              <Ionicons name="checkmark" size={12} color="#ffffff" />
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* MODAL 2: Item Option Customizer Modal */}
        <Modal
          visible={Boolean(activeConfigItem)}
          animationType="slide"
          transparent
          onRequestClose={() => setActiveConfigItem(null)}
        >
          <View style={compStyles.modalBackdrop}>
            <View style={[compStyles.modalContainer, { backgroundColor: theme.card, borderColor: theme.border }]}>
              {activeConfigItem && (
                <>
                  <View style={compStyles.modalHeader}>
                    <View style={compStyles.flex1}>
                      <Text style={[compStyles.modalTitle, { color: theme.text }]} numberOfLines={1}>
                        {resolveI18nText(activeConfigItem.name_i18n, locale, 'Món')}
                      </Text>
                      <Text style={compStyles.configBasePrice}>
                        {formatVndPreview(activeConfigItem.price)}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setActiveConfigItem(null)}
                      style={compStyles.modalCloseBtn}
                      accessibilityRole="button"
                    >
                      <Ionicons name="close" size={22} color={theme.subText} />
                    </TouchableOpacity>
                  </View>

                  <ScrollView style={compStyles.configModalScroll}>
                    {/* Option Groups */}
                    {(activeConfigItem.options_json || []).map((grp) => {
                      const grpName = resolveI18nText(grp.name_i18n, locale, 'Tùy chọn');
                      const selectedInGrp = configChoices.filter((c) =>
                        (grp.choices || []).some((gc) => gc.id === c.id)
                      );
                      const isSatisfied = !grp.required || selectedInGrp.length > 0;

                      return (
                        <View key={grp.id} style={compStyles.optionGroupCard}>
                          <View style={compStyles.optionGroupHeader}>
                            <View style={compStyles.flexRowCenter}>
                              <Text style={[compStyles.optionGroupName, { color: theme.text }]}>
                                {grpName}
                              </Text>
                              {grp.required ? (
                                <View style={compStyles.reqBadge}>
                                  <Text style={compStyles.reqBadgeText}>
                                    {tb('Bắt buộc (chọn 1)', 'Required (choose 1)')}
                                  </Text>
                                </View>
                              ) : (
                                <Text style={[compStyles.optBadgeText, { color: theme.subText }]}>
                                  {tb('Tùy chọn', 'Optional')}
                                </Text>
                              )}
                            </View>
                            {!isSatisfied && (
                              <Text style={compStyles.missingReqWarning}>
                                {tb('Chưa chọn', 'Not chosen')}
                              </Text>
                            )}
                          </View>

                          <View style={compStyles.choicesList}>
                            {(grp.choices || []).map((ch) => {
                              const isChoiceSelected = configChoices.some((c) => c.id === ch.id);
                              const choiceLabel = resolveI18nText(ch.label_i18n, locale, ch.id);
                              const extra = Number(ch.extra_price || 0);

                              return (
                                <TouchableOpacity
                                  key={ch.id}
                                  style={[
                                    compStyles.choiceItemRow,
                                    isChoiceSelected && compStyles.choiceItemRowActive,
                                  ]}
                                  onPress={() => handleToggleChoice(grp, ch)}
                                  accessibilityRole="button"
                                >
                                  <View style={compStyles.flexRowCenter}>
                                    <View
                                      style={[
                                        compStyles.choiceSelectorCircle,
                                        isChoiceSelected && compStyles.choiceSelectorCircleActive,
                                      ]}
                                    >
                                      {isChoiceSelected && (
                                        <View style={compStyles.choiceSelectorDot} />
                                      )}
                                    </View>
                                    <Text
                                      style={[
                                        compStyles.choiceLabelText,
                                        { color: isChoiceSelected ? '#065f46' : theme.text },
                                      ]}
                                    >
                                      {choiceLabel}
                                    </Text>
                                  </View>

                                  {extra > 0 ? (
                                    <Text style={compStyles.choiceExtraText}>
                                      +{formatVndPreview(extra)}
                                    </Text>
                                  ) : (
                                    <Text style={[compStyles.choiceExtraFreeText, { color: theme.subText }]}>
                                      +0đ
                                    </Text>
                                  )}
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        </View>
                      );
                    })}

                    {/* Quantity Picker */}
                    <View style={compStyles.quantityRow}>
                      <Text style={[compStyles.quantityLabel, { color: theme.text }]}>
                        {tb('Số lượng', 'Quantity')}
                      </Text>
                      <View style={compStyles.quantityControls}>
                        <TouchableOpacity
                          style={compStyles.qtyBtn}
                          onPress={() => setConfigQuantity((q) => Math.max(1, q - 1))}
                          accessibilityRole="button"
                          accessibilityLabel={tb('Giảm số lượng', 'Decrease quantity')}
                        >
                          <Ionicons name="remove" size={16} color={theme.text} />
                        </TouchableOpacity>
                        <Text style={[compStyles.qtyDisplay, { color: theme.text }]}>
                          {configQuantity}
                        </Text>
                        <TouchableOpacity
                          style={compStyles.qtyBtn}
                          onPress={() => setConfigQuantity((q) => Math.min(99, q + 1))}
                          accessibilityRole="button"
                          accessibilityLabel={tb('Tăng số lượng', 'Increase quantity')}
                        >
                          <Ionicons name="add" size={16} color={theme.text} />
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* Item Custom Note Input */}
                    <View style={compStyles.noteSection}>
                      <Text style={[compStyles.noteLabel, { color: theme.text }]}>
                        {tb('Ghi chú món (VD: ít ngọt, mang riêng...)', 'Item note (e.g. less sweet...)')}
                      </Text>
                      <TextInput
                        style={[
                          compStyles.noteInput,
                          { backgroundColor: theme.subCard, borderColor: theme.border, color: theme.text },
                        ]}
                        placeholder={tb('Nhập ghi chú cho món này...', 'Add note for this item...')}
                        placeholderTextColor={theme.subText}
                        value={configNote}
                        onChangeText={setConfigNote}
                        maxLength={200}
                      />
                    </View>

                    {/* Inline Error Warning */}
                    {configError ? (
                      <View style={compStyles.configErrorBanner}>
                        <Ionicons name="alert-circle" size={16} color="#b91c1c" />
                        <Text style={compStyles.configErrorText}>{configError}</Text>
                      </View>
                    ) : null}
                  </ScrollView>

                  {/* Bottom Confirm Action */}
                  <View style={[compStyles.configBottomBar, { borderTopColor: theme.border }]}>
                    <View>
                      <Text style={compStyles.configTotalLabel}>
                        {tb('Tạm tính món', 'Item total')}
                      </Text>
                      <Text style={compStyles.configTotalAmount}>
                        {formatVndPreview(
                          calculateLineTotal(activeConfigItem, configChoices, configQuantity)
                        )}
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={compStyles.confirmAddBtn}
                      onPress={handleConfirmAddToCart}
                      accessibilityRole="button"
                    >
                      <Ionicons name="checkmark" size={18} color="#020617" />
                      <Text style={compStyles.confirmAddBtnText}>
                        {tb('Thêm vào đơn', 'Add to Order')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>

        {/* MODAL 3: Cart Review and Submit Sheet */}
        <Modal
          visible={isCartReviewOpen}
          animationType="slide"
          transparent
          onRequestClose={() => setIsCartReviewOpen(false)}
        >
          <View style={compStyles.modalBackdrop}>
            <View style={[compStyles.modalContainerLarge, { backgroundColor: theme.card, borderColor: theme.border }]}>
              {/* Review Header */}
              <View style={compStyles.modalHeader}>
                <View style={compStyles.flex1}>
                  <Text style={[compStyles.modalTitle, { color: theme.text }]}>
                    {tb('Xem lại đơn gọi món', 'Review Assisted Order')}
                  </Text>
                  <Text style={[compStyles.modalSubtitle, { color: theme.subText }]}>
                    {tb(
                      'Kiểm tra lại danh sách món và bàn phục vụ trước khi gửi.',
                      'Check items and table before sending to kitchen/counter.'
                    )}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setIsCartReviewOpen(false)}
                  style={compStyles.modalCloseBtn}
                  accessibilityRole="button"
                >
                  <Ionicons name="close" size={22} color={theme.subText} />
                </TouchableOpacity>
              </View>

              {/* Selected Table Prominent Banner */}
              <View
                style={[
                  compStyles.reviewTableBox,
                  !selectedTable && compStyles.reviewTableBoxMissing,
                ]}
              >
                <View style={compStyles.flexRowCenter}>
                  <Ionicons
                    name={isTakeawaySelection(selectedTable) ? 'bag-handle' : 'restaurant'}
                    size={18}
                    color={selectedTable ? '#065f46' : '#991b1b'}
                  />
                  <View style={compStyles.marginLeft8}>
                    <Text style={compStyles.reviewTableLabel}>
                      {tb('Địa điểm phục vụ:', 'Service location:')}
                    </Text>
                    <Text style={[compStyles.reviewTableName, { color: selectedTable ? '#065f46' : '#991b1b' }]}>
                      {selectedTable ? selectedTable.tableLabel : tb('Chưa chọn bàn!', 'No table selected!')}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={compStyles.changeTableBtn}
                  onPress={() => setIsTablePickerOpen(true)}
                  accessibilityRole="button"
                >
                  <Text style={compStyles.changeTableBtnText}>
                    {selectedTable ? tb('Đổi bàn', 'Change') : tb('Chọn bàn ngay', 'Select now')}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Unpaid Notice */}
              <View style={compStyles.reviewNoticeBox}>
                <Ionicons name="information-circle" size={16} color="#0369a1" />
                <Text style={compStyles.reviewNoticeText}>
                  {tb(
                    'Đơn hàng sẽ được gửi tới Bếp/Quầy ở trạng thái CHƯA THANH TOÁN. Thu ngân sẽ thu tiền riêng.',
                    'Order will be sent UNPAID to Kitchen/Counter. Cashier will collect payment separately.'
                  )}
                </Text>
              </View>

              {/* Submission Error Banner */}
              {submissionError ? (
                <View style={compStyles.submissionErrorBox}>
                  <Ionicons name="warning" size={16} color="#b91c1c" />
                  <Text style={compStyles.submissionErrorText}>{submissionError}</Text>
                </View>
              ) : null}

              {/* Cart Items List */}
              <ScrollView style={compStyles.reviewListScroll}>
                {cart.map((line) => {
                  const lineName = resolveI18nText(line.item.name_i18n, locale, 'Món');
                  const lineExtra = calculateLineExtraPrice(line.selectedChoices);
                  const lineUnitPrice = calculateLineUnitPrice(line.item);
                  const lineTotal = (lineUnitPrice + lineExtra) * line.quantity;

                  return (
                    <View
                      key={line.lineId}
                      style={[compStyles.reviewLineCard, { backgroundColor: theme.subCard, borderColor: theme.border }]}
                    >
                      <View style={compStyles.reviewLineTop}>
                        <View style={compStyles.flex1}>
                          <Text style={[compStyles.reviewLineName, { color: theme.text }]}>
                            {lineName}
                          </Text>
                          <Text style={[compStyles.reviewLinePrice, { color: theme.subText }]}>
                            {formatVndPreview(lineUnitPrice)}
                            {lineExtra > 0 ? ` (+${formatVndPreview(lineExtra)})` : ''}
                          </Text>
                        </View>
                        <Text style={compStyles.reviewLineTotal}>
                          {formatVndPreview(lineTotal)}
                        </Text>
                      </View>

                      {/* Options breakdown */}
                      {line.selectedChoices.length > 0 && (
                        <View style={compStyles.reviewChoicesWrap}>
                          {line.selectedChoices.map((c) => (
                            <View key={c.id} style={compStyles.reviewChoiceChip}>
                              <Text style={compStyles.reviewChoiceChipText}>
                                {resolveI18nText(c.label_i18n, locale, c.id)}
                                {Number(c.extra_price || 0) > 0 ? ` (+${formatVndPreview(c.extra_price)})` : ''}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}

                      {/* Custom note */}
                      {line.customNote ? (
                        <View style={compStyles.reviewLineNoteRow}>
                          <Ionicons name="chatbubble-ellipses-outline" size={12} color="#64748b" />
                          <Text style={compStyles.reviewLineNoteText}>
                            {line.customNote}
                          </Text>
                        </View>
                      ) : null}

                      {/* Quantity & Remove controls */}
                      <View style={compStyles.reviewLineActions}>
                        <TouchableOpacity
                          style={compStyles.removeLineBtn}
                          onPress={() => handleRemoveLine(line.lineId)}
                          accessibilityRole="button"
                          accessibilityLabel={tb('Xóa món', 'Remove item')}
                        >
                          <Ionicons name="trash-outline" size={14} color="#dc2626" />
                          <Text style={compStyles.removeLineBtnText}>{tb('Xóa', 'Remove')}</Text>
                        </TouchableOpacity>

                        <View style={compStyles.quantityControls}>
                          <TouchableOpacity
                            style={compStyles.qtyBtnSmall}
                            onPress={() => handleUpdateLineQty(line.lineId, -1)}
                            accessibilityRole="button"
                          >
                            <Ionicons name="remove" size={14} color={theme.text} />
                          </TouchableOpacity>
                          <Text style={[compStyles.qtyDisplaySmall, { color: theme.text }]}>
                            {line.quantity}
                          </Text>
                          <TouchableOpacity
                            style={compStyles.qtyBtnSmall}
                            onPress={() => handleUpdateLineQty(line.lineId, 1)}
                            accessibilityRole="button"
                          >
                            <Ionicons name="add" size={14} color={theme.text} />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>

              {/* Bottom Summary & Submit Action */}
              <View style={[compStyles.reviewBottomBar, { borderTopColor: theme.border }]}>
                <View style={compStyles.reviewSubtotalRow}>
                  <Text style={[compStyles.reviewSubtotalLabel, { color: theme.subText }]}>
                    {tb('Tổng tạm tính (Chưa thanh toán):', 'Estimated Total (Unpaid):')}
                  </Text>
                  <Text style={compStyles.reviewSubtotalVal}>
                    {formatVndPreview(cartSubtotal)}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[
                    compStyles.submitOrderBtn,
                    (!selectedTable || cart.length === 0 || submitting) && compStyles.submitOrderBtnDisabled,
                  ]}
                  onPress={handleSubmitOrder}
                  disabled={!selectedTable || cart.length === 0 || submitting}
                  accessibilityRole="button"
                  accessibilityLabel={tb('Gửi đơn gọi món cho khách', 'Submit assisted order')}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color="#020617" />
                  ) : (
                    <>
                      <Ionicons name="paper-plane" size={18} color="#020617" />
                      <Text style={compStyles.submitOrderBtnText}>
                        {tb('Gửi đơn gọi món', 'Submit Order')}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* MODAL 4: Success Confirmation Modal */}
        <Modal
          visible={Boolean(successOrderSummary)}
          animationType="fade"
          transparent
          onRequestClose={handleStartNewOrder}
        >
          <View style={compStyles.modalBackdrop}>
            <View style={[compStyles.successCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={compStyles.successIconCircle}>
                <Ionicons name="checkmark" size={36} color="#065f46" />
              </View>

              <Text style={[compStyles.successTitle, { color: theme.text }]}>
                {tb('Đã gửi đơn gọi món thành công!', 'Order Submitted Successfully!')}
              </Text>

              <Text style={[compStyles.successSubtitle, { color: theme.subText }]}>
                {tb(
                  'Đơn đã được chuyển tới Bếp / Quầy pha chế để phục vụ.',
                  'Order has been dispatched to kitchen / counter for preparation.'
                )}
              </Text>

              {successOrderSummary && (
                <View style={[compStyles.successSummaryBox, { backgroundColor: theme.subCard, borderColor: theme.border }]}>
                  <View style={compStyles.successRow}>
                    <Text style={[compStyles.successRowLabel, { color: theme.subText }]}>
                      {tb('Địa điểm:', 'Location:')}
                    </Text>
                    <Text style={[compStyles.successRowVal, { color: theme.text }]}>
                      {successOrderSummary.tableLabel}
                    </Text>
                  </View>

                  <View style={compStyles.successRow}>
                    <Text style={[compStyles.successRowLabel, { color: theme.subText }]}>
                      {tb('Số lượng món:', 'Items count:')}
                    </Text>
                    <Text style={[compStyles.successRowVal, { color: theme.text }]}>
                      {successOrderSummary.itemCount} {tb('món', 'items')}
                    </Text>
                  </View>

                  <View style={compStyles.successRow}>
                    <Text style={[compStyles.successRowLabel, { color: theme.subText }]}>
                      {tb('Tạm tính:', 'Subtotal:')}
                    </Text>
                    <Text style={compStyles.successRowValHighlight}>
                      {formatVndPreview(successOrderSummary.totalPreview)}
                    </Text>
                  </View>

                  <View style={compStyles.successStatusPill}>
                    <Text style={compStyles.successStatusPillText}>
                      {tb('Trạng thái: Chưa thanh toán', 'Status: Unpaid')}
                    </Text>
                  </View>
                </View>
              )}

              <TouchableOpacity
                style={compStyles.newOrderBtn}
                onPress={handleStartNewOrder}
                accessibilityRole="button"
                accessibilityLabel={tb('Tạo đơn cho khách mới', 'Start new guest order')}
              >
                <Text style={compStyles.newOrderBtnText}>
                  {tb('Hỗ trợ đơn khách mới', 'Start New Guest Order')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
});

const compStyles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  flex1: {
    flex: 1,
  },
  flexRowCenter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  marginLeft8: {
    marginLeft: 8,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 8,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  shopNameText: {
    fontSize: 16,
    fontWeight: '800',
  },
  unpaidTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  unpaidTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284c7',
  },
  tableSelectorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    maxWidth: 160,
  },
  tableSelectorBtnActive: {
    backgroundColor: '#ecfdf5',
    borderColor: '#10b981',
  },
  tableSelectorBtnMissing: {
    backgroundColor: '#fef2f2',
    borderColor: '#ef4444',
  },
  tableSelectorBtnText: {
    fontSize: 12,
    fontWeight: '800',
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
  },
  infoBannerText: {
    fontSize: 11,
    color: '#0369a1',
    fontWeight: '600',
    flex: 1,
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 14,
    marginTop: 10,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 8 : 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  clearSearchBtn: {
    padding: 4,
  },
  categoriesContainer: {
    marginBottom: 6,
  },
  categoriesScroll: {
    paddingHorizontal: 14,
    gap: 8,
    paddingVertical: 4,
  },
  categoryPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#e2e8f0',
  },
  categoryPillActive: {
    backgroundColor: '#0f172a',
  },
  categoryPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  categoryPillTextActive: {
    color: '#ffffff',
  },
  catalogListContent: {
    paddingHorizontal: 14,
    paddingBottom: 90,
    gap: 10,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '600',
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
  },
  itemInfoCol: {
    flex: 1,
    gap: 3,
  },
  itemNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  itemNameText: {
    fontSize: 14,
    fontWeight: '800',
  },
  optionsBadge: {
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  optionsBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0369a1',
  },
  itemDescText: {
    fontSize: 11,
    lineHeight: 15,
  },
  itemPriceText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#059669',
    marginTop: 2,
  },
  itemAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    gap: 4,
    minHeight: 44,
    justifyContent: 'center',
  },
  itemAddBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
  },
  floatingCartBar: {
    position: 'absolute',
    bottom: 12,
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  cartBarSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cartCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 4,
  },
  cartCountText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  cartSubtotalLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
  },
  cartSubtotalVal: {
    fontSize: 14,
    fontWeight: '900',
    color: '#059669',
  },
  openReviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10b981',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    gap: 6,
    minHeight: 44,
  },
  openReviewBtnText: {
    color: '#020617',
    fontSize: 13,
    fontWeight: '900',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    maxHeight: '85%',
    padding: 16,
  },
  modalContainerLarge: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    maxHeight: '92%',
    padding: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
  modalHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  modalSubtitle: {
    fontSize: 12,
    marginTop: 2,
    marginBottom: 10,
  },
  modalCloseBtn: {
    padding: 4,
  },
  tableModalScroll: {
    maxHeight: 380,
  },
  tableCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    marginBottom: 8,
    gap: 12,
  },
  tableCardActive: {
    borderColor: '#10b981',
    backgroundColor: '#ecfdf5',
  },
  tableCardIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#fef3c7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableCardName: {
    fontSize: 14,
    fontWeight: '800',
  },
  tableCardMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  tableDividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
    gap: 8,
  },
  tableDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e2e8f0',
  },
  tableDividerText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  emptyTablesBox: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyTablesText: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  tablesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 20,
  },
  gridTableCard: {
    width: '31%',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    position: 'relative',
    minHeight: 55,
    justifyContent: 'center',
  },
  gridTableCardActive: {
    borderColor: '#10b981',
    backgroundColor: '#ecfdf5',
  },
  gridTableName: {
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  gridTableSection: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 2,
  },
  gridTableCheck: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  configBasePrice: {
    fontSize: 14,
    fontWeight: '800',
    color: '#059669',
    marginTop: 2,
  },
  configModalScroll: {
    maxHeight: 400,
    marginVertical: 10,
  },
  optionGroupCard: {
    marginBottom: 14,
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  optionGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  optionGroupName: {
    fontSize: 13,
    fontWeight: '800',
    marginRight: 6,
  },
  reqBadge: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  reqBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#b91c1c',
  },
  optBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  missingReqWarning: {
    fontSize: 11,
    fontWeight: '700',
    color: '#b91c1c',
  },
  choicesList: {
    gap: 6,
  },
  choiceItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  choiceItemRowActive: {
    backgroundColor: '#ecfdf5',
    borderColor: '#10b981',
  },
  choiceSelectorCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#94a3b8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  choiceSelectorCircleActive: {
    borderColor: '#10b981',
  },
  choiceSelectorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#10b981',
  },
  choiceLabelText: {
    fontSize: 12,
    fontWeight: '700',
  },
  choiceExtraText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#059669',
  },
  choiceExtraFreeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    marginTop: 6,
  },
  quantityLabel: {
    fontSize: 13,
    fontWeight: '800',
  },
  quantityControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  qtyBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyDisplay: {
    fontSize: 15,
    fontWeight: '900',
    minWidth: 24,
    textAlign: 'center',
  },
  qtyBtnSmall: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyDisplaySmall: {
    fontSize: 13,
    fontWeight: '900',
    minWidth: 20,
    textAlign: 'center',
  },
  noteSection: {
    marginTop: 8,
    marginBottom: 10,
  },
  noteLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  noteInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 12,
  },
  configErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    padding: 10,
    borderRadius: 10,
    gap: 8,
    marginBottom: 8,
  },
  configErrorText: {
    fontSize: 11,
    color: '#b91c1c',
    fontWeight: '700',
    flex: 1,
  },
  configBottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
  },
  configTotalLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
  },
  configTotalAmount: {
    fontSize: 15,
    fontWeight: '900',
    color: '#059669',
  },
  confirmAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10b981',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 6,
    minHeight: 44,
  },
  confirmAddBtnText: {
    color: '#020617',
    fontSize: 13,
    fontWeight: '900',
  },
  reviewTableBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ecfdf5',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#10b981',
    marginBottom: 10,
  },
  reviewTableBoxMissing: {
    backgroundColor: '#fef2f2',
    borderColor: '#ef4444',
  },
  reviewTableLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
  },
  reviewTableName: {
    fontSize: 14,
    fontWeight: '900',
  },
  changeTableBtn: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  changeTableBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  reviewNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e0f2fe',
    padding: 10,
    borderRadius: 10,
    gap: 8,
    marginBottom: 10,
  },
  reviewNoticeText: {
    fontSize: 11,
    color: '#0369a1',
    fontWeight: '600',
    flex: 1,
  },
  submissionErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    padding: 10,
    borderRadius: 10,
    gap: 8,
    marginBottom: 10,
  },
  submissionErrorText: {
    fontSize: 11,
    color: '#b91c1c',
    fontWeight: '700',
    flex: 1,
  },
  reviewListScroll: {
    maxHeight: 280,
  },
  reviewLineCard: {
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  reviewLineTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  reviewLineName: {
    fontSize: 13,
    fontWeight: '800',
  },
  reviewLinePrice: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  reviewLineTotal: {
    fontSize: 13,
    fontWeight: '800',
    color: '#059669',
  },
  reviewChoicesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
  },
  reviewChoiceChip: {
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  reviewChoiceChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#334155',
  },
  reviewLineNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  reviewLineNoteText: {
    fontSize: 11,
    fontStyle: 'italic',
    color: '#64748b',
  },
  reviewLineActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  removeLineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  removeLineBtnText: {
    fontSize: 11,
    color: '#dc2626',
    fontWeight: '700',
  },
  reviewBottomBar: {
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 10,
  },
  reviewSubtotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reviewSubtotalLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  reviewSubtotalVal: {
    fontSize: 16,
    fontWeight: '900',
    color: '#059669',
  },
  submitOrderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10b981',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
    minHeight: 48,
  },
  submitOrderBtnDisabled: {
    backgroundColor: '#94a3b8',
    opacity: 0.6,
  },
  submitOrderBtnText: {
    color: '#020617',
    fontSize: 14,
    fontWeight: '900',
  },
  successCard: {
    margin: 20,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    alignItems: 'center',
    gap: 12,
  },
  successIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#d1fae5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: {
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
  },
  successSubtitle: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
  },
  successSummaryBox: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 8,
    marginVertical: 4,
  },
  successRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  successRowLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  successRowVal: {
    fontSize: 12,
    fontWeight: '800',
  },
  successRowValHighlight: {
    fontSize: 14,
    fontWeight: '900',
    color: '#059669',
  },
  successStatusPill: {
    backgroundColor: '#fef3c7',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  successStatusPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#b45309',
  },
  newOrderBtn: {
    width: '100%',
    backgroundColor: '#0f172a',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    minHeight: 48,
  },
  newOrderBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
});
