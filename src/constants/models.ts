import { ModelConfig } from '../types/benchmark';

export const STT_MODELS: ModelConfig[] = [
  {
    id: 'whisper-tiny',
    name: 'Whisper tiny',
    description: 'whisper.rn — 39 M params, ~75 MB, fastest',
    platforms: ['ios', 'android'],
    category: 'stt',
  },
  {
    id: 'whisper-small-en',
    name: 'Whisper small.en',
    description: 'whisper.rn — 244 M params, ~465 MB, more accurate',
    platforms: ['ios', 'android'],
    category: 'stt',
  },
  {
    id: 'vosk',
    name: 'Vosk',
    description: 'react-native-vosk — lightweight offline ASR',
    platforms: ['ios', 'android'],
    category: 'stt',
  },
];

// Each entry: pyannote-seg-3-0 (6.6 MB shared) + embedding model
// id format: diarz-<embedding-key>  (embedding key matches EMBEDDING_SPECS in modelManager)
export const DIARIZATION_MODELS: (ModelConfig & { embeddingKey: string; totalMB: number })[] = [
  {
    id: 'diarz-speakernet',
    embeddingKey: 'speakernet',
    name: 'NeMo SpeakerNet',
    description: 'pyannote-seg-3-0 + NeMo SpeakerVerification — 29 MB',
    platforms: ['ios'],
    category: 'diarization',
    totalMB: 29,
  },
  {
    id: 'diarz-wespeaker-resnet34',
    embeddingKey: 'wespeaker-resnet34',
    name: 'WeSpeaker ResNet34',
    description: 'pyannote-seg-3-0 + WeSpeaker ResNet34-LM — 32 MB',
    platforms: ['ios'],
    category: 'diarization',
    totalMB: 32,
  },
  {
    id: 'diarz-3dspeaker-eres2net',
    embeddingKey: '3dspeaker-eres2net',
    name: '3D-Speaker ERes2Net',
    description: 'pyannote-seg-3-0 + 3D-Speaker ERes2Net — 32 MB',
    platforms: ['ios'],
    category: 'diarization',
    totalMB: 32,
  },
  {
    id: 'diarz-wespeaker-cam++',
    embeddingKey: 'wespeaker-cam++',
    name: 'WeSpeaker CAM++',
    description: 'pyannote-seg-3-0 + WeSpeaker CAM++-LM — 35 MB',
    platforms: ['ios'],
    category: 'diarization',
    totalMB: 35,
  },
  {
    id: 'diarz-3dspeaker-campplus',
    embeddingKey: '3dspeaker-campplus',
    name: '3D-Speaker CAMplus',
    description: 'pyannote-seg-3-0 + 3D-Speaker CAM++ — 35 MB',
    platforms: ['ios'],
    category: 'diarization',
    totalMB: 35,
  },
  {
    id: 'diarz-titanet-small',
    embeddingKey: 'titanet-small',
    name: 'NeMo TitaNet-S',
    description: 'pyannote-seg-3-0 + NeMo TitaNet-Small — 45 MB',
    platforms: ['ios'],
    category: 'diarization',
    totalMB: 45,
  },
  {
    id: 'diarz-wespeaker-resnet152',
    embeddingKey: 'wespeaker-resnet152',
    name: 'WeSpeaker ResNet152',
    description: 'pyannote-seg-3-0 + WeSpeaker ResNet152-LM — 82 MB',
    platforms: ['ios'],
    category: 'diarization',
    totalMB: 82,
  },
  {
    id: 'diarz-wespeaker-resnet221',
    embeddingKey: 'wespeaker-resnet221',
    name: 'WeSpeaker ResNet221',
    description: 'pyannote-seg-3-0 + WeSpeaker ResNet221-LM — 97 MB',
    platforms: ['ios'],
    category: 'diarization',
    totalMB: 97,
  },
  {
    id: 'diarz-titanet-large',
    embeddingKey: 'titanet-large',
    name: 'NeMo TitaNet-L',
    description: 'pyannote-seg-3-0 + NeMo TitaNet-Large — 103 MB',
    platforms: ['ios'],
    category: 'diarization',
    totalMB: 103,
  },
  {
    id: 'diarz-wespeaker-resnet293',
    embeddingKey: 'wespeaker-resnet293',
    name: 'WeSpeaker ResNet293',
    description: 'pyannote-seg-3-0 + WeSpeaker ResNet293-LM — 116 MB',
    platforms: ['ios'],
    category: 'diarization',
    totalMB: 116,
  },
];

export const ALL_MODELS: ModelConfig[] = [...STT_MODELS, ...DIARIZATION_MODELS];
