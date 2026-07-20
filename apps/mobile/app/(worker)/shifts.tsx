import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, Modal, TextInput, ActivityIndicator, RefreshControl } from 'react-native';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { HE, formatDate, formatTime, canRequestReplacement, requiresManagerNoteForEndShift } from '@workforce/shared';
import * as Location from 'expo-location';
import { colors, fonts } from '../../lib/theme';
import { SkeletonList } from '../../components/ui';
import { useToast } from '../../components/toast';

export default function ShiftsScreen() {
  const qc = useQueryClient();
  const toast = useToast();
  const [endFlowVisible, setEndFlowVisible] = useState(false);
  const [endFlowShiftId, setEndFlowShiftId] = useState<string | null>(null);
  const [endFlowStatus, setEndFlowStatus] = useState<'COMPLETED' | 'PARTIALLY_COMPLETED' | 'NOT_COMPLETED'>('COMPLETED');
  const [endFlowNote, setEndFlowNote] = useState('');

  const { data: shifts, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['my-shifts'],
    queryFn: () => api.get('/shifts/mine').then((r) => r.data),
  });

  const clockInMutation = useMutation({
    mutationFn: async (shiftId: string) => {
      // Best-effort location: §16.1 allows clock-in without permission (server
      // flags it for owner review) — never block on a denied/failed fix.
      let latitude: number | null = null;
      let longitude: number | null = null;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          latitude = loc.coords.latitude;
          longitude = loc.coords.longitude;
        }
      } catch {
        /* no location — proceed, server marks for review */
      }
      return api.post('/attendance/clock-in', { shiftId, latitude, longitude, timestamp: new Date().toISOString() });
    },
    onSuccess: (res: any) => {
      toast.show(res?.data?.needsReview ? 'הכניסה נרשמה וממתינה לאישור בעל/ת העסק' : 'כניסה למשמרת נרשמה בהצלחה');
      qc.invalidateQueries({ queryKey: ['my-shifts'] });
    },
    onError: (err: any) => {
      Alert.alert('שגיאה', err.response?.data?.message ?? err.response?.data?.error ?? 'לא ניתן לרשום כניסה');
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: async (shiftId: string) => {
      let latitude: number | null = null;
      let longitude: number | null = null;
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        latitude = loc.coords.latitude;
        longitude = loc.coords.longitude;
      } catch {
        /* proceed without location */
      }
      return api.post('/attendance/clock-out', { shiftId, latitude, longitude, timestamp: new Date().toISOString() });
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
      toast.show('סיום המשמרת והטופס נשמרו בהצלחה.');
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
      toast.show(vars.accepted ? 'אישרת את השיבוץ.' : 'דחית את השיבוץ.');
      qc.invalidateQueries({ queryKey: ['my-shifts'] });
      qc.invalidateQueries({ queryKey: ['board'] });
    },
    onError: (err: any) => Alert.alert('שגיאה', err.response?.data?.message ?? err.response?.data?.error ?? 'הפעולה נכשלה'),
  });

  const replacementMutation = useMutation({
    mutationFn: (shiftId: string) => api.post(`/shifts/${shiftId}/replacement`, { reason: 'בקשת החלפה מהאפליקציה' }),
    onSuccess: (res: any) => {
      // Within 48h of the job the drop is immediate (a backup is auto-promoted);
      // otherwise it opens a replacement request the owner resolves (§13.2).
      toast.show(
        res?.data?.autoPromoted
          ? 'שוחררת מהמשמרת. גיבוי שובץ במקומך.'
          : 'בקשת ההחלפה נשלחה. תישארי משובצת עד לאישור בעל/ת העסק.',
      );
      qc.invalidateQueries({ queryKey: ['my-shifts'] });
    },
    onError: (err: any) => Alert.alert('שגיאה', err.response?.data?.message ?? err.response?.data?.error ?? 'שליחת הבקשה נכשלה'),
  });

  const { data: swaps } = useQuery<any[]>({
    queryKey: ['swaps'],
    queryFn: () => api.get('/shifts/swaps/mine').then((r) => r.data),
  });

  const respondSwap = useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) => api.post(`/shifts/swaps/${id}/respond`, { approved }),
    onSuccess: (_d, vars) => {
      toast.show(vars.approved ? 'אישרת את ההחלפה.' : 'דחית את ההחלפה.');
      qc.invalidateQueries({ queryKey: ['swaps'] });
      qc.invalidateQueries({ queryKey: ['my-shifts'] });
    },
    onError: (err: any) => Alert.alert('שגיאה', err.response?.data?.error ?? 'הפעולה נכשלה'),
  });

  const cancelSwap = useMutation({
    mutationFn: (id: string) => api.delete(`/shifts/swaps/${id}`),
    onSuccess: () => {
      toast.show('הצעת ההחלפה בוטלה.');
      qc.invalidateQueries({ queryKey: ['swaps'] });
    },
    onError: (err: any) => Alert.alert('שגיאה', err.response?.data?.error ?? 'הביטול נכשל'),
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
        <SkeletonList />
      ) : (
        <FlatList
          data={active}
          keyExtractor={(item: any) => item.id}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor={colors.primary} />}
          ListHeaderComponent={
            <SwapsSection
              swaps={swaps ?? []}
              busy={respondSwap.isPending || cancelSwap.isPending}
              onRespond={(id, approved) => respondSwap.mutate({ id, approved })}
              onCancel={(id) =>
                Alert.alert('ביטול הצעה', 'לבטל את הצעת ההחלפה?', [
                  { text: 'לא', style: 'cancel' },
                  { text: 'ביטול', style: 'destructive', onPress: () => cancelSwap.mutate(id) },
                ])
              }
            />
          }
          ListEmptyComponent={<Text style={styles.muted}>אין משמרות פעילות</Text>}
          renderItem={({ item }: any) => {
            const isActive = item.attendanceStatus === 'CLOCKED_IN';
            const isDone = item.attendanceStatus === 'CLOCKED_OUT';
            const isAwaiting = item.joinRequestStatus === 'AWAITING_WORKER';
            const isPending = item.joinRequestStatus === 'PENDING';
            const canReplace =
              item.joinRequestStatus === 'APPROVED' && canRequestReplacement(item.scheduledStart) && !isActive && !isDone;

            return (
              <TouchableOpacity
                style={styles.card}
                activeOpacity={0.9}
                onPress={() => router.push({ pathname: '/(worker)/shift-detail', params: { id: item.id } })}
              >
                <View style={styles.cardHead}>
                  <Text style={styles.date}>{formatDate(item.scheduledStart)}</Text>
                  <Ionicons name="chevron-back" size={18} color={colors.muted} />
                </View>
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
              </TouchableOpacity>
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

function swapTypeLabel(t?: string): string {
  return HE.jobType[t as keyof typeof HE.jobType] ?? t ?? '';
}

function SwapsSection({
  swaps,
  busy,
  onRespond,
  onCancel,
}: {
  swaps: any[];
  busy: boolean;
  onRespond: (id: string, approved: boolean) => void;
  onCancel: (id: string) => void;
}) {
  const relevant = swaps.filter((s) => s.awaitingMe || s.direction === 'OUTGOING');
  if (relevant.length === 0) return null;
  return (
    <View style={styles.swapsSection}>
      <Text style={styles.swapsTitle}>בקשות החלפה</Text>
      {relevant.map((s) => (
        <View key={s.id} style={styles.swapCard}>
          <Text style={styles.swapHeading}>
            {s.awaitingMe ? `${s.counterpartName} מבקש/ת להחליף איתך` : `הצעת החלפה ל${s.counterpartName}`}
          </Text>
          <Text style={styles.swapLine}>
            המשמרת שלך: {formatDate(s.myShift.date)} · {swapTypeLabel(s.myShift.jobType)} · {s.myShift.customerName}
          </Text>
          <Text style={styles.swapLine}>
            בתמורה: {formatDate(s.theirShift.date)} · {swapTypeLabel(s.theirShift.jobType)} · {s.theirShift.customerName}
          </Text>
          {s.awaitingMe ? (
            <View style={styles.swapActions}>
              <TouchableOpacity style={styles.swapApprove} disabled={busy} onPress={() => onRespond(s.id, true)}>
                <Text style={styles.swapApproveText}>אישור</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.swapReject} disabled={busy} onPress={() => onRespond(s.id, false)}>
                <Text style={styles.swapRejectText}>דחייה</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.swapActions}>
              <Text style={styles.swapPending}>ממתין לאישור</Text>
              <TouchableOpacity disabled={busy} onPress={() => onCancel(s.id)}>
                <Text style={styles.swapCancel}>ביטול</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 },
  title: { fontSize: 20, fontFamily: fonts.bold, color: colors.text, marginBottom: 14, textAlign: 'right' },
  muted: { color: colors.muted, textAlign: 'center', marginTop: 40, fontFamily: fonts.regular },
  swapsSection: { marginBottom: 8 },
  swapsTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text, textAlign: 'right', marginBottom: 8 },
  swapCard: { backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 10, borderRightWidth: 4, borderRightColor: colors.primary, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  swapHeading: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text, textAlign: 'right', marginBottom: 6 },
  swapLine: { fontSize: 13, color: colors.muted, textAlign: 'right', marginTop: 2 },
  swapActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  swapApprove: { flex: 1, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  swapApproveText: { color: colors.white, fontFamily: fonts.semibold, fontSize: 14 },
  swapReject: { flex: 1, borderWidth: 1.5, borderColor: colors.danger, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  swapRejectText: { color: colors.danger, fontFamily: fonts.semibold, fontSize: 14 },
  swapPending: { flex: 1, fontSize: 13, color: '#b45309', fontFamily: fonts.semibold, textAlign: 'right' },
  swapCancel: { fontSize: 14, color: colors.danger, fontFamily: fonts.semibold },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
