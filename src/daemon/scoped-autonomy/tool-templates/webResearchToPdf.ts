export const WEB_RESEARCH_TO_PDF_TOOL = String.raw`
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});
process.stdin.on("end", async () => {
  try {
    const request = JSON.parse(stdin || "{}");
    const command = typeof request.command === "string" ? request.command : "execute";
    const input = request.input && typeof request.input === "object" ? request.input : {};
    const allowedDomains = Array.isArray(request.allowedDomains) ? request.allowedDomains.filter((value) => typeof value === "string") : [];
    const allowedBrowserDomains = Array.isArray(request.allowedBrowserDomains) ? request.allowedBrowserDomains.filter((value) => typeof value === "string") : allowedDomains;
    const allowedCommandPrefixes = Array.isArray(request.allowedCommandPrefixes) ? request.allowedCommandPrefixes.filter((value) => typeof value === "string") : [];
    const outputDir = readOutputDir(input);
    mkdirSync(outputDir, { recursive: true });
    if (command === "smoke") {
      await runAll({ ...input, outputDir, pdfRenderer: "builtin" }, allowedDomains, allowedBrowserDomains, allowedCommandPrefixes);
      return;
    }
    if (command === "execute") {
      await runAll(input, allowedDomains, allowedBrowserDomains, allowedCommandPrefixes);
      return;
    }
    if (command === "crawl_or_observe") {
      writeJson(await crawlOrObserve(input, allowedDomains, allowedBrowserDomains));
      return;
    }
    if (command === "extract") {
      writeJson(await extract(input));
      return;
    }
    if (command === "verify_sources") {
      writeJson(await verifySources(input));
      return;
    }
    if (command === "draft_markdown") {
      writeJson(await draftMarkdown(input));
      return;
    }
    if (command === "render_pdf") {
      writeJson(await renderPdfStage(input, allowedCommandPrefixes));
      return;
    }
    if (command === "store_artifact") {
      writeJson(await storeArtifact(input));
      return;
    }
    if (command === "verify_artifact") {
      writeJson(await verifyArtifact(input));
      return;
    }
    throw new Error("unknown_command:" + command);
  } catch (error) {
    writeJson({ ok: false, error: readError(error) });
    process.exitCode = 1;
  }
});

async function runAll(input, allowedDomains, allowedBrowserDomains, allowedCommandPrefixes) {
  const crawl = await crawlOrObserve(input, allowedDomains, allowedBrowserDomains);
  if (!crawl.ok) return writeJson(crawl);
  const extracted = await extract(input);
  if (!extracted.ok) return writeJson(extracted);
  const verified = await verifySources(input);
  if (!verified.ok) return writeJson(verified);
  const markdown = await draftMarkdown(input);
  if (!markdown.ok) return writeJson(markdown);
  const pdf = await renderPdfStage(input, allowedCommandPrefixes);
  if (!pdf.ok) return writeJson(pdf);
  const stored = await storeArtifact(input);
  if (!stored.ok) return writeJson(stored);
  const artifact = await verifyArtifact(input);
  writeJson({
    ...artifact,
    sourceCount: crawl.sourceCount,
    artifacts: stored.artifacts,
    warnings: [...(crawl.warnings || []), ...(pdf.warnings || [])],
    evidence: {
      urlsFetched: crawl.urlsFetched,
      browserFallbackUrls: crawl.browserFallbackUrls,
      citationsPath: join(readOutputDir(input), "citations.json"),
      markdownPath: join(readOutputDir(input), "report.md"),
      pdfPath: join(readOutputDir(input), "report.pdf")
    }
  });
}

async function crawlOrObserve(input, allowedDomains, allowedBrowserDomains) {
  const outputDir = readOutputDir(input);
  const sourcesPath = join(outputDir, "sources.json");
  const docs = [];
  const warnings = [];
  const browserFallbacks = normalizeBrowserFallbackDocuments(input.browserFallbackDocuments);
  const fixtureDocs = Array.isArray(input.sourceDocuments) ? input.sourceDocuments : [];
  for (let index = 0; index < fixtureDocs.length; index += 1) {
    const doc = fixtureDocs[index];
    if (doc && typeof doc === "object" && typeof doc.text === "string") {
      docs.push({
        title: typeof doc.title === "string" ? doc.title : "Source " + (index + 1),
        url: typeof doc.url === "string" ? doc.url : "",
        text: doc.text,
        fetched: false,
        status: "fixture"
      });
    }
  }
  const urls = Array.isArray(input.urls) ? input.urls.filter((value) => typeof value === "string") : [];
  for (const url of urls.slice(0, 8)) {
    const host = readHost(url);
    const networkAllowed = Boolean(host && allowedDomains.some((pattern) => matchesDomainGrant(pattern, host)));
    const browserAllowed = Boolean(host && allowedBrowserDomains.some((pattern) => matchesDomainGrant(pattern, host)));
    if (!host || (!networkAllowed && !browserAllowed)) {
      warnings.push("skipped_ungranted_domain:" + (host || url));
      docs.push({ title: host || url, url, text: "Skipped: domain is not in the permission profile.", fetched: false, status: "blocked_domain" });
      continue;
    }
    if (!networkAllowed && browserAllowed) {
      if (appendBrowserFallback(docs, warnings, browserFallbacks, url, host, "network_grant_missing")) {
        continue;
      }
      warnings.push("browser_fallback_missing:" + host);
      docs.push({ title: host, url, text: "Browser fallback required but no capture was supplied.", fetched: false, status: "browser_fallback_missing" });
      continue;
    }
    try {
      const response = await fetch(url, { redirect: "follow" });
      const html = await response.text();
      if (!response.ok) {
        warnings.push("http_status_" + response.status + ":" + host);
        if (browserAllowed && appendBrowserFallback(docs, warnings, browserFallbacks, url, host, "http_status_" + response.status)) {
          continue;
        }
      }
      docs.push({
        title: extractTitle(html) || host,
        url,
        text: stripHtml(html).slice(0, 12000),
        fetched: true,
        httpOk: response.ok,
        status: String(response.status)
      });
    } catch (error) {
      warnings.push("fetch_failed:" + host + ":" + readError(error));
      if (browserAllowed && appendBrowserFallback(docs, warnings, browserFallbacks, url, host, "fetch_failed")) {
        continue;
      }
      docs.push({ title: host, url, text: "Fetch failed: " + readError(error), fetched: false, status: "fetch_failed" });
    }
  }
  if (docs.length === 0) {
    docs.push({ title: "No sources", url: "", text: "No source documents or allowed URLs were provided.", fetched: false, status: "empty" });
  }
  writeJsonFile(sourcesPath, docs);
  return {
    ok: true,
    stage: "crawl_or_observe",
    sourceCount: docs.length,
    urlsFetched: docs.filter((doc) => doc.fetched).map((doc) => doc.url),
    browserFallbackUrls: docs.filter((doc) => doc.status === "browser_fallback").map((doc) => doc.url),
    warnings,
    artifacts: [{ role: "source", path: sourcesPath, mime: "application/json" }]
  };
}

function normalizeBrowserFallbackDocuments(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => item && typeof item === "object" ? item : null)
    .filter(Boolean)
    .map((item) => {
      const url = typeof item.url === "string" ? item.url.trim() : "";
      const capture = item.capture && typeof item.capture === "object" ? item.capture : {};
      const captureText = typeof capture.text === "string" ? capture.text : "";
      const text = typeof item.text === "string" && item.text.trim() ? item.text : captureText;
      return {
        title: typeof item.title === "string" && item.title.trim()
          ? item.title.trim()
          : typeof capture.title === "string" && capture.title.trim()
            ? capture.title.trim()
            : readHost(url) || "Browser fallback source",
        url,
        text,
        capture
      };
    })
    .filter((item) => item.url && (String(item.text || "").trim() || Object.keys(item.capture || {}).length > 0));
}

function appendBrowserFallback(docs, warnings, fallbacks, url, host, reason) {
  const fallback = fallbacks.find((item) => normalizeComparableUrl(item.url) === normalizeComparableUrl(url));
  if (!fallback) {
    return false;
  }
  const capture = fallback.capture || {};
  const text = String(fallback.text || "").trim() || [
    "Browser capture fallback was supplied for " + url + ".",
    typeof capture.pdfSha256 === "string" ? "PDF SHA-256: " + capture.pdfSha256 : "",
    typeof capture.pdfByteLength === "number" ? "PDF bytes: " + capture.pdfByteLength : "",
    typeof capture.command === "string" ? "Capture command: " + capture.command : ""
  ].filter(Boolean).join("\n");
  docs.push({
    title: fallback.title || host,
    url,
    text,
    fetched: false,
    status: "browser_fallback",
    browserFallback: true,
    fallbackReason: reason,
    capture: sanitizeCaptureMetadata(capture)
  });
  warnings.push("browser_fallback_used:" + host + ":" + reason);
  return true;
}

function sanitizeCaptureMetadata(value) {
  const output = {};
  for (const [key, entry] of Object.entries(value || {}).slice(0, 20)) {
    if (/data|base64|html|screenshot|audio|raw/i.test(key)) {
      output[key] = "[omitted]";
    } else if (typeof entry === "string") {
      output[key] = entry.slice(0, 500);
    } else if (typeof entry === "number" || typeof entry === "boolean") {
      output[key] = entry;
    }
  }
  return output;
}

function normalizeComparableUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return String(value || "").trim().replace(/\/$/, "");
  }
}

async function extract(input) {
  const outputDir = readOutputDir(input);
  const sourcesPath = join(outputDir, "sources.json");
  const extractedPath = join(outputDir, "extracted.json");
  const sources = readJsonFile(sourcesPath, []);
  const extracted = sources.map((source, index) => ({
    id: "S" + (index + 1),
    title: source.title || "Source " + (index + 1),
    url: source.url || "",
    fetched: Boolean(source.fetched),
    status: source.status || "unknown",
    browserFallback: Boolean(source.browserFallback),
    fallbackReason: source.fallbackReason || "",
    capture: source.capture || {},
    text: String(source.text || "").replace(/\s+/g, " ").trim().slice(0, 6000)
  }));
  writeJsonFile(extractedPath, extracted);
  return {
    ok: true,
    stage: "extract",
    sourceCount: extracted.length,
    artifacts: [{ role: "source", path: extractedPath, mime: "application/json" }]
  };
}

async function verifySources(input) {
  const outputDir = readOutputDir(input);
  const extracted = readJsonFile(join(outputDir, "extracted.json"), []);
  const citations = extracted.map((source) => ({
    id: source.id,
    title: source.title,
    url: source.url,
    fetched: source.fetched,
    status: source.status,
    browserFallback: Boolean(source.browserFallback),
    fallbackReason: source.fallbackReason || "",
    chars: String(source.text || "").length,
    excerpt: String(source.text || "").slice(0, 240)
  }));
  const citationsPath = join(outputDir, "citations.json");
  writeJsonFile(citationsPath, citations);
  const verified = citations.length > 0 && citations.some((source) => source.chars > 10);
  return {
    ok: verified,
    stage: "verify_sources",
    verified,
    sourceCount: citations.length,
    artifacts: [{ role: "citation", path: citationsPath, mime: "application/json" }]
  };
}

async function draftMarkdown(input) {
  const outputDir = readOutputDir(input);
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : "Scoped autonomy report";
  const extracted = readJsonFile(join(outputDir, "extracted.json"), []);
  const citations = readJsonFile(join(outputDir, "citations.json"), []);
  const lines = ["# " + title, "", "## Summary", ""];
  for (const source of extracted) {
    lines.push("- " + source.title + (source.url ? " (" + source.url + ")" : ""));
  }
  lines.push("", "## Citations", "", "| ID | Title | URL | Status |", "| --- | --- | --- | --- |");
  for (const citation of citations) {
    lines.push("| " + citation.id + " | " + escapeTable(citation.title) + " | " + escapeTable(citation.url || "") + " | " + escapeTable(citation.status || "") + " |");
  }
  lines.push("", "## Source Notes", "");
  for (const source of extracted) {
    lines.push("### " + source.id + " - " + source.title);
    if (source.url) {
      lines.push("", "Source: " + source.url);
    }
    if (source.browserFallback) {
      lines.push("", "Browser fallback: " + (source.fallbackReason || "direct_fetch_unavailable"));
    }
    lines.push("", source.text.slice(0, 4000), "");
  }
  const markdownPath = join(outputDir, "report.md");
  writeFileSync(markdownPath, lines.join("\n"), "utf8");
  return {
    ok: true,
    stage: "draft_markdown",
    artifacts: [{ role: "report", path: markdownPath, mime: "text/markdown" }]
  };
}

async function renderPdfStage(input, allowedCommandPrefixes) {
  const outputDir = readOutputDir(input);
  const markdownPath = join(outputDir, "report.md");
  const pdfPath = join(outputDir, "report.pdf");
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : "Scoped autonomy report";
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

async function storeArtifact(input) {
  const outputDir = readOutputDir(input);
  const artifactDefs = [
    { role: "report", path: join(outputDir, "report.md"), mime: "text/markdown" },
    { role: "pdf", path: join(outputDir, "report.pdf"), mime: "application/pdf" },
    { role: "citation", path: join(outputDir, "citations.json"), mime: "application/json" }
  ].filter((artifact) => existsSync(artifact.path));
  return {
    ok: artifactDefs.length >= 2,
    stage: "store_artifact",
    artifacts: artifactDefs
  };
}

async function verifyArtifact(input) {
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

function matchesDomainGrant(pattern, value) {
  const normalizedPattern = normalizeHost(pattern);
  const normalizedValue = normalizeHost(value);
  if (!normalizedPattern || !normalizedValue) return false;
  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(2);
    return normalizedValue === suffix || normalizedValue.endsWith("." + suffix);
  }
  return normalizedPattern === normalizedValue;
}

function normalizeHost(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  if (text.startsWith("*.")) return "*." + normalizeHost(text.slice(2));
  try {
    return new URL(text.includes("://") ? text : "https://" + text).hostname.toLowerCase();
  } catch {
    return text.replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
  }
}

function readHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function extractTitle(html) {
  const match = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return match ? decodeEntities(match[1]).trim() : "";
}

function stripHtml(html) {
  return decodeEntities(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function escapeTable(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
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

function writeJsonFile(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

function readJsonFile(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function readError(error) {
  return error && error.message ? error.message : String(error);
}

function writeJson(payload) {
  process.stdout.write(JSON.stringify(payload));
}
`;
