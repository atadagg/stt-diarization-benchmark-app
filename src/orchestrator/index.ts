import { initWhisper } from 'whisper.rn';
import { NativeModules } from 'react-native';

import { AudioFile, DiarizationSegment } from '../types/benchmark';
import { computeWER, computeDER } from '../utils/metrics';
import {
  WHISPER_PATHS,
  PYANNOTE_SEG_MODEL_PATH,
  embeddingPath,
  uriToPath,
} from '../utils/modelManager';
import { gatherDeviceContext } from './deviceContext';
import { decide, shouldEscalate } from './routingPolicy';
import { transcribeCloud, diarizeCloud } from './cloudClient';
import {
  BenchmarkComparison,
  BenchmarkVerdict,
  OrchestratorConfig,
  OrchestratorRunResult,
  PartialResult,
  RoutingTarget,
} from './types';
import { computeCost } from './pricing';

const { SherpaOnnxDiarizationModule } = NativeModules;

const EDGE_STT_MODEL_ID = 'whisper-tiny' as const;
const EDGE_DIARIZATION_EMBEDDING = 'speakernet';

async function runEdgeSTT(audioFile: AudioFile): Promise<PartialResult> {
  const start = Date.now();
  const ctx = await initWhisper({ filePath: WHISPER_PATHS[EDGE_STT_MODEL_ID] });
  const { promise } = ctx.transcribe(uriToPath(audioFile.uri), { language: 'en' });
  const { result } = await promise;
  await ctx.release();
  const latencyMs = Date.now() - start;
  const wer =
    audioFile.referenceTranscript != null
      ? computeWER(audioFile.referenceTranscript, result)
      : undefined;
  return { transcript: result, latencyMs, wer };
}

async function runEdgeDiarization(audioFile: AudioFile): Promise<PartialResult> {
  const start = Date.now();
  const rawSegments: { start: number; end: number; speaker: number }[] =
    await SherpaOnnxDiarizationModule.runDiarization(
      PYANNOTE_SEG_MODEL_PATH,
      embeddingPath(EDGE_DIARIZATION_EMBEDDING),
      uriToPath(audioFile.uri),
      0,    // numSpeakers = 0 → use threshold
      0.5,  // clustering threshold
    );
  const latencyMs = Date.now() - start;
  const segments: DiarizationSegment[] = rawSegments.map((s) => ({
    speakerId: s.speaker,
    startSec: s.start,
    endSec: s.end,
  }));
  const der =
    audioFile.referenceDiarization != null
      ? computeDER(audioFile.referenceDiarization, segments, audioFile.durationSeconds)
      : undefined;
  return { segments, latencyMs, der };
}

async function runCloud(
  audioFile: AudioFile,
  config: OrchestratorConfig,
): Promise<PartialResult> {
  if (config.task === 'stt') {
    const { transcript, latencyMs } = await transcribeCloud(
      audioFile.uri,
      config.cloudProvider,
      audioFile.durationSeconds,
      config.backendUrl,
    );
    const wer =
      audioFile.referenceTranscript != null
        ? computeWER(audioFile.referenceTranscript, transcript)
        : undefined;
    return { transcript, latencyMs, wer };
  }

  const { segments, latencyMs } = await diarizeCloud(
    audioFile.uri,
    config.cloudProvider,
    audioFile.durationSeconds,
    config.backendUrl,
  );
  const der =
    audioFile.referenceDiarization != null
      ? computeDER(audioFile.referenceDiarization, segments, audioFile.durationSeconds)
      : undefined;
  return { segments, latencyMs, der };
}

