export type SpeechStatus =
  | 'idle'
  | 'initializing'
  | 'listening'
  | 'finalizing'
  | 'refining'
  | 'permission-denied'
  | 'model-missing'
  | 'error';

export type SpeechTranscript = {
  pendingFrom?: number;
  confirmed: string;
  provisional: string;
};

export type SpeechToTextCallbacks = {
  onRecordingLimit?: () => void;
  onActivity?: (message: string) => void;
  onAudioLevel?: (level: number) => void;
  onError: (message: string) => void;
  onStatus: (status: SpeechStatus) => void;
  onTranscript: (transcript: SpeechTranscript) => void;
};
