import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  TextInput,
  TouchableOpacity,
  Linking,
  Platform,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { HE, formatDate, formatTime, canRequestReplacement, requiresManagerNoteForEndShift } from '@workforce/shared';
import { api } from '../../lib/api';
import { colors, fonts, jobTypeColor } from '../../lib/theme';
import { Screen, ScreenHeader, Card, Pill, Button } from '../../components/ui';
import { useToast } from '../../components/toast';
import { useAttendanceMonitor } from '../../hooks/useAttendanceMonitor';

type Completion = 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'NOT_COMPLETED';

type FormQuestion = {
  id: string;
  questionText: string;
  type: string;
  isRequired: boolean;
  options: string[];
};

function typeLabel(t?: string): string {
  return HE.jobType[t as keyof typeof HE.jobType] ?? t ?? '';
}

function mapsUrl(address: string): string {
  const q = encodeURIComponent(address);
  return Platform.OS === 'ios' ? `http://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function ShiftDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const qc = useQueryClient();
  const toast = useToast();

  const [formOpen, setFormOpen] = useState(false);
  const [completion, setCompletion] = useState<Completion>('COMPLETED');
  const [note, setNote] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [swapOpen, setSwapOpen] = useState(false);
  const [colleagueId, setColleagueId] = useState<string | null>(null);

  const { data: shift, isLoading, error } = useQuery<any>({
    queryKey: ['shift', id],
    queryFn: () => api.get(`/shifts/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  const { data: job } = useQuery<any>({
    queryKey: ['job', shift?.jobId],
    queryFn: () => api.get(`/jobs/${shift.jobId}`).then((r) => r.data),
    enabled: !!shift?.jobId,
  });

  const { data: colleagues } = useQuery<any[]>({
    queryKey: ['colleagues'],
    queryFn: () => api.get('/workers/colleagues').then((r) => r.data),
    enabled: swapOpen,
  });

  const { data: candidates } = useQuery<any[]>({
    queryKey: ['swap-candidates', colleagueId],
    queryFn: () => api.get(`/shifts/swaps/candidates/${colleagueId}`).then((r) => r.data),
    enabled: swapOpen && !!colleagueId,
  });

  // Photo and signature questions are not filled on mobile (signature comes from
  // the worker profile; photos aren't used), so they're skipped entirely.
  const questions: FormQuestion[] = useMemo(
    () =>
      ((job?.formTemplate?.questions ?? []) as FormQuestion[]).filter(
        (q) => q.type !== 'PHOTO_UPLOAD' && q.type !== 'SIGNATURE',
      ),
    [job],
  );

  const roster: { name: string; lead: boolean }[] = useMemo(() => {
    const slots = job?.slots ?? [];
    const leaderShiftIds = new Set(
      slots.filter((s: any) => s.requiredSkill === 'SHIFT_LEADER' && s.filledByShiftId).map((s: any) => s.filledByShiftId),
    );
    return (job?.shifts ?? [])
      .filter((s: any) => s.joinRequestStatus === 'APPROVED')
      .map((s: any) => ({
        name: `${s.worker?.firstName ?? ''} ${s.worker?.lastName ?? ''}`.trim(),
        lead: leaderShiftIds.has(s.id),
      }))
      .filter((r: any) => r.name)
      .sort((a: any, b: any) => Number(b.lead) - Number(a.lead));
  }, [job]);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['shift', id] });
    qc.invalidateQueries({ queryKey: ['my-shifts'] });
    qc.invalidateQueries({ queryKey: ['board'] });
  }, [qc, id]);

  // Best-effort location: §16.1 allows clock-in even without permission (the
  // server flags it for owner review), so we never block on a denied/failed fix.
  const getPosition = async (): Promise<{ latitude: number | null; longitude: number | null }> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return { latitude: null, longitude: null };
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      return { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
    } catch {
      return { latitude: null, longitude: null };
    }
  };

  const clockIn = useMutation({
    mutationFn: async () => {
      const pos = await getPosition();
      return api.post('/attendance/clock-in', { shiftId: id, ...pos, timestamp: new Date().toISOString() });
    },
    onSuccess: (res: any) => {
      toast.show(res?.data?.needsReview ? 'הכניסה נרשמה וממתינה לאישור בעל/ת העסק' : 'כניסה למשמרת נרשמה בהצלחה');
      invalidate();
    },
    onError: (err: any) => {
      Alert.alert('שגיאה', err?.response?.data?.message ?? err?.response?.data?.error ?? 'לא ניתן לרשום כניסה');
    },
  });

  const clockOut = useMutation({
    mutationFn: async () => {
      const pos = await getPosition();
      return api.post('/attendance/clock-out', { shiftId: id, ...pos, timestamp: new Date().toISOString() });
    },
    onSuccess: () => {
      setCompletion('COMPLETED');
      setNote('');
      setAnswers({});
      setFormOpen(true);
      invalidate();
    },
    onError: (err: any) => {
      // The server sweep may have already auto-clocked-out (race). Reconcile to the
      // authoritative state instead of showing a hard error.
      const msg = err?.response?.data?.error;
      if (msg === 'Already clocked out') {
        toast.show('המשמרת כבר נסגרה.');
        invalidate();
      } else {
        Alert.alert('שגיאה', 'לא ניתן לרשום יציאה');
      }
    },
  });

  // §16.2: worker confirms the owner-proposed start after a missing clock-in.
  const confirmProposed = useMutation({
    mutationFn: async () => api.post(`/attendance/${id}/confirm-proposed`, {}),
    onSuccess: () => {
      toast.show('אישרת את שעת ההתחלה. ממתין לאישור בעל/ת העסק.');
      invalidate();
    },
    onError: (err: any) => Alert.alert('שגיאה', err?.response?.data?.error ?? 'הפעולה נכשלה'),
  });

  const submitForm = useMutation({
    mutationFn: async () => {
      const missingRequired = questions.some((q) => q.isRequired && !((answers[q.id] ?? '').trim()));
      if (missingRequired) throw new Error('answers_required');
      if (requiresManagerNoteForEndShift(completion) && !note.trim()) throw new Error('note_required');
      return api.post('/forms/submit', {
        shiftId: id,
        completionStatus: completion,
        answers: questions.map((q) => ({ questionId: q.id, value: answers[q.id] ?? '' })),
        managerNote: note.trim() || undefined,
      });
    },
    onSuccess: () => {
      setFormOpen(false);
      toast.show('טופס הסיום נשמר. תודה!');
      invalidate();
    },
    onError: (err: any) => {
      if (err?.message === 'answers_required') Alert.alert('חסרים שדות', 'יש למלא את כל השאלות המסומנות כחובה.');
      else if (err?.message === 'note_required') Alert.alert('הערה נדרשת', 'בהשלמה חלקית או אי-השלמה יש להזין הערה למנהלת.');
      else Alert.alert('שגיאה', 'הטופס לא נשמר. נסי שוב.');
    },
  });

  const respond = useMutation({
    mutationFn: (accepted: boolean) => api.post(`/shifts/${id}/respond-assignment`, { accepted }),
    onSuccess: (_d, accepted) => {
      toast.show(accepted ? 'אישרת את השיבוץ.' : 'דחית את השיבוץ.');
      invalidate();
    },
    onError: (err: any) => Alert.alert('שגיאה', err?.response?.data?.message ?? err?.response?.data?.error ?? 'הפעולה נכשלה'),
  });

  const replacement = useMutation({
    mutationFn: () => api.post(`/shifts/${id}/replacement`, { reason: 'בקשת החלפה מהאפליקציה' }),
    onSuccess: (res: any) => {
      toast.show(
        res?.data?.autoPromoted
          ? 'שוחררת מהמשמרת. גיבוי שובץ במקומך.'
          : 'בקשת ההחלפה נשלחה. תישארי משובצת עד לאישור בעל/ת העסק.',
      );
      invalidate();
    },
    onError: (err: any) => Alert.alert('שגיאה', err?.response?.data?.message ?? err?.response?.data?.error ?? 'שליחת הבקשה נכשלה'),
  });

  const proposeSwap = useMutation({
    mutationFn: (toShiftId: string) => api.post(`/shifts/${id}/swap`, { toShiftId }),
    onSuccess: () => {
      setSwapOpen(false);
      setColleagueId(null);
      toast.show('הצעת ההחלפה נשלחה לאישור העמית/ה.');
      invalidate();
    },
    onError: (err: any) => Alert.alert('שגיאה', err?.response?.data?.error ?? 'שליחת ההצעה נכשלה'),
  });

  // §16.3/§16.4 leaving-area watcher for this shift (active only while clocked in).
  const jobCoords =
    shift?.job?.address?.latitude != null && shift?.job?.address?.longitude != null
      ? { latitude: shift.job.address.latitude as number, longitude: shift.job.address.longitude as number }
      : null;
  const areaMonitor = useAttendanceMonitor({
    shiftId: id,
    attendanceStatus: shift?.attendanceStatus ?? '',
    areaExitDeadline: shift?.areaExitDeadline ?? null,
    jobCoords,
    refetch: invalidate,
  });

  if (isLoading) {
    return (
      <Screen>
        <ScreenHeader title="פרטי משמרת" onBack={() => router.back()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (error || !shift) {
    return (
      <Screen>
        <ScreenHeader title="פרטי משמרת" onBack={() => router.back()} />
        <Text style={styles.muted}>לא הצלחנו לטעון את המשמרת.</Text>
      </Screen>
    );
  }

  const tColor = jobTypeColor(shift.job?.jobType);
  const address = shift.job?.address?.fullAddress as string | undefined;
  const phone = shift.job?.customer?.phone as string | undefined;
  const isActive = shift.attendanceStatus === 'CLOCKED_IN';
  const isDone = shift.attendanceStatus === 'CLOCKED_OUT';
  const isAwaiting = shift.joinRequestStatus === 'AWAITING_WORKER';
  const isPending = shift.joinRequestStatus === 'PENDING';
  const canReplace =
    shift.joinRequestStatus === 'APPROVED' && canRequestReplacement(shift.scheduledStart) && !isActive && !isDone;
  const canSwap = shift.joinRequestStatus === 'APPROVED' && !isActive && !isDone;

  return (
    <Screen>
      <ScreenHeader title="פרטי משמרת" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Hero */}
        <View style={[styles.hero, { backgroundColor: tColor }]}>
          <Text style={styles.heroType}>{typeLabel(shift.job?.jobType)}</Text>
          <Text style={styles.heroCustomer}>
            {shift.job?.customer?.firstName} {shift.job?.customer?.lastName}
          </Text>
          <View style={styles.heroRow}>
            <Ionicons name="calendar-outline" size={15} color="rgba(255,255,255,0.9)" />
            <Text style={styles.heroMeta}>{formatDate(shift.scheduledStart)}</Text>
            <Ionicons name="time-outline" size={15} color="rgba(255,255,255,0.9)" style={{ marginRight: 8 }} />
            <Text style={styles.heroMeta}>
              {formatTime(shift.scheduledStart)}–{formatTime(shift.scheduledEnd)}
            </Text>
          </View>
        </View>

        {/* Address + actions */}
        {address ? (
          <Card style={styles.section}>
            <View style={styles.rowStart}>
              <Ionicons name="location-outline" size={18} color={colors.primary} />
              <Text style={styles.addressText}>
                {address}
                {shift.job?.address?.apartmentDetails ? ` · ${shift.job.address.apartmentDetails}` : ''}
              </Text>
            </View>
            <View style={styles.actionRow}>
              <Button title="ניווט" icon="navigate-outline" variant="outline" style={styles.flexBtn} onPress={() => Linking.openURL(mapsUrl(address))} />
              {phone ? (
                <Button title="התקשרות" icon="call-outline" variant="outline" style={styles.flexBtn} onPress={() => Linking.openURL(`tel:${phone}`)} />
              ) : null}
            </View>
          </Card>
        ) : null}

        {/* Team roster */}
        {roster.length > 0 ? (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>הצוות</Text>
            <View style={styles.chipsWrap}>
              {roster.map((r, i) => (
                <View key={i} style={styles.memberChip}>
                  <Text style={styles.memberChipText}>
                    {r.lead ? '★ ' : ''}
                    {r.name}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        {/* Instructions */}
        {(shift.job?.workerVisibleNotes || shift.job?.address?.parkingNotes || shift.job?.address?.accessNotes || shift.job?.address?.elevatorNotes) ? (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>הנחיות</Text>
            <NoteRow label="הערות לעבודה" value={shift.job?.workerVisibleNotes} />
            <NoteRow label="חניה" value={shift.job?.address?.parkingNotes} />
            <NoteRow label="גישה" value={shift.job?.address?.accessNotes} />
            <NoteRow label="מעלית" value={shift.job?.address?.elevatorNotes} />
          </Card>
        ) : null}

        {/* Status + primary actions */}
        <Card style={styles.section}>
          {isAwaiting ? (
            <>
              <Pill label="שובצת – יש לאשר או לדחות" color="#b45309" bg="#fef3c7" />
              <Button title="אישור השיבוץ" icon="checkmark" style={styles.mt12} loading={respond.isPending} onPress={() => respond.mutate(true)} />
              <Button
                title="דחייה"
                variant="outline"
                style={styles.mt8}
                onPress={() =>
                  Alert.alert('דחיית שיבוץ', 'לדחות את השיבוץ? המקום ייפתח מחדש.', [
                    { text: 'ביטול', style: 'cancel' },
                    { text: 'דחייה', style: 'destructive', onPress: () => respond.mutate(false) },
                  ])
                }
              />
            </>
          ) : isPending ? (
            <Pill label="ממתין לאישור בעל/ת העסק" color="#b45309" bg="#fef3c7" />
          ) : (
            <>
              <Pill
                label={HE.attendanceStatus[shift.attendanceStatus as keyof typeof HE.attendanceStatus] ?? 'משובצת'}
                color={isActive ? colors.primary : colors.muted}
                bg={isActive ? colors.primaryLight : '#f1eff4'}
              />
              {shift.attendanceStatus === 'PROPOSED' ? (
                <Button title="אישור שעת התחלה מוצעת" icon="checkmark-circle-outline" style={styles.mt12} loading={confirmProposed.isPending} onPress={() => confirmProposed.mutate()} />
              ) : !isActive && !isDone ? (
                <Button title={HE.worker.startShift} icon="log-in-outline" style={styles.mt12} loading={clockIn.isPending} onPress={() => clockIn.mutate()} />
              ) : null}
              {isActive ? (
                <Button title={HE.worker.endShift} icon="log-out-outline" variant="danger" style={styles.mt12} loading={clockOut.isPending} onPress={() => clockOut.mutate()} />
              ) : null}
              {isActive && areaMonitor.pendingExit ? (
                <View style={styles.exitPrompt}>
                  <Text style={styles.exitPromptTitle}>עזבת את אזור העבודה</Text>
                  <Text style={styles.exitPromptBody}>
                    המשמרת תיסגר אוטומטית בעוד {formatCountdown(areaMonitor.remainingMs)} אם לא תחזרי לאזור. ניתן לסיים כעת.
                  </Text>
                  <Button title="סיום משמרת עכשיו" icon="log-out-outline" variant="danger" style={styles.mt8} loading={clockOut.isPending} onPress={() => clockOut.mutate()} />
                </View>
              ) : null}
              {isDone && !formOpen ? (
                <Button title="מילוי טופס סיום" icon="document-text-outline" variant="outline" style={styles.mt12} onPress={() => setFormOpen(true)} />
              ) : null}
              {canReplace ? (
                <Button
                  title={HE.worker.requestReplacement}
                  variant="outline"
                  style={styles.mt8}
                  onPress={() =>
                    Alert.alert('בקשת החלפה', 'לשלוח בקשת החלפה למשמרת זו?', [
                      { text: 'ביטול', style: 'cancel' },
                      { text: 'שליחה', onPress: () => replacement.mutate() },
                    ])
                  }
                />
              ) : null}
              {canSwap ? (
                <Button title="הצעת החלפה עם עמית/ה" icon="swap-horizontal" variant="outline" style={styles.mt8} onPress={() => setSwapOpen(true)} />
              ) : null}
            </>
          )}
        </Card>

        {/* End-shift form */}
        {formOpen ? (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>טופס סיום משמרת</Text>

            <Text style={styles.fieldLabel}>סטטוס סיום</Text>
            <View style={styles.segment}>
              {([['COMPLETED', 'הושלם'], ['PARTIALLY_COMPLETED', 'חלקית'], ['NOT_COMPLETED', 'לא הושלם']] as [Completion, string][]).map(([v, l]) => (
                <TouchableOpacity key={v} style={[styles.segmentBtn, completion === v && styles.segmentBtnActive]} onPress={() => setCompletion(v)}>
                  <Text style={[styles.segmentText, completion === v && styles.segmentTextActive]}>{l}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {questions.map((q) => (
              <QuestionField key={q.id} q={q} value={answers[q.id] ?? ''} onChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v }))} />
            ))}

            <Text style={styles.fieldLabel}>הערה למנהלת {requiresManagerNoteForEndShift(completion) ? '(חובה)' : '(רשות)'}</Text>
            <TextInput value={note} onChangeText={setNote} placeholder="הערה" placeholderTextColor={colors.muted} style={styles.textArea} multiline textAlignVertical="top" />

            <Button title="שמירה וסיום" icon="checkmark-done" style={styles.mt12} loading={submitForm.isPending} onPress={() => submitForm.mutate()} />
          </Card>
        ) : null}

        <View style={{ height: 24 }} />
      </ScrollView>

      <Modal visible={swapOpen} transparent animationType="slide" onRequestClose={() => setSwapOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.swapModal}>
            <View style={styles.swapModalHead}>
              <TouchableOpacity onPress={() => (colleagueId ? setColleagueId(null) : setSwapOpen(false))} hitSlop={8}>
                <Ionicons name={colleagueId ? 'chevron-forward' : 'close'} size={22} color={colors.text} />
              </TouchableOpacity>
              <Text style={styles.swapModalTitle}>{colleagueId ? 'בחרי משמרת להחלפה' : 'בחרי עמית/ה'}</Text>
            </View>
            <ScrollView style={{ maxHeight: 380 }}>
              {!colleagueId ? (
                (colleagues ?? []).length === 0 ? (
                  <Text style={styles.muted}>לא נמצאו עמיתים.</Text>
                ) : (
                  (colleagues ?? []).map((c: any) => (
                    <TouchableOpacity key={c.id} style={styles.pickRow} onPress={() => setColleagueId(c.id)}>
                      <Ionicons name="chevron-back" size={18} color={colors.muted} />
                      <Text style={styles.pickName}>{c.name}</Text>
                    </TouchableOpacity>
                  ))
                )
              ) : (candidates ?? []).length === 0 ? (
                <Text style={styles.muted}>אין משמרות זמינות להחלפה עם עמית/ה זו.</Text>
              ) : (
                (candidates ?? []).map((c: any) => (
                  <View key={c.shiftId} style={styles.candRow}>
                    <TouchableOpacity style={styles.candBtn} disabled={proposeSwap.isPending} onPress={() => proposeSwap.mutate(c.shiftId)}>
                      <Text style={styles.candBtnText}>הצעה</Text>
                    </TouchableOpacity>
                    <View style={styles.candInfo}>
                      <Text style={styles.candCustomer}>{typeLabel(c.jobType)} · {c.customerName}</Text>
                      <Text style={styles.candMeta}>{formatDate(c.date)} · {formatTime(c.plannedStart)}–{formatTime(c.plannedEnd)}</Text>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function NoteRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.noteRow}>
      <Text style={styles.noteLabel}>{label}</Text>
      <Text style={styles.noteValue}>{value}</Text>
    </View>
  );
}

function QuestionField({ q, value, onChange }: { q: FormQuestion; value: string; onChange: (v: string) => void }) {
  const label = `${q.questionText}${q.isRequired ? ' *' : ''}`;

  if (q.type === 'YES_NO') {
    return (
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <View style={styles.chipsRow}>
          {([['YES', 'כן'], ['NO', 'לא']] as [string, string][]).map(([v, l]) => (
            <TouchableOpacity key={v} style={[styles.choice, value === v && styles.choiceActive]} onPress={() => onChange(v)}>
              <Text style={[styles.choiceText, value === v && styles.choiceTextActive]}>{l}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  if (q.type === 'MULTIPLE_CHOICE') {
    return (
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <View style={styles.chipsWrap}>
          {q.options.map((opt) => (
            <TouchableOpacity key={opt} style={[styles.choice, value === opt && styles.choiceActive]} onPress={() => onChange(opt)}>
              <Text style={[styles.choiceText, value === opt && styles.choiceTextActive]}>{opt}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  if (q.type === 'CHECKBOX') {
    const selected = value ? value.split('|') : [];
    const toggle = (opt: string) => {
      const next = selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt];
      onChange(next.join('|'));
    };
    return (
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <View style={styles.chipsWrap}>
          {q.options.map((opt) => (
            <TouchableOpacity key={opt} style={[styles.choice, selected.includes(opt) && styles.choiceActive]} onPress={() => toggle(opt)}>
              <Text style={[styles.choiceText, selected.includes(opt) && styles.choiceTextActive]}>{opt}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  // NUMBER / SHORT_TEXT / LONG_TEXT / DATE
  const multiline = q.type === 'LONG_TEXT';
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={q.type === 'DATE' ? 'YYYY-MM-DD' : ''}
        placeholderTextColor={colors.muted}
        keyboardType={q.type === 'NUMBER' ? 'numeric' : 'default'}
        style={[styles.input, multiline && styles.textArea]}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: colors.muted, textAlign: 'center', marginTop: 40, fontFamily: fonts.regular },
  content: { padding: 16, gap: 12 },
  hero: { borderRadius: 18, padding: 18 },
  heroType: { fontSize: 13, fontFamily: fonts.bold, color: colors.white },
  heroCustomer: { fontSize: 22, fontFamily: fonts.bold, color: colors.white, marginTop: 4, textAlign: 'right' },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  heroMeta: { fontSize: 13, color: 'rgba(255,255,255,0.95)', fontFamily: fonts.medium },
  section: {},
  sectionTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text, marginBottom: 10, textAlign: 'right' },
  rowStart: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  addressText: { flex: 1, fontSize: 15, color: colors.text, fontFamily: fonts.medium, textAlign: 'right' },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  flexBtn: { flex: 1 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  memberChip: { backgroundColor: '#f1eff4', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  memberChipText: { fontSize: 12, color: colors.text, fontFamily: fonts.medium },
  noteRow: { marginBottom: 8 },
  noteLabel: { fontSize: 12, color: colors.muted, fontFamily: fonts.semibold, textAlign: 'right' },
  noteValue: { fontSize: 14, color: colors.text, fontFamily: fonts.regular, textAlign: 'right', marginTop: 1 },
  mt8: { marginTop: 8 },
  mt12: { marginTop: 12 },
  exitPrompt: { marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: '#fecaca', backgroundColor: '#fef2f2', padding: 12 },
  exitPromptTitle: { fontSize: 15, fontWeight: '700', color: '#b91c1c' },
  exitPromptBody: { fontSize: 13, color: '#7f1d1d', marginTop: 4 },
  field: { marginTop: 12 },
  fieldLabel: { fontSize: 13, color: colors.muted, fontFamily: fonts.semibold, textAlign: 'right', marginBottom: 6 },
  segment: { flexDirection: 'row', gap: 8 },
  segmentBtn: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingVertical: 10, alignItems: 'center', backgroundColor: '#f9f7f2' },
  segmentBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryBg },
  segmentText: { fontSize: 13, color: colors.muted, fontFamily: fonts.semibold },
  segmentTextActive: { color: colors.primary },
  chipsRow: { flexDirection: 'row', gap: 8 },
  choice: { borderRadius: 999, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.card },
  choiceActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  choiceText: { fontSize: 13, color: colors.text, fontFamily: fonts.medium },
  choiceTextActive: { color: colors.white },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.text, backgroundColor: '#faf8f4', textAlign: 'right' },
  textArea: { minHeight: 90, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.text, backgroundColor: '#faf8f4', textAlign: 'right' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  swapModal: { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 28 },
  swapModalHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  swapModalTitle: { flex: 1, fontSize: 16, fontFamily: fonts.bold, color: colors.text, textAlign: 'right' },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickName: { flex: 1, fontSize: 15, fontFamily: fonts.medium, color: colors.text, textAlign: 'right' },
  candRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  candBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 16 },
  candBtnText: { color: colors.white, fontFamily: fonts.semibold, fontSize: 14 },
  candInfo: { flex: 1 },
  candCustomer: { fontSize: 15, fontFamily: fonts.semibold, color: colors.text, textAlign: 'right' },
  candMeta: { fontSize: 12, color: colors.muted, textAlign: 'right', marginTop: 2 },
});
