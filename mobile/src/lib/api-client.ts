/** One configured backend per request. Never replay mutations against another host. */
export function createApiClient(
  baseUrl: string,
  getAccessToken: () => Promise<string | null>,
  fetchRequest: typeof fetch = fetch,
) {
  return async (path: string, init: RequestInit = {}): Promise<Response> => {
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
      const data = await response.json().catch(() => null);
      throw new Error(data?.error || `Yêu cầu thất bại (${response.status})`);
    }
    return response;
  };
}
