jest.mock('../speech/offlineModel', () => ({
  getOfflineModelPath: async () => '/downloaded/ggml-large-v3-q5_0.bin',
}));
jest.mock('react-native-sherpa-onnx/audio', () => ({
  createPcmLiveStream: jest.fn(),
}));
import { NativeModules, Platform } from 'react-native';
import { initWhisper } from 'whisper.rn/index';
import { createPcmLiveStream } from 'react-native-sherpa-onnx/audio';
import { WhisperSpeechToTextSession } from '../speech/whisperSpeechToText';
import { MoonshineSpeechToTextSession } from '../speech/moonshineSpeechToText';
import { createSpeechToTextSession } from '../speech/speechToText';
import {
  WhisperAudio,
  hasSpeechEnergy,
  whisperPcm16,
} from '../speech/whisperAudio';

let data: (samples: Float32Array, rate: number) => void;
let captureError: (message: string) => void;
const remove = jest.fn();
const pcm = {
  onData: jest.fn(callback => {
    data = callback;
    return remove;
  }),
  onError: jest.fn(callback => {
    captureError = callback;
    return remove;
  }),
  start: jest.fn(),
  stop: jest.fn(),
};
const context = { transcribeData: jest.fn(), release: jest.fn() };
const callbacks = {
  onStatus: jest.fn(),
  onTranscript: jest.fn(),
  onError: jest.fn(),
};
const result = (text: string) => ({
  result: text,
  isAborted: false,
  segments: [],
  language: 'en',
});
const speech = (seconds: number, rate = 16000) =>
  new Float32Array(Math.round(seconds * rate)).fill(0.2);
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.resetAllMocks();
  NativeModules.IosMicrophonePermission = {
    request: jest.fn().mockResolvedValue(true),
  };
  jest.mocked(initWhisper).mockResolvedValue(context as any);
  jest.mocked(createPcmLiveStream).mockReturnValue(pcm as any);
  pcm.onData.mockImplementation(callback => {
    data = callback;
    return remove;
  });
  pcm.onError.mockImplementation(callback => {
    captureError = callback;
    return remove;
  });
  context.transcribeData.mockImplementation(() => ({
    stop: jest.fn(),
    promise: Promise.resolve(result('Recognized.')),
  }));
});

test('iOS selects Moonshine hybrid; experimental Whisper prepares without capture', async () => {
  const original = Platform.OS;
  Platform.OS = 'ios';
  try {
    expect(createSpeechToTextSession()).toBeInstanceOf(
      MoonshineSpeechToTextSession,
    );
  } finally {
    Platform.OS = original;
  }
  const session = new WhisperSpeechToTextSession();
  await session.prepare();
  await session.prepare();
  expect(initWhisper).toHaveBeenCalledTimes(1);
  expect(initWhisper).toHaveBeenCalledWith(
    expect.objectContaining({
      isBundleAsset: false,
      filePath: expect.stringContaining('large-v3-q5_0'),
    }),
  );
  expect(pcm.start).not.toHaveBeenCalled();
  await session.dispose();
});

test('live snapshots replace one another, final decode corrects them and preserves typed text', async () => {
  const session = new WhisperSpeechToTextSession('Typed 500 milligrams.');
  await session.start(callbacks);
  data(speech(2), 16000);
  await tick();
  expect(callbacks.onTranscript).toHaveBeenLastCalledWith({
    confirmed: 'Typed 500 milligrams.',
    provisional: 'Recognized.',
  });
  context.transcribeData.mockImplementation(() => ({
    promise: Promise.resolve(result('Take 5 milligrams amlodipine.')),
    stop: jest.fn(),
  }));
  data(speech(1), 16000);
  expect(await session.stop()).toEqual({
    confirmed: 'Typed 500 milligrams. Take 5mg amlodipine.',
    provisional: '',
  });
  expect(context.transcribeData.mock.calls[1][0].byteLength).toBe(
    3 * 16000 * 2,
  );
  expect(context.transcribeData.mock.calls[1][1].prompt).toContain(
    'amlodipine',
  );
  await session.dispose();
});

