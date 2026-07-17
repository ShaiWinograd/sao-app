import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { HE, formatDate, formatTime } from '@workforce/shared';
import { colors, jobTypeColor, jobTypeBg } from '../../lib/theme';

type MyStatus = 'NONE' | 'APPROVED' | 'AWAITING_WORKER' | 'PENDING';

type BoardShift = {
  jobId: string;
  jobType: string;
  date: string;
  plannedStart: string;
  plannedEnd: string;
  customerName: string;
  address: string | null;
  requiredWorkerCount: number;
  assignedWorkers: { name: string; isTeamLeader: boolean }[];
  openSpots: number;
  myStatus: MyStatus;
  myShiftId: string | null;
};

function typeLabel(type: string): string {
  return HE.jobType[type as keyof typeof HE.jobType] ?? type;
}

export default function BoardScreen() {
  const qc = useQueryClient();
  const { data: board, isLoading } = useQuery<BoardShift[]>({
    queryKey: ['board'],
    queryFn: () => api.get('/jobs/board').then((r) => r.data),
  });

  const joinMutation = useMutation({
    mutationFn: (jobId: string) => api.post('/shifts/join-request', { jobId }),
    onSuccess: () => {
      Alert.alert('נשלח!', 'בקשת ההצטרפות נשלחה לאישור בעל/ת העסק.');
      qc.invalidateQueries({ queryKey: ['board'] });
      qc.invalidateQueries({ queryKey: ['my-shifts'] });
    },
    onError: (err: any) => Alert.alert('שגיאה', err.response?.data?.error ?? 'לא ניתן לשלוח בקשה'),
  });

  function confirmJoin(shift: BoardShift) {
    Alert.alert(
      'בקשה להצטרף',
      `${typeLabel(shift.jobType)} · ${shift.customerName}\n${formatDate(shift.date)} · ${formatTime(shift.plannedStart)}–${formatTime(shift.plannedEnd)}`,
      [
        { text: 'ביטול', style: 'cancel' },
        { text: 'שליחת בקשה', onPress: () => joinMutation.mutate(shift.jobId) },
      ],
    );
  }

  if (isLoading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>משמרות</Text>
      <FlatList
        data={board ?? []}
        keyExtractor={(item) => item.jobId}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={<Text style={styles.muted}>אין משמרות מתוזמנות כרגע</Text>}
        renderItem={({ item }) => <BoardCard shift={item} onJoin={() => confirmJoin(item)} joining={joinMutation.isPending} />}
      />
    </View>
  );
}

function Names({ workers, light }: { workers: BoardShift['assignedWorkers']; light?: boolean }) {
  if (workers.length === 0) {
    return <Text style={[styles.namesEmpty, light && styles.lightMuted]}>טרם שובצו עובדים</Text>;
  }
  return (
    <View style={styles.namesRow}>
      {workers.map((w, i) => (
        <View key={i} style={[styles.chip, light ? styles.chipLight : styles.chipDark]}>
          <Text style={[styles.chipText, light && styles.chipTextLight]}>
            {w.isTeamLeader ? '★ ' : ''}
            {w.name}
          </Text>
        </View>
      ))}
    </View>
  );
}

