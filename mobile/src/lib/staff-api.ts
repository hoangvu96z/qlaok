import {
  clearStaffSession,
  DEFAULT_STAFF_BACKEND_ORIGIN,
  getStaffAccessToken,
  loadStaffSession,
  loginStaff,
  type LoginStaffParams,
  type MobileStaffRole,
  type MobileStaffSession,
  type MobileStaffUser,
  parseStaffLoginResponse,
  persistStaffSession,
  readStaffSession,
  redactSensitiveText,
  saveStaffSession,
  setDefaultStaffApiBaseUrlResolver,
  STAFF_SESSION_REVOKED_CODE,
  STAFF_SESSION_STORAGE_KEY,
  StaffAuthError,
  type StaffLoginCredentials,
  type StaffLoginOptions,
  type StaffSession,
  type StaffSessionStorageAdapter,
  type StaffSessionUser,
  storeStaffSession,
  validateStaffSession,
} from './staff-session.ts';

declare const require: ((moduleId: string) => unknown) | undefined;

/**
 * Resolves `API_BASE_URL` at the composition boundary without creating a
 * circular dependency between `supabase.ts` and `staff-session.ts`.
 */
export function resolveStaffApiBaseUrl(): string {
  try {
    if (typeof require === 'function') {
      const supabaseModule = require('./supabase') as
        | { API_BASE_URL?: string }
        | null
        | undefined;
      if (
        typeof supabaseModule?.API_BASE_URL === 'string' &&
        supabaseModule.API_BASE_URL.trim()
      ) {
        return supabaseModule.API_BASE_URL.trim().replace(/\/+$/, '');
      }
    }
  } catch {
    // Fallback when running in Node tests outside the React Native runtime
  }

  const envUrl =
    typeof process !== 'undefined'
      ? process.env?.EXPO_PUBLIC_API_URL?.trim()
      : '';
  return (envUrl || DEFAULT_STAFF_BACKEND_ORIGIN).replace(/\/+$/, '');
}

setDefaultStaffApiBaseUrlResolver(resolveStaffApiBaseUrl);

export class StaffApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly sessionCleared: boolean;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      sessionCleared?: boolean;
    }
  ) {
    super(message);
    this.name = 'StaffApiError';
    this.status = options.status;
    this.code = options.code;
    this.sessionCleared = Boolean(options.sessionCleared);
  }
}

export interface StaffApiErrorPayload {
  error?: string;
  code?: string;
}

/**
 * Safely parses JSON error `{ error, code }` from a non-OK HTTP response.
 * Never throws on empty, HTML, or malformed JSON responses.
 */
export async function parseStaffApiErrorPayload(
  response: Response
): Promise<StaffApiErrorPayload> {
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const error =
        typeof record.error === 'string' && record.error.trim()
          ? record.error.trim()
          : undefined;
      const code =
        typeof record.code === 'string' && record.code.trim()
          ? record.code.trim()
          : undefined;
      return { error, code };
    }
  } catch {
    // Ignore non-JSON error responses
  }
  return {};
}

/**
 * Determines whether a failed staff API response requires clearing the local
 * staff session:
 * - HTTP 401 (unauthorized / expired / invalid token) -> clear session
 * - Explicit `STAFF_SESSION_REVOKED` error code (including HTTP 403) -> clear session
 * - Ordinary HTTP 403 permission denials (`INSUFFICIENT_SHOP_PERMISSION`, etc.) -> retain session
 * - Network failures and 5xx / other 4xx errors -> retain session
 */
export function shouldClearStaffSessionOnError(
  status: number,
  code?: string | null
): boolean {
  if (status === 401) {
    return true;
  }
  if (
    typeof code === 'string' &&
    code.trim() === STAFF_SESSION_REVOKED_CODE
  ) {
    return true;
  }
  return false;
}

export interface StaffSessionClearedContext {
  status: number;
  code?: string;
}

export interface CreateStaffApiClientOptions {
  baseUrl?: string;
  storage?: StaffSessionStorageAdapter | null;
  getAccessToken?: () => Promise<string | null> | string | null;
  clearSession?: () => Promise<void> | void;
  fetchRequest?: typeof fetch;
  fetchImpl?: typeof fetch;
  onSessionCleared?: (
    context: StaffSessionClearedContext
  ) => void | Promise<void>;
}

export type StaffApiClient = (
  path: string,
  init?: RequestInit
) => Promise<Response>;

function normalizeCreateStaffApiClientOptions(
  firstArg?: string | CreateStaffApiClientOptions,
  secondArg?:
    | CreateStaffApiClientOptions
    | (() => Promise<string | null> | string | null),
  thirdArg?: typeof fetch,
  fourthArg?: (context: StaffSessionClearedContext) => void | Promise<void>
): CreateStaffApiClientOptions {
  if (typeof firstArg === 'string') {
    if (typeof secondArg === 'function') {
      return {
        baseUrl: firstArg,
        getAccessToken: secondArg,
        fetchRequest: thirdArg,
        onSessionCleared: fourthArg,
      };
    }
    return {
      ...(secondArg || {}),
      baseUrl: firstArg,
    };
  }
  return firstArg || {};
}

