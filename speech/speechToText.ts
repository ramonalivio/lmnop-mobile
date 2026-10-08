import type { RefinementOptions } from './refinementOptions';
export type { RefinementOptions } from './refinementOptions';
import { MoonshineSpeechToTextSession } from './moonshineSpeechToText';

export type { SpeechStatus, SpeechTranscript } from './speechTypes';
export type SpeechToTextSession = MoonshineSpeechToTextSession;

export function createSpeechToTextSession(
  confirmed = '',
  options?: RefinementOptions,
): SpeechToTextSession {
  return new MoonshineSpeechToTextSession(
    confirmed,
    true,
    false,
    false,
    true,
    options,
  );
}
