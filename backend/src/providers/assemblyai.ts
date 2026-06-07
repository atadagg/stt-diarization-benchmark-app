import { AssemblyAI } from 'assemblyai';

function client() {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) throw new Error('ASSEMBLYAI_API_KEY not set');
  return new AssemblyAI({ apiKey: key });
}

export async function transcribeAssemblyAI(buffer: Buffer): Promise<string> {
  const aai = client();

  // SDK accepts a Buffer directly — it handles the upload internally
  const transcript = await aai.transcripts.transcribe({
    audio: buffer,
    language_code: 'en_us',
  });

  if (transcript.status === 'error') {
    throw new Error(`AssemblyAI error: ${transcript.error ?? 'unknown'}`);
  }

  return transcript.text ?? '';
}
