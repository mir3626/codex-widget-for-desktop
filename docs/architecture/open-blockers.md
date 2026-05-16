# Open Blockers

This file records items that should not be silently downgraded to complete.

## Browser Action App-Server Client Tool

- Status: `BLOCKED`
- Current path: daemon-owned simulated Browser Action tool runtime.
- Evidence: `src/daemon/agent-tools/appServerClientTool.ts` records the blocked
  app-server client-tool contract and safe fallback runtime.
- Required scope expansion: an official Codex app-server client-tool contract
  that defines schema advertisement, request ids, streaming tool-call events,
  user approval handoff, result/error delivery, persistence, and redaction.

## Windows UI Automation Browser Helper

- Status: bounded Rust native UI Automation helper implemented, with
  PowerShell fallback preserved for development/debug migration. Production
  Authenticode signing remains externally blocked on a certificate or CI signing
  service.
- Current path: `providers/browser-native-desktop-helper-rs/` builds
  `dist/browser-native-desktop-helper/browser-native-desktop-helper.exe`; the
  executable implements the existing `browser-native-desktop-helper.v1` JSON
  contract for browser-window-scoped `status`, `observe`, and bounded
  `execute` commands. The fallback script remains at
  `providers/browser-native-desktop-helper/browser-native-desktop-helper.ps1`.
- Evidence: `CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP=1` enables the native
  adapter, the daemon auto-discovers the bundled Rust helper before the
  PowerShell fallback when
  `CODEX_WIDGET_BROWSER_ACTION_NATIVE_DESKTOP_HELPER` is unset, and
  `npm run build:browser-native-desktop-helper`,
  `npm run smoke:browser-action:native`,
  `npm run smoke:browser-native-desktop-helper-native`,
  `npm run smoke:browser-native-desktop-helper`, and
  `npm run smoke:browser-native-desktop-helper:signature` cover mock, native,
  fallback contract, and signing-readiness paths.
- Remaining scope expansion: provide an Authenticode code-signing certificate
  or CI signing secret and enforce
  `CODEX_WIDGET_REQUIRE_SIGNED_HELPERS=1` in release verification. The helper
  stays bounded to browser windows and blocks `evaluate` and sensitive text.

## Restricted Browser Pages

- Status: intentional security boundary, not a bypass target.
- Current path: extension/CDP/native adapters report restricted or unsupported
  state and expose recovery text. The bounded Windows UIA helper may assist with
  browser chrome, permission prompts, and file picker boundaries when enabled.
- Required scope expansion: extension security restrictions must not be
  bypassed; any deeper recovery must stay inside the bounded native helper
  approval/audit path.

## Vision Context Real Local ASR

- Status: local runtime candidate sidecars implemented; final default selection
  remains dogfood-owned. The research architecture deterministic decoder is
  implemented on top of the current transcript contract, but production model
  promotion still requires human corpus evidence.
- Current path: mock ASR for deterministic tests plus executable JSON sidecar
  support through `CODEX_WIDGET_ASR_SIDECAR_COMMAND`. `npm run
  smoke:asr-sidecar` now locks the stdin/stdout JSON contract, transcript
  normalization, nonzero-exit handling, invalid JSON handling, and timeout
  behavior without selecting a production model. `scripts/asr-sidecar-faster-whisper.py`,
  `scripts/asr-sidecar-whisper-cpp.mjs`, and `scripts/asr-sidecar-vosk.py`
  implement the first candidate runtimes, with `npm run asr:candidates`,
  `npm run asr:benchmark`, and `npm run smoke:asr-runtime-candidates` covering
  profile selection and CPU fixture dispatch. The expected first default is
  `faster-whisper-large-v3-turbo-cpu`, with GPU wiring available through
  `faster-whisper-large-v3-turbo-gpu`.
- Required scope expansion: install the chosen local ASR dependencies/models,
  collect a Korean command audio corpus, and choose the default by workflow
  success rate, latency, correction rate, memory, and installation friction.

## Research Architecture External Deferrals

- Status: implementation substrate complete; external or dogfood-owned items are
  still not complete.
- Current path: `docs/architecture/research-performance-architecture.md`
  defines the implemented eval ledger, deterministic ASR decoder, perception
  graph, ROI cascade, structured failure memory, and capability DAG scheduler.
- Required scope expansion: official app-server client-tool contract,
  production signing certificate/service, GPU ASR validation, human microphone
  corpus benchmark, and ASR fine-tuning/LoRA all remain deferred or externally
  blocked and must not be marked complete by architecture smoke success alone.

## Scoped Autonomy Toolsmith

- Status: implemented for bounded generated-tool workflows, with hardening still
  required before broader YOLO-style generation. The daemon can store scoped
  permission profiles, detect capability gaps, materialize runtime tools, require
  smoke success, execute staged DAG nodes, rerun from generated-tool manifests,
  and link Markdown/PDF/download/terminal artifacts into eval evidence.
- Current path: `src/daemon/scoped-autonomy/`,
  `src/shared/protocol/scopedAutonomy.ts`, storage schema v5, Computer Session
  schema v7 snapshots, `npm run smoke:scoped-autonomy-self-implementation`, and
  `npm run smoke:scoped-autonomy-generated-tool-live-breadth`.
- Implemented capability classes: `web_research_to_pdf`,
  `local_document_conversion`, `terminal_generated_tool`, and
  `browser_download_verify`, with 2026-05-16 dogfood evidence.
- Required scope expansion: unrestricted arbitrary code synthesis, unsandboxed
  external package installation, unattended Windows settings mutation, live
  authenticated crawling, credential access, and native high-risk mutation remain
  blocked or deferred until sandboxing, signing, review, and user-facing grant
  controls are stronger.

## Mascot Motion Assets

- Status: implementation path exists; final acceptance remains asset-quality
  dependent.
- Current path: renderer uses authored sprite-sheet assets and smoke coverage
  verifies frame progression.
- Required scope expansion: if product-owner dogfood still rejects current
  motion quality, regenerate or author improved pose/expression sheets rather
  than adding transform-only proxy motion.
