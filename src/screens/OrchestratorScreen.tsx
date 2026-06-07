import React, { useState, useCallback } from 'react';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { COLORS, FONTS } from '../components/theme';
import AudioSelector from '../components/AudioSelector';
import { AudioFile } from '../types/benchmark';
import { formatLatency, formatWER, formatDER } from '../utils/metrics';
import { loadAmiMeeting } from '../utils/amiLoader';
import { isModelReady } from '../utils/modelManager';
import { gatherDeviceContext } from '../orchestrator/deviceContext';
import { runOrchestrator } from '../orchestrator';
import {
  BenchmarkComparison,
  DeviceContext,
  OrchestratorConfig,
  OrchestratorRunResult,
  RoutingDecision,
  TaskType,
  UserTier,
} from '../orchestrator/types';
import { CostAnalysis, formatUsd } from '../orchestrator/pricing';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Phase =
  | 'idle'
  | 'probing'
  | 'running'
  | 'done'
  | 'error';

interface Props {
  audioFile: AudioFile | null;
  onAudioFileChange: (file: AudioFile | null) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function qualityColor(q: DeviceContext['networkQuality']): string {
  switch (q) {
    case 'good':    return COLORS.done;
    case 'fair':    return '#ffaa00';
    case 'poor':    return COLORS.error;
    case 'offline': return COLORS.muted;
  }
}

function targetColor(target: RoutingDecision['target']): string {
  return target === 'edge' ? '#00aaff' : '#aa44ff';
}

function reasonLabel(reason: RoutingDecision['reason']): string {
  const map: Record<RoutingDecision['reason'], string> = {
    'offline':           'OFFLINE',
    'cloud-unreachable': 'CLOUD UNREACHABLE',
    'battery-critical':  'BATTERY CRITICAL',
    'low-power-mode':    'LOW POWER MODE',
    'premium-user':      'PREMIUM USER',
    'heavy-task':        'HEAVY TASK',
    'low-confidence':    'LOW CONFIDENCE',
    'network-poor':      'NETWORK POOR',
    'edge-sufficient':   'EDGE SUFFICIENT',
    'privacy-mode':      'PRIVACY MODE',
  };
  return map[reason] ?? reason.toUpperCase();
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ToggleButton({
  label,
  active,
  onPress,
  color,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  color?: string;
}) {
  const ac = color ?? COLORS.accent;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.toggle, active && { borderColor: ac, backgroundColor: `${ac}18` }]}
      activeOpacity={0.7}
    >
      <Text style={[styles.toggleText, active && { color: ac }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, valueColor ? { color: valueColor } : undefined]}>
        {value}
      </Text>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionLine} />
    </View>
  );
}

function DecisionBadge({ decision, label }: { decision: RoutingDecision; label?: string }) {
  const tc = targetColor(decision.target);
  return (
    <View style={[styles.decisionBadge, { borderColor: tc }]}>
      <View style={styles.decisionBadgeTop}>
        <Text style={[styles.decisionTarget, { color: tc }]}>
          → {decision.target.toUpperCase()}
        </Text>
        <Text style={[styles.decisionReason, { color: tc }]}>
          {reasonLabel(decision.reason)}
        </Text>
      </View>
      {label && <Text style={styles.decisionLabel}>{label}</Text>}
      <Text style={styles.decisionExplanation}>{decision.explanation}</Text>
    </View>
  );
}

