import { DiarizationSegment } from '../types/benchmark';

export async function transcribeCloud(
  audioUri: string,
  provider: string,
  durationSeconds: number,
  backendUrl: string,
): Promise<{ transcript: string; latencyMs: number }> {
  const form = new FormData();
  form.append('audio', { uri: audioUri, type: 'audio/wav', name: 'audio.wav' } as unknown as Blob);
  form.append('provider', provider);
  form.append('durationSeconds', String(durationSeconds));

  const res = await fetch(`${backendUrl}/transcribe`, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  const data = await res.json();
  return { transcript: data.transcript, latencyMs: data.latencyMs };
}

export async function diarizeCloud(
  audioUri: string,
  provider: string,
  durationSeconds: number,
  backendUrl: string,
): Promise<{ segments: DiarizationSegment[]; latencyMs: number }> {
  const form = new FormData();
  form.append('audio', { uri: audioUri, type: 'audio/wav', name: 'audio.wav' } as unknown as Blob);
  form.append('provider', provider);
  form.append('durationSeconds', String(durationSeconds));

  const res = await fetch(`${backendUrl}/diarize`, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  const data = await res.json();
  return { segments: data.segments, latencyMs: data.latencyMs };
}
