#!/usr/bin/env python3
"""
CS450 Edge benchmark — runs faster-whisper STT + sherpa-onnx diarization
on the local AMI WAV files and prints a results table.
"""

import os, time, json, re, math
from pathlib import Path

ASSETS = Path(__file__).parent / "assets" / "ami"
MODELS_DIR = Path.home() / ".cache" / "cs450_benchmark"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

AMI_FILES = sorted(ASSETS.glob("*.wav"))

# ---------------------------------------------------------------------------
# Reference transcripts & RTTM (copied from amiData.ts)
# ---------------------------------------------------------------------------

import json as _json
try:
    with open("/tmp/ami_transcripts.json") as _f:
        TRANSCRIPTS = _json.load(_f)
except Exception:
    TRANSCRIPTS = {}

# ---------------------------------------------------------------------------
# WER
# ---------------------------------------------------------------------------

def normalize(text):
    text = text.lower()
    text = re.sub(r"[^a-z\s]", "", text)
    return text.split()

def wer(ref: str, hyp: str) -> float:
    r, h = normalize(ref), normalize(hyp)
    if not r:
        return 0.0
    d = [[0] * (len(h) + 1) for _ in range(len(r) + 1)]
    for i in range(len(r) + 1): d[i][0] = i
    for j in range(len(h) + 1): d[0][j] = j
    for i in range(1, len(r) + 1):
        for j in range(1, len(h) + 1):
            cost = 0 if r[i-1] == h[j-1] else 1
            d[i][j] = min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+cost)
    return d[len(r)][len(h)] / len(r)

# ---------------------------------------------------------------------------
# Audio duration
# ---------------------------------------------------------------------------

def wav_duration(path: Path) -> float:
    import wave
    with wave.open(str(path)) as wf:
        return wf.getnframes() / wf.getframerate()

# ---------------------------------------------------------------------------
# STT benchmark
# ---------------------------------------------------------------------------

def run_stt():
    from faster_whisper import WhisperModel
    results = {}
    for model_size, model_id in [("tiny", "tiny"), ("small.en", "small.en")]:
        print(f"\n[STT] Loading Whisper {model_size}...")
        model = WhisperModel(model_id, device="cpu", compute_type="int8")
        model_results = []
        for wav in AMI_FILES:
            meeting_id = wav.stem
            duration = wav_duration(wav)
            ref = TRANSCRIPTS.get(meeting_id, "")
            print(f"  Transcribing {meeting_id} ({duration:.1f}s)...", end=" ", flush=True)
            t0 = time.perf_counter()
            segments, _ = model.transcribe(str(wav), language="en")
            transcript = " ".join(s.text for s in segments).strip()
            latency = (time.perf_counter() - t0) * 1000
            rtf = latency / (duration * 1000) if duration > 0 else None
            w = wer(ref, transcript) if ref else None
            model_results.append({
                "meeting": meeting_id,
                "duration_s": round(duration, 2),
                "latency_ms": round(latency),
                "rtf": round(rtf, 3) if rtf else None,
                "wer_pct": round(w * 100, 1) if w is not None else None,
                "transcript_preview": transcript[:120],
            })
            print(f"latency={latency/1000:.2f}s  RTF={rtf:.3f}  WER={w*100:.1f}%" if (rtf and w is not None) else f"latency={latency/1000:.2f}s")
        results[f"whisper-{model_size}"] = model_results
        del model
    return results

# ---------------------------------------------------------------------------
# Diarization benchmark
# ---------------------------------------------------------------------------

def download_models():
    import urllib.request
    seg_dir = MODELS_DIR / "pyannote-seg-3-0"
    seg_dir.mkdir(exist_ok=True)
    seg_path = seg_dir / "model.onnx"
    if not seg_path.exists():
        url = "https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.onnx"
        print(f"  Downloading segmentation model...")
        urllib.request.urlretrieve(url, seg_path)
    emb_path = MODELS_DIR / "nemo_en_speakerverification_speakernet.onnx"
    if not emb_path.exists():
        url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_speakerverification_speakernet.onnx"
        print(f"  Downloading embedding model (SpeakerNet)...")
        urllib.request.urlretrieve(url, emb_path)
    return str(seg_path), str(emb_path)

def compute_der(ref_rttm: str, hyp_segments, duration: float) -> float:
    """Collar-free DER: (false alarm + missed + confusion) / total speech."""
    def parse_rttm(text):
        segs = []
        for line in text.strip().splitlines():
            p = line.split()
            if len(p) >= 9 and p[0] == "SPEAKER":
                segs.append((float(p[3]), float(p[3]) + float(p[4]), p[7]))
        return segs

    ref = parse_rttm(ref_rttm)
    if not ref or not hyp_segments:
        return None

    # Map hypothesis speaker IDs to labels sequentially
    spk_map = {}
    hyp = []
    for s in hyp_segments:
        spk = s.speaker if hasattr(s, "speaker") else s["speaker"]
        start = s.start if hasattr(s, "start") else s["start"]
        end = s.end if hasattr(s, "end") else s["end"]
        if spk not in spk_map:
            spk_map[spk] = f"SPK{len(spk_map):02d}"
        hyp.append((start, end, spk_map[spk]))

    # Frame-level comparison at 10ms resolution
    n = int(duration * 100)
    ref_frames = [""] * n
    hyp_frames = [""] * n
    for (s, e, spk) in ref:
        for i in range(int(s * 100), min(int(e * 100), n)):
            ref_frames[i] = spk
    for (s, e, spk) in hyp:
        for i in range(int(s * 100), min(int(e * 100), n)):
            hyp_frames[i] = spk

    ref_spk_sets = {}
    for i, spk in enumerate(ref_frames):
        if spk:
            ref_spk_sets.setdefault(spk, set()).add(i)

    # Hungarian-style greedy speaker mapping
    all_ref_spks = list({s for s in ref_frames if s})
    all_hyp_spks = list({s for s in hyp_frames if s})
    best_map = {}
    used = set()
    for rs in all_ref_spks:
        best_overlap, best_hs = -1, None
        for hs in all_hyp_spks:
            if hs in used:
                continue
            overlap = sum(1 for i in range(n) if ref_frames[i] == rs and hyp_frames[i] == hs)
            if overlap > best_overlap:
                best_overlap, best_hs = overlap, hs
        if best_hs:
            best_map[rs] = best_hs
            used.add(best_hs)

    total_ref = sum(1 for f in ref_frames if f)
    errors = 0
    for i in range(n):
        r, h = ref_frames[i], hyp_frames[i]
        if r and not h:
            errors += 1  # missed
        elif not r and h:
            errors += 1  # false alarm
        elif r and h and best_map.get(r) != h:
            errors += 1  # confusion
    return errors / total_ref if total_ref > 0 else None

