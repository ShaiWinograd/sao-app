import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { HE, formatDate, formatTime } from '@workforce/shared';

export default function OpenJobsScreen() {
  const qc = useQueryClient();
  const { data: jobs, isLoading } = useQuery({
    queryKey: ['open-jobs'],
    queryFn: () => api.get('/jobs?status=PUBLISHED').then((r) => r.data),
  });

  const joinMutation = useMutation({
    mutationFn: (jobId: string) => api.post('/shifts/join-request', { jobId }),
    onSuccess: () => {
      Alert.alert('נשלח!', 'בקשתך להצטרפות נשלחה');
      qc.invalidateQueries({ queryKey: ['open-jobs'] });
      qc.invalidateQueries({ queryKey: ['my-shifts'] });
    },
    onError: (err: any) => {
      Alert.alert('שגיאה', err.response?.data?.error ?? 'לא ניתן לשלוח בקשה');
    },
  });

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{HE.worker.openJobs}</Text>
      {isLoading ? (
        <Text style={styles.muted}>טוען...</Text>
      ) : (
        <FlatList
          data={jobs ?? []}
          keyExtractor={(item: any) => item.id}
          contentContainerStyle={{ paddingBottom: 20 }}
          ListEmptyComponent={<Text style={styles.muted}>אין עבודות פתוחות כרגע</Text>}
          renderItem={({ item }: any) => {
            const filled = item.shifts?.filter((s: any) => s.joinRequestStatus === 'APPROVED').length ?? 0;
            const total = item.requiredWorkerCount;
            const isFull = filled >= total;
            return (
              <View style={styles.card}>
                <Text style={styles.jobType}>
                  {HE.jobType[item.jobType as keyof typeof HE.jobType]}
                </Text>
                <Text style={styles.customer}>
                  {item.customer?.firstName} {item.customer?.lastName}
                </Text>
                <Text style={styles.address}>{item.address?.fullAddress}</Text>
                <Text style={styles.time}>
                  {formatDate(item.date)} · {formatTime(item.plannedStart)}–{formatTime(item.plannedEnd)}
                </Text>
                <Text style={styles.staffing}>
                  {filled}/{total} עובדים
                </Text>
                {item.address?.parkingNotes ? (
                  <Text style={styles.note}>חניה: {item.address.parkingNotes}</Text>
                ) : null}
                <Text style={styles.mode}>
                  {HE.staffingMode[item.staffingMode as keyof typeof HE.staffingMode]}
                </Text>
                <TouchableOpacity
                  style={[styles.btn, isFull && styles.btnDisabled]}
                  disabled={isFull || joinMutation.isPending}
                  onPress={() => joinMutation.mutate(item.id)}
                >
                  <Text style={styles.btnText}>
                    {isFull ? HE.worker.fullyBooked : HE.worker.requestToJoin}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f1e8', padding: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#2f251a', marginBottom: 16 },
  muted: { color: '#6d6254', textAlign: 'center', marginTop: 40 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  jobType: { fontSize: 12, color: '#0f7a67', fontWeight: '700', marginBottom: 4 },
  customer: { fontSize: 17, fontWeight: '600', color: '#2f251a' },
  address: { fontSize: 13, color: '#6d6254', marginTop: 2 },
  time: { fontSize: 13, color: '#2f251a', marginTop: 6 },
  staffing: { fontSize: 13, color: '#6d6254', marginTop: 4 },
  note: { fontSize: 12, color: '#6d6254', marginTop: 4, fontStyle: 'italic' },
  mode: { fontSize: 12, color: '#6d6254', marginTop: 2 },
  btn: { marginTop: 12, backgroundColor: '#0f7a67', borderRadius: 10, padding: 12, alignItems: 'center' },
  btnDisabled: { backgroundColor: '#9ca3af' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
