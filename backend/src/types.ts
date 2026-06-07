// Matches the mobile app's DiarizationSegment type exactly
export interface DiarizationSegment {
  speakerId: number;
  startSec: number;
  endSec: number;
  label?: string;
}

export interface TranscribeResponse {
  transcript: string;
  latencyMs: number;
  rtf: number;
  provider: string;
}

export interface DiarizeResponse {
  segments: DiarizationSegment[];
  transcript?: string;
  latencyMs: number;
  rtf: number;
  provider: string;
}

export interface ErrorResponse {
  error: string;
  provider?: string;
}

export type STTProvider = 'deepgram' | 'assemblyai' | 'google';
export type DiarizationProvider = 'deepgram' | 'google';
