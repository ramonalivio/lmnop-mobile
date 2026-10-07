export type TimedText = { text: string; t0: number; t1: number };
export type AudioPause = { startMs: number; endMs: number };

/** Quiet intervals measured on original PCM, rather than decoder response time. */
export function audioPauses(samples: Float32Array, rate: number): AudioPause[] {
  const pauses: AudioPause[] = [];
  const frame = Math.max(1, Math.round(rate * 0.02));
  let start = -1;
  for (let i = 0; i < samples.length; i += frame) {
    const end = Math.min(samples.length, i + frame);
    let energy = 0;
    for (let j = i; j < end; j++) energy += samples[j] ** 2;
    if (energy / (end - i) < 0.005 ** 2) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if ((i - start) / rate >= 0.55)
        pauses.push({
          startMs: (start * 1000) / rate,
          endMs: (i * 1000) / rate,
        });
      start = -1;
    }
  }
  // Trailing silence has no following word to punctuate.
  return pauses;
}

export function punctuatePauses(
  text: string,
  segments: TimedText[] | undefined,
  pauses: AudioPause[],
) {
  if (
    !segments?.length ||
    segments
      .map(s => s.text)
      .join('')
      .trim() !== text.trim()
  )
    return text.trim();
  const parts = segments.map(s => s.text);
  const used = new Set<number>();
  for (const pause of pauses) {
    if (pause.startMs <= 0) continue;
    let best = -1;
    let distance = Infinity;
    for (let i = 1; i < segments.length; i++) {
      if (used.has(i)) continue;
      const before = parts.slice(0, i).join('');
      const after = parts.slice(i).join('');
      if (!/\s$/.test(before) && !/^\s/.test(after)) continue;
      if (
        !/[\p{L}\p{N}]$/u.test(before.trimEnd()) ||
        !/^[\p{L}\p{N}]/u.test(after.trimStart())
      )
        continue;
      // Avoid splitting quantities, decimals, blood pressures, or number/unit pairs.
      if (
        /\d\s*$/u.test(before) &&
        /^(?:\d|over\b|degrees?\b|celsius\b|fahrenheit\b|mg\b|milligrams?\b|percent\b)/i.test(
          after.trimStart(),
        )
      )
        continue;
      const left = segments[i - 1].t1 * 10; // whisper.cpp timestamp units: 10 ms.
      const right = segments[i].t0 * 10;
      if (!Number.isFinite(left) || !Number.isFinite(right) || right < left)
        continue;
      if (left > pause.endMs + 250 || right < pause.startMs - 250) continue;
      const score = Math.abs(
        (left + right) / 2 - (pause.startMs + pause.endMs) / 2,
      );
      if (score < distance) {
        best = i;
        distance = score;
      }
    }
    if (best < 0) continue;
    const punctuation = pause.endMs - pause.startMs >= 1200 ? '.' : ',';
    parts[best - 1] = parts[best - 1].trimEnd() + punctuation;
    parts[best] = ' ' + parts[best].trimStart();
    if (punctuation === '.') {
      // A word can span several tokens; change only its first letter.
      parts[best] = parts[best].replace(/\p{L}/u, letter =>
        letter.toUpperCase(),
      );
    }
    used.add(best);
  }
  return parts.join('').trim();
}

export function finishSentence(text: string) {
  let result = text.trim().replace(/^\p{L}/u, letter => letter.toUpperCase());
  if (/[\p{L}\p{N}]$/u.test(result)) result += '.';
  return result;
}
