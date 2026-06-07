import RNFS from 'react-native-fs';

const DOCS = RNFS.DocumentDirectoryPath;

// ---------------------------------------------------------------------------
// STT — Whisper / Vosk paths & URLs
// ---------------------------------------------------------------------------

export const WHISPER_PATHS = {
  'whisper-tiny':     `${DOCS}/ggml-tiny.bin`,
  'whisper-small-en': `${DOCS}/ggml-small.en.bin`,
} as const;

const WHISPER_URLS = {
  'whisper-tiny':     'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
  'whisper-small-en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
} as const;


// ---------------------------------------------------------------------------
// Diarization — sherpa-onnx paths & URLs
// ---------------------------------------------------------------------------

const SHERPA_DIR = `${DOCS}/sherpa-onnx`;

// Shared pyannote segmentation model (downloaded once, used by all configs)
export const PYANNOTE_SEG_MODEL_PATH = `${SHERPA_DIR}/pyannote-seg-3-0/model.onnx`;
const PYANNOTE_SEG_URL =
  'https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.onnx';

export interface EmbeddingSpec {
  filename: string;
  url: string;
  sizeMB: number;
}

export const EMBEDDING_SPECS: Record<string, EmbeddingSpec> = {
  'speakernet': {
    filename: 'nemo_en_speakerverification_speakernet.onnx',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_speakerverification_speakernet.onnx',
    sizeMB: 22.3,
  },
  'wespeaker-resnet34': {
    filename: 'wespeaker_en_voxceleb_resnet34_LM.onnx',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34_LM.onnx',
    sizeMB: 25.3,
  },
  '3dspeaker-eres2net': {
    filename: '3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx',
    sizeMB: 25.3,
  },
  'wespeaker-cam++': {
    filename: 'wespeaker_en_voxceleb_CAM++_LM.onnx',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_CAM++_LM.onnx',
    sizeMB: 27.9,
  },
  '3dspeaker-campplus': {
    filename: '3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx',
    sizeMB: 28.2,
  },
  'titanet-small': {
    filename: 'nemo_en_titanet_small.onnx',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_titanet_small.onnx',
    sizeMB: 38.4,
  },
  'wespeaker-resnet152': {
    filename: 'wespeaker_en_voxceleb_resnet152_LM.onnx',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet152_LM.onnx',
    sizeMB: 75.5,
  },
  'wespeaker-resnet221': {
    filename: 'wespeaker_en_voxceleb_resnet221_LM.onnx',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet221_LM.onnx',
    sizeMB: 90.6,
  },
  'titanet-large': {
    filename: 'nemo_en_titanet_large.onnx',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_titanet_large.onnx',
    sizeMB: 96.7,
  },
  'wespeaker-resnet293': {
    filename: 'wespeaker_en_voxceleb_resnet293_LM.onnx',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet293_LM.onnx',
    sizeMB: 109.0,
  },
};

export function embeddingPath(key: string): string {
  return `${SHERPA_DIR}/${EMBEDDING_SPECS[key].filename}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WhisperModelId = keyof typeof WHISPER_PATHS;
export type DownloadableModelId = WhisperModelId;

export interface DownloadProgress {
  bytesWritten: number;
  contentLength: number;
  /** 0–100, or 0 if content-length unknown */
  percent: number;
}

// ---------------------------------------------------------------------------
// STT readiness checks
// ---------------------------------------------------------------------------

export async function isModelReady(id: DownloadableModelId): Promise<boolean> {
  try {
    return await RNFS.exists(WHISPER_PATHS[id]);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Diarization readiness checks
// ---------------------------------------------------------------------------

export async function isPyannoteSegReady(): Promise<boolean> {
  return RNFS.exists(PYANNOTE_SEG_MODEL_PATH);
}

export async function isEmbeddingReady(key: string): Promise<boolean> {
  return RNFS.exists(embeddingPath(key));
}

export async function isDiarizationModelReady(embeddingKey: string): Promise<boolean> {
  const [seg, emb] = await Promise.all([
    isPyannoteSegReady(),
    isEmbeddingReady(embeddingKey),
  ]);
  return seg && emb;
}

// ---------------------------------------------------------------------------
// STT downloads
// ---------------------------------------------------------------------------

export async function downloadModel(
  id: DownloadableModelId,
  onProgress: (p: DownloadProgress) => void,
): Promise<string> {
  return _downloadWhisper(id, onProgress);
}

async function _downloadWhisper(
  id: WhisperModelId,
  onProgress: (p: DownloadProgress) => void,
): Promise<string> {
  const dest = WHISPER_PATHS[id];
  if (await RNFS.exists(dest)) return dest;

  const { promise } = RNFS.downloadFile({
    fromUrl: WHISPER_URLS[id],
    toFile: dest,
    progressDivider: 1,
    progress: (res) => {
      onProgress({
        bytesWritten: res.bytesWritten,
        contentLength: res.contentLength,
        percent: res.contentLength > 0
          ? Math.round((res.bytesWritten / res.contentLength) * 100)
          : 0,
      });
    },
  });

  const res = await promise;
  if (res.statusCode !== 200) {
    await RNFS.unlink(dest).catch(() => {});
    throw new Error(`HTTP ${res.statusCode}`);
  }
  return dest;
}

// ---------------------------------------------------------------------------
// Diarization downloads
// ---------------------------------------------------------------------------

export async function downloadPyannoteSegmentation(
  onProgress: (p: DownloadProgress) => void,
): Promise<void> {
  if (await isPyannoteSegReady()) return;

  await RNFS.mkdir(`${SHERPA_DIR}/pyannote-seg-3-0`);

  const { promise } = RNFS.downloadFile({
    fromUrl: PYANNOTE_SEG_URL,
    toFile: PYANNOTE_SEG_MODEL_PATH,
    progressDivider: 1,
    progress: (res) => {
      onProgress({
        bytesWritten: res.bytesWritten,
        contentLength: res.contentLength,
        percent: res.contentLength > 0
          ? Math.round((res.bytesWritten / res.contentLength) * 100)
          : 0,
      });
    },
  });

  const res = await promise;
  if (res.statusCode !== 200) {
    await RNFS.unlink(PYANNOTE_SEG_MODEL_PATH).catch(() => {});
    throw new Error(`HTTP ${res.statusCode} downloading segmentation model`);
  }
}

export async function downloadEmbeddingModel(
  key: string,
  onProgress: (p: DownloadProgress) => void,
): Promise<void> {
  const spec = EMBEDDING_SPECS[key];
  if (!spec) throw new Error(`Unknown embedding key: ${key}`);

  const dest = embeddingPath(key);
  if (await RNFS.exists(dest)) return;

  await RNFS.mkdir(SHERPA_DIR);

  const { promise } = RNFS.downloadFile({
    fromUrl: spec.url,
    toFile: dest,
    progressDivider: 1,
    progress: (res) => {
      onProgress({
        bytesWritten: res.bytesWritten,
        contentLength: res.contentLength,
        percent: res.contentLength > 0
          ? Math.round((res.bytesWritten / res.contentLength) * 100)
          : 0,
      });
    },
  });

  const res = await promise;
  if (res.statusCode !== 200) {
    await RNFS.unlink(dest).catch(() => {});
    throw new Error(`HTTP ${res.statusCode} downloading ${spec.filename}`);
  }
}

// ---------------------------------------------------------------------------
// URI → filesystem path (strip file:// prefix for native APIs)
// ---------------------------------------------------------------------------
export function uriToPath(uri: string): string {
  return uri.startsWith('file://') ? decodeURIComponent(uri.slice(7)) : uri;
}