test('coalesces incoming audio during a slow decode and Stop drains the last chunk', async () => {
  const pending = deferred<ReturnType<typeof result>>();
  context.transcribeData.mockReturnValueOnce({
    promise: pending.promise,
    stop: jest.fn(),
  });
  const session = new WhisperSpeechToTextSession();
  await session.start(callbacks);
  data(speech(2), 16000);
  await tick();
  data(speech(2), 16000);
  data(speech(2), 16000);
  expect(context.transcribeData).toHaveBeenCalledTimes(1);
  pcm.stop.mockImplementationOnce(async () => data(speech(0.2), 16000));
  const stopped = session.stop();
  expect(session.stop()).toBe(stopped);
  pending.resolve(result('Draft'));
  await stopped;
  expect(context.transcribeData).toHaveBeenCalledTimes(2);
  expect(context.transcribeData.mock.calls[1][0].byteLength).toBe(
    6.2 * 16000 * 2,
  );
  await session.dispose();
});

test('coalesced live decode runs against latest accumulated audio without waiting for Stop', async () => {
  const pending = deferred<ReturnType<typeof result>>();
  context.transcribeData.mockReturnValueOnce({
    promise: pending.promise,
    stop: jest.fn(),
  });
  const session = new WhisperSpeechToTextSession();
  await session.start(callbacks);
  data(speech(2), 16000);
  await tick();
  data(speech(5), 16000);
  pending.resolve(result('First'));
  await tick();
  expect(context.transcribeData).toHaveBeenCalledTimes(2);
  expect(context.transcribeData.mock.calls[1][0].byteLength).toBe(
    7 * 16000 * 2,
  );
  await session.stop();
  await session.dispose();
});

test('short recording decodes on Stop, but silence does not emit prompt text', async () => {
  const session = new WhisperSpeechToTextSession();
  await session.start(callbacks);
  data(speech(0.5), 16000);
  await session.stop();
  expect(context.transcribeData).toHaveBeenCalledTimes(1);
  await session.start(callbacks);
  data(new Float32Array(48000), 16000);
  expect((await session.stop()).confirmed).toBe('Recognized.');
  expect(context.transcribeData).toHaveBeenCalledTimes(1);
  session.clear();
  expect((await session.dispose()).confirmed).toBe('');
});

test('Stop during startup waits for capture then stops it', async () => {
  const pending = deferred<void>();
  pcm.start.mockReturnValueOnce(pending.promise);
  const session = new WhisperSpeechToTextSession();
  const started = session.start(callbacks);
  await tick();
  const stopped = session.stop();
  expect(pcm.stop).not.toHaveBeenCalled();
  pending.resolve();
  await started;
  data(speech(0.1), 16000);
  await stopped;
  expect(pcm.stop).toHaveBeenCalledTimes(1);
  await session.dispose();
});

test('disposal cancels inference, suppresses late results and releases only after it settles', async () => {
  const pending = deferred<ReturnType<typeof result>>();
  const cancel = jest.fn();
  context.transcribeData.mockReturnValueOnce({
    promise: pending.promise,
    stop: cancel,
  });
  const session = new WhisperSpeechToTextSession('Earlier');
  await session.start(callbacks);
  data(speech(2), 16000);
  await tick();
  const disposal = session.dispose();
  await tick();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(context.release).not.toHaveBeenCalled();
  pending.resolve(result('Late text'));
  expect((await disposal).confirmed).toBe('Earlier');
  expect(callbacks.onTranscript).not.toHaveBeenCalled();
  expect(context.release).toHaveBeenCalledTimes(1);
  await session.dispose();
  expect(context.release).toHaveBeenCalledTimes(1);
});

test('disposal during model preparation never starts capture', async () => {
  const pending = deferred<any>();
  jest.mocked(initWhisper).mockReturnValueOnce(pending.promise);
  const session = new WhisperSpeechToTextSession();
  const preparation = session.prepare();
  const disposal = session.dispose();
  pending.resolve(context);
  await preparation;
  await disposal;
  expect(pcm.start).not.toHaveBeenCalled();
  expect(context.release).toHaveBeenCalledTimes(1);
});

