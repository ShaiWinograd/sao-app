import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../../lib/api';
import { colors, fonts } from '../../../lib/theme';
import { Screen, ScreenHeader, Card, Pill, Button } from '../../../components/ui';
import { useToast } from '../../../components/toast';
import { workerReportStatusLabel } from '@workforce/shared';

const ils = (n: number) => '₪' + (n ?? 0).toLocaleString('he-IL');

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
  } catch {
    return '';
  }
}

export default function ReportsScreen() {
  const qc = useQueryClient();
  const toast = useToast();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeNote, setDisputeNote] = useState('');

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ['payroll', month, year],
    queryFn: () => api.get(`/payroll/me?month=${month}&year=${year}`).then((r) => r.data),
  });

  const approve = useMutation({
    mutationFn: (payload: { action: 'APPROVE' | 'REQUEST_CHANGES'; note?: string }) =>
      api.post('/payroll/me/approval', { month, year, action: payload.action, note: payload.note }),
    onSuccess: (_d, vars) => {
      setDisputeOpen(false);
      setDisputeNote('');
      toast.show(vars.action === 'APPROVE' ? 'הדוח אושר. תודה!' : 'בקשת התיקון נשלחה.');
      qc.invalidateQueries({ queryKey: ['payroll', month, year] });
    },
    onError: (err: any) => Alert.alert('שגיאה', err?.response?.data?.error ?? 'הפעולה נכשלה'),
  });

  const shift = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setMonth(m);
    setYear(y);
    setDisputeOpen(false);
  };

  const status = data?.status as string | undefined;
  const isPublished = Boolean(data?.isPublished);
  const summary = data?.summary;
  const lines = (data?.shifts ?? []) as any[];

  return (
    <Screen>
      <ScreenHeader title="הדוחות שלי" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.monthNav}>
          <TouchableOpacity onPress={() => shift(-1)} hitSlop={8}>
            <Ionicons name="chevron-forward" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.monthLabel}>{String(month).padStart(2, '0')}/{year}</Text>
          <TouchableOpacity onPress={() => shift(1)} hitSlop={8} disabled={year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1)}>
            <Ionicons name="chevron-back" size={22} color={year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1) ? colors.border : colors.text} />
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} />
        ) : error ? (
          <Text style={styles.muted}>לא הצלחנו לטעון את הדוח.</Text>
        ) : (
          <>
            <Card>
              <View style={styles.statsRow}>
                <Stat label="ימי עבודה" value={String(summary?.workdays ?? 0)} />
                <Stat label="שעות נוכחות" value={String(summary?.totalApprovedHours ?? 0)} />
                <Stat label="שעות לתשלום" value={String(summary?.totalPaidHours ?? summary?.totalApprovedHours ?? 0)} />
              </View>
              <View style={styles.divider} />
              <View style={styles.outstandingRow}>
                <Text style={styles.outstandingVal}>{ils(summary?.total ?? 0)}</Text>
                <Text style={styles.outstandingLabel}>סה״כ לחודש</Text>
              </View>
            </Card>

            <Card>
              {!isPublished ? (
                <Text style={styles.muted}>הדוח החודשי טרם פורסם.</Text>
              ) : (
                <>
                  <Pill
                    label={workerReportStatusLabel(status)}
                    color={status === 'WORKER_APPROVED' ? colors.primary : '#b45309'}
                    bg={status === 'WORKER_APPROVED' ? colors.primaryLight : '#fef3c7'}
                  />
                  {status !== 'WORKER_APPROVED' && status !== 'CORRECTION_REQUESTED' && (
                    <>
                      <Text style={styles.approveHint}>בדקי את הדוח ואשרי אותו, או בקשי תיקון.</Text>
                      <Button title="אישור הדוח" icon="checkmark-done" style={styles.mt10} loading={approve.isPending} onPress={() => approve.mutate({ action: 'APPROVE' })} />
                      {disputeOpen ? (
                        <>
                          <TextInput value={disputeNote} onChangeText={setDisputeNote} placeholder="מה נדרש לתקן?" placeholderTextColor={colors.muted} style={styles.textArea} multiline textAlignVertical="top" />
                          <Button title="שליחת בקשת תיקון" variant="outline" style={styles.mt8} loading={approve.isPending} onPress={() => approve.mutate({ action: 'REQUEST_CHANGES', note: disputeNote.trim() || undefined })} />
                        </>
                      ) : (
                        <Button title="בקשת תיקון" variant="outline" style={styles.mt8} onPress={() => setDisputeOpen(true)} />
                      )}
                    </>
                  )}
                </>
              )}
            </Card>

            <Text style={styles.sectionTitle}>משמרות ({lines.length})</Text>
            {lines.length === 0 ? (
              <Text style={styles.muted}>אין משמרות מאושרות בחודש זה.</Text>
            ) : (
              lines.map((s, i) => (
                <Card key={s.shiftId ?? i} style={styles.lineRow}>
                  <Text style={styles.linePay}>{ils(s.dayTotal ?? 0)}</Text>
                  <View style={styles.lineInfo}>
                    <Text style={styles.lineCustomer}>
                      {s.customerName}
                      {s.jobTypeLabel ? ` · ${s.jobTypeLabel}` : ''}
                      {s.roleLabel ? ` · ${s.roleLabel}` : ''}
                    </Text>
                    <Text style={styles.lineMeta}>
                      {fmtDate(s.date)}
                      {s.clockIn && s.clockOut ? ` · ${s.clockIn}–${s.clockOut}` : ''}
                    </Text>
                    <Text style={styles.lineMeta}>
                      שעות נוכחות {s.approvedHours}
                      {s.paidHours != null ? ` · שעות לתשלום ${s.paidHours}` : ''}
                    </Text>
                  </View>
                </Card>
              ))
            )}
            <View style={{ height: 24 }} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 },
  monthLabel: { fontSize: 16, fontFamily: fonts.bold, color: colors.text, minWidth: 90, textAlign: 'center' },
  muted: { color: colors.muted, textAlign: 'center', marginTop: 20, fontFamily: fonts.regular },
  statsRow: { flexDirection: 'row' },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 18, fontFamily: fonts.bold, color: colors.text },
  statLabel: { fontSize: 12, color: colors.muted, marginTop: 2, fontFamily: fonts.medium },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 12 },
  outstandingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  outstandingLabel: { fontSize: 14, color: colors.muted, fontFamily: fonts.semibold },
  outstandingVal: { fontSize: 22, fontFamily: fonts.bold, color: colors.primary },
  approveHint: { fontSize: 13, color: colors.muted, fontFamily: fonts.regular, textAlign: 'right' },
  mt8: { marginTop: 8 },
  mt10: { marginTop: 10 },
  textArea: { minHeight: 80, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.text, backgroundColor: '#faf8f4', textAlign: 'right', marginTop: 10 },
  sectionTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text, textAlign: 'right', marginTop: 4 },
  lineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lineInfo: { flex: 1, alignItems: 'flex-end' },
  lineCustomer: { fontSize: 15, fontFamily: fonts.semibold, color: colors.text, textAlign: 'right' },
  lineMeta: { fontSize: 12, color: colors.muted, marginTop: 2, textAlign: 'right' },
  linePay: { fontSize: 16, fontFamily: fonts.bold, color: colors.primary },
});
