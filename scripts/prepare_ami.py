#!/usr/bin/env python3
"""
AMI Meeting Corpus — benchmark data preparation script.

For each selected meeting this script produces three paired files:

  audio.wav          16 kHz mono WAV (IHM Mix-Headset)
  transcript.txt     plain-text reference transcript  (for WER)
  diarization.rttm   NIST RTTM diarization ground truth  (for DER)

Output layout
─────────────
  <output_dir>/
    ES2004a/
      audio.wav
      transcript.txt
      diarization.rttm
    IS1009a/
      ...

Data sources
────────────
  Audio        AMI corpus IHM Mix-Headset
               http://groups.inf.ed.ac.uk/ami/download/
               (auto-downloaded; pass --audio-dir if you already have it)

  Transcripts  AMI manual word-level annotations XML
               http://groups.inf.ed.ac.uk/ami/AMICorpusAnnotations/
               ami_public_manual_1.6.2.zip  (~50 MB, downloaded once)

  RTTM         pyannote/AMI-diarization-setup (only non-overlapping speech)
               https://github.com/pyannote/AMI-diarization-setup

Dependencies
────────────
  pip install -r scripts/requirements.txt
  ffmpeg must be on $PATH  (https://ffmpeg.org)

Usage
─────
  # Default: 5 meetings from the test split, clipped to 5 minutes each
  python scripts/prepare_ami.py

  # 3 meetings from the dev split, full length
  python scripts/prepare_ami.py --split dev --meetings 3 --clip 0

  # Use a local AMI audio directory (skips download)
  python scripts/prepare_ami.py --audio-dir /path/to/ami/audio

  # Skip audio entirely (transcript + RTTM only)
  python scripts/prepare_ami.py --skip-audio
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

try:
    import requests
    from tqdm import tqdm
except ImportError:
    sys.exit("Run:  pip install -r scripts/requirements.txt")


# ─── AMI split definitions (pyannote/AMI-diarization-setup) ────────────────

AMI_SPLITS: dict[str, list[str]] = {
    "test": [
        "ES2004a", "ES2004b", "ES2004c", "ES2004d",
        "IS1009a", "IS1009b", "IS1009c", "IS1009d",
        "TS3003a", "TS3003b", "TS3003c", "TS3003d",
        "EN2002a", "EN2002b", "EN2002c", "EN2002d",
    ],
    "dev": [
        "ES2011a", "ES2011b", "ES2011c", "ES2011d",
        "IS1008a", "IS1008b", "IS1008c", "IS1008d",
        "TS3007a", "TS3007b", "TS3007c", "TS3007d",
        "IB4001",  "IB4002",  "IB4003",  "IB4004",  "IB4005",  "IB4010",
    ],
}

# ─── Download URLs ──────────────────────────────────────────────────────────

# IHM Mix-Headset audio — AMI moved to a download-basket system; direct URLs
# no longer work. See _download_audio() for the manual download instructions.
AUDIO_URL = None  # handled in _download_audio()

# Manual word-level annotations — must use https://, the http:// URL redirects
# to an unrelated dataset on the same server.
ANNOTATIONS_URL = (
    "https://groups.inf.ed.ac.uk/ami/AMICorpusAnnotations"
    "/ami_public_manual_1.6.2.zip"
)

# RTTM files prepared by the pyannote team for their standard AMI split
RTTM_URL = (
    "https://raw.githubusercontent.com/pyannote/AMI-diarization-setup"
    "/main/only_words/rttms/{split}/{meeting_id}.rttm"
)

# NITE XML namespace
_NITE = "http://nite.sourceforge.net/"


# ─── Utility functions ──────────────────────────────────────────────────────

def check_ffmpeg() -> None:
    if shutil.which("ffmpeg") is None:
        sys.exit(
            "ffmpeg not found on PATH.\n"
            "Install it from https://ffmpeg.org and ensure it is in your PATH."
        )


def download_file(url: str, dest: Path, label: str = "") -> bool:
    """Stream-download url → dest with a progress bar. Returns True on success."""
    try:
        r = requests.get(url, stream=True, timeout=60)
        r.raise_for_status()
    except requests.RequestException as exc:
        print(f"    ✗ {label or url}: {exc}", file=sys.stderr)
        return False

    total = int(r.headers.get("content-length", 0))
    dest.parent.mkdir(parents=True, exist_ok=True)

    with open(dest, "wb") as fh, tqdm(
        desc=f"    {label or dest.name}",
        total=total,
        unit="B",
        unit_scale=True,
        leave=False,
    ) as bar:
        for chunk in r.iter_content(chunk_size=65536):
            fh.write(chunk)
            bar.update(len(chunk))

    return True


def ffmpeg_convert(src: Path, dst: Path, clip_sec: int | None) -> bool:
    """Re-encode src → dst as 16 kHz mono WAV, optionally clipping to clip_sec."""
    cmd = ["ffmpeg", "-y", "-i", str(src), "-ar", "16000", "-ac", "1"]
    if clip_sec:
        cmd += ["-t", str(clip_sec)]
    cmd.append(str(dst))
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        print(f"    ✗ ffmpeg error:\n{result.stderr.decode()}", file=sys.stderr)
        return False
    return True


# ─── Transcript extraction ──────────────────────────────────────────────────

def _nite_attr(element: ET.Element, attr: str) -> str | None:
    """Read a NITE-namespaced attribute, falling back to the bare name."""
    return element.get(f"{{{_NITE}}}{attr}") or element.get(attr)


def extract_transcript(annotations_dir: Path, meeting_id: str, max_time: float | None) -> str:
    """
    Parse AMI manual words XML files and return a plain-text transcript.

    All speakers' words are merged, sorted by start time, and joined by spaces.
    Vocalsound markers, gaps, and lone punctuation are removed.
    If max_time is provided, only words starting before that time are included.
    """
    words_dir = annotations_dir / "words"
    all_words: list[tuple[float, str]] = []

    for xml_path in sorted(words_dir.glob(f"{meeting_id}.*.words.xml")):
        try:
            tree = ET.parse(xml_path)
        except ET.ParseError:
            print(f"    ! could not parse {xml_path.name}", file=sys.stderr)
            continue

        for elem in tree.iter():
            # Strip namespace so we match <w> regardless of xmlns declaration
            tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
            if tag != "w":
                continue

            text = (elem.text or "").strip()

            # Skip empty text, noise markers [noise], vocalsounds, gaps
            if not text:
                continue
            if re.match(r"^[\[\(\<]", text):
                continue
            # Skip lone punctuation characters
            if re.match(r"^[^\w']+$", text):
                continue

            start_str = _nite_attr(elem, "starttime")
            try:
                start = float(start_str) if start_str else 0.0
            except ValueError:
                start = 0.0

            if max_time is not None and start >= max_time:
                continue

            all_words.append((start, text))

    all_words.sort(key=lambda x: x[0])
    return " ".join(w for _, w in all_words)


# ─── RTTM clipping ──────────────────────────────────────────────────────────

def clip_rttm(rttm_text: str, max_time: float) -> str:
    """
    Return an RTTM string filtered to segments that start before max_time.
    Segment durations are clamped so no segment extends past max_time.
    """
    lines: list[str] = []
    for line in rttm_text.splitlines():
        parts = line.split()
        if len(parts) < 5 or parts[0] != "SPEAKER":
            continue
        start = float(parts[3])
        if start >= max_time:
            continue
        dur = min(float(parts[4]), max_time - start)
        parts[3] = f"{start:.3f}"
        parts[4] = f"{dur:.3f}"
        lines.append(" ".join(parts))
    return "\n".join(lines) + "\n"


# ─── Per-meeting preparation ────────────────────────────────────────────────

def prepare_meeting(
    meeting_id: str,
    split: str,
    output_dir: Path,
    annotations_dir: Path,
    audio_src_dir: Path | None,
    clip_sec: int | None,
    skip_audio: bool,
) -> bool:
    out = output_dir / meeting_id
    out.mkdir(parents=True, exist_ok=True)
    success = True

    # ── Audio ───────────────────────────────────────────────────────────────
    audio_wav = out / "audio.wav"
    if skip_audio:
        print("    audio: skipped (--skip-audio)")
    elif audio_wav.exists():
        print("    audio.wav: already exists")
    else:
        raw_wav = out / "_raw.wav"

        if audio_src_dir:
            # Look for the file in a few reasonable locations
            candidates = [
                audio_src_dir / meeting_id / "audio" / f"{meeting_id}.Mix-Headset.wav",
                audio_src_dir / f"{meeting_id}.Mix-Headset.wav",
                audio_src_dir / meeting_id / f"{meeting_id}.Mix-Headset.wav",
            ]
            src = next((p for p in candidates if p.exists()), None)
            if src:
                shutil.copy(src, raw_wav)
            else:
                print(
                    f"    ✗ audio not found under {audio_src_dir} for {meeting_id}",
                    file=sys.stderr,
                )
                success = False
        else:
            # AMI audio is no longer available via direct URL — the Edinburgh
            # group moved to a download-basket system.
            #
            # To get the audio:
            #   1. Go to https://groups.inf.ed.ac.uk/ami/download/
            #   2. Under "Headset Mix" select the meetings you need and download
            #   3. Re-run this script with:
            #        --audio-dir /path/to/downloaded/ami/audio
            #
            # Expected filename per meeting: {meeting_id}.Mix-Headset.wav
            print(
                "    ✗ AMI audio requires manual download.\n"
                "      1. Visit https://groups.inf.ed.ac.uk/ami/download/\n"
                "      2. Select Headset Mix for your meetings and download\n"
                "      3. Re-run with:  --audio-dir /path/to/ami/audio",
                file=sys.stderr,
            )
            success = False

        if raw_wav.exists():
            print("    converting to 16 kHz mono WAV…")
            if ffmpeg_convert(raw_wav, audio_wav, clip_sec):
                size_mb = audio_wav.stat().st_size / 1_048_576
                print(f"    audio.wav  ({size_mb:.1f} MB)")
            else:
                success = False
            raw_wav.unlink(missing_ok=True)

    # ── Transcript ──────────────────────────────────────────────────────────
    transcript_path = out / "transcript.txt"
    if transcript_path.exists():
        print("    transcript.txt: already exists")
    else:
        max_time = float(clip_sec) if clip_sec else None
        text = extract_transcript(annotations_dir, meeting_id, max_time)
        if not text:
            print(f"    ✗ no transcript words found for {meeting_id}", file=sys.stderr)
            success = False
        else:
            transcript_path.write_text(text, encoding="utf-8")
            print(f"    transcript.txt  ({len(text.split())} words)")

    # ── RTTM ────────────────────────────────────────────────────────────────
    rttm_path = out / "diarization.rttm"
    if rttm_path.exists():
        print("    diarization.rttm: already exists")
    else:
        url = RTTM_URL.format(split=split, meeting_id=meeting_id)
        print("    downloading RTTM…")
        rttm_tmp = out / "_raw.rttm"
        if download_file(url, rttm_tmp, label="rttm"):
            rttm_text = rttm_tmp.read_text(encoding="utf-8")
            if clip_sec:
                rttm_text = clip_rttm(rttm_text, float(clip_sec))
            rttm_path.write_text(rttm_text, encoding="utf-8")
            rttm_tmp.unlink(missing_ok=True)
            seg_count = sum(1 for ln in rttm_text.splitlines() if ln.startswith("SPEAKER"))
            print(f"    diarization.rttm  ({seg_count} segments)")
        else:
            success = False

    return success


# ─── Annotations download + extraction ─────────────────────────────────────

def get_annotations_dir(cache_dir: Path) -> Path:
    """
    Download and extract ami_public_manual_1.6.2.zip if not already cached.
    Returns the path to the annotation root (the directory containing words/).

    The zip is flat — there is no single top-level folder. After extraction,
    words/ segments/ etc. live directly inside cache_dir, so we return
    cache_dir itself rather than a subdirectory.
    """
    marker = cache_dir / ".extracted"
    if marker.exists():
        return cache_dir

    zip_path = cache_dir / "ami_public_manual_1.6.2.zip"
    if not zip_path.exists():
        print("Downloading AMI manual annotations (~50 MB)…")
        if not download_file(ANNOTATIONS_URL, zip_path, label="ami_annotations.zip"):
            sys.exit("Failed to download AMI annotations.")

    print("Extracting annotations…")
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(cache_dir)
    marker.touch()

    if not (cache_dir / "words").is_dir():
        sys.exit(f"Expected a 'words/' directory in {cache_dir} after extraction — zip may be wrong.")
    print(f"  extracted to {cache_dir}\n")
    return cache_dir


# ─── Entry point ────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--output-dir", default="ami_benchmark",
        help="where to write prepared data (default: ami_benchmark)",
    )
    parser.add_argument(
        "--split", choices=["test", "dev"], default="test",
        help="AMI split to prepare (default: test)",
    )
    parser.add_argument(
        "--meetings", type=int, default=5, metavar="N",
        help="number of meetings to prepare, 0 = all in split (default: 5)",
    )
    parser.add_argument(
        "--clip", type=int, default=300, metavar="SECONDS",
        help="clip to first N seconds, 0 = full meeting (default: 300)",
    )
    parser.add_argument(
        "--audio-dir", metavar="DIR",
        help="path to existing AMI audio directory (skips audio download)",
    )
    parser.add_argument(
        "--skip-audio", action="store_true",
        help="skip audio download/conversion (transcript + RTTM only)",
    )
    args = parser.parse_args()

    if not args.skip_audio:
        check_ffmpeg()

    output_dir = Path(args.output_dir)
    audio_src_dir = Path(args.audio_dir) if args.audio_dir else None
    clip_sec = args.clip or None

    meetings = AMI_SPLITS[args.split]
    if args.meetings > 0:
        meetings = meetings[: args.meetings]

    print(f"\nAMI Benchmark Data Prep")
    print(f"  split    : {args.split}")
    print(f"  meetings : {', '.join(meetings)}")
    print(f"  clip     : {clip_sec}s" if clip_sec else "  clip     : full meeting")
    print(f"  output   : {output_dir.resolve()}\n")

    # Download annotations once for all meetings
    annotations_dir = get_annotations_dir(output_dir / "_cache" / "annotations")

    succeeded: list[str] = []
    failed: list[str] = []

    for meeting_id in meetings:
        print(f"[{meeting_id}]")
        ok = prepare_meeting(
            meeting_id=meeting_id,
            split=args.split,
            output_dir=output_dir,
            annotations_dir=annotations_dir,
            audio_src_dir=audio_src_dir,
            clip_sec=clip_sec,
            skip_audio=args.skip_audio,
        )
        (succeeded if ok else failed).append(meeting_id)
        print()

    print(f"{'─' * 50}")
    print(f"Done.  {len(succeeded)} succeeded, {len(failed)} failed.")
    if failed:
        print(f"Failed meetings: {', '.join(failed)}")

    print(f"\nData is in:  {output_dir.resolve()}")
    print(
        "\nTo benchmark on the app:\n"
        "  iOS   — AirDrop the meeting folder to the device\n"
        "  Android — copy via Android File Transfer or adb push\n\n"
        "  In the app:\n"
        "    1. PICK FILE  →  select audio.wav\n"
        "    2. LOAD       →  select transcript.txt  (STT tab)\n"
        "    3. LOAD       →  select diarization.rttm  (Diarization tab)\n"
        "    4. RUN        →  WER / DER shown automatically"
    )


if __name__ == "__main__":
    main()
