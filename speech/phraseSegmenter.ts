export const VAD_FRAME = 512;
export const PCM_RATE = 16000;
type Frame = {
  samples: Float32Array;
  speech: boolean;
  at: number;
  start: number;
};
export type Phrase = {
  samples: Float32Array;
  startSample: number;
  endSample: number;
  speechEndAt: number;
  reason: 'pause' | 'limit' | 'stop';
};

/** Audio-clock endpoints: scheduling delays cannot turn a short pause into a boundary. */
export class PhraseSegmenter {
  private pre: Frame[] = [];
  private frames: Frame[] = [];
  private cursor = 0;
  private silence = 0;
  private voiced = false;
  readonly pauseSamples: number;
  constructor(private emit: (phrase: Phrase) => void, pauseMs = 160) {
    if (!Number.isFinite(pauseMs) || pauseMs < 100 || pauseMs > 2000)
      throw new Error('Pause must be between 100 and 2000 ms.');
    this.pauseSamples = Math.ceil((pauseMs * PCM_RATE) / 1000);
  }
  push(samples: Float32Array, probability: number, at: number) {
    if (!samples.length || samples.length > VAD_FRAME)
      throw new Error('Invalid VAD frame');
    const speech = probability >= (this.voiced ? 0.35 : 0.5);
    this.voiced = speech;
    const frame = { samples, speech, at, start: this.cursor };
    this.cursor += samples.length;
    if (!this.frames.length) {
      if (!speech) {
        this.pre.push(frame);
        this.pre = this.pre.slice(-6);
        return;
      }
      this.frames = this.pre;
      this.pre = [];
    }
    this.frames.push(frame);
    this.silence = speech ? 0 : this.silence + samples.length;
    if (this.silence >= this.pauseSamples) {
      const last = this.lastSpeech();
      // 128 ms trailing padding, never consume more than the available silence.
      const end = Math.min(this.frames.length, last + 1 + 4);
      const unused = this.frames.slice(end);
      this.publish(end, 'pause');
      this.frames = [];
      this.pre = unused.slice(-6);
      this.silence = 0;
    } else if (this.frames.length >= 750) {
      // TDT is non-streaming: choose the quietest disjoint boundary in the last
      // second before 24 seconds. No overlap means no duplicate words/audio.
      let cut = 719;
      let quietest = Infinity;
      for (let i = 719; i < this.frames.length; i++) {
        let energy = 0;
        for (const sample of this.frames[i].samples) energy += sample * sample;
        if (energy < quietest) {
          quietest = energy;
          cut = i;
        }
      }
      this.publish(cut + 1, 'limit');
    }
  }
  private lastSpeech() {
    for (let i = this.frames.length - 1; i >= 0; i--)
      if (this.frames[i].speech) return i;
    return -1;
  }
  private publish(count: number, reason: Phrase['reason']) {
    const frames = this.frames.splice(0, count);
    const speech = frames.filter(frame => frame.speech);
    if (!speech.length) return;
    const samples = new Float32Array(
      frames.reduce((n, f) => n + f.samples.length, 0),
    );
    let offset = 0;
    for (const frame of frames) {
      samples.set(frame.samples, offset);
      offset += frame.samples.length;
    }
    this.emit({
      samples,
      startSample: frames[0].start,
      endSample: frames[0].start + samples.length,
      speechEndAt: speech[speech.length - 1].at,
      reason,
    });
  }
  finish() {
    this.publish(this.frames.length, 'stop');
    this.pre = [];
    this.silence = 0;
    this.voiced = false;
  }
}
