# Local ASR Runtime Selection

This project now has concrete local ASR candidates behind the existing
`CODEX_WIDGET_ASR_SIDECAR_COMMAND` contract. The goal is to pick the most
efficient model by dogfooding workflow success, not just raw WER.

## Candidate Order

1. `faster-whisper-large-v3-turbo-cpu`
   - First CPU-only candidate.
   - Uses `large-v3-turbo`, `device=cpu`, `compute_type=int8`.
   - Best first pass for Korean command latency before GPU setup.
2. `faster-whisper-large-v3-cpu`
   - CPU accuracy baseline.
   - Slower, but useful to measure turbo regressions.
3. `faster-whisper-large-v3-turbo-gpu`
   - Preferred GPU path after CUDA/cuDNN is configured.
   - Uses `device=cuda`, `compute_type=int8_float16`.
   - Status: implemented but dogfood-deferred until GPU validation resumes.
4. `faster-whisper-large-v3-gpu`
   - GPU accuracy baseline.
   - Status: implemented but dogfood-deferred until GPU validation resumes.
5. `whisper-cpp-large-v3-turbo-cpu`
   - Native packaging fallback candidate.
   - Requires `whisper-cli` and a ggml model path.
6. `vosk-ko-small-cpu`
   - Tiny Korean fallback for constrained command grammar tests.
   - Not expected to beat Whisper-family models on natural Korean dictation.

Run:

```powershell
npm run asr:candidates -- --cpu-only
npm run asr:candidates -- --json
```

## CPU-Only Faster-Whisper Dogfood

Install into a local venv outside tracked source:

```powershell
python -m venv .runtime\asr\faster-whisper
.\.runtime\asr\faster-whisper\Scripts\python.exe -m pip install --upgrade pip
.\.runtime\asr\faster-whisper\Scripts\python.exe -m pip install faster-whisper
```

Run the first CPU candidate against a real WAV sample:

```powershell
$env:CODEX_WIDGET_ASR_PYTHON = "$PWD\.runtime\asr\faster-whisper\Scripts\python.exe"
npm run asr:benchmark -- --candidate faster-whisper-large-v3-turbo-cpu --audio C:\path\to\sample-ko-command.wav --expected "검색창에 브라우저 액션 테스트 입력하고 검색해줘"
```

Compare against the accuracy baseline:

```powershell
npm run asr:benchmark -- --candidate faster-whisper-large-v3-turbo-cpu,faster-whisper-large-v3-cpu --audio C:\path\to\sample-ko-command.wav --expected "검색창에 브라우저 액션 테스트 입력하고 검색해줘" --json
```

For repeatable Windows smoke samples, generate a synthetic SAPI corpus:

```powershell
npm run asr:tts-samples
$env:CODEX_WIDGET_ASR_PYTHON = "$PWD\.runtime\asr\faster-whisper\Scripts\python.exe"
$env:CODEX_WIDGET_ASR_FASTER_WHISPER_DOWNLOAD_ROOT = "$PWD\.runtime\asr\models\faster-whisper"
node scripts/benchmark-asr-candidates.mjs --candidate faster-whisper-large-v3-turbo-cpu,faster-whisper-large-v3-cpu --manifest "$PWD\.runtime\asr\samples\manifest.json" --json
```

First run downloads the selected model unless
`CODEX_WIDGET_ASR_FASTER_WHISPER_LOCAL_FILES_ONLY=1` is set.

## Human Microphone Corpus

Raw microphone audio stays under ignored `.runtime/` and must not be committed.
Prepare the local corpus scaffold:

```powershell
npm run asr:human-corpus
```

Recording the listed WAV files and running the human-corpus benchmark are
deferred by the 2026-05-14 product-owner decision. When that work resumes,
record the WAV files into `.runtime/asr/human-mic-corpus/`, then run the CPU
default in persistent mode:

```powershell
$env:CODEX_WIDGET_ASR_PYTHON = "$PWD\.runtime\asr\faster-whisper\Scripts\python.exe"
$env:CODEX_WIDGET_ASR_FASTER_WHISPER_DOWNLOAD_ROOT = "$PWD\.runtime\asr\models\faster-whisper"
node scripts/benchmark-asr-candidates.mjs --persistent --candidate faster-whisper-large-v3-turbo-cpu --manifest "$PWD\.runtime\asr\human-mic-corpus\manifest.json" --json
```

## Persistent Worker Latency

`scripts/asr-sidecar-faster-whisper.py --worker` keeps one Python process and
one loaded `WhisperModel` alive for newline-delimited JSON requests. The normal
single-request sidecar contract is unchanged for daemon compatibility.

Use the worker benchmark when measuring UX latency because the earlier CPU
baseline included process spawn plus model load for every utterance:

```powershell
node scripts/benchmark-asr-candidates.mjs --persistent --candidate faster-whisper-large-v3-turbo-cpu --manifest "$PWD\.runtime\asr\samples\manifest.json" --json
```

The first result from each candidate is marked `coldStart: true`; later results
show warm worker latency. Transcript diagnostics also include `workerMode`,
`modelLoaded`, and `modelLoadMs`.

## GPU Enablement (Deferred)

