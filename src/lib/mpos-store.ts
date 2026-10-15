import fs from 'node:fs';
import path from 'node:path';
import type {
  CatalogItem,
  OrderLineItem,
  OrderStatus,
  PaymentMethod,
  ShopOrder,
  SupportedLocale,
} from '@/types/qlaok';
import { getSupabaseDbClient } from './db';

interface InventoryMeta {
  stock_quantity: number | null;
  sold_count: number;
}

interface MposStoreData {
  inventory: Record<string, InventoryMeta>;
  orders: ShopOrder[];
}

const STORE_DIR = path.join(process.cwd(), '.local-db');
const STORE_FILE = path.join(STORE_DIR, 'mpos-store.json');

function buildInitialSeedStore(): MposStoreData {
  const now = new Date();
  const hoursAgo = (h: number) =>
    new Date(now.getTime() - h * 3600 * 1000).toISOString();
  const daysAgo = (d: number, h = 2) =>
    new Date(now.getTime() - (d * 24 + h) * 3600 * 1000).toISOString();

  return {
    inventory: {
      // F&B Demo Stock & Sold Counts
      'item-fnb-1': { stock_quantity: 28, sold_count: 42 },
      'item-fnb-2': { stock_quantity: 18, sold_count: 31 },
      'item-fnb-3': { stock_quantity: 45, sold_count: 54 },
      'item-fnb-4': { stock_quantity: 4, sold_count: 26 }, // Low stock warning (<= 5)
      'item-fnb-5': { stock_quantity: 22, sold_count: 19 },
      // Service Demo Stock (null = unlimited service slots, or daily cap)
      'item-srv-1': { stock_quantity: null, sold_count: 24 },
      'item-srv-2': { stock_quantity: null, sold_count: 18 },
      'item-srv-3': { stock_quantity: 6, sold_count: 15 },
      // Retail Demo Stock
      'item-ret-1': { stock_quantity: 35, sold_count: 29 },
      'item-ret-2': { stock_quantity: 3, sold_count: 27 }, // Low stock warning (<= 5)
      'item-ret-3': { stock_quantity: 14, sold_count: 11 },
    },
    orders: [
      {
        id: 'ord-seed-101',
        order_code: 'ORD-101',
        shop_id: 'shop-fnb-001',
        table_label: 'Bàn 03',
        visitor_lang: 'ko',
        customer_note: 'Cho thêm chanh ớt riêng giúp mình',
        status: 'new',
        payment_method: 'vietqr',
        payment_status: 'unpaid',
        total_amount: 165000,
        source: 'qr_table',
        created_at: hoursAgo(0.15),
        updated_at: hoursAgo(0.15),
        items: [
          {
            item_id: 'item-fnb-1',
            name_vi: 'Phở Bò Tái Nạm Đặc Biệt',
            quantity: 2,
            unit_price: 65000,
            extra_price: 0,
            selected_choices: [],
            quick_tags: ['Ít hành'],
          },
          {
            item_id: 'item-fnb-3',
            name_vi: 'Cà Phê Sữa Đá Phin Truyền Thống',
            quantity: 1,
            unit_price: 35000,
            extra_price: 0,
            selected_choices: [],
            quick_tags: ['Ít đá'],
          },
        ],
      },
      {
        id: 'ord-seed-102',
        order_code: 'ORD-102',
        shop_id: 'shop-fnb-001',
        table_label: 'Bàn 01',
        visitor_lang: 'en',
        status: 'preparing',
        payment_method: 'cash',
        payment_status: 'unpaid',
        total_amount: 145000,
        source: 'qr_table',
        created_at: hoursAgo(0.4),
        updated_at: hoursAgo(0.3),
        items: [
          {
            item_id: 'item-fnb-2',
            name_vi: 'Bún Chả Hà Nội Nướng Than Hoa',
            quantity: 2,
            unit_price: 55000,
            extra_price: 0,
            selected_choices: [],
          },
          {
            item_id: 'item-fnb-3',
            name_vi: 'Cà Phê Sữa Đá Phin Truyền Thống',
            quantity: 1,
            unit_price: 35000,
            extra_price: 0,
            selected_choices: [],
          },
        ],
      },
      {
        id: 'ord-seed-103',
        order_code: 'ORD-103',
        shop_id: 'shop-fnb-001',
        table_label: 'Bàn 05',
        visitor_lang: 'ja',
        status: 'completed',
        payment_method: 'vietqr',
        payment_status: 'paid',
        total_amount: 215000,
        source: 'qr_table',
        created_at: hoursAgo(2),
        updated_at: hoursAgo(1.7),
        items: [
          {
            item_id: 'item-fnb-1',
            name_vi: 'Phở Bò Tái Nạm Đặc Biệt',
            quantity: 2,
            unit_price: 65000,
            extra_price: 20000,
            selected_choices: [],
          },
          {
            item_id: 'item-fnb-5',
            name_vi: 'Nem Rán Hà Nội Giòn Rụm (4 cuốn)',
            quantity: 1,
            unit_price: 45000,
            extra_price: 0,
            selected_choices: [],
          },
        ],
      },
      {
        id: 'ord-seed-104',
        order_code: 'ORD-104',
        shop_id: 'shop-fnb-001',
        table_label: 'Mang về (Quầy)',
        visitor_lang: 'vi',
        status: 'completed',
        payment_method: 'cash',
        payment_status: 'paid',
        total_amount: 195000,
        source: 'counter_pos',
        created_at: hoursAgo(3.5),
        updated_at: hoursAgo(3.4),
        items: [
          {
            item_id: 'item-fnb-1',
            name_vi: 'Phở Bò Tái Nạm Đặc Biệt',
            quantity: 3,
            unit_price: 65000,
            extra_price: 0,
            selected_choices: [],
          },
        ],
      },
      // Previous days completed orders for 7-day revenue chart
      {
        id: 'ord-seed-105',
        order_code: 'ORD-098',
        shop_id: 'shop-fnb-001',
        table_label: 'Bàn 02',
        visitor_lang: 'zh',
        status: 'completed',
        payment_method: 'vietqr',
        payment_status: 'paid',
        total_amount: 340000,
        source: 'qr_table',
        created_at: daysAgo(1),
        updated_at: daysAgo(1),
        items: [
          {
            item_id: 'item-fnb-1',
            name_vi: 'Phở Bò Tái Nạm Đặc Biệt',
            quantity: 4,
            unit_price: 65000,
            extra_price: 20000,
            selected_choices: [],
          },
        ],
      },
      {
        id: 'ord-seed-106',
        order_code: 'ORD-095',
        shop_id: 'shop-fnb-001',
        table_label: 'Bàn 06',
        visitor_lang: 'ko',
        status: 'completed',
        payment_method: 'cash',
        payment_status: 'paid',
        total_amount: 285000,
        source: 'qr_table',
        created_at: daysAgo(2),
        updated_at: daysAgo(2),
        items: [
          {
            item_id: 'item-fnb-2',
            name_vi: 'Bún Chả Hà Nội Nướng Than Hoa',
            quantity: 3,
            unit_price: 55000,
            extra_price: 0,
            selected_choices: [],
          },
          {
            item_id: 'item-fnb-4',
            name_vi: 'Bạc Xỉu Đá Sữa Dừa Non',
            quantity: 3,
            unit_price: 40000,
            extra_price: 0,
            selected_choices: [],
          },
        ],
      },
      {
        id: 'ord-seed-107',
        order_code: 'ORD-091',
        shop_id: 'shop-fnb-001',
        table_label: 'Bàn 04',
        visitor_lang: 'en',
        status: 'completed',
        payment_method: 'vietqr',
        payment_status: 'paid',
        total_amount: 420000,
        source: 'qr_table',
        created_at: daysAgo(3, 4),
        updated_at: daysAgo(3, 4),
        items: [
          {
            item_id: 'item-fnb-1',
            name_vi: 'Phở Bò Tái Nạm Đặc Biệt',
            quantity: 4,
            unit_price: 65000,
            extra_price: 0,
            selected_choices: [],
          },
          {
            item_id: 'item-fnb-3',
            name_vi: 'Cà Phê Sữa Đá Phin Truyền Thống',
            quantity: 4,
            unit_price: 40000,
            extra_price: 0,
            selected_choices: [],
          },
        ],
      },
      {
        id: 'ord-seed-108',
        order_code: 'ORD-088',
        shop_id: 'shop-fnb-001',
        table_label: 'Bàn 08',
        visitor_lang: 'vi',
        status: 'completed',
        payment_method: 'cash',
        payment_status: 'paid',
        total_amount: 310000,
        source: 'counter_pos',
        created_at: daysAgo(4, 6),
        updated_at: daysAgo(4, 6),
        items: [
          {
            item_id: 'item-fnb-2',
            name_vi: 'Bún Chả Hà Nội Nướng Than Hoa',
            quantity: 4,
            unit_price: 55000,
            extra_price: 0,
            selected_choices: [],
          },
          {
            item_id: 'item-fnb-5',
            name_vi: 'Nem Rán Hà Nội Giòn Rụm (4 cuốn)',
            quantity: 2,
            unit_price: 45000,
            extra_price: 0,
            selected_choices: [],
          },
        ],
      },
      {
        id: 'ord-seed-109',
        order_code: 'ORD-084',
        shop_id: 'shop-fnb-001',
        table_label: 'Bàn 02',
        visitor_lang: 'ko',
        status: 'completed',
        payment_method: 'vietqr',
        payment_status: 'paid',
        total_amount: 495000,
        source: 'qr_table',
        created_at: daysAgo(5, 1),
        updated_at: daysAgo(5, 1),
        items: [
          {
            item_id: 'item-fnb-1',
            name_vi: 'Phở Bò Tái Nạm Đặc Biệt',
            quantity: 5,
            unit_price: 65000,
            extra_price: 0,
            selected_choices: [],
          },
          {
            item_id: 'item-fnb-4',
            name_vi: 'Bạc Xỉu Đá Sữa Dừa Non',
            quantity: 5,
            unit_price: 34000,
            extra_price: 0,
            selected_choices: [],
          },
        ],
      },
      {
        id: 'ord-seed-110',
        order_code: 'ORD-079',
        shop_id: 'shop-fnb-001',
        table_label: 'Bàn 07',
        visitor_lang: 'ja',
        status: 'completed',
        payment_method: 'vietqr',
        payment_status: 'paid',
        total_amount: 365000,
        source: 'qr_table',
        created_at: daysAgo(6, 3),
        updated_at: daysAgo(6, 3),
        items: [
          {
            item_id: 'item-fnb-1',
            name_vi: 'Phở Bò Tái Nạm Đặc Biệt',
            quantity: 3,
            unit_price: 65000,
            extra_price: 0,
            selected_choices: [],
          },
          {
            item_id: 'item-fnb-2',
            name_vi: 'Bún Chả Hà Nội Nướng Than Hoa',
            quantity: 2,
            unit_price: 55000,
            extra_price: 30000,
            selected_choices: [],
          },
        ],
      },
      // Service shop sample order
      {
        id: 'ord-seed-201',
        order_code: 'ORD-201',
        shop_id: 'shop-service-002',
        table_label: 'Ghế Spa 02',
        visitor_lang: 'ko',
        status: 'new',
        payment_method: 'vietqr',
        payment_status: 'unpaid',
        total_amount: 430000,
        source: 'qr_table',
        created_at: hoursAgo(0.2),
        updated_at: hoursAgo(0.2),
        items: [
          {
            item_id: 'item-srv-1',
            name_vi: 'Gội Đầu Dưỡng Sinh Thảo Dược Hoàng Cung',
            quantity: 1,
            unit_price: 180000,
            extra_price: 0,
            selected_choices: [],
          },
          {
            item_id: 'item-srv-2',
            name_vi: 'Massage Tinh Dầu Đá Nóng Toàn Thân',
            quantity: 1,
            unit_price: 250000,
            extra_price: 0,
            selected_choices: [],
          },
        ],
      },
      // Retail shop sample order
      {
        id: 'ord-seed-301',
        order_code: 'ORD-301',
        shop_id: 'shop-retail-003',
        table_label: 'Quầy Đóng Gói 01',
        visitor_lang: 'zh',
        status: 'completed',
        payment_method: 'vietqr',
        payment_status: 'paid',
        total_amount: 335000,
        source: 'qr_table',
        created_at: hoursAgo(1.2),
        updated_at: hoursAgo(1.0),
        items: [
          {
            item_id: 'item-ret-1',
            name_vi: 'Cà Phê Rang Mộc Cầu Đất (Túi 500g)',
            quantity: 1,
            unit_price: 165000,
            extra_price: 0,
            selected_choices: [],
          },
          {
            item_id: 'item-ret-2',
            name_vi: 'Bánh Dừa Nướng Quảng Nam Đặc Biệt',
            quantity: 2,
            unit_price: 85000,
            extra_price: 0,
            selected_choices: [],
          },
        ],
      },
    ],
  };
}

