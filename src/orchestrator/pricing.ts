/**
 * Cloud API pricing as of mid-2026 (per minute of audio).
 * Sources: Deepgram, AssemblyAI, Google Cloud Speech public pricing pages.
 * These are approximations for free-tier / pay-as-you-go plans.
 */

export interface ProviderPricing {
  sttPerMinute: number;       // USD
  diarizationPerMinute: number;
}

const PRICING: Record<string, ProviderPricing> = {
  deepgram: {
    sttPerMinute:         0.0059,
    diarizationPerMinute: 0.0077,
  },
  assemblyai: {
    sttPerMinute:         0.0065,
    diarizationPerMinute: 0.0100,
  },
  google: {
    sttPerMinute:         0.0060,
    diarizationPerMinute: 0.0090,
  },
};

const FALLBACK: ProviderPricing = { sttPerMinute: 0.006, diarizationPerMinute: 0.009 };

export function getPricing(provider: string): ProviderPricing {
  return PRICING[provider.toLowerCase()] ?? FALLBACK;
}

export interface CostAnalysis {
  /** What this single run cost (or would have cost) on cloud. */
  cloudCostUsd: number;
  /** Cost if everything had gone to cloud (baseline scenario). */
  baselineCostUsd: number;
  /** Savings on this run: 0 when cloud ran, baselineCostUsd when edge ran. */
  savingsUsd: number;
  /** Whether cloud actually ran (cost incurred). */
  cloudRan: boolean;
  /** Projected monthly savings assuming N minutes of audio per day. */
  projectedMonthlySavingsUsd: (minutesPerDay: number) => number;
}

export function computeCost(
  durationSeconds: number,
  provider: string,
  task: 'stt' | 'diarization',
  cloudRan: boolean,
): CostAnalysis {
  const pricing = getPricing(provider);
  const durationMinutes = durationSeconds / 60;
  const ratePerMinute =
    task === 'stt' ? pricing.sttPerMinute : pricing.diarizationPerMinute;

  const baselineCostUsd = durationMinutes * ratePerMinute;
  const cloudCostUsd    = cloudRan ? baselineCostUsd : 0;
  const savingsUsd      = cloudRan ? 0 : baselineCostUsd;

  return {
    cloudCostUsd,
    baselineCostUsd,
    savingsUsd,
    cloudRan,
    projectedMonthlySavingsUsd: (minutesPerDay: number) => {
      // Assume same edge-offload ratio as this single run
      const offloadRatio = cloudRan ? 0 : 1;
      return offloadRatio * minutesPerDay * 30 * ratePerMinute;
    },
  };
}

export function formatUsd(amount: number): string {
  if (amount < 0.0001) return '$0.00';
  if (amount < 0.01)   return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(3)}`;
}
