import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { colors, fonts } from '../../lib/theme';
import { SkeletonList } from '../../components/ui';

export default function NotificationsScreen() {
  const qc = useQueryClient();
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications/mine').then((r) => r.data),
  });

  const readAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>התראות</Text>
        {(data?.some((n: any) => !n.isRead)) && (
          <TouchableOpacity onPress={() => readAll.mutate()}>
            <Text style={styles.readAll}>סמן הכל כנקרא</Text>
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <SkeletonList />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item: any) => item.id}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor={colors.primary} />}
          ListEmptyComponent={<Text style={styles.muted}>אין התראות</Text>}
          renderItem={({ item }: any) => (
            <View style={[styles.notif, !item.isRead && styles.notifUnread]}>
              <Text style={styles.notifTitle}>{item.title}</Text>
              <Text style={styles.notifBody}>{item.body}</Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 40 },
  header: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { fontSize: 20, fontFamily: fonts.bold, color: colors.text, textAlign: 'right' },
  readAll: { fontSize: 13, color: colors.primary, fontFamily: fonts.semibold },
  muted: { color: colors.muted, textAlign: 'center', marginTop: 40, fontFamily: fonts.regular },
  notif: { backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  notifUnread: { borderRightWidth: 3, borderRightColor: colors.primary },
  notifTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.text, textAlign: 'right' },
  notifBody: { fontSize: 13, color: colors.muted, marginTop: 4, textAlign: 'right' },
});