function readStore(): MposStoreData {
  try {
    if (!fs.existsSync(STORE_FILE)) {
      fs.mkdirSync(STORE_DIR, { recursive: true });
      const initial = buildInitialSeedStore();
      fs.writeFileSync(STORE_FILE, JSON.stringify(initial, null, 2), 'utf8');
      return initial;
    }
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as MposStoreData;
    return {
      inventory: parsed.inventory || {},
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
    };
  } catch {
    return buildInitialSeedStore();
  }
}

function writeStore(data: MposStoreData) {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist mpos-store.json:', err);
  }
}

export function enrichItemsWithInventory(items: CatalogItem[]): CatalogItem[] {
  const store = readStore();
  return items.map((item) => {
    const meta = store.inventory[item.id];
    const stockQty =
      meta !== undefined
        ? meta.stock_quantity
        : item.stock_quantity !== undefined
          ? item.stock_quantity
          : null;
    const soldCount =
      meta !== undefined
        ? meta.sold_count
        : item.sold_count !== undefined
          ? item.sold_count
          : 0;

    return {
      ...item,
      stock_quantity: stockQty,
      sold_count: soldCount,
      is_available: stockQty === 0 ? false : item.is_available,
    };
  });
}

export async function setItemStockMetadata(
  itemId: string,
  stockQuantity: number | null | undefined,
  soldCount?: number
) {
  const store = readStore();
  const prev = store.inventory[itemId] || { stock_quantity: null, sold_count: 0 };
  const nextStock =
    stockQuantity === undefined
      ? prev.stock_quantity
      : stockQuantity === null || Number.isNaN(Number(stockQuantity))
        ? null
        : Math.max(0, Math.floor(Number(stockQuantity)));

  store.inventory[itemId] = {
    stock_quantity: nextStock,
    sold_count: soldCount !== undefined ? soldCount : prev.sold_count,
  };
  writeStore(store);

  // Sync availability & stock columns (if 002 migration is applied) to Supabase items table
  try {
    const sb = getSupabaseDbClient();
    await sb
      .from('items')
      .update({
        stock_quantity: nextStock,
        sold_count: soldCount !== undefined ? soldCount : prev.sold_count,
        ...(nextStock === 0
          ? { is_available: false }
          : nextStock !== null && nextStock > 0 && prev.stock_quantity === 0
            ? { is_available: true }
            : {}),
      })
      .eq('id', itemId);

    if (nextStock === 0) {
      await sb.from('items').update({ is_available: false }).eq('id', itemId);
    } else if (nextStock !== null && nextStock > 0 && prev.stock_quantity === 0) {
      await sb.from('items').update({ is_available: true }).eq('id', itemId);
    }
  } catch {
    // ignore if offline or 002 migration not yet run
  }
}

