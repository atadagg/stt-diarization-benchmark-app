# STT & Diarization Benchmark App

A React Native (Expo) benchmark harness for evaluating **on-device vs. cloud speech-to-text and speaker diarization**, built as part of CS450 (Edge-Cloud Continuum). It measures latency, Real-Time Factor (RTF), and Word Error Rate (WER) for on-device Whisper models against the AMI Meeting Corpus, and includes an **Orchestrator** that decides at runtime whether to route audio to the edge (on-device) or the cloud based on network state, battery level, user tier, and transcription confidence.

This work informs the architecture of [Mimi](https://apps.apple.com/app/mimi-ai-meeting-notes), an AI meeting-notes app that is migrating from an all-cloud STT pipeline to a Cloud-Edge Continuum.

See [`REPORT_DRAFT.md`](REPORT_DRAFT.md) and [`BENCHMARK_REPORT.md`](BENCHMARK_REPORT.md) for the full write-up of methodology and results.

## What's in here

The app has three tabs:

- **STT** ([`src/screens/STTScreen.tsx`](src/screens/STTScreen.tsx)) — runs on-device Whisper (via [whisper.rn](https://github.com/mybigday/whisper.rn)) against AMI test-split audio, reporting latency, RTF, and WER per model size (tiny / small.en).
- **Diarization** ([`src/screens/DiarizationScreen.tsx`](src/screens/DiarizationScreen.tsx)) — exercises the on-device speaker diarization pipeline (sherpa-onnx, pyannote-segmentation + NeMo SpeakerNet).
- **Orchestrator** ([`src/screens/OrchestratorScreen.tsx`](src/screens/OrchestratorScreen.tsx), [`src/orchestrator/`](src/orchestrator)) — probes device context (network reachability, battery, Low Power Mode), applies a priority-ordered routing policy to choose `edge` or `cloud`, executes the chosen path, and reports cost savings vs. an all-cloud baseline. A "Benchmark Mode" runs both paths in parallel for a side-by-side comparison.

A lightweight Express backend ([`backend/`](backend)) proxies cloud STT/diarization requests to Deepgram, AssemblyAI, and Google Cloud STT, and exposes a `/health` endpoint the Orchestrator uses to probe reachability and latency.

## Project layout

```
src/
  screens/        STT, Diarization, and Orchestrator tabs
  orchestrator/   Routing policy, device context probing, cloud client, pricing/savings model
  components/     Shared UI (model cards, audio selector)
  utils/          Model management, audio loading, AMI dataset loading, WER/metrics
  constants/      Model definitions and AMI dataset metadata
backend/
  src/providers/  Deepgram, AssemblyAI, Google Cloud STT integrations
  src/routes/     /transcribe and /diarize endpoints
scripts/          AMI dataset preparation, native module patches
benchmark.py      Standalone Python benchmark scripts (used to produce BENCHMARK_REPORT.md)
```

## Getting started

### Prerequisites

- Node.js, npm
- Expo CLI / EAS (for iOS builds, since on-device Whisper inference requires a native build — `whisper.rn` is not available in Expo Go)
- Xcode (for running on iOS)
- API keys for any cloud providers you want to exercise (Deepgram, AssemblyAI, Google Cloud STT)

### App setup

```bash
npm install
npx expo run:ios   # native build required for whisper.rn
```

### Backend setup

```bash
cd backend
npm install
cp .env.example .env   # fill in your own API keys — see below
npm run dev
```

`backend/.env` is git-ignored. You'll need:

- `DEEPGRAM_API_KEY`
- `ASSEMBLYAI_API_KEY`
- `GOOGLE_APPLICATION_CREDENTIALS` — path to a Google Cloud service account JSON key (also git-ignored; never commit this file)

### AMI dataset

The benchmark uses five meetings from the [AMI Meeting Corpus](https://groups.inf.ed.ac.uk/ami/corpus/) test split (ES2004a–d, IS1009a). Use [`scripts/prepare_ami.py`](scripts/prepare_ami.py) to fetch and prepare the audio into [`assets/ami/`](assets/ami).

## Results summary

| Model | Avg RTF | Avg WER | On-device size |
|-------|---------|---------|----------------|
| Whisper tiny | 0.049 | 31.1% | 75 MB |
| Whisper small.en | 0.200 | 26.0% | 465 MB |
| Deepgram Nova-2 (cloud) | ~0.05* | ~10% | 0 MB |
| Google STT v2 (cloud) | ~0.07* | ~13% | 0 MB |

Both on-device Whisper models are real-time capable (RTF < 1.0) on an iPhone 17 Pro. See [`REPORT_DRAFT.md`](REPORT_DRAFT.md) §4 for full per-meeting breakdowns and §5 for the Orchestrator's routing policy design.
