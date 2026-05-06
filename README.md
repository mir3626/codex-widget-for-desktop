# Codex Widget for Desktop

Windows 바탕화면에 상주하는 Tauri 기반 Codex 위젯입니다. 작은 데스크톱 위젯 창에서 Codex와 대화하고, 브라우저 DOM, 화면/비전, 터미널/PTY 컨텍스트를 로컬 daemon을 통해 연결하는 것을 목표로 합니다.

현재 상태는 dogfooding 가능한 개발/릴리스 후보 상태입니다. Chrome Web Store 또는 Microsoft Edge Add-ons 제출은 dogfooding 이후 처리하도록 `docs/release/deferred-gates.json`에 deferred gate로 기록되어 있습니다.

## 주요 기능

- Windows 데스크톱 위젯: Tauri WebView, tray, start-at-login, hide-to-tray, pin, opacity, resize
- 실시간 채팅: daemon WebSocket streaming, markdown/GFM table/code block 렌더링, reconnect snapshot replay
- Codex 런타임: 기본 `codex app-server` 세션 유지, `codex exec` fallback, approval/user-input 카드
- 모델/추론 레벨 선택: 위젯 UI와 환경변수로 설정 가능
- DOM 모드: Chrome/Edge extension 또는 bookmarklet/native host를 통한 active-tab DOM snapshot 수집
- Vision 모드: Windows screen capture helper, crop selector, OCR, image hash/diff metadata
- PTY 모드: one-shot command, persistent node-pty/ConPTY session, direct input/key/mouse forwarding
- 패키징: release exe, MSI, NSIS installer, bundled Node/OCR/PTY runtime
- 검증: release install smoke, release soak, browser-store packet, release readiness audit

## 시스템 요구사항

개발/빌드 기준:

- Windows 10/11
- Node.js `24+`
- npm
- Rust/Cargo, `rustup`
- Microsoft C++ Build Tools, `Desktop development with C++`
- Microsoft Edge WebView2 Runtime
- Codex CLI 로그인 가능한 환경

Windows C++ toolchain이 없으면 Tauri/Rust 빌드에서 `link.exe not found`가 발생합니다. Visual Studio Installer에서 `Desktop development with C++`를 추가하거나 아래 명령을 사용합니다.

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --norestart"
```

필요할 때 현재 PowerShell에 MSVC 환경을 로드합니다.

```powershell
.\scripts\use-msvc-env.ps1
```

## 설치 및 실행

### 1. 저장소 준비

```powershell
git clone https://github.com/mir3626/codex-widget-for-desktop.git
cd codex-widget-for-desktop
npm install
```

이미 저장소가 있다면 최신 상태를 받고 의존성을 맞춥니다.

```powershell
git pull
npm install
```

### 2. Codex CLI 로그인

기본 인증 방식은 `CODEX_WIDGET_AUTH_MODE=codex`입니다. 위젯의 **Sign in** 버튼은 필요할 때 Codex CLI 로그인 흐름을 실행합니다.

CLI에서 먼저 로그인해도 됩니다.

```powershell
codex login
```

로그아웃이 필요한 경우 전역 Codex 계정 상태를 직접 관리합니다.

```powershell
codex logout
```

위젯의 **Sign out**은 위젯 세션만 끊습니다. 사용자의 전역 Codex CLI 자격 증명을 삭제하지 않습니다.

### 3. 개발 모드 실행

```powershell
npm run dev
```

실행되면:

- Tauri 위젯 창이 열립니다.
- Vite renderer dev server는 `http://127.0.0.1:5173`에서 실행됩니다.
- widget daemon은 `ws://127.0.0.1:4128`에서 실행됩니다.
- `scripts/dev-hot.mjs`가 daemon TypeScript watch, rebuild, restart를 처리합니다.

Vite URL은 개발용 asset server입니다. 제품 화면은 브라우저 탭이 아니라 Tauri 위젯 창입니다.

### 4. dev server만 실행

Tauri 창 없이 renderer/daemon loop만 보고 싶을 때 사용합니다.

```powershell
npm run dev:services
```

### 5. 포트 충돌 해결

5173이 점유되어 있으면 Vite 실행이 막힙니다.