function buildBenchmark(
  edge: PartialResult,
  cloud: PartialResult,
  routedTo: RoutingTarget,
): BenchmarkComparison {
  const latencyDeltaMs = cloud.latencyMs - edge.latencyMs; // positive = edge faster
  const edgeAcc  = edge.wer  ?? edge.der  ?? null;
  const cloudAcc = cloud.wer ?? cloud.der ?? null;

  let verdict: BenchmarkVerdict;
  let policyWasCorrect: boolean | null = null;

  if (edgeAcc == null || cloudAcc == null) {
    verdict = 'no-reference';
  } else {
    const edgeFaster   = latencyDeltaMs > 0;
    const edgeAccurate = edgeAcc <= cloudAcc;

    if (edgeFaster && edgeAccurate)  verdict = 'edge-faster-and-accurate';
    else if (edgeFaster)             verdict = 'edge-faster-worse-accuracy';
    else if (edgeAccurate)           verdict = 'cloud-faster-worse-accuracy';
    else                             verdict = 'cloud-faster-and-accurate';

    // Policy was correct if it routed to the path that was both faster AND more accurate.
    // When the two metrics disagree, we call it a trade-off (null).
    if (verdict === 'edge-faster-and-accurate')  policyWasCorrect = routedTo === 'edge';
    else if (verdict === 'cloud-faster-and-accurate') policyWasCorrect = routedTo === 'cloud';
    else policyWasCorrect = null; // trade-off — no single "correct" answer
  }

  return {
    edgeLatencyMs:  edge.latencyMs,
    cloudLatencyMs: cloud.latencyMs,
    latencyDeltaMs,
    edgeAccuracy:   edgeAcc,
    cloudAccuracy:  cloudAcc,
    routedTo,
    verdict,
    policyWasCorrect,
  };
}

/**
 * Main orchestrator entry point.
 *
 * 1. Gather real-time device context (battery, network, cloud reachability).
 * 2. Apply routing policy → edge or cloud.
 * 3. Execute the chosen path (or both paths in benchmark mode).
 * 4. If edge ran and WER exceeded the confidence threshold → escalate to cloud.
 * 5. Return a full trace of every decision and result.
 */
export async function runOrchestrator(
  audioFile: AudioFile,
  config: OrchestratorConfig,
): Promise<OrchestratorRunResult> {
  const totalStart = Date.now();

  const deviceContext = await gatherDeviceContext(config.backendUrl);
  const decision = decide(deviceContext, config);

  let edgeResult: PartialResult | undefined;
  let cloudResult: PartialResult | undefined;
  let escalation: OrchestratorRunResult['escalation'];

  if (config.benchmarkMode) {
    // Run both paths sequentially (edge first, then cloud) and compare.
    const edgeTask  = config.task === 'stt' ? runEdgeSTT(audioFile) : runEdgeDiarization(audioFile);
    edgeResult  = await edgeTask;
    cloudResult = await runCloud(audioFile, config);
  } else if (decision.target === 'edge') {
    edgeResult =
      config.task === 'stt'
        ? await runEdgeSTT(audioFile)
        : await runEdgeDiarization(audioFile);

    // Post-edge escalation: re-run on cloud if WER is too high
    if (edgeResult.wer != null) {
      const maybeEscalate = shouldEscalate(edgeResult.wer, config, deviceContext);
      if (maybeEscalate) {
        escalation = maybeEscalate;
        cloudResult = await runCloud(audioFile, config);
      }
    }
  } else {
    cloudResult = await runCloud(audioFile, config);
  }

  const best = cloudResult ?? edgeResult;

  const benchmark =
    config.benchmarkMode && edgeResult && cloudResult
      ? buildBenchmark(edgeResult, cloudResult, decision.target)
      : undefined;

  const cloudRan = cloudResult != null && !config.benchmarkMode
    ? true
    : config.benchmarkMode
    ? true   // both ran; cloud cost was always incurred
    : false;

  const cost = computeCost(
    audioFile.durationSeconds,
    config.cloudProvider,
    config.task,
    cloudRan,
  );

  return {
    deviceContext,
    decision,
    escalation,
    edgeResult,
    cloudResult,
    finalTranscript: best?.transcript,
    finalSegments: best?.segments,
    totalLatencyMs: Date.now() - totalStart,
    benchmark,
    cost,
  };
}
