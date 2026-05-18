import { createHash } from "node:crypto";
import type { BrowserAction } from "./types.js";

export type EvaluateGuardResult =
  | {
      ok: true;
      codeHash: string;
      preview: string;
      timeoutMs: number;
      resultLimitBytes: number;
    }
  | {
      ok: false;
      codeHash: string;
      preview: string;
      reason: string;
      timeoutMs: number;
      resultLimitBytes: number;
    };

const DEFAULT_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 5_000;
const DEFAULT_RESULT_LIMIT_BYTES = 16_384;
const MAX_RESULT_LIMIT_BYTES = 65_536;
const MAX_CODE_CHARS = 20_000;

const SECRET_ACCESS_PATTERNS = [
  /\bdocument\s*\.\s*cookie\b/i,
  /\bcookieStore\b/i,
  /\blocalStorage\b/i,
  /\bsessionStorage\b/i,
  /\bindexedDB\b/i,
  /\bnavigator\s*\.\s*credentials\b/i,
  /\bcredentials\s*:\s*["']include["']/i,
  /\bAuthorization\b/i,
  /\bBearer\s+[A-Za-z0-9._-]+/i,
  /\bpassword\b/i,
  /\btoken\b/i,
  /\bsecret\b/i,
  /\bapi[_-]?key\b/i,
  /\bpayment\b/i,
  /\bcredit\s*card\b/i,
  /\bcvv\b/i,
  /\bcvc\b/i
];

export function inspectEvaluateCode(input: {
  code: string;
  timeoutMs?: number;
  resultLimitBytes?: number;
  allowCredentialAccess?: boolean;
}): EvaluateGuardResult {
  const code = String(input.code ?? "");
  const codeHash = createHash("sha256").update(code).digest("hex");
  const preview = code.slice(0, 2_000);
  const timeoutMs = clampInteger(input.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const resultLimitBytes = clampInteger(input.resultLimitBytes, DEFAULT_RESULT_LIMIT_BYTES, MAX_RESULT_LIMIT_BYTES);

  if (!code.trim()) {
    return { ok: false, codeHash, preview, timeoutMs, resultLimitBytes, reason: "Evaluate code is empty." };
  }
  if (code.length > MAX_CODE_CHARS) {
    return {
      ok: false,
      codeHash,
      preview,
      timeoutMs,
      resultLimitBytes,
      reason: `Evaluate code exceeds ${MAX_CODE_CHARS} characters.`
    };
  }
  if (!input.allowCredentialAccess) {
    if (!isCredentialSafeEvaluateCode(code)) {
      return {
        ok: false,
        codeHash,
        preview,
        timeoutMs,
        resultLimitBytes,
        reason: "Arbitrary evaluate code requires an explicit credential/cookie/CAPTCHA unlock."
      };
    }
    const matched = SECRET_ACCESS_PATTERNS.find((pattern) => pattern.test(code));
    if (matched) {
      return {
        ok: false,
        codeHash,
        preview,
        timeoutMs,
        resultLimitBytes,
        reason: `Evaluate code matched credential safeguard: ${matched.source}`
      };
    }
  }

  return { ok: true, codeHash, preview, timeoutMs, resultLimitBytes };
}

export function applyEvaluateCredentialAccess(action: BrowserAction, allowCredentialAccess: boolean): BrowserAction {
  if (action.type !== "evaluate") {
    return action;
  }
  const { allowCredentialAccess: _ignored, ...safeAction } = action;
  return allowCredentialAccess ? { ...safeAction, allowCredentialAccess: true } : safeAction;
}

export function summarizeEvaluatePreview(input: EvaluateGuardResult): string {
  return [
    `Code SHA-256: ${input.codeHash}`,
    `Timeout: ${input.timeoutMs}ms`,
    `Result limit: ${input.resultLimitBytes} bytes`,
    "Code preview:",
    input.preview || "(empty)"
  ].join("\n");
}

function clampInteger(value: unknown, fallback: number, maximum: number): number {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number) || number < 1) {
    return fallback;
  }
  return Math.min(number, maximum);
}

function isCredentialSafeEvaluateCode(code: string): boolean {
  const normalized = code.trim().replace(/\s+/g, " ");
  return [
    /^return document\.title;?$/i,
    /^return document\.readyState;?$/i,
    /^return location\.href;?$/i,
    /^return location\.origin;?$/i,
    /^return location\.pathname;?$/i,
    /^return target\s*\?\s*target\.textContent\s*:\s*null;?$/i,
    /^return target\s*\?\.\s*textContent;?$/i,
    /^return target\s*\?\s*target\.innerText\s*:\s*null;?$/i,
    /^return target\s*\?\.\s*innerText;?$/i,
    /^return target\s*\?\s*target\.getAttribute\(["']aria-label["']\)\s*:\s*null;?$/i,
    /^return target\s*\?\.\s*getAttribute\(["']aria-label["']\);?$/i
  ].some((pattern) => pattern.test(normalized));
}
