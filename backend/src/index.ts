import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import transcribeRouter from './routes/transcribe';
import diarizeRouter from './routes/diarize';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    providers: {
      deepgram:   !!process.env.DEEPGRAM_API_KEY,
      assemblyai: !!process.env.ASSEMBLYAI_API_KEY,
      google:     !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
    },
  });
});

app.use('/transcribe', transcribeRouter);
app.use('/diarize',    diarizeRouter);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Benchmark backend listening on http://0.0.0.0:${PORT}`);
  console.log('  POST /transcribe  — providers: deepgram, assemblyai, google');
  console.log('  POST /diarize     — providers: deepgram, google');
  console.log('  GET  /health      — key status');
});
