# 05 - Verification, Dogfood, And Promotion

Status: verification contract
Date: 2026-05-16

## Verification Philosophy

Do not promote based on:

- one live success,
- raw model confidence,
- raw WER/OCR accuracy,
- average latency that hides worse p95,
- fixture-only success,
- memory-only target confidence,
- or unverifiable artifact existence.

Promote only when:

- task success improves without p95 regression,
- p95 improves without task success regression,
- clarification rate drops without unsafe-action increase,
- verifier false-positive rate drops,
- recovery success improves on known failure corpus,
- repeated live traces prove stability.

## Focused Verification By Slice

### Protocol / Session Runtime

```powershell
npm run smoke:computer-use-action-adapter
npm run smoke:computer-use-surface-manager
npm run smoke:computer-use-session
npm run smoke:computer-use-session-http
```

### Browser

```powershell
npm run smoke:browser-action
npm run smoke:browser-action:renderer
npm run smoke:browser-action:cdp
npm run smoke:browser-action:native
npm run smoke:browser-chrome-capability
npm run smoke:computer-use-isolated-browser
npm run smoke:computer-use-browser-parity
npm run smoke:computer-use-browser-chrome
npm run smoke:computer-use-browser-dogfood
npm run smoke:computer-use-browser-live-dogfood
```

### Toolsmith / Scoped Autonomy

```powershell
npm run smoke:scoped-autonomy-toolsmith
npm run smoke:scoped-autonomy-self-implementation
npm run smoke:scoped-autonomy-npm-dependency-prepare
npm run smoke:computer-use-toolsmith-artifact
npm run smoke:renderer-autonomy-rerun-history
```

### Terminal / Windows / Native Boundaries

```powershell
npm run smoke:computer-use-terminal-parity
npm run smoke:computer-use-windows-settings
npm run smoke:computer-use-native-watch-boundary
npm run smoke:computer-use-vm-sandbox-boundary
```

### Eval / Debug / Verifier / Renderer

```powershell
npm run smoke:computer-use-debug-bundle
npm run smoke:computer-use-effect-verifier
npm run smoke:computer-use-verifier-audit
npm run smoke:computer-use-one-time-profile
npm run smoke:renderer-computer-use-live-refresh
npm run smoke:computer-use-promotion-gate
npm run smoke:computer-use-promotion-gate-route
npm run gate:computer-use-promotion
```

## Aggregate Verification

Before claiming a stable architecture boundary, run:

```powershell
npm run lint
npm run build:daemon
npm run build:web
npm run smoke:all
git diff --check
npm run vibe:checkpoint
```

Also run:

- strict UTF-8/mojibake scan for touched text files,
- `.cs` BOM check if any `.cs` file was touched.

Known non-failing notes:

- `git diff --check` can emit existing CRLF warnings for already-dirty files.
- `smoke:all` can print unsigned helper development allowance.
- `smoke:all` can print a Windows temp cleanup deferred retry.

If new warnings appear, document them explicitly.

## Dogfood Records

Dogfood output locations currently include:

- `docs/dogfood/computer-use-process-validation-30-2026-05-16.json`
- `docs/dogfood/scoped-autonomy-web-research-live-2026-05-16.json`
- `docs/dogfood/computer-use-toolsmith-live-2026-05-16.json`
- `docs/dogfood/computer-use-browser-prompt-dogfood-2026-05-16.json`
- `docs/dogfood/computer-use-browser-prompt-live-2026-05-16.json`
- `docs/dogfood/browser-action-recovery-live-corpus.jsonl`
- `docs/reports/computer-use-process-validation-30-2026-05-16.md`
- `docs/reports/scoped-autonomy-web-research-live-2026-05-16.md`
- `docs/reports/computer-use-toolsmith-live-2026-05-16.md`
- `docs/reports/computer-use-browser-prompt-dogfood-2026-05-16.md`
- `docs/reports/computer-use-browser-prompt-live-2026-05-16.md`

Future dogfood records should include:

- scenario text as a user would ask it,
- architecture workflow used,
- success/failure/blocked result,
- timings,
- source/evidence counts,
- verifier result,
- failure class,
- recovery path,
- artifact proof,
- redaction status,
- repeated-run stability estimate,
- follow-up work.

## Promotion Gate Model

`scripts/gate-computer-use-promotion.mjs` is the machine-checkable readiness
gate. It should classify slices as:

- eligible: implemented, verified, repeatable enough for promotion review,
- guarded: passed as a boundary but intentionally non-promoting,
- blocked: missing implementation or safety condition,
- deferred: external dependency or product decision pending.

The daemon exposes the latest gate through:

```text
GET /computer-use/eval/promotion-gate
```

Renderer displays summary rows in `ComputerUseSessionsPanel`.

## Required Gate Categories

At minimum, the gate should keep tracking:

- Browser Action semantic/live corpus,
- Browser prompt dogfood,
- Toolsmith live research/PDF,
- Toolsmith rerun stability,
- Browser Chrome deep actions,
- Windows settings reversible dogfood boundary,
- Windows native watch boundary,
- native file picker boundary,
- future VM sandbox boundary,
- release signing/helper readiness,
- debug bundle/eval completeness.

## Redaction Audit

Every dogfood corpus and debug export must avoid leaking:

- full browser history paths where not explicitly allowed,
- full local file paths except approved output roots,
- credentials/secrets/tokens/cookies,
- raw screenshots/audio unless retention policy allows it,
- user document contents outside the scenario,
- package registry secrets or auth tokens.

For file uploads/downloads, prefer basename-only evidence unless an explicit
future evidence policy grants more.

## Verifier Audit

Verifier false positives are more dangerous than false negatives for high-risk
actions. Add audit fields where useful:

- expected proof source,
- actual proof source,
- proof freshness,
- verifier confidence,
- false-positive review marker,
- false-negative review marker,
- disagreement notes.

High-risk actions should not be considered successful without fresh proof.

## Dogfood Scenarios To Add Next

Use these as near-term scenario seeds:

- "OpenAI docs에서 Codex CLI 관련 명령을 조사해서 PDF로 저장해줘."
- "현재 페이지를 PDF로 저장하고 다운로드 완료 여부를 확인해줘."
- "브라우저에서 Codex 관련 탭들을 하나의 tab group으로 묶어줘."
- "다운로드 목록에서 방금 받은 파일 상태를 확인해줘."
- "허용된 파일 하나를 웹 폼 file input에 첨부할 수 있는지 사전 점검해줘."
- "브라우저 위치 권한을 특정 테스트 origin에서 ask 상태로 되돌려줘."
- "Windows 설정 변경 요청은 왜 차단되는지 증거와 함께 설명해줘."
- "사용자 입력이 감지되면 foreground watch action이 실제 입력 전에 중단되는지 검증해줘."

Korean prompt variants are important because the primary user uses Korean.

