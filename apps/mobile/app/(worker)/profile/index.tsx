import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts } from '../../../lib/theme';
import { Screen, Card, Button } from '../../../components/ui';

type Row = { label: string; icon: keyof typeof Ionicons.glyphMap; to: string };

const ROWS: Row[] = [
  { label: 'הזמינות שלי', icon: 'calendar-outline', to: '/(worker)/profile/availability' },
  { label: 'הדוחות שלי', icon: 'cash-outline', to: '/(worker)/profile/reports' },
  { label: 'היסטוריית עבודות', icon: 'time-outline', to: '/(worker)/profile/history' },
];

export default function ProfileHub() {
  const { signOut } = useAuth();
  const { user } = useUser();

  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'הפרופיל שלי';
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress;
  const initial = (user?.firstName ?? name).trim().charAt(0) || '?';

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>הפרופיל שלי</Text>

        <Card style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.name}>{name}</Text>
            {email ? <Text style={styles.email}>{email}</Text> : null}
          </View>
        </Card>

        <Card style={styles.menuCard}>
          {ROWS.map((row, i) => (
            <TouchableOpacity
              key={row.to}
              style={[styles.row, i < ROWS.length - 1 && styles.rowDivider]}
              activeOpacity={0.7}
              onPress={() => router.push(row.to as never)}
            >
              <Ionicons name="chevron-back" size={18} color={colors.muted} />
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Ionicons name={row.icon} size={20} color={colors.primary} />
            </TouchableOpacity>
          ))}
        </Card>

        <Button title="יציאה מהמערכת" icon="log-out-outline" variant="danger" style={styles.signOut} onPress={() => signOut()} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16 },
  title: { fontSize: 20, fontFamily: fonts.bold, color: colors.text, textAlign: 'right' },
  userCard: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 22, fontFamily: fonts.bold, color: colors.primary },
  userInfo: { flex: 1 },
  name: { fontSize: 17, fontFamily: fonts.semibold, color: colors.text, textAlign: 'right' },
  email: { fontSize: 13, color: colors.muted, marginTop: 2, textAlign: 'right' },
  menuCard: { paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 4 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLabel: { flex: 1, fontSize: 15, fontFamily: fonts.medium, color: colors.text, textAlign: 'right' },
  signOut: { marginTop: 8 },
});
