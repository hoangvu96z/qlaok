import type { CatalogItem, Category, Shop } from '@/types/qlaok';

export type PublicShopDirectoryEntry = Pick<
  Shop,
  | 'id'
  | 'slug'
  | 'name'
  | 'vertical'
  | 'tagline_i18n'
  | 'cover_urls'
  | 'address'
  | 'city'
  | 'opening_hours'
  | 'supported_langs'
> & {
  wifi_info: Pick<Shop['wifi_info'], 'ssid'> | null;
  theme_config: Pick<Shop['theme_config'], 'primaryColor'>;
};

/** Minimal fields used by /explore. Never return owner, Wi-Fi password, or settings. */
export function toPublicShopDirectoryEntry(
  shop: Shop
): PublicShopDirectoryEntry {
  return {
    id: shop.id,
    slug: shop.slug,
    name: shop.name,
    vertical: shop.vertical,
    tagline_i18n: shop.tagline_i18n,
    cover_urls: shop.cover_urls,
    address: shop.address,
    city: shop.city,
    opening_hours: shop.opening_hours,
    supported_langs: shop.supported_langs,
    wifi_info: shop.wifi_info?.ssid ? { ssid: shop.wifi_info.ssid } : null,
    theme_config: { primaryColor: shop.theme_config?.primaryColor || '#10b981' },
  };
}

/** Explicit customer-facing shop fields used by a single storefront. */
export function toPublicStorefrontShop(shop: Shop) {
  const theme = shop.theme_config;
  return {
    id: shop.id,
    slug: shop.slug,
    name: shop.name,
    vertical: shop.vertical,
    tagline_i18n: shop.tagline_i18n,
    description_i18n: shop.description_i18n,
    logo_url: shop.logo_url,
    cover_urls: shop.cover_urls,
    address: shop.address,
    city: shop.city,
    google_maps_url: shop.google_maps_url,
    google_review_url: shop.google_review_url,
    phone_contact: shop.phone_contact,
    zalo_phone: shop.zalo_phone,
    wifi_info: shop.wifi_info,
    opening_hours: shop.opening_hours,
    supported_langs: shop.supported_langs,
    currency: shop.currency,
    theme_config: {
      primaryColor: theme?.primaryColor,
      layout: theme?.layout,
      fontStyle: theme?.fontStyle,
      backgroundStyle: theme?.backgroundStyle,
      backgroundImageUrl: theme?.backgroundImageUrl,
      backgroundOverlayOpacity: theme?.backgroundOverlayOpacity,
      promoBanner: theme?.promoBanner,
      flashSale: theme?.flashSale,
      welcomePopup: theme?.welcomePopup,
      paymentConfig: theme?.paymentConfig,
      paymentQr: theme?.paymentQr,
      orderWorkflow: theme?.orderWorkflow,
    },
    is_published: shop.is_published ?? true,
  };
}

export type PublicCatalogItem = Pick<
  CatalogItem,
  | 'id'
  | 'shop_id'
  | 'category_id'
  | 'sort_order'
  | 'price'
  | 'compare_at_price'
  | 'unit_i18n'
  | 'duration_mins'
  | 'image_url'
  | 'is_available'
  | 'is_featured'
  | 'name_i18n'
  | 'desc_i18n'
  | 'options_json'
  | 'stock_quantity'
>;

/**
 * Projects a catalog item to the explicit customer-facing storefront allowlist.
 * Keeps stock for the customer stock badge, while omitting analytics, timestamps,
 * and any future database columns. Never spreads the source row.
 */
export function toPublicCatalogItem(item: CatalogItem): PublicCatalogItem {
  return {
    id: item.id,
    shop_id: item.shop_id,
    category_id: item.category_id,
    sort_order: item.sort_order,
    price: item.price,
    compare_at_price: item.compare_at_price,
    unit_i18n: item.unit_i18n,
    duration_mins: item.duration_mins,
    image_url: item.image_url,
    is_available: item.is_available,
    is_featured: item.is_featured,
    name_i18n: item.name_i18n,
    desc_i18n: item.desc_i18n,
    options_json: item.options_json,
    stock_quantity: item.stock_quantity,
  };
}

export type PublicCatalogCategory = Pick<
  Category,
  'id' | 'shop_id' | 'sort_order' | 'name_i18n' | 'is_active'
>;

/** Public category fields required by storefront navigation, excluding DB metadata. */
export function toPublicCatalogCategory(
  category: Category
): PublicCatalogCategory {
  return {
    id: category.id,
    shop_id: category.shop_id,
    sort_order: category.sort_order,
    name_i18n: category.name_i18n,
    is_active: category.is_active,
  };
}
