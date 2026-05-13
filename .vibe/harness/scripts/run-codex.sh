#!/usr/bin/env bash
#
# run-codex.sh — UTF-8-safe wrapper for `codex exec` on Korean Windows.
#
# WHY THIS EXISTS
# ---------------
# Korean Windows defaults to CP949 (chcp 949). When `codex exec` runs
# without UTF-8 forced, the Rust binary, its spawned subprocesses, and any
# .NET/Python tooling underneath fall back to system ANSI. The result: any
# non-ASCII string literal (Korean, Japanese, emoji, …) gets round-tripped
# through CP949 and unmappable bytes are silently replaced with `?`
# (e.g. `상점` round-trips into broken bytes like `?\x81\xec\xa0\x90`).
# This wrapper prevents that by
# forcing UTF-8 at every layer AND telling codex to propagate UTF-8 into
# every subshell it spawns via `shell_environment_policy`.
#
# It also handles transient model "at capacity" errors with backoff
# retries, and buffers stdin so retries work even when the prompt is
# piped in.
#
# USAGE
# -----
#   cat docs/prompts/task.md | ./.vibe/harness/scripts/run-codex.sh -
#   ./.vibe/harness/scripts/run-codex.sh "implement X per docs/prompts/task.md"
#
# ENV OVERRIDES
# -------------
#   CODEX_MODEL=gpt-5-codex        -> pass `-m <name>` to codex
#   CODEX_BIN=/path/to/codex       -> explicit codex executable path
#   CODEX_RETRY=3                  -> max retry attempts (default 3)
#   CODEX_SANDBOX=workspace-write  -> sandbox mode
#   CODEX_EXTRA_CONFIG="-c k=v"    -> extra `-c` overrides
#
# This wrapper is the ONLY supported Codex invocation path. Orchestrator
# sprint calls, `vibe:run-agent --provider codex`, and manual debugging
# all route through this script by piping a prompt file into
# `run-codex.sh -` (or passing the prompt as a positional arg).
# When a stdin prompt explicitly references allowed rule/context Markdown,
# the wrapper injects that Markdown body so "read this file" rules are not
# silently skipped.
# See docs/context/codex-execution.md for the full rationale.

set -euo pipefail

print_usage() {
  cat <<'EOF'
Usage:
  run-codex.sh --health|--version|--help
  cat prompt.md | run-codex.sh --diagnose-md-injection -
  cat prompt.md | run-codex.sh -
  run-codex.sh "prompt text"
EOF
}

RULES_FILE=".vibe/agent/_common-rules.md"
md_injection_diagnostic=0

is_wsl_host() {
  if [[ -n "${WSL_DISTRO_NAME:-}" || -n "${WSL_INTEROP:-}" ]]; then
    return 0
  fi

  grep -qiE '(microsoft|wsl)' /proc/version 2>/dev/null
}

