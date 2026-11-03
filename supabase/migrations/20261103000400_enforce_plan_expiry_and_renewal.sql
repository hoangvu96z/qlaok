-- Enforce paid-plan expiry at the item-limit boundary and preserve paid time
-- when a subscriber renews the same tier before its current expiry.

-- Keep plan changes separate from profile edits so an unrelated name/contact
-- update cannot make an old checkout look like an admin plan grant.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan_updated_at TIMESTAMPTZ;

UPDATE public.profiles
SET plan_updated_at = COALESCE(updated_at, created_at, pg_catalog.clock_timestamp())
WHERE plan_updated_at IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN plan_updated_at SET DEFAULT pg_catalog.clock_timestamp();

ALTER TABLE public.profiles
  ALTER COLUMN plan_updated_at SET NOT NULL;

CREATE OR REPLACE FUNCTION public.touch_profile_plan_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.plan_updated_at := pg_catalog.clock_timestamp();
  ELSIF NEW.plan IS DISTINCT FROM OLD.plan
     OR NEW.plan_expires_at IS DISTINCT FROM OLD.plan_expires_at THEN
    NEW.plan_updated_at := pg_catalog.clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.touch_profile_plan_updated_at() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.touch_profile_plan_updated_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_profiles_plan_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_plan_updated_at
BEFORE INSERT OR UPDATE OF plan, plan_expires_at ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.touch_profile_plan_updated_at();

CREATE OR REPLACE FUNCTION public.check_item_plan_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  owner_plan public.plan_tier;
  owner_plan_expires_at TIMESTAMPTZ;
  current_count INTEGER;
