import { useAuth } from '@clerk/clerk-expo';
import { Redirect, Tabs } from 'expo-router';
import { HE } from '@workforce/shared';
import { colors } from '../../lib/theme';

export default function WorkerLayout() {
  const { isSignedIn } = useAuth();
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarLabelStyle: { fontSize: 12 },
        headerShown: false,
      }}
    >
      <Tabs.Screen name="home"    options={{ title: 'בית' }} />
      <Tabs.Screen name="open-jobs" options={{ title: 'משמרות' }} />
      <Tabs.Screen name="shifts"  options={{ title: 'המשמרות שלי' }} />
      <Tabs.Screen name="notifications" options={{ title: 'התראות' }} />
      <Tabs.Screen name="profile" options={{ title: HE.worker.profile }} />
    </Tabs>
  );
}
