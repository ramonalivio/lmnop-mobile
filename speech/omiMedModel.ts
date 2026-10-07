import RNFS from 'react-native-fs';
import { NativeModules, Platform } from 'react-native';
import manifest from './omiMedManifest.json';

export const omiMedModelBytes = manifest.files.reduce(
  (sum, file) => sum + file.bytes,
  0,
);
const directory = `${RNFS.DocumentDirectoryPath}/OfflineSpeech/omi-med-stt-v1-q8_0`;
export type OmiMedModelState = {
  phase:
    | 'checking'
    | 'missing'
    | 'starting'
    | 'downloading'
    | 'verifying'
    | 'ready'
    | 'error';
  progress: number;
  downloadedBytes?: number;
  error?: string;
};
let state: OmiMedModelState = { phase: 'checking', progress: 0 };
const listeners = new Set<(value: OmiMedModelState) => void>();
let loading: Promise<boolean> | null = null;
let downloading: Promise<void> | null = null;
const publish = (next: OmiMedModelState) => {
  state = next;
  listeners.forEach(listener => listener(state));
};
export function observeOmiMedModel(
  listener: (value: OmiMedModelState) => void,
) {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}
async function verified(file: (typeof manifest.files)[number]) {
  const path = `${directory}/${file.name}`;
  try {
    return (
      (await RNFS.exists(`${path}.verified`)) &&
      (await RNFS.exists(path)) &&
      Number((await RNFS.stat(path)).size) === file.bytes &&
      (await RNFS.readFile(`${path}.verified`, 'utf8')) === file.sha256
    );
  } catch {
    return false;
  }
}
export async function isOmiMedModelReady() {
  loading ??= (async () => {
    const flags = await Promise.all(manifest.files.map(verified));
    const ready = flags.every(Boolean);
    const bytes = manifest.files.reduce(
      (sum, file, i) => sum + (flags[i] ? file.bytes : 0),
      0,
    );
    if (!downloading)
      publish({
        phase: ready ? 'ready' : 'missing',
        progress: bytes / omiMedModelBytes,
        downloadedBytes: bytes,
      });
    return ready;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}
export async function getOmiMedModelPath() {
  if (!(await isOmiMedModelReady()))
    throw new Error(
      'Download Omi Med STT v1 Q8 GGUF before selecting on-device refinement.',
    );
  return `${directory}/${manifest.files[0].name}`;
}
export function downloadOmiMedModel() {
  if (downloading) return downloading;
  publish({ phase: 'starting', progress: 0, downloadedBytes: 0 });
  downloading = (async () => {
    let partial: string | null = null;
    let completed = 0;
    try {
      if (await isOmiMedModelReady()) {
        publish({ phase: 'ready', progress: 1, downloadedBytes: omiMedModelBytes });
        return;
      }
      await RNFS.mkdir(directory, { NSURLIsExcludedFromBackupKey: true });
      const { freeSpace } = await RNFS.getFSInfo();
      const present = await Promise.all(manifest.files.map(verified));
      const required =
        manifest.files.reduce(
          (sum, file, i) => sum + (present[i] ? 0 : file.bytes),
          0,
        ) +
        50 * 1024 * 1024;
      if (freeSpace < required)
        throw new Error(
          `Free at least ${Math.ceil(
            required / 1000000,
          )} MB of storage, then retry.`,
        );
      for (const file of manifest.files) {
        if (await verified(file)) {
          completed += file.bytes;
          continue;
        }
        const path = `${directory}/${file.name}`;
        partial = `${path}.part`;
        if (await RNFS.exists(partial)) await RNFS.unlink(partial);
        publish({
          phase: 'downloading',
          progress: completed / omiMedModelBytes,
          downloadedBytes: completed,
        });
        const download = RNFS.downloadFile({
          fromUrl: file.url,
          toFile: partial,
          cacheable: false,
          backgroundTimeout: 3600000,
          readTimeout: 60000,
          connectionTimeout: 30000,
          progressInterval: 250,
          // RNFS iOS initializes its HTTP status only when begin is present;
          // without it the native progress callback never fires.
          begin: () => undefined,
          progress: event =>
            publish({
              phase: 'downloading',
              progress: Math.min(
                1,
                (completed + event.bytesWritten) / omiMedModelBytes,
              ),
              downloadedBytes: completed + event.bytesWritten,
            }),
        });
        const result = await download.promise;
        if (
          result.statusCode !== 200 ||
          Number((await RNFS.stat(partial)).size) !== file.bytes
        )
          throw new Error(
            'Omi model download was incomplete. Tap Retry to download again.',
          );
        publish({
          phase: 'verifying',
          progress: (completed + file.bytes) / omiMedModelBytes,
          downloadedBytes: completed + file.bytes,
        });
        const hash =
          Platform.OS === 'ios'
            ? await NativeModules.AppInfo.hashFile(partial)
            : await RNFS.hash(partial, 'sha256');
        if (hash !== file.sha256)
          throw new Error(
            'Omi model verification failed. Tap Retry to download again.',
          );
        if (await RNFS.exists(`${path}.verified`))
          await RNFS.unlink(`${path}.verified`);
        if (await RNFS.exists(path)) await RNFS.unlink(path);
        await RNFS.moveFile(partial, path);
        partial = null;
        await RNFS.writeFile(`${path}.verified`, file.sha256, 'utf8');
        completed += file.bytes;
      }
      publish({
        phase: 'ready',
        progress: 1,
        downloadedBytes: omiMedModelBytes,
      });
    } catch (error) {
      if (partial && (await RNFS.exists(partial).catch(() => false)))
        await RNFS.unlink(partial).catch(() => undefined);
      publish({
        phase: 'error',
        progress: completed / omiMedModelBytes,
        downloadedBytes: completed,
        error:
          error instanceof Error ? error.message : 'Omi model download failed.',
      });
      throw error;
    }
  })().finally(() => {
    downloading = null;
  });
  return downloading;
}
