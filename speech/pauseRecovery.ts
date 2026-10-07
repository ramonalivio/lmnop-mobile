import RNFS from 'react-native-fs';

export async function clearPauseRecoveryRecordings() {
  const root = `${RNFS.DocumentDirectoryPath}/PauseDictation`;
  if (await RNFS.exists(root)) await RNFS.unlink(root);
}
