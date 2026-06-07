import { Asset } from 'expo-asset';
import { AMI_MEETINGS } from '../constants/amiData';
import { AudioFile } from '../types/benchmark';
import { getAudioDuration, parseRttm } from './audioLoader';

// Static require map — Metro needs these to be statically analyzable
const AUDIO_MODULES: Record<string, number> = {
  ES2004a: require('../../assets/ami/ES2004a.wav') as number,
  ES2004b: require('../../assets/ami/ES2004b.wav') as number,
  ES2004c: require('../../assets/ami/ES2004c.wav') as number,
  ES2004d: require('../../assets/ami/ES2004d.wav') as number,
  IS1009a: require('../../assets/ami/IS1009a.wav') as number,
};

export async function loadAmiMeeting(meetingId: string): Promise<AudioFile> {
  const meeting = AMI_MEETINGS.find((m) => m.id === meetingId);
  if (!meeting) throw new Error(`Unknown AMI meeting: ${meetingId}`);

  const module = AUDIO_MODULES[meetingId];
  if (module == null) throw new Error(`No audio asset for meeting: ${meetingId}`);

  const asset = Asset.fromModule(module);
  await asset.downloadAsync();

  const uri = asset.localUri ?? asset.uri;
  const rttmSegments = parseRttm(meeting.rttm);
  const rttmEndSec = rttmSegments.reduce((max, s) => Math.max(max, s.endSec), 0);
  const wavDuration = await getAudioDuration(uri);
  const durationSeconds = wavDuration > 0 ? wavDuration : rttmEndSec;

  return {
    uri,
    filename: meetingId,
    durationSeconds,
    referenceTranscript: meeting.transcript,
    referenceDiarization: rttmSegments,
  };
}

export { AMI_MEETINGS };
