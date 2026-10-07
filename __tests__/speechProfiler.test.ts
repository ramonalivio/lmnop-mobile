import { NativeModules } from 'react-native';
import { SpeechProfiler } from '../speech/speechProfiler';

const bridge = {
  start: jest.fn(),
  mark: jest.fn(),
  checkpoint: jest.fn(),
  end: jest.fn(),
  exportLatest: jest.fn(),
};
beforeEach(() => {
  jest.resetAllMocks();
  NativeModules.SpeechProfiler = bridge;
  bridge.start.mockResolvedValue('profile-id');
  bridge.exportLatest.mockResolvedValue(
    'file:///cache/SpeechProfiles/profile-id.json',
  );
});
afterEach(() => {
  jest.restoreAllMocks();
  delete NativeModules.SpeechProfiler;
});

test('starts once and preserves marker/checkpoint/release ordering even while start is pending', async () => {
  let loaded!: (value: string) => void;
  bridge.start.mockReturnValue(
    new Promise(resolve => {
      loaded = resolve;
    }),
  );
  const profiler = new SpeechProfiler();
  profiler.begin();
  profiler.begin();
  profiler.mark('model-ready', { gpu: false });
  profiler.checkpoint();
  const ended = profiler.end();
  profiler.mark('must-not-run');
  loaded('profile-id');
  await ended;
  await profiler.end();
  expect(bridge.start).toHaveBeenCalledTimes(1);
  expect(bridge.mark).toHaveBeenCalledTimes(1);
  expect(bridge.mark).toHaveBeenCalledWith('profile-id', 'model-ready', {
    gpu: false,
  });
  expect(bridge.mark.mock.invocationCallOrder[0]).toBeLessThan(
    bridge.checkpoint.mock.invocationCallOrder[0],
  );
  expect(bridge.checkpoint.mock.invocationCallOrder[0]).toBeLessThan(
    bridge.end.mock.invocationCallOrder[0],
  );
  expect(bridge.end).toHaveBeenCalledTimes(1);
});

test('native metric/persistence failures do not reject and later cleanup still runs', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  bridge.mark.mockRejectedValue(new Error('sample failed'));
  bridge.checkpoint.mockRejectedValue(new Error('disk full'));
  const profiler = new SpeechProfiler();
  await profiler.begin();
  profiler.mark('live-decode-end', {
    elapsedMs: 100,
    audioSeconds: 2,
    realTimeFactor: 0.05,
  });
  profiler.checkpoint();
  await expect(profiler.end()).resolves.toBeUndefined();
  expect(bridge.end).toHaveBeenCalledWith('profile-id');
  expect(console.warn).toHaveBeenCalledTimes(1);
});

test('a missing native module is harmless to dictation and explicit on export', async () => {
  delete NativeModules.SpeechProfiler;
  const profiler = new SpeechProfiler();
  await profiler.begin();
  profiler.mark('recording');
  await expect(profiler.end()).resolves.toBeUndefined();
});

