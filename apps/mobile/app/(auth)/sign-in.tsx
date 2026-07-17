import { useOAuth, useSignIn } from '@clerk/clerk-expo';
import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { colors } from '../../lib/theme';

// Ensures the OAuth browser session completes and hands control back to the app.
WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
  const { startOAuthFlow } = useOAuth({ strategy: 'oauth_google' });
  const { isLoaded, signIn, setActive } = useSignIn();
  const [loading, setLoading] = useState(false);

  // Email-code sign-in state
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);

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
      const { createdSessionId, setActive: setOAuthActive } = await startOAuthFlow({
        redirectUrl: Linking.createURL('/(worker)/home', { scheme: 'workforce' }),
      });
      if (createdSessionId && setOAuthActive) {
        await setOAuthActive({ session: createdSessionId });
        router.replace('/(worker)/home');
      }
    } catch (err: any) {
      Alert.alert('שגיאה', err?.errors?.[0]?.message ?? 'הכניסה נכשלה. נסי שוב.');
    } finally {
      setLoading(false);
    }
  }, [startOAuthFlow]);

  const sendCode = useCallback(async () => {
    if (!isLoaded || !signIn) return;
    const trimmed = email.trim();
    if (!trimmed) {
      Alert.alert('שגיאה', 'יש להזין כתובת אימייל.');
      return;
    }
    setEmailLoading(true);
    try {
      const attempt = await signIn.create({ identifier: trimmed });
      const emailFactor = attempt.supportedFirstFactors?.find(
        (f) => f.strategy === 'email_code',
      ) as { emailAddressId: string } | undefined;
      if (!emailFactor) {
        Alert.alert('שגיאה', 'כניסה עם קוד אימייל אינה זמינה לחשבון זה.');
        return;
      }
      await signIn.prepareFirstFactor({
        strategy: 'email_code',
        emailAddressId: emailFactor.emailAddressId,
      });
      setStep('code');
    } catch (err: any) {
      Alert.alert('שגיאה', err?.errors?.[0]?.message ?? 'שליחת הקוד נכשלה. בדקי את כתובת האימייל.');
    } finally {
      setEmailLoading(false);
    }
  }, [isLoaded, signIn, email]);

  const verifyCode = useCallback(async () => {
    if (!isLoaded || !signIn || !setActive) return;
    const trimmed = code.trim();
    if (!trimmed) {
      Alert.alert('שגיאה', 'יש להזין את הקוד שקיבלת.');
      return;
    }
    setEmailLoading(true);
    try {
      const result = await signIn.attemptFirstFactor({ strategy: 'email_code', code: trimmed });
      if (result.status === 'complete' && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        router.replace('/(worker)/home');
      } else {
        Alert.alert('שגיאה', 'האימות לא הושלם. נסי שוב.');
      }
    } catch (err: any) {
      Alert.alert('שגיאה', err?.errors?.[0]?.message ?? 'קוד שגוי. נסי שוב.');
    } finally {
      setEmailLoading(false);
    }
  }, [isLoaded, signIn, setActive, code]);

  const busy = loading || emailLoading;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.logo}>Space & Order</Text>
        <Text style={styles.subtitle}>כניסה לעובדות</Text>

        <TouchableOpacity
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={() => void handleGoogleSignIn()}
          disabled={busy}
        >
          {loading ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.buttonText}>המשך עם Google</Text>
          )}
        </TouchableOpacity>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>או</Text>
          <View style={styles.dividerLine} />
        </View>

        {step === 'email' ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="כתובת אימייל"
              placeholderTextColor={colors.muted}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={!busy}
            />
            <TouchableOpacity
              style={[styles.buttonOutline, busy && styles.buttonDisabled]}
              onPress={() => void sendCode()}
              disabled={busy}
            >
              {emailLoading ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={styles.buttonOutlineText}>שלחי לי קוד לאימייל</Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.hint}>שלחנו קוד לאימייל {email}. הזיני אותו כאן:</Text>
            <TextInput
              style={styles.input}
              placeholder="קוד בן 6 ספרות"
              placeholderTextColor={colors.muted}
              value={code}
              onChangeText={setCode}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="number-pad"
              editable={!busy}
            />
            <TouchableOpacity
              style={[styles.buttonOutline, busy && styles.buttonDisabled]}
              onPress={() => void verifyCode()}
              disabled={busy}
            >
              {emailLoading ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={styles.buttonOutlineText}>אימות והמשך</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setStep('email');
                setCode('');
              }}
              disabled={busy}
            >
              <Text style={styles.linkText}>החלפת כתובת אימייל</Text>
            </TouchableOpacity>
          </>
        )}

        <Text style={styles.hint}>הכניסה מתבצעת עם חשבון Google של העובד/ת או בקוד לאימייל.</Text>
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
  buttonOutline: { borderWidth: 1.5, borderColor: colors.primary, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 4 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '600' },
  buttonOutlineText: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 14, fontSize: 16, color: colors.text, textAlign: 'center', marginBottom: 10 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 18 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { marginHorizontal: 10, color: colors.muted, fontSize: 13 },
  linkText: { color: colors.primary, fontSize: 14, textAlign: 'center', marginTop: 12 },
  hint: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 14 },
});