The GPU candidate wiring is already present, but GPU validation is deferred by
the 2026-05-14 product-owner decision. Do not install CUDA/cuDNN DLLs or rerun
CUDA candidates in the current ASR selection loop. Keep the commands below as a
reactivation checklist for the later GPU pass.

When GPU validation resumes, configure NVIDIA CUDA 12 and cuDNN 9 for
`faster-whisper`, then run:

```powershell
$env:CODEX_WIDGET_ASR_PYTHON = "$PWD\.runtime\asr\faster-whisper\Scripts\python.exe"
npm run asr:benchmark -- --candidate faster-whisper-large-v3-turbo-gpu --audio C:\path\to\sample-ko-command.wav --expected "검색창에 브라우저 액션 테스트 입력하고 검색해줘"
```

Equivalent daemon env:

```powershell
$env:CODEX_WIDGET_ASR_SIDECAR_COMMAND = "`"$PWD\.runtime\asr\faster-whisper\Scripts\python.exe`" `"$PWD\scripts\asr-sidecar-faster-whisper.py`""
$env:CODEX_WIDGET_ASR_FASTER_WHISPER_MODEL = "large-v3-turbo"
$env:CODEX_WIDGET_ASR_FASTER_WHISPER_DEVICE = "cuda"
$env:CODEX_WIDGET_ASR_FASTER_WHISPER_COMPUTE_TYPE = "int8_float16"
```

If CUDA libraries are not available, keep the CPU candidate as the default:

```powershell
$env:CODEX_WIDGET_ASR_FASTER_WHISPER_DEVICE = "cpu"
$env:CODEX_WIDGET_ASR_FASTER_WHISPER_COMPUTE_TYPE = "int8"
```

## Whisper.cpp Fallback

Configure a local `whisper-cli` binary and a ggml model:

```powershell
$env:CODEX_WIDGET_ASR_WHISPER_CPP_BIN = "C:\path\to\whisper-cli.exe"
$env:CODEX_WIDGET_ASR_WHISPER_CPP_MODEL = "C:\path\to\ggml-large-v3-turbo.bin"
npm run asr:benchmark -- --candidate whisper-cpp-large-v3-turbo-cpu --audio C:\path\to\sample-ko-command.wav
```

The wrapper asks `whisper-cli` for JSON output and falls back to cleaned stdout
if a build lacks JSON output support.

## Vosk Fallback

Use only as a constrained fallback:

```powershell
.\.runtime\asr\faster-whisper\Scripts\python.exe -m pip install vosk
$env:CODEX_WIDGET_ASR_PYTHON = "$PWD\.runtime\asr\faster-whisper\Scripts\python.exe"
$env:CODEX_WIDGET_ASR_VOSK_MODEL_DIR = "C:\path\to\vosk-model-small-ko-0.22"
npm run asr:benchmark -- --candidate vosk-ko-small-cpu --audio C:\path\to\sample-ko-command.wav
```

## Acceptance Criteria

Use the same audio corpus for every candidate:

- short Korean commands
- Korean plus English app/package names
- browser action prompts
- Windows settings prompts
- noisy keyboard/fan background
- pointer/deictic phrases such as "저 버튼" and "방금 뜬 오류"

Select the default by:

- command intent/slot preservation
- Browser/Windows workflow success rate
- p50/p95 latency
- clarification rate
- transcript correction rate
- memory and installation friction

The expected first default is `faster-whisper-large-v3-turbo-cpu`. Promotion to
`faster-whisper-large-v3-turbo-gpu` is deferred until GPU validation explicitly
resumes and CUDA is available and stable. Persistent worker latency must be
measured separately for CPU and future GPU candidates.

## 2026-05-13 CPU Baseline

`docs/reports/local-asr-cpu-benchmark-2026-05-13.md` records the first local
CPU run. On five synthetic Korean SAPI command samples, `large-v3-turbo-cpu`
averaged 14.25s per sidecar request while `large-v3-cpu` averaged 20.41s. Both
preserved normalized command slots. GPU probing reached the CUDA boundary on an
RTX 3060 Ti but failed until `cublas64_12.dll` / CUDA 12 runtime libraries are
installed and visible on `PATH`. The 2026-05-14 product-owner decision defers
that DLL install and GPU retest; the next ASR evidence should focus on human
microphone Korean command samples and persistent-worker latency. The worker
harness is now implemented with `--persistent`; collect human microphone audio
before changing the default beyond `large-v3-turbo-cpu`.

Human microphone recording and the follow-up human-corpus persistent benchmark
were deferred on 2026-05-14. Until that is explicitly resumed, use the SAPI
persistent worker baseline as the current local evidence and keep
`large-v3-turbo-cpu` as the default.

## 2026-05-14 Persistent Worker Baseline

`docs/reports/local-asr-persistent-worker-cpu-benchmark-2026-05-14.md` records
the first persistent worker CPU run. On the same five synthetic Korean SAPI
samples, `large-v3-turbo-cpu` had a 22.65s cold first request including 7.92s of
model load, then averaged 12.52s across warm requests with normalized similarity
1.00. This confirms persistent mode is required for widget dogfood, but human
microphone samples are still needed before final model selection. That recording
and benchmark pass is deferred until explicitly resumed.
