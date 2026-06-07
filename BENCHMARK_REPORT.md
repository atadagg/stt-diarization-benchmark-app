# Benchmark App — Readiness Report
_Generated: 2026-06-03_

---

## Setup Status

| Task | Status |
|---|---|
| `npm install` (616 packages) | ✅ Done |
| iOS deployment target → 15.5 | ✅ Fixed (`react-native-zip-archive` required 15.5, was 15.1) |
| `pod install` | ⏳ Blocked — Xcode on external SSD, not plugged in |
| Android linking | ✅ No blockers (gradle auto-links) |

---

## Metrics Collected Per Model Run

| Metric | Source | iOS | Android |
|---|---|---|---|
| Latency (ms) | Wall clock | ✅ | ✅ |
| RTF | latency ÷ audio duration | ✅ | ✅ |
| Memory (MB) | JS heap delta | ✅ | ✅ |
| WER | Levenshtein vs reference `.txt` | ✅ | ✅ |
| DER | Frame-based (10ms, 250ms collar) vs reference `.rttm` | ✅ | ✅ |
| Battery drain (%) | `expo-battery` before/after | ✅ | ✅ |
| Low power warning | `expo-battery` power state | ✅ iOS Low Power Mode | ✅ Android Battery Saver |

> **Note on memory:** JS heap delta only — does not capture native model allocations. Treat as a lower bound. Native memory (e.g. the 187 MB shown for Whisper tiny in the proposal screenshot) is reported by the models themselves.

> **Note on battery:** OS battery level resolution is ~1%. Drain readings are most meaningful when running back-to-back models on a discharging device. Make sure the device is **not** plugged in during benchmarking.

> **Note on Low Power Mode:** If the warning banner appears, CPU is throttled. Disable Low Power / Battery Saver before recording official benchmark numbers.

---

## Models

### STT Tab
All three models are wired up. Models are not bundled — they download in-app on first use.

| Model | Package | Size | Platforms |
|---|---|---|---|
| Whisper tiny | `whisper.rn` | 39M params, ~75 MB | iOS + Android |
| Whisper small.en | `whisper.rn` | 244M params, ~465 MB | iOS + Android |
| Vosk small-en | `react-native-vosk` | ~50 MB (downloads in-app) | iOS + Android |

### Diarization Tab
No free on-device models wired up yet. The screen, harness, DER computation, and RTTM reference loader are all ready — just needs a model plugged in.

**Candidates to evaluate next:**
- `sherpa-onnx` — on-device diarization, MIT licence, iOS + Android
- `pyannote` mobile export (ONNX)

---

## AMI Test Data (`ami_benchmark/`)

5 meetings from the standard test split, clipped to 5 minutes each.

| Meeting | Transcript | RTTM | Audio |
|---|---|---|---|
| ES2004a | ✅ 401 words | ✅ 41 segments | ❌ needs download |
| ES2004b | ✅ 519 words | ✅ 36 segments | ❌ needs download |
| ES2004c | ✅ 497 words | ✅ 40 segments | ❌ needs download |
| ES2004d | ✅ 740 words | ✅ 64 segments | ❌ needs download |
| IS1009a | ✅ 484 words | ✅ 47 segments | ❌ needs download |

**To get audio:**
1. Go to https://groups.inf.ed.ac.uk/ami/download/
2. Select **Headset Mix** for the 5 meetings above and download
3. Run:
```bash
python scripts/prepare_ami.py --audio-dir /path/to/downloaded/ami
```
This converts to 16 kHz mono WAV and pairs with the existing transcripts + RTTMs.

To prepare all 16 test-split meetings instead of just 5:
```bash
python scripts/prepare_ami.py --meetings 0 --audio-dir /path/to/downloaded/ami
```

---

## Steps to Run When Ready

```bash
# 1. Plug in SSD and make sure Xcode is the active developer tool
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer

# 2. Install iOS native dependencies
cd benchmark-app/ios && pod install && cd ..

# 3. Build and deploy
npx expo run:ios --device        # iPhone 15, connected via USB
npx expo run:android --device   # Motorola G05, USB debugging enabled
```

**Enabling USB debugging on the Motorola G05:**
Settings → About phone → tap Build number 7 times → Developer options → USB debugging ON

**Transferring AMI data to devices:**
- iPhone: AirDrop the meeting folders, or use the Files app
- Android: USB file transfer or `adb push ami_benchmark/ /sdcard/ami_benchmark/`

---

## In-App Benchmark Flow

For each meeting:

1. **STT tab**
   - PICK FILE → `audio.wav`
   - LOAD → `transcript.txt`
   - RUN each model → WER, RTF, latency, battery drain recorded automatically

2. **Diarization tab**
   - PICK FILE → `audio.wav`
   - LOAD → `diarization.rttm`
   - RUN each model → DER, RTF, latency, battery drain recorded automatically

---

## Known Issues / Limitations

| Issue | Impact | Notes |
|---|---|---|
| Memory reads are JS heap only | Memory numbers are underestimates | Native allocations not captured from JS |
| Battery resolution ~1% | Small drain may show as 0% | More useful across back-to-back runs |
| No diarization models yet | Diarization tab can't produce results | Architecture is ready, needs a model |
| AMI audio requires manual download | Can't test STT/DER without it | Edinburgh moved to download-basket system |
| `pod install` needs Xcode | iOS build blocked until SSD plugged in | Android unaffected |
