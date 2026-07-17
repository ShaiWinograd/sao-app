import axios from 'axios';

type TokenGetter = () => Promise<string | null>;

// Registered from the app tree (inside ClerkProvider) so the interceptor can
// fetch a fresh, short-lived Clerk session token for every request.
let tokenGetter: TokenGetter | null = null;

export function setAuthTokenGetter(getter: TokenGetter | null) {
  tokenGetter = getter;
}

export const api = axios.create({
  baseURL:
    process.env.EXPO_PUBLIC_API_URL ??
    'https://spaceorder-api-app-poc-h7hef6a2gtd5euhq.israelcentral-01.azurewebsites.net/api/v1',
});

api.interceptors.request.use(async (config) => {
  if (tokenGetter) {
    const token = await tokenGetter();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});
