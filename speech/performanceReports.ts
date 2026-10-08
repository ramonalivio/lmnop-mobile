import { NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { SpeechAudio, speechPcm16 } from './speechAudio';

const directory = () => `${RNFS.DocumentDirectoryPath}/SpeechRecordings`;
const endpoint = 'https://api.example.invalid/mobile/performance-reports';
const listeners = new Set<() => void>();
let submitting = false;
let writes = Promise.resolve();
export const subscribePerformanceReports = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const changed = () => listeners.forEach(listener => listener());
export async function pendingPerformanceReports() {
  if (!(await RNFS.exists(directory()))) return [];
  return (await RNFS.readDir(directory()))
    .filter(file => file.name.endsWith('.json'))
    .map(file => file.path)
    .sort();
}
/** Called on app launch/foreground, or with all=true by Clear. */
export function clearPerformanceRecordings(all = false, now = Date.now()) {
  const cleanup = async () => {
    if (submitting) return; // An active upload owns its files until it completes or fails.
    if (!(await RNFS.exists(directory()))) return;
    const files = await RNFS.readDir(directory());
    const expired = [
      ...new Set(
        files
          .filter(file => {
            if (!/\.(json|wav)$/.test(file.name)) return false;
            const created = Number(file.name.split('-')[0]);
            return (
              all ||
              !Number.isFinite(created) ||
              now - created >= 60 * 60 * 1000
            );
          })
          .map(file => file.path.replace(/\.(json|wav)$/, '')),
      ),
    ];
    try {
      const receipt = `${directory()}/submission.receipt`;
      // Invalidate a partial upload before deleting any of the files it names.
      if ((all || expired.length) && (await RNFS.exists(receipt)))
        await RNFS.unlink(receipt);
      for (const base of expired) {
        if (await RNFS.exists(`${base}.wav`)) await RNFS.unlink(`${base}.wav`);
        if (await RNFS.exists(`${base}.json`))
          await RNFS.unlink(`${base}.json`);
      }
    } finally {
      changed();
    }
  };
  const result = writes.then(cleanup);
  writes = result.catch(() => undefined);
  return result;
}
function base64(bytes: Uint8Array) {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const result: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const n =
      (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    result.push(
      alphabet[n >>> 18],
      alphabet[(n >>> 12) & 63],
      i + 1 < bytes.length ? alphabet[(n >>> 6) & 63] : '=',
      i + 2 < bytes.length ? alphabet[n & 63] : '=',
    );
  }
  return result.join('');
}
export function wavBytes(audio: SpeechAudio) {
  const pcm = speechPcm16(audio.slice(0, audio.count), audio.rate);
  const bytes = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(bytes.buffer);
  const string = (offset: number, value: string) =>
    [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  string(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  string(8, 'WAVE');
  string(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  string(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  bytes.set(new Uint8Array(pcm), 44);
  return bytes;
}
export function savePerformanceRecording(
  audio: SpeechAudio,
  details: Record<string, unknown>,
) {
  const save = async () => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await RNFS.mkdir(directory(), { NSURLIsExcludedFromBackupKey: true });
    const bytes = wavBytes(audio);
    const path = `${directory()}/${id}`;
    // The JSON is the queue commit marker: a partial WAV is never submitted.
    await RNFS.writeFile(`${path}.wav`, base64(bytes), 'base64');
    const version = await NativeModules.AppInfo?.getVersion?.().catch(
      () => null,
    );
    await RNFS.writeFile(
      `${path}.json`,
      JSON.stringify({
        id,
        createdAt: new Date().toISOString(),
        ...details,
        device: {
          platform: Platform.OS,
          osVersion: Platform.Version,
          constants: Platform.constants,
          version,
        },
        audioBytes: bytes.length,
        audioSeconds: (bytes.length - 44) / 32000,
      }),
      'utf8',
    );
    changed();
  };
  const result = writes.then(save);
  writes = result.catch(() => undefined);
  return result;
}
async function api(url: string, token: string, body: unknown) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(
        `Report submission failed (${response.status}). Your recordings are kept for retry.`,
      );
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Keep local audio until the server has verified all objects and committed the report. */
export async function submitPerformanceReport(
  token: string | null,
  progress: (message: string, fraction: number) => void,
) {
  if (submitting) return;
  if (!token) throw new Error('Sign in to submit a performance report.');
  submitting = true;
  try {
    await writes;
    const receiptPath = `${directory()}/submission.receipt`;
    const saved = (await RNFS.exists(receiptPath))
      ? JSON.parse(await RNFS.readFile(receiptPath, 'utf8'))
      : null;
    const paths: string[] = saved?.paths ?? (await pendingPerformanceReports());
    if (!paths.length)
      throw new Error('Record something before sharing a report.');
    const recordings =
      saved?.recordings ??
      (await Promise.all(
        paths.map(async path => JSON.parse(await RNFS.readFile(path, 'utf8'))),
      ));
    progress('Preparing report…', 0);
    const report =
      saved?.report ?? (await api(endpoint, token, { recordings }));
    const receipt = saved ?? { paths, recordings, report, complete: false };
    await RNFS.writeFile(receiptPath, JSON.stringify(receipt), 'utf8');
    const state =
      saved && !receipt.complete
        ? await api(`${endpoint}/${report.id}/state`, token, {})
        : null;
    const uploaded: number[] = state?.uploaded ?? [];
    if (state?.status === 'complete') {
      receipt.complete = true;
      await RNFS.writeFile(receiptPath, JSON.stringify(receipt), 'utf8');
    }
    if (!receipt.complete) {
      const total = recordings.reduce(
        (sum: number, recording: { audioBytes: number }) =>
          sum + recording.audioBytes,
        0,
      );
      let sent = 0;
      for (let i = 0; i < paths.length; i++) {
        if (uploaded.includes(i)) {
          sent += recordings[i].audioBytes;
          continue;
        }
        const upload = RNFS.uploadFiles({
          toUrl: `${endpoint}/${report.id}/audio/${i}`,
          method: 'PUT',
          binaryStreamOnly: true,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'audio/wav',
          },
          files: [
            {
              name: 'audio',
              filename: `${i}.wav`,
              filepath: paths[i].replace(/\.json$/, '.wav'),
              filetype: 'audio/wav',
            },
          ],
          progress: event =>
            progress(
              `Uploading recording ${i + 1} of ${paths.length}…`,
              Math.min(0.99, (sent + event.totalBytesSent) / total),
            ),
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
          upload.promise,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              RNFS.stopUpload(upload.jobId);
              reject(
                new Error(
                  'Upload timed out. Your recordings are kept for retry.',
                ),
              );
            }, 120000);
          }),
        ]).finally(() => clearTimeout(timer));
        if (result.statusCode < 200 || result.statusCode >= 300)
          throw new Error(
            'Audio upload failed. Your recordings are kept for retry.',
          );
        sent += recordings[i].audioBytes;
      }
      progress('Verifying upload and notifying Ramon…', 0.99);
      const complete = await api(
        `${endpoint}/${report.id}/complete`,
        token,
        {},
      );
      if (complete.status !== 'complete')
        throw new Error(
          'Report is not complete. Your recordings are kept for retry.',
        );
      receipt.complete = true;
      await RNFS.writeFile(receiptPath, JSON.stringify(receipt), 'utf8');
    }
    // Remove audio first, then its queue marker. Never touch new recordings.
    for (const path of paths) {
      const audioPath = path.replace(/\.json$/, '.wav');
      if (await RNFS.exists(audioPath)) await RNFS.unlink(audioPath);
      if (await RNFS.exists(path)) await RNFS.unlink(path);
    }
    await RNFS.unlink(receiptPath);
    changed();
    progress('Report shared with Ramon.', 1);
    return report.viewUrl as string;
  } finally {
    submitting = false;
    changed();
  }
}
