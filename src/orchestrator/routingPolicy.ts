import { DeviceContext, OrchestratorConfig, RoutingDecision, RoutingReason } from './types';

function edge(reason: RoutingReason, explanation: string): RoutingDecision {
  return { target: 'edge', reason, explanation };
}

function cloud(reason: RoutingReason, explanation: string): RoutingDecision {
  return { target: 'cloud', reason, explanation };
}

/**
 * Routing policy for the edge-cloud continuum.
 *
 * Evaluated top-to-bottom; first matching rule wins.
 *
 * Priority order:
 *  1. Connectivity — cloud is physically unreachable
 *  2. Network quality — too slow to upload/download in time
 *  3. Privacy override — user explicitly wants local processing
 *  4. Premium user — always gets cloud accuracy
 *  5. Battery critical — offload to spare device power
 *  6. Low Power Mode — CPU is throttled; cloud is faster
 *  7. Task weight — diarization is too heavy for real-time edge
 *  8. Default — edge is sufficient
 */
export function decide(ctx: DeviceContext, config: OrchestratorConfig): RoutingDecision {
  if (!ctx.networkConnected || !ctx.cloudReachable) {
    return edge('offline', 'Cloud unreachable — processing on device.');
  }

  if (ctx.networkQuality === 'poor') {
    return edge(
      'network-poor',
      `Network latency ${ctx.networkLatencyMs ?? '?'} ms — too slow for cloud round-trip.`,
    );
  }

  if (config.privacyMode) {
    return edge('privacy-mode', 'Privacy mode enabled — audio stays on device.');
  }

  if (config.userTier === 'premium') {
    return cloud('premium-user', 'Premium tier — routing to cloud for highest accuracy.');
  }

  if (ctx.batteryPct != null && ctx.batteryPct < 15) {
    return cloud(
      'battery-critical',
      `Battery at ${ctx.batteryPct.toFixed(0)}% — offloading to preserve device power.`,
    );
  }

  if (ctx.lowPowerMode) {
    return cloud('low-power-mode', 'Low Power Mode active — CPU throttled, cloud is faster.');
  }

  if (config.task === 'diarization') {
    return cloud('heavy-task', 'Speaker diarization is compute-intensive — routing to cloud.');
  }

  return edge('edge-sufficient', 'Conditions favorable — on-device inference is sufficient.');
}

/**
 * Post-edge escalation check.
 * Returns a cloud decision if edge WER exceeded the threshold; null otherwise.
 * Only fires when: threshold > 0, WER is measurable, and cloud is reachable.
 */
export function shouldEscalate(
  edgeWer: number,
  config: OrchestratorConfig,
  ctx: DeviceContext,
): RoutingDecision | null {
  if (config.confidenceThreshold <= 0) return null;
  if (!ctx.cloudReachable) return null;
  if (edgeWer > config.confidenceThreshold) {
    return cloud(
      'low-confidence',
      `Edge WER ${(edgeWer * 100).toFixed(1)}% exceeds ${(config.confidenceThreshold * 100).toFixed(0)}% threshold — escalating to cloud.`,
    );
  }
  return null;
}
