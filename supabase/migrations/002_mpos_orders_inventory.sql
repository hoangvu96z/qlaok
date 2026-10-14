-- ============================================================================
-- QLAOK mPOS UPGRADE MIGRATION (002)
-- Bổ sung Quản lý Đơn hàng Realtime (orders) & Tồn kho món (stock_quantity, sold_count)
-- ============================================================================

-- 1. Thêm cột stock_quantity (Số lượng tồn kho, NULL = Không giới hạn) & sold_count vào bảng items
ALTER TABLE public.items
ADD COLUMN IF NOT EXISTS stock_quantity INTEGER DEFAULT NULL,
ADD COLUMN IF NOT EXISTS sold_count INTEGER NOT NULL DEFAULT 0;

-- 2. Tạo bảng orders (Lưu trữ đơn gọi món từ QR Bàn và đơn tạo tại quầy mPOS)
CREATE TABLE IF NOT EXISTS public.orders (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    order_code VARCHAR(30) NOT NULL,
    shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    table_label VARCHAR(60) NOT NULL DEFAULT 'Tại quầy',
    visitor_lang VARCHAR(10) NOT NULL DEFAULT 'vi',
    customer_note TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'new', -- 'new' | 'preparing' | 'completed' | 'cancelled'
    payment_method VARCHAR(20) NOT NULL DEFAULT 'cash', -- 'cash' | 'vietqr'
    payment_status VARCHAR(20) NOT NULL DEFAULT 'unpaid', -- 'unpaid' | 'paid'
    total_amount NUMERIC(12, 0) NOT NULL DEFAULT 0,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    source VARCHAR(20) NOT NULL DEFAULT 'qr_table', -- 'qr_table' | 'counter_pos'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_shop_created ON public.orders(shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_shop_status ON public.orders(shop_id, status);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all orders access" ON public.orders;
CREATE POLICY "Allow all orders access" ON public.orders FOR ALL USING (true) WITH CHECK (true);
