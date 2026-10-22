-- =========================================================================
-- QLAOK MIGRATION 011: SEPAY VIETQR CUSTOMER ORDER RECONCILIATION
-- =========================================================================
-- Separate from the SaaS plan-upgrade /api/webhooks/payment flow.
-- Provides:
--   1. public.shop_sepay_configs: Private per-shop integration table storing
--      AES-256-GCM encrypted SePay HMAC secrets outside public.shops.theme_config.
--   2. Trigger on public.shops preventing accidental storage of SePay secrets
--      in public theme_config JSONB.
--   3. public.sepay_webhook_events: Idempotent per-shop webhook transaction
--      ledger tracking SePay transaction IDs, payload hashes, bank reference
--      codes, outcomes, replay counts, and conflicting reuse attempts.
--   4. public.reconcile_sepay_order_payment_atomic: Server-only atomic RPC
--      that reconciles inbound VietQR order payments under row/advisory locks
--      while keeping fulfillment status and inventory strictly untouched.
-- =========================================================================

-- 1. Private Per-Shop SePay Integration Config Table
CREATE TABLE IF NOT EXISTS public.shop_sepay_configs (
  shop_id TEXT PRIMARY KEY REFERENCES public.shops(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  secret_ciphertext TEXT NOT NULL CHECK (btrim(secret_ciphertext) <> ''),
  secret_iv TEXT NOT NULL CHECK (btrim(secret_iv) <> ''),
  secret_auth_tag TEXT NOT NULL CHECK (btrim(secret_auth_tag) <> ''),
  key_version INTEGER NOT NULL DEFAULT 1 CHECK (key_version >= 1),
  updated_by TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.shop_sepay_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shop_sepay_configs_service_only" ON public.shop_sepay_configs;
CREATE POLICY "shop_sepay_configs_service_only"
  ON public.shop_sepay_configs
  AS RESTRICTIVE
  FOR ALL
  USING (NOT public.is_client_request_context())
  WITH CHECK (NOT public.is_client_request_context());

REVOKE ALL ON TABLE public.shop_sepay_configs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shop_sepay_configs TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_shop_sepay_configs_boundaries()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_client_request_context() THEN
    RAISE EXCEPTION 'FORBIDDEN_SEPAY_CONFIG_DIRECT_ACCESS: Cấu hình bảo mật SePay chỉ được truy cập qua máy chủ API.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  NEW.shop_id := btrim(COALESCE(NEW.shop_id, ''));
  NEW.secret_ciphertext := btrim(COALESCE(NEW.secret_ciphertext, ''));
  NEW.secret_iv := btrim(COALESCE(NEW.secret_iv, ''));
  NEW.secret_auth_tag := btrim(COALESCE(NEW.secret_auth_tag, ''));

  IF NEW.shop_id = '' OR NEW.secret_ciphertext = '' OR NEW.secret_iv = '' OR NEW.secret_auth_tag = '' THEN
    RAISE EXCEPTION 'INVALID_SEPAY_CONFIG_FIELDS: Thiếu shop_id hoặc dữ liệu mã hóa khóa bí mật SePay.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.shop_id IS DISTINCT FROM OLD.shop_id THEN
      RAISE EXCEPTION 'IMMUTABLE_SEPAY_CONFIG_SHOP: Không được phép đổi shop_id của cấu hình SePay.';
    END IF;
    NEW.updated_at := COALESCE(NEW.updated_at, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_shop_sepay_configs_boundaries ON public.shop_sepay_configs;
CREATE TRIGGER trg_enforce_shop_sepay_configs_boundaries
  BEFORE INSERT OR UPDATE OR DELETE ON public.shop_sepay_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_shop_sepay_configs_boundaries();

-- 2. Guard against storing SePay secrets inside public.shops.theme_config
CREATE OR REPLACE FUNCTION public.prevent_sepay_secret_in_shop_theme()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tc JSONB;
  v_pc JSONB;
BEGIN
  v_tc := COALESCE(NEW.theme_config, '{}'::jsonb);
  IF jsonb_typeof(v_tc) = 'object' THEN
    IF (v_tc ? 'sepaySecret')
       OR (v_tc ? 'sepay_secret')
       OR (v_tc ? 'webhookSecret')
       OR (v_tc ? 'webhook_secret')
       OR (v_tc ? 'secret_ciphertext')
       OR (v_tc ? 'hmacSecret')
       OR (v_tc ? 'hmac_secret') THEN
      RAISE EXCEPTION 'FORBIDDEN_PUBLIC_SEPAY_SECRET: Không được lưu khóa bí mật SePay trong theme_config công khai của cửa hàng.';
    END IF;

    v_pc := COALESCE(v_tc->'paymentConfig', '{}'::jsonb);
    IF jsonb_typeof(v_pc) = 'object' AND (
       (v_pc ? 'sepaySecret')
       OR (v_pc ? 'sepay_secret')
       OR (v_pc ? 'webhookSecret')
       OR (v_pc ? 'webhook_secret')
       OR (v_pc ? 'secret_ciphertext')
       OR (v_pc ? 'hmacSecret')
       OR (v_pc ? 'hmac_secret')
    ) THEN
      RAISE EXCEPTION 'FORBIDDEN_PUBLIC_SEPAY_SECRET: Không được lưu khóa bí mật SePay trong theme_config.paymentConfig.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_sepay_secret_in_shop_theme ON public.shops;
CREATE TRIGGER trg_prevent_sepay_secret_in_shop_theme
  BEFORE INSERT OR UPDATE ON public.shops
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_sepay_secret_in_shop_theme();

-- 3. Idempotent SePay Webhook Transaction Event Ledger
CREATE TABLE IF NOT EXISTS public.sepay_webhook_events (
  id TEXT PRIMARY KEY DEFAULT 'sepay-evt-' || substr(md5(random()::text || clock_timestamp()::text), 1, 14),
  shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  sepay_transaction_id TEXT NOT NULL CHECK (btrim(sepay_transaction_id) <> ''),
  payload_hash TEXT NOT NULL CHECK (btrim(payload_hash) <> ''),
  reference_code TEXT DEFAULT NULL,
  transfer_type TEXT NOT NULL DEFAULT 'unknown' CHECK (transfer_type IN ('in', 'out', 'unknown')),
  transfer_amount BIGINT NOT NULL DEFAULT 0,
  account_number TEXT DEFAULT NULL,
  extracted_order_code TEXT DEFAULT NULL,
  order_id TEXT REFERENCES public.orders(id) ON DELETE SET NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('reconciled', 'rejected', 'conflict')),
  reason_code TEXT NOT NULL CHECK (btrim(reason_code) <> ''),
  delivery_count INTEGER NOT NULL DEFAULT 1 CHECK (delivery_count >= 1),
  conflict_count INTEGER NOT NULL DEFAULT 0 CHECK (conflict_count >= 0),
  last_conflict_hash TEXT DEFAULT NULL,
  last_conflict_at TIMESTAMPTZ DEFAULT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, sepay_transaction_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sepay_webhook_events_shop_reconciled_ref
  ON public.sepay_webhook_events(shop_id, reference_code)
  WHERE outcome = 'reconciled' AND reference_code IS NOT NULL AND btrim(reference_code) <> '';

-- A single SePay transaction or bank referenceCode can never reconcile more than one order across all shops
CREATE UNIQUE INDEX IF NOT EXISTS idx_sepay_webhook_events_global_reconciled_tx
  ON public.sepay_webhook_events(sepay_transaction_id)
  WHERE outcome = 'reconciled';

CREATE UNIQUE INDEX IF NOT EXISTS idx_sepay_webhook_events_global_reconciled_ref
  ON public.sepay_webhook_events(reference_code)
  WHERE outcome = 'reconciled' AND reference_code IS NOT NULL AND btrim(reference_code) <> '';

CREATE INDEX IF NOT EXISTS idx_sepay_webhook_events_shop_order
  ON public.sepay_webhook_events(shop_id, order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sepay_webhook_events_shop_created
  ON public.sepay_webhook_events(shop_id, created_at DESC);

ALTER TABLE public.sepay_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sepay_webhook_events_service_only" ON public.sepay_webhook_events;
CREATE POLICY "sepay_webhook_events_service_only"
  ON public.sepay_webhook_events
  AS RESTRICTIVE
  FOR ALL
  USING (NOT public.is_client_request_context())
  WITH CHECK (NOT public.is_client_request_context());

REVOKE ALL ON TABLE public.sepay_webhook_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sepay_webhook_events TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_sepay_webhook_events_boundaries()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_client_request_context() THEN
    RAISE EXCEPTION 'FORBIDDEN_SEPAY_EVENTS_DIRECT_ACCESS: Nhật ký webhook SePay chỉ được quản lý bởi máy chủ.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  NEW.shop_id := btrim(COALESCE(NEW.shop_id, ''));
  NEW.sepay_transaction_id := btrim(COALESCE(NEW.sepay_transaction_id, ''));
  NEW.payload_hash := btrim(COALESCE(NEW.payload_hash, ''));
  NEW.reason_code := btrim(COALESCE(NEW.reason_code, ''));
  NEW.reference_code := NULLIF(btrim(COALESCE(NEW.reference_code, '')), '');

  IF NEW.shop_id = '' OR NEW.sepay_transaction_id = '' OR NEW.payload_hash = '' OR NEW.reason_code = '' THEN
    RAISE EXCEPTION 'INVALID_SEPAY_EVENT_FIELDS: Thiếu trường bắt buộc của sự kiện webhook SePay.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.shop_id IS DISTINCT FROM OLD.shop_id
       OR NEW.sepay_transaction_id IS DISTINCT FROM OLD.sepay_transaction_id
       OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash THEN
      RAISE EXCEPTION 'IMMUTABLE_SEPAY_EVENT_IDENTITY: Không được phép thay đổi định danh hoặc payload_hash gốc của sự kiện SePay.';
    END IF;

    IF OLD.outcome = 'reconciled' AND (
       NEW.outcome IS DISTINCT FROM 'reconciled'
       OR NEW.order_id IS DISTINCT FROM OLD.order_id
    ) THEN
      RAISE EXCEPTION 'IMMUTABLE_SEPAY_EVENT_OUTCOME: Sự kiện SePay đã đối soát thành công không thể đổi ngược trạng thái.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_sepay_webhook_events_boundaries ON public.sepay_webhook_events;
CREATE TRIGGER trg_enforce_sepay_webhook_events_boundaries
  BEFORE INSERT OR UPDATE OR DELETE ON public.sepay_webhook_events
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_sepay_webhook_events_boundaries();

-- 4. Atomic Order Reconciliation RPC for SePay Webhooks
CREATE OR REPLACE FUNCTION public.reconcile_sepay_order_payment_atomic(
  p_shop_id TEXT,
  p_sepay_transaction_id TEXT,
  p_payload_hash TEXT,
  p_transfer_type TEXT DEFAULT 'in',
  p_transfer_amount BIGINT DEFAULT 0,
  p_account_number TEXT DEFAULT NULL,
  p_reference_code TEXT DEFAULT NULL,
  p_extracted_order_code TEXT DEFAULT NULL,
  p_target_order_id TEXT DEFAULT NULL,
  p_precheck_reason_code TEXT DEFAULT NULL,
  p_raw_payload JSONB DEFAULT '{}'::jsonb,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shop_id TEXT := btrim(COALESCE(p_shop_id, ''));
  v_tx_id TEXT := btrim(COALESCE(p_sepay_transaction_id, ''));
  v_payload_hash TEXT := btrim(COALESCE(p_payload_hash, ''));
  v_transfer_type TEXT := CASE
    WHEN lower(btrim(COALESCE(p_transfer_type, ''))) IN ('in', 'out')
      THEN lower(btrim(p_transfer_type))
    ELSE 'unknown'
  END;
  v_transfer_amount BIGINT := COALESCE(p_transfer_amount, 0);
  v_account_number TEXT := NULLIF(btrim(COALESCE(p_account_number, '')), '');
  v_reference_code TEXT := NULLIF(btrim(COALESCE(p_reference_code, '')), '');
  v_extracted_code TEXT := NULLIF(btrim(COALESCE(p_extracted_order_code, '')), '');
  v_target_order_id TEXT := NULLIF(btrim(COALESCE(p_target_order_id, '')), '');
  v_precheck_reason TEXT := NULLIF(btrim(COALESCE(p_precheck_reason_code, '')), '');
  v_now TIMESTAMPTZ := COALESCE(p_now, now());
  v_existing_evt public.sepay_webhook_events%ROWTYPE;
  v_inserted_evt public.sepay_webhook_events%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_updated_order public.orders%ROWTYPE;
  v_order_json JSONB := NULL;
  v_pay_idemp_key TEXT;
  v_paid_by TEXT;
  v_reject_reason TEXT := NULL;
BEGIN
  IF public.is_client_request_context() THEN
    RAISE EXCEPTION 'Direct client execution of reconcile_sepay_order_payment_atomic is not permitted.';
  END IF;

  IF v_shop_id = '' OR v_tx_id = '' OR v_payload_hash = '' THEN
    RAISE EXCEPTION 'INVALID_SEPAY_RECONCILE_ARGS: shop_id, sepay_transaction_id, and payload_hash are required.';
  END IF;

  -- Serialize concurrent deliveries globally by transaction ID and per (shop_id, sepay_transaction_id)
  PERFORM pg_advisory_xact_lock(hashtext('sepay_global_tx:' || v_tx_id));
  PERFORM pg_advisory_xact_lock(hashtext('sepay_tx:' || v_shop_id || ':' || v_tx_id));

  SELECT * INTO v_existing_evt
  FROM public.sepay_webhook_events
  WHERE shop_id = v_shop_id
    AND sepay_transaction_id = v_tx_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_evt.payload_hash <> v_payload_hash THEN
      UPDATE public.sepay_webhook_events
      SET
        conflict_count = conflict_count + 1,
        last_conflict_hash = v_payload_hash,
        last_conflict_at = v_now,
        updated_at = v_now
      WHERE id = v_existing_evt.id
      RETURNING * INTO v_existing_evt;

      RETURN jsonb_build_object(
        'outcome', 'conflict',
        'reconciled', FALSE,
        'duplicate', FALSE,
        'reason_code', 'CONFLICTING_WEBHOOK_EVENT',
        'event_id', v_existing_evt.id,
        'order_id', v_existing_evt.order_id,
        'delivery_count', v_existing_evt.delivery_count,
        'conflict_count', v_existing_evt.conflict_count
      );
    END IF;

    -- Only already-reconciled events short-circuit as duplicate no-ops.
    -- Previously rejected/conflict events with an identical payload_hash are re-evaluated
    -- so transient ORDER_NOT_FOUND races or fixed shop account/prefix configs can recover on retry.
    IF v_existing_evt.outcome = 'reconciled' THEN
      UPDATE public.sepay_webhook_events
      SET
        delivery_count = delivery_count + 1,
        updated_at = v_now
      WHERE id = v_existing_evt.id
      RETURNING * INTO v_existing_evt;

      IF v_existing_evt.order_id IS NOT NULL THEN
        SELECT to_jsonb(o) INTO v_order_json
        FROM public.orders o
        WHERE o.id = v_existing_evt.order_id
          AND o.shop_id = v_shop_id;
      END IF;

      RETURN jsonb_build_object(
        'outcome', 'reconciled',
        'reconciled', TRUE,
        'duplicate', TRUE,
        'reason_code', v_existing_evt.reason_code,
        'event_id', v_existing_evt.id,
        'order_id', v_existing_evt.order_id,
        'delivery_count', v_existing_evt.delivery_count,
        'conflict_count', v_existing_evt.conflict_count,
        'order', v_order_json
      );
    END IF;
  END IF;

  -- Guard against cross-shop fan-out where another shop already reconciled this same SePay transaction ID
  IF EXISTS (
    SELECT 1
    FROM public.sepay_webhook_events e
    WHERE e.sepay_transaction_id = v_tx_id
      AND e.outcome = 'reconciled'
      AND e.shop_id <> v_shop_id
  ) THEN
    INSERT INTO public.sepay_webhook_events (
      shop_id,
      sepay_transaction_id,
      payload_hash,
      reference_code,
      transfer_type,
      transfer_amount,
      account_number,
      extracted_order_code,
      order_id,
      outcome,
      reason_code,
      conflict_count,
      last_conflict_hash,
      last_conflict_at,
      raw_payload,
      created_at,
      updated_at
    ) VALUES (
      v_shop_id,
      v_tx_id,
      v_payload_hash,
      v_reference_code,
      v_transfer_type,
      v_transfer_amount,
      v_account_number,
      v_extracted_code,
      NULL,
      'conflict',
      'CONFLICTING_WEBHOOK_EVENT',
      1,
      v_payload_hash,
      v_now,
      COALESCE(p_raw_payload, '{}'::jsonb),
      v_now,
      v_now
    )
    ON CONFLICT (shop_id, sepay_transaction_id) DO UPDATE SET
      outcome = 'conflict',
      reason_code = 'CONFLICTING_WEBHOOK_EVENT',
      delivery_count = public.sepay_webhook_events.delivery_count + 1,
      conflict_count = public.sepay_webhook_events.conflict_count + 1,
      last_conflict_hash = v_payload_hash,
      last_conflict_at = v_now,
      updated_at = v_now
    RETURNING * INTO v_inserted_evt;

    RETURN jsonb_build_object(
      'outcome', 'conflict',
      'reconciled', FALSE,
      'duplicate', FALSE,
      'reason_code', 'CONFLICTING_WEBHOOK_EVENT',
      'event_id', v_inserted_evt.id,
      'order_id', NULL,
      'delivery_count', v_inserted_evt.delivery_count,
      'conflict_count', v_inserted_evt.conflict_count
    );
  END IF;

  -- If caller precheck already determined a rejection reason (e.g. outbound transfer, account mismatch, missing/ambiguous order code)
  IF v_precheck_reason IS NOT NULL THEN
    IF v_target_order_id IS NOT NULL THEN
      PERFORM 1 FROM public.orders WHERE id = v_target_order_id AND shop_id = v_shop_id;
      IF NOT FOUND THEN
        v_target_order_id := NULL;
      END IF;
    END IF;

    INSERT INTO public.sepay_webhook_events (
      shop_id,
      sepay_transaction_id,
      payload_hash,
      reference_code,
      transfer_type,
      transfer_amount,
      account_number,
      extracted_order_code,
      order_id,
      outcome,
      reason_code,
      raw_payload,
      created_at,
      updated_at
    ) VALUES (
      v_shop_id,
      v_tx_id,
      v_payload_hash,
      v_reference_code,
      v_transfer_type,
      v_transfer_amount,
      v_account_number,
      v_extracted_code,
      v_target_order_id,
      'rejected',
      v_precheck_reason,
      COALESCE(p_raw_payload, '{}'::jsonb),
      v_now,
      v_now
    )
    ON CONFLICT (shop_id, sepay_transaction_id) DO UPDATE SET
      reference_code = EXCLUDED.reference_code,
      transfer_type = EXCLUDED.transfer_type,
      transfer_amount = EXCLUDED.transfer_amount,
      account_number = EXCLUDED.account_number,
      extracted_order_code = EXCLUDED.extracted_order_code,
      order_id = EXCLUDED.order_id,
      outcome = 'rejected',
      reason_code = EXCLUDED.reason_code,
      delivery_count = public.sepay_webhook_events.delivery_count + 1,
      updated_at = v_now
    RETURNING * INTO v_inserted_evt;

    RETURN jsonb_build_object(
      'outcome', 'rejected',
      'reconciled', FALSE,
      'duplicate', FALSE,
      'reason_code', v_precheck_reason,
      'event_id', v_inserted_evt.id,
      'order_id', v_inserted_evt.order_id,
      'delivery_count', v_inserted_evt.delivery_count,
      'conflict_count', v_inserted_evt.conflict_count
    );
  END IF;

  -- Guard against conflicting reuse of the same bank reference_code across different SePay transaction IDs or shops
  IF v_reference_code IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('sepay_global_ref:' || v_reference_code));
    PERFORM pg_advisory_xact_lock(hashtext('sepay_ref:' || v_shop_id || ':' || v_reference_code));
    IF EXISTS (
      SELECT 1
      FROM public.sepay_webhook_events e
      WHERE e.outcome = 'reconciled'
        AND e.reference_code = v_reference_code
        AND (e.shop_id <> v_shop_id OR e.sepay_transaction_id <> v_tx_id)
    ) THEN
      INSERT INTO public.sepay_webhook_events (
        shop_id,
        sepay_transaction_id,
        payload_hash,
        reference_code,
        transfer_type,
        transfer_amount,
        account_number,
        extracted_order_code,
        order_id,
        outcome,
        reason_code,
        conflict_count,
        last_conflict_hash,
        last_conflict_at,
        raw_payload,
        created_at,
        updated_at
      ) VALUES (
        v_shop_id,
        v_tx_id,
        v_payload_hash,
        v_reference_code,
        v_transfer_type,
        v_transfer_amount,
        v_account_number,
        v_extracted_code,
        NULL,
        'conflict',
        'CONFLICTING_BANK_REFERENCE',
        1,
        v_payload_hash,
        v_now,
        COALESCE(p_raw_payload, '{}'::jsonb),
        v_now,
        v_now
      )
      ON CONFLICT (shop_id, sepay_transaction_id) DO UPDATE SET
        reference_code = EXCLUDED.reference_code,
        outcome = 'conflict',
        reason_code = 'CONFLICTING_BANK_REFERENCE',
        delivery_count = public.sepay_webhook_events.delivery_count + 1,
        conflict_count = public.sepay_webhook_events.conflict_count + 1,
        last_conflict_hash = v_payload_hash,
        last_conflict_at = v_now,
        updated_at = v_now
      RETURNING * INTO v_inserted_evt;

      RETURN jsonb_build_object(
        'outcome', 'conflict',
        'reconciled', FALSE,
        'duplicate', FALSE,
        'reason_code', 'CONFLICTING_BANK_REFERENCE',
        'event_id', v_inserted_evt.id,
        'order_id', NULL,
        'delivery_count', v_inserted_evt.delivery_count,
        'conflict_count', v_inserted_evt.conflict_count
      );
    END IF;
  END IF;

  IF v_target_order_id IS NULL THEN
    INSERT INTO public.sepay_webhook_events (
      shop_id,
      sepay_transaction_id,
      payload_hash,
      reference_code,
      transfer_type,
      transfer_amount,
      account_number,
      extracted_order_code,
      order_id,
      outcome,
      reason_code,
      raw_payload,
      created_at,
      updated_at
    ) VALUES (
      v_shop_id,
      v_tx_id,
      v_payload_hash,
      v_reference_code,
      v_transfer_type,
      v_transfer_amount,
      v_account_number,
      v_extracted_code,
      NULL,
      'rejected',
      'ORDER_NOT_FOUND',
      COALESCE(p_raw_payload, '{}'::jsonb),
      v_now,
      v_now
    )
    ON CONFLICT (shop_id, sepay_transaction_id) DO UPDATE SET
      reference_code = EXCLUDED.reference_code,
      transfer_type = EXCLUDED.transfer_type,
      transfer_amount = EXCLUDED.transfer_amount,
      account_number = EXCLUDED.account_number,
      extracted_order_code = EXCLUDED.extracted_order_code,
      order_id = NULL,
      outcome = 'rejected',
      reason_code = 'ORDER_NOT_FOUND',
      delivery_count = public.sepay_webhook_events.delivery_count + 1,
      updated_at = v_now
    RETURNING * INTO v_inserted_evt;

    RETURN jsonb_build_object(
      'outcome', 'rejected',
      'reconciled', FALSE,
      'duplicate', FALSE,
      'reason_code', 'ORDER_NOT_FOUND',
      'event_id', v_inserted_evt.id,
      'order_id', NULL,
      'delivery_count', v_inserted_evt.delivery_count,
      'conflict_count', v_inserted_evt.conflict_count
    );
  END IF;

  -- Lock target order row within the target shop
  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.id = v_target_order_id
    AND o.shop_id = v_shop_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.sepay_webhook_events (
      shop_id,
      sepay_transaction_id,
      payload_hash,
      reference_code,
      transfer_type,
      transfer_amount,
      account_number,
      extracted_order_code,
      order_id,
      outcome,
      reason_code,
      raw_payload,
      created_at,
      updated_at
    ) VALUES (
      v_shop_id,
      v_tx_id,
      v_payload_hash,
      v_reference_code,
      v_transfer_type,
      v_transfer_amount,
      v_account_number,
      v_extracted_code,
      NULL,
      'rejected',
      'ORDER_NOT_FOUND',
      COALESCE(p_raw_payload, '{}'::jsonb),
      v_now,
      v_now
    )
    ON CONFLICT (shop_id, sepay_transaction_id) DO UPDATE SET
      reference_code = EXCLUDED.reference_code,
      transfer_type = EXCLUDED.transfer_type,
      transfer_amount = EXCLUDED.transfer_amount,
      account_number = EXCLUDED.account_number,
      extracted_order_code = EXCLUDED.extracted_order_code,
      order_id = NULL,
      outcome = 'rejected',
      reason_code = 'ORDER_NOT_FOUND',
      delivery_count = public.sepay_webhook_events.delivery_count + 1,
      updated_at = v_now
    RETURNING * INTO v_inserted_evt;

    RETURN jsonb_build_object(
      'outcome', 'rejected',
      'reconciled', FALSE,
      'duplicate', FALSE,
      'reason_code', 'ORDER_NOT_FOUND',
      'event_id', v_inserted_evt.id,
      'order_id', NULL,
      'delivery_count', v_inserted_evt.delivery_count,
      'conflict_count', v_inserted_evt.conflict_count
    );
  END IF;

  -- Fail closed on cross-shop order_code collision when another shop shares the same bank account and transferPrefix
  IF v_account_number IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.orders o2
    JOIN public.shops s2 ON s2.id = o2.shop_id
    LEFT JOIN public.shops s1 ON s1.id = v_shop_id
    WHERE o2.shop_id <> v_shop_id
      AND o2.status <> 'cancelled'
      AND COALESCE(o2.payment_method, 'cash') = 'vietqr'
      AND upper(btrim(o2.order_code)) = upper(btrim(v_order.order_code))
      AND (
        upper(regexp_replace(COALESCE(
          s2.theme_config->'paymentConfig'->>'accountNumber',
          s2.theme_config->'paymentConfig'->>'accountNo',
          s2.theme_config->'paymentQr'->>'accountNumber',
          s2.theme_config->'paymentQr'->>'accountNo',
          ''
        ), '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(v_account_number, '[^A-Za-z0-9]', '', 'g'))
        OR EXISTS (
          SELECT 1
          FROM public.shop_sepay_configs sc2
          WHERE sc2.shop_id = o2.shop_id
            AND sc2.enabled = TRUE
        )
      )
      AND upper(btrim(COALESCE(NULLIF(btrim(s2.theme_config->'paymentConfig'->>'transferPrefix'), ''), 'QLAOK')))
        = upper(btrim(COALESCE(NULLIF(btrim(s1.theme_config->'paymentConfig'->>'transferPrefix'), ''), 'QLAOK')))
  ) THEN
    v_reject_reason := 'AMBIGUOUS_ORDER_CODE';
  ELSIF v_transfer_type <> 'in' THEN
    v_reject_reason := 'OUTBOUND_TRANSFER';
  ELSIF v_order.status = 'cancelled' THEN
    v_reject_reason := 'ORDER_CANCELLED';
  ELSIF COALESCE(v_order.payment_method, 'cash') <> 'vietqr' THEN
    v_reject_reason := 'PAYMENT_METHOD_NOT_VIETQR';
  ELSIF v_order.payment_status <> 'unpaid' THEN
    v_reject_reason := 'ORDER_ALREADY_PAID';
  ELSIF v_transfer_amount <= 0 OR COALESCE(v_order.total_amount, 0)::BIGINT <> v_transfer_amount THEN
    v_reject_reason := 'AMOUNT_MISMATCH';
  END IF;

  IF v_reject_reason IS NOT NULL THEN
    INSERT INTO public.sepay_webhook_events (
      shop_id,
      sepay_transaction_id,
      payload_hash,
      reference_code,
      transfer_type,
      transfer_amount,
      account_number,
      extracted_order_code,
      order_id,
      outcome,
      reason_code,
      raw_payload,
      created_at,
      updated_at
    ) VALUES (
      v_shop_id,
      v_tx_id,
      v_payload_hash,
      v_reference_code,
      v_transfer_type,
      v_transfer_amount,
      v_account_number,
      v_extracted_code,
      v_order.id,
      'rejected',
      v_reject_reason,
      COALESCE(p_raw_payload, '{}'::jsonb),
      v_now,
      v_now
    )
    ON CONFLICT (shop_id, sepay_transaction_id) DO UPDATE SET
      reference_code = EXCLUDED.reference_code,
      transfer_type = EXCLUDED.transfer_type,
      transfer_amount = EXCLUDED.transfer_amount,
      account_number = EXCLUDED.account_number,
      extracted_order_code = EXCLUDED.extracted_order_code,
      order_id = EXCLUDED.order_id,
      outcome = 'rejected',
      reason_code = EXCLUDED.reason_code,
      delivery_count = public.sepay_webhook_events.delivery_count + 1,
      updated_at = v_now
    RETURNING * INTO v_inserted_evt;

    RETURN jsonb_build_object(
      'outcome', 'rejected',
      'reconciled', FALSE,
      'duplicate', FALSE,
      'reason_code', v_reject_reason,
      'event_id', v_inserted_evt.id,
      'order_id', v_order.id,
      'delivery_count', v_inserted_evt.delivery_count,
      'conflict_count', v_inserted_evt.conflict_count,
      'order', to_jsonb(v_order)
    );
  END IF;

  v_pay_idemp_key := 'sepay:' || v_shop_id || ':' || v_tx_id;
  v_paid_by := CASE
    WHEN v_reference_code IS NOT NULL THEN 'sepay:' || v_tx_id || ':' || v_reference_code
    ELSE 'sepay:' || v_tx_id
  END;

  -- Strictly update payment fields ONLY; fulfillment status, totals, and inventory are never changed
  UPDATE public.orders
  SET
    payment_status = 'paid',
    payment_idempotency_key = v_pay_idemp_key,
    paid_at = v_now,
    paid_by = v_paid_by,
    updated_at = v_now
  WHERE id = v_order.id
    AND shop_id = v_shop_id
    AND payment_status = 'unpaid'
    AND status <> 'cancelled'
    AND payment_method = 'vietqr'
  RETURNING * INTO v_updated_order;

  INSERT INTO public.sepay_webhook_events (
    shop_id,
    sepay_transaction_id,
    payload_hash,
    reference_code,
    transfer_type,
    transfer_amount,
    account_number,
    extracted_order_code,
    order_id,
    outcome,
    reason_code,
    raw_payload,
    created_at,
    updated_at
  ) VALUES (
    v_shop_id,
    v_tx_id,
    v_payload_hash,
    v_reference_code,
    v_transfer_type,
    v_transfer_amount,
    v_account_number,
    v_extracted_code,
    v_updated_order.id,
    'reconciled',
    'OK',
    COALESCE(p_raw_payload, '{}'::jsonb),
    v_now,
    v_now
  )
  ON CONFLICT (shop_id, sepay_transaction_id) DO UPDATE SET
    reference_code = EXCLUDED.reference_code,
    transfer_type = EXCLUDED.transfer_type,
    transfer_amount = EXCLUDED.transfer_amount,
    account_number = EXCLUDED.account_number,
    extracted_order_code = EXCLUDED.extracted_order_code,
    order_id = EXCLUDED.order_id,
    outcome = 'reconciled',
    reason_code = 'OK',
    delivery_count = public.sepay_webhook_events.delivery_count + 1,
    updated_at = v_now
  RETURNING * INTO v_inserted_evt;

  INSERT INTO public.order_audit_logs (
    id,
    shop_id,
    order_id,
    actor_user_id,
    actor_role,
    action,
    previous_state,
    next_state,
    reason,
    created_at
  ) VALUES (
    'audit-sepay-' || v_shop_id || '-' || v_tx_id,
    v_shop_id,
    v_updated_order.id,
    v_paid_by,
    'webhook',
    'sepay_webhook_reconcile',
    jsonb_build_object(
      'status', v_order.status,
      'payment_status', v_order.payment_status,
      'payment_method', v_order.payment_method,
      'total_amount', v_order.total_amount
    ),
    jsonb_build_object(
      'status', v_updated_order.status,
      'payment_status', v_updated_order.payment_status,
      'payment_method', v_updated_order.payment_method,
      'total_amount', v_updated_order.total_amount,
      'payment_idempotency_key', v_updated_order.payment_idempotency_key,
      'paid_by', v_updated_order.paid_by,
      'sepay_transaction_id', v_tx_id,
      'reference_code', v_reference_code
    ),
    'SePay VietQR automatic reconciliation',
    v_now
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN jsonb_build_object(
    'outcome', 'reconciled',
    'reconciled', TRUE,
    'duplicate', FALSE,
    'reason_code', 'OK',
    'event_id', v_inserted_evt.id,
    'order_id', v_updated_order.id,
    'delivery_count', v_inserted_evt.delivery_count,
    'conflict_count', v_inserted_evt.conflict_count,
    'order', to_jsonb(v_updated_order)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_sepay_order_payment_atomic(
  TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reconcile_sepay_order_payment_atomic(
  TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TIMESTAMPTZ
) TO service_role;
