// ---------------------------------------------------------------------------
// Benchmark metric helpers
// ---------------------------------------------------------------------------

import * as Battery from 'expo-battery';
import { DiarizationSegment } from '../types/benchmark';

/**
 * Compute the Real-Time Factor (RTF).
 *
 * RTF = processingTimeMs / (audioDurationSeconds * 1000)
 *
 * A value < 1 means the model processed audio faster than real-time.
 * Returns null when either input is unavailable.
 */
export function computeRTF(
  processingTimeMs: number | null,
  audioDurationSeconds: number | null,
): number | null {
  if (
    processingTimeMs == null ||
    audioDurationSeconds == null ||
    audioDurationSeconds <= 0
  ) {
    return null;
  }
  return processingTimeMs / (audioDurationSeconds * 1000);
}

/**
 * Format an RTF value for display.
 * e.g. 0.124 → "0.124 (13% of real-time)"
 */
export function formatRTF(rtf: number | null): string {
  if (rtf == null) return 'N/A';
  const pct = (rtf * 100).toFixed(1);
  return `${rtf.toFixed(3)}  (${pct}% of real-time)`;
}

/**
 * Format a latency value for display.
 */
export function formatLatency(latencyMs: number | null): string {
  if (latencyMs == null) return 'N/A';
  if (latencyMs < 1000) return `${latencyMs.toFixed(0)} ms`;
  return `${(latencyMs / 1000).toFixed(2)} s`;
}

/**
 * Best-effort peak memory snapshot using the JS heap.
 *
 * NOTE: On React Native this reflects V8/JSC heap only, NOT native model
 * allocations. It is provided as a rough indicator and may be null on
 * environments that don't expose performance.memory.
 *
 * Returns MB or null.
 */
export function snapMemoryMB(): number | null {
  try {
    // performance.memory is available in some Hermes / V8 builds.
    const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
    if (mem?.usedJSHeapSize != null) {
      return mem.usedJSHeapSize / (1024 * 1024);
    }
  } catch {
    // ignore — not all engines expose this
  }
  return null;
}

/**
 * Measure a delta in JS heap between two snapshots.
 * Returns null when either snapshot is null.
 */
export function memoryDeltaMB(
  beforeMB: number | null,
  afterMB: number | null,
): number | null {
  if (beforeMB == null || afterMB == null) return null;
  return afterMB - beforeMB;
}

// ---------------------------------------------------------------------------
// WER — Word Error Rate
// ---------------------------------------------------------------------------

/**
 * Strip noise markers, punctuation, and normalise whitespace so that
 * transcripts from different systems can be compared fairly.
 */
