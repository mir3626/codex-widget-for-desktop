#!/usr/bin/env python3
import argparse
import json
import math
import os
import sys
import time
import uuid

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


class MissingFasterWhisperError(Exception):
    pass


class FasterWhisperRuntime:
    def __init__(self, args):
        self.args = args
        self.model = None
        self.settings = None

    def get_settings(self):
        if self.settings is not None:
            return self.settings
        model_name = self.args.model or env("CODEX_WIDGET_ASR_FASTER_WHISPER_MODEL", "large-v3-turbo")
        device = self.args.device or env("CODEX_WIDGET_ASR_FASTER_WHISPER_DEVICE", "cpu")
        compute_type = self.args.compute_type or env(
            "CODEX_WIDGET_ASR_FASTER_WHISPER_COMPUTE_TYPE",
            "int8_float16" if device == "cuda" else "int8",
        )
        self.settings = {
            "modelName": model_name,
            "device": device,
            "computeType": compute_type,
            "cpuThreads": int(env("CODEX_WIDGET_ASR_FASTER_WHISPER_CPU_THREADS", "0") or "0"),
            "beamSize": int(env("CODEX_WIDGET_ASR_FASTER_WHISPER_BEAM_SIZE", "5") or "5"),
            "vadFilter": read_bool(env("CODEX_WIDGET_ASR_FASTER_WHISPER_VAD_FILTER", "1")),
            "localFilesOnly": read_bool(env("CODEX_WIDGET_ASR_FASTER_WHISPER_LOCAL_FILES_ONLY", "0")),
            "downloadRoot": env("CODEX_WIDGET_ASR_FASTER_WHISPER_DOWNLOAD_ROOT", "") or None,
        }
        return self.settings

    def get_model(self):
        settings = self.get_settings()
        if self.model is not None:
            return self.model, settings, None
        try:
            from faster_whisper import WhisperModel
        except Exception as exc:
            raise MissingFasterWhisperError(
                "faster-whisper is not installed. Create a venv and run "
                "`python -m pip install faster-whisper`, then retry. "
                f"Import error: {exc}"
            ) from exc
        started = time.perf_counter()
        self.model = WhisperModel(
            settings["modelName"],
            device=settings["device"],
            compute_type=settings["computeType"],
            cpu_threads=settings["cpuThreads"],
            download_root=settings["downloadRoot"],
            local_files_only=settings["localFilesOnly"],
        )
        return self.model, settings, round((time.perf_counter() - started) * 1000)


def main() -> int:
    args = parse_args()
    runtime = FasterWhisperRuntime(args)
    if args.worker:
        return run_worker(runtime)

    request = json.load(sys.stdin)
    write_json(transcribe_request(runtime, request, worker_mode=False))
    return 0


def run_worker(runtime) -> int:
    for line in sys.stdin:
        raw = line.strip()
        if not raw:
            continue
        try:
            request = json.loads(raw)
        except Exception as exc:
            write_json_line(build_worker_error(None, exc))
            continue
        request_id = request.get("requestId")
        if request.get("command") == "shutdown":
            write_json_line({
                "schemaVersion": "codex-widget-asr-worker-response.v1",
                "requestId": request_id,
                "ok": True,
                "shutdown": True,
            })
            return 0
        try:
            result = transcribe_request(runtime, request, worker_mode=True)
            write_json_line({
                "schemaVersion": "codex-widget-asr-worker-response.v1",
                "requestId": request_id,
                "ok": True,
                "result": result,
            })
        except Exception as exc:
            write_json_line(build_worker_error(request_id, exc))
    return 0


