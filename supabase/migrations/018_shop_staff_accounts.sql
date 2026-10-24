-- ============================================================================
-- QLAOK (Q-Smart) — Migration 018: Shop-Scoped Staff Accounts (No-Email Login)
-- 1. Extends public.shop_memberships with normalized per-shop username and
--    constraints preventing shop-scoped staff from holding owner role,
--    owner-only member management permissions, or cross-shop memberships.
-- 2. Creates public.shop_staff_credentials for salted password hashes and
--    session revocation versions, locked strictly to server/service_role via
--    RESTRICTIVE RLS, REVOKE, and client-context boundary trigger.
-- 3. Creates public.staff_login_rate_limits and atomic service-role-only RPCs
--    for durable login abuse protection (windowed failure counting, temporary
--    cooldowns without permanent lockouts, hashed bucket keys without raw IPs
--    or credentials, and expired-entry retention cleanup).
-- 4. Creates atomic service-role-only RPCs for multi-row staff account
--    create/update/password-reset/delete across shop_staff_credentials and
--    shop_memberships while preserving historical audit actor IDs.
-- 5. Prevents shop-scoped staff identities (staff-acct-*) from owning shops
--    and drops profile-only FKs on table_service_requests actor columns so
--    staff accounts without public.profiles rows can acknowledge/resolve calls.
-- ============================================================================

-- 1. Extend public.shop_memberships with optional normalized username
ALTER TABLE public.shop_memberships
ADD COLUMN IF NOT EXISTS username TEXT DEFAULT NULL;

UPDATE public.shop_memberships
SET username = NULLIF(LOWER(BTRIM(username)), '')
WHERE username IS NOT NULL;

ALTER TABLE public.shop_memberships
DROP CONSTRAINT IF EXISTS shop_memberships_username_format_check;

ALTER TABLE public.shop_memberships
ADD CONSTRAINT shop_memberships_username_format_check
CHECK (
    username IS NULL
    OR (
        btrim(username) <> ''
        AND username = lower(btrim(username))
        AND username ~ '^[a-z0-9._-]{3,32}$'
    )
);

ALTER TABLE public.shop_memberships
DROP CONSTRAINT IF EXISTS shop_memberships_staff_role_check;