export function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/\[.*?\]/g, ' ')        // remove [noise], [breath], etc.
    .replace(/[^\w\s']/g, ' ')       // strip punctuation except apostrophes
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Space-optimised word-level edit distance (O(min(m,n)) space).
 */
function wordEditDistance(a: string[], b: string[]): number {
  // Work over the shorter sequence as columns to minimise allocation.
  let [ref, hyp] = a.length <= b.length ? [a, b] : [b, a];
  let prev = Array.from({ length: ref.length + 1 }, (_, i) => i);
  for (let j = 1; j <= hyp.length; j++) {
    const curr: number[] = [j];
    for (let i = 1; i <= ref.length; i++) {
      curr[i] = ref[i - 1] === hyp[j - 1]
        ? prev[i - 1]
        : 1 + Math.min(prev[i], curr[i - 1], prev[i - 1]);
    }
    prev = curr;
  }
  return prev[ref.length];
}

/**
 * Compute Word Error Rate.
 * WER = edit_distance(ref_words, hyp_words) / len(ref_words)
 * Can exceed 1.0 when hypotheses are much longer than the reference.
 */
export function computeWER(reference: string, hypothesis: string): number {
  const refWords = normalizeTranscript(reference).split(' ').filter(Boolean);
  const hypWords = normalizeTranscript(hypothesis).split(' ').filter(Boolean);
  if (refWords.length === 0) return 0;
  return wordEditDistance(refWords, hypWords) / refWords.length;
}

export function formatWER(wer: number | null | undefined): string {
  if (wer == null) return 'N/A';
  return `${(wer * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// DER — Diarization Error Rate (NIST standard with collar)
// ---------------------------------------------------------------------------

/**
 * Compute Diarization Error Rate using a frame-based approach at 10 ms resolution.
 *
 * DER = (missed_speech + false_alarm + speaker_error) / total_ref_speech_time
 *
 * Collar regions (default 250 ms) around every reference speaker boundary
 * are excluded from scoring — this is the NIST-standard practice.
 *
 * Speaker mapping is solved greedily: the hyp→ref pair with the highest
 * frame overlap is committed first, then the next, and so on.
 *
 * Can exceed 1.0 when false alarms are large.
 */
export function computeDER(
  reference: DiarizationSegment[],
  hypothesis: DiarizationSegment[],
  audioDurationSec: number,
  collar = 0.25,
): number {
  if (reference.length === 0 || audioDurationSec <= 0) return 0;

  const RES = 0.01; // 10 ms per frame
  const frames = Math.ceil(audioDurationSec / RES);
  const collarFrames = Math.ceil(collar / RES);

  // Fill ref/hyp frame arrays. -1 = silence.
  const refFrame = new Int16Array(frames).fill(-1);
  const hypFrame = new Int16Array(frames).fill(-1);
  const excluded = new Uint8Array(frames);

  for (const seg of reference) {
    const s = Math.floor(seg.startSec / RES);
    const e = Math.min(Math.ceil(seg.endSec / RES), frames);
    for (let i = s; i < e; i++) refFrame[i] = seg.speakerId;
  }
  for (const seg of hypothesis) {
    const s = Math.floor(seg.startSec / RES);
    const e = Math.min(Math.ceil(seg.endSec / RES), frames);
    for (let i = s; i < e; i++) hypFrame[i] = seg.speakerId;
  }

  // Exclude collar around every reference boundary.
  const applyCollar = (sec: number) => {
    const f = Math.round(sec / RES);
    const lo = Math.max(0, f - collarFrames);
    const hi = Math.min(frames, f + collarFrames);
    for (let i = lo; i < hi; i++) excluded[i] = 1;
  };
  for (const seg of reference) {
    applyCollar(seg.startSec);
    applyCollar(seg.endSec);
  }

  // Count co-occurring frames per (refSpk, hypSpk) pair.
  const refSpeakers = [...new Set(reference.map(s => s.speakerId))];
  const hypSpeakers = [...new Set(hypothesis.map(s => s.speakerId))];
  const overlaps = new Map<number, Map<number, number>>();
  for (const rs of refSpeakers) overlaps.set(rs, new Map(hypSpeakers.map(hs => [hs, 0])));

  for (let i = 0; i < frames; i++) {
    if (excluded[i]) continue;
    const r = refFrame[i], h = hypFrame[i];
    if (r >= 0 && h >= 0) {
      const row = overlaps.get(r);
      if (row) row.set(h, (row.get(h) ?? 0) + 1);
    }
  }

  // Greedy optimal speaker mapping (hyp → ref).
  const mapping = new Map<number, number>();
  const usedRef = new Set<number>();
  const pairs: [number, number, number][] = [];
  for (const rs of refSpeakers)
    for (const hs of hypSpeakers)
      pairs.push([rs, hs, overlaps.get(rs)?.get(hs) ?? 0]);
  pairs.sort((a, b) => b[2] - a[2]);
  for (const [rs, hs] of pairs) {
    if (!usedRef.has(rs) && !mapping.has(hs)) {
      mapping.set(hs, rs);
      usedRef.add(rs);
    }
  }

  // Tally error components.
  let totalRef = 0, missed = 0, falseAlarm = 0, speakerError = 0;
  for (let i = 0; i < frames; i++) {
    if (excluded[i]) continue;
    const r = refFrame[i], h = hypFrame[i];
    if (r >= 0) totalRef++;
    if      (r >= 0 && h < 0)                           missed++;
    else if (r < 0  && h >= 0)                          falseAlarm++;
    else if (r >= 0 && h >= 0 && mapping.get(h) !== r)  speakerError++;
  }

  if (totalRef === 0) return 0;
  return (missed + falseAlarm + speakerError) / totalRef;
}

export function formatDER(der: number | null | undefined): string {
  if (der == null) return 'N/A';
  return `${(der * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Battery
// ---------------------------------------------------------------------------

/**
 * Returns the current battery level as a percentage (0–100) or null if
 * unavailable. Works on iOS and Android via expo-battery.
 */
export async function getBatteryLevel(): Promise<number | null> {
  try {
    const level = await Battery.getBatteryLevelAsync();
    return level >= 0 ? level * 100 : null;
  } catch {
    return null;
  }
}

/**
 * Returns true if iOS Low Power Mode or Android Battery Saver is active.
 * When true, the CPU is throttled and benchmark results will be slower
 * than under normal conditions — show a warning before running.
 */
export async function isLowPowerModeEnabled(): Promise<boolean> {
  try {
    const state = await Battery.getPowerStateAsync();
    return state.lowPowerMode ?? false;
  } catch {
    return false;
  }
}

export function formatBatteryDrain(pct: number | null | undefined): string {
  if (pct == null) return 'N/A';
  if (pct < 0.05) return '<0.1%';
  return `${pct.toFixed(1)}%`;
}
