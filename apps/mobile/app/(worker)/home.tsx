import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { HE, formatDate } from '@workforce/shared';

export default function HomeScreen() {
  const { data: shifts, isLoading } = useQuery({
    queryKey: ['my-shifts'],
    queryFn: () => api.get('/shifts/mine').then((r) => r.data),
  });

  const upcoming = shifts?.filter(
    (s: any) => s.joinRequestStatus === 'APPROVED' && new Date(s.scheduledStart) > new Date()
  ) ?? [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.greeting}>שלום 👋</Text>
      <Text style={styles.sectionTitle}>המשמרות הקרובות שלך</Text>

      {isLoading ? (
        <Text style={styles.muted}>טוען...</Text>
      ) : upcoming.length === 0 ? (
        <Text style={styles.muted}>אין משמרות מתוזמנות</Text>
      ) : (
        upcoming.slice(0, 5).map((shift: any) => (
          <View key={shift.id} style={styles.card}>
            <Text style={styles.cardDate}>{formatDate(shift.scheduledStart)}</Text>
            <Text style={styles.cardCustomer}>
              {shift.job?.customer?.firstName} {shift.job?.customer?.lastName}
            </Text>
            <Text style={styles.cardAddress}>{shift.job?.address?.fullAddress}</Text>
            <Text style={styles.cardType}>
              {HE.jobType[shift.job?.jobType as keyof typeof HE.jobType] ?? shift.job?.jobType}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f1e8' },
  content: { padding: 20 },
  greeting: { fontSize: 24, fontWeight: '700', color: '#2f251a', marginBottom: 4 },
  sectionTitle: { fontSize: 14, color: '#6d6254', marginBottom: 16 },
  muted: { color: '#6d6254', fontSize: 14, textAlign: 'center', marginTop: 32 },
  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  cardDate: { fontSize: 13, color: '#6d6254', marginBottom: 4 },
  cardCustomer: { fontSize: 17, fontWeight: '600', color: '#2f251a' },
  cardAddress: { fontSize: 13, color: '#6d6254', marginTop: 2 },
  cardType: { marginTop: 8, fontSize: 12, color: '#0f7a67', fontWeight: '600' },
});
