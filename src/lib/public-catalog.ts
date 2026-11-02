import type { CatalogItem, Category } from '@/types/qlaok';

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
