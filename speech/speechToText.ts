import type { RefinementOptions } from './refinementOptions';
export type { RefinementOptions } from './refinementOptions';
import type { WhisperSpeechToTextSession } from './whisperSpeechToText';
import { MoonshineSpeechToTextSession } from './moonshineSpeechToText';
import type { ZipformerSpeechToTextSession } from './zipformerSpeechToText';

export type { SpeechStatus, SpeechTranscript } from './zipformerSpeechToText';
export type SpeechToTextSession =
  | WhisperSpeechToTextSession
  | MoonshineSpeechToTextSession
  | ZipformerSpeechToTextSession;

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
