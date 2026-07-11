import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { HE, formatDate, formatTime, canRequestReplacement } from '@workforce/shared';
import * as Location from 'expo-location';

export default function ShiftsScreen() {
  const qc = useQueryClient();
  const { data: shifts, isLoading } = useQuery({
    queryKey: ['my-shifts'],
    queryFn: () => api.get('/shifts/mine').then((r) => r.data),
  });

  const clockInMutation = useMutation({
    mutationFn: async (shiftId: string) => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') throw new Error('location_denied');
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      return api.post('/attendance/clock-in', {
        shiftId,
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        timestamp: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      Alert.alert('✅', 'כניסה למשמרת נרשמה בהצלחה');
      qc.invalidateQueries({ queryKey: ['my-shifts'] });
    },
    onError: (err: any) => {
      const msg = err.response?.data?.message ?? err.message;
      if (msg === 'location_denied') {
        Alert.alert('שגיאה', 'נדרשת הרשאת מיקום. אפשר גישה למיקום בהגדרות.');
      } else if (err.response?.data?.error === 'outside_radius') {
        Alert.alert('מחוץ לתחום', HE.messages.locationBlocked);
      } else {
        Alert.alert('שגיאה', msg);
      }
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: async (shiftId: string) => {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      return api.post('/attendance/clock-out', {
        shiftId,
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        timestamp: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      Alert.alert('✅', 'יציאה ממשמרת נרשמה. אל תשכח להגיש טופס סיום.');
      qc.invalidateQueries({ queryKey: ['my-shifts'] });
    },
    onError: () => Alert.alert('שגיאה', 'לא ניתן לסיים משמרת'),
  });

  const confirmed = shifts?.filter((s: any) => s.joinRequestStatus === 'APPROVED') ?? [];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>המשמרות שלי</Text>
      {isLoading ? (
        <Text style={styles.muted}>טוען...</Text>
      ) : (
        <FlatList
          data={confirmed}
          keyExtractor={(item: any) => item.id}
          ListEmptyComponent={<Text style={styles.muted}>אין משמרות מאושרות</Text>}
          renderItem={({ item }: any) => {
            const isActive = item.attendanceStatus === 'CLOCKED_IN';
            const isDone = item.attendanceStatus === 'CLOCKED_OUT';
            const canReplace = canRequestReplacement(item.scheduledStart) && !isActive && !isDone;

            return (
              <View style={styles.card}>
                <Text style={styles.date}>{formatDate(item.scheduledStart)}</Text>
                <Text style={styles.customer}>
                  {item.job?.customer?.firstName} {item.job?.customer?.lastName}
                </Text>
                <Text style={styles.address}>{item.job?.address?.fullAddress}</Text>
                <Text style={styles.time}>
                  {formatTime(item.scheduledStart)} – {formatTime(item.scheduledEnd)}
                </Text>
                <Text style={[styles.status, isActive && styles.statusActive, isDone && styles.statusDone]}>
                  {HE.attendanceStatus[item.attendanceStatus as keyof typeof HE.attendanceStatus]}
                </Text>

                {!isActive && !isDone && (
                  <TouchableOpacity
                    style={styles.btn}
                    onPress={() => clockInMutation.mutate(item.id)}
                    disabled={clockInMutation.isPending}
                  >
                    <Text style={styles.btnText}>{HE.worker.startShift}</Text>
                  </TouchableOpacity>
                )}

                {isActive && (
                  <TouchableOpacity
                    style={[styles.btn, styles.btnDanger]}
                    onPress={() => clockOutMutation.mutate(item.id)}
                    disabled={clockOutMutation.isPending}
                  >
                    <Text style={styles.btnText}>{HE.worker.endShift}</Text>
                  </TouchableOpacity>
                )}

                {canReplace && (
                  <TouchableOpacity style={styles.btnSecondary}>
                    <Text style={styles.btnSecondaryText}>{HE.worker.requestReplacement}</Text>
                  </TouchableOpacity>
                )}
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
  date: { fontSize: 13, color: '#6d6254' },
  customer: { fontSize: 17, fontWeight: '600', color: '#2f251a', marginTop: 2 },
  address: { fontSize: 13, color: '#6d6254', marginTop: 2 },
  time: { fontSize: 14, color: '#2f251a', marginTop: 4 },
  status: { fontSize: 12, color: '#6d6254', marginTop: 6, fontWeight: '600' },
  statusActive: { color: '#0f7a67' },
  statusDone: { color: '#6d6254' },
  btn: { marginTop: 10, backgroundColor: '#0f7a67', borderRadius: 10, padding: 12, alignItems: 'center' },
  btnDanger: { backgroundColor: '#b34a3e' },
  btnSecondary: { marginTop: 8, borderWidth: 1.5, borderColor: '#0f7a67', borderRadius: 10, padding: 10, alignItems: 'center' },
  btnSecondaryText: { color: '#0f7a67', fontWeight: '600', fontSize: 14 },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
