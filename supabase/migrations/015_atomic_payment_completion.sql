-- ============================================================================
-- Migration 015: Atomic SaaS Subscription Payment Order Completion RPC
--
-- Guarantees atomicity when completing pending SaaS subscription payment orders:
-- 1. Locks the payment_transactions row (FOR UPDATE) to serialize duplicate webhook deliveries.
-- 2. Strictly enforces server-authoritative user_id, target_plan, amount, and 30-day expiry.
-- 3. Idempotently returns already-completed status without re-extending plan expiry.
-- 4. Validates transfer amount unless p_allow_unverified_amount = true.
-- 5. Requires a nonempty bank reference id.
-- 6. Updates payment_transactions (status='completed') and profiles (plan + plan_expires_at)
--    in the exact same Postgres transaction; if profile update fails or profile is missing,
--    the entire transaction rolls back leaving the payment order in pending state.
-- 7. Translates unique violation on bank_ref_id into stable DUPLICATE_BANK_REF error.
-- 8. Restricted strictly to service_role (fail-closed against direct client execution).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_payment_webhook_atomic(
  p_order_code TEXT,
  p_bank_ref_id TEXT,
  p_verified_transfer_amount NUMERIC,
  p_allow_unverified_amount BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_code TEXT;
  v_bank_ref_id TEXT;
  v_tx public.payment_transactions%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_now TIMESTAMPTZ;
  v_expires_at TIMESTAMPTZ;
BEGIN
  -- 0. Fail closed against direct client execution
  IF public.is_client_request_context() THEN
    RAISE EXCEPTION 'FORBIDDEN_EXECUTION: Direct client execution of complete_payment_webhook_atomic is not permitted.';
  END IF;

  -- 1. Normalize and require order code
  v_order_code := upper(btrim(COALESCE(p_order_code, '')));
  IF v_order_code = '' THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND: Thiếu mã đơn thanh toán.';
  END IF;

  -- Advisory lock to serialize concurrent webhooks on this exact order code
  PERFORM pg_advisory_xact_lock(hashtext('payment_order:' || v_order_code));

  -- 2. Lock payment transaction row FOR UPDATE
  SELECT * INTO v_tx
  FROM public.payment_transactions
  WHERE upper(btrim(order_code)) = v_order_code
  FOR UPDATE;

  -- 3. Unknown order -> stable PAYMENT_ORDER_NOT_FOUND
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND: Không tìm thấy đơn thanh toán "%".', v_order_code;
  END IF;

  -- 4. Completed order -> already_completed idempotency return (no writes, no expiry extension)
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

  -- 5. Any other non-pending status -> stable PAYMENT_ORDER_NOT_PENDING
  IF v_tx.status <> 'pending' THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_PENDING: Trạng thái đơn thanh toán là "%", không thể hoàn tất.', v_tx.status;
  END IF;

  -- 6. Require finite positive transfer amount unless explicit p_allow_unverified_amount=true
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

  -- 7. Require a nonempty bank reference
  v_bank_ref_id := btrim(COALESCE(p_bank_ref_id, ''));
  IF v_bank_ref_id = '' THEN
    RAISE EXCEPTION 'MISSING_BANK_REF: Thiếu mã tham chiếu ngân hàng (bank_ref_id).';
  END IF;

  -- Check existing bank reference conflict across other transactions
  IF EXISTS (
    SELECT 1 FROM public.payment_transactions
    WHERE bank_ref_id = v_bank_ref_id
      AND id <> v_tx.id
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_BANK_REF: Mã tham chiếu ngân hàng "%" đã được sử dụng cho giao dịch khác.', v_bank_ref_id;
  END IF;

  v_now := now();
  v_expires_at := v_now + INTERVAL '30 days';

  -- 8. Update payment_transactions row: pending -> completed
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

  -- 9. Update the exact profile row using stored user_id and target_plan
  UPDATE public.profiles
  SET
    plan = v_tx.target_plan,
    plan_expires_at = v_expires_at,
    updated_at = v_now
  WHERE id = v_tx.user_id
  RETURNING * INTO v_profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND: Không tìm thấy hồ sơ người dùng (%) cho đơn thanh toán.', v_tx.user_id;
  END IF;

  -- 10. Return completed payload
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

-- Restrict execution strictly to service_role: revoke from PUBLIC, anon, authenticated
REVOKE ALL ON FUNCTION public.complete_payment_webhook_atomic(TEXT, TEXT, NUMERIC, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_payment_webhook_atomic(TEXT, TEXT, NUMERIC, BOOLEAN) TO service_role;