def run_diarization(rttm_map: dict):
    try:
        import sherpa_onnx
    except ImportError:
        print("[DIARIZATION] sherpa-onnx not installed, skipping.")
        return {}

    print("\n[DIARIZATION] Downloading models if needed...")
    try:
        seg_path, emb_path = download_models()
    except Exception as e:
        print(f"[DIARIZATION] Model download failed: {e}")
        return {}

    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=seg_path),
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=emb_path),
        clustering=sherpa_onnx.FastClusteringConfig(num_clusters=-1, threshold=0.5),
        min_duration_on=0.2,
        min_duration_off=0.5,
    )
    sd = sherpa_onnx.OfflineSpeakerDiarization(config)

    results = []
    for wav in AMI_FILES:
        meeting_id = wav.stem
        duration = wav_duration(wav)
        ref_rttm = rttm_map.get(meeting_id, "")
        print(f"  Diarizing {meeting_id} ({duration:.1f}s)...", end=" ", flush=True)
        try:
            import wave, array
            with wave.open(str(wav)) as wf:
                raw = wf.readframes(wf.getnframes())
                samples = array.array("h", raw)
                audio = [s / 32768.0 for s in samples]

            t0 = time.perf_counter()
            segments = sd.process(audio).sort_by_start_time()
            latency = (time.perf_counter() - t0) * 1000
            rtf = latency / (duration * 1000) if duration > 0 else None
            der = compute_der(ref_rttm, segments, duration) if ref_rttm else None
            print(f"latency={latency/1000:.2f}s  RTF={rtf:.3f}  DER={der*100:.1f}%  speakers={len({s.speaker for s in segments})}" if (rtf and der is not None) else f"latency={latency/1000:.2f}s  {len(segments)} segments")
            results.append({
                "meeting": meeting_id,
                "duration_s": round(duration, 2),
                "latency_ms": round(latency),
                "rtf": round(rtf, 3) if rtf else None,
                "der_pct": round(der * 100, 1) if der is not None else None,
                "num_speakers": len({s.speaker for s in segments}),
                "num_segments": len(segments),
            })
        except Exception as e:
            print(f"ERROR: {e}")
            results.append({"meeting": meeting_id, "error": str(e)})
    return {"sherpa-speakernet": results}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

try:
    with open("/tmp/ami_rttm.json") as _f:
        RTTM_MAP = _json.load(_f)
except Exception:
    RTTM_MAP = {}

def main():
    print("=" * 60)
    print("CS450 EDGE BENCHMARK")
    print("=" * 60)

    all_results = {}

    print("\n>>> STT")
    stt = run_stt()
    all_results["stt"] = stt

    print("\n>>> DIARIZATION")
    diarz = run_diarization(RTTM_MAP)
    all_results["diarization"] = diarz

    out = Path(__file__).parent / "benchmark_results.json"
    with open(out, "w") as f:
        json.dump(all_results, f, indent=2)
    print(f"\n\nResults saved to {out}")

    # Print summary table
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    for model, rows in stt.items():
        latencies = [r["latency_ms"] for r in rows if r.get("latency_ms")]
        rtfs = [r["rtf"] for r in rows if r.get("rtf")]
        wers = [r["wer_pct"] for r in rows if r.get("wer_pct") is not None]
        print(f"\n{model}:")
        print(f"  Avg latency : {sum(latencies)/len(latencies)/1000:.2f}s")
        print(f"  Avg RTF     : {sum(rtfs)/len(rtfs):.3f}")
        if wers: print(f"  Avg WER     : {sum(wers)/len(wers):.1f}%")
    for model, rows in diarz.items():
        valid = [r for r in rows if r.get("latency_ms")]
        if not valid: continue
        latencies = [r["latency_ms"] for r in valid]
        rtfs = [r["rtf"] for r in valid if r.get("rtf")]
        ders = [r["der_pct"] for r in valid if r.get("der_pct") is not None]
        print(f"\n{model}:")
        print(f"  Avg latency : {sum(latencies)/len(latencies)/1000:.2f}s")
        if rtfs: print(f"  Avg RTF     : {sum(rtfs)/len(rtfs):.3f}")
        if ders: print(f"  Avg DER     : {sum(ders)/len(ders):.1f}%")

if __name__ == "__main__":
    main()
