/**
 * Normalizes a bank account number by stripping all whitespace.
 */
export function normalizeReceivingAccount(account: string): string {
  return account.replace(/\s+/g, '');
}

/**
 * Public VietQR receiving bank account configuration.
 * Safe for client-side rendering (NEXT_PUBLIC_*). Contains public recipient details only, no secrets.
 */
export interface SaasPublicBankConfig {
  bin: string;
  account: string;
  accountName: string;
  bankName: string;
}

/**
 * Pure parser for public VietQR receiving bank account list from JSON.
 *
 * Expected format:
 *   [{"bin":"970436","account":"123456789","accountName":"Qlaok Co","bankName":"VCB"}, ...]
 *
 * Requirements:
 * - Required fields: non-empty "bin" and "account" strings (after trim).
 * - Optional fields: "accountName" (defaults to empty string), "bankName" (defaults to bin).
 * - "id" field is completely ignored to avoid duplicate/unstable id problems.
 * - JSON order is preserved as display order.
 * - If input is absent or blank (undefined, null, or empty string), returns null.
 * - If input is a non-empty string but malformed JSON, not an array, empty array,
 *   or contains any invalid entry, fails closed by returning [] (an empty array).
 */
export function parseSaasPublicBankAccounts(
  rawJson: string | null | undefined
): SaasPublicBankConfig[] | null {
  if (rawJson === undefined || rawJson === null) {
    return null;
  }
  if (typeof rawJson !== 'string') {
    return [];
  }
  const trimmed = rawJson.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [];
    }
    const configs: SaasPublicBankConfig[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return [];
      }
      const rawBin = (item as Record<string, unknown>).bin;
      const rawAccount = (item as Record<string, unknown>).account;
      if (typeof rawBin !== 'string' || typeof rawAccount !== 'string') {
        return [];
      }
      const bin = rawBin.trim();
      const account = rawAccount.trim();
      if (bin.length === 0 || account.length === 0) {
        return [];
      }
      const rawAccountName = (item as Record<string, unknown>).accountName;
      if (rawAccountName !== undefined && typeof rawAccountName !== 'string') {
        return [];
      }
      const accountName =
        typeof rawAccountName === 'string' ? rawAccountName.trim() : '';

      const rawBankName = (item as Record<string, unknown>).bankName;
      if (rawBankName !== undefined && typeof rawBankName !== 'string') {
        return [];
      }
      const bankName =
        typeof rawBankName === 'string' && rawBankName.trim().length > 0
          ? rawBankName.trim()
          : bin;

      configs.push({
        bin,
        account,
        accountName,
        bankName,
      });
    }
    return configs;
  } catch {
    return [];
  }
}

/**
 * Resolves the public VietQR bank configs for client UI and webhook fallback.
 *
 * Direct reference to NEXT_PUBLIC_* variables ensures Next.js inlines them
 * into client-side bundles when called without arguments.
 *
 * Precedence:
 * 1. NEXT_PUBLIC_SAAS_BANK_ACCOUNTS (when non-empty).
 *    If valid, returns the parsed configs in display order.
 *    If malformed, empty array, or contains an invalid entry, fails closed to []
 *    (DOES NOT fall back to legacy single-account variables).
 * 2. Legacy single-account variables (when NEXT_PUBLIC_SAAS_BANK_ACCOUNTS is absent/blank):
 *    NEXT_PUBLIC_SAAS_BANK_BIN, NEXT_PUBLIC_SAAS_BANK_ACCOUNT,
 *    NEXT_PUBLIC_SAAS_BANK_ACCOUNT_NAME, NEXT_PUBLIC_SAAS_BANK_NAME.
 *    Returns a single-item array if both bin and account are non-empty; otherwise [].
 */
