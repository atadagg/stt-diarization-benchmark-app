import React, { useState, useCallback, useEffect } from 'react';
import { ScrollView, View, Text, StyleSheet, Alert, TouchableOpacity, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { initWhisper } from 'whisper.rn';

import ModelCard, { ModelDownloadState } from '../components/ModelCard';
import AudioSelector from '../components/AudioSelector';
import { COLORS, FONTS } from '../components/theme';
import { STT_MODELS } from '../constants/models';
import { BenchmarkResult, AudioFile } from '../types/benchmark';
import { computeRTF, snapMemoryMB, memoryDeltaMB, computeWER, getBatteryLevel, isLowPowerModeEnabled } from '../utils/metrics';
import { loadAmiMeeting } from '../utils/amiLoader';
import {
  isModelReady,
  downloadModel,
  WHISPER_PATHS,
  uriToPath,
  DownloadableModelId,
} from '../utils/modelManager';

interface Props {
  audioFile: AudioFile | null;
  onAudioFileChange: (file: AudioFile | null) => void;
}

type ResultsMap = Record<string, BenchmarkResult>;
type DownloadMap = Record<string, ModelDownloadState>;

const DOWNLOADABLE_IDS: DownloadableModelId[] = ['whisper-tiny', 'whisper-small-en'];

const initialResult = (modelId: string): BenchmarkResult => ({
  modelId,
  status: 'idle',
  latencyMs: null,
  rtf: null,
  peakMemoryMB: null,
  errorMessage: null,
});

export default function STTScreen({ audioFile, onAudioFileChange }: Props) {
  const [results, setResults] = useState<ResultsMap>({});
  const [downloads, setDownloads] = useState<DownloadMap>(() =>
    Object.fromEntries(DOWNLOADABLE_IDS.map((id) => [id, { status: 'checking', progress: 0 }]))
  );
  const [loadingMeeting, setLoadingMeeting] = useState(false);
  const [lowPowerMode, setLowPowerMode] = useState(false);

  useEffect(() => {
    isLowPowerModeEnabled().then(setLowPowerMode);
  }, []);

  const anyRunning = Object.values(results).some((r) => r.status === 'running');
  const anyDownloading = Object.values(downloads).some((d) => d.status === 'downloading');
  const busy = anyRunning || anyDownloading || loadingMeeting;

  // ---------------------------------------------------------------------------
  // Check which models are already downloaded on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    (async () => {
      const checks = await Promise.all(
        DOWNLOADABLE_IDS.map(async (id) => [id, await isModelReady(id)] as const)
      );
      setDownloads((prev) => {
        const next = { ...prev };
        for (const [id, ready] of checks) {
          next[id] = { status: ready ? 'ready' : 'not-downloaded', progress: 0 };
        }
        return next;
      });
    })();
  }, []);

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
  // Download a model
  // ---------------------------------------------------------------------------

  const handleDownload = useCallback(async (modelId: string) => {
    const id = modelId as DownloadableModelId;
    setDownloads((prev) => ({ ...prev, [id]: { status: 'downloading', progress: 0 } }));
    try {
      await downloadModel(id, ({ percent }) => {
        setDownloads((prev) => ({ ...prev, [id]: { status: 'downloading', progress: percent } }));
      });
      setDownloads((prev) => ({ ...prev, [id]: { status: 'ready', progress: 100 } }));
    } catch (err: unknown) {
      Alert.alert('Download failed', String(err));
      setDownloads((prev) => ({ ...prev, [id]: { status: 'not-downloaded', progress: 0 } }));
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Generic benchmark harness
  // ---------------------------------------------------------------------------

  const runBenchmark = useCallback(
    async (
      modelId: string,
      inferFn: () => Promise<{ transcript: string }>,
    ) => {
      if (!audioFile) {
        Alert.alert('No file', 'Pick an audio file first.');
        return;
      }

      setResults((prev) => ({
        ...prev,
        [modelId]: { ...initialResult(modelId), status: 'running' },
      }));

      const memBefore = snapMemoryMB();
      const batteryBefore = await getBatteryLevel();
      const wallStart = Date.now();

      try {
        const { transcript } = await inferFn();
        const latencyMs = Date.now() - wallStart;
        const memAfter = snapMemoryMB();
        const batteryAfter = await getBatteryLevel();
        const wer = audioFile.referenceTranscript != null
          ? computeWER(audioFile.referenceTranscript, transcript)
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
            rtf: computeRTF(latencyMs, audioFile.durationSeconds),
            peakMemoryMB: memoryDeltaMB(memBefore, memAfter),
            errorMessage: null,
            transcript,
            wer,
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
    },
    [audioFile],
  );

  // ---------------------------------------------------------------------------
  // Whisper tiny
  // ---------------------------------------------------------------------------

  const runWhisperTiny = useCallback(async () => {
    await runBenchmark('whisper-tiny', async () => {
      const ctx = await initWhisper({ filePath: WHISPER_PATHS['whisper-tiny'] });
      const { promise } = ctx.transcribe(uriToPath(audioFile!.uri), { language: 'en' });
      const { result } = await promise;
      await ctx.release();
      return { transcript: result };
    });
  }, [runBenchmark, audioFile]);

  // ---------------------------------------------------------------------------
  // Whisper small.en
  // ---------------------------------------------------------------------------

  const runWhisperSmall = useCallback(async () => {
    await runBenchmark('whisper-small-en', async () => {
      const ctx = await initWhisper({ filePath: WHISPER_PATHS['whisper-small-en'] });
      const { promise } = ctx.transcribe(uriToPath(audioFile!.uri), { language: 'en' });
      const { result } = await promise;
      await ctx.release();
      return { transcript: result };
    });
  }, [runBenchmark, audioFile]);

  // ---------------------------------------------------------------------------
  // Dispatch
  // ---------------------------------------------------------------------------

  const handleRun = useCallback(
    (modelId: string) => {
      switch (modelId) {
        case 'whisper-tiny':     return runWhisperTiny();
        case 'whisper-small-en': return runWhisperSmall();
        default: Alert.alert('Unknown model', modelId);
      }
    },
    [runWhisperTiny, runWhisperSmall],
  );

  // ---------------------------------------------------------------------------
  // Run all ready models sequentially
  // ---------------------------------------------------------------------------

  const handleRunAll = useCallback(async () => {
    if (!audioFile) {
      Alert.alert('No file', 'Pick an audio file first.');
      return;
    }
    const queue: Array<() => Promise<void>> = [];
    if (downloads['whisper-tiny']?.status === 'ready') queue.push(runWhisperTiny);
    if (downloads['whisper-small-en']?.status === 'ready') queue.push(runWhisperSmall);
    if (queue.length === 0) {
      Alert.alert('No models ready', 'Download at least one model first.');
      return;
    }
    for (const fn of queue) await fn();
  }, [audioFile, downloads, runWhisperTiny, runWhisperSmall]);

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
      '=== STT BENCHMARK RESULTS ===',
      `Audio  : ${audioFile?.filename ?? '?'} (${audioFile?.durationSeconds?.toFixed(1) ?? '?'}s)`,
      `Date   : ${new Date().toISOString()}`,
      '',
    ];

    for (const model of STT_MODELS) {
      const r = results[model.id];
      if (!r || r.status === 'idle') continue;
      lines.push(`--- ${model.name} ---`);
      lines.push(`Status : ${r.status}`);
      if (r.latencyMs != null)      lines.push(`Latency: ${r.latencyMs} ms`);
      if (r.rtf != null)            lines.push(`RTF    : ${r.rtf.toFixed(3)}`);
      if (r.peakMemoryMB != null)   lines.push(`Memory : ${r.peakMemoryMB.toFixed(1)} MB`);
      if (r.wer != null)            lines.push(`WER    : ${(r.wer * 100).toFixed(1)}%`);
      if (r.batteryDrainPct != null) lines.push(`Battery: -${r.batteryDrainPct.toFixed(2)}%`);
      if (r.errorMessage)           lines.push(`Error  : ${r.errorMessage}`);
      if (r.transcript)             lines.push(`Transcript (200 chars): ${r.transcript.slice(0, 200)}`);
      lines.push('');
    }

    const text = lines.join('\n');
    console.log('[STT_BENCHMARK_EXPORT]\n' + JSON.stringify(
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
        <Text style={styles.screenTitle}>STT BENCHMARK</Text>

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

        {STT_MODELS.map((model) => (
          <ModelCard
            key={model.id}
            model={model}
            result={results[model.id] ?? null}
            onRun={handleRun}
            onDownload={handleDownload}
            downloadState={downloads[model.id]}
            disabled={busy}
          />
        ))}

        <View style={styles.footer}>
          <Text style={styles.footerText}>RTF {'<'} 1 = faster than real-time.</Text>
          <Text style={styles.footerText}>Tap GET to download a model first.</Text>
        </View>
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
  footer:      { marginTop: 16, gap: 4 },
  footerText:  {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.muted,
    letterSpacing: 0.5,
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