ALTER TABLE public.shop_memberships
ADD CONSTRAINT shop_memberships_staff_role_check
CHECK (
    (username IS NULL OR role IN ('cashier', 'staff'))
    AND (user_id NOT LIKE 'staff-acct-%' OR role IN ('cashier', 'staff'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_memberships_shop_username
ON public.shop_memberships (shop_id, username)
WHERE username IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_memberships_staff_single_shop
ON public.shop_memberships (user_id)
WHERE user_id LIKE 'staff-acct-%';

-- 2. Prevent shop-scoped staff identities from owning shops
ALTER TABLE public.shops
DROP CONSTRAINT IF EXISTS shops_owner_not_staff_account_check;

ALTER TABLE public.shops
ADD CONSTRAINT shops_owner_not_staff_account_check
CHECK (owner_id NOT LIKE 'staff-acct-%');

-- 3. Allow shop-scoped staff identities without public.profiles rows to
--    acknowledge/resolve table_service_requests while preserving actor IDs
ALTER TABLE public.table_service_requests
DROP CONSTRAINT IF EXISTS table_service_requests_acknowledged_by_fkey,
DROP CONSTRAINT IF EXISTS table_service_requests_resolved_by_fkey;

-- 4. Create server-only public.shop_staff_credentials table
CREATE TABLE IF NOT EXISTS public.shop_staff_credentials (
    user_id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
    username VARCHAR(64) NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT DEFAULT NULL,
    role VARCHAR(24) NOT NULL DEFAULT 'staff' CHECK (role IN ('cashier', 'staff')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version >= 1),
    created_by TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ DEFAULT NULL,
    CONSTRAINT shop_staff_credentials_user_id_format_check CHECK (
        user_id LIKE 'staff-acct-%' AND length(btrim(user_id)) >= 15
    ),
    CONSTRAINT shop_staff_credentials_username_format_check CHECK (
        btrim(username) <> ''
        AND username = lower(btrim(username))
        AND username ~ '^[a-z0-9._-]{3,32}$'
    ),
    CONSTRAINT shop_staff_credentials_password_hash_check CHECK (
        password_hash LIKE 'scrypt$%' AND length(btrim(password_hash)) >= 40
    ),
    UNIQUE (shop_id, username)
);

CREATE INDEX IF NOT EXISTS idx_shop_staff_credentials_shop_active
ON public.shop_staff_credentials (shop_id, is_active);

ALTER TABLE public.shop_staff_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shop_staff_credentials_select" ON public.shop_staff_credentials;
DROP POLICY IF EXISTS "shop_staff_credentials_insert" ON public.shop_staff_credentials;
DROP POLICY IF EXISTS "shop_staff_credentials_update" ON public.shop_staff_credentials;
DROP POLICY IF EXISTS "shop_staff_credentials_delete" ON public.shop_staff_credentials;
DROP POLICY IF EXISTS "shop_staff_credentials_service_only" ON public.shop_staff_credentials;

CREATE POLICY "shop_staff_credentials_service_only"
ON public.shop_staff_credentials
AS RESTRICTIVE
FOR ALL
USING (NOT public.is_client_request_context())
WITH CHECK (NOT public.is_client_request_context());

CREATE OR REPLACE FUNCTION public.enforce_shop_staff_credentials_boundaries()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.is_client_request_context() THEN
        RAISE EXCEPTION 'FORBIDDEN_STAFF_CREDENTIAL_DIRECT_ACCESS: Thông tin đăng nhập nhân viên chỉ được truy cập qua máy chủ xác thực.';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    NEW.user_id := BTRIM(COALESCE(NEW.user_id, ''));
    NEW.shop_id := BTRIM(COALESCE(NEW.shop_id, ''));
    NEW.username := LOWER(BTRIM(COALESCE(NEW.username, '')));
    NEW.password_hash := BTRIM(COALESCE(NEW.password_hash, ''));

    IF NEW.user_id NOT LIKE 'staff-acct-%' OR LENGTH(NEW.user_id) < 15 THEN
        RAISE EXCEPTION 'INVALID_STAFF_USER_ID: Mã định danh tài khoản nhân viên không hợp lệ.';
    END IF;

    IF NEW.shop_id = '' THEN
        RAISE EXCEPTION 'INVALID_STAFF_SHOP_ID: Thiếu shop_id cho tài khoản nhân viên.';
    END IF;

    IF NEW.username = '' OR NEW.username !~ '^[a-z0-9._-]{3,32}$' THEN
        RAISE EXCEPTION 'INVALID_STAFF_USERNAME: Tên đăng nhập nhân viên phải từ 3–32 ký tự (a-z, 0-9, ., _, -).';
    END IF;

    IF NEW.role NOT IN ('cashier', 'staff') THEN
        RAISE EXCEPTION 'FORBIDDEN_STAFF_OWNER_ROLE: Tài khoản nhân viên không được gán quyền chủ quán.';
    END IF;

    IF NEW.password_hash NOT LIKE 'scrypt$%' OR LENGTH(NEW.password_hash) < 40 THEN
        RAISE EXCEPTION 'INVALID_STAFF_PASSWORD_HASH: Mật khẩu nhân viên phải được băm scrypt có salt trước khi lưu.';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.shop_id IS DISTINCT FROM OLD.shop_id THEN
            RAISE EXCEPTION 'FORBIDDEN_STAFF_SHOP_CHANGE: Không được phép chuyển tài khoản nhân viên sang cửa hàng khác.';
        END IF;
        NEW.updated_at := NOW();
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_shop_staff_credentials_boundaries ON public.shop_staff_credentials;
CREATE TRIGGER trg_enforce_shop_staff_credentials_boundaries
BEFORE INSERT OR UPDATE OR DELETE ON public.shop_staff_credentials
FOR EACH ROW EXECUTE FUNCTION public.enforce_shop_staff_credentials_boundaries();

-- 5. Harden public.enforce_shop_membership_boundaries() for shop-scoped staff invariants
CREATE OR REPLACE FUNCTION public.enforce_shop_membership_boundaries()
RETURNS TRIGGER AS $$
DECLARE
    target_shop TEXT;
BEGIN
    IF public.is_client_request_context() THEN
        target_shop := COALESCE(NEW.shop_id, OLD.shop_id);
        IF NOT public.user_is_shop_owner(target_shop) THEN
            RAISE EXCEPTION 'FORBIDDEN_MEMBERSHIP_MUTATION: Chỉ chủ quán gốc hoặc máy chủ mới được phép thay đổi trực tiếp phân quyền nhân sự.';
        END IF;
        IF TG_OP = 'UPDATE' AND NEW.shop_id IS DISTINCT FROM OLD.shop_id THEN
            RAISE EXCEPTION 'FORBIDDEN_MEMBERSHIP_SHOP_CHANGE: Không được phép chuyển nhân sự sang cửa hàng khác.';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' AND (NEW.shop_id IS DISTINCT FROM OLD.shop_id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
        RAISE EXCEPTION 'FORBIDDEN_MEMBERSHIP_SHOP_CHANGE: Không được phép chuyển nhân sự sang cửa hàng khác.';
    END IF;

    IF NEW.username IS NOT NULL THEN
        NEW.username := NULLIF(LOWER(BTRIM(NEW.username)), '');
    END IF;

    IF NEW.username IS NOT NULL OR NEW.user_id LIKE 'staff-acct-%' THEN
        IF NEW.role NOT IN ('cashier', 'staff') THEN
            RAISE EXCEPTION 'FORBIDDEN_STAFF_OWNER_ROLE: Tài khoản nhân viên theo quán chỉ được phép có vai trò thu ngân hoặc nhân viên.';
        END IF;

        IF NEW.permissions IS NULL OR jsonb_typeof(NEW.permissions) <> 'array' THEN
            RAISE EXCEPTION 'INVALID_PERMISSION: Danh sách quyền hạn nhân viên phải là mảng JSON hợp lệ.';
        END IF;

        IF NEW.permissions ? 'members.manage' OR NEW.permissions ? 'staff.manage' THEN
            RAISE EXCEPTION 'FORBIDDEN_STAFF_MEMBER_MANAGE_PERMISSION: Tài khoản nhân viên không được cấp quyền quản lý nhân sự.';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(NEW.permissions) AS perm(val)
            WHERE perm.val NOT IN (
                'orders.view',
                'orders.create',
                'orders.fulfill',
                'orders.edit_items',
                'orders.cancel_unpaid',
                'orders.print_kitchen',
                'orders.print_provisional',
                'payment.collect',
                'discount.apply',
                'payment.refund',
                'catalog.view',
                'catalog.manage',
                'inventory.adjust',
                'promotions.manage',
                'settings.manage',
                'settings.bank',
                'reports.view'
            )
        ) THEN
            RAISE EXCEPTION 'INVALID_PERMISSION: Quyền hạn nhân viên không thuộc danh mục hợp lệ.';
        END IF;
    END IF;

    IF NEW.user_id LIKE 'staff-acct-%' THEN
        IF EXISTS (
            SELECT 1 FROM public.shop_memberships m
            WHERE m.user_id = NEW.user_id
              AND m.shop_id IS DISTINCT FROM NEW.shop_id
        ) THEN
            RAISE EXCEPTION 'FORBIDDEN_CROSS_SHOP_STAFF_MEMBERSHIP: Tài khoản nhân viên chỉ được gắn với duy nhất một cửa hàng.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON TABLE public.shop_staff_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shop_staff_credentials TO service_role;

-- 6. Server-only public.staff_login_rate_limits table for login abuse controls
CREATE TABLE IF NOT EXISTS public.staff_login_rate_limits (
    bucket_key TEXT PRIMARY KEY,
    failure_count INTEGER NOT NULL DEFAULT 1 CHECK (failure_count >= 0),
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    blocked_until TIMESTAMPTZ DEFAULT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT staff_login_rate_limits_bucket_key_check CHECK (
        bucket_key ~ '^rl-staff-[0-9a-f]{64}$'
    )
);

CREATE INDEX IF NOT EXISTS idx_staff_login_rate_limits_expires_at
ON public.staff_login_rate_limits (expires_at);

ALTER TABLE public.staff_login_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_login_rate_limits_select" ON public.staff_login_rate_limits;
DROP POLICY IF EXISTS "staff_login_rate_limits_insert" ON public.staff_login_rate_limits;
DROP POLICY IF EXISTS "staff_login_rate_limits_update" ON public.staff_login_rate_limits;
DROP POLICY IF EXISTS "staff_login_rate_limits_delete" ON public.staff_login_rate_limits;
DROP POLICY IF EXISTS "staff_login_rate_limits_service_only" ON public.staff_login_rate_limits;

CREATE POLICY "staff_login_rate_limits_service_only"
ON public.staff_login_rate_limits
AS RESTRICTIVE
FOR ALL
USING (NOT public.is_client_request_context())
WITH CHECK (NOT public.is_client_request_context());

CREATE OR REPLACE FUNCTION public.enforce_staff_login_rate_limits_boundaries()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF public.is_client_request_context() THEN
        RAISE EXCEPTION 'FORBIDDEN_STAFF_RATE_LIMIT_DIRECT_ACCESS: Bộ giới hạn tần suất đăng nhập nhân viên chỉ được truy cập qua máy chủ xác thực.';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    NEW.bucket_key := LOWER(BTRIM(COALESCE(NEW.bucket_key, '')));
    IF NEW.bucket_key !~ '^rl-staff-[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'INVALID_STAFF_RATE_LIMIT_BUCKET_KEY: Khóa giới hạn tần suất đăng nhập phải là mã băm SHA-256 hợp lệ.';
    END IF;

    IF COALESCE(NEW.failure_count, -1) < 0 THEN
        RAISE EXCEPTION 'INVALID_STAFF_RATE_LIMIT_COUNT: Số lần thất bại không hợp lệ.';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        NEW.updated_at := COALESCE(NEW.updated_at, NOW());
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_staff_login_rate_limits_boundaries ON public.staff_login_rate_limits;
CREATE TRIGGER trg_enforce_staff_login_rate_limits_boundaries
BEFORE INSERT OR UPDATE OR DELETE ON public.staff_login_rate_limits
FOR EACH ROW EXECUTE FUNCTION public.enforce_staff_login_rate_limits_boundaries();

REVOKE ALL ON TABLE public.staff_login_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.staff_login_rate_limits TO service_role;

-- 7. Service-role-only RPCs for staff login rate limiting and retention cleanup
CREATE OR REPLACE FUNCTION public.cleanup_expired_staff_login_rate_limits(
    p_now TIMESTAMPTZ DEFAULT NOW(),
    p_batch_limit INTEGER DEFAULT 500
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now TIMESTAMPTZ := COALESCE(p_now, NOW());
    v_limit INTEGER := GREATEST(1, LEAST(COALESCE(p_batch_limit, 500), 5000));
    v_deleted INTEGER := 0;
BEGIN
    IF public.is_client_request_context() THEN
        RAISE EXCEPTION 'FORBIDDEN_STAFF_RATE_LIMIT_DIRECT_ACCESS: Chỉ máy chủ xác thực mới được dọn bộ giới hạn đăng nhập.';
    END IF;

    WITH doomed AS (
        SELECT s.bucket_key
        FROM public.staff_login_rate_limits s
        WHERE s.expires_at <= v_now
          AND (s.blocked_until IS NULL OR s.blocked_until <= v_now)
        ORDER BY s.expires_at ASC
        LIMIT v_limit
    )
    DELETE FROM public.staff_login_rate_limits target
    USING doomed
    WHERE target.bucket_key = doomed.bucket_key;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_staff_login_rate_limit_atomic(
    p_bucket_key TEXT,
    p_now TIMESTAMPTZ DEFAULT NOW(),
    p_window_seconds INTEGER DEFAULT 900
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_key TEXT := LOWER(BTRIM(COALESCE(p_bucket_key, '')));
    v_now TIMESTAMPTZ := COALESCE(p_now, NOW());
    v_window_sec INTEGER := GREATEST(1, COALESCE(p_window_seconds, 900));
    v_row public.staff_login_rate_limits%ROWTYPE;
    v_retry_after INTEGER := 0;
BEGIN
    IF public.is_client_request_context() THEN
        RAISE EXCEPTION 'FORBIDDEN_STAFF_RATE_LIMIT_DIRECT_ACCESS: Chỉ máy chủ xác thực mới được kiểm tra giới hạn đăng nhập.';
    END IF;

    IF v_key !~ '^rl-staff-[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'INVALID_STAFF_RATE_LIMIT_BUCKET_KEY: Khóa giới hạn tần suất đăng nhập không hợp lệ.';
    END IF;

    PERFORM public.cleanup_expired_staff_login_rate_limits(v_now, 100);

    SELECT * INTO v_row
    FROM public.staff_login_rate_limits
    WHERE bucket_key = v_key
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'allowed', TRUE,
            'failure_count', 0,
            'retry_after_sec', 0,
            'blocked_until', NULL
        );
    END IF;

    IF v_row.blocked_until IS NOT NULL AND v_row.blocked_until > v_now THEN
        v_retry_after := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_row.blocked_until - v_now)))::INTEGER);
        RETURN jsonb_build_object(
            'allowed', FALSE,
            'failure_count', v_row.failure_count,
            'retry_after_sec', v_retry_after,
            'blocked_until', v_row.blocked_until
        );
    END IF;

    IF (v_row.blocked_until IS NOT NULL AND v_row.blocked_until <= v_now)
       OR (v_row.window_started_at + make_interval(secs => v_window_sec) <= v_now)
       OR (v_row.expires_at <= v_now) THEN
        DELETE FROM public.staff_login_rate_limits WHERE bucket_key = v_key;
        RETURN jsonb_build_object(
            'allowed', TRUE,
            'failure_count', 0,
            'retry_after_sec', 0,
            'blocked_until', NULL
        );
    END IF;

    RETURN jsonb_build_object(
        'allowed', TRUE,
        'failure_count', v_row.failure_count,
        'retry_after_sec', 0,
        'blocked_until', NULL
    );
