export interface ApiClientUnauthorizedContext {
  /**
   * Executes a best-effort authenticated request (such as `DELETE /api/push-tokens`)
   * before local credentials are cleared, without recursively triggering
   * `onUnauthorized` if the cleanup request itself fails with HTTP 401.
   */
  requestWithoutUnauthorizedHandler: (
    path: string,
    init?: RequestInit
  ) => Promise<Response>;
}

function isPushTokenUnregisterRequest(
  path: string,
  init?: RequestInit
): boolean {
  const method = (init?.method || 'GET').toUpperCase();
  return (
    method === 'DELETE' &&
    (path === '/api/push-tokens' || path.startsWith('/api/push-tokens?'))
  );
}

/** One configured backend per request. Never replay mutations against another host. */
export function createApiClient(
  baseUrl: string,
  getAccessToken: () => Promise<string | null>,
  fetchRequest: typeof fetch = fetch,
  onUnauthorized?: (
    context: ApiClientUnauthorizedContext
  ) => void | Promise<void>,
) {
  let isHandlingUnauthorized = false;

  const sendRequest = async (
    path: string,
    init: RequestInit = {},
    allowUnauthorizedHandler = true
  ): Promise<Response> => {
    if (!path.startsWith('/api/')) throw new Error('Đường dẫn API không hợp lệ');
    const token = await getAccessToken();
    if (!token) throw new Error('Vui lòng đăng nhập lại');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (init.signal?.aborted) abort();
    init.signal?.addEventListener('abort', abort);
    const timeout = setTimeout(abort, 15000);
    let response: Response;
    try {
      response = await fetchRequest(`${baseUrl}${path}`, {
        ...init, headers, signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener('abort', abort);
    }
    if (!response.ok) {
      if (
        response.status === 401 &&
        allowUnauthorizedHandler &&
        !isHandlingUnauthorized &&
        !isPushTokenUnregisterRequest(path, init)
      ) {
        isHandlingUnauthorized = true;
        try {
          await onUnauthorized?.({
            requestWithoutUnauthorizedHandler: (
              cleanupPath: string,
              cleanupInit: RequestInit = {}
            ) => sendRequest(cleanupPath, cleanupInit, false),
          });
        } catch {
          // ignore cleanup / local sign-out errors
        } finally {
          isHandlingUnauthorized = false;
        }
      }
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || `Yêu cầu thất bại (${response.status})`);
    }
    return response;
  };

  return (path: string, init: RequestInit = {}): Promise<Response> =>
    sendRequest(path, init, true);
}
