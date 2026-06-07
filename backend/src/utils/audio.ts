import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

// 5-min 16kHz mono WAV ≈ 9.6 MB → Google's 10 MB base64 limit after encoding.
// Convert to FLAC (typically 50% compression) so it comfortably fits.
// Requires ffmpeg installed on the server.
export function wavToFlac(wavBuffer: Buffer): Buffer {
  const id = randomBytes(8).toString('hex');
  const inPath  = join(tmpdir(), `bm-${id}.wav`);
  const outPath = join(tmpdir(), `bm-${id}.flac`);

  try {
    writeFileSync(inPath, wavBuffer);

    const result = spawnSync(
      'ffmpeg',
      ['-y', '-i', inPath, '-c:a', 'flac', outPath],
      { encoding: 'buffer' },
    );

    if (result.status !== 0) {
      const stderr = result.stderr?.toString() ?? 'unknown error';
      throw new Error(`ffmpeg conversion failed: ${stderr.slice(-300)}`);
    }

    return readFileSync(outPath);
  } finally {
    try { unlinkSync(inPath); }  catch { /* ignore */ }
    try { unlinkSync(outPath); } catch { /* ignore */ }
  }
}
