import {
  PhraseSegmenter,
  PCM_RATE,
  VAD_FRAME,
  type Phrase,
} from './phraseSegmenter';

export type PhraseTiming = {
  index: number;
  reason: Phrase['reason'];
  audioSeconds: number;
  queueMs: number;
  nativeMs: number;
  pauseToTextMs: number;
  elapsedMs: number;
};
export type PausePorts = {
  vad: (frame: Float32Array) => Promise<number>;
  // Store returns a small disk reference. Queued inference does not retain PCM arrays.
  store: (phrase: Phrase, index: number) => Promise<string>;
  transcribe: (
    reference: string,
  ) => Promise<{ text: string; nativeMs: number }>;
  remove: (reference: string) => Promise<void>;
  journal: (samples: Float32Array) => Promise<void>;
  onText: (text: string) => void;
  onActivity: (message: string) => void;
  onError: (error: Error) => void;
  onTiming: (timing: PhraseTiming) => void;
  now: () => number;
};

/** Independent ordered VAD/storage and ASR pipelines. Only ASR is serialized. */
export class PauseDictationCore {
  private segmenter: PhraseSegmenter;
  private vadTail = Promise.resolve();
  private asrTail = Promise.resolve();
  private remainder = new Float32Array();
  private remainderAt = 0;
  private accepting = true;
  private cancelled = false;
  private failure: Error | null = null;
  private vadFailed = false;
  private index = 0;
  private queued = 0;
  private pendingSamples = 0;
  private lastText = '';
  private finishing: Promise<string> | null = null;
  constructor(private ports: PausePorts, initial = '', pauseMs = 160) {
    this.lastText = initial;
    this.segmenter = new PhraseSegmenter(
      phrase => this.enqueue(phrase),
      pauseMs,
    );
  }
  get text() {
    return this.lastText;
  }
  get error() {
    return this.failure;
  }
  setText(value: string) {
    this.lastText = value;
  }
  private fail(error: unknown) {
    if (this.failure || this.cancelled) return;
    this.failure = error instanceof Error ? error : new Error(String(error));
    this.ports.onError(this.failure);
  }
  accept(samples: Float32Array, capturedAt = this.ports.now()) {
    if (!this.accepting || this.cancelled) return;
    this.pendingSamples += samples.length;
    // Stop capture visibly if VAD/storage cannot keep up. Already accepted samples
    // still pass through the journal; an error never silently discards the backlog.
    if (this.pendingSamples > PCM_RATE * 10)
      this.fail(
        new Error(
          'Dictation processing is behind. Recording stopped; audio was retained.',
        ),
      );
    this.vadTail = this.vadTail.then(async () => {
      try {
        if (this.cancelled) return;
        await this.ports.journal(samples);
        if (this.vadFailed) return;
        const joined = new Float32Array(this.remainder.length + samples.length);
        joined.set(this.remainder);
        joined.set(samples, this.remainder.length);
        let offset = 0;
        while (offset + VAD_FRAME <= joined.length && !this.cancelled) {
          const frame = joined.slice(offset, offset + VAD_FRAME);
          const probability = await this.ports.vad(frame);
          if (this.cancelled) return;
          this.segmenter.push(
            frame,
            probability,
            capturedAt - (joined.length - offset - VAD_FRAME) / 16,
          );
          offset += VAD_FRAME;
        }
        this.remainder = joined.slice(offset);
        this.remainderAt = capturedAt;
      } catch (error) {
        this.vadFailed = true;
        this.fail(error);
      } finally {
        this.pendingSamples -= samples.length;
      }
    });
  }
  private enqueue(phrase: Phrase) {
    if (this.cancelled) return;
    const index = ++this.index;
    const submitted = this.ports.now();
    const seconds = phrase.samples.length / PCM_RATE;
    const speechEndAt = phrase.speechEndAt;
    const reason = phrase.reason;
    this.queued++;
    this.ports.onActivity(
      `Transcribing · ${this.queued} phrase${
        this.queued === 1 ? '' : 's'
      } pending`,
    );
    // Begin persistence immediately, independently of earlier inference.
    const stored = this.ports.store(phrase, index).then(
      reference => ({ reference }),
      error => {
        this.fail(error);
        return { reference: null };
      },
    );
    this.asrTail = this.asrTail
      .then(async () => {
        const { reference } = await stored;
        if (!reference) {
          this.queued--;
          return;
        }
        if (this.cancelled) {
          await this.ports.remove(reference);
          this.queued--;
          return;
        }
        // A failed phrase must not be skipped and followed by later text.
        if (this.failure) {
          this.queued--;
          return;
        }
        const started = this.ports.now();
        try {
          const result = await this.ports.transcribe(reference);
          if (this.cancelled) return;
          const text = result.text.trim();
          if (text) {
            this.lastText +=
              (this.lastText && !/\s$/.test(this.lastText) ? ' ' : '') + text;
            this.ports.onText(this.lastText);
          }
          this.ports.onTiming({
            index,
            reason,
            audioSeconds: seconds,
            queueMs: started - submitted,
            nativeMs: result.nativeMs,
            elapsedMs: this.ports.now() - started,
            pauseToTextMs: this.ports.now() - speechEndAt,
          });
          await this.ports.remove(reference);
        } catch (error) {
          this.fail(error);
        } finally {
          this.queued--;
          if (!this.cancelled)
            this.ports.onActivity(
              this.queued
                ? `Transcribing · ${this.queued} phrases pending`
                : 'Listening for speech…',
            );
        }
      })
      .catch(error => this.fail(error));
  }
  finish() {
    this.accepting = false;
    this.finishing ??= (async () => {
      await this.vadTail;
      if (!this.cancelled && !this.vadFailed) {
        try {
          if (this.remainder.length) {
            const padded = new Float32Array(VAD_FRAME);
            padded.set(this.remainder);
            const probability = await this.ports.vad(padded);
            if (!this.cancelled)
              this.segmenter.push(
                this.remainder,
                probability,
                this.remainderAt,
              );
            this.remainder = new Float32Array();
          }
          if (!this.cancelled) this.segmenter.finish();
        } catch (error) {
          this.fail(error);
        }
      }
      await this.asrTail;
      return this.lastText;
    })();
    return this.finishing;
  }
  async cancel() {
    this.cancelled = true;
    this.accepting = false;
    await this.finish();
    return this.lastText;
  }
}
