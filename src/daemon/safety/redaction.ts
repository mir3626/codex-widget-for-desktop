export function containsLikelySecret(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return /\b(?:password|passwd|token|cookie|secret|api[_-]?key|authorization)\b/i.test(value) ||
    /\b(?:sk|sess|tok|key|pat|ghp)_[A-Za-z0-9_\-]{12,}\b/.test(value);
}

export function redactSafetyText(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }
  return value
    .replace(/\b(?:sk|sess|tok|key|pat|ghp)_[A-Za-z0-9_\-]{12,}\b/g, "[redacted-secret]")
    .replace(/(password|passwd|token|cookie|secret|api[_-]?key|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}

