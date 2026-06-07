#!/usr/bin/env python3
"""Run only the diarization part."""
import sys
sys.path.insert(0, ".")
from benchmark import run_diarization, RTTM_MAP, AMI_FILES, wav_duration
import json
from pathlib import Path

results = run_diarization(RTTM_MAP)
out = Path("benchmark_diarz_results.json")
with open(out, "w") as f:
    json.dump(results, f, indent=2)

print("\nDIARIZATION SUMMARY")
for model, rows in results.items():
    valid = [r for r in rows if r.get("latency_ms")]
    if not valid: continue
    latencies = [r["latency_ms"] for r in valid]
    rtfs = [r["rtf"] for r in valid if r.get("rtf")]
    ders = [r["der_pct"] for r in valid if r.get("der_pct") is not None]
    print(f"\n{model}:")
    print(f"  Avg latency : {sum(latencies)/len(latencies)/1000:.2f}s")
    if rtfs: print(f"  Avg RTF     : {sum(rtfs)/len(rtfs):.3f}")
    if ders: print(f"  Avg DER     : {sum(ders)/len(ders):.1f}%")
