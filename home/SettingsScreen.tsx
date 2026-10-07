import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';

export function SettingsScreen({ email, onBack, onOpenProfile, onOpenDiagnostics }: {
  email: string | null;
  onBack: () => void;
  onOpenProfile: () => void;
  onOpenDiagnostics: () => void;
}) {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <StatusBar barStyle="light-content" />
      <Pressable accessibilityRole="button" onPress={onBack} style={styles.back}><Text style={styles.backText}>‹  Home</Text></Pressable>
      <Text style={styles.eyebrow}>YOUR SPACE</Text>
      <Text style={styles.heading}>Settings</Text>
      <Text style={styles.subtitle}>Your account and prescribing details.</Text>
      <Text style={styles.section}>Account</Text>
      <View style={styles.card}><Text style={styles.label}>CONNECTED GOOGLE ACCOUNT</Text><Text style={styles.value}>{email || 'Not connected'}</Text></View>
      <Text style={styles.section}>Prescribing</Text>
      <Pressable accessibilityRole="button" onPress={onOpenProfile} style={styles.card}><View style={styles.row}><View style={styles.iconBox}><Text style={styles.icon}>✎</Text></View><View style={styles.body}><Text style={styles.title}>Prescriber profile</Text><Text style={styles.description}>Professional details and signature</Text></View><Text style={styles.chevron}>›</Text></View></Pressable>
      <Text style={styles.section}>App</Text>
      <Pressable accessibilityRole="button" onPress={onOpenDiagnostics} style={styles.card}><View style={styles.row}><View style={styles.iconBox}><Text style={styles.icon}>◉</Text></View><View style={styles.body}><Text style={styles.title}>Diagnostics</Text><Text style={styles.description}>Device and model status</Text></View><Text style={styles.chevron}>›</Text></View></Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#101c1a' }, content: { paddingHorizontal: 20, paddingTop: 17, paddingBottom: 35 },
  back: { justifyContent: 'center', minHeight: 36, alignSelf: 'flex-start' }, backText: { color: '#67cbb0', fontSize: 14, fontWeight: '700' },
  eyebrow: { color: '#67cbb0', fontSize: 11, fontWeight: '800', letterSpacing: 2, marginTop: 22 },
  heading: { color: '#eef8f3', fontSize: 31, fontWeight: '800', letterSpacing: -1, marginTop: 9 }, subtitle: { color: '#a7bbb4', fontSize: 15, marginTop: 8, lineHeight: 22 },
  section: { color: '#eef8f3', fontSize: 14, fontWeight: '800', marginTop: 25, marginBottom: 10 },
  card: { backgroundColor: '#1b2b28', borderColor: '#30433d', borderRadius: 18, borderWidth: 1, minHeight: 76, padding: 16, justifyContent: 'center' },
  label: { color: '#a7bbb4', fontSize: 11, fontWeight: '800', letterSpacing: 1 }, value: { color: '#eef8f3', fontSize: 15, fontWeight: '700', marginTop: 7 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 12 }, iconBox: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#27483c', borderRadius: 13, width: 43, height: 43 }, icon: { color: '#67cbb0', fontSize: 22 }, body: { flex: 1 }, title: { color: '#eef8f3', fontSize: 15, fontWeight: '800' }, description: { color: '#a7bbb4', fontSize: 12, marginTop: 4 }, chevron: { color: '#a7bbb4', fontSize: 24 },
});
