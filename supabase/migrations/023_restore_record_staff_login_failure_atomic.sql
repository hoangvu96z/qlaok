-- ============================================================================
-- QLAOK (Q-Smart) — Migration 023: Restore public.record_staff_login_failure_atomic RPC
-- 1. Restores the atomic service-role-only rate-limit recording function defined
--    in migration 018 that was missing on production PostgreSQL environments.
-- 2. Preserves reviewed signature, parameter defaults, advisory transaction
--    locking, expiration pruning, cooldown logic, and return JSON schema.
-- 3. Restricts execute permission strictly to service_role, revoking from
--    PUBLIC, anon, and authenticated.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_staff_login_failure_atomic(
    p_bucket_key TEXT,
    p_now TIMESTAMPTZ DEFAULT NOW(),
    p_max_attempts INTEGER DEFAULT 5,
    p_window_seconds INTEGER DEFAULT 900,
    p_block_seconds INTEGER DEFAULT 900,
    p_retention_seconds INTEGER DEFAULT 86400
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_key TEXT := LOWER(BTRIM(COALESCE(p_bucket_key, '')));
    v_now TIMESTAMPTZ := COALESCE(p_now, NOW());
    v_max_attempts INTEGER := GREATEST(1, COALESCE(p_max_attempts, 5));
    v_window_sec INTEGER := GREATEST(1, COALESCE(p_window_seconds, 900));
    v_block_sec INTEGER := GREATEST(1, COALESCE(p_block_seconds, 900));
    v_retention_sec INTEGER := GREATEST(v_window_sec, v_block_sec, COALESCE(p_retention_seconds, 86400));
    v_row public.staff_login_rate_limits%ROWTYPE;
    v_next_count INTEGER;
    v_blocked_until TIMESTAMPTZ := NULL;
    v_expires_at TIMESTAMPTZ;
    v_retry_after INTEGER := 0;
BEGIN
    IF public.is_client_request_context() THEN
        RAISE EXCEPTION 'FORBIDDEN_STAFF_RATE_LIMIT_DIRECT_ACCESS: Chỉ máy chủ xác thực mới được ghi nhận giới hạn đăng nhập.';
    END IF;

    IF v_key !~ '^rl-staff-[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'INVALID_STAFF_RATE_LIMIT_BUCKET_KEY: Khóa giới hạn tần suất đăng nhập không hợp lệ.';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('staff_rl:' || v_key));
    PERFORM public.cleanup_expired_staff_login_rate_limits(v_now, 100);

    v_expires_at := v_now + make_interval(secs => v_retention_sec);

    SELECT * INTO v_row
    FROM public.staff_login_rate_limits
    WHERE bucket_key = v_key
    FOR UPDATE;

    -- Case 1: Currently in active cooldown block (do not extend into permanent lockout)
    IF FOUND AND v_row.blocked_until IS NOT NULL AND v_row.blocked_until > v_now THEN
        v_next_count := v_row.failure_count + 1;
        v_retry_after := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_row.blocked_until - v_now)))::INTEGER);

        UPDATE public.staff_login_rate_limits
        SET
            failure_count = v_next_count,
            last_failed_at = v_now,
            expires_at = GREATEST(v_row.expires_at, v_expires_at),
            updated_at = v_now
        WHERE bucket_key = v_key;

        RETURN jsonb_build_object(
            'allowed', FALSE,
            'newly_blocked', FALSE,
            'failure_count', v_next_count,
            'retry_after_sec', v_retry_after,
            'blocked_until', v_row.blocked_until
        );
    END IF;

    -- Case 2: No row yet, or previous window/cooldown expired -> start fresh window
    IF NOT FOUND
       OR (v_row.blocked_until IS NOT NULL AND v_row.blocked_until <= v_now)
       OR (v_row.window_started_at + make_interval(secs => v_window_sec) <= v_now)
       OR (v_row.expires_at <= v_now) THEN
        v_next_count := 1;
        IF v_next_count >= v_max_attempts THEN
            v_blocked_until := v_now + make_interval(secs => v_block_sec);
            v_retry_after := v_block_sec;
        END IF;

        INSERT INTO public.staff_login_rate_limits (
            bucket_key,
            failure_count,
            window_started_at,
            last_failed_at,
            blocked_until,
            expires_at,
            updated_at
        )
        VALUES (
            v_key,
            v_next_count,
            v_now,
            v_now,
            v_blocked_until,
            v_expires_at,
            v_now
        )
        ON CONFLICT (bucket_key) DO UPDATE SET
            failure_count = EXCLUDED.failure_count,
            window_started_at = EXCLUDED.window_started_at,
            last_failed_at = EXCLUDED.last_failed_at,
            blocked_until = EXCLUDED.blocked_until,
            expires_at = EXCLUDED.expires_at,
            updated_at = EXCLUDED.updated_at;

        RETURN jsonb_build_object(
            'allowed', TRUE,
            'newly_blocked', (v_blocked_until IS NOT NULL),
            'failure_count', v_next_count,
            'retry_after_sec', v_retry_after,
            'blocked_until', v_blocked_until
        );
    END IF;

    -- Case 3: Active window -> increment failure count
    v_next_count := v_row.failure_count + 1;
    IF v_next_count >= v_max_attempts THEN
        v_blocked_until := v_now + make_interval(secs => v_block_sec);
        v_retry_after := v_block_sec;
    END IF;

    UPDATE public.staff_login_rate_limits
    SET
        failure_count = v_next_count,
        last_failed_at = v_now,
        blocked_until = v_blocked_until,
        expires_at = v_expires_at,
        updated_at = v_now
    WHERE bucket_key = v_key;

    RETURN jsonb_build_object(
        'allowed', (v_next_count <= v_max_attempts),
        'newly_blocked', (v_next_count = v_max_attempts),
        'failure_count', v_next_count,
        'retry_after_sec', v_retry_after,
        'blocked_until', v_blocked_until
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_staff_login_failure_atomic(TEXT, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_staff_login_failure_atomic(TEXT, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';