function ResultBlock({ title, result, color }: {
  title: string;
  result: NonNullable<OrchestratorRunResult['edgeResult']>;
  color: string;
}) {
  return (
    <View style={[styles.resultBlock, { borderColor: color }]}>
      <Text style={[styles.resultBlockTitle, { color }]}>{title}</Text>
      <Row label="Latency" value={formatLatency(result.latencyMs)} />
      {result.wer != null && <Row label="WER    " value={formatWER(result.wer)} />}
      {result.der != null && <Row label="DER    " value={formatDER(result.der)} />}
      {result.transcript != null && (
        <View style={styles.transcriptBlock}>
          <Text style={styles.metricLabel}>TRANSCRIPT</Text>
          <Text style={styles.transcriptText} numberOfLines={4}>
            {result.transcript || '(empty)'}
          </Text>
        </View>
      )}
      {result.segments != null && result.segments.length > 0 && (
        <View style={styles.transcriptBlock}>
          <Text style={styles.metricLabel}>SEGMENTS ({result.segments.length})</Text>
          {result.segments.slice(0, 4).map((seg, i) => (
            <Text key={i} style={styles.segmentText}>
              {`[${seg.startSec.toFixed(2)}s → ${seg.endSec.toFixed(2)}s]  SPEAKER_${String(seg.speakerId).padStart(2, '0')}`}
            </Text>
          ))}
          {result.segments.length > 4 && (
            <Text style={styles.mutedText}>… {result.segments.length - 4} more segments</Text>
          )}
        </View>
      )}
    </View>
  );
}

function BenchmarkPanel({ bench, task }: { bench: BenchmarkComparison; task: TaskType }) {
  const edgeFaster = bench.latencyDeltaMs > 0;
  const accuracyLabel = task === 'stt' ? 'WER' : 'DER';
  const fmtAcc = (v: number | null) =>
    v == null ? 'N/A' : task === 'stt' ? formatWER(v) : formatDER(v);

  const verdictColor = () => {
    switch (bench.verdict) {
      case 'edge-faster-and-accurate':   return '#00aaff';
      case 'cloud-faster-and-accurate':  return '#aa44ff';
      case 'no-reference':               return COLORS.muted;
      default:                           return '#ffaa00';
    }
  };

  const verdictText = () => {
    switch (bench.verdict) {
      case 'edge-faster-and-accurate':   return 'EDGE wins (faster + more accurate)';
      case 'edge-faster-worse-accuracy': return 'EDGE faster, CLOUD more accurate — trade-off';
      case 'cloud-faster-and-accurate':  return 'CLOUD wins (faster + more accurate)';
      case 'cloud-faster-worse-accuracy':return 'CLOUD faster, EDGE more accurate — trade-off';
      case 'no-reference':               return 'Load a reference file to compare accuracy';
    }
  };

  return (
    <View style={styles.benchPanel}>
      {/* Header row */}
      <View style={styles.benchHeaderRow}>
        <Text style={styles.benchColHeader} />
        <Text style={[styles.benchColHeader, { color: '#00aaff' }]}>EDGE</Text>
        <Text style={[styles.benchColHeader, { color: '#aa44ff' }]}>CLOUD</Text>
        <Text style={styles.benchColHeader}>WINNER</Text>
      </View>

      {/* Latency */}
      <View style={styles.benchRow}>
        <Text style={styles.benchRowLabel}>Latency</Text>
        <Text style={[styles.benchCell, edgeFaster && styles.winnerCell]}>
          {formatLatency(bench.edgeLatencyMs)}
        </Text>
        <Text style={[styles.benchCell, !edgeFaster && styles.winnerCell]}>
          {formatLatency(bench.cloudLatencyMs)}
        </Text>
        <Text style={[styles.benchWinner, { color: edgeFaster ? '#00aaff' : '#aa44ff' }]}>
          {edgeFaster ? 'EDGE' : 'CLOUD'}
          {` (${Math.abs(bench.latencyDeltaMs).toFixed(0)}ms)`}
        </Text>
      </View>

      {/* Accuracy */}
      {(bench.edgeAccuracy != null || bench.cloudAccuracy != null) && (
        <View style={styles.benchRow}>
          <Text style={styles.benchRowLabel}>{accuracyLabel} ↓</Text>
          <Text style={[
            styles.benchCell,
            bench.edgeAccuracy != null && bench.cloudAccuracy != null &&
            bench.edgeAccuracy <= bench.cloudAccuracy && styles.winnerCell,
          ]}>
            {fmtAcc(bench.edgeAccuracy)}
          </Text>
          <Text style={[
            styles.benchCell,
            bench.edgeAccuracy != null && bench.cloudAccuracy != null &&
            bench.cloudAccuracy < bench.edgeAccuracy && styles.winnerCell,
          ]}>
            {fmtAcc(bench.cloudAccuracy)}
          </Text>
          <Text style={[styles.benchWinner, {
            color: bench.edgeAccuracy != null && bench.cloudAccuracy != null
              ? bench.edgeAccuracy <= bench.cloudAccuracy ? '#00aaff' : '#aa44ff'
              : COLORS.muted,
          }]}>
            {bench.edgeAccuracy != null && bench.cloudAccuracy != null
              ? bench.edgeAccuracy <= bench.cloudAccuracy ? 'EDGE' : 'CLOUD'
              : 'N/A'}
          </Text>
        </View>
      )}

      {/* Policy verdict */}
      <View style={[styles.verdictRow, { borderColor: verdictColor() }]}>
        <Text style={[styles.verdictText, { color: verdictColor() }]}>{verdictText()}</Text>
        {bench.policyWasCorrect != null && (
          <Text style={[styles.policyLabel, {
            color: bench.policyWasCorrect ? COLORS.done : COLORS.error,
          }]}>
            Policy routed to {bench.routedTo.toUpperCase()} —{' '}
            {bench.policyWasCorrect ? 'CORRECT ✓' : 'SUBOPTIMAL ✗'}
          </Text>
        )}
      </View>
    </View>
  );
}