export function getSaasPublicBankConfigs(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): SaasPublicBankConfig[] {
  const rawMultiple =
    env === process.env
      ? process.env.NEXT_PUBLIC_SAAS_BANK_ACCOUNTS
      : env.NEXT_PUBLIC_SAAS_BANK_ACCOUNTS;

  const parsedMultiple = parseSaasPublicBankAccounts(rawMultiple);
  if (parsedMultiple !== null) {
    return parsedMultiple;
  }

  const legacyBin = (
    (env === process.env
      ? process.env.NEXT_PUBLIC_SAAS_BANK_BIN
      : env.NEXT_PUBLIC_SAAS_BANK_BIN) || ''
  ).trim();
  const legacyAccount = (
    (env === process.env
      ? process.env.NEXT_PUBLIC_SAAS_BANK_ACCOUNT
      : env.NEXT_PUBLIC_SAAS_BANK_ACCOUNT) || ''
  ).trim();
  const legacyAccountName = (
    (env === process.env
      ? process.env.NEXT_PUBLIC_SAAS_BANK_ACCOUNT_NAME
      : env.NEXT_PUBLIC_SAAS_BANK_ACCOUNT_NAME) || ''
  ).trim();
  const legacyBankName = (
    (env === process.env
      ? process.env.NEXT_PUBLIC_SAAS_BANK_NAME
      : env.NEXT_PUBLIC_SAAS_BANK_NAME) || ''
  ).trim();

  if (!legacyBin || !legacyAccount) {
    return [];
  }

  return [
    {
      bin: legacyBin,
      account: legacyAccount,
      accountName: legacyAccountName,
      bankName: legacyBankName || legacyBin,
    },
  ];
}

/**
 * Returns the primary configured SaaS public bank config, or null if none.
 * Backward-compatible helper for single-account callers.
 */
export function getSaasBankConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): SaasPublicBankConfig | null {
  const configs = getSaasPublicBankConfigs(env);
  return configs.length > 0 ? configs[0] : null;
}

/**
 * Selects a bank configuration from a list by index.
 * Returns configs[selectedIndex] if present, otherwise the first config (configs[0]), or null if list is empty/falsy.
 */
export function selectSaasPublicBankConfig(
  configs: readonly SaasPublicBankConfig[] | null | undefined,
  selectedIndex: number
): SaasPublicBankConfig | null {
  if (!configs || configs.length === 0) {
    return null;
  }
  return configs[selectedIndex] ?? configs[0] ?? null;
}

/**
 * Builds the VietQR image URL for a given bank config, amount, and memo.
 */
export function buildSaasVietQrUrl(
  bank: SaasPublicBankConfig,
  amount: number,
  orderCode: string
): string {
  const params = new URLSearchParams({
    amount: String(Math.round(Number(amount) || 0)),
    addInfo: orderCode,
  });
  if (bank.accountName) params.set('accountName', bank.accountName);
  return `https://img.vietqr.io/image/${encodeURIComponent(
    bank.bin
  )}-${encodeURIComponent(bank.account)}-compact2.png?${params.toString()}`;
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
 * 3. NEXT_PUBLIC_SAAS_BANK_ACCOUNTS (public list fallback when both server variables are absent/blank).
 *    Returns normalized account numbers in JSON order, deduplicated.
 *    If configured (non-empty string after trim) but malformed/invalid, it resolves to [] and fails closed
 *    (DOES NOT fall back to legacy public single account).
 * 4. NEXT_PUBLIC_SAAS_BANK_ACCOUNT (legacy single public account fallback).
 *    Used as a singleton allowlist if non-empty when both server variables and public list are absent/blank.
 * 5. Resolves to [] if no account is configured.
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

  const rawPublicMultiple =
    env === process.env
      ? process.env.NEXT_PUBLIC_SAAS_BANK_ACCOUNTS
      : env.NEXT_PUBLIC_SAAS_BANK_ACCOUNTS;
  if (
    typeof rawPublicMultiple === 'string' &&
    rawPublicMultiple.trim().length > 0
  ) {
    const publicConfigs = parseSaasPublicBankAccounts(rawPublicMultiple);
    if (!publicConfigs || publicConfigs.length === 0) {
      return [];
    }
    const accounts: string[] = [];
    for (const config of publicConfigs) {
      const normalized = normalizeReceivingAccount(config.account);
      if (normalized.length > 0 && !accounts.includes(normalized)) {
        accounts.push(normalized);
      }
    }
    return accounts;
  }

  const legacyPublic = (
    (env === process.env
      ? process.env.NEXT_PUBLIC_SAAS_BANK_ACCOUNT
      : env.NEXT_PUBLIC_SAAS_BANK_ACCOUNT) || ''
  ).trim();
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
