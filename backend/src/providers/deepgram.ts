import { createClient } from '@deepgram/sdk';
import { DiarizationSegment } from '../types';

function client() {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error('DEEPGRAM_API_KEY not set');
  return createClient(key);
}

export async function transcribeDeepgram(buffer: Buffer): Promise<string> {
  const dg = client();
  const { result, error } = await dg.listen.prerecorded.transcribeFile(buffer, {
    model: 'nova-3',
    language: 'en',
    smart_format: true,
  });
  if (error) throw new Error(`Deepgram STT error: ${JSON.stringify(error)}`);
  return result.results.channels[0].alternatives[0].transcript ?? '';
}

export async function diarizeDeepgram(
  buffer: Buffer,
): Promise<{ segments: DiarizationSegment[]; transcript: string }> {
  const dg = client();
  const { result, error } = await dg.listen.prerecorded.transcribeFile(buffer, {
    model: 'nova-3',
    language: 'en',
    smart_format: true,
    diarize: true,
  });
  if (error) throw new Error(`Deepgram diarization error: ${JSON.stringify(error)}`);

  const alt = result.results.channels[0].alternatives[0];
  const transcript = alt.transcript ?? '';
  const words = alt.words ?? [];

  // Merge consecutive words belonging to the same speaker into segments
  const segments: DiarizationSegment[] = [];
  let curSpeaker: number | null = null;
  let segStart = 0;
  let segEnd = 0;

  for (const w of words) {
    const speaker = (w as { speaker?: number }).speaker ?? 0;
    if (curSpeaker === null) {
      curSpeaker = speaker;
      segStart = w.start ?? 0;
      segEnd   = w.end   ?? 0;
    } else if (speaker !== curSpeaker) {
      segments.push({ speakerId: curSpeaker, startSec: segStart, endSec: segEnd, label: `SPEAKER_${String(curSpeaker).padStart(2, '0')}` });
      curSpeaker = speaker;
      segStart = w.start ?? 0;
      segEnd   = w.end   ?? 0;
    } else {
      segEnd = w.end ?? segEnd;
    }
  }

  if (curSpeaker !== null) {
    segments.push({ speakerId: curSpeaker, startSec: segStart, endSec: segEnd, label: `SPEAKER_${String(curSpeaker).padStart(2, '0')}` });
  }

  return { segments, transcript };
}