test('capture failure stops microphone and retains the latest text', async () => {
  const session = new WhisperSpeechToTextSession();
  await session.start(callbacks);
  data(speech(2), 16000);
  await tick();
  captureError('Microphone failed');
  await tick();
  expect(pcm.stop).toHaveBeenCalledTimes(1);
  expect(callbacks.onError).toHaveBeenCalledWith('Microphone failed');
  expect((await session.dispose()).confirmed).toBe('Recognized.');
});

test('continuous long audio is partitioned without omissions or duplicated snapshots', async () => {
  const session = new WhisperSpeechToTextSession();
  await session.start(callbacks);
  data(speech(51), 16000);
  await tick();
  expect(
    context.transcribeData.mock.calls.map(([bytes]) => bytes.byteLength),
  ).toEqual([25, 25, 1].map(s => s * 32000));
  expect((await session.stop()).confirmed).toBe(
    'Recognized. Recognized. Recognized.',
  );
  await session.dispose();
});

test('whole-window resampling is invariant to capture chunk boundaries at 44.1kHz', () => {
  const input = Float32Array.from(
    { length: 44100 },
    (_, i) => Math.sin(i / 30) * 0.25,
  );
  const buffer = new WhisperAudio();
  for (let i = 0; i < input.length; i += 1024)
    buffer.append(input.subarray(i, i + 1024), 44100);
  expect(
    new Int16Array(whisperPcm16(buffer.slice(0, buffer.count), buffer.rate)),
  ).toEqual(new Int16Array(whisperPcm16(input, 44100)));
  expect(whisperPcm16(input, 44100).byteLength).toBe(32000);
  expect(new Int16Array(whisperPcm16(speech(1, 48000), 48000))[0]).toBe(6553);
  expect(hasSpeechEnergy(new Float32Array(16000), 16000)).toBe(false);
});

test('bounded audio validates rates and capacity; window boundaries prefer silence', () => {
  const audio = new WhisperAudio();
  const samples = speech(30);
  samples.fill(0, 19 * 16000, 20 * 16000);
  audio.append(samples, 16000);
  expect(audio.window(0).end / 16000).toBeGreaterThan(19);
  expect(audio.window(0).end / 16000).toBeLessThan(20);
  expect(() => audio.append(speech(1), 48000)).toThrow('sample rate');
  expect(() => audio.append(speech(151), 16000)).toThrow('three-minute');
});

test('failed final decode retains draft through the next recording', async () => {
  const session = new WhisperSpeechToTextSession('Earlier.');
  await session.start(callbacks);
  data(speech(2), 16000);
  await tick();
  context.transcribeData.mockImplementationOnce(() => ({
    stop: jest.fn(),
    promise: Promise.reject(new Error('Final decode failed')),
  }));
  data(speech(0.1), 16000);
  await expect(session.stop()).rejects.toThrow('Final decode failed');
  await session.start(callbacks);
  data(speech(0.5), 16000);
  expect((await session.stop()).confirmed).toBe(
    'Earlier. Recognized. Recognized.',
  );
  await session.dispose();
});

test('microphone stop failure drains inference and does not publish a late snapshot', async () => {
  const pending = deferred<ReturnType<typeof result>>();
  context.transcribeData.mockReturnValueOnce({
    stop: jest.fn(),
    promise: pending.promise,
  });
  const session = new WhisperSpeechToTextSession('Earlier');
  await session.start(callbacks);
  data(speech(2), 16000);
  await tick();
  pcm.stop.mockRejectedValueOnce(new Error('Stop failed'));
  const stopped = session.stop();
  const rejection = stopped.catch(error => error);
  await tick();
  pending.resolve(result('Late'));
  expect((await rejection).message).toBe('Stop failed');
  expect(callbacks.onTranscript).not.toHaveBeenCalled();
  await session.dispose();
});

test('permission denial never captures or decodes', async () => {
  NativeModules.IosMicrophonePermission.request.mockResolvedValue(false);
  const session = new WhisperSpeechToTextSession();
  await session.start(callbacks);
  expect(pcm.start).not.toHaveBeenCalled();
  expect(initWhisper).not.toHaveBeenCalled();
  expect(callbacks.onStatus).toHaveBeenLastCalledWith('permission-denied');
  await session.dispose();
});

