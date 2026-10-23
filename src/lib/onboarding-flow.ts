import { type AppLocale, bilingualText } from '@/lib/app-i18n';
import { formatPlanLimitError } from '@/lib/plan-limits';
import type { BusinessVertical, I18nText } from '@/types/qlaok';

export interface OnboardingDraftShop {
  id: string;
  name?: string;
  slug?: string;
  vertical?: BusinessVertical;
  is_published?: boolean;
  [key: string]: unknown;
}

export interface OnboardingTranslationPayload {
  category_i18n?: I18nText;
  name_i18n?: I18nText;
  desc_i18n?: I18nText;
}

export interface ExecuteOnboardingInput {
  locale: AppLocale;
  ownerId?: string;
  ownerPhone?: string;
  vertical: BusinessVertical;
  shopName: string;
  taglineVi: string;
  city: string;
  address: string;
  phone: string;
  wifiSsid: string;
  wifiPassword: string;
  categoryVi: string;
  firstItemNameVi: string;
  firstItemPrice: string;
  existingDraftShop?: OnboardingDraftShop | null;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  onDraftShopSaved?: (draftShop: OnboardingDraftShop) => void;
}

export type OnboardingExecutionStage =
  | 'validation'
  | 'shop_create'
  | 'catalog_import'
  | 'completed';

export interface ExecuteOnboardingResult {
  ok: boolean;
  stage: OnboardingExecutionStage;
  draftShop: OnboardingDraftShop | null;
  catalogImported: boolean;
  redirectHref: string | null;
  retryAvailable: boolean;
  errorMessage: string;
  serverError: string | null;
}