/**
 * Creates an isolated API client for mobile staff mode.
 *
 * Security invariants:
 * - Reads only the stored Qlaok staff token (never falls back to Supabase owner JWT or calls Supabase Auth).
 * - Validates `/api/` path prefix and enforces a single configured backend host per request.
 * - Clears the stored staff session on HTTP 401 or explicit `STAFF_SESSION_REVOKED`.
 * - Retains the stored staff session on ordinary HTTP 403 permission denials and all network/5xx errors.
 * - Never logs or leaks tokens in thrown error messages.
 */
export function createStaffApiClient(
  options?: CreateStaffApiClientOptions
): StaffApiClient;
export function createStaffApiClient(
  baseUrl: string,
  options?: Omit<CreateStaffApiClientOptions, 'baseUrl'>
): StaffApiClient;
export function createStaffApiClient(
  baseUrl: string,
  getAccessToken: () => Promise<string | null> | string | null,
  fetchRequest?: typeof fetch,
  onSessionCleared?: (
    context: StaffSessionClearedContext
  ) => void | Promise<void>
): StaffApiClient;
export function createStaffApiClient(
  firstArg?: string | CreateStaffApiClientOptions,
  secondArg?:
    | CreateStaffApiClientOptions
    | (() => Promise<string | null> | string | null),
  thirdArg?: typeof fetch,
  fourthArg?: (context: StaffSessionClearedContext) => void | Promise<void>
): StaffApiClient {
  const options = normalizeCreateStaffApiClientOptions(
    firstArg,
    secondArg,
    thirdArg,
    fourthArg
  );

  const resolveClientBaseUrl = (): string => {
    if (typeof options.baseUrl === 'string' && options.baseUrl.trim()) {
      return options.baseUrl.trim().replace(/\/+$/, '');
    }
    return resolveStaffApiBaseUrl();
  };

  const readToken = async (): Promise<string | null> => {
    if (typeof options.getAccessToken === 'function') {
      return await options.getAccessToken();
    }
    return await getStaffAccessToken(options.storage);
  };

  const clearStoredSession = async (): Promise<void> => {
    if (typeof options.clearSession === 'function') {
      await options.clearSession();
      return;
    }
    await clearStaffSession(options.storage);
  };

  const fetchFn = options.fetchRequest ?? options.fetchImpl ?? fetch;
  let isClearingSession = false;

  return async (path: string, init: RequestInit = {}): Promise<Response> => {
    if (typeof path !== 'string' || !path.startsWith('/api/')) {
      throw new StaffApiError('Đường dẫn API không hợp lệ', {
        status: 400,
        code: 'INVALID_API_PATH',
        sessionCleared: false,
      });
    }

    const rawToken = await readToken();
    const token = typeof rawToken === 'string' ? rawToken.trim() : '';
    if (!token) {
      throw new StaffApiError('Vui lòng đăng nhập lại', {
        status: 401,
        code: 'STAFF_SESSION_MISSING',
        sessionCleared: false,
      });
    }

    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);

    const controller = new AbortController();
    const abort = () => controller.abort();
    if (init.signal?.aborted) abort();
    init.signal?.addEventListener('abort', abort);
    const timeout = setTimeout(abort, 15000);

    let response: Response;
    try {
      response = await fetchFn(`${resolveClientBaseUrl()}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error) {
        const sanitizedMessage = redactSensitiveText(err.message, [token]);
        if (sanitizedMessage !== err.message) {
          throw new Error(sanitizedMessage);
        }
        throw err;
      }
      throw new Error('Không thể kết nối máy chủ.');
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener('abort', abort);
    }

    if (!response.ok) {
      const { error: parsedError, code: parsedCode } =
        await parseStaffApiErrorPayload(response);
      const shouldClear = shouldClearStaffSessionOnError(
        response.status,
        parsedCode
      );

      if (shouldClear && !isClearingSession) {
        isClearingSession = true;
        try {
          await clearStoredSession();
          await options.onSessionCleared?.({
            status: response.status,
            code: parsedCode,
          });
        } catch {
          // Ignore local storage / callback cleanup failures
        } finally {
          isClearingSession = false;
        }
      }

      const rawMessage =
        parsedError || `Yêu cầu thất bại (${response.status})`;
      const safeMessage = redactSensitiveText(rawMessage, [token]);

      throw new StaffApiError(safeMessage, {
        status: response.status,
        code: parsedCode,
        sessionCleared: shouldClear,
      });
    }

    return response;
  };
}

/**
 * Default mobile staff API client bound to `API_BASE_URL` at the composition boundary
 * and backed by the isolated staff session store.
 */
export const staffApi: StaffApiClient = createStaffApiClient();
export const fetchStaffApi: StaffApiClient = staffApi;

export {
  clearStaffSession,
  getStaffAccessToken,
  loadStaffSession,
  loginStaff,
  type LoginStaffParams,
  type MobileStaffRole,
  type MobileStaffSession,
  type MobileStaffUser,
  parseStaffLoginResponse,
  persistStaffSession,
  readStaffSession,
  saveStaffSession,
  STAFF_SESSION_REVOKED_CODE,
  STAFF_SESSION_STORAGE_KEY,
  StaffAuthError,
  type StaffLoginCredentials,
  type StaffLoginOptions,
  type StaffSession,
  type StaffSessionStorageAdapter,
  type StaffSessionUser,
  storeStaffSession,
  validateStaffSession,
};
