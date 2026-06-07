import * as Battery from 'expo-battery';
import { DeviceContext, NetworkQuality } from './types';

interface ReachabilityResult {
  reachable: boolean;
  quality: NetworkQuality;
  latencyMs: number | null;
}

async function checkReachability(backendUrl: string): Promise<ReachabilityResult> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${backendUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    if (!response.ok) return { reachable: false, quality: 'offline', latencyMs: null };
    const quality: NetworkQuality =
      latencyMs < 150 ? 'good' : latencyMs < 600 ? 'fair' : 'poor';
    return { reachable: true, quality, latencyMs };
  } catch {
    return { reachable: false, quality: 'offline', latencyMs: null };
  }
}

export async function gatherDeviceContext(backendUrl: string): Promise<DeviceContext> {
  const [levelResult, powerResult, reachResult] = await Promise.allSettled([
    Battery.getBatteryLevelAsync(),
    Battery.getPowerStateAsync(),
    checkReachability(backendUrl),
  ]);

  const batteryPct =
    levelResult.status === 'fulfilled' && levelResult.value >= 0
      ? levelResult.value * 100
      : null;

  const lowPowerMode =
    powerResult.status === 'fulfilled'
      ? (powerResult.value.lowPowerMode ?? false)
      : false;

  const reach: ReachabilityResult =
    reachResult.status === 'fulfilled'
      ? reachResult.value
      : { reachable: false, quality: 'offline', latencyMs: null };

  return {
    batteryPct,
    lowPowerMode,
    networkConnected: reach.reachable,
    networkQuality: reach.quality,
    cloudReachable: reach.reachable,
    networkLatencyMs: reach.latencyMs,
  };
}
