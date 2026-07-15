import axios from 'axios';

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1',
  withCredentials: true,
});

// Automatically attach the Clerk session token to every request (unless the
// caller already set an Authorization header). This keeps pages that don't call
// authHeaders() explicitly from hitting 401s once API auth is enforced. On the
// public quotation viewer there is no session, so no header is added and the
// public endpoints still work.
api.interceptors.request.use(async (config) => {
  if (typeof window === 'undefined') return config;
  const hasAuth = Boolean((config.headers as Record<string, unknown> | undefined)?.Authorization);
  if (hasAuth) return config;
  try {
    const clerk = (window as unknown as { Clerk?: { loaded?: boolean; load?: () => Promise<void>; session?: { getToken?: () => Promise<string | null> } } }).Clerk;
    if (clerk && !clerk.loaded && clerk.load) {
      await clerk.load();
    }
    const token = await clerk?.session?.getToken?.();
    if (token) {
      config.headers = config.headers ?? {};
      (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
    }
  } catch {
    // No session (e.g. public pages) — proceed unauthenticated.
  }
  return config;
});

/** Call this to get request config with Authorization header from a Clerk getToken fn */
export async function authHeaders(
  getToken: () => Promise<string | null>,
): Promise<{ headers: { Authorization: string } } | Record<string, never>> {
  try {
    const token = await getToken();
    if (token) return { headers: { Authorization: `Bearer ${token}` } };
  } catch {
    // ignore
  }
  return {};
}
