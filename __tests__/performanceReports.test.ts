import RNFS from 'react-native-fs';
import {
  clearPerformanceRecordings,
  pendingPerformanceReports,
  savePerformanceRecording,
  submitPerformanceReport,
  wavBytes,
} from '../speech/performanceReports';
import { SpeechAudio } from '../speech/speechAudio';
import { recordingMetrics } from '../speech/speechProfiler';

const files = new Map<string, string>();
const folder = '/documents/SpeechRecordings';
const fetchMock = jest.fn();
beforeEach(() => {
  files.clear();
  jest.clearAllMocks();
  (globalThis as any).fetch = fetchMock;
  jest
    .mocked(RNFS.exists)
    .mockImplementation(async path => path === folder || files.has(path));
  jest.mocked(RNFS.writeFile).mockImplementation(async (path, data) => {
    files.set(path, data);
  });
  jest.mocked(RNFS.readFile).mockImplementation(async path => {
    if (!files.has(path)) throw Error('missing');
    return files.get(path)!;
  });
  jest
    .mocked(RNFS.readDir)
    .mockImplementation(async () =>
      Array.from(files.keys()).map(
        path => ({ path, name: path.split('/').pop()! } as any),
      ),
    );
  jest.mocked(RNFS.unlink).mockImplementation(async path => {
    files.delete(path);
  });
  jest.mocked(RNFS.uploadFiles).mockImplementation(options => {
    expect(files.has(options.files[0].filepath)).toBe(true);
    options.progress?.({
      jobId: 1,
      totalBytesSent: 32044,
      totalBytesExpectedToSend: 32044,
    });
    return {
      jobId: 1,
      promise: Promise.resolve({
        jobId: 1,
        statusCode: 200,
        headers: {},
        body: '',
      }),
    };
  });
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () =>
      url.endsWith('/complete')
        ? { status: 'complete' }
        : {
            id: 'report-id',
            viewUrl: 'https://api.example.invalid/performance-reports/report-id',
          },
  }));
});
async function record() {
  const audio = new SpeechAudio();
  audio.append(new Float32Array(16000).fill(0.2), 16000);
  await savePerformanceRecording(audio, {
    model: 'test',
    mode: 'offline',
    result: 'hello',
  });
}
test('writes a playable PCM16 WAV and queues it only after persistence', async () => {
  const audio = new SpeechAudio();
  audio.append(new Float32Array(48000).fill(0.2), 48000);
  const bytes = wavBytes(audio);
  expect(bytes.length).toBe(32044);
  expect(new DataView(bytes.buffer).getUint32(24, true)).toBe(16000);
  expect(new DataView(bytes.buffer).getInt16(44, true)).toBeCloseTo(6553, 0);
  await record();
  expect(await pendingPerformanceReports()).toHaveLength(1);
  expect(fetchMock).not.toHaveBeenCalled();
});
test('failed completion retains files and retries the same report; confirmed completion cleans everything', async () => {
  await record();
  fetchMock.mockImplementationOnce(async () => ({
    ok: true,
    json: async () => ({ id: 'report-id', viewUrl: 'https://test/report' }),
  }));
  fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 503 }));
  await expect(submitPerformanceReport('token', jest.fn())).rejects.toThrow(
    '503',
  );
  expect(await pendingPerformanceReports()).toHaveLength(1);
  expect([...files.keys()].some(path => path.endsWith('.wav'))).toBe(true);
  const progress = jest.fn();
  await submitPerformanceReport('token', progress);
  expect(files.size).toBe(0);
  expect(
    fetchMock.mock.calls.filter(([url]) =>
      url.endsWith('/performance-reports'),
    ),
  ).toHaveLength(1);
  expect(progress).toHaveBeenLastCalledWith('Report shared with Ramon.', 1);
});
test('wake expires recordings at one hour but preserves younger recordings; Clear removes all', async () => {
  const now = 10000000;
  for (const age of [3600000, 3599999])
    for (const ext of ['json', 'wav'])
      files.set(`${folder}/${now - age}-test.${ext}`, '{}');
  files.set(`${folder}/submission.receipt`, '{}');
  await clearPerformanceRecordings(false, now);
  expect([...files.keys()]).toEqual([
    `${folder}/${now - 3599999}-test.json`,
    `${folder}/${now - 3599999}-test.wav`,
  ]);
  await clearPerformanceRecordings(true);
  expect(files.size).toBe(0);
  expect(await pendingPerformanceReports()).toHaveLength(0);
});
test('cleanup cannot delete audio during a live upload', async () => {
  await record();
  let finish!: () => void;
  jest.mocked(RNFS.uploadFiles).mockReturnValue({
    jobId: 1,
    promise: new Promise(resolve => {
      finish = () =>
        resolve({ jobId: 1, statusCode: 200, headers: {}, body: '' });
    }),
  });
  const uploading = submitPerformanceReport('token', jest.fn());
  while (!finish) await new Promise<void>(resolve => setImmediate(resolve));
  await clearPerformanceRecordings(true);
  expect(await pendingPerformanceReports()).toHaveLength(1);
  finish();
  await uploading;
  expect(files.size).toBe(0);
});
test('metric summaries exclude earlier recordings in the same model session', () => {
  const metrics = recordingMetrics({
    events: [
      {
        phase: 'recording',
        metrics: { uptimeSeconds: 10, cpuSeconds: 1, residentMiB: 50 },
      },
      {
        phase: 'recording',
        metrics: { uptimeSeconds: 20, cpuSeconds: 4, residentMiB: 80 },
      },
    ],
    samples: [
      { uptimeSeconds: 11, cpuSeconds: 3, residentMiB: 200 },
      { uptimeSeconds: 22, cpuSeconds: 5, residentMiB: 100 },
    ],
  }) as any;
  expect(metrics.summary.averageCpuPercentOneCore).toBe(50);
  expect(metrics.summary.peakResidentMiB).toBe(100);
  expect(metrics.samples).toHaveLength(1);
});

test('a lost completion response resumes cleanup without reuploading a committed report', async () => {
  await record();
  fetchMock.mockImplementationOnce(async () => ({
    ok: true,
    json: async () => ({ id: 'report-id', viewUrl: 'https://test/report' }),
  }));
  fetchMock.mockRejectedValueOnce(new Error('connection lost after commit'));
  await expect(submitPerformanceReport('token', jest.fn())).rejects.toThrow(
    'connection lost',
  );
  fetchMock.mockImplementationOnce(async () => ({
    ok: true,
    json: async () => ({ status: 'complete', uploaded: [0] }),
  }));
  await submitPerformanceReport('token', jest.fn());
  expect(RNFS.uploadFiles).toHaveBeenCalledTimes(1);
  expect(files.size).toBe(0);
});
