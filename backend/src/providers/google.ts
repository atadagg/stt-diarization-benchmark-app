import { SpeechClient, protos } from '@google-cloud/speech';
import { wavToFlac } from '../utils/audio';
import { DiarizationSegment } from '../types';

function client() {
  // GOOGLE_APPLICATION_CREDENTIALS env var points to a service-account JSON file.
  // The SDK picks this up automatically.
  return new SpeechClient();
}

// Google's inline audio limit is ~10 MB. WAV files for 5-min 16kHz mono are ~9.6 MB which
// exceed that after base64 overhead, so we convert to FLAC first (requires ffmpeg).
function toBase64Flac(wavBuffer: Buffer): { content: string; encoding: string } {
  const flac = wavToFlac(wavBuffer);
  return { content: flac.toString('base64'), encoding: 'FLAC' };
}

export async function transcribeGoogle(buffer: Buffer): Promise<string> {
  const speech = client();
  const { content, encoding } = toBase64Flac(buffer);

  const request: protos.google.cloud.speech.v1.ILongRunningRecognizeRequest = {
    audio: { content },
    config: {
      encoding: encoding as unknown as protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding,
      sampleRateHertz: 16000,
      languageCode: 'en-US',
      enableAutomaticPunctuation: true,
      model: 'latest_long',
    },
  };

  const [operation] = await speech.longRunningRecognize(request);
  const [response]  = await operation.promise();

  return (response.results ?? [])
    .map((r) => r.alternatives?.[0]?.transcript ?? '')
    .join(' ');
}

export async function diarizeGoogle(buffer: Buffer): Promise<DiarizationSegment[]> {
  const speech = client();
  const { content, encoding } = toBase64Flac(buffer);

  const request: protos.google.cloud.speech.v1.ILongRunningRecognizeRequest = {
    audio: { content },
    config: {
      encoding: encoding as unknown as protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding,
      sampleRateHertz: 16000,
      languageCode: 'en-US',
      enableAutomaticPunctuation: true,
      model: 'phone_call',
      diarizationConfig: {
        enableSpeakerDiarization: true,
        minSpeakerCount: 2,
        maxSpeakerCount: 6,
      },
      enableWordTimeOffsets: true,
    },
  };

  const [operation] = await speech.longRunningRecognize(request);
  const [response]  = await operation.promise();

  // Google puts all diarization info in the last result's first alternative
  const words = response.results?.slice(-1)[0]?.alternatives?.[0]?.words ?? [];

  const segments: DiarizationSegment[] = [];
  let curSpeaker: number | null = null;
  let segStart = 0;
  let segEnd   = 0;

  for (const w of words) {
    const speaker  = w.speakerTag ?? 0;
    const startSec = Number(w.startTime?.seconds ?? 0) + (w.startTime?.nanos ?? 0) / 1e9;
    const endSec   = Number(w.endTime?.seconds   ?? 0) + (w.endTime?.nanos   ?? 0) / 1e9;

    if (curSpeaker === null) {
      curSpeaker = speaker;
      segStart   = startSec;
      segEnd     = endSec;
    } else if (speaker !== curSpeaker) {
      segments.push({ speakerId: curSpeaker, startSec: segStart, endSec: segEnd, label: `SPEAKER_${String(curSpeaker).padStart(2, '0')}` });
      curSpeaker = speaker;
      segStart   = startSec;
      segEnd     = endSec;
    } else {
      segEnd = endSec;
    }
  }

  if (curSpeaker !== null) {
    segments.push({ speakerId: curSpeaker, startSec: segStart, endSec: segEnd, label: `SPEAKER_${String(curSpeaker).padStart(2, '0')}` });
  }

  return segments;
}
