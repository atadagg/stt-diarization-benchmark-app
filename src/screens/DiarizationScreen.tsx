import React, { useState, useCallback, useEffect } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  Alert,
  TouchableOpacity,
  Share,
  NativeModules,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ModelCard, { ModelDownloadState } from '../components/ModelCard';
import AudioSelector from '../components/AudioSelector';
import { COLORS, FONTS } from '../components/theme';
import { DIARIZATION_MODELS } from '../constants/models';
import { BenchmarkResult, DiarizationSegment, AudioFile } from '../types/benchmark';
import {
  computeRTF,
  snapMemoryMB,
  memoryDeltaMB,
  computeDER,
  getBatteryLevel,
  isLowPowerModeEnabled,
} from '../utils/metrics';
import { loadAmiMeeting } from '../utils/amiLoader';
import {
  uriToPath,
  isDiarizationModelReady,
  downloadPyannoteSegmentation,
  downloadEmbeddingModel,
  PYANNOTE_SEG_MODEL_PATH,
  embeddingPath,
  DownloadProgress,
} from '../utils/modelManager';

const { SherpaOnnxDiarizationModule } = NativeModules;

interface Props {
  audioFile: AudioFile | null;
  onAudioFileChange: (file: AudioFile | null) => void;
}

type ResultsMap = Record<string, BenchmarkResult>;
type ReadinessMap = Record<string, boolean>;

const initialResult = (modelId: string): BenchmarkResult => ({
  modelId,
  status: 'idle',
  latencyMs: null,
  rtf: null,
  peakMemoryMB: null,
  errorMessage: null,
});

