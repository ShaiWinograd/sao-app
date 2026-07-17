import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, Modal, TextInput, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { HE, formatDate, formatTime, canRequestReplacement, requiresManagerNoteForEndShift } from '@workforce/shared';
import * as Location from 'expo-location';
import { colors, fonts } from '../../lib/theme';

export default function ShiftsScreen() {
  const qc = useQueryClient();
  const [endFlowVisible, setEndFlowVisible] = useState(false);
  const [endFlowShiftId, setEndFlowShiftId] = useState<string | null>(null);
  const [endFlowStatus, setEndFlowStatus] = useState<'COMPLETED' | 'PARTIALLY_COMPLETED' | 'NOT_COMPLETED'>('COMPLETED');
  const [endFlowNote, setEndFlowNote] = useState('');

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
    onSuccess: (_data, shiftId) => {
      setEndFlowShiftId(shiftId);
      setEndFlowStatus('COMPLETED');
      setEndFlowNote('');
      setEndFlowVisible(true);
      qc.invalidateQueries({ queryKey: ['my-shifts'] });
    },
    onError: () => Alert.alert('שגיאה', 'לא ניתן לסיים משמרת'),
  });

  const endShiftFormMutation = useMutation({
    mutationFn: async () => {
      if (!endFlowShiftId) throw new Error('missing_shift');
      if (requiresManagerNoteForEndShift(endFlowStatus) && !endFlowNote.trim()) {
        throw new Error('note_required');
      }
      return api.post('/forms/submit', {
        shiftId: endFlowShiftId,
        completionStatus: endFlowStatus,
        answers: [],
        managerNote: endFlowNote.trim() || undefined,
      });
    },
    onSuccess: () => {
      setEndFlowVisible(false);
      setEndFlowShiftId(null);
      setEndFlowNote('');
      Alert.alert('✅', 'סיום המשמרת והטופס נשמרו בהצלחה.');
      qc.invalidateQueries({ queryKey: ['my-shifts'] });
    },
    onError: (error: unknown) => {
      if (error instanceof Error && error.message === 'note_required') {
        Alert.alert('הערה נדרשת', 'בהשלמה חלקית או אי-השלמה יש להזין הערה למנהלת.');
        return;
      }
      Alert.alert('שגיאה', 'הטופס לא נשמר. ניתן לנסות שוב מהמסך הזה.');
    },
  });

  const respondAssignmentMutation = useMutation({
    mutationFn: ({ shiftId, accepted }: { shiftId: string; accepted: boolean }) =>
      api.post(`/shifts/${shiftId}/respond-assignment`, { accepted }),
    onSuccess: (_data, vars) => {
      Alert.alert('✅', vars.accepted ? 'אישרת את השיבוץ.' : 'דחית את השיבוץ.');
      qc.invalidateQueries({ queryKey: ['my-shifts'] });
      qc.invalidateQueries({ queryKey: ['board'] });
    },
    onError: (err: any) => Alert.alert('שגיאה', err.response?.data?.error ?? 'הפעולה נכשלה'),
  });

  const replacementMutation = useMutation({
    mutationFn: (shiftId: string) => api.post(`/shifts/${shiftId}/replacement`, { reason: 'בקשת החלפה מהאפליקציה' }),
    onSuccess: () => {
      Alert.alert('נשלח', 'בקשת ההחלפה נשלחה. תישארי משובצת עד לאישור בעל/ת העסק.');
      qc.invalidateQueries({ queryKey: ['my-shifts'] });
    },
    onError: (err: any) => Alert.alert('שגיאה', err.response?.data?.error ?? 'שליחת הבקשה נכשלה'),
  });

  function confirmReject(shiftId: string) {
    Alert.alert('דחיית שיבוץ', 'לדחות את השיבוץ למשמרת? המקום ייפתח מחדש.', [
      { text: 'ביטול', style: 'cancel' },
      { text: 'דחייה', style: 'destructive', onPress: () => respondAssignmentMutation.mutate({ shiftId, accepted: false }) },
    ]);
  }

  function confirmReplacement(shiftId: string) {
    Alert.alert('בקשת החלפה', 'לשלוח בקשת החלפה למשמרת זו?', [
      { text: 'ביטול', style: 'cancel' },
      { text: 'שליחה', onPress: () => replacementMutation.mutate(shiftId) },
    ]);
  }

  // Active shifts the worker cares about: confirmed + awaiting acceptance + pending.
  const active =
    shifts?.filter((s: any) => ['APPROVED', 'AWAITING_WORKER', 'PENDING'].includes(s.joinRequestStatus)) ?? [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Text style={styles.title}>המשמרות שלי</Text>
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={active}
          keyExtractor={(item: any) => item.id}
          ListEmptyComponent={<Text style={styles.muted}>אין משמרות פעילות</Text>}
          renderItem={({ item }: any) => {
            const isActive = item.attendanceStatus === 'CLOCKED_IN';
            const isDone = item.attendanceStatus === 'CLOCKED_OUT';
            const isAwaiting = item.joinRequestStatus === 'AWAITING_WORKER';
            const isPending = item.joinRequestStatus === 'PENDING';
            const canReplace =
              item.joinRequestStatus === 'APPROVED' && canRequestReplacement(item.scheduledStart) && !isActive && !isDone;

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

                {isAwaiting ? (
                  <>
                    <Text style={[styles.status, styles.statusAwaiting]}>שובצת למשמרת זו – יש לאשר או לדחות</Text>
                    <TouchableOpacity
                      style={styles.btn}
                      onPress={() => respondAssignmentMutation.mutate({ shiftId: item.id, accepted: true })}
                      disabled={respondAssignmentMutation.isPending}
                    >
                      <Text style={styles.btnText}>אישור השיבוץ</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.btnSecondary} onPress={() => confirmReject(item.id)}>
                      <Text style={styles.btnSecondaryText}>דחייה</Text>
                    </TouchableOpacity>
                  </>
                ) : isPending ? (
                  <Text style={[styles.status, styles.statusAwaiting]}>ממתין לאישור בעל/ת העסק</Text>
                ) : (
                  <>
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
                      <TouchableOpacity style={styles.btnSecondary} onPress={() => confirmReplacement(item.id)}>
                        <Text style={styles.btnSecondaryText}>{HE.worker.requestReplacement}</Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </View>
            );
          }}
        />
      )}

      <Modal visible={endFlowVisible} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>סיום משמרת</Text>
            <Text style={styles.modalSubtitle}>בחרי סטטוס סיום ומלאי הערה במידת הצורך.</Text>

            <View style={styles.statusRow}>
              <TouchableOpacity
                style={[styles.statusBtn, endFlowStatus === 'COMPLETED' && styles.statusBtnActive]}
                onPress={() => setEndFlowStatus('COMPLETED')}
              >
                <Text style={[styles.statusBtnText, endFlowStatus === 'COMPLETED' && styles.statusBtnTextActive]}>הושלם</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusBtn, endFlowStatus === 'PARTIALLY_COMPLETED' && styles.statusBtnActive]}
                onPress={() => setEndFlowStatus('PARTIALLY_COMPLETED')}
              >
                <Text style={[styles.statusBtnText, endFlowStatus === 'PARTIALLY_COMPLETED' && styles.statusBtnTextActive]}>הושלם חלקית</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusBtn, endFlowStatus === 'NOT_COMPLETED' && styles.statusBtnActive]}
                onPress={() => setEndFlowStatus('NOT_COMPLETED')}
              >
                <Text style={[styles.statusBtnText, endFlowStatus === 'NOT_COMPLETED' && styles.statusBtnTextActive]}>לא הושלם</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              value={endFlowNote}
              onChangeText={setEndFlowNote}
              placeholder="הערה למנהלת (אופציונלי)"
              style={styles.noteInput}
              multiline
              textAlignVertical="top"
            />

            <TouchableOpacity
              style={[styles.btn, endShiftFormMutation.isPending && styles.btnDisabled]}
              onPress={() => endShiftFormMutation.mutate()}
              disabled={endShiftFormMutation.isPending}
            >
              {endShiftFormMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>שמרי וסיימי</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 },
  title: { fontSize: 20, fontFamily: fonts.bold, color: colors.text, marginBottom: 14, textAlign: 'right' },
  muted: { color: colors.muted, textAlign: 'center', marginTop: 40, fontFamily: fonts.regular },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  date: { fontSize: 13, color: colors.muted, textAlign: 'right' },
  customer: { fontSize: 17, fontFamily: fonts.semibold, color: colors.text, marginTop: 2, textAlign: 'right' },
  address: { fontSize: 13, color: colors.muted, marginTop: 2, textAlign: 'right' },
  time: { fontSize: 14, color: colors.text, marginTop: 4, textAlign: 'right' },
  status: { fontSize: 12, color: colors.muted, marginTop: 6, fontFamily: fonts.semibold, textAlign: 'right' },
  statusActive: { color: colors.primary },
  statusAwaiting: { color: '#b45309' },
  statusDone: { color: colors.muted },
  btn: { marginTop: 10, backgroundColor: colors.primary, borderRadius: 10, padding: 12, alignItems: 'center' },
  btnDanger: { backgroundColor: colors.danger },
  btnDisabled: { backgroundColor: '#9ca3af' },
  btnSecondary: { marginTop: 8, borderWidth: 1.5, borderColor: colors.primary, borderRadius: 10, padding: 10, alignItems: 'center' },
  btnSecondaryText: { color: colors.primary, fontFamily: fonts.semibold, fontSize: 14 },
  btnText: { color: colors.white, fontFamily: fonts.semibold, fontSize: 15 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  modalTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.text, textAlign: 'right' },
  modalSubtitle: { fontSize: 13, color: colors.muted, textAlign: 'right' },
  statusRow: { flexDirection: 'row', gap: 8 },
  statusBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#f9f7f2',
  },
  statusBtnActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryBg,
  },
  statusBtnText: { fontSize: 12, color: colors.muted, fontFamily: fonts.semibold },
  statusBtnTextActive: { color: colors.primary },
  noteInput: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.text,
    backgroundColor: '#faf8f4',
    textAlign: 'right',
  },
});