BEGIN
  IF NEW.shop_id IS NULL OR BTRIM(NEW.shop_id) = '' THEN
    RAISE EXCEPTION 'SHOP_NOT_FOUND';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('qlaok:item-plan:' || NEW.shop_id, 0)
  );

  SELECT p.plan, p.plan_expires_at
  INTO owner_plan, owner_plan_expires_at
  FROM public.shops AS s
  LEFT JOIN public.profiles AS p ON p.id = s.owner_id
  WHERE s.id = NEW.shop_id;

  -- Let the existing shop_id foreign key retain its normal error for an
  -- unknown shop; an existing shop without an owner plan must fail closed.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF owner_plan IS NULL THEN
    RAISE EXCEPTION 'OWNER_PLAN_UNAVAILABLE';
  END IF;

  IF owner_plan <> 'free'::public.plan_tier
     AND owner_plan_expires_at IS NOT NULL
     AND owner_plan_expires_at <= pg_catalog.clock_timestamp() THEN
    owner_plan := 'free'::public.plan_tier;
  END IF;

  SELECT COUNT(*) INTO current_count
  FROM public.items
  WHERE shop_id = NEW.shop_id;

  IF owner_plan = 'free'::public.plan_tier AND current_count >= 5 THEN
    RAISE EXCEPTION 'PLAN_LIMIT_REACHED: Gói Miễn Phí chỉ hỗ trợ tối đa 5 món/dịch vụ. Vui lòng nâng cấp gói.';
  ELSIF owner_plan = 'basic'::public.plan_tier AND current_count >= 25 THEN
    RAISE EXCEPTION 'PLAN_LIMIT_REACHED: Gói Cơ Bản chỉ hỗ trợ tối đa 25 món/dịch vụ. Vui lòng nâng cấp lên gói Premium.';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.check_item_plan_limit() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.check_item_plan_limit() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.complete_payment_webhook_atomic(
  p_order_code TEXT,
  p_bank_ref_id TEXT,
  p_verified_transfer_amount NUMERIC,
  p_allow_unverified_amount BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_order_code TEXT;
  v_bank_ref_id TEXT;
  v_tx public.payment_transactions%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_now TIMESTAMPTZ;
  v_expires_at TIMESTAMPTZ;
  v_current_plan_monthly_price NUMERIC;
  v_target_plan_monthly_price NUMERIC;
  v_credit_seconds DOUBLE PRECISION;
BEGIN
  IF public.is_client_request_context() THEN
    RAISE EXCEPTION 'FORBIDDEN_EXECUTION: Direct client execution of complete_payment_webhook_atomic is not permitted.';
  END IF;

  v_order_code := upper(btrim(COALESCE(p_order_code, '')));
  IF v_order_code = '' THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND: Thiếu mã đơn thanh toán.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('payment_order:' || v_order_code));

  SELECT * INTO v_tx
  FROM public.payment_transactions
  WHERE upper(btrim(order_code)) = v_order_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND: Không tìm thấy đơn thanh toán "%".', v_order_code;
  END IF;

  IF v_tx.status = 'completed' THEN
    SELECT * INTO v_profile
    FROM public.profiles
    WHERE id = v_tx.user_id;

    RETURN jsonb_build_object(
      'status', 'already_completed',
      'owner_id', v_tx.user_id,
      'target_plan', v_tx.target_plan,
      'plan_expires_at', v_profile.plan_expires_at,
      'order_code', v_tx.order_code,
      'bank_ref_id', v_tx.bank_ref_id
    );
  END IF;

  IF v_tx.status <> 'pending' THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_PENDING: Trạng thái đơn thanh toán là "%", không thể hoàn tất.', v_tx.status;
  END IF;

  IF NOT COALESCE(p_allow_unverified_amount, false) THEN
    IF p_verified_transfer_amount IS NULL
       OR p_verified_transfer_amount <= 0
       OR p_verified_transfer_amount = 'NaN'::numeric THEN
      RAISE EXCEPTION 'PAYMENT_AMOUNT_MISMATCH: Số tiền chuyển khoản không hợp lệ (phải là số dương lớn hơn 0).';
    END IF;

    IF p_verified_transfer_amount < v_tx.amount THEN
      RAISE EXCEPTION 'PAYMENT_AMOUNT_MISMATCH: Số tiền chuyển khoản (%) nhỏ hơn số tiền gói cước yêu cầu (%).',
        p_verified_transfer_amount, v_tx.amount;
    END IF;
  END IF;

  v_bank_ref_id := btrim(COALESCE(p_bank_ref_id, ''));
  IF v_bank_ref_id = '' THEN
    RAISE EXCEPTION 'MISSING_BANK_REF: Thiếu mã tham chiếu ngân hàng (bank_ref_id).';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_transactions
    WHERE bank_ref_id = v_bank_ref_id
      AND id <> v_tx.id
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_BANK_REF: Mã tham chiếu ngân hàng "%" đã được sử dụng cho giao dịch khác.', v_bank_ref_id;
  END IF;

  -- Lock the owner row as well as the payment row. Separate paid orders for
  -- one owner then extend sequentially instead of overwriting one another.
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = v_tx.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND: Không tìm thấy hồ sơ người dùng (%) cho đơn thanh toán.', v_tx.user_id;
  END IF;

  v_now := clock_timestamp();
  IF v_profile.plan IN ('basic'::public.plan_tier, 'premium'::public.plan_tier)
     AND v_profile.plan_expires_at IS NULL
     AND v_profile.plan <> v_tx.target_plan
     AND v_profile.plan_updated_at >= v_tx.created_at THEN
    -- A Super Admin may have granted a non-expiring plan after checkout began.
    -- Keep the payment pending for reconciliation and never replace that grant
    -- with a paid tier whose value cannot be represented without losing it.
    IF v_tx.bank_ref_id IS NOT NULL AND v_tx.bank_ref_id <> v_bank_ref_id THEN
      RAISE EXCEPTION 'PAYMENT_REFERENCE_MISMATCH: Đơn cần đối soát đã có mã tham chiếu ngân hàng khác.';
    END IF;
    BEGIN
      UPDATE public.payment_transactions
      SET bank_ref_id = COALESCE(bank_ref_id, v_bank_ref_id)
      WHERE id = v_tx.id;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'DUPLICATE_BANK_REF: Mã tham chiếu ngân hàng "%" đã được sử dụng cho giao dịch khác.', v_bank_ref_id;
    END;

    RETURN jsonb_build_object(
      'status', 'manual_review',
      'owner_id', v_tx.user_id,
      'target_plan', v_tx.target_plan,
      'plan_expires_at', v_profile.plan_expires_at,
      'order_code', v_tx.order_code,
      'bank_ref_id', v_bank_ref_id,
      'resolution_required', true,
      'resolution_code', 'NON_EXPIRING_ADMIN_PLAN'
    );
  END IF;

  IF v_profile.plan = v_tx.target_plan THEN
    IF v_profile.plan_expires_at IS NULL THEN
      -- A manually granted, non-expiring tier must not become time-limited
      -- just because its owner paid for the same tier.
      v_expires_at := NULL;
    ELSE
      v_expires_at := GREATEST(v_profile.plan_expires_at, v_now)
        + INTERVAL '30 days';
    END IF;
  ELSE
    v_expires_at := v_now + INTERVAL '30 days';

    -- When a paid tier changes mid-term, convert the unused value at the
    -- published monthly prices instead of granting those days free at the
    -- new tier or forfeiting them. The order's new 30-day term starts now.
    IF v_profile.plan_expires_at > v_now THEN
      v_current_plan_monthly_price := CASE v_profile.plan
        WHEN 'basic'::public.plan_tier THEN 39000
        WHEN 'premium'::public.plan_tier THEN 69000
        ELSE 0
      END;
      v_target_plan_monthly_price := CASE v_tx.target_plan
        WHEN 'basic'::public.plan_tier THEN 39000
        WHEN 'premium'::public.plan_tier THEN 69000
        ELSE 0
      END;

      IF v_current_plan_monthly_price > 0
         AND v_target_plan_monthly_price > 0 THEN
        v_credit_seconds :=
          EXTRACT(EPOCH FROM (v_profile.plan_expires_at - v_now))
          * v_current_plan_monthly_price / v_target_plan_monthly_price;
        v_expires_at := v_expires_at
          + pg_catalog.make_interval(secs => v_credit_seconds);
      END IF;
    END IF;
  END IF;

  BEGIN
    UPDATE public.payment_transactions
    SET
      status = 'completed',
      bank_ref_id = v_bank_ref_id,
      completed_at = v_now
    WHERE id = v_tx.id
    RETURNING * INTO v_tx;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'DUPLICATE_BANK_REF: Mã tham chiếu ngân hàng "%" đã được sử dụng cho giao dịch khác.', v_bank_ref_id;
  END;

  UPDATE public.profiles
  SET
    plan = v_tx.target_plan,
    plan_expires_at = v_expires_at,
    plan_updated_at = v_now,
    updated_at = v_now
  WHERE id = v_tx.user_id
  RETURNING * INTO v_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND: Không tìm thấy hồ sơ người dùng (%) cho đơn thanh toán.', v_tx.user_id;
  END IF;

  RETURN jsonb_build_object(
    'status', 'completed',
    'owner_id', v_tx.user_id,
    'target_plan', v_tx.target_plan,
    'plan_expires_at', v_profile.plan_expires_at,
    'order_code', v_tx.order_code,
    'bank_ref_id', v_tx.bank_ref_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_payment_webhook_atomic(TEXT, TEXT, NUMERIC, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_payment_webhook_atomic(TEXT, TEXT, NUMERIC, BOOLEAN) TO service_role;

NOTIFY pgrst, 'reload schema';
