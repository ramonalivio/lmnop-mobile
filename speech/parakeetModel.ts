import RNFS from 'react-native-fs';
import manifest from './parakeetOnnxManifest.json';

export const parakeetModelBytes = manifest.files.reduce(
  (sum, file) => sum + file.bytes,
  0,
);
const directory = `${RNFS.DocumentDirectoryPath}/OfflineSpeech/parakeet-tdt-v3-onnx-int8`;
export type ParakeetModelState = {
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
let state: ParakeetModelState = { phase: 'checking', progress: 0 };
const listeners = new Set<(value: ParakeetModelState) => void>();
let loading: Promise<boolean> | null = null;
let downloading: Promise<void> | null = null;
const publish = (next: ParakeetModelState) => {
  state = next;
  listeners.forEach(listener => listener(state));
};
export function observeParakeetModel(
  listener: (value: ParakeetModelState) => void,
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
export async function isParakeetModelReady() {
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
        progress: bytes / parakeetModelBytes,
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
export async function getParakeetModelPath() {
  if (!(await isParakeetModelReady()))
    throw new Error(
      'Download Parakeet TDT ONNX INT8 before selecting on-device refinement.',
    );
  return directory;
}
export function downloadParakeetModel() {
  if (downloading) return downloading;
  downloading = (async () => {
    let partial: string | null = null;
    let completed = 0;
    try {
      if (await isParakeetModelReady()) return;
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
          progress: completed / parakeetModelBytes,
          downloadedBytes: completed,
        });
        const result = await RNFS.downloadFile({
          fromUrl: file.url,
          toFile: partial,
          cacheable: false,
          backgroundTimeout: 3600000,
          readTimeout: 60000,
          connectionTimeout: 30000,
          progressInterval: 250,
          progress: event =>
            publish({
              phase: 'downloading',
              progress: Math.min(
                1,
                (completed + event.bytesWritten) / parakeetModelBytes,
              ),
              downloadedBytes: completed + event.bytesWritten,
            }),
        }).promise;
        if (
          result.statusCode !== 200 ||
          Number((await RNFS.stat(partial)).size) !== file.bytes
        )
          throw new Error(
            'Parakeet download was incomplete. Tap Retry to download again.',
          );
        publish({
          phase: 'verifying',
          progress: (completed + file.bytes) / parakeetModelBytes,
          downloadedBytes: completed + file.bytes,
        });
        if ((await RNFS.hash(partial, 'sha256')) !== file.sha256)
          throw new Error(
            'Parakeet model verification failed. Tap Retry to download again.',
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
        downloadedBytes: parakeetModelBytes,
      });
    } catch (error) {
      if (partial && (await RNFS.exists(partial)))
        await RNFS.unlink(partial).catch(() => undefined);
      publish({
        phase: 'error',
        progress: completed / parakeetModelBytes,
        downloadedBytes: completed,
        error:
          error instanceof Error ? error.message : 'Parakeet download failed.',
      });
      throw error;
    }
  })().finally(() => {
    downloading = null;
  });
  return downloading;
}
