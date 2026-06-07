import DocumentPicker, { types } from 'react-native-document-picker';
import RNFS from 'react-native-fs';
import { AudioFile, DiarizationSegment } from '../types/benchmark';
import { uriToPath } from './modelManager';


// ---------------------------------------------------------------------------
// Audio file loading utilities
// ---------------------------------------------------------------------------

/**
 * Open the OS file picker restricted to audio types.
 * Resolves with an AudioFile (uri + duration) or null if the user cancelled.
 */
export async function pickAudioFile(): Promise<AudioFile | null> {
  try {
    const result = await DocumentPicker.pickSingle({
      type: [types.audio],
      copyTo: 'cachesDirectory', // gives us a stable file:// URI on both platforms
    });

    const uri = result.fileCopyUri ?? result.uri;
    const filename = result.name ?? uri.split('/').pop() ?? 'audio';

    const durationSeconds = await getAudioDuration(uri);

    return { uri, filename, durationSeconds };
  } catch (err: unknown) {
    // User pressed Cancel — DocumentPicker throws with isCancel === true
    if (DocumentPicker.isCancel(err)) return null;
    throw err;
  }
}

export async function getAudioDuration(uri: string): Promise<number> {
  try {
    const path = uriToPath(uri);
    // Read 256 bytes — enough to cover RIFF/fmt/data headers even with extra chunks
    const b64 = await RNFS.read(path, 256, 0, 'base64');
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));

    const u16le = (off: number) => bytes[off] | (bytes[off + 1] << 8);
    const u32le = (off: number) =>
      ((bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0);

    const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    const wave = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (riff !== 'RIFF' || wave !== 'WAVE') return 0;

    const fmtSize = u32le(16);
    const sampleRate = u32le(24);
    const numChannels = u16le(22);
    const bitsPerSample = u16le(34);

    // Scan past fmt chunk and any extra chunks until we hit "data"
    let offset = 12 + 8 + fmtSize;
    while (offset + 8 <= bytes.length) {
      const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
      const size = u32le(offset + 4);
      if (id === 'data') {
        const bytesPerSample = bitsPerSample / 8;
        return size / (sampleRate * numChannels * bytesPerSample);
      }
      offset += 8 + size;
    }
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Returns true when the URI points to a WAV file.
 * whisper.rn and Vosk work best with 16 kHz mono WAV; callers can surface
 * a warning when this returns false.
 */
export function isWavFile(uri: string): boolean {
  return uri.toLowerCase().endsWith('.wav');
}

/**
 * Return a human-readable label for a file URI.
 */
export function uriToFilename(uri: string): string {
  const decoded = decodeURIComponent(uri);
  return decoded.split('/').pop() ?? uri;
}

// ---------------------------------------------------------------------------
// Reference ground-truth loaders
// ---------------------------------------------------------------------------

/**
 * Open the OS file picker for a plain-text reference transcript (.txt).
 * Returns the raw file contents or null if the user cancelled.
 */
export async function pickReferenceTranscript(): Promise<string | null> {
  try {
    const result = await DocumentPicker.pickSingle({
      // allFiles so .txt files aren't filtered out on Android
      type: [types.plainText, types.allFiles],
      copyTo: 'cachesDirectory',
    });
    const uri = result.fileCopyUri ?? result.uri;
    return await RNFS.readFile(uriToPath(uri), 'utf8');
  } catch (err: unknown) {
    if (DocumentPicker.isCancel(err)) return null;
    throw err;
  }
}

/**
 * Open the OS file picker for an RTTM diarization reference file.
 * Returns parsed DiarizationSegment[] or null if the user cancelled.
 */
export async function pickRttmFile(): Promise<DiarizationSegment[] | null> {
  try {
    const result = await DocumentPicker.pickSingle({
      type: [types.allFiles],
      copyTo: 'cachesDirectory',
    });
    const uri = result.fileCopyUri ?? result.uri;
    const content = await RNFS.readFile(uriToPath(uri), 'utf8');
    return parseRttm(content);
  } catch (err: unknown) {
    if (DocumentPicker.isCancel(err)) return null;
    throw err;
  }
}

/**
 * Parse an RTTM file into DiarizationSegments.
 *
 * RTTM line format (NIST):
 *   SPEAKER <file> 1 <start> <duration> <NA> <NA> <speaker> <NA> <NA>
 *
 * Speaker names are mapped to sequential integer IDs in order of first
 * appearance. The original name is preserved in the `label` field.
 */
export function parseRttm(text: string): DiarizationSegment[] {
  const speakerMap = new Map<string, number>();
  const segments: DiarizationSegment[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || !trimmed.startsWith('SPEAKER')) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 9) continue;

    const startSec = parseFloat(parts[3]);
    const duration = parseFloat(parts[4]);
    const speakerName = parts[7];

    if (isNaN(startSec) || isNaN(duration) || speakerName === '<NA>') continue;

    if (!speakerMap.has(speakerName)) speakerMap.set(speakerName, speakerMap.size);

    segments.push({
      speakerId: speakerMap.get(speakerName)!,
      startSec,
      endSec: startSec + duration,
      label: speakerName,
    });
  }

  return segments.sort((a, b) => a.startSec - b.startSec);
}
