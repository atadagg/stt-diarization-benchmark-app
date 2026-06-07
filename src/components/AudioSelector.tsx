import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { AudioFile } from '../types/benchmark';
import { COLORS, FONTS } from './theme';
import { AMI_MEETINGS } from '../utils/amiLoader';

interface Props {
  audioFile: AudioFile | null;
  onSelectMeeting: (meetingId: string) => void;
  loading: boolean;
}

export default function AudioSelector({ audioFile, onSelectMeeting, loading }: Props) {
  const selectedId = audioFile?.filename ?? null;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>AMI MEETING CORPUS  —  TEST SPLIT</Text>

      <View style={styles.grid}>
        {AMI_MEETINGS.map((m) => {
          const isSelected = selectedId === m.id;
          const isLoading = loading && isSelected;
          return (
            <TouchableOpacity
              key={m.id}
              style={[styles.chip, isSelected && styles.chipSelected]}
              onPress={() => onSelectMeeting(m.id)}
              disabled={loading}
              activeOpacity={0.7}
            >
              {isLoading ? (
                <ActivityIndicator color={COLORS.accent} size="small" />
              ) : (
                <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                  {m.id}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {audioFile && (
        <View style={styles.infoRow}>
          <Text style={styles.infoItem}>
            {audioFile.durationSeconds.toFixed(1)}s
          </Text>
          {audioFile.referenceTranscript != null && (
            <Text style={[styles.infoItem, styles.refOk]}>transcript ✓</Text>
          )}
          {audioFile.referenceDiarization != null && (
            <Text style={[styles.infoItem, styles.refOk]}>rttm ✓</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surface,
    borderRadius: 6,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  label: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.muted,
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: {
    borderColor: COLORS.accent,
    backgroundColor: `${COLORS.accent}18`,
  },
  chipText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: COLORS.muted,
    letterSpacing: 0.5,
  },
  chipTextSelected: {
    color: COLORS.accent,
  },
  infoRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  infoItem: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.muted,
  },
  refOk: {
    color: COLORS.done,
  },
});