reject_windows_codex_shim_in_wsl() {
  local codex_path="$1"

  if ! is_wsl_host; then
    return 0
  fi

  case "$codex_path" in
    /mnt/[a-zA-Z]/*|/c/*)
      echo "run-codex: WSL resolved codex to a Windows npm shim: $codex_path" >&2
      echo "run-codex: install node/codex inside WSL, or run the Windows wrapper .vibe\\harness\\scripts\\run-codex.cmd from PowerShell/cmd." >&2
      return 1
      ;;
  esac

  return 0
}

resolve_codex_path() {
  if [[ -n "${CODEX_BIN:-}" ]]; then
    printf '%s' "$CODEX_BIN"
    return 0
  fi

  command -v codex 2>/dev/null || true
}

run_health_check() {
  local codex_path

  codex_path="$(resolve_codex_path)"
  if [[ -z "$codex_path" ]]; then
    echo "run-codex: codex CLI not found in PATH" >&2
    return 1
  fi
  reject_windows_codex_shim_in_wsl "$codex_path" || return 1

  local tmp_stdout tmp_stderr rc pid watchdog v stderr_tail

  tmp_stdout="$(mktemp "${TMPDIR:-/tmp}/run-codex-health.XXXXXX")"
  tmp_stderr="$(mktemp "${TMPDIR:-/tmp}/run-codex-health.XXXXXX")"
  rc=0

  if command -v timeout >/dev/null 2>&1; then
    set +e
    timeout 5 "$codex_path" --version >"$tmp_stdout" 2>"$tmp_stderr"
    rc=$?
    set -e
  else
    "$codex_path" --version >"$tmp_stdout" 2>"$tmp_stderr" &
    pid=$!
    (
      sleep 5
      kill -TERM "$pid" 2>/dev/null || true
    ) &
    watchdog=$!

    set +e
    wait "$pid" 2>/dev/null
    rc=$?
    set -e

    kill -TERM "$watchdog" 2>/dev/null || true
    wait "$watchdog" 2>/dev/null || true
  fi

  if [[ $rc -eq 0 ]]; then
    v="$(
      awk '
        {
          for (i = 1; i <= NF; i++) {
            if ($i ~ /[0-9]+\.[0-9]+/) {
              print $i
              exit
            }
          }
        }
      ' "$tmp_stdout"
    )"
    if [[ -z "$v" ]]; then
      v="unknown"
    fi
    echo "codex-cli $v"
    rm -f "$tmp_stdout" "$tmp_stderr"
    return 0
  fi

  stderr_tail="$(tail -n 20 "$tmp_stderr" 2>/dev/null || true)"
  rm -f "$tmp_stdout" "$tmp_stderr"

  if printf '%s\n' "$stderr_tail" | grep -qiE '(not authenticated|login required|auth|OPENAI_API_KEY|unauthorized)'; then
    echo "run-codex: codex CLI present but authentication missing - run 'codex auth login' or set OPENAI_API_KEY" >&2
    return 2
  fi

  if [[ $rc -eq 124 || $rc -eq 143 ]]; then
    echo "run-codex: codex --version hung (>5s) - likely auth or config issue" >&2
    return 2
  fi

  echo "run-codex: codex --version failed (rc=$rc)" >&2
  if [[ -n "$stderr_tail" ]]; then
    printf '%s\n' "$stderr_tail" >&2
  fi
  return 3
}

retry_reason() {
  local rc stderr_file stderr_text

  rc="$1"
  stderr_file="$2"
  stderr_text="$(cat "$stderr_file" 2>/dev/null || true)"

  if printf '%s\n' "$stderr_text" | grep -qi 'at capacity'; then
    printf 'capacity'
    return 0
  fi

  if [[ $rc -eq 124 || $rc -eq 143 ]] || printf '%s\n' "$stderr_text" | grep -qi 'timeout'; then
    printf 'timeout'
    return 0
  fi

  printf 'exit=%s' "$rc"
}

retry_delay_for_attempt() {
  local attempt override

  attempt="$1"
  override="${CODEX_RETRY_DELAY:-}"

  if [[ -n "$override" && "$override" =~ ^[0-9]+$ ]]; then
    printf '%s' "$override"
    return 0
  fi

  printf '%s' "$((attempt * 30))"
}

token_suffix() {
  local tokens

  tokens="$(extract_token_count)"

  if [[ -n "$tokens" ]]; then
    printf ' tokens=%s' "$tokens"
  fi
}

extract_token_count() {
  local tokens

  tokens="$(
    tail -n 10 "$attempt_output" 2>/dev/null |
      tr -d '\r' |
      grep -Eio '(^|[^[:alnum:]_])tokens?[[:space:]:][^0-9]{0,19}[0-9]+' |
      tail -n 1 |
      grep -Eo '[0-9]+' || true
  )"

  if [[ -n "$tokens" ]]; then
    printf '%s' "$tokens"
  fi
}

resolve_sprint_id() {
  if [[ -n "${VIBE_SPRINT_ID:-}" ]]; then
    printf '%s' "$VIBE_SPRINT_ID"
    return 0
  fi

  local status_file sid
  status_file=".vibe/agent/sprint-status.json"
  if [[ ! -f "$status_file" ]]; then
    return 1
  fi

  sid="$(
    grep -Eo '"currentSprintId"[[:space:]]*:[[:space:]]*"[^"]*"' "$status_file" |
      sed -E 's/.*"currentSprintId"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/' |
      head -n 1 || true
  )"
  if [[ -n "$sid" && "$sid" != "idle" ]]; then
    printf '%s' "$sid"
    return 0
  fi

  return 1
}

iso_from_epoch() {
  local ts
  ts="$1"

  date -u -d "@$ts" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null ||
    date -u -r "$ts" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null ||
    return 1
}

status_tick_after_success() {
  local script_dir sprint_id tokens iso args tick_output tick_rc

  tokens="$(extract_token_count)"
  if [[ -z "$tokens" ]]; then
    echo "[run-codex] status-tick: skipped reason=no-tokens" >&2
    return 0
  fi

  if ! sprint_id="$(resolve_sprint_id)"; then
    echo "[run-codex] status-tick: skipped reason=no-sprint" >&2
    return 0
  fi

  script_dir="$(cd "$(dirname "$0")" && pwd)"
  args=("$script_dir/vibe-status-tick.mjs" --add-tokens "$tokens" --sprint "$sprint_id")
  if iso="$(iso_from_epoch "$start_ts")"; then
    args+=(--elapsed-start "$iso")
  fi

  set +e
  tick_output="$(node "${args[@]}" 2>&1)"
  tick_rc=$?
  set -e

  if [[ $tick_rc -eq 0 ]]; then
    echo "[run-codex] status-tick: ticked tokens=$tokens sprint=$sprint_id" >&2
    return 0
  fi

  echo "[run-codex] status-tick: skipped reason=cli-failed rc=$tick_rc ${tick_output}" >&2
}

agent_session_start() {
  if [[ "${VIBE_SKIP_AGENT_SESSION_START:-}" == "1" ]]; then
    return 0
  fi

  local script_dir script_path
  script_dir="$(cd "$(dirname "$0")" && pwd)"
  script_path="$script_dir/vibe-agent-session-start.mjs"

  if [[ ! -f "$script_path" ]] || ! command -v node >/dev/null 2>&1; then
    return 0
  fi

  node "$script_path" >&2 || true
}

attention_event() {
  if [[ "${VIBE_DISABLE_ATTENTION:-}" == "1" ]]; then
    return 0
  fi

  local severity title detail script_dir script_path
  severity="$1"
  title="$2"
  detail="$3"
  script_dir="$(cd "$(dirname "$0")" && pwd)"
  script_path="$script_dir/vibe-attention.mjs"

  if [[ ! -f "$script_path" ]] || ! command -v node >/dev/null 2>&1; then
    return 0
  fi

  node "$script_path" \
    --severity "$severity" \
    --title "$title" \
    --detail "$detail" \
    --source "codex-wrapper" \
    --provider "codex" >/dev/null 2>&1 || true
}

resolve_utf8_locale() {
  local available candidate

  if command -v locale >/dev/null 2>&1; then
    available="$(locale -a 2>/dev/null || true)"
    for candidate in C.UTF-8 C.utf8 en_US.UTF-8 en_US.utf8 UTF-8; do
      if printf '%s\n' "$available" | grep -Fxq "$candidate"; then
        printf '%s' "$candidate"
        return 0
      fi
    done
  fi

  printf '%s' "C.UTF-8"
}

# ---------- 0. Subcommand dispatch ----------
# Must run BEFORE locale forcing / chcp / stdin buffering so --health returns fast.
if [[ $# -ge 1 ]]; then
  case "$1" in
    --health|--version)
      set +e
      run_health_check
      rc=$?
      set -e
      exit "$rc"
      ;;
    --help|-h)
      print_usage
      exit 0
      ;;
    --diagnose-md-injection|--dry-run-md-injection)
      md_injection_diagnostic=1
      shift
      ;;
  esac
fi

if [[ "$md_injection_diagnostic" != "1" ]]; then
  agent_session_start
fi

is_windows_host() {
  local uname_s os_name

  uname_s="$(uname -s 2>/dev/null || true)"
  os_name="${OS:-}"

  case "$uname_s" in
    MINGW*|MSYS*|CYGWIN*)
      return 0
      ;;
  esac

  [[ "$os_name" == "Windows_NT" ]]
}

windows_sandbox_limitation_header() {
  cat <<'EOF'
## Host OS sandbox limitation (auto-injected)

현 호스트는 Windows. Codex sandbox 는 Windows 에서 child process spawn 을 대부분 차단 (spawn EPERM). 다음 명령은 Codex self-verify 단계에서 시도 금지 — 실패 확정이며 wall-clock 만 소모한다:

- `npx tsc --noEmit`, `npm test`, `node --test`
- `node .vibe/harness/scripts/vibe-preflight.mjs`
- `node .vibe/harness/scripts/vibe-gen-schemas.mjs --check`
- `tsx` / `esbuild` 또는 기타 child process spawn 을 필요로 하는 명령

대신 **static inspection** (파일 read + 타입/패턴 분석) 만으로 Acceptance Criteria 판정. 실제 실행 검증은 Orchestrator 가 sandbox 밖에서 수행.

Final report `## Sandbox-only failures` 섹션에 위 명령 언급 불필요 — Windows 는 기본값.

---
EOF
}

trim_section_body() {
  awk '
    {
      lines[NR] = $0
      if ($0 !~ /^[[:space:]]*$/) {
        if (start == 0) {
          start = NR
        }
        last = NR
      }
    }
    END {
      if (start == 0) {
        exit
      }
      for (i = start; i <= last; i++) {
        print lines[i]
      }
    }
  '
}

normalize_md_path() {
  local md_path

  md_path="$1"
  md_path="${md_path//\\//}"
  md_path="${md_path#./}"
  printf '%s' "$md_path"
}

is_autoinjectable_md_path() {
  local md_path

  md_path="$1"
  case "$md_path" in
    CLAUDE.md|AGENTS.md|GEMINI.md)
      return 0
      ;;
    docs/context/*.md|docs/guides/*.md|docs/orchestration/*.md|docs/plans/sprint-roadmap.md|docs/release/README.md)
      return 0
      ;;
    .vibe/agent/*.md|.vibe/harness/sidecars/*.md|.claude/agents/*.md|.claude/skills/*.md|.claude/templates/*.md|.codex/skills/*.md)
      return 0
      ;;
  esac

  return 1
}

extract_referenced_md_paths() {
  printf '%s\n' "$1" |
    grep -Eo '(\.?[A-Za-z0-9_.-]+[\\/][A-Za-z0-9_./\\-]+\.md|[A-Z][A-Z0-9_.-]+\.md)' |
    awk '!seen[$0]++' || true
}

extract_declared_shard_md_paths() {
  printf '%s\n' "$1" |
    awk '
      /<!--[[:space:]]*BEGIN:[^>]*SHARDS[[:space:]]*-->/ { in_block = 1; next }
      /<!--[[:space:]]*END:[^>]*SHARDS[[:space:]]*-->/ { in_block = 0; next }
      in_block { print }
    ' |
    grep -Eo '(\.?[A-Za-z0-9_.-]+[\\/][A-Za-z0-9_./\\-]+\.md|[A-Z][A-Z0-9_.-]+\.md)' |
    awk '!seen[$0]++' || true
}

classify_md_reference() {
  local referenced_path

  referenced_path="$1"
  MD_CONTEXT_PATH="$(normalize_md_path "$referenced_path")"
  MD_CONTEXT_STATUS="skipped"
  MD_CONTEXT_REASON="unknown"

  if [[ "$MD_CONTEXT_PATH" == *..* || "$MD_CONTEXT_PATH" = /* ]]; then
    MD_CONTEXT_REASON="unsafe-path"
    return 0
  fi
  if [[ "$MD_CONTEXT_PATH" == "$RULES_FILE" ]]; then
    MD_CONTEXT_REASON="common-rules-injected-separately"
    return 0
  fi
  if ! is_autoinjectable_md_path "$MD_CONTEXT_PATH"; then
    MD_CONTEXT_REASON="not-allowlisted"
    return 0
  fi
  if [[ ! -f "$MD_CONTEXT_PATH" ]]; then
    MD_CONTEXT_STATUS="missing"
    MD_CONTEXT_REASON="file-not-found"
    return 0
  fi
  if [[ "${VIBE_DISABLE_MD_CONTEXT_INJECTION:-}" == "1" ]]; then
    MD_CONTEXT_STATUS="disabled"
    MD_CONTEXT_REASON="VIBE_DISABLE_MD_CONTEXT_INJECTION=1"
    return 0
  fi

  MD_CONTEXT_STATUS="inject"
  MD_CONTEXT_REASON="allowed-existing"
}

json_escape() {
  local value

  value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

json_bool() {
  if [[ "$1" == "1" ]]; then
    printf 'true'
  else
    printf 'false'
  fi
}

md_context_max_depth() {
  local max_depth

  max_depth="${VIBE_MD_CONTEXT_MAX_DEPTH:-5}"
  if ! [[ "$max_depth" =~ ^[0-9]+$ ]] || [[ "$max_depth" -lt 1 ]]; then
    max_depth=5
  fi
  printf '%s' "$max_depth"
}

collect_md_reference_records() {
  local scan_prompt runtime_applies max_depth depth queue next_queue referenced_path md_path status reason
  local seen_paths nested content

  scan_prompt="$1"
  runtime_applies="$2"
  max_depth="$(md_context_max_depth)"

  queue="$(extract_referenced_md_paths "$scan_prompt")"
  seen_paths=" "
  depth=0

  while [[ -n "$queue" && "$depth" -lt "$max_depth" ]]; do
    next_queue=""
    while IFS= read -r referenced_path; do
      [[ -n "$referenced_path" ]] || continue
      classify_md_reference "$referenced_path"
      md_path="$MD_CONTEXT_PATH"

      if [[ " $seen_paths " == *" $md_path "* ]]; then
        continue
      fi
      seen_paths="${seen_paths}${md_path} "

      status="$MD_CONTEXT_STATUS"
      reason="$MD_CONTEXT_REASON"
      if [[ "$runtime_applies" != "1" && "$status" == "inject" ]]; then
        status="argv-not-injected"
        reason="referenced-md-injection-only-applies-to-stdin-prompts"
      fi

      printf '%s\t%s\t%s\t%s\n' "$referenced_path" "$md_path" "$status" "$reason"

      if [[ "$runtime_applies" == "1" && "$MD_CONTEXT_STATUS" == "inject" ]]; then
        content="$(cat "$md_path")"
        nested="$(extract_declared_shard_md_paths "$content")"
        if [[ -n "$nested" ]]; then
          next_queue="$(printf '%s\n%s\n' "$next_queue" "$nested")"
        fi
      fi
    done <<<"$queue"

    queue="$(printf '%s\n' "$next_queue" | awk 'NF && !seen[$0]++')"
    depth=$((depth + 1))
  done

  if [[ -n "$queue" ]]; then
    while IFS= read -r referenced_path; do
      [[ -n "$referenced_path" ]] || continue
      classify_md_reference "$referenced_path"
      md_path="$MD_CONTEXT_PATH"
      if [[ " $seen_paths " == *" $md_path "* ]]; then
        continue
      fi
      seen_paths="${seen_paths}${md_path} "
      printf '%s\t%s\tskipped\tmax-depth-exceeded\n' "$referenced_path" "$md_path"
    done <<<"$queue"
  fi
}

emit_md_injection_diagnostic() {
  local scan_prompt prompt_source runtime_applies common_rules_exists common_rules_would_inject windows_header_would_inject
  local seen_paths first_entry referenced_path escaped_referenced escaped_path status reason
  local referenced_count inject_count missing_count skipped_count disabled_count

  scan_prompt="$1"
  prompt_source="$2"
  runtime_applies="$3"
  common_rules_exists=0
  common_rules_would_inject=0
  windows_header_would_inject=0
  referenced_count=0
  inject_count=0
  missing_count=0
  skipped_count=0
  disabled_count=0

  if [[ -f "$RULES_FILE" ]]; then
    common_rules_exists=1
    if [[ "$prompt_source" == "stdin" ]]; then
      common_rules_would_inject=1
      if is_windows_host; then
        windows_header_would_inject=1
      fi
    fi
  fi

  printf '{\n'
  printf '  "version": 1,\n'
  printf '  "mode": "md-injection-diagnostic",\n'
  printf '  "scanMode": "transitive",\n'
  printf '  "maxDepth": %s,\n' "$(md_context_max_depth)"
  printf '  "promptSource": "%s",\n' "$(json_escape "$prompt_source")"
  printf '  "runtimeInjectionApplies": %s,\n' "$(json_bool "$runtime_applies")"
  printf '  "disableEnvSet": %s,\n' "$(json_bool "$(if [[ "${VIBE_DISABLE_MD_CONTEXT_INJECTION:-}" == "1" ]]; then printf 1; else printf 0; fi)")"
  printf '  "commonRules": {\n'
  printf '    "path": "%s",\n' "$(json_escape "$RULES_FILE")"
  printf '    "exists": %s,\n' "$(json_bool "$common_rules_exists")"
  printf '    "wouldInject": %s,\n' "$(json_bool "$common_rules_would_inject")"
  printf '    "windowsSandboxHeaderWouldInject": %s\n' "$(json_bool "$windows_header_would_inject")"
  printf '  },\n'
  printf '  "referencedMarkdown": [\n'

  seen_paths=" "
  first_entry=1
  while IFS=$'\t' read -r referenced_path md_path status reason; do
    [[ -n "$referenced_path" ]] || continue
    if [[ " $seen_paths " == *" $md_path "* ]]; then
      continue
    fi
    seen_paths="${seen_paths}${md_path} "

    referenced_count=$((referenced_count + 1))
    case "$status" in
      inject) inject_count=$((inject_count + 1)) ;;
      missing) missing_count=$((missing_count + 1)) ;;
      disabled) disabled_count=$((disabled_count + 1)) ;;
      *) skipped_count=$((skipped_count + 1)) ;;
    esac

    if [[ "$first_entry" -eq 0 ]]; then
      printf ',\n'
    fi
    first_entry=0
    escaped_referenced="$(json_escape "$referenced_path")"
    escaped_path="$(json_escape "$md_path")"
    printf '    {"reference": "%s", "path": "%s", "status": "%s", "reason": "%s"}' \
      "$escaped_referenced" \
      "$escaped_path" \
      "$(json_escape "$status")" \
      "$(json_escape "$reason")"
  done < <(collect_md_reference_records "$scan_prompt" "$runtime_applies")

  printf '\n'
  printf '  ],\n'
  printf '  "summary": {\n'
  printf '    "referenced": %s,\n' "$referenced_count"
  printf '    "inject": %s,\n' "$inject_count"
  printf '    "missing": %s,\n' "$missing_count"
  printf '    "skipped": %s,\n' "$skipped_count"
  printf '    "disabled": %s\n' "$disabled_count"
  printf '  }\n'
  printf '}\n'
}

inject_referenced_md_context() {
  local scan_prompt full_prompt referenced_path md_path status reason seen_paths context injected_count content

  scan_prompt="$1"
  full_prompt="$2"
  if [[ "${VIBE_DISABLE_MD_CONTEXT_INJECTION:-}" == "1" || -z "$scan_prompt" ]]; then
    printf '%s' "$full_prompt"
    return 0
  fi

  seen_paths=" "
  context=""
  injected_count=0

  while IFS=$'\t' read -r referenced_path md_path status reason; do
    [[ -n "$referenced_path" ]] || continue
    if [[ " $seen_paths " == *" $md_path "* ]]; then
      continue
    fi
    seen_paths="${seen_paths}${md_path} "

    if [[ "$status" == "missing" ]]; then
      echo "[run-codex] referenced MD context missing: $md_path" >&2
      continue
    fi
    if [[ "$status" != "inject" ]]; then
      continue
    fi

    content="$(cat "$md_path")"
    context="$(printf '%s\n\n## Source: `%s`\n\n%s\n' "$context" "$md_path" "$content")"
    injected_count=$((injected_count + 1))
  done < <(collect_md_reference_records "$scan_prompt" "1")

  if [[ "$injected_count" -eq 0 ]]; then
    printf '%s' "$full_prompt"
    return 0
  fi

  echo "[run-codex] injected referenced MD context count=$injected_count" >&2
  printf '# Referenced MD Context (auto-injected)\n\n%s\n---\n\n%s' "$context" "$full_prompt"
}

emit_sandbox_only_summary() {
  local section normalized first_nonempty item_count preview

  section="$(
    awk '
      /^## Sandbox-only failures[[:space:]]*$/ { in_section = 1; next }
      in_section && /^##[[:space:]]/ { exit }
      in_section { print }
    ' "$attempt_output" | trim_section_body
  )"

  if [[ -z "$section" ]]; then
    return 0
  fi

  first_nonempty="$(
    printf '%s\n' "$section" | awk '
      NF {
        print
        exit
      }
    '
  )"
  normalized="$(printf '%s' "$first_nonempty" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"

  if [[ "$normalized" == "- none" ]]; then
    return 0
  fi

  item_count="$(printf '%s\n' "$section" | grep -c '^[[:space:]]*-[[:space:]]' || true)"
  if [[ "$item_count" -lt 1 ]]; then
    return 0
  fi

  preview="$(printf '%s\n' "$section" | awk 'NR <= 20 { print }')"

  echo "──── run-codex.sh: Sandbox-only failures 감지 ────" >&2
  echo "(${item_count}개 항목. Orchestrator가 샌드박스 밖에서 재검증 필요.)" >&2
  printf '%s\n' "$preview" >&2
  echo "───────────────────────────────────────────────" >&2
}

# ---------- 1. Force UTF-8 in the parent shell ----------
utf8_locale="$(resolve_utf8_locale)"
export LANG="$utf8_locale"
export LC_ALL="$utf8_locale"
export LANGUAGE="$utf8_locale"
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8
export DOTNET_SYSTEM_GLOBALIZATION_USENLS=false

# ---------- 2. Flip Windows console code page to UTF-8 ----------
if [[ "$md_injection_diagnostic" != "1" ]] && command -v chcp.com >/dev/null 2>&1; then
  chcp.com 65001 </dev/null >/dev/null 2>&1 || true
fi

# ---------- 3. Buffer stdin so diagnostics and retries can replay it ----------
stdin_buf=""
if [[ ! -t 0 ]]; then
  stdin_buf=$(cat)
fi
raw_stdin_buf="$stdin_buf"

if [[ "$md_injection_diagnostic" == "1" ]]; then
  diagnostic_scan_prompt=""
  diagnostic_prompt_source="none"
  diagnostic_runtime_applies=0

  if [[ -n "$raw_stdin_buf" ]]; then
    diagnostic_scan_prompt="$raw_stdin_buf"
    diagnostic_prompt_source="stdin"
    diagnostic_runtime_applies=1
  elif [[ $# -gt 0 ]]; then
    diagnostic_scan_prompt="$*"
    diagnostic_prompt_source="argv"
  fi

  emit_md_injection_diagnostic "$diagnostic_scan_prompt" "$diagnostic_prompt_source" "$diagnostic_runtime_applies"
  exit 0
fi

if [[ $# -eq 0 && -t 0 ]]; then
  print_usage >&2
  exit 1
fi

attempt_output="$(mktemp "${TMPDIR:-/tmp}/run-codex.XXXXXX")"
attempt_stderr="$(mktemp "${TMPDIR:-/tmp}/run-codex.XXXXXX")"
cleanup() {
  rm -f "$attempt_output" "$attempt_stderr"
}
trap cleanup EXIT

# ---------- 4. Build codex argv ----------
codex_path="$(resolve_codex_path)"
if [[ -z "$codex_path" ]]; then
  echo "run-codex: codex CLI not found in PATH" >&2
  exit 1
fi
reject_windows_codex_shim_in_wsl "$codex_path" || exit 1

sandbox="${CODEX_SANDBOX:-workspace-write}"

codex_args=(
  exec
  -s "$sandbox"
  -c 'shell_environment_policy.inherit=all'
  -c "shell_environment_policy.set.LC_ALL=\"$utf8_locale\""
  -c "shell_environment_policy.set.LANG=\"$utf8_locale\""
  -c "shell_environment_policy.set.LANGUAGE=\"$utf8_locale\""
  -c 'shell_environment_policy.set.PYTHONUTF8="1"'
  -c 'shell_environment_policy.set.PYTHONIOENCODING="utf-8"'
  -c 'shell_environment_policy.set.DOTNET_SYSTEM_GLOBALIZATION_USENLS="false"'
)

if [[ -n "${CODEX_MODEL:-}" ]]; then
  codex_args+=(-m "$CODEX_MODEL")
fi

if [[ -n "${CODEX_EXTRA_CONFIG:-}" ]]; then
  # shellcheck disable=SC2206
  extra=( $CODEX_EXTRA_CONFIG )
  codex_args+=( "${extra[@]}" )
fi

# ---------- 5. Inject common rules into prompt ----------
if [[ -n "$stdin_buf" && -f "$RULES_FILE" ]]; then
  rules_content=$(cat "$RULES_FILE")
  if is_windows_host; then
    rules_content="$(printf '%s\n\n%s' "$(windows_sandbox_limitation_header)" "$rules_content")"
    echo "[run-codex] injected Windows sandbox limitation header" >&2
  fi
  stdin_buf="$(printf '%s\n\n---\n\n%s' "$rules_content" "$stdin_buf")"
  echo "[run-codex] injected common rules from $RULES_FILE" >&2
fi
if [[ -n "$stdin_buf" ]]; then
  stdin_buf="$(inject_referenced_md_context "$raw_stdin_buf" "$stdin_buf")"
fi

# ---------- 6. Retry loop ----------
retries="${CODEX_RETRY:-3}"
attempt=0
start_ts="$(date +%s)"
model_label="${CODEX_MODEL:-default}"
while [[ $attempt -lt $retries ]]; do
  attempt=$((attempt + 1))
  : >"$attempt_output"
  : >"$attempt_stderr"
  echo "[run-codex] attempt $attempt/$retries starting (sandbox=$sandbox, model=$model_label)" >&2

  set +e
  if [[ -n "$stdin_buf" ]]; then
    printf '%s' "$stdin_buf" | "$codex_path" "${codex_args[@]}" "$@" 2>"$attempt_stderr" | tee "$attempt_output"
  else
    "$codex_path" "${codex_args[@]}" "$@" 2>"$attempt_stderr" | tee "$attempt_output"
  fi
  rc=$?
  set -e

  if [[ -s "$attempt_stderr" ]]; then
    cat "$attempt_stderr" >&2
  fi

  if [[ $rc -eq 0 ]]; then
    emit_sandbox_only_summary
    elapsed=$(( $(date +%s) - start_ts ))
    echo "[run-codex] total attempts=$attempt elapsed=${elapsed}s$(token_suffix)" >&2
    status_tick_after_success
    attention_event "info" "Codex run completed" "Codex exec completed after ${attempt} attempt(s), elapsed ${elapsed}s."
    rm -f .vibe/agent/codex-unavailable.flag
    exit 0
  fi

  if [[ $attempt -ge $retries ]]; then
    emit_sandbox_only_summary
    elapsed=$(( $(date +%s) - start_ts ))
    echo "[run-codex] giving up after $attempt attempts elapsed=${elapsed}s last_exit=$rc" >&2
    case "$(tail -n 20 "$attempt_stderr" 2>/dev/null | grep -Eio "403|401|429|5[0-9][0-9]" | head -n 1 || true)" in
      403) reason_hint="403-forbidden" ;;
      401) reason_hint="401-unauthorized" ;;
      429) reason_hint="429-rate-limit" ;;
      5*) reason_hint="5xx-server-error" ;;
      *) reason_hint="unknown" ;;
    esac
    mkdir -p .vibe/agent
    printf '%s\nlast_exit=%s\nreason_hint=%s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$rc" "$reason_hint" > .vibe/agent/codex-unavailable.flag
    attention_event "urgent" "Codex run failed" "Codex exec failed after ${attempt} attempt(s), elapsed ${elapsed}s, reason=${reason_hint}."
    cat >&2 <<EOF
[run-codex] CODEX_UNAVAILABLE — 3 retries exhausted (last exit=$rc, $reason_hint).
                  Orchestrator 는 아래 중 하나 선택:
                  (1) 시간차 재시도 (quota 아닌 edge block 일 수 있음)
                  (2) 사용자 승인 하에 Orchestrator 직접 편집
                      → session-log 에 [decision][orchestrator-hotfix] 기록 필수
                  (3) \`.vibe/config.json.providers\` 에 fallback provider 추가 후 재시도
EOF
    exit $rc
  fi

  delay="$(retry_delay_for_attempt "$attempt")"
  echo "[run-codex] attempt $attempt/$retries retrying reason=$(retry_reason "$rc" "$attempt_stderr") delay=${delay}s" >&2
  if [[ "$delay" -gt 0 ]]; then
    sleep "$delay"
  fi
done
