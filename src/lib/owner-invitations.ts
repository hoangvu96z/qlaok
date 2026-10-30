export type OwnerInvitationPlan = 'free' | 'basic' | 'premium';

export function escapePostgrestIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export interface AdminOwnerInvitationProfileInput {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  plan: OwnerInvitationPlan;
  planExpiresAt: string | null;
}

export function buildAdminOwnerInvitationProfile(
  input: AdminOwnerInvitationProfileInput
) {
  const email = input.email.trim().toLowerCase();
  return {
    id: input.id,
    zitadel_sub: null,
    owner_invite_pending: true,
    email,
    full_name: input.fullName.trim() || email.split('@')[0],
    phone: input.phone.trim() || null,
    plan: input.plan,
    plan_expires_at: input.planExpiresAt,
  };
}

export interface OwnerInvitationProfile {
  id: string;
  email?: string | null;
  zitadel_sub?: string | null;
  owner_invite_pending?: boolean | null;
}

export function isPendingAdminOwnerInvitation(
  profile: OwnerInvitationProfile | null | undefined,
  email: string
): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  return Boolean(
    profile &&
      profile.id &&
      profile.owner_invite_pending === true &&
      profile.zitadel_sub == null &&
      typeof profile.email === 'string' &&
      profile.email.trim().toLowerCase() === normalizedEmail
  );
}

export function canClaimAdminOwnerInvitation(
  profile: OwnerInvitationProfile | null | undefined,
  email: string,
  emailVerified: boolean | null | undefined
): boolean {
  return (
    emailVerified === true && isPendingAdminOwnerInvitation(profile, email)
  );
}
