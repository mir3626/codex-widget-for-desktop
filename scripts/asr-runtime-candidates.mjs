import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");

export const ASR_RUNTIME_CANDIDATES = [
  {
    id: "faster-whisper-large-v3-turbo-cpu",
    family: "faster-whisper",
    model: "large-v3-turbo",
    device: "cpu",
    computeType: "int8",
    priority: 1,
    recommended: true,
    purpose: "Default CPU-only dogfood candidate for Korean voice commands before GPU enablement.",
    tradeoff: "Fastest practical Whisper-quality path, but CPU large-v3-turbo latency still depends heavily on host CPU."
  },
  {
    id: "faster-whisper-large-v3-cpu",
    family: "faster-whisper",
    model: "large-v3",
    device: "cpu",
    computeType: "int8",
    priority: 2,
    recommended: true,
    purpose: "Accuracy baseline for Korean/mixed-language command traces.",
    tradeoff: "Most conservative quality baseline, but slower and heavier than turbo."
  },
  {
    id: "faster-whisper-small-cpu",
    family: "faster-whisper",
    model: "small",
    device: "cpu",
    computeType: "int8",
    priority: 3,
    recommended: false,
    purpose: "Low-resource CPU fallback candidate for latency stress tests.",
    tradeoff: "Lower memory and latency, but Korean command-slot errors are more likely."
  },
  {
    id: "faster-whisper-large-v3-turbo-gpu",
    family: "faster-whisper",
    model: "large-v3-turbo",
    device: "cuda",
    computeType: "int8_float16",
    priority: 4,
    recommended: true,
    purpose: "Preferred GPU path when CUDA 12/cuDNN 9 are available.",
    tradeoff: "Best latency/quality balance, but requires working NVIDIA runtime libraries."
  },
  {
    id: "faster-whisper-large-v3-gpu",
    family: "faster-whisper",
    model: "large-v3",
    device: "cuda",
    computeType: "int8_float16",
    priority: 5,
    recommended: true,
    purpose: "GPU accuracy baseline against turbo.",
    tradeoff: "Higher VRAM and latency than turbo; useful for calibration, not default."
  },
  {
    id: "whisper-cpp-large-v3-turbo-cpu",
    family: "whisper.cpp",
    model: "large-v3-turbo",
    device: "cpu",
    computeType: "runtime",
    priority: 6,
    recommended: true,
    purpose: "Packaged native fallback candidate for CPU-first Windows distribution.",
    tradeoff: "Requires a built whisper-cli and ggml model path; wrapper parses CLI output."
  },
  {
    id: "whisper-cpp-medium-q5-cpu",
    family: "whisper.cpp",
    model: "medium-q5",
    device: "cpu",
    computeType: "q5",
    priority: 7,
    recommended: false,
    purpose: "Smaller native fallback when large-v3-turbo is too slow or too large.",
    tradeoff: "More likely to lose Korean app names, package names, and short deictic commands."
  },
  {
    id: "vosk-ko-small-cpu",
    family: "vosk",
    model: "vosk-model-small-ko-0.22",
    device: "cpu",
    computeType: "kaldi",
    priority: 8,
    recommended: false,
    purpose: "Tiny Korean offline fallback for command grammar experiments.",
    tradeoff: "Very small and fast, but significantly less accurate than Whisper-family models."
  }
];

export function getAsrCandidate(id) {
  return ASR_RUNTIME_CANDIDATES.find((candidate) => candidate.id === id) ?? null;
}

export function resolveAsrCandidate(id, options = {}) {
  const candidate = getAsrCandidate(id);
  if (!candidate) {
    throw new Error(`Unknown ASR candidate: ${id}`);
  }

  if (candidate.family === "faster-whisper") {
    return {
      ...candidate,
      command: quoteCommand([
        options.python ?? process.env.CODEX_WIDGET_ASR_PYTHON ?? pythonCommand(),
        path.join(repoRoot, "scripts", "asr-sidecar-faster-whisper.py")
      ]),
      env: {
        CODEX_WIDGET_ASR_FASTER_WHISPER_MODEL: candidate.model,
        CODEX_WIDGET_ASR_FASTER_WHISPER_DEVICE: candidate.device,
        CODEX_WIDGET_ASR_FASTER_WHISPER_COMPUTE_TYPE: candidate.computeType,
        CODEX_WIDGET_ASR_FASTER_WHISPER_BEAM_SIZE: options.beamSize ?? "5",
        CODEX_WIDGET_ASR_FASTER_WHISPER_VAD_FILTER: options.vadFilter ?? "1"
      }
    };
  }

  if (candidate.family === "whisper.cpp") {
    return {
      ...candidate,
      command: quoteCommand([
        process.execPath,
        path.join(repoRoot, "scripts", "asr-sidecar-whisper-cpp.mjs")
      ]),
      env: {
        CODEX_WIDGET_ASR_WHISPER_CPP_MODEL_KIND: candidate.model,
        CODEX_WIDGET_ASR_WHISPER_CPP_THREADS: options.threads ?? "",
        CODEX_WIDGET_ASR_WHISPER_CPP_GPU: candidate.device === "cuda" ? "1" : "0"
      }
    };
  }

  if (candidate.family === "vosk") {
    return {
      ...candidate,
      command: quoteCommand([
        options.python ?? process.env.CODEX_WIDGET_ASR_PYTHON ?? pythonCommand(),
        path.join(repoRoot, "scripts", "asr-sidecar-vosk.py")
      ]),
      env: {
        CODEX_WIDGET_ASR_VOSK_MODEL_NAME: candidate.model
      }
    };
  }

  throw new Error(`Unsupported ASR candidate family: ${candidate.family}`);
}

export function listAsrCandidates({ includeGpu = true } = {}) {
  return ASR_RUNTIME_CANDIDATES
    .filter((candidate) => includeGpu || candidate.device !== "cuda")
    .slice()
    .sort((left, right) => left.priority - right.priority);
}

export function quoteCommand(parts) {
  return parts.filter(Boolean).map((part) => quoteShellArg(String(part))).join(" ");
}

function quoteShellArg(value) {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

function pythonCommand() {
  return process.platform === "win32" ? "python" : "python3";
}
