import { useAuth } from '@clerk/clerk-expo';
import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { HE } from '@workforce/shared';
import { colors } from '../../lib/theme';
import { AuthorizationGate } from '../../components/AuthorizationGate';

export default function WorkerLayout() {
  const { isSignedIn } = useAuth();
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;

  return (
    <AuthorizationGate>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.muted,
          tabBarLabelStyle: { fontSize: 11 },
          tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
          headerShown: false,
        }}
      >
      <Tabs.Screen
        name="home"
        options={{
          title: 'בית',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="open-jobs"
        options={{
          title: 'משמרות',
          tabBarIcon: ({ color, size }) => <Ionicons name="briefcase-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="shifts"
        options={{
          title: 'המשמרות שלי',
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'התראות',
          tabBarIcon: ({ color, size }) => <Ionicons name="notifications-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: HE.worker.profile,
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
        }}
      />
      {/* Pushed full-screen detail — hidden from the tab bar. */}
      <Tabs.Screen name="shift-detail" options={{ href: null }} />
      </Tabs>
    </AuthorizationGate>
  );
}
