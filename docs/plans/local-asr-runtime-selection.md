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
4. `faster-whisper-large-v3-gpu`
   - GPU accuracy baseline.
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

First run downloads the selected model unless
`CODEX_WIDGET_ASR_FASTER_WHISPER_LOCAL_FILES_ONLY=1` is set.

## GPU Enablement

The GPU candidate wiring is already present, but should be dogfooded after the
CPU path works. Configure NVIDIA CUDA 12 and cuDNN 9 for `faster-whisper`, then
run:

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

The expected first default is `faster-whisper-large-v3-turbo-cpu`, promoted to
`faster-whisper-large-v3-turbo-gpu` when CUDA is available and stable.