export default function DiarizationScreen({ audioFile, onAudioFileChange }: Props) {
  const [results, setResults]             = useState<ResultsMap>({});
  const [loadingMeeting, setLoadingMeeting] = useState(false);
  const [lowPowerMode, setLowPowerMode]   = useState(false);
  const [readiness, setReadiness]     = useState<ReadinessMap>({});
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});

  useEffect(() => {
    isLowPowerModeEnabled().then(setLowPowerMode);
    _refreshReadiness();
  }, []);

  const _refreshReadiness = useCallback(async () => {
    const entries = await Promise.all(
      DIARIZATION_MODELS.map(async (m) => [m.id, await isDiarizationModelReady(m.embeddingKey)] as const),
    );
    setReadiness(Object.fromEntries(entries));
  }, []);

  const anyRunning = Object.values(results).some((r) => r.status === 'running');
  const anyDownloading = Object.keys(downloadProgress).length > 0;
  const busy = anyRunning || anyDownloading || loadingMeeting;

  // ---------------------------------------------------------------------------
  // AMI meeting selector
  // ---------------------------------------------------------------------------

  const handleSelectMeeting = useCallback(async (meetingId: string) => {
    setLoadingMeeting(true);
    try {
      const file = await loadAmiMeeting(meetingId);
      onAudioFileChange(file);
      setResults({});
    } catch (err: unknown) {
      Alert.alert('Error loading meeting', String(err));
    } finally {
      setLoadingMeeting(false);
    }
  }, [onAudioFileChange]);

  // ---------------------------------------------------------------------------
  // Download helper
  // ---------------------------------------------------------------------------

  const _download = useCallback(async (modelId: string, embeddingKey: string) => {
    const setP = (label: string, p: DownloadProgress) => {
      setDownloadProgress((prev) => ({ ...prev, [`${modelId}:${label}`]: p.percent }));
    };

    // Download shared segmentation model if needed
    await downloadPyannoteSegmentation((p) => setP('seg', p));

    // Download embedding model
    await downloadEmbeddingModel(embeddingKey, (p) => setP('emb', p));

    setDownloadProgress((prev) => {
      const next = { ...prev };
      delete next[`${modelId}:seg`];
      delete next[`${modelId}:emb`];
      return next;
    });

    await _refreshReadiness();
  }, [_refreshReadiness]);

  // ---------------------------------------------------------------------------
  // Run benchmark
  // ---------------------------------------------------------------------------

  const handleRun = useCallback(async (modelId: string) => {
    if (!audioFile) {
      Alert.alert('No file', 'Pick an audio file first.');
      return;
    }

    const model = DIARIZATION_MODELS.find((m) => m.id === modelId);
    if (!model) return;

    // Download models if needed
    if (!readiness[modelId]) {
      try {
        setResults((prev) => ({
          ...prev,
          [modelId]: { ...initialResult(modelId), status: 'running', errorMessage: 'Downloading models…' },
        }));
        await _download(modelId, model.embeddingKey);
      } catch (err: unknown) {
        setResults((prev) => ({
          ...prev,
          [modelId]: {
            ...initialResult(modelId),
            status: 'error',
            errorMessage: `Download failed: ${String(err)}`,
          },
        }));
        return;
      }
    }

    setResults((prev) => ({
      ...prev,
      [modelId]: { ...initialResult(modelId), status: 'running' },
    }));

    const memBefore     = snapMemoryMB();
    const batteryBefore = await getBatteryLevel();
    const wallStart     = Date.now();

    try {
      const rawSegments: { start: number; end: number; speaker: number }[] =
        await SherpaOnnxDiarizationModule.runDiarization(
          PYANNOTE_SEG_MODEL_PATH,
          embeddingPath(model.embeddingKey),
          uriToPath(audioFile.uri),
          0,    // numSpeakers = 0 → use threshold
          0.5,  // threshold
        );

      const latencyMs  = Date.now() - wallStart;
      const memAfter   = snapMemoryMB();
      const batteryAfter = await getBatteryLevel();

      const segments: DiarizationSegment[] = rawSegments.map((s) => ({
        speakerId: s.speaker,
        startSec:  s.start,
        endSec:    s.end,
      }));

      const der = audioFile.referenceDiarization != null
        ? computeDER(audioFile.referenceDiarization, segments, audioFile.durationSeconds)
        : undefined;

      const batteryDrainPct =
        batteryBefore != null && batteryAfter != null
          ? Math.max(0, batteryBefore - batteryAfter)
          : undefined;

      setResults((prev) => ({
        ...prev,
        [modelId]: {
          modelId,
          status: 'done',
          latencyMs,
          rtf:          computeRTF(latencyMs, audioFile.durationSeconds),
          peakMemoryMB: memoryDeltaMB(memBefore, memAfter),
          errorMessage: null,
          segments,
          der,
          batteryDrainPct,
        },
      }));
    } catch (err: unknown) {
      setResults((prev) => ({
        ...prev,
        [modelId]: {
          modelId,
          status: 'error',
          latencyMs: Date.now() - wallStart,
          rtf: null,
          peakMemoryMB: null,
          errorMessage: String(err),
        },
      }));
    }
  }, [audioFile, readiness, _download]);

  // ---------------------------------------------------------------------------
  // Run all ready models sequentially
  // ---------------------------------------------------------------------------

  const handleRunAll = useCallback(async () => {
    if (!audioFile) {
      Alert.alert('No file', 'Pick an audio file first.');
      return;
    }
    const readyModels = DIARIZATION_MODELS.filter((m) => readiness[m.id]);
    if (readyModels.length === 0) {
      Alert.alert('No models ready', 'Download at least one diarization model first.');
      return;
    }
    for (const model of readyModels) await handleRun(model.id);
  }, [audioFile, readiness, handleRun]);

  // ---------------------------------------------------------------------------
  // Export results dump
  // ---------------------------------------------------------------------------

  const handleExport = useCallback(() => {
    const done = Object.values(results).filter((r) => r.status !== 'idle');
    if (done.length === 0) {
      Alert.alert('No results', 'Run at least one model first.');
      return;
    }

    const lines: string[] = [
      '=== DIARIZATION BENCHMARK RESULTS ===',
      `Audio  : ${audioFile?.filename ?? '?'} (${audioFile?.durationSeconds?.toFixed(1) ?? '?'}s)`,
      `Date   : ${new Date().toISOString()}`,
      '',
    ];

    for (const model of DIARIZATION_MODELS) {
      const r = results[model.id];
      if (!r || r.status === 'idle') continue;
      lines.push(`--- ${model.name} ---`);
      lines.push(`Status : ${r.status}`);
      if (r.latencyMs != null)       lines.push(`Latency: ${r.latencyMs} ms`);
      if (r.rtf != null)             lines.push(`RTF    : ${r.rtf.toFixed(3)}`);
      if (r.peakMemoryMB != null)    lines.push(`Memory : ${r.peakMemoryMB.toFixed(1)} MB`);
      if (r.der != null)             lines.push(`DER    : ${(r.der * 100).toFixed(1)}%`);
      if (r.batteryDrainPct != null) lines.push(`Battery: -${r.batteryDrainPct.toFixed(2)}%`);
      if (r.segments?.length)        lines.push(`Segments: ${r.segments.length}`);
      if (r.errorMessage)            lines.push(`Error  : ${r.errorMessage}`);
      lines.push('');
    }

    const text = lines.join('\n');
    console.log('[DIARIZATION_BENCHMARK_EXPORT]\n' + JSON.stringify(
      { audio: audioFile?.filename, durationSeconds: audioFile?.durationSeconds, results },
      null, 2,
    ));
    Share.share({ message: text });
  }, [results, audioFile]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.screenTitle}>DIARIZATION BENCHMARK</Text>

        {lowPowerMode && (
          <View style={styles.lowPowerBanner}>
            <Text style={styles.lowPowerText}>
              LOW POWER / BATTERY SAVER active — CPU is throttled. Results will be slower than normal.
            </Text>
          </View>
        )}

        <AudioSelector
          audioFile={audioFile}
          onSelectMeeting={handleSelectMeeting}
          loading={loadingMeeting}
        />

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionButton, busy && styles.actionButtonDisabled]}
            onPress={handleRunAll}
            disabled={busy}
            activeOpacity={0.7}
          >
            <Text style={[styles.actionButtonText, busy && styles.actionButtonTextDisabled]}>
              RUN ALL
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={handleExport}
            activeOpacity={0.7}
          >
            <Text style={styles.actionButtonText}>EXPORT</Text>
          </TouchableOpacity>
        </View>

        {DIARIZATION_MODELS.map((model) => {
          const dlKeys = Object.keys(downloadProgress).filter((k) => k.startsWith(`${model.id}:`));
          const isDownloading = dlKeys.length > 0;
          const dlPercent = isDownloading
            ? Math.min(...dlKeys.map((k) => downloadProgress[k]))
            : 0;

          let dlState: ModelDownloadState;
          if (isDownloading) {
            dlState = { status: 'downloading', progress: dlPercent };
          } else if (readiness[model.id] == null) {
            dlState = { status: 'checking', progress: 0 };
          } else if (readiness[model.id]) {
            dlState = { status: 'ready', progress: 100 };
          } else {
            dlState = { status: 'not-downloaded', progress: 0 };
          }

          return (
            <ModelCard
              key={model.id}
              model={model}
              result={results[model.id] ?? null}
              onRun={handleRun}
              disabled={anyRunning || loadingMeeting || audioFile == null}
              downloadState={dlState}
              onDownload={handleRun}
            />
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea:    { flex: 1, backgroundColor: COLORS.bg },
  scroll:      { flex: 1 },
  content:     { padding: 16, paddingBottom: 40 },
  screenTitle: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.muted,
    letterSpacing: 2,
    marginBottom: 14,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  actionButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: 4,
    paddingVertical: 8,
    alignItems: 'center',
  },
  actionButtonDisabled: {
    borderColor: COLORS.border,
  },
  actionButtonText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: COLORS.accent,
    letterSpacing: 1.5,
  },
  actionButtonTextDisabled: {
    color: COLORS.muted,
  },
  lowPowerBanner: {
    borderWidth: 1,
    borderColor: COLORS.error,
    borderRadius: 4,
    padding: 10,
    marginBottom: 14,
  },
  lowPowerText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.error,
    letterSpacing: 0.3,
  },
});