```powershell
$connections = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
$pids = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($processId in $pids) { Stop-Process -Id $processId -Force }
```

4128이 점유되어 있으면 daemon 실행이 막힙니다.

```powershell
$connections = Get-NetTCPConnection -LocalPort 4128 -State Listen -ErrorAction SilentlyContinue
$pids = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($processId in $pids) { Stop-Process -Id $processId -Force }
```

## 빌드 및 설치 파일 생성

### 웹/daemon/runtime 리소스 빌드

```powershell
npm run build:web
```

포함 작업:

- daemon TypeScript compile
- daemon standalone bundle 생성
- renderer Vite build
- bundled Node runtime 준비
- OCR runtime manifest 준비
- PTY runtime 준비

### Tauri release 빌드

```powershell
npm run build
```

결과물:

- `src-tauri/target/release/codex-widget-for-desktop.exe`
- `src-tauri/target/release/bundle/msi/Codex Widget_0.1.0_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/Codex Widget_0.1.0_x64-setup.exe`

설치된 앱은 user-installed Node.js에 의존하지 않습니다. 빌드 과정에서 daemon bundle, Node runtime, OCR runtime, PTY runtime이 Tauri resource로 포함됩니다.

### 설치 검증

NSIS 설치/실행/제거 smoke:

```powershell
npm run smoke:release-install
```

MSI 설치/실행/제거 smoke:

```powershell
npm run smoke:release-msi-install
```

전체 release gate:

```powershell
npm run release:verify
```

release candidate readiness:

```powershell
npm run release:readiness
```

현재 `browser-store-submission`은 dogfooding 이후 처리하도록 deferred 상태입니다. strict public-release gate는 실제 store 제출 후에만 통과합니다.

```powershell
node scripts/release-readiness.mjs --require-manual-gates
```

## 기본 UI 사용법

### 타이틀바

- 앱 아이콘/제목: 위젯 식별 영역
- 드래그 영역: 창 이동
- Pin 버튼: always-on-top 상태 전환
- Opacity slider: 위젯 투명도 조절
- Minimize: 최소화
- Maximize: 위젯 확대/복원
- Close: 앱 종료가 아니라 tray로 숨김

tray 메뉴에서 다시 보이기 또는 완전 종료를 할 수 있습니다.

### Sign in / Sign out

- 기본값은 Codex CLI 인증입니다.
- **Sign in** 클릭 시 Codex CLI 로그인 상태를 확인합니다.
- 로그인이 필요하면 브라우저 인증 흐름을 열 수 있습니다.
- 로그인 후 prompt를 입력하면 daemon이 Codex runtime에 요청을 전달합니다.
- **Sign out**은 위젯 세션 연결만 해제합니다.

### Prompt 입력

하단 입력창에 메시지를 입력하고 실행 버튼을 누릅니다. 응답은 streaming으로 표시됩니다.

지원되는 대화 UX:

- markdown
- GFM table
- code block
- link rendering
- multi-turn history
- response regenerate
- response branch
- reconnect snapshot replay

### 모델/추론 레벨

Prompt 영역 주변의 selector에서 모델과 reasoning effort를 선택합니다.

환경변수 기본값:

```powershell
$env:CODEX_WIDGET_MODEL="gpt-5.5"
$env:CODEX_WIDGET_REASONING_EFFORT="medium"
npm run dev
```

### New Chat

New chat은 visible chat history와 daemon-side Codex session/thread state를 함께 초기화합니다. 브라우저 새로고침과 다르게 hidden runtime state를 명시적으로 리셋합니다.

### Branch

Assistant 답변의 More menu에서 Branch를 선택하면:

- 현재 daemon runtime session을 새로 시작합니다.
- 선택한 user/assistant exchange를 다음 prompt에 one-shot branch context로 전달합니다.
- 이후 prompt에는 branch seed가 반복 주입되지 않습니다.

### Regenerate

Regenerate는 선택한 답변 이후의 visible message를 제거하고, daemon에 `regenerate.dropTurns`를 보내 Codex app-server thread도 같은 경계까지 rollback한 뒤 새 답변을 요청합니다.

### Read aloud

More menu의 read-aloud 기능은 브라우저/WebView speech API 기반입니다. 활성화 중에는 stop 상태로 전환됩니다.

