import { useAuth } from '@clerk/clerk-expo';
import { Redirect, Tabs } from 'expo-router';
import { HE } from '@workforce/shared';

export default function WorkerLayout() {
  const { isSignedIn } = useAuth();
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#0f7a67',
        tabBarLabelStyle: { fontSize: 12 },
        headerShown: false,
      }}
    >
      <Tabs.Screen name="home"    options={{ title: 'בית' }} />
      <Tabs.Screen name="open-jobs" options={{ title: HE.worker.openJobs }} />
      <Tabs.Screen name="shifts"  options={{ title: 'המשמרות שלי' }} />
      <Tabs.Screen name="notifications" options={{ title: 'התראות' }} />
      <Tabs.Screen name="profile" options={{ title: HE.worker.profile }} />
    </Tabs>
  );
}
