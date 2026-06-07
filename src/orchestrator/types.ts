import { DiarizationSegment } from '../types/benchmark';
import { CostAnalysis } from './pricing';

export type NetworkQuality = 'offline' | 'poor' | 'fair' | 'good';
export type RoutingTarget = 'edge' | 'cloud';
export type UserTier = 'free' | 'premium';
export type TaskType = 'stt' | 'diarization';

export type RoutingReason =
  | 'offline'
  | 'cloud-unreachable'
  | 'battery-critical'
  | 'low-power-mode'
  | 'premium-user'
  | 'heavy-task'
  | 'low-confidence'
  | 'network-poor'
  | 'edge-sufficient'
  | 'privacy-mode';

export interface DeviceContext {
  networkConnected: boolean;
  networkQuality: NetworkQuality;
  batteryPct: number | null;
  lowPowerMode: boolean;
  cloudReachable: boolean;
  /** Round-trip latency to backend /health in ms, null if unreachable. */
  networkLatencyMs: number | null;
}

export interface RoutingDecision {
  target: RoutingTarget;
  reason: RoutingReason;
  explanation: string;
}

export interface OrchestratorConfig {
  task: TaskType;
  userTier: UserTier;
  privacyMode: boolean;
  backendUrl: string;
  cloudProvider: string;
  /**
   * WER threshold for post-edge escalation (0 = disabled).
   * If edge WER exceeds this value and cloud is reachable, re-run on cloud.
   */
  confidenceThreshold: number;
  /**
   * When true: run both edge and cloud regardless of routing decision,
   * then compare results to evaluate whether the policy chose correctly.
   */
  benchmarkMode: boolean;
}

/** Which path was objectively better, based on measured metrics. */
export type BenchmarkVerdict =
  | 'edge-faster-and-accurate'
  | 'edge-faster-worse-accuracy'
  | 'cloud-faster-and-accurate'
  | 'cloud-faster-worse-accuracy'
  | 'no-reference';         // can't judge accuracy without a reference file

export interface BenchmarkComparison {
  edgeLatencyMs: number;
  cloudLatencyMs: number;
  /** Positive = edge was faster, negative = cloud was faster. */
  latencyDeltaMs: number;
  edgeAccuracy: number | null;   // WER or DER (lower is better)
  cloudAccuracy: number | null;
  routedTo: RoutingTarget;
  verdict: BenchmarkVerdict;
  /** True if the routing policy picked the objectively better path. */
  policyWasCorrect: boolean | null;
}

export interface PartialResult {
  transcript?: string;
  segments?: DiarizationSegment[];
  latencyMs: number;
  wer?: number;
  der?: number;
}

export interface OrchestratorRunResult {
  deviceContext: DeviceContext;
  decision: RoutingDecision;
  /** Set when edge ran first and WER exceeded the threshold. */
  escalation?: RoutingDecision;
  edgeResult?: PartialResult;
  cloudResult?: PartialResult;
  finalTranscript?: string;
  finalSegments?: DiarizationSegment[];
  totalLatencyMs: number;
  /** Only present when config.benchmarkMode was true. */
  benchmark?: BenchmarkComparison;
  /** Cost breakdown for this run. */
  cost?: CostAnalysis;
}
