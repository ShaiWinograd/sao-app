import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';

export default function ProfileScreen() {
  const { signOut } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>הפרופיל שלי</Text>
      <TouchableOpacity style={styles.signOut} onPress={() => signOut()}>
        <Text style={styles.signOutText}>יציאה מהמערכת</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f1e8', padding: 24 },
  title: { fontSize: 22, fontWeight: '700', color: '#2f251a', marginBottom: 32 },
  signOut: { backgroundColor: '#b34a3e', borderRadius: 12, padding: 14, alignItems: 'center' },
  signOutText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