## Agent 모드

Agent 모드는 일반 Codex 대화와 로컬 파일/작업 요청을 처리하는 기본 모드입니다.

동작 구조:

```text
Widget Renderer
  -> WebSocket
  -> Local Node Daemon
  -> Codex app-server
  -> Streamed response events
```

기본 runtime:

```powershell
CODEX_WIDGET_CODEX_RUNTIME=app-server
```

fallback runtime:

```powershell
$env:CODEX_WIDGET_CODEX_RUNTIME="exec"
npm run dev
```

기본 작업 디렉터리는 사용자 홈입니다. 위젯 소스 저장소가 아니라 사용자의 데스크톱 작업을 돕는 방향입니다.

```powershell
$env:CODEX_WIDGET_CODEX_WORKDIR="$HOME"
$env:CODEX_WIDGET_CODEX_SANDBOX="danger-full-access"
$env:CODEX_WIDGET_CODEX_APPROVAL_POLICY="on-request"
npm run dev
```

approval/user-input 요청이 오면 위젯 안에 interaction card가 표시됩니다. 사용자가 승인/거절/입력하면 daemon이 Codex app-server에 응답합니다.

## DOM 모드

DOM 모드는 현재 브라우저 페이지의 URL, 제목, 선택 텍스트, 본문 텍스트 등을 daemon에 전달하고 모델 요청에 컨텍스트로 붙입니다.

### Chrome/Edge extension 사용

1. `providers/browser-dom-extension` 폴더를 확인합니다.
2. Chrome 또는 Edge에서 extension 관리 페이지를 엽니다.
3. Developer mode를 켭니다.
4. **Load unpacked**로 `providers/browser-dom-extension` 폴더를 선택합니다.
5. 위젯 daemon이 `127.0.0.1:4128`에서 실행 중인지 확인합니다.
6. 브라우저에서 캡처할 탭을 연 뒤 extension action을 실행합니다.

extension Options에서 daemon snapshot URL을 바꿀 수 있습니다. 허용되는 URL은 local endpoint뿐입니다.

예:

```text
http://127.0.0.1:4128/providers/dom/snapshot
http://localhost:4128/providers/dom/snapshot
```

### DOM snapshot API 직접 호출

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:4128/providers/dom/snapshot `
  -ContentType application/json `
  -Body '{"url":"https://example.com","title":"Example","selection":"selected text","text":"page text"}'
```

### Bookmarklet fallback

브라우저 extension 없이 테스트하려면 아래 파일을 참고합니다.

```text
docs/providers/dom-snapshot-bookmarklet.js
```

### Native messaging host

선택적으로 `providers/browser-native-host`를 사용할 수 있습니다. extension은 native messaging host를 먼저 시도하고, 등록되어 있지 않으면 local HTTP POST로 fallback합니다.

검증:

```powershell
npm run smoke:dom
npm run smoke:extension
npm run smoke:browser-native-host
```

## Vision 모드

Vision 모드는 화면 snapshot, crop, OCR, image diff metadata를 daemon에 전달합니다.

### 위젯에서 캡처

1. 위젯에서 Vision 탭을 선택합니다.
2. Capture action을 실행합니다.
3. daemon이 Windows screen capture helper를 실행합니다.
4. 결과가 tool event로 표시되고 다음 모델 요청에 context/image input으로 붙습니다.

### Screen helper 직접 실행

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File providers/screen-capture-helper/capture-screen.ps1
```

daemon으로 직접 snapshot을 보낼 수도 있습니다.

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:4128/providers/screen/snapshot `
  -ContentType application/json `
  -Body '{"source":"manual","title":"Active desktop","description":"A settings dialog is open.","ocrText":"Visible screen text"}'
