import { basename, extname, relative, resolve } from "node:path";

export function renderSimpleDiff(beforeText: string, afterText: string): string {
  const beforeLines = beforeText.split(/\r?\n/);
  const afterLines = afterText.split(/\r?\n/);
  const output = ["--- before", "+++ after"];
  const maxLines = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < maxLines; index += 1) {
    const beforeLine = beforeLines[index];
    const afterLine = afterLines[index];
    if (beforeLine === afterLine) {
      continue;
    }
    if (beforeLine !== undefined) {
      output.push(`-${beforeLine}`);
    }
    if (afterLine !== undefined) {
      output.push(`+${afterLine}`);
    }
    if (output.length > 500) {
      output.push("... diff truncated ...");
      break;
    }
  }
  return `${output.join("\n")}\n`;
}

export function resolveWorkspacePath(workspaceRoot: string, filePath: string): string | null {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return null;
  }
  const resolvedRoot = resolve(workspaceRoot);
  const resolvedPath = resolve(resolvedRoot, trimmed);
  const relativePath = relative(resolvedRoot, resolvedPath);
  if (relativePath.startsWith("..") || relativePath === "" || /^[A-Za-z]:/.test(relativePath)) {
    return null;
  }
  return resolvedPath;
}

export function safeRelativePath(workspaceRoot: string, sourcePath: string): string {
  const relativePath = relative(resolve(workspaceRoot), resolve(sourcePath)).replace(/\\/g, "/");
  return relativePath && !relativePath.startsWith("..") ? relativePath : basename(sourcePath);
}

export function readDataUrlBytes(value: string): Buffer {
  const commaIndex = value.indexOf(",");
  const payload = commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
  if (!payload.trim()) {
    throw new Error("Recording data is empty.");
  }
  return Buffer.from(payload, "base64");
}

export function inferMime(path: string, bytes: Buffer): string {
  const extension = extname(path).toLowerCase();
  if ([".txt", ".md", ".log", ".diff", ".patch", ".csv"].includes(extension)) {
    return extension === ".md" ? "text/markdown" : extension === ".csv" ? "text/csv" : "text/plain";
  }
  if ([".json", ".jsonl"].includes(extension)) {
    return "application/json";
  }
  if ([".js", ".jsx", ".ts", ".tsx", ".css", ".html", ".xml", ".svg", ".rs", ".py", ".ps1", ".sh", ".toml", ".yaml", ".yml"].includes(extension)) {
    return "text/plain";
  }
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".webm") {
    return "video/webm";
  }
  return bytes.includes(0) ? "application/octet-stream" : "text/plain";
}

export function sanitizeBlobExtension(extension: string): string {
  return /^[.][A-Za-z0-9]{1,12}$/.test(extension) ? extension.toLowerCase() : ".bin";
}

export function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "artifact";
}
