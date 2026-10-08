import { NativeModules } from 'react-native';
import RNFS from 'react-native-fs';
import { SpeechAudio } from './speechAudio';
import { savePerformanceRecording } from './performanceReports';

type Details = {
  queueMs?: number;
  pauseToTextMs?: number;
  backend?: string;
  threads?: number;
  model?: string;
  runtime?: string;
  audioSeconds?: number;
  elapsedMs?: number;
  tdtLoadMs?: number;
  omiLoadMs?: number;
  nativeLoadMs?: number;
  nativeMs?: number;
  melMs?: number;
  encoderMs?: number;
  decoderMs?: number;
  realTimeFactor?: number;
  decodeIndex?: number;
  recordingIndex?: number;
  final?: boolean;
  success?: boolean;
  gpu?: boolean;
  reasonNoGPU?: string;
};
type Bridge = {
  start(): Promise<string>;
  mark(id: string, phase: string, details: Details): Promise<void>;
  checkpoint(id: string): Promise<string>;
  end(id: string): Promise<string>;
  exportLatest(): Promise<string>;
};

/** Ordered, best-effort metrics: instrumentation must never break dictation. */
export class SpeechProfiler {
  private audio = new SpeechAudio();
  private metadata: Details = {};
  private events: unknown[] = [];
  private recordingAt = 0;
  private stopAt = 0;
  private recordingError: string | null = null;
  private liveResult = '';
  private prefix = '';
  capture(samples: Float32Array, rate: number) {
    this.audio.append(samples, rate);
  }
  recordingPrefix(value: string) {
    this.prefix = value;
  }
  result(value: string) {
    this.liveResult = value;
  }
  failure(value: string) {
    this.recordingError = value;
  }
  configure(details: Details) {
    this.metadata = { ...this.metadata, ...details };
  }
  async finishRecording(result: string, success: boolean) {
    const audio = this.audio;
    this.audio = new SpeechAudio();
    if (!audio.count) return;
    const events = [...this.events];
    const details = {
      model: this.metadata.model ?? 'unspecified',
      runtime: this.metadata.runtime,
      mode: 'offline',
      elapsedMs: speechProfileNow() - this.recordingAt,
      finalizationMs: this.stopAt ? speechProfileNow() - this.stopAt : null,
      result: result.startsWith(this.prefix)
        ? result.slice(this.prefix.length).trim()
        : result,
      fullResult: result,
      liveResult: this.liveResult,
      tdtLoadMs: this.metadata.tdtLoadMs,
      omiLoadMs: this.metadata.omiLoadMs,
      success: success && !this.recordingError,
      error: this.recordingError,
      events,
    };
    let metrics: unknown = {
      unavailable:
        'Native CPU and memory profiler is unavailable on this build.',
    };
    try {
      await this.queue;
      if (this.id && this.bridge) {
        const path = await this.bridge.checkpoint(this.id);
        if (path)
          metrics = recordingMetrics(
            JSON.parse(
              await RNFS.readFile(path.replace(/^file:\/*/, '/'), 'utf8'),
            ),
          );
      }
    } catch {
      metrics = { unavailable: 'Metrics export failed.' };
    }
    try {
      await savePerformanceRecording(audio, { ...details, metrics });
    } finally {
      audio.clear();
    }
  }

  private id: string | null = null;
  private queue = Promise.resolve();
  private begun = false;
  private ended = false;
  private warned = false;
  private bridge: Bridge | undefined;

  private enqueue(action: () => Promise<unknown>) {
    this.queue = this.queue
      .then(action)
      .then(() => undefined)
      .catch(() => {
        if (!this.warned) {
          console.warn(
            'LMNOP_SPEECH_PROFILE: profiling unavailable; dictation continues.',
          );
          this.warned = true;
        }
      });
    return this.queue;
  }

  begin() {
    if (!this.begun) {
      this.begun = true;
      this.bridge = NativeModules.SpeechProfiler as Bridge | undefined;
      this.enqueue(async () => {
        this.id = (await this.bridge?.start()) ?? null;
      });
    }
    return this.queue;
  }

  mark(phase: string, details: Details = {}) {
    if (this.ended) return;
    if (phase === 'model-load')
      this.metadata = { ...this.metadata, ...details };
    if (phase === 'omi-model-ready')
      this.metadata = { ...this.metadata, omiLoadMs: details.elapsedMs };
    if (phase === 'tdt-model-ready')
      this.metadata = { ...this.metadata, tdtLoadMs: details.elapsedMs };
    if (phase === 'recording') {
      this.recordingAt = speechProfileNow();
      this.stopAt = 0;
      this.events = [];
      this.recordingError = null;
      this.liveResult = '';
      this.audio.clear();
    }
    if (phase === 'stop-requested') this.stopAt = speechProfileNow();
    this.events.push({
      phase,
      details,
      elapsedMs: speechProfileNow() - this.recordingAt,
    });
    if (this.events.length > 600) this.events.shift();
    this.enqueue(async () => {
      if (this.id) await this.bridge?.mark(this.id, phase, details);
    });
  }

  checkpoint() {
    if (this.ended) return;
    this.enqueue(async () => {
      if (this.id) await this.bridge?.checkpoint(this.id);
    });
  }

  end() {
    if (!this.ended) {
      this.ended = true;
      this.enqueue(async () => {
        if (this.id) await this.bridge?.end(this.id);
      });
    }
    return this.queue;
  }
}

/** React Native provides a monotonic performance clock; keep its type local. */
export function speechProfileNow() {
  const clock = (
    globalThis as typeof globalThis & { performance?: { now(): number } }
  ).performance;
  return clock?.now() ?? Date.now();
}

/** Restrict sampled process metrics to this press, including its final decode. */
export function recordingMetrics(value: unknown) {
  const report = value as {
    events?: Array<{ phase: string; metrics?: Record<string, number> }>;
    samples?: Array<Record<string, number>>;
    [key: string]: unknown;
  };
  const start = report.events
    ?.filter(event => event.phase === 'recording')
    .pop()?.metrics;
  if (!start || !report.samples) return value;
  const samples = report.samples.filter(
    sample => sample.uptimeSeconds >= start.uptimeSeconds,
  );
  const last = samples[samples.length - 1] ?? start;
  const elapsed = last.uptimeSeconds - start.uptimeSeconds;
  const cpuSeconds = last.cpuSeconds - start.cpuSeconds;
  const peak = (field: string) => {
    const values = [start, ...samples]
      .map(sample => sample[field])
      .filter(n => typeof n === 'number' && Number.isFinite(n));
    return values.length ? Math.max(...values) : null;
  };
  return {
    ...report,
    samples,
    baseline: start,
    events: report.events?.filter(
      event =>
        event.metrics && event.metrics.uptimeSeconds >= start.uptimeSeconds,
    ),
    scope:
      'Whole app process during this recording and finalization; CPU 100% = one core; peaks are sampled.',
    summary: {
      elapsedSeconds: elapsed,
      cpuSeconds: Number.isFinite(cpuSeconds) ? cpuSeconds : null,
      averageCpuPercentOneCore:
        elapsed > 0 && Number.isFinite(cpuSeconds)
          ? (100 * cpuSeconds) / elapsed
          : null,
      peakCpuPercentOneCore: peak('cpuPercentOneCore'),
      peakFootprintMiB: peak('footprintMiB'),
      peakResidentMiB: peak('residentMiB'),
    },
  };
}
