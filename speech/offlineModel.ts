import RNFS from 'react-native-fs';
import manifest from './whisperModelManifest.json';
import { NativeModules, Platform } from 'react-native';

export const whisperModelBytes = 190085487;
const hash = 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb';
const directory = `${
  Platform.OS === 'ios' ? RNFS.LibraryDirectoryPath : RNFS.DocumentDirectoryPath
}/OfflineSpeech`;
const modelPath = `${directory}/ggml-small-q5_1.bin`;
const marker = `${modelPath}.verified`;
const chunksDirectory = `${directory}/${hash}-chunks`;
const previousModelPath = `${directory}/ggml-large-v3-q5_0.bin`;
const previousModelMarker = `${previousModelPath}.verified`;
async function fileHash(path: string): Promise<string> {
  return Platform.OS === 'ios'
    ? NativeModules.AppInfo.hashFile(path)
    : RNFS.hash(path, 'sha256');
}
export function formatModelBytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
async function savedChunks() {
  const saved = new Set<string>();
  for (const chunk of manifest.chunks) {
    const path = `${chunksDirectory}/${chunk.name}`;
    if (
      (await RNFS.exists(path)) &&
      Number((await RNFS.stat(path)).size) === chunk.size &&
      (await fileHash(path)) === chunk.sha256
    )
      saved.add(chunk.name);
  }
  return saved;
}
function savedSize(saved: Set<string>) {
  return manifest.chunks.reduce(
    (sum, chunk) => sum + (saved.has(chunk.name) ? chunk.size : 0),
    0,
  );
}
export type OfflineModelState = {
  phase:
    | 'checking'
    | 'missing'
    | 'downloading'
    | 'verifying'
    | 'ready'
    | 'error';
  progress: number;
  downloadedBytes?: number;
  error?: string;
};
let state: OfflineModelState = { phase: 'checking', progress: 0 };
const listeners = new Set<(value: OfflineModelState) => void>();
let checking: Promise<boolean> | null = null;
let downloading: Promise<void> | null = null;
function publish(next: OfflineModelState) {
  state = next;
  listeners.forEach(listener => listener(state));
}
export function observeOfflineModel(
  listener: (value: OfflineModelState) => void,
) {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}
export async function isOfflineModelReady(): Promise<boolean> {
  checking ??= (async () => {
    try {
      const ready =
        (await RNFS.exists(marker)) &&
        (await RNFS.exists(modelPath)) &&
        Number((await RNFS.stat(modelPath)).size) === whisperModelBytes &&
        (await RNFS.readFile(marker, 'utf8')) === hash;
      if (!downloading) {
        const bytes = ready
          ? whisperModelBytes
          : savedSize(await savedChunks());
        publish({
          phase: ready ? 'ready' : 'missing',
          progress: bytes / whisperModelBytes,
          downloadedBytes: bytes,
        });
      }
      return ready;
    } catch {
      if (!downloading) publish({ phase: 'missing', progress: 0 });
      return false;
    }
  })();
  try {
    return await checking;
  } finally {
    checking = null;
  }
}
export async function getOfflineModelPath() {
  if (!(await isOfflineModelReady()))
    throw new Error(
      'Download the offline model before selecting On this device.',
    );
  return modelPath;
}
async function removeIfPresent(path: string) {
  if (await RNFS.exists(path)) await RNFS.unlink(path);
}
export function downloadOfflineModel(): Promise<void> {
  if (downloading) return downloading;
  downloading = (async () => {
    const partial = `${modelPath}.part`;
    let completed = 0;
    const report = (phase: OfflineModelState['phase'], bytes = completed) =>
      publish({
        phase,
        progress: bytes / whisperModelBytes,
        downloadedBytes: bytes,
      });
    try {
      if (await isOfflineModelReady()) {
        report('ready', whisperModelBytes);
        return;
      }
      await RNFS.mkdir(chunksDirectory, { NSURLIsExcludedFromBackupKey: true });
      await RNFS.mkdir(directory, { NSURLIsExcludedFromBackupKey: true });
      const saved = await savedChunks();
      completed = savedSize(saved);
      report('downloading');
      await removeIfPresent(partial);
      const { freeSpace } = await RNFS.getFSInfo();
      // Chunks remain until the assembled model has passed full verification.
      if (freeSpace < 2 * whisperModelBytes - completed + 50 * 1024 * 1024)
        throw new Error(
          `Free at least ${formatModelBytes(2 * whisperModelBytes + 50 * 1024 * 1024)} of storage for download and installation, then retry.`,
        );
      for (const chunk of manifest.chunks) {
        if (saved.has(chunk.name)) continue;
        const path = `${chunksDirectory}/${chunk.name}`;
        const temp = `${path}.part`;
        await removeIfPresent(temp);
        try {
          const result = await RNFS.downloadFile({
            fromUrl: `${manifest.baseURL}/${chunk.name}`,
            toFile: temp,
            begin: () => undefined,
            cacheable: false,
            backgroundTimeout: 3600000,
            readTimeout: 60000,
            connectionTimeout: 30000,
            progressInterval: 250,
            progressDivider: 1,
            progress: event =>
              report(
                'downloading',
                completed + Math.min(chunk.size, event.bytesWritten),
              ),
          }).promise;
          if (
            result.statusCode !== 200 ||
            Number((await RNFS.stat(temp)).size) !== chunk.size ||
            (await fileHash(temp)) !== chunk.sha256
          )
            throw new Error(
              'Chunk download or verification failed. Tap Retry to resume.',
            );
          await removeIfPresent(path);
          await RNFS.moveFile(temp, path);
          completed += chunk.size;
          report('downloading');
        } catch (error) {
          await removeIfPresent(temp).catch(() => undefined);
          throw error;
        }
      }
      report('verifying');
      await RNFS.writeFile(partial, '', 'base64');
      // Keep native bridge memory bounded instead of reading a 1 GB file into JS.
      for (const chunk of manifest.chunks) {
        for (let offset = 0; offset < chunk.size; offset += 1024 * 1024) {
          const block = await RNFS.read(
            `${chunksDirectory}/${chunk.name}`,
            Math.min(1024 * 1024, chunk.size - offset),
            offset,
            'base64',
          );
          await RNFS.appendFile(partial, block, 'base64');
        }
      }
      if (
        Number((await RNFS.stat(partial)).size) !== whisperModelBytes ||
        (await fileHash(partial)) !== hash
      )
        throw new Error(
          'Model verification failed. Tap Retry to rebuild from saved chunks.',
        );
      await removeIfPresent(marker);
      await removeIfPresent(modelPath);
      await RNFS.moveFile(partial, modelPath);
      await RNFS.writeFile(marker, hash, 'utf8');
      report('ready', whisperModelBytes);
      await removeIfPresent(chunksDirectory).catch(() => undefined);
      await removeIfPresent(previousModelMarker).catch(() => undefined);
      await removeIfPresent(previousModelPath).catch(() => undefined);
    } catch (error) {
      await removeIfPresent(partial).catch(() => undefined);
      publish({
        phase: 'error',
        progress: completed / whisperModelBytes,
        downloadedBytes: completed,
        error:
          error instanceof Error
            ? error.message
            : 'Download failed. Tap Retry to resume.',
      });
    }
  })().finally(() => {
    downloading = null;
  });
  return downloading;
}
