import { WhisperFinalPass, whisperWindows } from '../speech/whisperFinalPass';
import { createSTT } from 'react-native-sherpa-onnx/stt';
jest.mock('react-native-sherpa-onnx/stt', () => ({ createSTT: jest.fn() }));

test('short sentences stay intact', () => {
  expect(whisperWindows(new Float32Array(16000 * 12), 16000)).toEqual([
    [0, 192000],
  ]);
});

test('long recordings prefer silence and cover all audio once', () => {
  const audio = new Float32Array(16000 * 60).fill(0.2);
  audio.fill(0, 16000 * 19, 16000 * 20);
  const windows = whisperWindows(audio, 16000);
  expect(windows[0][1]).toBeGreaterThan(16000 * 19);
  expect(windows[0][1]).toBeLessThan(16000 * 20);
  expect(windows.at(-1)![1]).toBe(audio.length);
  windows.forEach(([start, end], i) => {
    expect(end - start).toBeLessThanOrEqual(16000 * 25);
    expect(start).toBe(i ? windows[i - 1][1] : 0);
  });
});

test('rate changes and memory cap fail explicitly; clear resets state', async () => {
  const pass = new WhisperFinalPass();
  pass.append(new Float32Array(1), 48000);
  pass.append(new Float32Array(1), 16000);
  await expect(pass.transcribe()).rejects.toThrow('sample rate changed');
  pass.clear();
  pass.append(new Float32Array(8000 * 180 + 1), 8000);
  await expect(pass.transcribe()).rejects.toThrow('three minutes');
  expect(createSTT).not.toHaveBeenCalled();
  pass.clear();
  expect(pass.hasAudio).toBe(false);
});