const VN_OFFSET_MS = 7 * 3600 * 1000;

export function getVietnamDateKey(
  dateInput: Date | string | number = new Date()
): string {
  const ts = new Date(dateInput).getTime();
  if (Number.isNaN(ts)) {
    return new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);
  }
  return new Date(ts + VN_OFFSET_MS).toISOString().slice(0, 10);
}

export function getVietnamHour(dateInput: Date | string | number): number {
  const ts = new Date(dateInput).getTime();
  if (Number.isNaN(ts)) return 12;
  return new Date(ts + VN_OFFSET_MS).getUTCHours();
}

function normalizeOrderRecord(raw: Partial<ShopOrder>): ShopOrder {
  const items: OrderLineItem[] = Array.isArray(raw.items)
    ? raw.items.map((line) => ({
        ...line,
        quantity: Math.max(1, Number(line?.quantity || 1)),
        unit_price: Number(line?.unit_price || 0),
        extra_price: Number(line?.extra_price || 0),
        selected_choices: Array.isArray(line?.selected_choices)
          ? line.selected_choices
          : [],
        quick_tags: Array.isArray(line?.quick_tags) ? line.quick_tags : [],
      }))
    : [];

  const computedTotal = items.reduce(
    (sum, l) => sum + (l.unit_price + (l.extra_price || 0)) * l.quantity,
    0
  );
  const rawTotal = Number(raw.total_amount);

  return {
    id: String(raw.id || `ord-${Date.now()}`),
    order_code: String(raw.order_code || 'ORD-000'),
    shop_id: String(raw.shop_id || 'shop-fnb-001'),
    table_label: String(raw.table_label || 'Tại quầy'),
    visitor_lang: (raw.visitor_lang as SupportedLocale) || 'vi',
    customer_note: raw.customer_note || '',
    status: (raw.status as OrderStatus) || 'new',
    payment_method: (raw.payment_method as PaymentMethod) || 'cash',
    payment_status:
      raw.payment_status === 'paid' || raw.status === 'completed'
        ? 'paid'
        : 'unpaid',
    total_amount: !Number.isNaN(rawTotal) ? rawTotal : computedTotal,
    items,
    source: raw.source === 'counter_pos' ? 'counter_pos' : 'qr_table',
    created_at: raw.created_at || new Date().toISOString(),
    updated_at: raw.updated_at || raw.created_at || new Date().toISOString(),
  };
}

