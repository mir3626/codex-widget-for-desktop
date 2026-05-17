export const LOCAL_DOCUMENT_CONVERSION_TOOL = String.raw`
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});
process.stdin.on("end", () => {
  try {
    const request = JSON.parse(stdin || "{}");
    const command = typeof request.command === "string" ? request.command : "execute";
    const input = request.input && typeof request.input === "object" ? request.input : {};
    const allowedCommandPrefixes = Array.isArray(request.allowedCommandPrefixes) ? request.allowedCommandPrefixes.filter((value) => typeof value === "string") : [];
    const outputDir = readOutputDir(input);
    mkdirSync(outputDir, { recursive: true });
    if (command === "smoke") {
      runAll({
        ...input,
        outputDir,
        title: input.title || "Local document conversion smoke",
        markdown: input.markdown || "# Local document conversion smoke\n\nThis smoke fixture must become Markdown and PDF artifacts.",
        pdfRenderer: "builtin"
      }, allowedCommandPrefixes);
      return;
    }
    if (command === "execute") {
      runAll(input, allowedCommandPrefixes);
      return;
    }
    if (command === "draft_markdown") {
      writeJson(draftMarkdown(input));
      return;
    }
    if (command === "render_pdf") {
      writeJson(renderPdfStage(input, allowedCommandPrefixes));
      return;
    }
    if (command === "store_artifact") {
      writeJson(storeArtifact(input));
      return;
    }
    if (command === "verify_artifact") {
      writeJson(verifyArtifact(input));
      return;
    }
    throw new Error("unknown_command:" + command);
  } catch (error) {
    writeJson({ ok: false, error: readError(error) });
    process.exitCode = 1;
  }
});

function runAll(input, allowedCommandPrefixes) {
  const markdown = draftMarkdown(input);
  if (!markdown.ok) return writeJson(markdown);
  const pdf = renderPdfStage(input, allowedCommandPrefixes);
  if (!pdf.ok) return writeJson(pdf);
  const stored = storeArtifact(input);
  if (!stored.ok) return writeJson(stored);
  const verified = verifyArtifact(input);
  writeJson({
    ...verified,
    artifacts: stored.artifacts,
    warnings: pdf.warnings || [],
    evidence: {
      source: readSourceEvidence(input),
      markdownPath: join(readOutputDir(input), "report.md"),
      pdfPath: join(readOutputDir(input), "report.pdf")
    }
  });
}

function draftMarkdown(input) {
  const outputDir = readOutputDir(input);
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : "Local document conversion";
  const source = readSourceContent(input);
  if (!source.text.trim()) {
    return { ok: false, stage: "draft_markdown", error: "empty_source_document" };
  }
  const markdown = source.looksLikeMarkdown
    ? source.text
    : ["# " + title, "", source.text].join("\n");
  const markdownPath = join(outputDir, "report.md");
  writeFileSync(markdownPath, normalizeMarkdown(markdown, title), "utf8");
  return {
    ok: true,
    stage: "draft_markdown",
    sourceKind: source.kind,
    sourceName: source.name,
    sourceSha256: source.sha256,
    artifacts: [{ role: "report", path: markdownPath, mime: "text/markdown" }]
  };
}

function renderPdfStage(input, allowedCommandPrefixes) {
  const outputDir = readOutputDir(input);
  const markdownPath = join(outputDir, "report.md");
  const pdfPath = join(outputDir, "report.pdf");
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : "Local document conversion";
  const warnings = [];
  if (input.pdfRenderer === "pandoc" && isCommandAllowed("pandoc", allowedCommandPrefixes) && existsSync(markdownPath)) {
    const result = spawnSync("pandoc", [markdownPath, "-o", pdfPath], { encoding: "utf8", shell: false, timeout: 30000 });
    if (result.status === 0 && existsSync(pdfPath)) {
      return {
        ok: true,
        stage: "render_pdf",
        renderer: "pandoc",
        warnings,
        artifacts: [{ role: "pdf", path: pdfPath, mime: "application/pdf" }]
      };
    }
    warnings.push("pandoc_failed_or_missing:" + (result.stderr || result.error?.message || "unknown"));
  }
  const markdown = existsSync(markdownPath) ? readFileSync(markdownPath, "utf8") : title;
  writeFileSync(pdfPath, renderMinimalPdf(title, markdown));
  return {
    ok: true,
    stage: "render_pdf",
    renderer: "builtin",
    warnings,
    artifacts: [{ role: "pdf", path: pdfPath, mime: "application/pdf" }]
  };
}

function storeArtifact(input) {
  const outputDir = readOutputDir(input);
  const artifactDefs = [
    { role: "report", path: join(outputDir, "report.md"), mime: "text/markdown" },
    { role: "pdf", path: join(outputDir, "report.pdf"), mime: "application/pdf" }
  ].filter((artifact) => existsSync(artifact.path));
  return {
    ok: artifactDefs.length === 2,
    stage: "store_artifact",
    artifacts: artifactDefs
  };
}

function verifyArtifact(input) {
  const outputDir = readOutputDir(input);
  const markdownPath = join(outputDir, "report.md");
  const pdfPath = join(outputDir, "report.pdf");
  const markdownOk = existsSync(markdownPath) && readFileSync(markdownPath).byteLength > 20;
  const pdfOk = existsSync(pdfPath) && readFileSync(pdfPath).subarray(0, 5).toString("ascii") === "%PDF-";
  return {
    ok: markdownOk && pdfOk,
    stage: "verify_artifact",
    verified: markdownOk && pdfOk,
    artifacts: [
      ...(markdownOk ? [{ role: "report", path: markdownPath, mime: "text/markdown" }] : []),
      ...(pdfOk ? [{ role: "pdf", path: pdfPath, mime: "application/pdf" }] : [])
    ]
  };
}

function readSourceContent(input) {
  if (typeof input.markdown === "string" && input.markdown.trim()) {
    return sourceRecord("inline_markdown", "inline.md", input.markdown, true);
  }
  const path = typeof input.markdownPath === "string" && input.markdownPath
    ? input.markdownPath
    : typeof input.sourcePath === "string" && input.sourcePath
      ? input.sourcePath
      : "";
  if (path && existsSync(path)) {
    const text = readFileSync(path, "utf8");
    return sourceRecord("local_file", basename(path), text, /\.m(?:d|arkdown)$/i.test(path) || /^#\s+/m.test(text));
  }
  const docs = Array.isArray(input.sourceDocuments) ? input.sourceDocuments : [];
  const first = docs.find((doc) => doc && typeof doc.text === "string" && doc.text.trim());
  if (first) {
    return sourceRecord("source_document", typeof first.title === "string" ? first.title : "source-document.md", first.text, /^#\s+/m.test(first.text));
  }
  return sourceRecord("empty", "", "", false);
}

function sourceRecord(kind, name, text, looksLikeMarkdown) {
  return {
    kind,
    name,
    text: String(text || ""),
    looksLikeMarkdown,
    sha256: createHash("sha256").update(String(text || "")).digest("hex")
  };
}

function readSourceEvidence(input) {
  const source = readSourceContent(input);
  return {
    kind: source.kind,
    name: source.name,
    sha256: source.sha256,
    chars: source.text.length,
    pathRedacted: Boolean(input.markdownPath || input.sourcePath)
  };
}

function normalizeMarkdown(markdown, title) {
  const text = String(markdown || "").replace(/\r\n/g, "\n").trim();
  if (/^#\s+/m.test(text)) {
    return text + "\n";
  }
  return "# " + title + "\n\n" + text + "\n";
}

function readOutputDir(input) {
  return typeof input.outputDir === "string" && input.outputDir ? input.outputDir : process.cwd();
}

function renderMinimalPdf(title, markdown) {
  const text = [title, "", markdown].join("\n");
  const safeLines = text
    .replace(/[^\x20-\x7E\n]/g, '?')
    .split("\n")
    .slice(0, 52)
    .map((line) => line.slice(0, 88));
  const content = "BT /F1 10 Tf 50 760 Td " + safeLines.map((line, index) => {
    const escaped = line.replace(/[()\\]/g, "\\$&");
    return (index === 0 ? "" : "T* ") + "(" + escaped + ") Tj";
  }).join(" ") + " ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " + Buffer.byteLength(content, "ascii") + " >>\nstream\n" + content + "\nendstream"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += (i + 1) + " 0 obj\n" + objects[i] + "\nendobj\n";
  }
  const xref = Buffer.byteLength(pdf, "ascii");
  pdf += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  pdf += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return Buffer.from(pdf, "ascii");
}

function isCommandAllowed(command, prefixes) {
  const normalized = String(command || "").trim().toLowerCase();
  return prefixes.some((prefix) => {
    const grant = String(prefix).trim().toLowerCase();
    if (!grant) return false;
    if (grant.endsWith("*")) {
      const base = grant.slice(0, -1).trimEnd();
      return base && (normalized === base || normalized.startsWith(base + " "));
    }
    return normalized === grant || (!/\s/.test(grant) && normalized.startsWith(grant + " "));
  });
}

function readError(error) {
  return error && error.message ? error.message : String(error);
}

function writeJson(payload) {
  process.stdout.write(JSON.stringify(payload));
}
`;
