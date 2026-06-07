import { Router, Request, Response } from 'express';
import multer from 'multer';
import { diarizeDeepgram } from '../providers/deepgram';
import { diarizeGoogle } from '../providers/google';
import { DiarizationProvider, DiarizeResponse, ErrorResponse } from '../types';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

router.post('/', upload.single('audio'), async (req: Request, res: Response<DiarizeResponse | ErrorResponse>) => {
  const provider = req.body.provider as DiarizationProvider;
  const durationSeconds = parseFloat(req.body.durationSeconds);
  const buffer = req.file?.buffer;

  if (!buffer)                return res.status(400).json({ error: 'Missing audio file (field: audio)' });
  if (!provider)              return res.status(400).json({ error: 'Missing provider (deepgram|google)' });
  if (isNaN(durationSeconds)) return res.status(400).json({ error: 'Missing or invalid durationSeconds' });

  const start = Date.now();

  try {
    let segments: DiarizeResponse['segments'];
    let transcript: string | undefined;

    switch (provider) {
      case 'deepgram': {
        const r = await diarizeDeepgram(buffer);
        segments   = r.segments;
        transcript = r.transcript;
        break;
      }
      case 'google':
        segments = await diarizeGoogle(buffer);
        break;
      default:
        return res.status(400).json({ error: `Unknown provider: ${provider as string}` });
    }

    const latencyMs = Date.now() - start;
    return res.json({
      segments,
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
