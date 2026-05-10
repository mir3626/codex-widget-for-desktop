export function redactBrowserActionSecret(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSensitiveText(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactBrowserActionSecret);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/password|token|cookie|credential|payment|card|secret/i.test(key)) {
      output[key] = "[redacted]";
    } else {
      output[key] = redactBrowserActionSecret(item);
    }
  }
  return output;
}

export function redactSensitiveText(text: string): string {
  return text
    .replace(/(password|token|cookie|credential|payment|card|secret)(\s*[:=]\s*)([^\s,;]+)/gi, "$1$2[redacted]")
    .replace(/\b(?:sk|pk|ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{12,}\b/g, "[redacted-token]")
    .replace(/\b\d{12,19}\b/g, "[redacted-number]");
}