export function buildOnboardingSlugBase(shopName: string): string {
  return shopName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function buildOnboardingFirstCategoryId(shopId: string): string {
  return `onboarding:${shopId.trim()}:first-category`;
}

export function buildOnboardingFirstItemId(shopId: string): string {
  return `onboarding:${shopId.trim()}:first-item`;
}

export function formatOnboardingBulkImportError(params: {
  locale: AppLocale;
  shopName: string;
  serverError?: string | null;
}): string {
  const { locale, shopName, serverError } = params;
  const trimmedShopName =
    shopName.trim() || bilingualText(locale, 'Quán của bạn', 'Your store');

  const planError = serverError
    ? formatPlanLimitError(serverError, locale)
    : null;
  const rawReason = (planError?.message || serverError || '').trim();
  const fallbackReason = bilingualText(
    locale,
    'Không thể lưu món đầu tiên vào thực đơn',
    'Could not save the first item to your menu'
  );
  const reasonText = rawReason || fallbackReason;

  return bilingualText(
    locale,
    `Quán nháp "${trimmedShopName}" đã được lưu, nhưng nhập món đầu tiên chưa thành công (${reasonText}). Vui lòng kiểm tra lại thông tin món và bấm "Thử nhập lại món đầu tiên" để tiếp tục mà không tạo trùng quán.`,
    `Draft store "${trimmedShopName}" was saved, but importing the first item failed (${reasonText}). Please check the item details and click "Retry importing first item" to continue without creating a duplicate store.`
  );
}

export async function executeOnboardingCompletion(
  input: ExecuteOnboardingInput
): Promise<ExecuteOnboardingResult> {
  const {
    locale,
    ownerId,
    ownerPhone,
    vertical,
    shopName,
    taglineVi,
    city,
    address,
    phone,
    wifiSsid,
    wifiPassword,
    categoryVi,
    firstItemNameVi,
    firstItemPrice,
    existingDraftShop = null,
    headers = { 'Content-Type': 'application/json' },
    fetchImpl = globalThis.fetch,
    onDraftShopSaved,
  } = input;

  const trimmedShopName = shopName.trim();
  if (!trimmedShopName) {
    return {
      ok: false,
      stage: 'validation',
      draftShop: existingDraftShop,
      catalogImported: false,
      redirectHref: null,
      retryAvailable: Boolean(existingDraftShop?.id),
      errorMessage: bilingualText(
        locale,
        'Vui lòng nhập tên cửa hàng.',
        'Please enter store name.'
      ),
      serverError: null,
    };
  }

  const trimmedItemNameVi = firstItemNameVi.trim();
  if (!trimmedItemNameVi) {
    return {
      ok: false,
      stage: 'validation',
      draftShop: existingDraftShop,
      catalogImported: false,
      redirectHref: null,
      retryAvailable: Boolean(existingDraftShop?.id),
      errorMessage: bilingualText(
        locale,
        'Vui lòng nhập tên món hoặc dịch vụ đầu tiên.',
        'Please enter your first item or service name.'
      ),
      serverError: null,
    };
  }

  // 1. Translate first item & category into 5+ languages via AI (best-effort; falls back locally if unavailable)
  let transData: OnboardingTranslationPayload = {};
  try {
    const transRes = await fetchImpl('/api/ai/translate', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        vertical,
        categoryNameVi: categoryVi,
        itemNameVi: trimmedItemNameVi,
      }),
    });
    if (transRes.ok) {
      const parsed = (await transRes
        .json()
        .catch(() => ({}))) as OnboardingTranslationPayload;
      if (parsed && typeof parsed === 'object') {
        transData = parsed;
      }
    }
  } catch {
    // Translation failure should not block draft creation or catalog import; fallback i18n is used below.
  }

  // 2. Reuse preserved draft shop on retry, or create a new draft shop (is_published: false)
  let draftShop: OnboardingDraftShop | null = existingDraftShop?.id
    ? existingDraftShop
    : null;

  if (!draftShop) {
    const slugBase = buildOnboardingSlugBase(trimmedShopName);
    const trimmedCity = typeof city === 'string' ? city.trim() : '';
    const mapLocationQuery = trimmedCity
      ? `${trimmedShopName} ${trimmedCity}`
      : trimmedShopName;
    try {
      const shopRes = await fetchImpl('/api/shops', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          owner_id: ownerId,
          name: trimmedShopName,
          slug: slugBase || `shop-${Date.now()}`,
          vertical,
          tagline_i18n: {
            vi:
              taglineVi.trim() ||
              `Chào mừng quý khách đến với ${trimmedShopName}`,
            en: `Welcome to ${trimmedShopName}`,
            ko: `${trimmedShopName}에 오신 것을 환영합니다`,
            ja: `${trimmedShopName}へようこそ`,
            zh: `欢迎光临 ${trimmedShopName}`,
          },
          description_i18n: {
            vi: `Menu & Bảng giá đa ngôn ngữ chính thức của ${trimmedShopName}.`,
          },
          logo_url: null,
          cover_urls: [],
          address: address.trim() || trimmedCity,
          city: trimmedCity,
          google_maps_url: `https://maps.google.com/?q=${encodeURIComponent(
            mapLocationQuery
          )}`,
          google_review_url: `https://maps.google.com/?q=${encodeURIComponent(
            mapLocationQuery
          )}`,
          phone_contact: phone.trim() || ownerPhone || '',
          zalo_phone: phone.trim() || ownerPhone || '',
          wifi_info: {
            ssid: wifiSsid.trim(),
            password: wifiPassword.trim(),
          },
          opening_hours: {
            mon: { open: '08:00', close: '22:00', closed: false },
            tue: { open: '08:00', close: '22:00', closed: false },
            wed: { open: '08:00', close: '22:00', closed: false },
            thu: { open: '08:00', close: '22:00', closed: false },
            fri: { open: '08:00', close: '22:00', closed: false },
            sat: { open: '08:00', close: '22:00', closed: false },
            sun: { open: '08:00', close: '22:00', closed: false },
          },
          supported_langs: ['vi', 'en', 'ko', 'ja', 'zh'],
          currency: 'VND',
          theme_config: {
            primaryColor:
              vertical === 'service'
                ? '#8b5cf6'
                : vertical === 'retail'
                  ? '#f59e0b'
                  : '#10b981',
            layout: vertical === 'retail' ? 'grid' : 'list',
          },
          // New stores start as drafts; owners go live from the dashboard
          // header "Go live" toggle once the menu is ready.
          is_published: false,
        }),
      });

      const shopData = (await shopRes.json().catch(() => ({}))) as {
        shop?: OnboardingDraftShop;
        error?: string;
      };
      if (!shopRes.ok || !shopData?.shop?.id) {
        const serverError =
          typeof shopData?.error === 'string' && shopData.error.trim()
            ? shopData.error.trim()
            : null;
        return {
          ok: false,
          stage: 'shop_create',
          draftShop: null,
          catalogImported: false,
          redirectHref: null,
          retryAvailable: false,
          errorMessage:
            serverError ||
            bilingualText(
              locale,
              'Không thể tạo cửa hàng',
              'Could not create store'
            ),
          serverError,
        };
      }

      draftShop = {
        ...shopData.shop,
        name:
          typeof shopData.shop.name === 'string' && shopData.shop.name.trim()
            ? shopData.shop.name
            : trimmedShopName,
        is_published: shopData.shop.is_published ?? false,
      };
      onDraftShopSaved?.(draftShop);
    } catch (err) {
      const serverError =
        err instanceof Error && err.message.trim() ? err.message.trim() : null;
      return {
        ok: false,
        stage: 'shop_create',
        draftShop: null,
        catalogImported: false,
        redirectHref: null,
        retryAvailable: false,
        errorMessage:
          serverError ||
          bilingualText(
            locale,
            'Lỗi khi tạo quán',
            'Error creating store'
          ),
        serverError,
      };
    }
  } else {
    onDraftShopSaved?.(draftShop);
  }

  // 3. Bulk import initial category and translated item into the draft shop
  const firstCategoryId = buildOnboardingFirstCategoryId(draftShop.id);
  const firstItemId = buildOnboardingFirstItemId(draftShop.id);
  try {
    const catalogRes = await fetchImpl('/api/catalog', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'bulk_import',
        shopId: draftShop.id,
        categories: [
          {
            id: firstCategoryId,
            name_i18n: transData.category_i18n || {
              vi: categoryVi,
              en: 'Signature Selection',
              ko: '추천 메뉴',
              ja: 'おすすめ',
              zh: '招牌推荐',
            },
            items: [
              {
                id: firstItemId,
                price: Number(firstItemPrice.replace(/[^\d]/g, '')) || 35000,
                duration_mins: vertical === 'service' ? 60 : null,
                name_i18n: transData.name_i18n || { vi: trimmedItemNameVi },
                desc_i18n: transData.desc_i18n || { vi: '' },
              },
            ],
          },
        ],
      }),
    });

    const catalogData = (await catalogRes.json().catch(() => ({}))) as {
      error?: string;
      createdItems?: unknown[];
    };

    if (!catalogRes.ok) {
      const serverError =
        typeof catalogData?.error === 'string' && catalogData.error.trim()
          ? catalogData.error.trim()
          : `HTTP ${catalogRes.status}`;
      return {
        ok: false,
        stage: 'catalog_import',
        draftShop,
        catalogImported: false,
        redirectHref: null,
        retryAvailable: true,
        errorMessage: formatOnboardingBulkImportError({
          locale,
          shopName: draftShop.name || trimmedShopName,
          serverError,
        }),
        serverError,
      };
    }

    return {
      ok: true,
      stage: 'completed',
      draftShop,
      catalogImported: true,
      redirectHref: '/dashboard/qr-studio',
      retryAvailable: false,
      errorMessage: '',
      serverError: null,
    };
  } catch (err) {
    const serverError =
      err instanceof Error && err.message.trim() ? err.message.trim() : null;
    return {
      ok: false,
      stage: 'catalog_import',
      draftShop,
      catalogImported: false,
      redirectHref: null,
      retryAvailable: true,
      errorMessage: formatOnboardingBulkImportError({
        locale,
        shopName: draftShop.name || trimmedShopName,
        serverError,
      }),
      serverError,
    };
  }
}
