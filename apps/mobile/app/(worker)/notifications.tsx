import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

export default function NotificationsScreen() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications/mine').then((r) => r.data),
  });

  const readAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>התראות</Text>
        {(data?.some((n: any) => !n.isRead)) && (
          <TouchableOpacity onPress={() => readAll.mutate()}>
            <Text style={styles.readAll}>סמן הכל כנקרא</Text>
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <Text style={styles.muted}>טוען...</Text>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item: any) => item.id}
          ListEmptyComponent={<Text style={styles.muted}>אין התראות</Text>}
          renderItem={({ item }: any) => (
            <View style={[styles.notif, !item.isRead && styles.notifUnread]}>
              <Text style={styles.notifTitle}>{item.title}</Text>
              <Text style={styles.notifBody}>{item.body}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f1e8', padding: 16 },
  header: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#2f251a' },
  readAll: { fontSize: 13, color: '#0f7a67', fontWeight: '600' },
  muted: { color: '#6d6254', textAlign: 'center', marginTop: 40 },
  notif: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10 },
  notifUnread: { borderRightWidth: 3, borderRightColor: '#0f7a67' },
  notifTitle: { fontSize: 15, fontWeight: '600', color: '#2f251a' },
  notifBody: { fontSize: 13, color: '#6d6254', marginTop: 4 },
});