```

### Crop 설정

Settings에서 crop 값을 설정하거나 visual drag selector를 사용합니다.

환경변수:

```powershell
$env:CODEX_WIDGET_SCREEN_CROP_X="0"
$env:CODEX_WIDGET_SCREEN_CROP_Y="0"
$env:CODEX_WIDGET_SCREEN_CROP_WIDTH="1280"
$env:CODEX_WIDGET_SCREEN_CROP_HEIGHT="720"
npm run dev
```

### 이미지 크기/품질

```powershell
$env:CODEX_WIDGET_SCREEN_CAPTURE_MAX_WIDTH="1600"
$env:CODEX_WIDGET_SCREEN_CAPTURE_JPEG_QUALITY="72"
npm run dev
```

### OCR

OCR은 로컬에서만 실행됩니다.

우선순위:

1. 빌드에 포함된 bundled Tesseract runtime
2. 명시한 `CODEX_WIDGET_SCREEN_OCR_COMMAND`
3. PATH에서 찾은 `tesseract`
4. OCR 비활성/미사용

빌드 시 tessdata를 준비하려면:

```powershell
$env:CODEX_WIDGET_TESSDATA_LANGUAGES="eng,kor"
npm run build:ocr-runtime
```

수동 다운로드:

```powershell
npm run ocr:fetch-languages -- eng kor
```

런타임 OCR 설정:

```powershell
$env:CODEX_WIDGET_SCREEN_OCR_LANGUAGE="eng+kor"
$env:CODEX_WIDGET_SCREEN_OCR_MAX_CHARS="4000"
npm run dev
```

custom OCR command:

```powershell
$env:CODEX_WIDGET_SCREEN_OCR_COMMAND='tesseract "{image}" stdout -l eng+kor'
npm run dev
```

OCR preprocessing은 기본적으로 upscaled PNG를 OCR 입력으로 사용합니다. 비활성화:

```powershell
$env:CODEX_WIDGET_SCREEN_OCR_DISABLE_PREPROCESS="1"
npm run dev
```

### 이미지 변화 감지

daemon은 screen image hash, changed 여부, diff ratio, meaningful-change 여부를 계산합니다.

```powershell
$env:CODEX_WIDGET_SCREEN_DIFF_THRESHOLD="0.01"
npm run dev
```

검증:

```powershell
npm run smoke:screen
npm run smoke:screen-helper
npm run smoke:screen-helper:ocr
npm run smoke:screen-capture:live
```

## PTY / Terminal 모드

Terminal 모드는 명시적 shell command와 persistent PTY session을 지원합니다.

### One-shot command

채팅창에서 아래 형태를 입력합니다.

```text
/run Get-ChildItem
```

```text
$ pwd
```

```text
PS> Get-Process
```

fenced shell block도 인식합니다.

````markdown
```powershell
Get-ChildItem
```
````

명령 결과는 tool output으로 stream됩니다.

### Persistent PTY session

PTY session은 shell state를 유지합니다.

```text
/pty start
/pty pwd
/pty cd C:\Users\Tony\Desktop
/pty dir
/pty status
/pty stop
```

크기 변경:

```text
/pty resize 120x30
```

raw input:

```text
/pty write npm run dev
/pty key enter
/pty key ctrl-c
```

Terminal tab의 PTY viewport는 quick action과 direct input controls를 제공합니다.

### Direct terminal input

renderer-daemon protocol은 chat turn을 만들지 않고 `terminal.input`으로 text/key/mouse input을 보낼 수 있습니다. UI에서는 Terminal tab의 direct input row와 mouse-input toggle을 사용합니다.

지원 범위:

- text input
- Enter, Tab, Escape, Ctrl+C
- SGR click/release/drag/wheel forwarding
- idle PTY output broadcast

### 안전장치

command-oriented 요청에서 위험한 destructive pattern은 기본 차단됩니다.

허용이 필요할 때만:

```powershell
$env:CODEX_WIDGET_TERMINAL_ALLOW_DESTRUCTIVE="1"
npm run dev
```

기타 terminal 설정:

```powershell
$env:CODEX_WIDGET_TERMINAL_WORKDIR="$HOME"
$env:CODEX_WIDGET_TERMINAL_TIMEOUT_MS="60000"
$env:CODEX_WIDGET_TERMINAL_MAX_OUTPUT_CHARS="32000"
npm run dev
```

검증:

```powershell
npm run smoke:terminal
npm run smoke:terminal-session
npm run smoke:pty-runtime
```

## 인증 모드

### Codex 모드, 기본값

```powershell
$env:CODEX_WIDGET_AUTH_MODE="codex"
npm run dev
```

권장 모드입니다. 사용자는 OpenAI/API key를 위젯에 넣지 않습니다. Codex CLI 로그인 상태를 사용합니다.

### PKCE/OAuth proxy 실험

외부 backend가 `/oauth/authorize`, `/oauth/token`, streaming agent proxy를 제공할 때 사용합니다.

```powershell
$env:CODEX_WIDGET_AUTH_MODE="pkce"
$env:CODEX_WIDGET_AUTH_BASE_URL="https://auth.example.com"
$env:CODEX_WIDGET_OAUTH_CLIENT_ID="codex-widget"
$env:CODEX_WIDGET_AGENT_PROXY_URL="https://auth.example.com/agent/stream"
npm run dev
```

명시 URL override:

```powershell
$env:CODEX_WIDGET_OAUTH_AUTHORIZE_URL="https://auth.example.com/oauth/authorize"
$env:CODEX_WIDGET_OAUTH_TOKEN_URL="https://auth.example.com/oauth/token"
$env:CODEX_WIDGET_AGENT_PROXY_URL="https://auth.example.com/agent/stream"
npm run dev
```

proxy request는 `Authorization: Bearer <OAuth access token>`와 JSON body를 받습니다.

### Token 모드

이미 발급된 access token으로 로컬 개발할 때 사용합니다.

```powershell
$env:CODEX_WIDGET_AUTH_MODE="token"
$env:CODEX_WIDGET_AGENT_PROXY_URL="http://127.0.0.1:8787/agent/stream"
npm run dev
```

Token 모드에서 Sign in을 누르면 inline token form이 열리고, 입력값은 gitignored `.env`에 저장됩니다. 사용자가 직접 `.env`를 열 필요가 없습니다.

### Dev auth proxy

mock OAuth/proxy 응답이 필요할 때만 사용합니다.

```powershell
npm run dev:auth-proxy
```

또는:

```powershell
$env:CODEX_WIDGET_DEV_AUTH_PROXY="1"
npm run dev
```

## 환경변수 요약

`.env.example`에 기본값이 있습니다. 주요 항목:

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `CODEX_WIDGET_PORT` | `4128` | daemon WebSocket/HTTP port |
| `CODEX_WIDGET_AUTH_MODE` | `codex` | `codex`, `pkce`, `token` |
| `CODEX_WIDGET_MODEL` | `gpt-5.5` | 기본 모델 |
| `CODEX_WIDGET_REASONING_EFFORT` | `medium` | 기본 추론 레벨 |
| `CODEX_WIDGET_CODEX_RUNTIME` | `app-server` | `app-server` 또는 `exec` |
| `CODEX_WIDGET_CODEX_WORKDIR` | empty | Codex runtime workdir override |
| `CODEX_WIDGET_CODEX_SANDBOX` | `danger-full-access` | Codex sandbox policy |
| `CODEX_WIDGET_CODEX_APPROVAL_POLICY` | `on-request` | approval policy |
| `CODEX_WIDGET_TERMINAL_WORKDIR` | empty | terminal workdir override |
| `CODEX_WIDGET_TERMINAL_ALLOW_DESTRUCTIVE` | `0` | destructive command 허용 |
| `CODEX_WIDGET_SCREEN_CAPTURE_MAX_WIDTH` | `1600` | screen payload 최대 너비 |
| `CODEX_WIDGET_SCREEN_CAPTURE_JPEG_QUALITY` | `72` | JPEG 품질 |

## Browser store 제출

스토어 제출은 현재 dogfooding 이후로 deferred 처리되어 있습니다.

상태 파일:

```text
docs/release/deferred-gates.json
```

제출 runbook:

```text
docs/release/browser-store-submission.md
```

스토어 제출 패킷 생성:

```powershell
npm run release:browser-store-packet
```

검증:

```powershell
npm run smoke:browser-store
npm run release:readiness
```

실제 Chrome Web Store 제출 후:

```powershell
npm run release:confirm-browser-store -- --store chrome-web-store --submission-id <dashboard-submission-id>
node scripts/release-readiness.mjs --require-manual-gates
```

실제 Edge Add-ons 제출 후:

```powershell
npm run release:confirm-browser-store -- --store edge-add-ons --listing-url <listing-or-dashboard-url>
node scripts/release-readiness.mjs --require-manual-gates
```

## 검증 명령

일반 변경 후:

```powershell
npm run smoke:all
```

UI/chat layout 변경 후:

```powershell
npm run smoke:renderer-chat
```

Codex app-server protocol 변경 후:

```powershell
npm run smoke:app-server
npm run smoke:app-server:live
```

resident lifecycle 변경 후:

```powershell
npm run smoke:resident
npm run smoke:resident-soak
```

release 후보:

```powershell
npm run release:verify
npm run release:soak
npm run release:readiness
```

Tauri/Rust 변경 후:

```powershell
npm run smoke:tauri-supervisor
.\scripts\use-msvc-env.ps1
Push-Location src-tauri
cargo check --no-default-features
Pop-Location
```

## 문제 해결

### `link.exe not found`

MSVC C++ toolchain이 없습니다. Visual Studio Build Tools에 `Desktop development with C++`를 설치한 뒤 새 PowerShell을 열거나 `.\scripts\use-msvc-env.ps1`를 실행합니다.

### Sign in이 반응하지 않음

1. `CODEX_WIDGET_AUTH_MODE`가 의도한 값인지 확인합니다.
2. 기본 모드라면 `codex login`이 동작하는지 확인합니다.
3. daemon port `4128`이 열려 있는지 확인합니다.
4. dev auth proxy는 기본 인증 흐름이 아닙니다. mock proxy 실험 때만 `CODEX_WIDGET_DEV_AUTH_PROXY=1`을 사용합니다.

### Prompt 입력이 안 됨

Tauri drag region이 입력창 위에 겹치면 클릭이 막힐 수 있습니다. 최신 main에서는 titlebar/mascot drag와 prompt input이 분리되어 있습니다. UI 변경 후에는 아래를 실행합니다.

```powershell
npm run smoke:renderer-chat
```

### daemon 연결 실패

4128 확인:

```powershell
Get-NetTCPConnection -LocalPort 4128 -State Listen -ErrorAction SilentlyContinue
```

dev log 확인:

```powershell
Get-ChildItem dist\logs | Sort-Object LastWriteTime -Descending | Select-Object -First 5
```

### screen OCR이 동작하지 않음

`tesseract`가 PATH에 없거나 bundled OCR runtime이 비어 있을 수 있습니다.

```powershell
npm run smoke:ocr-runtime
npm run smoke:screen-helper:ocr
```

필요하면 언어 데이터를 가져옵니다.

```powershell
npm run ocr:fetch-languages -- eng kor
```

### PTY가 동작하지 않음

node-pty runtime 확인:

```powershell
npm run smoke:pty-runtime
```

pipe fallback을 강제하려면:

```powershell
$env:CODEX_WIDGET_TERMINAL_BACKEND="pipe"
npm run dev
```

### 위젯이 많은 리소스를 쓰는지 확인

```powershell
npm run smoke:resident
npm run smoke:resident-soak
```

release exe 기준 장시간 검증:

```powershell
npm run release:soak
```

## 프로젝트 구조

```text
src/                         React renderer
src-tauri/                   Tauri shell and native daemon supervisor
scripts/                     build, smoke, release, readiness scripts
providers/browser-dom-extension/
providers/browser-native-host/
providers/screen-capture-helper/
docs/context/                product, architecture, QA context
docs/providers/              provider payload examples
docs/release/                release/store/deferred gate runbooks
docs/reports/                generated reports and readiness evidence
dist/                        generated daemon/runtime/provider artifacts
dist-renderer/               Vite renderer build output
```

## 아키텍처 요약

```text
Tauri Desktop Widget
  - titlebar/window/tray/settings
  - React chat and provider UI
  - WebSocket client

Local Node Daemon
  - WebSocket + local HTTP endpoints
  - Codex app-server bridge
  - provider registry
  - terminal/session manager
  - screen/DOM snapshot ingestion

External/Local Providers
  - Browser extension/native host/bookmarklet
  - Windows screen capture helper/OCR
  - node-pty/ConPTY shell
```

daemon이 session authority입니다. Renderer는 client이고, provider들은 daemon protocol을 통해 같은 세션에 context/tool output을 붙입니다.