def transcribe_request(runtime, request, worker_mode):
    validate_request(request)

    fixture_text = os.environ.get("CODEX_WIDGET_ASR_FIXTURE_TEXT", "").strip()
    if fixture_text:
        result = build_fixture_transcript(request, fixture_text, "faster-whisper-fixture")
        result["diagnostics"]["workerMode"] = "persistent" if worker_mode else "single-shot"
        return result

    started = time.perf_counter()
    model, settings, model_load_ms = runtime.get_model()
    language = normalize_language(request.get("language"))
    prompt = " ".join(str(item) for item in request.get("hints", []) if str(item).strip()) or None

    transcript_segments = []
    texts = []
    language_probability = None
    detected_language = language
    for segment in request.get("segments", []):
        path = segment.get("path")
        if not path:
            raise ValueError("faster-whisper sidecar requires segment.path for real transcription.")
        if not os.path.exists(path):
            raise FileNotFoundError(path)
        segments, info = model.transcribe(
            path,
            language=language,
            beam_size=settings["beamSize"],
            vad_filter=settings["vadFilter"],
            initial_prompt=prompt,
            condition_on_previous_text=False,
        )
        detected_language = getattr(info, "language", None) or detected_language
        language_probability = getattr(info, "language_probability", None)
        base_start_ms = int(segment.get("startMs", 0) or 0)
        for index, item in enumerate(list(segments)):
            text = str(getattr(item, "text", "") or "").strip()
            if not text:
                continue
            start_ms = base_start_ms + int(float(getattr(item, "start", 0.0)) * 1000)
            end_ms = base_start_ms + int(float(getattr(item, "end", 0.0)) * 1000)
            confidence = confidence_from_segment(item, language_probability)
            transcript_segments.append({
                "id": f"fw:{segment.get('id', 'segment')}:{index}",
                "startMs": start_ms,
                "endMs": max(start_ms, end_ms),
                "text": text,
                "confidence": confidence,
            })
            texts.append(text)

    text = " ".join(texts).strip()
    confidence = average([item["confidence"] for item in transcript_segments], fallback=language_probability or 0.8)
    return {
        "id": f"transcript-{uuid.uuid4()}",
        "createdAt": iso_now(),
        "language": detected_language,
        "text": text,
        "confidence": confidence,
        "segments": transcript_segments,
        "diagnostics": {
            "engine": "faster-whisper",
            "model": settings["modelName"],
            "device": settings["device"],
            "computeType": settings["computeType"],
            "beamSize": settings["beamSize"],
            "vadFilter": settings["vadFilter"],
            "languageProbability": language_probability,
            "workerMode": "persistent" if worker_mode else "single-shot",
            "modelLoaded": model_load_ms is not None,
            "modelLoadMs": model_load_ms,
            "elapsedMs": round((time.perf_counter() - started) * 1000),
        },
    }


def parse_args():
    parser = argparse.ArgumentParser(description="Codex Widget faster-whisper ASR sidecar")
    parser.add_argument("--model", default="")
    parser.add_argument("--device", default="")
    parser.add_argument("--compute-type", default="")
    parser.add_argument("--worker", action="store_true", help="Read JSON requests as newline-delimited worker input.")
    return parser.parse_args()


def validate_request(request):
    if request.get("schemaVersion") != "codex-widget-asr-sidecar.v1":
        raise ValueError("Unsupported ASR sidecar schemaVersion.")
    if not isinstance(request.get("segments"), list):
        raise ValueError("ASR sidecar request must include segments[].")


def build_fixture_transcript(request, text, engine):
    segments = []
    for index, segment in enumerate(request.get("segments", [])):
        segments.append({
            "id": f"{engine}:{segment.get('id', index)}",
            "startMs": int(segment.get("startMs", 0) or 0),
            "endMs": int(segment.get("endMs", segment.get("startMs", 0)) or 0),
            "text": text if index == 0 else "",
            "confidence": 0.99,
        })
    return {
        "id": f"transcript-{uuid.uuid4()}",
        "createdAt": iso_now(),
        "language": request.get("language"),
        "text": text,
        "confidence": 0.99,
        "segments": [segment for segment in segments if segment["text"]],
        "diagnostics": {"engine": engine, "fixture": True},
    }


def confidence_from_segment(segment, fallback):
    avg_logprob = getattr(segment, "avg_logprob", None)
    if isinstance(avg_logprob, (float, int)):
        return clamp(math.exp(float(avg_logprob)), 0.0, 1.0)
    if isinstance(fallback, (float, int)):
        return clamp(float(fallback), 0.0, 1.0)
    return 0.8


def average(values, fallback):
    clean = [float(value) for value in values if isinstance(value, (float, int))]
    if not clean:
        return clamp(float(fallback), 0.0, 1.0)
    return clamp(sum(clean) / len(clean), 0.0, 1.0)


def normalize_language(language):
    value = str(language or "").strip()
    if not value:
        return None
    aliases = {"ko-KR": "ko", "kr": "ko", "en-US": "en"}
    return aliases.get(value, value)


def read_bool(value):
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def env(name, fallback):
    return os.environ.get(name, fallback)


def clamp(value, low, high):
    return max(low, min(high, value))


def iso_now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def write_json(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))


def write_json_line(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def build_worker_error(request_id, error):
    return {
        "schemaVersion": "codex-widget-asr-worker-response.v1",
        "requestId": request_id,
        "ok": False,
        "errorType": type(error).__name__,
        "error": str(error),
    }


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except MissingFasterWhisperError as error:
        sys.stderr.write(f"{error}\n")
        raise SystemExit(40)
    except Exception as error:
        sys.stderr.write(f"{type(error).__name__}: {error}\n")
        raise SystemExit(1)
