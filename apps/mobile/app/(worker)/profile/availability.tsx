import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../../lib/api';
import { colors, fonts } from '../../../lib/theme';
import { Screen, ScreenHeader, Card, Button } from '../../../components/ui';

type BlockType = 'DATE' | 'RANGE' | 'WEEKLY';
type Block = { id: string; type: BlockType; startDate?: string | null; endDate?: string | null; weekday?: number | null; reason?: string | null };

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const REASONS = ['בחופש', 'בחו״ל', 'לא זמינה'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fmt(iso?: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '';
  }
}

function describe(b: Block): string {
  if (b.type === 'WEEKLY') return `כל יום ${WEEKDAYS[b.weekday ?? 0]}`;
  if (b.type === 'RANGE') return `${fmt(b.startDate)} – ${fmt(b.endDate)}`;
  return fmt(b.startDate);
}

export default function AvailabilityScreen() {
  const qc = useQueryClient();
  const [type, setType] = useState<BlockType>('DATE');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [weekday, setWeekday] = useState(0);
  const [reason, setReason] = useState('');

  const { data: blocks, isLoading, error } = useQuery<Block[]>({
    queryKey: ['availability'],
    queryFn: () => api.get('/workers/me/availability').then((r) => r.data),
  });

  const add = useMutation({
    mutationFn: () => {
      if (type !== 'WEEKLY' && !DATE_RE.test(startDate)) throw new Error('bad_date');
      if (type === 'RANGE' && (!DATE_RE.test(endDate) || endDate < startDate)) throw new Error('bad_range');
      return api.post('/workers/me/availability', {
        type,
        startDate: type !== 'WEEKLY' ? startDate : undefined,
        endDate: type === 'RANGE' ? endDate : undefined,
        weekday: type === 'WEEKLY' ? weekday : undefined,
        reason: reason.trim() || undefined,
      });
    },
    onSuccess: () => {
      setStartDate('');
      setEndDate('');
      setReason('');
      qc.invalidateQueries({ queryKey: ['availability'] });
    },
    onError: (err: any) => {
      if (err?.message === 'bad_date') Alert.alert('תאריך שגוי', 'יש להזין תאריך בפורמט YYYY-MM-DD.');
      else if (err?.message === 'bad_range') Alert.alert('טווח שגוי', 'יש להזין טווח תאריכים תקין.');
      else Alert.alert('שגיאה', err?.response?.data?.error ?? 'לא ניתן היה לשמור.');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/workers/me/availability/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['availability'] }),
    onError: () => Alert.alert('שגיאה', 'לא ניתן היה למחוק.'),
  });

  return (
    <Screen>
      <ScreenHeader title="הזמינות שלי" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>סמני תאריכים או ימים קבועים שבהם אינך זמינה לעבודה.</Text>

        <Card>
          <Text style={styles.sectionTitle}>הוספת חסימה</Text>
          <View style={styles.segment}>
            {([['DATE', 'תאריך'], ['RANGE', 'טווח'], ['WEEKLY', 'יום קבוע']] as [BlockType, string][]).map(([v, l]) => (
              <TouchableOpacity key={v} style={[styles.segmentBtn, type === v && styles.segmentBtnActive]} onPress={() => setType(v)}>
                <Text style={[styles.segmentText, type === v && styles.segmentTextActive]}>{l}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {type === 'WEEKLY' ? (
            <>
              <Text style={styles.label}>יום בשבוע</Text>
              <View style={styles.chipsWrap}>
                {WEEKDAYS.map((w, i) => (
                  <TouchableOpacity key={i} style={[styles.chip, weekday === i && styles.chipActive]} onPress={() => setWeekday(i)}>
                    <Text style={[styles.chipText, weekday === i && styles.chipTextActive]}>{w}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          ) : (
            <>
              <Text style={styles.label}>{type === 'RANGE' ? 'מתאריך' : 'תאריך'}</Text>
              <TextInput value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} style={styles.input} autoCapitalize="none" />
              {type === 'RANGE' ? (
                <>
                  <Text style={styles.label}>עד תאריך</Text>
                  <TextInput value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} style={styles.input} autoCapitalize="none" />
                </>
              ) : null}
            </>
          )}

          <Text style={styles.label}>סיבה (רשות)</Text>
          <TextInput value={reason} onChangeText={setReason} placeholder="סיבה" placeholderTextColor={colors.muted} style={styles.input} />
          <View style={styles.chipsWrap}>
            {REASONS.map((r) => (
              <TouchableOpacity key={r} style={styles.reasonChip} onPress={() => setReason(r)}>
                <Text style={styles.reasonChipText}>{r}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Button title="הוספה" icon="add" style={styles.addBtn} loading={add.isPending} onPress={() => add.mutate()} />
        </Card>

        <Text style={styles.sectionTitle}>חסימות פעילות</Text>
        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        ) : error ? (
          <Text style={styles.muted}>לא נמצא פרופיל עובד/ת לחשבון זה.</Text>
        ) : (blocks ?? []).length === 0 ? (
          <Card style={styles.emptyCard}>
            <Ionicons name="calendar-clear-outline" size={26} color={colors.muted} />
            <Text style={styles.muted}>לא הוגדרו חסימות. את זמינה לכל העבודות.</Text>
          </Card>
        ) : (
          (blocks ?? []).map((b) => (
            <Card key={b.id} style={styles.blockRow}>
              <TouchableOpacity onPress={() => remove.mutate(b.id)} hitSlop={8}>
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
              </TouchableOpacity>
              <View style={styles.blockInfo}>
                <Text style={styles.blockTitle}>{describe(b)}</Text>
                {b.reason ? <Text style={styles.blockReason}>{b.reason}</Text> : null}
              </View>
            </Card>
          ))
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  intro: { fontSize: 13, color: colors.muted, fontFamily: fonts.regular, textAlign: 'right' },
  sectionTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text, textAlign: 'right' },
  segment: { flexDirection: 'row', gap: 8, marginTop: 10 },
  segmentBtn: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingVertical: 10, alignItems: 'center', backgroundColor: '#f9f7f2' },
  segmentBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryBg },
  segmentText: { fontSize: 13, color: colors.muted, fontFamily: fonts.semibold },
  segmentTextActive: { color: colors.primary },
  label: { fontSize: 13, color: colors.muted, fontFamily: fonts.semibold, textAlign: 'right', marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.text, backgroundColor: '#faf8f4', textAlign: 'right' },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.card },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  chipText: { fontSize: 13, color: colors.text, fontFamily: fonts.medium },
  chipTextActive: { color: colors.white },
  reasonChip: { borderRadius: 999, backgroundColor: colors.primaryLight, paddingHorizontal: 12, paddingVertical: 6 },
  reasonChipText: { fontSize: 12, color: colors.primaryDark, fontFamily: fonts.medium },
  addBtn: { marginTop: 16 },
  muted: { color: colors.muted, textAlign: 'center', marginTop: 8, fontFamily: fonts.regular },
  emptyCard: { alignItems: 'center', gap: 6, paddingVertical: 24 },
  blockRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  blockInfo: { flex: 1 },
  blockTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.text, textAlign: 'right' },
  blockReason: { fontSize: 13, color: colors.muted, marginTop: 2, textAlign: 'right' },
});