/**
 * Loads orders from Supabase `public.orders` (primary persistent database)
 * and merges with local `.local-db/mpos-store.json` (fallback + demo seeds),
 * ensuring no orders are ever lost across page reloads or VPS re-deployments.
 */
async function loadMergedOrders(shopId?: string): Promise<ShopOrder[]> {
  const store = readStore();
  const orderMap = new Map<string, ShopOrder>();

  for (const localOrd of store.orders) {
    const norm = normalizeOrderRecord(localOrd);
    orderMap.set(norm.id, norm);
  }

  let storeNeedsWrite = false;
  try {
    const sb = getSupabaseDbClient();
    const { data: sbRows, error } = await sb
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(sbRows)) {
      for (const row of sbRows) {
        const sbOrd = normalizeOrderRecord(row as Partial<ShopOrder>);
        const existing = orderMap.get(sbOrd.id);
        if (!existing) {
          orderMap.set(sbOrd.id, sbOrd);
          storeNeedsWrite = true;
        } else {
          const sbTime = new Date(sbOrd.updated_at).getTime() || 0;
          const localTime = new Date(existing.updated_at).getTime() || 0;
          if (sbTime >= localTime) {
            if (
              existing.status !== sbOrd.status ||
              existing.payment_status !== sbOrd.payment_status ||
              existing.total_amount !== sbOrd.total_amount
            ) {
              storeNeedsWrite = true;
            }
            orderMap.set(sbOrd.id, sbOrd);
          }
        }
      }
    }
  } catch {
    // Fallback to local store if offline or Supabase orders table not reachable
  }

  const allMerged = Array.from(orderMap.values()).sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  if (storeNeedsWrite) {
    store.orders = allMerged;
    writeStore(store);
  }

  return shopId
    ? allMerged.filter((o) => o.shop_id === shopId)
    : allMerged;
}

