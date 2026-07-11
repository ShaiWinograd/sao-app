import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

export const api = axios.create({
  baseURL: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1',
});

api.interceptors.request.use(async (config) => {
  // Clerk stores the token in SecureStore under '__clerk_client_jwt'
  const token = await SecureStore.getItemAsync('__clerk_client_jwt');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
