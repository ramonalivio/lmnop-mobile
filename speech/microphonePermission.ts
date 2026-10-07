import {
  Alert,
  Linking,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';

export async function requestDictationMicrophonePermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    return (
      (await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      )) === PermissionsAndroid.RESULTS.GRANTED
    );
  }
  const permission = NativeModules.IosMicrophonePermission;
  if (!permission)
    throw new Error(
      'Microphone permission module is missing. Rebuild the app.',
    );
  const granted = await permission.request();
  if (!granted) {
    Alert.alert(
      'Microphone access required',
      'Enable Microphone for LMNOP in Settings, then return and tap Record again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Open Settings',
          onPress: () => {
            Linking.openSettings().catch(() => {
              Alert.alert(
                'Open Settings manually',
                'Enable LMNOP under Settings → Privacy & Security → Microphone.',
              );
            });
          },
        },
      ],
    );
  }
  return !!granted;
}
