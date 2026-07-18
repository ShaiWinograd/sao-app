import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { HE, formatDate, formatTime } from '@workforce/shared';
import { api } from '../../../lib/api';
import { colors, fonts, jobTypeColor } from '../../../lib/theme';
import { Screen, ScreenHeader } from '../../../components/ui';

function typeLabel(t?: string): string {
  return HE.jobType[t as keyof typeof HE.jobType] ?? t ?? '';
}

export default function HistoryScreen() {
  const { data: shifts, isLoading, error } = useQuery<any[]>({
    queryKey: ['my-shifts'],
    queryFn: () => api.get('/shifts/mine').then((r) => r.data),
  });

  const past = (shifts ?? [])
    .filter((s) => s.joinRequestStatus === 'APPROVED' && new Date(s.scheduledEnd ?? s.scheduledStart) < new Date())
    .sort((a, b) => new Date(b.scheduledStart).getTime() - new Date(a.scheduledStart).getTime());

  return (
    <Screen>
      <ScreenHeader title="היסטוריית עבודות" onBack={() => router.back()} />
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <Text style={styles.muted}>לא הצלחנו לטעון את ההיסטוריה.</Text>
      ) : (
        <FlatList
          data={past}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.muted}>אין עדיין עבודות בהיסטוריה.</Text>}
          renderItem={({ item }) => {
            const tColor = jobTypeColor(item.job?.jobType);
            return (
              <TouchableOpacity
                style={[styles.card, { borderRightColor: tColor }]}
                activeOpacity={0.9}
                onPress={() => router.push({ pathname: '/(worker)/shift-detail', params: { id: item.id } })}
              >
                <View style={styles.cardHead}>
                  <Text style={[styles.type, { color: tColor }]}>{typeLabel(item.job?.jobType)}</Text>
                  <Text style={styles.date}>{formatDate(item.scheduledStart)}</Text>
                </View>
                <Text style={styles.customer}>
                  {item.job?.customer?.firstName} {item.job?.customer?.lastName}
                </Text>
                <Text style={styles.time}>
                  {formatTime(item.scheduledStart)}–{formatTime(item.scheduledEnd)}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: colors.muted, textAlign: 'center', marginTop: 40, fontFamily: fonts.regular },
  list: { padding: 16 },
  card: {
    backgroundColor: colors.card, borderRadius: 14, padding: 16, marginBottom: 12, borderRightWidth: 5,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  type: { fontSize: 13, fontFamily: fonts.bold },
  date: { fontSize: 12, color: colors.muted, fontFamily: fonts.semibold },
  customer: { fontSize: 17, fontFamily: fonts.semibold, color: colors.text, marginTop: 4, textAlign: 'right' },
  time: { fontSize: 14, color: colors.text, marginTop: 2, textAlign: 'right' },
});