function CostPanel({
  cost,
  dailyMinutes,
  onDailyMinutesChange,
  dailyMinutesInput,
}: {
  cost: CostAnalysis;
  dailyMinutes: number;
  onDailyMinutesChange: (v: string) => void;
  dailyMinutesInput: string;
}) {
  const monthlySavings = cost.projectedMonthlySavingsUsd(dailyMinutes);

  return (
    <View style={styles.costPanel}>
      <View style={styles.costRow}>
        <Text style={styles.costLabel}>This run (baseline)</Text>
        <Text style={styles.costValue}>{formatUsd(cost.baselineCostUsd)}</Text>
      </View>
      <View style={styles.costRow}>
        <Text style={styles.costLabel}>This run (actual)</Text>
        <Text style={[styles.costValue, { color: cost.cloudRan ? COLORS.error : COLORS.done }]}>
          {formatUsd(cost.cloudCostUsd)}
        </Text>
      </View>
      <View style={[styles.costRow, styles.costSavingsRow]}>
        <Text style={[styles.costLabel, { color: COLORS.accent }]}>Saved this run</Text>
        <Text style={[styles.costValue, { color: COLORS.accent }]}>
          {formatUsd(cost.savingsUsd)}
        </Text>
      </View>

      <View style={styles.costDivider} />

      <View style={styles.costRow}>
        <Text style={styles.costLabel}>Daily audio (min)</Text>
        <TextInput
          style={styles.costInput}
          value={dailyMinutesInput}
          onChangeText={onDailyMinutesChange}
          keyboardType="number-pad"
          placeholderTextColor={COLORS.muted}
        />
      </View>
      <View style={[styles.costRow, styles.costSavingsRow]}>
        <Text style={[styles.costLabel, { color: COLORS.accent }]}>Projected monthly savings</Text>
        <Text style={[styles.costValue, { color: COLORS.accent, fontSize: 14 }]}>
          {formatUsd(monthlySavings)} / mo
        </Text>
      </View>
      <Text style={styles.costNote}>
        Baseline = all audio sent to cloud. Savings = what edge offloading saves.
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

const DEFAULT_BACKEND = 'http://192.168.1.1:3001';

export default function OrchestratorScreen({ audioFile, onAudioFileChange }: Props) {
  // Config state
  const [backendUrl, setBackendUrl]   = useState(DEFAULT_BACKEND);
  const [taskType, setTaskType]       = useState<TaskType>('stt');
  const [userTier, setUserTier]       = useState<UserTier>('free');
  const [privacyMode, setPrivacy]     = useState(false);
  const [cloudProvider, setProvider]  = useState('deepgram');
  const [threshold, setThreshold]     = useState('0.40');
  const [benchmarkMode, setBenchmark] = useState(false);
  const [dailyMinutes, setDailyMins]  = useState('60');

  // Runtime state
  const [phase, setPhase]               = useState<Phase>('idle');
  const [deviceCtx, setDeviceCtx]       = useState<DeviceContext | null>(null);
  const [runResult, setRunResult]       = useState<OrchestratorRunResult | null>(null);
  const [errorMsg, setErrorMsg]         = useState<string | null>(null);
  const [loadingMeeting, setLoadingMeeting] = useState(false);

  const isRunning = phase === 'probing' || phase === 'running';
  const busy = isRunning || loadingMeeting;

  // ---------------------------------------------------------------------------
  // AMI meeting selector
  // ---------------------------------------------------------------------------

  const handleSelectMeeting = useCallback(async (meetingId: string) => {
    setLoadingMeeting(true);
    try {
      const file = await loadAmiMeeting(meetingId);
      onAudioFileChange(file);
      setRunResult(null);
    } catch (err: unknown) {
      Alert.alert('Error loading meeting', String(err));
    } finally {
      setLoadingMeeting(false);
    }
  }, [onAudioFileChange]);

  // ---------------------------------------------------------------------------
  // Probe
  // ---------------------------------------------------------------------------

  const handleProbe = useCallback(async () => {
    setPhase('probing');
    try {
      const ctx = await gatherDeviceContext(backendUrl);
      setDeviceCtx(ctx);
    } catch (err: unknown) {
      Alert.alert('Probe failed', String(err));
    } finally {
      setPhase('idle');
    }
  }, [backendUrl]);

  // ---------------------------------------------------------------------------
  // Run orchestrator
  // ---------------------------------------------------------------------------

  const handleRun = useCallback(async () => {
    if (!audioFile) {
      Alert.alert('No file', 'Pick an audio file first.');
      return;
    }

    const confidenceThreshold = parseFloat(threshold);
    if (isNaN(confidenceThreshold) || confidenceThreshold < 0 || confidenceThreshold > 1) {
      Alert.alert('Invalid threshold', 'Enter a number between 0 and 1.');
      return;
    }

    // Validate cloud provider for diarization (only deepgram + google supported)
    const diarProvider = taskType === 'diarization' && cloudProvider === 'assemblyai'
      ? 'deepgram'
      : cloudProvider;

    const config: OrchestratorConfig = {
      task: taskType,
      userTier,
      privacyMode,
      backendUrl,
      cloudProvider: diarProvider,
      confidenceThreshold,
      benchmarkMode,
    };

    // Check edge model readiness for STT path
    if (taskType === 'stt') {
      const ready = await isModelReady('whisper-tiny');
      if (!ready) {
        Alert.alert(
          'Edge model not downloaded',
          'Whisper tiny is required for edge STT. Download it from the STT tab first, or set User Tier to Premium to route directly to cloud.',
        );
        return;
      }
    }

    setPhase('running');
    setRunResult(null);
    setErrorMsg(null);

    try {
      const result = await runOrchestrator(audioFile, config);
      setDeviceCtx(result.deviceContext);
      setRunResult(result);
      setPhase('done');
    } catch (err: unknown) {
      setErrorMsg(String(err));
      setPhase('error');
    }
  }, [audioFile, backendUrl, taskType, userTier, privacyMode, cloudProvider, threshold]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const sttProviders = ['deepgram', 'assemblyai', 'google'];
  const diarProviders = ['deepgram', 'google'];
  const providers = taskType === 'stt' ? sttProviders : diarProviders;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.screenTitle}>ORCHESTRATOR</Text>

        {/* ---------------------------------------------------------------- */}
        {/* Config                                                            */}
        {/* ---------------------------------------------------------------- */}
        <SectionHeader title="CONFIG" />

        <Text style={styles.fieldLabel}>BACKEND URL</Text>
        <TextInput
          style={styles.input}
          value={backendUrl}
          onChangeText={setBackendUrl}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="http://192.168.x.x:3001"
          placeholderTextColor={COLORS.muted}
        />

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>TASK</Text>
          <View style={styles.toggleGroup}>
            <ToggleButton label="STT"          active={taskType === 'stt'}          onPress={() => setTaskType('stt')} />
            <ToggleButton label="DIARIZATION"  active={taskType === 'diarization'}  onPress={() => setTaskType('diarization')} />
          </View>
        </View>

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>USER TIER</Text>
          <View style={styles.toggleGroup}>
            <ToggleButton label="FREE"    active={userTier === 'free'}    onPress={() => setUserTier('free')} />
            <ToggleButton label="PREMIUM" active={userTier === 'premium'} onPress={() => setUserTier('premium')} color="#aa44ff" />
          </View>
        </View>

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>CLOUD PROVIDER</Text>
          <View style={styles.toggleGroup}>
            {providers.map((p) => (
              <ToggleButton key={p} label={p.toUpperCase()} active={cloudProvider === p} onPress={() => setProvider(p)} />
            ))}
          </View>
        </View>

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>PRIVACY MODE</Text>
          <View style={styles.toggleGroup}>
            <ToggleButton label="OFF" active={!privacyMode} onPress={() => setPrivacy(false)} />
            <ToggleButton label="ON"  active={privacyMode}  onPress={() => setPrivacy(true)} color={COLORS.error} />
          </View>
        </View>

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>{'WER THRESHOLD\n(0 = disabled)'}</Text>
          <TextInput
            style={[styles.input, styles.inputSmall]}
            value={threshold}
            onChangeText={setThreshold}
            keyboardType="decimal-pad"
            placeholder="0.40"
            placeholderTextColor={COLORS.muted}
          />
        </View>

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>BENCHMARK MODE</Text>
          <View style={styles.toggleGroup}>
            <ToggleButton label="OFF" active={!benchmarkMode} onPress={() => setBenchmark(false)} />
            <ToggleButton label="ON — run both paths" active={benchmarkMode} onPress={() => setBenchmark(true)} color="#ffaa00" />
          </View>
        </View>

        {/* ---------------------------------------------------------------- */}
        {/* Device Context                                                   */}
        {/* ---------------------------------------------------------------- */}
        <SectionHeader title="DEVICE CONTEXT" />

        {deviceCtx ? (
          <View style={styles.contextBlock}>
            <Row
              label="Network "
              value={deviceCtx.cloudReachable
                ? `${deviceCtx.networkQuality.toUpperCase()} (${deviceCtx.networkLatencyMs ?? '?'} ms)`
                : 'OFFLINE'}
              valueColor={qualityColor(deviceCtx.networkQuality)}
            />
            <Row
              label="Battery "
              value={deviceCtx.batteryPct != null ? `${deviceCtx.batteryPct.toFixed(0)}%` : 'N/A'}
              valueColor={deviceCtx.batteryPct != null && deviceCtx.batteryPct < 15 ? COLORS.error : undefined}
            />
            <Row
              label="Low Power"
              value={deviceCtx.lowPowerMode ? 'YES' : 'NO'}
              valueColor={deviceCtx.lowPowerMode ? COLORS.error : COLORS.done}
            />
            <Row
              label="Cloud   "
              value={deviceCtx.cloudReachable ? 'REACHABLE' : 'UNREACHABLE'}
              valueColor={deviceCtx.cloudReachable ? COLORS.done : COLORS.error}
            />
          </View>
        ) : (
          <Text style={styles.mutedText}>No context yet. Press PROBE or RUN.</Text>
        )}

        <TouchableOpacity
          style={[styles.probeButton, (phase === 'probing' || loadingMeeting) && styles.buttonDisabled]}
          onPress={handleProbe}
          disabled={phase === 'probing' || loadingMeeting}
          activeOpacity={0.7}
        >
          {phase === 'probing'
            ? <ActivityIndicator color={COLORS.muted} size="small" />
            : <Text style={styles.probeButtonText}>PROBE</Text>}
        </TouchableOpacity>

        {/* ---------------------------------------------------------------- */}
        {/* Audio                                                            */}
        {/* ---------------------------------------------------------------- */}
        <SectionHeader title="AUDIO" />

        <AudioSelector
          audioFile={audioFile}
          onSelectMeeting={handleSelectMeeting}
          loading={loadingMeeting}
        />

        {/* ---------------------------------------------------------------- */}
        {/* Run                                                              */}
        {/* ---------------------------------------------------------------- */}
        <TouchableOpacity
          style={[styles.runButton, (busy || !audioFile) && styles.buttonDisabled]}
          onPress={handleRun}
          disabled={busy || !audioFile}
          activeOpacity={0.7}
        >
          {isRunning ? (
            <View style={styles.runningRow}>
              <ActivityIndicator color={COLORS.accent} size="small" />
              <Text style={styles.runButtonText}>ORCHESTRATING…</Text>
            </View>
          ) : loadingMeeting ? (
            <View style={styles.runningRow}>
              <ActivityIndicator color={COLORS.muted} size="small" />
              <Text style={[styles.runButtonText, { color: COLORS.muted }]}>LOADING…</Text>
            </View>
          ) : (
            <Text style={[styles.runButtonText, !audioFile && { color: COLORS.muted }]}>
              {benchmarkMode ? 'RUN BENCHMARK' : 'RUN ORCHESTRATOR'}
            </Text>
          )}
        </TouchableOpacity>

        {/* ---------------------------------------------------------------- */}
        {/* Results                                                          */}
        {/* ---------------------------------------------------------------- */}
        {phase === 'error' && errorMsg && (
          <View style={styles.errorBlock}>
            <Text style={styles.errorTitle}>ERROR</Text>
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        {runResult && (
          <>
            <SectionHeader title="ROUTING DECISION" />

            <DecisionBadge decision={runResult.decision} label="INITIAL" />

            {runResult.escalation && (
              <>
                <Text style={styles.escalationArrow}>↓ escalated</Text>
                <DecisionBadge decision={runResult.escalation} label="ESCALATION" />
              </>
            )}

            <SectionHeader title="RESULTS" />

            {runResult.edgeResult && (
              <ResultBlock
                title="EDGE  (whisper-tiny)"
                result={runResult.edgeResult}
                color="#00aaff"
              />
            )}

            {runResult.cloudResult && (
              <ResultBlock
                title={`CLOUD  (${cloudProvider})`}
                result={runResult.cloudResult}
                color="#aa44ff"
              />
            )}

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>TOTAL LATENCY</Text>
              <Text style={styles.totalValue}>{formatLatency(runResult.totalLatencyMs)}</Text>
            </View>
          </>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Benchmark comparison                                             */}
        {/* ---------------------------------------------------------------- */}
        {runResult?.benchmark && (
          <>
            <SectionHeader title="BENCHMARK COMPARISON" />
            <BenchmarkPanel
              bench={runResult.benchmark}
              task={taskType}
            />
          </>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Cost analysis                                                    */}
        {/* ---------------------------------------------------------------- */}
        {runResult?.cost && (
          <>
            <SectionHeader title="COST ANALYSIS" />
            <CostPanel
              cost={runResult.cost}
              dailyMinutes={parseFloat(dailyMinutes) || 60}
              onDailyMinutesChange={setDailyMins}
              dailyMinutesInput={dailyMinutes}
            />
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: COLORS.bg },
  scroll:  { flex: 1 },
  content: { padding: 16 },

  screenTitle: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.muted,
    letterSpacing: 2,
    marginBottom: 14,
  },

  // Section headers
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 20,
    marginBottom: 10,
  },
  sectionTitle: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.muted,
    letterSpacing: 2,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.border,
  },

  // Config
  fieldLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.muted,
    letterSpacing: 1,
    marginBottom: 4,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  input: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
    backgroundColor: COLORS.surface,
  },
  inputSmall: {
    width: 80,
    marginBottom: 0,
  },
  toggleGroup: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    flex: 1,
  },
  toggle: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  toggleText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.muted,
    letterSpacing: 1,
  },

  // Context block
  contextBlock: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    padding: 10,
    gap: 4,
    marginBottom: 8,
    backgroundColor: COLORS.surface,
  },
  metricRow: {
    flexDirection: 'row',
    gap: 8,
  },
  metricLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.muted,
    letterSpacing: 1,
    width: 70,
  },
  metricValue: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.text,
    flex: 1,
  },
  mutedText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.muted,
    marginBottom: 8,
  },

  // Buttons
  probeButton: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 70,
  },
  probeButtonText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.muted,
    letterSpacing: 1,
  },
  runButton: {
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: 4,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  runningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  runButtonText: {
    fontFamily: FONTS.mono,
    fontSize: 13,
    color: COLORS.accent,
    letterSpacing: 1.5,
  },
  buttonDisabled: {
    borderColor: COLORS.border,
  },

  // Decision badge
  decisionBadge: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 10,
    marginBottom: 6,
    gap: 4,
    backgroundColor: COLORS.surface,
  },
  decisionBadgeTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  decisionTarget: {
    fontFamily: FONTS.mono,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1,
  },
  decisionReason: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    letterSpacing: 1.5,
  },
  decisionLabel: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: COLORS.muted,
    letterSpacing: 1,
  },
  decisionExplanation: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.text,
    marginTop: 2,
  },
  escalationArrow: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.muted,
    textAlign: 'center',
    marginVertical: 4,
  },

  // Result block
  resultBlock: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 10,
    marginBottom: 8,
    gap: 3,
    backgroundColor: COLORS.surface,
  },
  resultBlockTitle: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 4,
  },
  transcriptBlock: {
    marginTop: 6,
    padding: 8,
    backgroundColor: '#0d0d0d',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 3,
  },
  transcriptText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.text,
    lineHeight: 16,
  },
  segmentText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.text,
  },

  // Error
  errorBlock: {
    borderWidth: 1,
    borderColor: COLORS.error,
    borderRadius: 4,
    padding: 10,
    marginTop: 10,
    gap: 4,
  },
  errorTitle: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.error,
    letterSpacing: 1.5,
  },
  errorText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.error,
  },

  // Total
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    marginTop: 4,
  },
  totalLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.muted,
    letterSpacing: 1,
  },
  totalValue: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: COLORS.accent,
  },

  // Benchmark panel
  benchPanel: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    padding: 10,
    backgroundColor: COLORS.surface,
    gap: 2,
  },
  benchHeaderRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  benchColHeader: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    letterSpacing: 1.5,
    color: COLORS.muted,
    flex: 1,
    textAlign: 'center',
  },
  benchRow: {
    flexDirection: 'row',
    marginBottom: 4,
    alignItems: 'center',
  },
  benchRowLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.muted,
    flex: 1,
    letterSpacing: 0.5,
  },
  benchCell: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.muted,
    flex: 1,
    textAlign: 'center',
  },
  winnerCell: {
    color: COLORS.text,
    fontWeight: '700',
  },
  benchWinner: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    flex: 1,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  verdictRow: {
    borderWidth: 1,
    borderRadius: 4,
    padding: 8,
    marginTop: 8,
    gap: 4,
  },
  verdictText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
  },
  policyLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 0.5,
  },

  // Cost panel
  costPanel: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    padding: 10,
    backgroundColor: COLORS.surface,
    gap: 4,
  },
  costRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  costSavingsRow: {
    paddingTop: 2,
  },
  costLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.muted,
    letterSpacing: 0.5,
  },
  costValue: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: COLORS.text,
  },
  costDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 4,
  },
  costInput: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    width: 70,
    textAlign: 'right',
    backgroundColor: '#0d0d0d',
  },
  costNote: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: COLORS.muted,
    marginTop: 4,
    letterSpacing: 0.3,
  },
});
