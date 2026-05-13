# Local ASR CPU Benchmark - 2026-05-13

## Setup

- Runtime: `faster-whisper` installed in ignored local venv `.runtime/asr/faster-whisper`.
- Samples: 5 synthetic Korean command WAV files generated with Windows SAPI `Microsoft Heami Desktop - Korean`.
- Manifest: `.runtime/asr/samples/manifest.json` (local runtime artifact, not tracked).
- Report JSON: `.runtime/asr/reports/faster-whisper-cpu-comparison.json` (local runtime artifact, not tracked).
- Benchmark command:

```powershell
$env:CODEX_WIDGET_ASR_PYTHON = "$PWD\.runtime\asr\faster-whisper\Scripts\python.exe"
$env:CODEX_WIDGET_ASR_FASTER_WHISPER_DOWNLOAD_ROOT = "$PWD\.runtime\asr\models\faster-whisper"
$env:CODEX_WIDGET_ASR_SIDECAR_TIMEOUT_MS = "900000"
node scripts/benchmark-asr-candidates.mjs --candidate faster-whisper-large-v3-turbo-cpu,faster-whisper-large-v3-cpu --manifest "$PWD\.runtime\asr\samples\manifest.json" --json
```

## Results

| Candidate | Samples | Avg elapsed | Min | Max | Avg confidence | Avg normalized similarity |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `faster-whisper-large-v3-turbo-cpu` | 5 | 14.25s | 14.11s | 14.53s | 0.82 | 1.00 |
| `faster-whisper-large-v3-cpu` | 5 | 20.41s | 19.35s | 21.70s | 0.84 | 1.00 |

Both candidates preserved the command intent/slots across browser search,
browser history, Windows settings, safe side-effect avoidance, and a mixed
Korean/English package-name command. `large-v3-turbo` was about 30% faster in
this sidecar-per-request setup.

## Observations

- `large-v3-turbo-cpu` is the correct first CPU default for local dogfood.
- `large-v3-cpu` remains useful as an accuracy baseline, but did not improve the
synthetic corpus enough to justify default latency.
- The benchmark currently measures process spawn plus model load for each
utterance. Real UX will need either a persistent ASR worker or a local service
mode if we want sub-second follow-up transcriptions.
- Synthetic SAPI audio is useful for smoke and regression, but human microphone
samples are still required before final model selection.
- The GPU candidate was probed on the local RTX 3060 Ti path and reached the
CUDA runtime boundary, but failed because `cublas64_12.dll` was unavailable:
  `Library cublas64_12.dll is not found or cannot be loaded`.
- GPU DLL installation and CUDA retesting are deferred by the 2026-05-14
product-owner decision; keep this as a reactivation note, not the immediate
next step.

## Recommendation

Keep `faster-whisper-large-v3-turbo-cpu` as the first local ASR default for
dogfood. Next, collect human Korean command WAV samples to validate noise,
microphone, and natural phrasing behavior, and prototype a persistent ASR
worker/service path to remove per-request model load latency. GPU testing stays
deferred until explicitly resumed.
