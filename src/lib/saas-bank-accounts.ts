/**
 * Normalizes a bank account number by stripping all whitespace.
 */
export function normalizeReceivingAccount(account: string): string {
  return account.replace(/\s+/g, '');
}

/**
 * Returns the allowlist of configured SaaS receiving bank accounts (normalized,
 * whitespace stripped, deduplicated in order of appearance).
 *
 * Precedence:
 * 1. SAAS_BANK_ACCOUNTS (authoritative when non-empty).
 *    Must be a valid JSON array of non-empty strings, e.g. ["123456789","987654321"].
 *    Each string is stripped of whitespace. Duplicate entries are deduplicated
 *    preserving first occurrence order.
 *    If configured (non-empty string after trim) but malformed (e.g. invalid JSON,
 *    non-array, empty array, or containing non-string or whitespace-only elements),
 *    it resolves to [] and fails closed (DOES NOT fall back to legacy variables).
 * 2. SAAS_BANK_ACCOUNT (legacy single server account).
 *    Used as a singleton allowlist if non-empty when SAAS_BANK_ACCOUNTS is absent/blank.
 * 3. NEXT_PUBLIC_SAAS_BANK_ACCOUNT (legacy single public account fallback).
 *    Used as a singleton allowlist if non-empty when both server variables are absent/blank.
 * 4. Resolves to [] if no account is configured.
 */
export function getConfiguredSaasReceivingAccounts(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string[] {
  const rawMultiple = env.SAAS_BANK_ACCOUNTS;
  if (typeof rawMultiple === 'string' && rawMultiple.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawMultiple);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return [];
      }
      const accounts: string[] = [];
      for (const item of parsed) {
        if (typeof item !== 'string') {
          return [];
        }
        const normalized = normalizeReceivingAccount(item);
        if (normalized.length === 0) {
          return [];
        }
        if (!accounts.includes(normalized)) {
          accounts.push(normalized);
        }
      }
      return accounts;
    } catch {
      return [];
    }
  }

  const legacyServer = (env.SAAS_BANK_ACCOUNT || '').trim();
  if (legacyServer.length > 0) {
    const normalized = normalizeReceivingAccount(legacyServer);
    return normalized.length > 0 ? [normalized] : [];
  }

  const legacyPublic = (env.NEXT_PUBLIC_SAAS_BANK_ACCOUNT || '').trim();
  if (legacyPublic.length > 0) {
    const normalized = normalizeReceivingAccount(legacyPublic);
    return normalized.length > 0 ? [normalized] : [];
  }

  return [];
}

/**
 * Returns the primary configured SaaS receiving bank account, or null if none.
 * Kept for backwards compatibility with single-account callers.
 */
export function getConfiguredSaasReceivingAccount(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): string | null {
  const accounts = getConfiguredSaasReceivingAccounts(env);
  return accounts.length > 0 ? accounts[0] : null;
}