test('Stop reuses a completed snapshot when no new audio arrived', async () => {
  const session = new WhisperSpeechToTextSession();
  await session.start(callbacks);
  data(speech(2), 16000);
  await tick();
  expect((await session.stop()).confirmed).toBe('Recognized.');
  expect(context.transcribeData).toHaveBeenCalledTimes(1);
  await session.dispose();
});

test('Cancel aborts pending finalization, retains displayed text and allows a new press', async () => {
  const session = new WhisperSpeechToTextSession('Earlier.');
  await session.start(callbacks);
  data(speech(2), 16000);
  await tick();
  const pending = deferred<ReturnType<typeof result>>();
  const abort = jest.fn(() =>
    pending.resolve({ ...result('Late'), isAborted: true }),
  );
  context.transcribeData.mockReturnValueOnce({
    promise: pending.promise,
    stop: abort,
  });
  data(speech(0.5), 16000);
  const stopped = session.stop();
  await tick();
  await session.cancel();
  expect(abort).toHaveBeenCalledTimes(1);
  expect((await stopped).confirmed).toBe('Earlier. Recognized.');
  expect(callbacks.onError).not.toHaveBeenCalled();
  await session.start(callbacks);
  data(speech(0.5), 16000);
  expect((await session.stop()).confirmed).toBe(
    'Earlier. Recognized. Recognized.',
  );
  await session.dispose();
});

test('Stop reports a microphone that never delivered audio', async () => {
  const session = new WhisperSpeechToTextSession();
  await session.start(callbacks);
  await expect(session.stop()).rejects.toThrow('No microphone audio');
  await session.dispose();
});

test('first live snapshot starts after one second of audio', async () => {
  const session = new WhisperSpeechToTextSession();
  await session.start(callbacks);
  data(speech(0.5), 16000);
  await tick();
  expect(context.transcribeData).not.toHaveBeenCalled();
  data(speech(0.5), 16000);
  await tick();
  expect(context.transcribeData).toHaveBeenCalledTimes(1);
  await session.stop();
  await session.dispose();
});

test('Stop aborts a stale live snapshot and finalizes all audio without overlapping decoders', async () => {
  const pending = deferred<ReturnType<typeof result>>();
  const abort = jest.fn(() =>
    pending.resolve({ ...result('Outdated'), isAborted: true }),
  );
  context.transcribeData.mockReturnValueOnce({
    promise: pending.promise,
    stop: abort,
  });
  const session = new WhisperSpeechToTextSession('Earlier.');
  await session.start(callbacks);
  data(speech(1), 16000);
  await tick();
  data(speech(0.4), 16000);
  pcm.stop.mockImplementationOnce(async () => data(speech(0.1), 16000));
  const stopped = session.stop();
  expect((await stopped).confirmed).toBe('Earlier. Recognized.');
  expect(abort).toHaveBeenCalledTimes(1);
  expect(context.transcribeData).toHaveBeenCalledTimes(2);
  expect(context.transcribeData.mock.calls[1][0].byteLength).toBe(1.5 * 32000);
  expect(callbacks.onError).not.toHaveBeenCalled();
  expect(callbacks.onTranscript).not.toHaveBeenCalledWith(
    expect.objectContaining({ provisional: 'Outdated' }),
  );
  await session.dispose();
});

test('Stop keeps a running snapshot when it already covers all captured audio', async () => {
  const pending = deferred<ReturnType<typeof result>>();
  const abort = jest.fn();
  context.transcribeData.mockReturnValueOnce({
    promise: pending.promise,
    stop: abort,
  });
  const session = new WhisperSpeechToTextSession();
  await session.start(callbacks);
  data(speech(1), 16000);
  await tick();
  const stopped = session.stop();
  await tick();
  expect(abort).not.toHaveBeenCalled();
  pending.resolve(result('Complete.'));
  expect((await stopped).confirmed).toBe('Complete.');
  expect(context.transcribeData).toHaveBeenCalledTimes(1);
  await session.dispose();
});
