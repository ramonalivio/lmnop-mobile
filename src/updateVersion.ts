import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';
import release from '../ota-release.json';

export const updateLabel =
  release.number > 0 ? `v${release.number}` : 'Bundled';
const installationKey = 'lmnop.installationId';

export async function reportUpdateVersion(sessionToken: string) {
  if (
    __DEV__ ||
    !NativeModules.AppInfo ||
    !['ios', 'android'].includes(Platform.OS)
  )
    return;
  let installationId = await AsyncStorage.getItem(installationKey);
  if (!installationId) {
    // This identifies an installation for reporting; it is not an auth credential.
    installationId = `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2)}-${Math.random().toString(36).slice(2)}`;
    await AsyncStorage.setItem(installationKey, installationId);
  }
  const version = await NativeModules.AppInfo.getVersion();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    await fetch('https://api.example.invalid/mobile/update-status', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${sessionToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        installationId,
        platform: Platform.OS,
        nativeVersion: version.versionName,
        nativeBuild: String(version.versionCode),
        releaseNumber: release.number,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}
