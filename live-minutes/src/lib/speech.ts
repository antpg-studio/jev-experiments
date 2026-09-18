/** Minimal typing for the (Chrome-prefixed) Web Speech API. */
export interface SpeechResultAlternative {
  transcript: string;
  confidence: number;
}
export interface SpeechResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechResultAlternative;
}
export interface SpeechResultList {
  length: number;
  [index: number]: SpeechResult;
}
export interface SpeechResultEvent extends Event {
  resultIndex: number;
  results: SpeechResultList;
}
export interface SpeechErrorEvent extends Event {
  error: string;
}
export interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechResultEvent) => void) | null;
  onerror: ((ev: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type Ctor = new () => SpeechRecognitionLike;

export function getSpeechRecognition(): Ctor | null {
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
