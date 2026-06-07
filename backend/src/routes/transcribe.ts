import { Router, Request, Response } from 'express';
import multer from 'multer';
import { transcribeDeepgram } from '../providers/deepgram';
import { transcribeAssemblyAI } from '../providers/assemblyai';
import { transcribeGoogle } from '../providers/google';
import { STTProvider, TranscribeResponse, ErrorResponse } from '../types';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

router.post('/', upload.single('audio'), async (req: Request, res: Response<TranscribeResponse | ErrorResponse>) => {
  const provider = req.body.provider as STTProvider;
  const durationSeconds = parseFloat(req.body.durationSeconds);
  const buffer = req.file?.buffer;

  if (!buffer)                return res.status(400).json({ error: 'Missing audio file (field: audio)' });
  if (!provider)              return res.status(400).json({ error: 'Missing provider (deepgram|assemblyai|google)' });
  if (isNaN(durationSeconds)) return res.status(400).json({ error: 'Missing or invalid durationSeconds' });

  const start = Date.now();

  try {
    let transcript: string;

    switch (provider) {
      case 'deepgram':   transcript = await transcribeDeepgram(buffer);   break;
      case 'assemblyai': transcript = await transcribeAssemblyAI(buffer); break;
      case 'google':     transcript = await transcribeGoogle(buffer);     break;
      default:           return res.status(400).json({ error: `Unknown provider: ${provider as string}` });
    }

    const latencyMs = Date.now() - start;
    return res.json({
      transcript,
      latencyMs,
      rtf: latencyMs / (durationSeconds * 1000),
      provider,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message, provider });
  }
});

export default router;
