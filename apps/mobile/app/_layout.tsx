import { Slot } from 'expo-router';
import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import * as SecureStore from 'expo-secure-store';
import { I18nManager, Text, TextInput, View, ActivityIndicator } from 'react-native';
import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
// Registers the background geofencing TaskManager task at startup so the OS can
// invoke it after a cold start (§16.4 leaving-area detection).
import '../lib/backgroundGeofence';
import {
  useFonts,
  Assistant_400Regular,
  Assistant_500Medium,
  Assistant_600SemiBold,
  Assistant_700Bold,
} from '@expo-google-fonts/assistant';
import { setAuthTokenGetter } from '../lib/api';
import { colors, fonts } from '../lib/theme';
import { ToastProvider } from '../components/toast';

// Force RTL
I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

// Default every Text/TextInput to Assistant regular (matches the web font stack).
// Bold/semibold styles set an explicit Assistant family, since RN needs a family per weight.
const defaultTextStyle = { fontFamily: fonts.regular };
((Text as any).defaultProps ??= {}).style = defaultTextStyle;
((TextInput as any).defaultProps ??= {}).style = defaultTextStyle;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const tokenCache = {
  async getToken(key: string) {
    return SecureStore.getItemAsync(key);
  },
  async saveToken(key: string, value: string) {
    return SecureStore.setItemAsync(key, value);
  },
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

// Registers Clerk's getToken with the axios instance so every API request
// carries a fresh session token (matches the web app's auth approach).
function ApiAuthBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);
  return null;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Assistant_400Regular,
    Assistant_500Medium,
    Assistant_600SemiBold,
    Assistant_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ClerkProvider
      publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!}
      tokenCache={tokenCache}
    >
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <ToastProvider>
            <ApiAuthBridge />
            <Slot />
          </ToastProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}
