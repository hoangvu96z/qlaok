-- ============================================================================
-- QLAOK (Quét Là OK) — Self-Hosted PostgreSQL 14 Pre-Migration Bootstrap
-- File: supabase/self-hosted/000_bootstrap.sql
--
-- Purpose:
--   Creates the minimum Supabase-compatible extensions, roles, auth schema,
--   fail-closed auth.uid() helper, and supabase_realtime publication required
--   to apply supabase/migrations/001..021 on vanilla PostgreSQL 14 (with
--   PostgREST and Zitadel as the future identity provider).
--
-- Security Invariants:
--   1. Roles `anon` and `authenticated` are NOLOGIN, NOINHERIT, NOSUPERUSER,
--      and NOBYPASSRLS. End-user / client requests must never run under a
--      role that bypasses Row Level Security.
--   2. Role `service_role` is NOLOGIN, NOINHERIT, NOSUPERUSER, and BYPASSRLS.
--      It is strictly reserved for trusted backend server execution and must
--      never be issued in end-user tokens or exposed via NEXT_PUBLIC_*/EXPO_PUBLIC_*.
--   3. `auth.uid()` reads ONLY the PostgREST JWT claim context
--      (`request.jwt.claim.sub` and `request.jwt.claims` JSON `sub`), never
--      HTTP headers (`request.headers`), cookies (`request.cookies`), or
--      request body fields.
--   4. `auth.uid()` fails closed (returns NULL) when the active or JWT role is
--      `anon`, when claims are absent/empty/malformed, or when `sub` is not a
--      valid UUID (e.g. an unmapped raw Zitadel subject or staff account ID).
-- ============================================================================

BEGIN;

-- 1. Required PostgreSQL extensions for Qlaok schema (uuid_generate_v4)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

-- 2. Minimum PostgREST / Supabase-compatible database roles
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
    ALTER ROLE anon NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
    ALTER ROLE authenticated NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
    END IF;
    ALTER ROLE service_role NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
END
$$;

-- 3. Schema `auth` and fail-closed `auth.uid()` helper for RLS policies
CREATE SCHEMA IF NOT EXISTS auth;

REVOKE ALL ON SCHEMA auth FROM PUBLIC;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_active_role TEXT;
    v_jwt_role TEXT;
    v_claims_raw TEXT;
    v_claims JSONB;
    v_sub TEXT;
BEGIN
    -- Anonymous role must always fail closed (NULL), even if session GUCs have stale values.
    v_active_role := COALESCE(NULLIF(current_setting('role', true), ''), CURRENT_USER);
    IF v_active_role = 'anon' OR CURRENT_USER = 'anon' OR SESSION_USER = 'anon' THEN
        RETURN NULL;
    END IF;

    v_jwt_role := LOWER(NULLIF(BTRIM(COALESCE(current_setting('request.jwt.claim.role', true), '')), ''));
    IF v_jwt_role = 'anon' THEN
        RETURN NULL;
    END IF;

    -- 1. Read legacy/per-claim PostgREST GUC (request.jwt.claim.sub)
    v_sub := NULLIF(BTRIM(COALESCE(current_setting('request.jwt.claim.sub', true), '')), '');

    -- 2. Fallback to standard PostgREST JSON claims GUC (request.jwt.claims)
    IF v_sub IS NULL THEN
        v_claims_raw := NULLIF(BTRIM(COALESCE(current_setting('request.jwt.claims', true), '')), '');
        IF v_claims_raw IS NOT NULL THEN
            BEGIN
                v_claims := v_claims_raw::jsonb;
            EXCEPTION WHEN OTHERS THEN
                RETURN NULL;
            END;

            IF jsonb_typeof(v_claims) <> 'object' THEN
                RETURN NULL;
            END IF;

            IF LOWER(COALESCE(v_claims ->> 'role', '')) = 'anon' THEN
                RETURN NULL;
            END IF;

            IF jsonb_typeof(v_claims -> 'sub') = 'string' THEN
                v_sub := NULLIF(BTRIM(COALESCE(v_claims ->> 'sub', '')), '');
            END IF;
        END IF;
    END IF;

    IF v_sub IS NULL THEN
        RETURN NULL;
    END IF;

    -- Validate and return UUID; fail closed (NULL) on any non-UUID identity string.
    BEGIN
        RETURN v_sub::uuid;
    EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
    END;
END;
$$;

REVOKE ALL ON FUNCTION auth.uid() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- 4. Logical replication publication expected by migrations 006 and 009
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END
$$;

COMMIT;
