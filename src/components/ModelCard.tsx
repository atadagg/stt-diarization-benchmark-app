import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { ModelConfig, BenchmarkResult } from '../types/benchmark';
import { formatLatency, formatRTF, formatWER, formatDER, formatBatteryDrain } from '../utils/metrics';
import { COLORS, FONTS } from './theme';

export type ModelReadyStatus = 'checking' | 'not-downloaded' | 'downloading' | 'ready';

export interface ModelDownloadState {
  status: ModelReadyStatus;
  /** 0-100, only meaningful when status === 'downloading' */
  progress: number;
}

interface Props {
  model: ModelConfig;
  result: BenchmarkResult | null;
  onRun: (modelId: string) => void;
  onDownload?: (modelId: string) => void;
  downloadState?: ModelDownloadState;
  /** Disable the Run button while this or another model is running. */
  disabled?: boolean;
}

/**
 * A single row showing:
 *   - model name + description
 *   - "Run" button (disabled while running)
 *   - inline results once done: latency, RTF, memory, transcript/segments preview
 */
export default function ModelCard({
  model,
  result,
  onRun,
  onDownload,
  downloadState,
  disabled,
}: Props) {
  const status = result?.status ?? 'idle';
  const isRunning = status === 'running';
  const dlStatus = downloadState?.status ?? 'ready';
  const dlProgress = downloadState?.progress ?? 0;

  const showDownloadButton = dlStatus === 'not-downloaded';
  const showDownloading = dlStatus === 'downloading';
  const showChecking = dlStatus === 'checking';
  const modelReady = dlStatus === 'ready' || downloadState == null;

  const actionDisabled =
    disabled || showDownloading || showChecking || (!modelReady && !showDownloadButton);
  const dlDisabled = showDownloading || showChecking;

  return (
    <View style={[styles.card, isRunning && styles.cardRunning]}>
      {/* Header row */}
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <Text style={styles.name}>{model.name}</Text>
          <Text style={styles.description}>{model.description}</Text>
          <Text style={styles.platforms}>
            {model.platforms.join(' · ').toUpperCase()}
          </Text>
        </View>

        {/* Action button — RUN or DOWNLOAD depending on model state */}
        {showChecking ? (
          <View style={[styles.runButton, styles.runButtonDisabled]}>
            <ActivityIndicator color={COLORS.muted} size="small" />
          </View>
        ) : showDownloading ? (
          <View style={[styles.runButton, styles.runButtonDisabled]}>
            <Text style={styles.progressText}>{dlProgress}%</Text>
          </View>
        ) : showDownloadButton ? (
          <TouchableOpacity
            style={styles.dlButton}
            onPress={() => onDownload?.(model.id)}
            disabled={dlDisabled}
            activeOpacity={0.7}
          >
            <Text style={styles.dlButtonText}>GET</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[
              styles.runButton,
              isRunning && styles.runButtonRunning,
              (disabled && !isRunning) && styles.runButtonDisabled,
            ]}
            onPress={() => onRun(model.id)}
            disabled={actionDisabled}
            activeOpacity={0.7}
          >
            {isRunning ? (
              <ActivityIndicator color={COLORS.accent} size="small" />
            ) : (
              <Text
                style={[
                  styles.runButtonText,
                  (disabled && !isRunning) && styles.runButtonTextDisabled,
                ]}
              >
                RUN
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Download progress bar */}
      {showDownloading && (
        <View style={styles.progressBarTrack}>
          <View style={[styles.progressBarFill, { width: `${dlProgress}%` }]} />
        </View>
      )}

      {/* Results section — only shown after a run */}
      {result && result.status !== 'idle' && (
        <View style={styles.results}>
          <Divider />

          {/* Status badge */}
          <Text style={[styles.statusBadge, statusColor(result.status)]}>
            {result.status.toUpperCase()}
          </Text>

          {result.status === 'error' && result.errorMessage && (
            <Text style={styles.errorText}>{result.errorMessage}</Text>
          )}

          {(result.status === 'done' || result.status === 'running') && (
            <>
              <MetricRow label="Latency" value={formatLatency(result.latencyMs)} />
              <MetricRow label="RTF    " value={formatRTF(result.rtf)} />
              <MetricRow
                label="Memory "
                value={
                  result.peakMemoryMB != null
                    ? `${result.peakMemoryMB.toFixed(1)} MB (JS heap delta)`
                    : 'N/A'
                }
              />
              {result.wer != null && (
                <MetricRow label="WER    " value={formatWER(result.wer)} />
              )}
              {result.der != null && (
                <MetricRow label="DER    " value={formatDER(result.der)} />
              )}
              {result.batteryDrainPct != null && (
                <MetricRow label="Battery" value={`-${formatBatteryDrain(result.batteryDrainPct)}`} />
              )}

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
                  <Text style={styles.metricLabel}>
                    SEGMENTS ({result.segments.length})
                  </Text>
                  {result.segments.slice(0, 5).map((seg, i) => (
                    <Text key={i} style={styles.segmentText}>
                      {`[${seg.startSec.toFixed(2)}s → ${seg.endSec.toFixed(2)}s]  SPEAKER_${String(seg.speakerId).padStart(2, '0')}`}
                    </Text>
                  ))}
                  {result.segments.length > 5 && (
                    <Text style={styles.muted}>
                      … {result.segments.length - 5} more segments
                    </Text>
                  )}
                </View>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

function statusColor(status: BenchmarkResult['status']) {
  switch (status) {
    case 'running': return { color: COLORS.accent };
    case 'done':    return { color: COLORS.done };
    case 'error':   return { color: COLORS.error };
    default:        return { color: COLORS.muted };
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
    padding: 14,
  },
  cardRunning: {
    borderColor: COLORS.accent,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  titleBlock: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontFamily: FONTS.mono,
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '600',
  },
  description: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.muted,
  },
  platforms: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: COLORS.muted,
    letterSpacing: 1,
    marginTop: 2,
  },
  runButton: {
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 14,
    minWidth: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  runButtonRunning: {
    borderColor: COLORS.accent,
    backgroundColor: '#001a0d',
  },
  runButtonDisabled: {
    borderColor: COLORS.border,
  },
  runButtonText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: COLORS.accent,
    letterSpacing: 1,
  },
  runButtonTextDisabled: {
    color: COLORS.muted,
  },
  results: {
    marginTop: 10,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginBottom: 10,
  },
  statusBadge: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  errorText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.error,
    marginBottom: 4,
  },
  metricRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 3,
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
  transcriptBlock: {
    marginTop: 8,
    padding: 8,
    backgroundColor: '#0d0d0d',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 4,
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
  muted: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.muted,
  },
  dlButton: {
    borderWidth: 1,
    borderColor: '#888',
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 14,
    minWidth: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dlButtonText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: '#888',
    letterSpacing: 1,
  },
  progressText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: COLORS.accent,
    letterSpacing: 1,
  },
  progressBarTrack: {
    height: 2,
    backgroundColor: COLORS.border,
    borderRadius: 1,
    marginTop: 10,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 2,
    backgroundColor: COLORS.accent,
    borderRadius: 1,
  },
});
