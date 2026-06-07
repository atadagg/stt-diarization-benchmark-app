// ---------------------------------------------------------------------------
// Core domain types for the benchmark harness
// ---------------------------------------------------------------------------

export type BenchmarkStatus = 'idle' | 'running' | 'done' | 'error';

export interface DiarizationSegment {
  speakerId: number;
  startSec: number;
  endSec: number;
  label?: string; // e.g. "SPEAKER_00"
}

export interface BenchmarkResult {
  modelId: string;
  status: BenchmarkStatus;
  /** Wall-clock elapsed time from start to end of inference call (ms). */
  latencyMs: number | null;
  /** Real-Time Factor = processingTime / audioDuration. <1 means faster than real-time. */
  rtf: number | null;
  /** Best-effort RSS delta (MB). Null when platform doesn't expose this. */
  peakMemoryMB: number | null;
  errorMessage: string | null;
  /** STT only — raw transcript for manual WER inspection. */
  transcript?: string;
  /** STT only — Word Error Rate against referenceTranscript. Null when no reference loaded. */
  wer?: number;
  /** Diarization only — speaker segments. */
  segments?: DiarizationSegment[];
  /** Diarization only — Diarization Error Rate against referenceDiarization. Null when no reference loaded. */
  der?: number;
  /** Battery percentage consumed during inference. Null when unavailable or unchanged. */
  batteryDrainPct?: number;
}

export interface ModelConfig {
  id: string;
  name: string;
  description: string;
  /** Which platforms this model can run on. */
  platforms: ('ios' | 'android')[];
  category: 'stt' | 'diarization';
}

export interface AudioFile {
  uri: string;
  filename: string;
  /** Duration in seconds — required for RTF computation. */
  durationSeconds: number;
  /** STT ground truth — plain text, loaded from a paired .txt file. */
  referenceTranscript?: string;
  /** Diarization ground truth — parsed from a paired .rttm file. */
  referenceDiarization?: DiarizationSegment[];
}
