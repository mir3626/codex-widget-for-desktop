# Local ASR Persistent Worker CPU Benchmark - 2026-05-14

## Setup

- Runtime: `faster-whisper` in ignored local venv `.runtime/asr/faster-whisper`.
- Candidate: `faster-whisper-large-v3-turbo-cpu`.
- Mode: persistent JSONL worker via `scripts/asr-sidecar-faster-whisper.py --worker`.
- Samples: same 5 synthetic Korean SAPI command WAV files from the 2026-05-13 CPU baseline.
- Report JSON: `.runtime/asr/reports/faster-whisper-turbo-cpu-persistent-sapi.json` (local runtime artifact, not tracked).
- Benchmark command:

```powershell
$env:CODEX_WIDGET_ASR_PYTHON = "$PWD\.runtime\asr\faster-whisper\Scripts\python.exe"
$env:CODEX_WIDGET_ASR_FASTER_WHISPER_DOWNLOAD_ROOT = "$PWD\.runtime\asr\models\faster-whisper"
$env:CODEX_WIDGET_ASR_SIDECAR_TIMEOUT_MS = "900000"
node scripts/benchmark-asr-candidates.mjs --persistent --candidate faster-whisper-large-v3-turbo-cpu --manifest "$PWD\.runtime\asr\samples\manifest.json" --json
```

## Results

| Metric | Value |
| --- | ---: |
| Samples | 5 |
| Cold first request | 22.65s |
| Model load inside cold request | 7.92s |
| Warm request average | 12.52s |
| Warm request min | 11.04s |
| Warm request max | 13.95s |
| Average confidence | 0.823 |
| Average normalized similarity | 1.00 |

Per-sample elapsed times:

| Sample | Cold | Elapsed | Similarity |
| --- | ---: | ---: | ---: |
| `browser-search` | yes | 22.65s | 1.00 |
| `browser-back` | no | 12.51s | 1.00 |
| `windows-settings` | no | 12.60s | 1.00 |
| `safe-download` | no | 13.95s | 1.00 |
| `mixed-package` | no | 11.04s | 1.00 |

## Observations

- The worker keeps one Python process and one `WhisperModel` instance alive, so
  only the first request pays model load.
- Warm worker latency is lower than the previous single-shot average, but still
  too high for conversational follow-up unless we add streaming/shorter windows,
  a smaller candidate, or future GPU acceleration.
- The benchmark uses synthetic SAPI audio. Human microphone audio is still the
  required selection evidence because real phrasing, room noise, and microphone
  gain will change failure modes.

## Recommendation

Keep `faster-whisper-large-v3-turbo-cpu` as the CPU default, but treat
persistent worker mode as required for any real widget UX trial. Recording the
human microphone corpus scaffolded under `.runtime/asr/human-mic-corpus/` and
running the same `--persistent` benchmark are deferred by the 2026-05-14
product-owner decision.
