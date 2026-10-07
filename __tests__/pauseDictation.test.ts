import { PhraseSegmenter, type Phrase } from '../speech/phraseSegmenter';
import {
  PauseDictationCore,
  type PausePorts,
} from '../speech/pauseDictationCore';

const frame = (value = 0.2, count = 512) => new Float32Array(count).fill(value);
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}
function segment(pause = 400) {
  const phrases: Phrase[] = [];
  const s = new PhraseSegmenter(p => phrases.push(p), pause);
  let at = 0;
  return {
    phrases,
    s,
    feed(n: number, speech: boolean) {
      for (let i = 0; i < n; i++) {
        at += 32;
        s.push(frame(speech ? 0.2 : 0), speech ? 0.9 : 0.01, at);
      }
    },
  };
}
test('400 ms silence triggers at 416 ms on the 32 ms VAD grid, never at 384 ms', () => {
  const { feed, phrases } = segment();
  feed(10, true);
  feed(12, false);
  expect(phrases).toHaveLength(0);
  feed(1, false);
  expect(phrases).toHaveLength(1);
  expect(phrases[0].samples.length).toBe(14 * 512); // Speech plus 128 ms context.
  expect(phrases[0].speechEndAt).toBe(320);
});
test('short pause resumes the same phrase; a configurable threshold works', () => {
  const { feed, phrases } = segment();
  feed(5, true);
  feed(12, false);
  feed(5, true);
  feed(13, false);
  expect(phrases).toHaveLength(1);
  expect(phrases[0].samples.length).toBe(26 * 512);
  const short = segment(200);
  short.feed(1, true);
  short.feed(7, false);
  expect(short.phrases).toHaveLength(1);
});
test('silence is ignored; pre/post context never overlaps between phrases', () => {
  const { feed, phrases, s } = segment();
  feed(100, false);
  s.finish();
  expect(phrases).toHaveLength(0);
  feed(10, false);
  feed(5, true);
  feed(13, false);
  feed(5, true);
  feed(13, false);
  s.finish();
  expect(phrases).toHaveLength(2);
  expect(phrases[0].samples.length).toBe(15 * 512);
  expect(phrases[1].startSample).toBeGreaterThanOrEqual(phrases[0].endSample);
});
test('extended speech is partitioned under 26 seconds without loss or overlap', () => {
  const { feed, phrases, s } = segment();
  feed(2500, true);
  s.finish();
  expect(phrases.length).toBeGreaterThan(3);
  expect(phrases.reduce((n, p) => n + p.samples.length, 0)).toBe(2500 * 512);
  phrases.forEach((p, i) => {
    expect(p.samples.length).toBeLessThanOrEqual(24 * 16000);
    if (i) expect(p.startSample).toBe(phrases[i - 1].endSample);
  });
});
function setup(transcribe?: PausePorts['transcribe']) {
  const stored = new Map<string, Phrase>();
  const outputs: string[] = [];
  const errors: Error[] = [];
  let journalSamples = 0;
  const ports: PausePorts = {
    vad: jest.fn(async samples => (samples[0] > 0 ? 0.9 : 0.01)),
    store: jest.fn(async (p, i) => {
      stored.set(String(i), p);
      return String(i);
    }),
    transcribe:
      transcribe ??
      jest.fn(async ref => ({ text: `phrase ${ref}`, nativeMs: 10 })),
    remove: jest.fn(async () => undefined),
    journal: jest.fn(async samples => {
      journalSamples += samples.length;
    }),
    onText: text => outputs.push(text),
    onActivity: jest.fn(),
    onError: e => errors.push(e),
    onTiming: jest.fn(),
    now: () => 1000,
  };
  const core = new PauseDictationCore(ports, 'Existing edited text.');
  return {
    core,
    ports,
    stored,
    outputs,
    errors,
    journalSamples: () => journalSamples,
    feed(n: number, speech = true) {
      for (let i = 0; i < n; i++) core.accept(frame(speech ? 0.2 : 0));
    },
  };
}
test('capture and VAD continue while ASR is blocked; transcripts append in order to latest edits', async () => {
  const first = deferred<{ text: string; nativeMs: number }>();
  const transcribe = jest.fn(ref =>
    ref === '1'
      ? first.promise
      : Promise.resolve({ text: 'Second.', nativeMs: 1 }),
  );
  const { feed, core, ports, stored, outputs, journalSamples } =
    setup(transcribe);
  feed(4);
  feed(13, false);
  await tick();
  expect(transcribe).toHaveBeenCalledTimes(1);
  feed(4);
  feed(13, false);
  await tick();
  expect(stored.size).toBe(2);
  expect(journalSamples()).toBe(34 * 512);
  expect(ports.vad).toHaveBeenCalledTimes(34);
  expect(transcribe).toHaveBeenCalledTimes(1);
  core.setText('User changed this.');
  first.resolve({ text: 'First.', nativeMs: 40 });
  await core.finish();
  expect(outputs).toEqual([
    'User changed this. First.',
    'User changed this. First. Second.',
  ]);
});
test('Stop flushes speech and partial PCM immediately and waits for the last job, once', async () => {
  const last = deferred<{ text: string; nativeMs: number }>();
  const { core, feed, ports, stored } = setup(() => last.promise);
  feed(3);
  core.accept(frame(0.2, 173));
  let finished = false;
  const stopping = core.finish().then(() => {
    finished = true;
  });
  await tick();
  expect(stored.get('1')?.samples.length).toBe(3 * 512 + 173);
  expect(stored.get('1')?.reason).toBe('stop');
  expect(finished).toBe(false);
  last.resolve({ text: 'Flushed.', nativeMs: 1 });
  await stopping;
  await core.finish();
  expect(ports.store).toHaveBeenCalledTimes(1);
});
test('cancel suppresses in-flight and queued results and does not flush remaining speech', async () => {
  const first = deferred<{ text: string; nativeMs: number }>();
  const transcribe = jest.fn(() => first.promise);
  const { feed, core, outputs, ports } = setup(transcribe);
  feed(3);
  feed(13, false);
  await tick();
  feed(3);
  feed(13, false);
  await tick();
  feed(2);
  await tick();
  const cancelled = core.cancel();
  first.resolve({ text: 'STALE', nativeMs: 1 });
  await cancelled;
  expect(outputs).toEqual([]);
  expect(transcribe).toHaveBeenCalledTimes(1);
  expect(ports.store).toHaveBeenCalledTimes(2);
  expect(core.text).toBe('Existing edited text.');
});
test('failed ASR retains queued audio and prevents later phrases skipping ahead', async () => {
  const transcribe = jest.fn(async () => {
    throw new Error('native failed');
  });
  const { core, feed, errors, outputs, ports } = setup(transcribe);
  feed(4);
  feed(13, false);
  feed(4);
  feed(13, false);
  await core.finish();
  expect(errors).toHaveLength(1);
  expect(outputs).toEqual([]);
  expect(ports.store).toHaveBeenCalledTimes(2);
  expect(ports.remove).not.toHaveBeenCalled();
  expect(transcribe).toHaveBeenCalledTimes(1);
});
test('VAD failure journals all accepted audio for recovery', async () => {
  const { core, feed, ports, errors, journalSamples } = setup();
  (ports.vad as jest.Mock).mockRejectedValue(new Error('VAD failed'));
  feed(5);
  await core.finish();
  expect(errors).toHaveLength(1);
  expect(journalSamples()).toBe(5 * 512);
  expect(ports.transcribe).not.toHaveBeenCalled();
});
test('silence-only Stop never calls Parakeet', async () => {
  const { core, feed, ports } = setup();
  feed(30, false);
  await core.finish();
  expect(ports.transcribe).not.toHaveBeenCalled();
});

test('backpressure is explicit and every accepted sample is retained in the journal', async () => {
  const { core, feed, errors, journalSamples } = setup();
  feed(330); // More than ten seconds queued before VAD can run.
  await core.finish();
  expect(errors).toHaveLength(1);
  expect(errors[0].message).toContain('behind');
  expect(journalSamples()).toBe(330 * 512);
});
