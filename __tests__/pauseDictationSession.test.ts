jest.mock('../speech/parakeetModel', () => ({
  getParakeetModelPath: async () => '/models/tdt',
}));
jest.mock('../speech/microphonePermission', () => ({
  requestDictationMicrophonePermission: async () => true,
}));
jest.mock('../speech/performanceReports', () => ({
  savePerformanceRecording: jest.fn().mockResolvedValue(undefined),
}));
import { NativeModules, Platform, DeviceEventEmitter } from 'react-native';
import RNFS from 'react-native-fs';
import { PauseDictationSession } from '../speech/pauseDictationSession';
import { encodePcm } from '../speech/pcmCodec';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const native = {
  prepare: jest.fn(),
  prepareVad: jest.fn(),
  vad: jest.fn(),
  transcribe: jest.fn(),
  release: jest.fn(),
  releaseVad: jest.fn(),
};
let captureId = '';
const audio = {
  startSession: jest.fn(),
  stop: jest.fn(),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};
function feed(count: number, speech = true, id = captureId) {
  for (let i = 0; i < count; i++)
    DeviceEventEmitter.emit('DictationFrame', {
      id,
      samples: Array(512).fill(speech ? 0.2 : 0),
      capturedAt: Date.now(),
    });
}
const callbacks = () => ({
  onTranscript: jest.fn(),
  onStatus: jest.fn(),
  onError: jest.fn(),
  onActivity: jest.fn(),
});
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', {
    value: 'android',
    configurable: true,
  });
  Object.defineProperty(Platform, 'Version', { value: 36, configurable: true });
  NativeModules.ParakeetSpeech = native;
  NativeModules.DictationAudio = audio;
  native.prepare.mockResolvedValue({ backend: 'CPU' });
  native.prepareVad.mockResolvedValue(undefined);
  native.releaseVad.mockResolvedValue(undefined);
  native.release.mockResolvedValue(undefined);
  native.vad.mockImplementation(async (_id, samples) =>
    samples[0] > 0 ? 0.9 : 0.01,
  );
  native.transcribe.mockResolvedValue({ text: 'New phrase.', nativeMs: 50 });
  audio.startSession.mockImplementation(async id => {
    captureId = id;
  });
  audio.stop.mockImplementation(async () => {
    DeviceEventEmitter.emit('DictationEnd', captureId);
  });
  RNFS.appendFile = jest.fn().mockResolvedValue(undefined);
  jest
    .mocked(RNFS.readFile)
    .mockResolvedValue(encodePcm(new Float32Array(512).fill(0.2)));
});
test('TDT stays loaded over multiple recordings, VAD resets, and silence adds no text', async () => {
  const session = new PauseDictationSession('Before.');
  const cb = callbacks();
  await session.prepare();
  await session.start(cb);
  feed(3);
  await session.stop();
  expect(cb.onTranscript).toHaveBeenLastCalledWith({
    confirmed: 'Before. New phrase.',
    provisional: '',
  });
  await session.start(cb);
  feed(20, false);
  await session.stop();
  expect(native.prepare).toHaveBeenCalledTimes(1);
  expect(native.prepareVad).toHaveBeenCalledTimes(2);
  expect(native.transcribe).toHaveBeenCalledTimes(1);
  expect(native.release).not.toHaveBeenCalled();
  await session.dispose();
  expect(native.release).toHaveBeenCalledTimes(1);
});
test('Stop includes the final native frame before the end marker', async () => {
  const session = new PauseDictationSession();
  await session.start(callbacks());
  audio.stop.mockImplementation(async () => {
    feed(1);
    DeviceEventEmitter.emit('DictationEnd', captureId);
  });
  const result = await session.stop();
  expect(native.vad).toHaveBeenCalledTimes(1);
  expect(result.confirmed).toBe('New phrase.');
  await session.dispose();
});
test('capture stays open while Parakeet works and Stop waits for it', async () => {
  let resolve!: (value: unknown) => void;
  native.transcribe.mockImplementation(
    () =>
      new Promise(r => {
        resolve = r;
      }),
  );
  const session = new PauseDictationSession();
  await session.start(callbacks());
  feed(2);
  feed(13, false);
  await tick();
  expect(native.transcribe).toHaveBeenCalledTimes(1);
  expect(audio.stop).not.toHaveBeenCalled();
  feed(5, false);
  await tick();
  expect(native.vad).toHaveBeenCalledTimes(20);
  let done = false;
  const stopped = session.stop().then(() => {
    done = true;
  });
  await tick();
  expect(done).toBe(false);
  resolve({ text: 'Complete.', nativeMs: 99 });
  await stopped;
  await session.dispose();
});
test('disposing an old session blocks late native text and tagged old microphone events', async () => {
  let resolve!: (value: unknown) => void;
  native.transcribe.mockImplementationOnce(
    () =>
      new Promise(r => {
        resolve = r;
      }),
  );
  const old = new PauseDictationSession('Old.');
  const cb = callbacks();
  await old.start(cb);
  const oldId = captureId;
  feed(2);
  feed(13, false);
  await tick();
  const disposed = old.dispose();
  resolve({ text: 'STALE', nativeMs: 99 });
  await disposed;
  expect(cb.onTranscript).not.toHaveBeenCalled();
  const current = new PauseDictationSession('Edited.');
  await current.start(callbacks());
  const before = native.vad.mock.calls.length;
  feed(10, true, oldId);
  await tick();
  expect(native.vad.mock.calls.length).toBe(before);
  expect((await current.stop()).confirmed).toBe('Edited.');
  await current.dispose();
});
test('cancelling during model preparation never opens the microphone', async () => {
  let resolve!: (value: unknown) => void;
  native.prepare.mockImplementationOnce(
    () =>
      new Promise(r => {
        resolve = r;
      }),
  );
  const session = new PauseDictationSession();
  const started = session.start(callbacks());
  await tick();
  const cancelled = session.cancel();
  resolve({ backend: 'CPU' });
  await started;
  await cancelled;
  expect(audio.startSession).not.toHaveBeenCalled();
  await session.dispose();
});

test('native Stop error still drains final PCM and retains recovery audio', async () => {
  const session = new PauseDictationSession();
  const cb = callbacks();
  await session.start(cb);
  feed(2);
  audio.stop.mockImplementation(async () => {
    feed(1);
    DeviceEventEmitter.emit('DictationEnd', captureId);
    throw new Error('AudioRecord stop failed');
  });
  await session.stop();
  expect(native.vad).toHaveBeenCalledTimes(3);
  expect(cb.onStatus).toHaveBeenLastCalledWith('error');
  expect(cb.onError).toHaveBeenCalledWith('AudioRecord stop failed');
  jest.mocked(RNFS.unlink).mockClear();
  jest.mocked(RNFS.exists).mockResolvedValueOnce(true);
  await session.dispose();
  expect(RNFS.unlink).not.toHaveBeenCalled();
});

test('inference failure stops capture and disposal preserves recovery audio', async () => {
  native.transcribe.mockRejectedValueOnce(new Error('Inference failed'));
  const session = new PauseDictationSession();
  const cb = callbacks();
  await session.start(cb);
  feed(3);
  feed(13, false);
  await tick();
  await tick();
  expect(audio.stop).toHaveBeenCalledTimes(1);
  expect(cb.onError).toHaveBeenCalledWith(
    expect.stringContaining('Recovery audio:'),
  );
  jest.mocked(RNFS.unlink).mockClear();
  await session.dispose();
  expect(RNFS.unlink).not.toHaveBeenCalled();
});
