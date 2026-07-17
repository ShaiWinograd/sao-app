import { useOAuth } from '@clerk/clerk-expo';
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { colors } from '../../lib/theme';

// Ensures the OAuth browser session completes and hands control back to the app.
WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
  const { startOAuthFlow } = useOAuth({ strategy: 'oauth_google' });
  const [loading, setLoading] = useState(false);

  // Warm/cool the in-app browser for a snappier OAuth flow.
  useEffect(() => {
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);

  const handleGoogleSignIn = useCallback(async () => {
    setLoading(true);
    try {
      const { createdSessionId, setActive } = await startOAuthFlow({
        redirectUrl: Linking.createURL('/(worker)/home', { scheme: 'workforce' }),
      });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        router.replace('/(worker)/home');
      }
    } catch (err: any) {
      Alert.alert('שגיאה', err?.errors?.[0]?.message ?? 'הכניסה נכשלה. נסי שוב.');
    } finally {
      setLoading(false);
    }
  }, [startOAuthFlow]);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.logo}>Space & Order</Text>
        <Text style={styles.subtitle}>כניסה לעובדות</Text>

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={() => void handleGoogleSignIn()}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.buttonText}>המשך עם Google</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.hint}>הכניסה מתבצעת עם חשבון Google של העובד/ת.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 28, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 },
  logo: { fontSize: 26, fontWeight: '700', color: colors.primary, textAlign: 'center', marginBottom: 4 },
  subtitle: { fontSize: 15, color: colors.muted, textAlign: 'center', marginBottom: 24 },
  button: { backgroundColor: colors.primary, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 4 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '600' },
  hint: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 14 },
});