export async function dbGetAllOrders(): Promise<ShopOrder[]> {
  return loadMergedOrders();
}

export async function dbGetShopOrders(shopId: string): Promise<ShopOrder[]> {
  return loadMergedOrders(shopId);
}

export async function dbGetOrderById(
  orderId: string
): Promise<ShopOrder | null> {
  const all = await loadMergedOrders();
  return all.find((o) => o.id === orderId) || null;
}

export async function dbCreateOrder(params: {
  shop_id: string;
  table_label: string;
  visitor_lang?: SupportedLocale;
  customer_note?: string;
  payment_method?: PaymentMethod;
  payment_status?: 'unpaid' | 'paid';
  source?: 'qr_table' | 'counter_pos';
  markCompletedImmediately?: boolean;
  discount_amount?: number;
  items: OrderLineItem[];
}): Promise<ShopOrder> {
  await loadMergedOrders(params.shop_id);
  const store = readStore();

  if (!params.items || params.items.length === 0) {
    throw new Error('Đơn hàng phải có ít nhất 1 món/dịch vụ.');
  }

  // Fetch current items from Supabase to verify prices & availability
  const itemMap = new Map<string, CatalogItem>();
  try {
    const sb = getSupabaseDbClient();
    const { data: dbItems } = await sb
      .from('items')
      .select('*')
      .eq('shop_id', params.shop_id);

    for (const raw of dbItems || []) {
      itemMap.set(raw.id, raw as CatalogItem);
    }
  } catch {
    // offline or unit test mode
  }

  // Check stock availability first
  for (const line of params.items) {
    const meta = store.inventory[line.item_id];
    const dbItem = itemMap.get(line.item_id);
    if (dbItem && !dbItem.is_available) {
      throw new Error(`Món "${line.name_vi}" hiện đã tạm hết hàng.`);
    }
    if (
      meta &&
      meta.stock_quantity !== null &&
      meta.stock_quantity < line.quantity
    ) {
      throw new Error(
        `Món "${line.name_vi}" chỉ còn ${meta.stock_quantity} phần trong kho.`
      );
    }
  }

  // Deduct stock & increment sold_count
  const zeroedItemIds: string[] = [];
  for (const line of params.items) {
    const prev = store.inventory[line.item_id] || {
      stock_quantity: null,
      sold_count: 0,
    };
    const nextStock =
      prev.stock_quantity !== null
        ? Math.max(0, prev.stock_quantity - line.quantity)
        : null;
    store.inventory[line.item_id] = {
      stock_quantity: nextStock,
      sold_count: (prev.sold_count || 0) + line.quantity,
    };
    if (nextStock === 0) {
      zeroedItemIds.push(line.item_id);
    }
  }

  const subtotalAmount = params.items.reduce(
    (sum, line) =>
      sum +
      (Number(line.unit_price || 0) + Number(line.extra_price || 0)) *
        line.quantity,
    0
  );
  const discountAmount = Math.max(0, Number(params.discount_amount || 0));
  const totalAmount = Math.max(0, subtotalAmount - discountAmount);

  const nowIso = new Date().toISOString();
  const randomCode = Math.floor(100 + Math.random() * 900);
  const isPaid =
    params.markCompletedImmediately || params.payment_status === 'paid';

  const newOrder: ShopOrder = {
    id: `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    order_code: `ORD-${randomCode}`,
    shop_id: params.shop_id,
    table_label: params.table_label.trim() || 'Bàn khách',
    visitor_lang: params.visitor_lang || 'vi',
    customer_note: params.customer_note?.trim() || '',
    status: params.markCompletedImmediately ? 'completed' : 'new',
    payment_method: params.payment_method || 'cash',
    payment_status: isPaid ? 'paid' : 'unpaid',
    total_amount: totalAmount,
    items: params.items,
    source: params.source || 'qr_table',
    created_at: nowIso,
    updated_at: nowIso,
  };

  store.orders.unshift(newOrder);
  writeStore(store);

  // Sync new order & sold-out items to live Supabase (when 002_mpos_orders_inventory.sql is applied)
  try {
    const sb = getSupabaseDbClient();
    await sb.from('orders').upsert(newOrder);
    for (const line of params.items) {
      const meta = store.inventory[line.item_id];
      if (meta) {
        await sb
          .from('items')
          .update({
            stock_quantity: meta.stock_quantity,
            sold_count: meta.sold_count,
          })
          .eq('id', line.item_id);
      }
    }
    if (zeroedItemIds.length > 0) {
      await Promise.all(
        zeroedItemIds.map((id) =>
          sb.from('items').update({ is_available: false }).eq('id', id)
        )
      );
    }
  } catch {
    // ignore if offline or 002 migration not yet run
  }

  return newOrder;
}

export async function dbUpdateOrderStatus(
  orderId: string,
  patch: {
    status?: OrderStatus;
    payment_method?: PaymentMethod;
    payment_status?: 'unpaid' | 'paid';
    table_label?: string;
    customer_note?: string;
    items?: OrderLineItem[];
    discount_amount?: number;
  }
): Promise<ShopOrder> {
  await loadMergedOrders();
  const store = readStore();
  const idx = store.orders.findIndex((o) => o.id === orderId);
  if (idx === -1) {
    throw new Error('Không tìm thấy đơn hàng.');
  }

  const existing = store.orders[idx];
  const nextStatus = patch.status || existing.status;

  const restoredItemIds: string[] = [];
  const zeroedItemIds: string[] = [];
  let nextItems = existing.items;
  let nextTotalAmount = Number(existing.total_amount || 0);

  // If updating the items list of an active order (before or during payment)
  if (Array.isArray(patch.items)) {
    if (patch.items.length === 0) {
      throw new Error(
        'Đơn hàng sau khi sửa phải có ít nhất 1 món (hoặc chọn Hủy đơn).'
      );
    }

    // 1. Temporarily restore old quantities into inventory
    if (existing.status !== 'cancelled') {
      for (const oldLine of existing.items || []) {
        const meta = store.inventory[oldLine.item_id];
        if (meta) {
          const wasZero = meta.stock_quantity === 0;
          meta.stock_quantity =
            meta.stock_quantity !== null
              ? meta.stock_quantity + Number(oldLine.quantity || 1)
              : null;
          meta.sold_count = Math.max(
            0,
            (meta.sold_count || 0) - Number(oldLine.quantity || 1)
          );
          if (wasZero && (meta.stock_quantity ?? 0) > 0) {
            restoredItemIds.push(oldLine.item_id);
          }
        }
      }
    }

    // 2. Check stock availability for new items & deduct
    if (nextStatus !== 'cancelled') {
      for (const newLine of patch.items) {
        const qty = Math.max(1, Number(newLine.quantity || 1));
        const meta = store.inventory[newLine.item_id];
        if (
          meta &&
          meta.stock_quantity !== null &&
          meta.stock_quantity < qty
        ) {
          throw new Error(
            `Món "${newLine.name_vi}" chỉ còn ${meta.stock_quantity} phần trong kho.`
          );
        }
      }

      for (const newLine of patch.items) {
        const qty = Math.max(1, Number(newLine.quantity || 1));
        const prev = store.inventory[newLine.item_id] || {
          stock_quantity: null,
          sold_count: 0,
        };
        const nextStock =
          prev.stock_quantity !== null
            ? Math.max(0, prev.stock_quantity - qty)
            : null;
        store.inventory[newLine.item_id] = {
          stock_quantity: nextStock,
          sold_count: (prev.sold_count || 0) + qty,
        };
        if (nextStock === 0) {
          zeroedItemIds.push(newLine.item_id);
        }
      }
    }

    nextItems = patch.items.map((line) => ({
      ...line,
      quantity: Math.max(1, Number(line.quantity || 1)),
      unit_price: Number(line.unit_price || 0),
      extra_price: Number(line.extra_price || 0),
      selected_choices: Array.isArray(line.selected_choices)
        ? line.selected_choices
        : [],
      quick_tags: Array.isArray(line.quick_tags) ? line.quick_tags : [],
    }));

    const subtotalAmount = nextItems.reduce(
      (sum, line) =>
        sum +
        (Number(line.unit_price || 0) + Number(line.extra_price || 0)) *
          line.quantity,
      0
    );
    const discountAmount = Math.max(0, Number(patch.discount_amount || 0));
    nextTotalAmount = Math.max(0, subtotalAmount - discountAmount);
  } else if (existing.status !== 'cancelled' && nextStatus === 'cancelled') {
    // If cancelling an active order without replacing items, restore stock quantities
    for (const line of existing.items) {
      const meta = store.inventory[line.item_id];
      if (meta) {
        const wasZero = meta.stock_quantity === 0;
        meta.stock_quantity =
          meta.stock_quantity !== null
            ? meta.stock_quantity + line.quantity
            : null;
        meta.sold_count = Math.max(0, (meta.sold_count || 0) - line.quantity);
        if (wasZero && (meta.stock_quantity ?? 0) > 0) {
          restoredItemIds.push(line.item_id);
        }
      }
    }
  }

  const nextPaymentStatus =
    patch.payment_status ||
    (nextStatus === 'completed' ? 'paid' : existing.payment_status);

  const updated: ShopOrder = {
    ...existing,
    table_label:
      patch.table_label !== undefined
        ? patch.table_label.trim() || existing.table_label
        : existing.table_label,
    customer_note:
      patch.customer_note !== undefined
        ? patch.customer_note.trim()
        : existing.customer_note,
    items: nextItems,
    total_amount: nextTotalAmount,
    status: nextStatus,
    payment_method: patch.payment_method || existing.payment_method,
    payment_status: nextPaymentStatus,
    updated_at: new Date().toISOString(),
  };

  store.orders[idx] = updated;
  writeStore(store);

  try {
    const sb = getSupabaseDbClient();
    await sb.from('orders').upsert(updated);

    if (restoredItemIds.length > 0) {
      await Promise.all(
        restoredItemIds.map((id) =>
          sb.from('items').update({ is_available: true }).eq('id', id)
        )
      );
    }
    if (zeroedItemIds.length > 0) {
      await Promise.all(
        zeroedItemIds.map((id) =>
          sb.from('items').update({ is_available: false }).eq('id', id)
        )
      );
    }
  } catch {
    // ignore if offline or 002 migration not yet run
  }

  return updated;
}

export function computeShopRevenueAndInventoryStats(
  shopId: string,
  enrichedItems: CatalogItem[],
  preloadedOrders?: ShopOrder[]
) {
  const shopOrders = (
    preloadedOrders ??
    readStore().orders.filter((o) => o.shop_id === shopId)
  ).map(normalizeOrderRecord);

  const todayVnKey = getVietnamDateKey();

  const validOrders = shopOrders.filter((o) => o.status !== 'cancelled');
  const completedOrders = shopOrders.filter(
    (o) => o.status === 'completed' || o.payment_status === 'paid'
  );

  const todayValidOrders = validOrders.filter(
    (o) => getVietnamDateKey(o.created_at) === todayVnKey
  );
  const todayCompletedOrders = completedOrders.filter(
    (o) => getVietnamDateKey(o.created_at) === todayVnKey
  );

  const todayRevenue = todayValidOrders.reduce(
    (sum, o) => sum + Number(o.total_amount || 0),
    0
  );
  const totalRevenue = validOrders.reduce(
    (sum, o) => sum + Number(o.total_amount || 0),
    0
  );

  const newOrdersCount = shopOrders.filter((o) => o.status === 'new').length;
  const preparingOrdersCount = shopOrders.filter(
    (o) => o.status === 'preparing'
  ).length;

  const avgOrderValue =
    validOrders.length > 0 ? Math.round(totalRevenue / validOrders.length) : 0;

  // 7-day daily revenue chart in Vietnam timezone (UTC+7)
  const dailyRevenue7d: Array<{
    date: string;
    label: string;
    revenue: number;
    cashRevenue: number;
    vietqrRevenue: number;
    orders: number;
    orderCount: number;
  }> = [];

  const nowMs = Date.now();
  for (let i = 6; i >= 0; i--) {
    const targetDayMs = nowMs - i * 24 * 3600 * 1000;
    const dayKey = getVietnamDateKey(targetDayMs);
    const [, mm, dd] = dayKey.split('-');

    const dayOrders = validOrders.filter(
      (o) => getVietnamDateKey(o.created_at) === dayKey
    );
    const rev = dayOrders.reduce((s, o) => s + Number(o.total_amount || 0), 0);
    const cashRev = dayOrders
      .filter((o) => o.payment_method === 'cash')
      .reduce((s, o) => s + Number(o.total_amount || 0), 0);
    const vietqrRev = dayOrders
      .filter((o) => o.payment_method !== 'cash')
      .reduce((s, o) => s + Number(o.total_amount || 0), 0);

    dailyRevenue7d.push({
      date: dayKey,
      label: i === 0 ? `Hôm nay` : `${dd}/${mm}`,
      revenue: rev,
      cashRevenue: cashRev,
      vietqrRevenue: vietqrRev,
      orders: dayOrders.length,
      orderCount: dayOrders.length,
    });
  }

  // Payment method breakdown (VietQR vs Cash)
  const vietqrOrders = validOrders.filter((o) => o.payment_method !== 'cash');
  const cashOrders = validOrders.filter((o) => o.payment_method === 'cash');
  const vietqrRevenueTotal = vietqrOrders.reduce(
    (s, o) => s + Number(o.total_amount || 0),
    0
  );
  const cashRevenueTotal = cashOrders.reduce(
    (s, o) => s + Number(o.total_amount || 0),
    0
  );
  const vietqrPct =
    totalRevenue > 0 ? Math.round((vietqrRevenueTotal / totalRevenue) * 100) : 65;
  const cashPct = totalRevenue > 0 ? Math.max(0, 100 - vietqrPct) : 35;

  const paymentBreakdown = {
    vietqr: {
      count: vietqrOrders.length,
      revenue: vietqrRevenueTotal,
      percentage: vietqrPct,
    },
    cash: {
      count: cashOrders.length,
      revenue: cashRevenueTotal,
      percentage: cashPct,
    },
  };

  // Order source breakdown (QR Table vs Counter POS)
  const qrTableOrders = validOrders.filter((o) => o.source !== 'counter_pos');
  const counterPosOrders = validOrders.filter((o) => o.source === 'counter_pos');
  const qrTableRevenue = qrTableOrders.reduce(
    (s, o) => s + Number(o.total_amount || 0),
    0
  );
  const counterPosRevenue = counterPosOrders.reduce(
    (s, o) => s + Number(o.total_amount || 0),
    0
  );
  const qrTablePct =
    validOrders.length > 0
      ? Math.round((qrTableOrders.length / validOrders.length) * 100)
      : 75;
  const counterPosPct =
    validOrders.length > 0 ? Math.max(0, 100 - qrTablePct) : 25;

  const sourceBreakdown = {
    qr_table: {
      count: qrTableOrders.length,
      revenue: qrTableRevenue,
      percentage: qrTablePct,
    },
    counter_pos: {
      count: counterPosOrders.length,
      revenue: counterPosRevenue,
      percentage: counterPosPct,
    },
  };

  // Peak hours breakdown (6 slots) in Vietnam timezone (UTC+7)
  const slotsDef = [
    { slot: '06h-09h', label: 'Sáng (6-9h)', minH: 6, maxH: 9 },
    { slot: '09h-12h', label: 'Trưa (9-12h)', minH: 9, maxH: 12 },
    { slot: '12h-15h', label: 'Chiều (12-15h)', minH: 12, maxH: 15 },
    { slot: '15h-18h', label: 'Xế (15-18h)', minH: 15, maxH: 18 },
    { slot: '18h-21h', label: 'Tối (18-21h)', minH: 18, maxH: 21 },
    { slot: '21h-24h', label: 'Đêm (21-24h)', minH: 21, maxH: 24 },
  ];

  const rawHourly = slotsDef.map((s) => {
    const matched = validOrders.filter((o) => {
      const h = getVietnamHour(o.created_at);
      return h >= s.minH && h < s.maxH;
    });
    const rev = matched.reduce((acc, o) => acc + Number(o.total_amount || 0), 0);
    return {
      slot: s.slot,
      label: s.label,
      orders: matched.length,
      revenue: rev,
    };
  });

  const maxSlotRev = Math.max(...rawHourly.map((h) => h.revenue), 1);
  const hourlyBreakdown = rawHourly.map((h) => ({
    ...h,
    percentage:
      h.revenue > 0 ? Math.max(14, Math.round((h.revenue / maxSlotRev) * 100)) : 8,
  }));

  // Compute real item sold counts & revenue from validOrders so stats are never out of sync
  const orderSoldMap = new Map<string, { qty: number; rev: number }>();
  for (const ord of validOrders) {
    for (const line of ord.items || []) {
      const prev = orderSoldMap.get(line.item_id) || { qty: 0, rev: 0 };
      const lineQty = Number(line.quantity || 1);
      const lineRev =
        (Number(line.unit_price || 0) + Number(line.extra_price || 0)) * lineQty;
      orderSoldMap.set(line.item_id, {
        qty: prev.qty + lineQty,
        rev: prev.rev + lineRev,
      });
    }
  }

  // Inventory summary
  const lowStockItems = enrichedItems.filter(
    (i) =>
      i.stock_quantity !== null &&
      i.stock_quantity !== undefined &&
      i.stock_quantity > 0 &&
      i.stock_quantity <= 5
  );
  const outOfStockItems = enrichedItems.filter(
    (i) => !i.is_available || i.stock_quantity === 0
  );

  // Top selling items by sold_count & revenue
  const topSellingItems = [...enrichedItems]
    .map((item) => {
      const fromOrders = orderSoldMap.get(item.id);
      const effectiveSold = Math.max(
        item.sold_count || 0,
        fromOrders?.qty || 0
      );
      const effectiveRev =
        fromOrders && fromOrders.qty >= (item.sold_count || 0)
          ? fromOrders.rev
          : effectiveSold * item.price;
      return {
        ...item,
        name_vi: item.name_i18n?.vi || 'Món',
        sold_count: effectiveSold,
        stock_quantity:
          item.stock_quantity === undefined ? null : item.stock_quantity,
        revenue: effectiveRev,
        estimated_revenue: effectiveRev,
      };
    })
    .sort((a, b) => (b.sold_count || 0) - (a.sold_count || 0))
    .slice(0, 5);

  return {
    todayRevenue,
    todayOrdersCount: todayValidOrders.length,
    todayCompletedCount: todayCompletedOrders.length,
    completedOrdersCount: completedOrders.length,
    totalRevenue,
    totalOrdersCount: validOrders.length,
    newOrdersCount,
    preparingOrdersCount,
    avgOrderValue,
    lowStockCount: lowStockItems.length,
    outOfStockCount: outOfStockItems.length,
    lowStockItems,
    dailyRevenue7d,
    dailyRevenue7Days: dailyRevenue7d,
    paymentBreakdown,
    sourceBreakdown,
    hourlyBreakdown,
    topSellingItems,
  };
}
