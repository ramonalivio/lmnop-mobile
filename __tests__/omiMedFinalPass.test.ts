jest.mock('../speech/omiMedModel', () => ({
  getOmiMedModelPath: jest
    .fn()
    .mockResolvedValue('/downloaded/omi-med-stt-v1-q8_0.gguf'),
}));
import { NativeModules } from 'react-native';
import { OmiMedFinalPass } from '../speech/omiMedFinalPass';
import type { SpeechProfiler } from '../speech/speechProfiler';

const native = {
  prepare: jest.fn(),
  transcribe: jest.fn(),
  release: jest.fn(),
};
const mark = jest.fn();
const profiler = { mark } as unknown as SpeechProfiler;
beforeEach(() => {
  jest.clearAllMocks();
  NativeModules.OmiMedSpeech = native;
  native.prepare.mockResolvedValue({
    backend: 'CPU',
    gpu: false,
    nativeLoadMs: 123,
  });
  native.transcribe.mockResolvedValue({
    text: 'Medical dictation.',
    nativeMs: 25,
  });
  native.release.mockResolvedValue(undefined);
});

test('preload is shared, Stop reuses it, and every audio sample reaches refinement', async () => {
  const pass = new OmiMedFinalPass();
  await Promise.all([pass.prepare(profiler), pass.prepare(profiler)]);
  expect(native.prepare).toHaveBeenCalledTimes(1);
  expect(native.prepare).toHaveBeenCalledWith(
    expect.any(String),
    '/downloaded/omi-med-stt-v1-q8_0.gguf',
  );
  pass.append(new Float32Array(16000 * 60).fill(0.2), 16000);
  expect(await pass.transcribe(profiler, jest.fn())).toBe(
    'Medical dictation. Medical dictation. Medical dictation.',
  );
  const bytes = native.transcribe.mock.calls.reduce((sum, call) => {
    const encoded: string = call[1];
    return (
      sum +
      (encoded.length * 3) / 4 -
      (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0)
    );
  }, 0);
  expect(bytes).toBe(16000 * 60 * 2);
  expect(native.prepare).toHaveBeenCalledTimes(1);
  expect(native.release).toHaveBeenCalledTimes(1);
  expect(mark).toHaveBeenCalledWith(
    'omi-model-ready',
    expect.objectContaining({ nativeLoadMs: 123 }),
  );
});

test('decode failure still unloads the model', async () => {
  const pass = new OmiMedFinalPass();
  pass.append(new Float32Array(16000).fill(0.2), 16000);
  native.transcribe.mockRejectedValueOnce(new Error('native failed'));
  await expect(pass.transcribe(profiler, jest.fn())).rejects.toThrow(
    'native failed',
  );
  expect(native.release).toHaveBeenCalledTimes(1);
});

test('cancelling an in-flight decode discards its result and unloads', async () => {
  const pass = new OmiMedFinalPass();
  await pass.prepare(profiler);
  pass.append(new Float32Array(16000).fill(0.2), 16000);
  let finish!: (value: unknown) => void;
  native.transcribe.mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve;
    }),
  );
  const result = pass.transcribe(profiler, jest.fn());
  await new Promise<void>(resolve => setImmediate(resolve));
  await pass.cancel();
  finish({ text: 'Discard this.', nativeMs: 20 });
  expect(await result).toBe('');
  expect(native.release).toHaveBeenCalledTimes(1);
});
