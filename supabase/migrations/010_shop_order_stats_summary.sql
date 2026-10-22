-- =========================================================================
-- QLAOK MIGRATION 010: SHOP ORDER REVENUE & INVENTORY SUMMARY RPC
-- =========================================================================
-- Computes full-history and 7-day Vietnam-timezone (UTC+7) order aggregates
-- directly in PostgreSQL so GET /api/orders, dbGetShopAnalyticsSummary, and
-- Mobile Overview are never truncated by PostgREST's 1000-row .select() cap,
-- while preserving financial invariants:
--   1. Only non-cancelled paid orders (status <> 'cancelled' AND payment_status = 'paid')
--      count as collected revenue.
--   2. Fulfillment (status) remains strictly independent of payment_status.
--   3. Direct client execution by anon/authenticated roles is blocked.
-- =========================================================================

CREATE INDEX IF NOT EXISTS idx_orders_shop_status_payment_created
  ON public.orders(shop_id, status, payment_status, created_at DESC);

CREATE OR REPLACE FUNCTION public.get_shop_order_stats_summary(
  p_shop_id text,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := COALESCE(p_now, now());
  v_today_key text := to_char((v_now AT TIME ZONE 'UTC') + interval '7 hours', 'YYYY-MM-DD');
  v_today_revenue bigint := 0;
  v_today_gross_amount bigint := 0;
  v_today_unpaid_amount bigint := 0;
  v_today_refunded_amount bigint := 0;
  v_total_refunded_amount bigint := 0;
  v_today_orders_count integer := 0;
  v_today_paid_orders_count integer := 0;
  v_today_completed_count integer := 0;
  v_completed_orders_count integer := 0;
  v_paid_orders_count integer := 0;
  v_total_revenue bigint := 0;
  v_total_orders_count integer := 0;
  v_new_orders_count integer := 0;
  v_preparing_orders_count integer := 0;
  v_avg_order_value bigint := 0;
  v_vietqr_count integer := 0;
  v_vietqr_revenue bigint := 0;
  v_cash_count integer := 0;
  v_cash_revenue bigint := 0;
  v_vietqr_pct integer := 65;
  v_cash_pct integer := 35;
  v_qr_table_count integer := 0;
  v_qr_table_revenue bigint := 0;
  v_counter_pos_count integer := 0;
  v_counter_pos_revenue bigint := 0;
  v_qr_table_pct integer := 75;
  v_counter_pos_pct integer := 25;
  v_daily_7d jsonb := '[]'::jsonb;
  v_hourly jsonb := '[]'::jsonb;
  v_item_sales jsonb := '[]'::jsonb;
BEGIN
  IF public.is_client_request_context() THEN
    RAISE EXCEPTION 'Direct client execution of get_shop_order_stats_summary is not permitted.';
  END IF;

  IF COALESCE(btrim(p_shop_id), '') = '' THEN
    RAISE EXCEPTION 'INVALID_SHOP_ID: p_shop_id is required.';
  END IF;

  SELECT
    COALESCE(SUM(GREATEST(COALESCE(o.total_amount, 0), 0)) FILTER (
      WHERE o.status <> 'cancelled'
        AND o.payment_status = 'paid'
        AND to_char((o.created_at AT TIME ZONE 'UTC') + interval '7 hours', 'YYYY-MM-DD') = v_today_key
    ), 0)::bigint,
    COALESCE(SUM(GREATEST(COALESCE(o.total_amount, 0), 0)) FILTER (
      WHERE o.status <> 'cancelled'
        AND to_char((o.created_at AT TIME ZONE 'UTC') + interval '7 hours', 'YYYY-MM-DD') = v_today_key
    ), 0)::bigint,
    COALESCE(SUM(GREATEST(COALESCE(o.total_amount, 0), 0)) FILTER (
      WHERE o.status <> 'cancelled'
        AND o.payment_status = 'unpaid'
        AND to_char((o.created_at AT TIME ZONE 'UTC') + interval '7 hours', 'YYYY-MM-DD') = v_today_key
    ), 0)::bigint,
    COALESCE(SUM(GREATEST(COALESCE(o.total_amount, 0), 0)) FILTER (
      WHERE o.payment_status = 'refunded'
        AND to_char((o.created_at AT TIME ZONE 'UTC') + interval '7 hours', 'YYYY-MM-DD') = v_today_key
    ), 0)::bigint,
    COALESCE(SUM(GREATEST(COALESCE(o.total_amount, 0), 0)) FILTER (
      WHERE o.payment_status = 'refunded'
    ), 0)::bigint,
    COUNT(*) FILTER (
      WHERE o.status <> 'cancelled'
        AND to_char((o.created_at AT TIME ZONE 'UTC') + interval '7 hours', 'YYYY-MM-DD') = v_today_key
    )::int,
    COUNT(*) FILTER (
      WHERE o.status <> 'cancelled'
        AND o.payment_status = 'paid'
        AND to_char((o.created_at AT TIME ZONE 'UTC') + interval '7 hours', 'YYYY-MM-DD') = v_today_key
    )::int,
    COUNT(*) FILTER (
      WHERE (o.status = 'completed' OR o.payment_status = 'paid')
        AND to_char((o.created_at AT TIME ZONE 'UTC') + interval '7 hours', 'YYYY-MM-DD') = v_today_key
    )::int,
    COUNT(*) FILTER (
      WHERE o.status = 'completed' OR o.payment_status = 'paid'
    )::int,
    COUNT(*) FILTER (
      WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
    )::int,
    COALESCE(SUM(GREATEST(COALESCE(o.total_amount, 0), 0)) FILTER (
      WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
    ), 0)::bigint,
    COUNT(*) FILTER (
      WHERE o.status <> 'cancelled'
    )::int,
    COUNT(*) FILTER (
      WHERE o.status = 'new'
    )::int,
    COUNT(*) FILTER (
      WHERE o.status = 'preparing'
    )::int,
    COUNT(*) FILTER (
      WHERE o.status <> 'cancelled'
        AND o.payment_status = 'paid'
        AND COALESCE(o.payment_method, 'cash') <> 'cash'
    )::int,
    COALESCE(SUM(GREATEST(COALESCE(o.total_amount, 0), 0)) FILTER (
      WHERE o.status <> 'cancelled'
        AND o.payment_status = 'paid'
        AND COALESCE(o.payment_method, 'cash') <> 'cash'
    ), 0)::bigint,
    COUNT(*) FILTER (
      WHERE o.status <> 'cancelled'
        AND o.payment_status = 'paid'
        AND COALESCE(o.payment_method, 'cash') = 'cash'
    )::int,
    COALESCE(SUM(GREATEST(COALESCE(o.total_amount, 0), 0)) FILTER (
      WHERE o.status <> 'cancelled'
        AND o.payment_status = 'paid'
        AND COALESCE(o.payment_method, 'cash') = 'cash'
    ), 0)::bigint,
    COUNT(*) FILTER (
      WHERE o.status <> 'cancelled'
        AND o.payment_status = 'paid'
        AND COALESCE(o.source, 'qr_table') <> 'counter_pos'
    )::int,
    COALESCE(SUM(GREATEST(COALESCE(o.total_amount, 0), 0)) FILTER (
      WHERE o.status <> 'cancelled'
        AND o.payment_status = 'paid'
        AND COALESCE(o.source, 'qr_table') <> 'counter_pos'
    ), 0)::bigint,
    COUNT(*) FILTER (
      WHERE o.status <> 'cancelled'
        AND o.payment_status = 'paid'
        AND o.source = 'counter_pos'
    )::int,
    COALESCE(SUM(GREATEST(COALESCE(o.total_amount, 0), 0)) FILTER (
      WHERE o.status <> 'cancelled'
        AND o.payment_status = 'paid'
        AND o.source = 'counter_pos'
    ), 0)::bigint
  INTO
    v_today_revenue,
    v_today_gross_amount,
    v_today_unpaid_amount,
    v_today_refunded_amount,
    v_total_refunded_amount,
    v_today_orders_count,
    v_today_paid_orders_count,
    v_today_completed_count,
    v_completed_orders_count,
    v_paid_orders_count,
    v_total_revenue,
    v_total_orders_count,
    v_new_orders_count,
    v_preparing_orders_count,
    v_vietqr_count,
    v_vietqr_revenue,
    v_cash_count,
    v_cash_revenue,
    v_qr_table_count,
    v_qr_table_revenue,
    v_counter_pos_count,
    v_counter_pos_revenue
  FROM public.orders o
  WHERE o.shop_id = p_shop_id;

  IF v_paid_orders_count > 0 THEN
    v_avg_order_value := ROUND(v_total_revenue::numeric / v_paid_orders_count::numeric)::bigint;
    v_qr_table_pct := ROUND((v_qr_table_count::numeric / v_paid_orders_count::numeric) * 100)::int;
    v_counter_pos_pct := GREATEST(0, 100 - v_qr_table_pct);
  END IF;

  IF v_total_revenue > 0 THEN
    v_vietqr_pct := ROUND((v_vietqr_revenue::numeric / v_total_revenue::numeric) * 100)::int;
    v_cash_pct := GREATEST(0, 100 - v_vietqr_pct);
  END IF;

  -- 7-day daily revenue & order count in Vietnam timezone (UTC+7)
  WITH days AS (
    SELECT
      g.days_ago,
      to_char(((v_now AT TIME ZONE 'UTC') + interval '7 hours') - (g.days_ago || ' days')::interval, 'YYYY-MM-DD') AS day_key,
      CASE
        WHEN g.days_ago = 0 THEN 'Hôm nay'
        ELSE to_char(((v_now AT TIME ZONE 'UTC') + interval '7 hours') - (g.days_ago || ' days')::interval, 'DD/MM')
      END AS day_label
    FROM generate_series(6, 0, -1) AS g(days_ago)
  ),
  day_agg AS (
    SELECT
      to_char((o.created_at AT TIME ZONE 'UTC') + interval '7 hours', 'YYYY-MM-DD') AS vn_date,
      COALESCE(SUM(GREATEST(COALESCE(o.total_amount, 0), 0)) FILTER (
        WHERE o.status <> 'cancelled' AND o.payment_status = 'paid'
      ), 0)::bigint AS revenue,
      COALESCE(SUM(GREATEST(COALESCE(o.total_amount, 0), 0)) FILTER (
        WHERE o.status <> 'cancelled' AND o.payment_status = 'paid' AND COALESCE(o.payment_method, 'cash') = 'cash'
      ), 0)::bigint AS cash_revenue,
      COALESCE(SUM(GREATEST(COALESCE(o.total_amount, 0), 0)) FILTER (
        WHERE o.status <> 'cancelled' AND o.payment_status = 'paid' AND COALESCE(o.payment_method, 'cash') <> 'cash'
      ), 0)::bigint AS vietqr_revenue,
      COUNT(*) FILTER (WHERE o.status <> 'cancelled')::int AS valid_orders
    FROM public.orders o
    WHERE o.shop_id = p_shop_id
    GROUP BY 1
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'date', d.day_key,
        'label', d.day_label,
        'revenue', COALESCE(a.revenue, 0),
        'cashRevenue', COALESCE(a.cash_revenue, 0),
        'vietqrRevenue', COALESCE(a.vietqr_revenue, 0),
        'orders', COALESCE(a.valid_orders, 0),
        'orderCount', COALESCE(a.valid_orders, 0)
      )
      ORDER BY d.days_ago DESC
    ),
    '[]'::jsonb
  )
  INTO v_daily_7d
  FROM days d
  LEFT JOIN day_agg a ON a.vn_date = d.day_key;

  -- Peak hours breakdown (6 slots in Vietnam timezone UTC+7)
  WITH slots(idx, slot, label, min_h, max_h) AS (
    VALUES
      (1, '06h-09h', 'Sáng (6-9h)', 6, 9),
      (2, '09h-12h', 'Trưa (9-12h)', 9, 12),
      (3, '12h-15h', 'Chiều (12-15h)', 12, 15),
      (4, '15h-18h', 'Xế (15-18h)', 15, 18),
      (5, '18h-21h', 'Tối (18-21h)', 18, 21),
      (6, '21h-24h', 'Đêm (21-24h)', 21, 24)
  ),
  slot_agg AS (
    SELECT
      s.idx,
      s.slot,
      s.label,
      COUNT(o.id)::int AS orders_count,
      COALESCE(SUM(GREATEST(COALESCE(o.total_amount, 0), 0)), 0)::bigint AS revenue
    FROM slots s
    LEFT JOIN public.orders o
      ON o.shop_id = p_shop_id
     AND o.status <> 'cancelled'
     AND o.payment_status = 'paid'
     AND EXTRACT(HOUR FROM ((o.created_at AT TIME ZONE 'UTC') + interval '7 hours'))::int >= s.min_h
     AND EXTRACT(HOUR FROM ((o.created_at AT TIME ZONE 'UTC') + interval '7 hours'))::int < s.max_h
    GROUP BY s.idx, s.slot, s.label
  ),
  max_slot AS (
    SELECT GREATEST(COALESCE(MAX(revenue), 0), 1)::numeric AS max_rev
    FROM slot_agg
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'slot', sa.slot,
        'label', sa.label,
        'orders', sa.orders_count,
        'revenue', sa.revenue,
        'percentage', CASE
          WHEN sa.revenue > 0 THEN GREATEST(14, ROUND((sa.revenue::numeric / ms.max_rev) * 100)::int)
          ELSE 8
        END
      )
      ORDER BY sa.idx ASC
    ),
    '[]'::jsonb
  )
  INTO v_hourly
  FROM slot_agg sa
  CROSS JOIN max_slot ms;

  -- Aggregated item sales across all non-cancelled shop orders
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'item_id', item_agg.item_id,
        'qty', item_agg.qty,
        'rev', item_agg.rev
      )
    ),
    '[]'::jsonb
  )
  INTO v_item_sales
  FROM (
    SELECT
      COALESCE(line.value->>'item_id', '') AS item_id,
      COALESCE(
        SUM(
          GREATEST(
            CASE
              WHEN COALESCE(line.value->>'quantity', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
              THEN (line.value->>'quantity')::numeric
              ELSE 1
            END,
            0
          )
        ),
        0
      )::bigint AS qty,
      COALESCE(
        SUM(
          (
            CASE
              WHEN COALESCE(line.value->>'unit_price', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
              THEN (line.value->>'unit_price')::numeric
              ELSE 0
            END
            +
            CASE
              WHEN COALESCE(line.value->>'extra_price', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
              THEN (line.value->>'extra_price')::numeric
              ELSE 0
            END
          )
          *
          GREATEST(
            CASE
              WHEN COALESCE(line.value->>'quantity', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
              THEN (line.value->>'quantity')::numeric
              ELSE 1
            END,
            0
          )
        ),
        0
      )::bigint AS rev
    FROM public.orders o,
    LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END
    ) AS line(value)
    WHERE o.shop_id = p_shop_id
      AND o.status <> 'cancelled'
      AND COALESCE(line.value->>'item_id', '') <> ''
    GROUP BY COALESCE(line.value->>'item_id', '')
  ) AS item_agg;

  RETURN jsonb_build_object(
    'todayRevenue', v_today_revenue,
    'todayGrossOrderAmount', v_today_gross_amount,
    'todayUnpaidAmount', v_today_unpaid_amount,
    'todayRefundedAmount', v_today_refunded_amount,
    'totalRefundedAmount', v_total_refunded_amount,
    'todayOrdersCount', v_today_orders_count,
    'todayPaidOrdersCount', v_today_paid_orders_count,
    'todayCompletedCount', v_today_completed_count,
    'completedOrdersCount', v_completed_orders_count,
    'paidOrdersCount', v_paid_orders_count,
    'totalRevenue', v_total_revenue,
    'totalOrdersCount', v_total_orders_count,
    'newOrdersCount', v_new_orders_count,
    'preparingOrdersCount', v_preparing_orders_count,
    'avgOrderValue', v_avg_order_value,
    'dailyRevenue7d', v_daily_7d,
    'paymentBreakdown', jsonb_build_object(
      'vietqr', jsonb_build_object(
        'count', v_vietqr_count,
        'revenue', v_vietqr_revenue,
        'percentage', v_vietqr_pct
      ),
      'cash', jsonb_build_object(
        'count', v_cash_count,
        'revenue', v_cash_revenue,
        'percentage', v_cash_pct
      )
    ),
    'sourceBreakdown', jsonb_build_object(
      'qr_table', jsonb_build_object(
        'count', v_qr_table_count,
        'revenue', v_qr_table_revenue,
        'percentage', v_qr_table_pct
      ),
      'counter_pos', jsonb_build_object(
        'count', v_counter_pos_count,
        'revenue', v_counter_pos_revenue,
        'percentage', v_counter_pos_pct
      )
    ),
    'hourlyBreakdown', v_hourly,
    'itemSales', v_item_sales
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_shop_order_stats_summary(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_shop_order_stats_summary(text, timestamptz) TO service_role;