END;
$$;

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

CREATE OR REPLACE FUNCTION public.reset_staff_login_rate_limit_atomic(
    p_bucket_key TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_key TEXT := LOWER(BTRIM(COALESCE(p_bucket_key, '')));
BEGIN
    IF public.is_client_request_context() THEN
        RAISE EXCEPTION 'FORBIDDEN_STAFF_RATE_LIMIT_DIRECT_ACCESS: Chỉ máy chủ xác thực mới được đặt lại bộ giới hạn đăng nhập.';
    END IF;

    IF v_key !~ '^rl-staff-[0-9a-f]{64}$' THEN
        RETURN FALSE;
    END IF;

    DELETE FROM public.staff_login_rate_limits
    WHERE bucket_key = v_key;

    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_staff_login_rate_limits(TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_staff_login_rate_limits(TIMESTAMPTZ, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.check_staff_login_rate_limit_atomic(TEXT, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_staff_login_rate_limit_atomic(TEXT, TIMESTAMPTZ, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.record_staff_login_failure_atomic(TEXT, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_staff_login_failure_atomic(TEXT, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.reset_staff_login_rate_limit_atomic(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_staff_login_rate_limit_atomic(TEXT) TO service_role;

-- 8. Service-role-only atomic RPCs for multi-row staff account writes
CREATE OR REPLACE FUNCTION public.create_shop_staff_account_atomic(
    p_user_id TEXT,
    p_shop_id TEXT,
    p_username TEXT,
    p_password_hash TEXT,
    p_full_name TEXT DEFAULT NULL,
    p_role TEXT DEFAULT 'staff',
    p_permissions JSONB DEFAULT '[]'::jsonb,
    p_is_active BOOLEAN DEFAULT TRUE,
    p_created_by TEXT DEFAULT NULL,
    p_membership_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id TEXT := BTRIM(COALESCE(p_user_id, ''));
    v_shop_id TEXT := BTRIM(COALESCE(p_shop_id, ''));
    v_username TEXT := LOWER(BTRIM(COALESCE(p_username, '')));
    v_password_hash TEXT := BTRIM(COALESCE(p_password_hash, ''));
    v_role TEXT := BTRIM(COALESCE(p_role, 'staff'));
    v_full_name TEXT := NULLIF(BTRIM(COALESCE(p_full_name, '')), '');
    v_membership_id TEXT;
    v_now TIMESTAMPTZ := NOW();
    v_mem public.shop_memberships%ROWTYPE;
BEGIN
    IF public.is_client_request_context() THEN
        RAISE EXCEPTION 'FORBIDDEN_STAFF_CREDENTIAL_DIRECT_ACCESS: Chỉ máy chủ xác thực mới được phép tạo tài khoản nhân viên.';
    END IF;

    IF v_shop_id = '' THEN
        RAISE EXCEPTION 'MISSING_SHOP_ID: Thiếu shop_id.';
    END IF;

    IF v_user_id NOT LIKE 'staff-acct-%' OR LENGTH(v_user_id) < 15 THEN
        RAISE EXCEPTION 'INVALID_STAFF_USER_ID: Mã định danh tài khoản nhân viên không hợp lệ.';
    END IF;

    IF v_username = '' OR v_username !~ '^[a-z0-9._-]{3,32}$' THEN
        RAISE EXCEPTION 'INVALID_STAFF_USERNAME: Tên đăng nhập nhân viên phải từ 3–32 ký tự (a-z, 0-9, ., _, -).';
    END IF;

    IF v_role NOT IN ('cashier', 'staff') THEN
        RAISE EXCEPTION 'FORBIDDEN_STAFF_OWNER_ROLE: Tài khoản nhân viên không được gán quyền chủ quán.';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('staff_acct:' || v_shop_id || ':' || v_username));

    IF EXISTS (
        SELECT 1 FROM public.shop_staff_credentials c
        WHERE c.shop_id = v_shop_id AND c.username = v_username
    ) OR EXISTS (
        SELECT 1 FROM public.shop_memberships m
        WHERE m.shop_id = v_shop_id AND m.username = v_username
    ) THEN
        RAISE EXCEPTION 'STAFF_USERNAME_EXISTS: Tên đăng nhập "%" đã tồn tại trong cửa hàng này.', v_username;
    END IF;

    v_membership_id := COALESCE(NULLIF(BTRIM(COALESCE(p_membership_id, '')), ''), 'mem-' || v_user_id);

    BEGIN
        INSERT INTO public.shop_staff_credentials (
            user_id,
            shop_id,
            username,
            password_hash,
            full_name,
            role,
            is_active,
            session_version,
            created_by,
            created_at,
            updated_at
        )
        VALUES (
            v_user_id,
            v_shop_id,
            v_username,
            v_password_hash,
            v_full_name,
            v_role,
            COALESCE(p_is_active, TRUE),
            1,
            NULLIF(BTRIM(COALESCE(p_created_by, '')), ''),
            v_now,
            v_now
        );

        INSERT INTO public.shop_memberships (
            id,
            shop_id,
            user_id,
            email,
            username,
            full_name,
            role,
            permissions,
            is_active,
            created_at,
            updated_at
        )
        VALUES (
            v_membership_id,
            v_shop_id,
            v_user_id,
            NULL,
            v_username,
            COALESCE(v_full_name, v_username),
            v_role,
            COALESCE(p_permissions, '[]'::jsonb),
            COALESCE(p_is_active, TRUE),
            v_now,
            v_now
        )
        RETURNING * INTO v_mem;
    EXCEPTION
        WHEN unique_violation THEN
            RAISE EXCEPTION 'STAFF_USERNAME_EXISTS: Tên đăng nhập "%" đã tồn tại trong cửa hàng này.', v_username;
    END;

    RETURN to_jsonb(v_mem);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_shop_staff_account_atomic(
    p_shop_id TEXT,
    p_user_id TEXT,
    p_username TEXT DEFAULT NULL,
    p_full_name TEXT DEFAULT NULL,
    p_role TEXT DEFAULT NULL,
    p_permissions JSONB DEFAULT NULL,
    p_is_active BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_shop_id TEXT := BTRIM(COALESCE(p_shop_id, ''));
    v_user_id TEXT := BTRIM(COALESCE(p_user_id, ''));
    v_cred public.shop_staff_credentials%ROWTYPE;
    v_mem public.shop_memberships%ROWTYPE;
    v_has_cred BOOLEAN := FALSE;
    v_has_mem BOOLEAN := FALSE;
    v_next_username TEXT;
    v_next_full_name TEXT;
    v_next_role TEXT;
    v_next_permissions JSONB;
    v_next_is_active BOOLEAN;
    v_next_session_version INTEGER;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF public.is_client_request_context() THEN
        RAISE EXCEPTION 'FORBIDDEN_STAFF_CREDENTIAL_DIRECT_ACCESS: Chỉ máy chủ xác thực mới được phép cập nhật tài khoản nhân viên.';
    END IF;

    IF v_shop_id = '' OR v_user_id = '' THEN
        RAISE EXCEPTION 'MISSING_SHOP_ID: Thiếu shop_id hoặc user_id.';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('staff_acct_user:' || v_shop_id || ':' || v_user_id));

    SELECT * INTO v_cred
    FROM public.shop_staff_credentials
    WHERE shop_id = v_shop_id AND user_id = v_user_id
    FOR UPDATE;
    v_has_cred := FOUND;

    SELECT * INTO v_mem
    FROM public.shop_memberships
    WHERE shop_id = v_shop_id AND user_id = v_user_id
    FOR UPDATE;
    v_has_mem := FOUND;

    IF NOT v_has_cred OR NOT v_has_mem THEN
        RAISE EXCEPTION 'STAFF_MEMBER_NOT_FOUND: Không tìm thấy tài khoản nhân viên trong cửa hàng này.';
    END IF;

    v_next_username := CASE
        WHEN p_username IS NOT NULL AND BTRIM(p_username) <> '' THEN LOWER(BTRIM(p_username))
        ELSE v_cred.username
    END;

    IF v_next_username = '' OR v_next_username !~ '^[a-z0-9._-]{3,32}$' THEN
        RAISE EXCEPTION 'INVALID_STAFF_USERNAME: Tên đăng nhập nhân viên phải từ 3–32 ký tự (a-z, 0-9, ., _, -).';
    END IF;

    IF v_next_username IS DISTINCT FROM v_cred.username THEN
        PERFORM pg_advisory_xact_lock(hashtext('staff_acct:' || v_shop_id || ':' || v_next_username));
        IF EXISTS (
            SELECT 1 FROM public.shop_staff_credentials c
            WHERE c.shop_id = v_shop_id AND c.username = v_next_username AND c.user_id <> v_user_id
        ) OR EXISTS (
            SELECT 1 FROM public.shop_memberships m
            WHERE m.shop_id = v_shop_id AND m.username = v_next_username AND m.user_id <> v_user_id
        ) THEN
            RAISE EXCEPTION 'STAFF_USERNAME_EXISTS: Tên đăng nhập "%" đã tồn tại trong cửa hàng này.', v_next_username;
        END IF;
    END IF;

    v_next_role := CASE
        WHEN p_role IS NOT NULL AND BTRIM(p_role) <> '' THEN BTRIM(p_role)
        ELSE v_cred.role
    END;

    IF v_next_role NOT IN ('cashier', 'staff') THEN
        RAISE EXCEPTION 'FORBIDDEN_STAFF_OWNER_ROLE: Tài khoản nhân viên không được gán quyền chủ quán.';
    END IF;

    v_next_full_name := CASE
        WHEN p_full_name IS NOT NULL THEN COALESCE(NULLIF(BTRIM(p_full_name), ''), v_next_username)
        ELSE COALESCE(NULLIF(BTRIM(COALESCE(v_mem.full_name, v_cred.full_name, '')), ''), v_next_username)
    END;

    v_next_permissions := COALESCE(p_permissions, v_mem.permissions, '[]'::jsonb);
    v_next_is_active := COALESCE(p_is_active, v_cred.is_active);

    IF (v_cred.is_active AND NOT v_next_is_active)
       OR v_cred.role IS DISTINCT FROM v_next_role
       OR v_cred.username IS DISTINCT FROM v_next_username THEN
        v_next_session_version := v_cred.session_version + 1;
    ELSE
        v_next_session_version := v_cred.session_version;
    END IF;

    BEGIN
        UPDATE public.shop_staff_credentials
        SET
            username = v_next_username,
            full_name = v_next_full_name,
            role = v_next_role,
            is_active = v_next_is_active,
            session_version = v_next_session_version,
            updated_at = v_now
        WHERE shop_id = v_shop_id AND user_id = v_user_id;

        UPDATE public.shop_memberships
        SET
            username = v_next_username,
            full_name = v_next_full_name,
            role = v_next_role,
            permissions = v_next_permissions,
            is_active = v_next_is_active,
            updated_at = v_now
        WHERE shop_id = v_shop_id AND user_id = v_user_id
        RETURNING * INTO v_mem;
    EXCEPTION
        WHEN unique_violation THEN
            RAISE EXCEPTION 'STAFF_USERNAME_EXISTS: Tên đăng nhập "%" đã tồn tại trong cửa hàng này.', v_next_username;
    END;

    RETURN to_jsonb(v_mem);
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_shop_staff_password_atomic(
    p_shop_id TEXT,
    p_user_id TEXT,
    p_new_password_hash TEXT,
    p_rate_limit_bucket_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_shop_id TEXT := BTRIM(COALESCE(p_shop_id, ''));
    v_user_id TEXT := BTRIM(COALESCE(p_user_id, ''));
    v_hash TEXT := BTRIM(COALESCE(p_new_password_hash, ''));
    v_rl_key TEXT := LOWER(BTRIM(COALESCE(p_rate_limit_bucket_key, '')));
    v_cred public.shop_staff_credentials%ROWTYPE;
    v_mem public.shop_memberships%ROWTYPE;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF public.is_client_request_context() THEN
        RAISE EXCEPTION 'FORBIDDEN_STAFF_CREDENTIAL_DIRECT_ACCESS: Chỉ máy chủ xác thực mới được phép đặt lại mật khẩu nhân viên.';
    END IF;

    IF v_shop_id = '' OR v_user_id = '' THEN
        RAISE EXCEPTION 'MISSING_SHOP_ID: Thiếu shop_id hoặc user_id.';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('staff_acct_user:' || v_shop_id || ':' || v_user_id));

    SELECT * INTO v_cred
    FROM public.shop_staff_credentials
    WHERE shop_id = v_shop_id AND user_id = v_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'STAFF_MEMBER_NOT_FOUND: Không tìm thấy tài khoản nhân viên trong cửa hàng này.';
    END IF;

    SELECT * INTO v_mem
    FROM public.shop_memberships
    WHERE shop_id = v_shop_id AND user_id = v_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'STAFF_MEMBER_NOT_FOUND: Không tìm thấy phân quyền nhân viên trong cửa hàng này.';
    END IF;

    UPDATE public.shop_staff_credentials
    SET
        password_hash = v_hash,
        session_version = v_cred.session_version + 1,
        updated_at = v_now
    WHERE shop_id = v_shop_id AND user_id = v_user_id
    RETURNING * INTO v_cred;

    UPDATE public.shop_memberships
    SET
        username = v_cred.username,
        role = v_cred.role,
        updated_at = v_now
    WHERE shop_id = v_shop_id AND user_id = v_user_id
    RETURNING * INTO v_mem;

    IF v_rl_key ~ '^rl-staff-[0-9a-f]{64}$' THEN
        DELETE FROM public.staff_login_rate_limits
        WHERE bucket_key = v_rl_key;
    END IF;

    RETURN jsonb_build_object(
        'user_id', v_cred.user_id,
        'shop_id', v_cred.shop_id,
        'username', v_cred.username,
        'session_version', v_cred.session_version
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_shop_staff_account_atomic(
    p_shop_id TEXT,
    p_user_id TEXT,
    p_rate_limit_bucket_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_shop_id TEXT := BTRIM(COALESCE(p_shop_id, ''));
    v_user_id TEXT := BTRIM(COALESCE(p_user_id, ''));
    v_rl_key TEXT := LOWER(BTRIM(COALESCE(p_rate_limit_bucket_key, '')));
    v_cred_deleted INTEGER := 0;
    v_mem_deleted INTEGER := 0;
BEGIN
    IF public.is_client_request_context() THEN
        RAISE EXCEPTION 'FORBIDDEN_STAFF_CREDENTIAL_DIRECT_ACCESS: Chỉ máy chủ xác thực mới được phép xóa tài khoản nhân viên.';
    END IF;

    IF v_shop_id = '' OR v_user_id = '' THEN
        RAISE EXCEPTION 'MISSING_MEMBERSHIP_FIELDS: Thiếu shop_id hoặc user_id.';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('staff_acct_user:' || v_shop_id || ':' || v_user_id));

    DELETE FROM public.shop_staff_credentials
    WHERE shop_id = v_shop_id AND user_id = v_user_id;
    GET DIAGNOSTICS v_cred_deleted = ROW_COUNT;

    DELETE FROM public.shop_memberships
    WHERE shop_id = v_shop_id AND user_id = v_user_id;
    GET DIAGNOSTICS v_mem_deleted = ROW_COUNT;

    IF v_rl_key ~ '^rl-staff-[0-9a-f]{64}$' THEN
        DELETE FROM public.staff_login_rate_limits
        WHERE bucket_key = v_rl_key;
    END IF;

    RETURN jsonb_build_object(
        'deleted', (v_cred_deleted > 0 OR v_mem_deleted > 0),
        'deleted_credentials', v_cred_deleted,
        'deleted_memberships', v_mem_deleted
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_shop_staff_account_atomic(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_shop_staff_account_atomic(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.update_shop_staff_account_atomic(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_shop_staff_account_atomic(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN) TO service_role;

REVOKE ALL ON FUNCTION public.reset_shop_staff_password_atomic(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_shop_staff_password_atomic(TEXT, TEXT, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.delete_shop_staff_account_atomic(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_shop_staff_account_atomic(TEXT, TEXT, TEXT) TO service_role;
