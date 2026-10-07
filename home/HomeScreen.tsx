import { Image, Pressable, ScrollView, StatusBar, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

type Destination = 'dictation' | 'intake' | 'prescription' | 'settings';

const icons = {
  brand: require('../assets/home/brand.png'),
  dictation: require('../assets/home/dictation.png'),
  intake: require('../assets/home/intake.png'),
  prescription: require('../assets/home/prescription.png'),
  settings: require('../assets/home/settings.png'),
};

export function HomeScreen({ onSelect }: { onSelect: (destination: Destination) => void }) {
  const { width } = useWindowDimensions();
  const tileWidth = (width - 51) / 2;
  const tile = (destination: Destination, title: string, description: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${description}`}
      key={destination}
      onPress={() => onSelect(destination)}
      style={[styles.tile, destination === 'dictation' && styles.featuredTile, { width: tileWidth }]}
    >
      <Text style={[styles.arrow, destination === 'dictation' && styles.featuredText]}>→</Text>
      <View style={[styles.iconBox, destination === 'dictation' && styles.featuredIconBox, destination === 'prescription' && styles.prescriptionIconBox, destination === 'settings' && styles.settingsIconBox]}>
        <Image source={icons[destination]} style={styles.icon} resizeMode="contain" />
      </View>
      <View style={styles.tileCopy}>
        <Text style={[styles.tileTitle, destination === 'dictation' && styles.featuredText]}>{title}</Text>
        <Text style={[styles.tileDescription, destination === 'dictation' && styles.featuredDescription]}>{description}</Text>
      </View>
    </Pressable>
  );
  const futureTile = (key: string) => (
    <View accessible accessibilityLabel="Space for a future tool" key={key} style={[styles.tile, styles.futureTile, { width: tileWidth }]}>
      <View style={[styles.iconBox, styles.futureIconBox]}><Text style={styles.futurePlus}>＋</Text></View>
      <View style={styles.tileCopy}><Text style={styles.futureTitle}>Future tool</Text><Text style={styles.tileDescription}>Open space</Text></View>
    </View>
  );

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <StatusBar barStyle="light-content" />
      <View style={styles.brandRow}>
        <View style={styles.brandMark}><Image source={icons.brand} style={styles.brandIcon} resizeMode="contain" /></View>
        <Text style={styles.brandName}>LMNOP</Text>
      </View>
      <Text style={styles.eyebrow}>YOUR SPACE</Text>
      <Text style={styles.heading}>What would you like to do?</Text>
      <Text style={styles.subtitle}>Everything you need, in one place.</Text>
      <View style={styles.grid}>
        {tile('dictation', 'Dictation', 'Turn speech into notes')}
        {tile('intake', 'User Intake', 'Your health profile')}
        {tile('prescription', 'Prescription', 'Medication records')}
        {tile('settings', 'Settings', 'Preferences & account')}
        {futureTile('future-one')}
        {futureTile('future-two')}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#101c1a' },
  content: { paddingHorizontal: 20, paddingTop: 17, paddingBottom: 40 },
  brandRow: { alignItems: 'center', flexDirection: 'row', gap: 10, marginBottom: 29 },
  brandMark: { alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 10, backgroundColor: '#215e54' },
  brandIcon: { width: 23, height: 23 },
  brandName: { color: '#eef8f3', fontSize: 17, fontWeight: '800', letterSpacing: 1.2 },
  eyebrow: { color: '#67cbb0', fontSize: 11, fontWeight: '800', letterSpacing: 2.1, marginBottom: 11 },
  heading: { color: '#eef8f3', fontSize: 31, fontWeight: '800', letterSpacing: -1.2, lineHeight: 36, maxWidth: 320 },
  subtitle: { color: '#a7bbb4', fontSize: 15, lineHeight: 22, marginTop: 9, marginBottom: 19 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11 },
  tile: { backgroundColor: '#1b2b28', borderColor: '#30433d', borderRadius: 19, borderWidth: 1, height: 142, padding: 15, overflow: 'hidden' },
  featuredTile: { backgroundColor: '#10584e', borderColor: '#10584e' },
  arrow: { position: 'absolute', right: 14, top: 13, color: '#a7bbb4', fontSize: 20 },
  featuredText: { color: '#ffffff' },
  iconBox: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#27483c', borderRadius: 14, height: 44, width: 44 },
  featuredIconBox: { backgroundColor: '#37796e' },
  prescriptionIconBox: { backgroundColor: '#4b3929' },
  settingsIconBox: { backgroundColor: '#35354a' },
  icon: { height: 25, width: 25 },
  tileCopy: { flex: 1, justifyContent: 'flex-end' },
  tileTitle: { color: '#eef8f3', fontSize: 17, fontWeight: '800', letterSpacing: -0.3, marginBottom: 4 },
  tileDescription: { color: '#a7bbb4', fontSize: 11.5, lineHeight: 15.5 },
  featuredDescription: { color: '#d4e9e0' },
  futureTile: { backgroundColor: '#101c1a', borderColor: '#486159', borderStyle: 'dashed' },
  futureIconBox: { backgroundColor: '#223630' },
  futurePlus: { color: '#a7bbb4', fontSize: 27, lineHeight: 30 },
  futureTitle: { color: '#a7bbb4', fontSize: 16, fontWeight: '700', marginBottom: 4 },
});
