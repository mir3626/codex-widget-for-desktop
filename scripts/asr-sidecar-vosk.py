#!/usr/bin/env python3
import json
import os
import sys
import time
import uuid
import wave

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def main() -> int:
    request = json.load(sys.stdin)
    validate_request(request)

    fixture_text = os.environ.get("CODEX_WIDGET_ASR_FIXTURE_TEXT", "").strip()
    if fixture_text:
        write_json(build_fixture_transcript(request, fixture_text))
        return 0

    model_dir = os.environ.get("CODEX_WIDGET_ASR_VOSK_MODEL_DIR", "").strip()
    if not model_dir:
        sys.stderr.write("CODEX_WIDGET_ASR_VOSK_MODEL_DIR must point to an unpacked Vosk model directory.\n")
        return 41

    try:
        from vosk import KaldiRecognizer, Model
    except Exception as exc:
        sys.stderr.write(f"vosk is not installed. Run `python -m pip install vosk`. Import error: {exc}\n")
        return 40

    started = time.perf_counter()
    model = Model(model_dir)
    transcript_segments = []
    texts = []

    for segment in request.get("segments", []):
        path = segment.get("path")
        if not path:
            raise ValueError("Vosk sidecar requires segment.path for real transcription.")
        if not os.path.exists(path):
            raise FileNotFoundError(path)
        with wave.open(path, "rb") as audio:
            recognizer = KaldiRecognizer(model, audio.getframerate())
            recognizer.SetWords(True)
            while True:
                data = audio.readframes(4000)
                if len(data) == 0:
                    break
                recognizer.AcceptWaveform(data)
            result = json.loads(recognizer.FinalResult())
        text = str(result.get("text", "")).strip()
        if not text:
            continue
        confidence = average_word_confidence(result.get("result", []))
        start_ms = int(segment.get("startMs", 0) or 0)
        end_ms = int(segment.get("endMs", start_ms) or start_ms)
        transcript_segments.append({
            "id": f"vosk:{segment.get('id', len(transcript_segments))}",
            "startMs": start_ms,
            "endMs": end_ms,
            "text": text,
            "confidence": confidence,
        })
        texts.append(text)

    confidence = average([item["confidence"] for item in transcript_segments], 0.7)
    write_json({
        "id": f"transcript-{uuid.uuid4()}",
        "createdAt": iso_now(),
        "language": request.get("language"),
        "text": " ".join(texts).strip(),
        "confidence": confidence,
        "segments": transcript_segments,
        "diagnostics": {
            "engine": "vosk",
            "modelDir": model_dir,
            "elapsedMs": round((time.perf_counter() - started) * 1000),
        },
    })
    return 0


def validate_request(request):
    if request.get("schemaVersion") != "codex-widget-asr-sidecar.v1":
        raise ValueError("Unsupported ASR sidecar schemaVersion.")
    if not isinstance(request.get("segments"), list):
        raise ValueError("ASR sidecar request must include segments[].")


def build_fixture_transcript(request, text):
    first = (request.get("segments") or [{}])[0]
    return {
        "id": f"transcript-{uuid.uuid4()}",
        "createdAt": iso_now(),
        "language": request.get("language"),
        "text": text,
        "confidence": 0.99,
        "segments": [{
            "id": f"vosk-fixture:{first.get('id', 'segment')}",
            "startMs": int(first.get("startMs", 0) or 0),
            "endMs": int(first.get("endMs", first.get("startMs", 0)) or 0),
            "text": text,
            "confidence": 0.99,
        }],
        "diagnostics": {"engine": "vosk-fixture", "fixture": True},
    }


def average_word_confidence(words):
    values = [float(item.get("conf")) for item in words if isinstance(item, dict) and isinstance(item.get("conf"), (int, float))]
    return average(values, 0.7)


def average(values, fallback):
    clean = [float(value) for value in values if isinstance(value, (float, int))]
    if not clean:
        return fallback
    return max(0.0, min(1.0, sum(clean) / len(clean)))


def iso_now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def write_json(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        sys.stderr.write(f"{type(error).__name__}: {error}\n")
        raise SystemExit(1)
