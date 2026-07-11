import axios from 'axios';

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1',
  withCredentials: true,
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
