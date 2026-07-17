import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts } from '../../lib/theme';

export default function ProfileScreen() {
  const { signOut } = useAuth();
  const { user } = useUser();

  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'הפרופיל שלי';
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress;
  const initial = (user?.firstName ?? name).trim().charAt(0) || '?';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Text style={styles.title}>הפרופיל שלי</Text>

      <View style={styles.userCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.name}>{name}</Text>
          {email ? <Text style={styles.email}>{email}</Text> : null}
        </View>
      </View>

      <View style={styles.spacer} />

      <TouchableOpacity style={styles.signOut} onPress={() => signOut()}>
        <Ionicons name="log-out-outline" size={18} color={colors.white} />
        <Text style={styles.signOutText}>יציאה מהמערכת</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20 },
  title: { fontSize: 20, fontFamily: fonts.bold, color: colors.text, marginBottom: 16, textAlign: 'right' },
  userCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.card, borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  avatar: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 22, fontFamily: fonts.bold, color: colors.primary },
  userInfo: { flex: 1 },
  name: { fontSize: 17, fontFamily: fonts.semibold, color: colors.text, textAlign: 'right' },
  email: { fontSize: 13, color: colors.muted, marginTop: 2, textAlign: 'right' },
  spacer: { flex: 1 },
  signOut: {
    flexDirection: 'row', gap: 8, backgroundColor: colors.danger,
    borderRadius: 12, padding: 14, alignItems: 'center', justifyContent: 'center',
  },
  signOutText: { color: colors.white, fontFamily: fonts.semibold, fontSize: 15 },
});