function BoardCard({ shift, onJoin, joining }: { shift: BoardShift; onJoin: () => void; joining: boolean }) {
  const tColor = jobTypeColor(shift.jobType);

  // 1) Fully assigned (not mine): solid type-color fill.
  if (shift.myStatus === 'NONE' && shift.openSpots === 0) {
    return (
      <View style={[styles.card, { backgroundColor: tColor }]}>
        <View style={styles.headerRow}>
          <Text style={styles.typeLight}>{typeLabel(shift.jobType)}</Text>
          <Text style={styles.dateLight}>{formatDate(shift.date)}</Text>
        </View>
        <Text style={styles.customerLight}>{shift.customerName}</Text>
        <Text style={styles.timeLight}>
          {formatTime(shift.plannedStart)}–{formatTime(shift.plannedEnd)}
        </Text>
        {shift.address ? <Text style={styles.addressLight}>{shift.address}</Text> : null}
        <Names workers={shift.assignedWorkers} light />
      </View>
    );
  }

  // 2) Open spots (not mine): white + type strip + ask to join.
  if (shift.myStatus === 'NONE' && shift.openSpots > 0) {
    return (
      <View style={[styles.card, styles.stripCard, { borderRightColor: tColor }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.type, { color: tColor }]}>{typeLabel(shift.jobType)}</Text>
          <Text style={styles.date}>{formatDate(shift.date)}</Text>
        </View>
        <Text style={styles.customer}>{shift.customerName}</Text>
        <Text style={styles.time}>
          {formatTime(shift.plannedStart)}–{formatTime(shift.plannedEnd)}
        </Text>
        {shift.address ? <Text style={styles.address}>{shift.address}</Text> : null}
        <Text style={styles.openSpots}>{shift.openSpots} מקומות פנויים</Text>
        <Names workers={shift.assignedWorkers} />
        <TouchableOpacity style={styles.btn} onPress={onJoin} disabled={joining}>
          <Text style={styles.btnText}>{HE.worker.requestToJoin}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // 3) My statuses (awaiting / approved / pending) — status only; actions live on "המשמרות שלי".
  const badge =
    shift.myStatus === 'AWAITING_WORKER'
      ? { text: 'שובצת – יש לאשר במסך המשמרות שלי', style: styles.badgeAmber }
      : shift.myStatus === 'APPROVED'
        ? { text: 'את/ה משובץ/ת', style: styles.badgePrimary }
        : { text: 'ממתין לאישור בעל/ת העסק', style: styles.badgeAmber };
  return (
    <View style={[styles.card, styles.myCard, { borderColor: tColor, backgroundColor: jobTypeBg(shift.jobType) }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.type, { color: tColor }]}>{typeLabel(shift.jobType)}</Text>
        <Text style={styles.date}>{formatDate(shift.date)}</Text>
      </View>
      <Text style={styles.customer}>{shift.customerName}</Text>
      <Text style={styles.time}>
        {formatTime(shift.plannedStart)}–{formatTime(shift.plannedEnd)}
      </Text>
      {shift.address ? <Text style={styles.address}>{shift.address}</Text> : null}
      <View style={[styles.badge, badge.style]}>
        <Text style={styles.badgeText}>{badge.text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  center: { justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 16 },
  muted: { color: colors.muted, textAlign: 'center', marginTop: 40 },
  card: { borderRadius: 14, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2, backgroundColor: colors.card },
  stripCard: { borderRightWidth: 5 },
  myCard: { borderWidth: 2 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  type: { fontSize: 13, fontWeight: '700' },
  typeLight: { fontSize: 13, fontWeight: '700', color: colors.white },
  date: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  dateLight: { fontSize: 12, color: 'rgba(255,255,255,0.9)', fontWeight: '600' },
  customer: { fontSize: 17, fontWeight: '600', color: colors.text, marginTop: 4 },
  customerLight: { fontSize: 17, fontWeight: '700', color: colors.white, marginTop: 4 },
  address: { fontSize: 13, color: colors.muted, marginTop: 2 },
  addressLight: { fontSize: 13, color: 'rgba(255,255,255,0.9)', marginTop: 2 },
  time: { fontSize: 14, color: colors.text, marginTop: 4 },
  timeLight: { fontSize: 14, color: colors.white, marginTop: 4 },
  openSpots: { fontSize: 13, color: colors.primaryDark, fontWeight: '700', marginTop: 6 },
  namesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  namesEmpty: { fontSize: 12, color: colors.muted, marginTop: 8 },
  lightMuted: { color: 'rgba(255,255,255,0.85)' },
  chip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  chipDark: { backgroundColor: '#f1eff4' },
  chipLight: { backgroundColor: 'rgba(255,255,255,0.22)' },
  chipText: { fontSize: 11, color: colors.text },
  chipTextLight: { color: colors.white },
  btn: { marginTop: 12, backgroundColor: colors.primary, borderRadius: 10, padding: 12, alignItems: 'center' },
  btnText: { color: colors.white, fontWeight: '600', fontSize: 15 },
  badge: { marginTop: 10, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '600', color: colors.text },
  badgeAmber: { backgroundColor: '#fef3c7' },
  badgePrimary: { backgroundColor: colors.primaryLight },
});
