import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@clerk/clerk-expo';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { HE, formatDate } from '@workforce/shared';
import { colors } from '../../lib/theme';

export default function HomeScreen() {
  const { user } = useUser();
  const { data: shifts, isLoading, error } = useQuery({
    queryKey: ['my-shifts'],
    queryFn: () => api.get('/shifts/mine').then((r) => r.data),
  });

  const upcoming = shifts?.filter(
    (s: any) => s.joinRequestStatus === 'APPROVED' && new Date(s.scheduledStart) > new Date()
  ) ?? [];

  const firstName = user?.firstName?.trim();
  const errStatus = (error as any)?.response?.status;
  const errMessage = (error as any)?.response?.data?.error ?? (error as any)?.message;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.greeting}>
            שלום{firstName ? `, ${firstName}` : ''} 👋
          </Text>
          <Text style={styles.subGreeting}>המשמרות הקרובות שלך</Text>
        </View>

        {isLoading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : error ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="alert-circle-outline" size={28} color={colors.danger} />
            </View>
            <Text style={styles.emptyTitle}>לא הצלחנו לטעון את המשמרות</Text>
            <Text style={styles.emptySub}>
              {errStatus ? `שגיאה ${errStatus}` : 'שגיאת רשת'}
              {errMessage ? ` — ${errMessage}` : ''}
            </Text>
          </View>
        ) : upcoming.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="calendar-outline" size={28} color={colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>אין משמרות מתוזמנות</Text>
            <Text style={styles.emptySub}>כשתשובצי למשמרת, היא תופיע כאן.</Text>
          </View>
        ) : (
          upcoming.slice(0, 5).map((shift: any) => (
            <View key={shift.id} style={styles.card}>
              <View style={styles.cardRow}>
                <Ionicons name="briefcase-outline" size={16} color={colors.primary} />
                <Text style={styles.cardType}>
                  {HE.jobType[shift.job?.jobType as keyof typeof HE.jobType] ?? shift.job?.jobType}
                </Text>
              </View>
              <Text style={styles.cardCustomer}>
                {shift.job?.customer?.firstName} {shift.job?.customer?.lastName}
              </Text>
              <Text style={styles.cardAddress}>{shift.job?.address?.fullAddress}</Text>
              <View style={styles.cardDateRow}>
                <Ionicons name="time-outline" size={14} color={colors.muted} />
                <Text style={styles.cardDate}>{formatDate(shift.scheduledStart)}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20 },
  header: { marginBottom: 20 },
  greeting: { fontSize: 26, fontWeight: '700', color: colors.text, marginBottom: 4 },
  subGreeting: { fontSize: 15, color: colors.muted },
  stateBox: { paddingVertical: 40, alignItems: 'center' },
  emptyCard: {
    backgroundColor: colors.card, borderRadius: 16, padding: 28, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  emptyIconWrap: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 4 },
  emptySub: { fontSize: 13, color: colors.muted, textAlign: 'center' },
  card: {
    backgroundColor: colors.card, borderRadius: 14, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  cardType: { fontSize: 12, color: colors.primary, fontWeight: '700' },
  cardCustomer: { fontSize: 17, fontWeight: '600', color: colors.text },
  cardAddress: { fontSize: 13, color: colors.muted, marginTop: 2 },
  cardDateRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10 },
  cardDate: { fontSize: 13, color: colors.muted },
});
