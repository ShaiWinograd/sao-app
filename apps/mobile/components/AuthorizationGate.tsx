import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import { api } from '../lib/api';
import { colors } from '../lib/theme';

type GateState = 'checking' | 'authorized' | 'blocked';

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, paddingHorizontal: 24 }}>
      {children}
    </View>
  );
}

/**
 * Mobile authorization gate. Consults the authoritative DB role (`/auth/me`)
 * before rendering the worker tabs or any business data. An authenticated user
 * who is not authorized (403 — not a pre-registered worker, not an invited
 * owner/admin) sees a dedicated unauthorized screen with no navigation or data.
 * The API is the real boundary; this mirrors it on the client.
 */
export function AuthorizationGate({ children }: { children: React.ReactNode }) {
  const { isSignedIn, signOut } = useAuth();
  const [state, setState] = useState<GateState>('checking');

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    (async () => {
      try {
        await api.get('/auth/me');
        if (!cancelled) setState('authorized');
      } catch (err) {
        if (cancelled) return;
        const status = (err as { response?: { status?: number } })?.response?.status;
        // A transient/non-authorization error must not lock out a legitimate user.
        setState(status === 403 ? 'blocked' : 'authorized');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  if (state === 'checking') {
    return (
      <Centered>
        <ActivityIndicator size="large" color={colors.primary} />
      </Centered>
    );
  }

  if (state === 'blocked') {
    return (
      <Centered>
        <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text, marginBottom: 12 }}>אין הרשאה</Text>
        <Text style={{ textAlign: 'center', color: colors.muted, marginBottom: 24, lineHeight: 22 }}>
          אין לך הרשאה להשתמש במערכת. יש לפנות לבעלת העסק.
        </Text>
        <Pressable
          onPress={() => signOut()}
          style={{ backgroundColor: colors.text, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 }}
        >
          <Text style={{ color: '#ffffff' }}>התנתקות</Text>
        </Pressable>
      </Centered>
    );
  }

  return <>{children}</>;
}
