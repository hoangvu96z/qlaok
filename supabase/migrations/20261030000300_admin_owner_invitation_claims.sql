-- Mark profiles created by the Super Admin as explicit, one-time invitations.
-- A verified Zitadel identity may claim only the matching pending invitation.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS owner_invite_pending BOOLEAN NOT NULL DEFAULT FALSE;

-- Earlier admin-created profiles use the owner-<uuid> ID prefix and have no
-- Zitadel subject. Preserve those invitations so their intended owners can
-- finish registration without weakening email-only linking for other profiles.
UPDATE public.profiles
SET owner_invite_pending = TRUE
WHERE id ~* '^owner-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND zitadel_sub IS NULL
  AND email IS NOT NULL;

-- The invitations are security-sensitive metadata. The existing profiles RLS
-- policy permits client writes, so keep clients from turning arbitrary profiles
-- into email-claimable invitations. Server-side service_role writes remain valid.
CREATE OR REPLACE FUNCTION public.prevent_client_owner_invitation_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.is_client_request_context() THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.owner_invite_pending IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'FORBIDDEN_OWNER_INVITATION_MUTATION: Không được phép tự tạo lời mời chủ quán từ phía client.';
      END IF;
    ELSIF NEW.owner_invite_pending IS DISTINCT FROM OLD.owner_invite_pending THEN
      RAISE EXCEPTION 'FORBIDDEN_OWNER_INVITATION_MUTATION: Không được phép tự thay đổi lời mời chủ quán từ phía client.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_client_owner_invitation_mutation
  ON public.profiles;
CREATE TRIGGER trg_prevent_client_owner_invitation_mutation
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_client_owner_invitation_mutation();

NOTIFY pgrst, 'reload schema';
