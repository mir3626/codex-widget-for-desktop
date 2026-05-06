#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_SCAN_PATHS = [
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  'README.md',
  '.vibe/agent/_common-rules.md',
  'docs/context/harness-gaps.md',
  'docs/context/orchestration.md',
  'docs/context/codex-execution.md',
  '.claude/agents',
  '.codex/agents',
  '.claude/skills',
  '.codex/skills',
];

const HARD_RE =
  /\b(MUST|MUST NOT|CRITICAL|required|mandatory|fail|fails|block|blocks|blocked|never|do not|cannot|stop)\b|필수|반드시|절대|금지|차단|중단/iu;
const SOFT_RE =
  /\b(optional|may|prefer|recommended|advisory|warning-only|non-blocking|best-effort|if available)\b|권장|선택|비차단|경고|참고/iu;
const AMBIGUOUS_RE = /\b(SHOULD|should)\b|해야|필요/iu;

const ROOTISH_PREFIX_RE =
  /(?:^|[\s"'(])((?:\.{1,2}\/)?(?:\.vibe|\.claude|\.codex|docs|scripts|src|test|app|components|lib|package\.json|README\.md|CLAUDE\.md|AGENTS\.md|GEMINI\.md)[A-Za-z0-9_./*{}:@-]*)/g;

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.vibe/sync-backup',
]);

function usage() {
  return [
    'Usage: node .vibe/harness/scripts/vibe-context-audit.mjs [--root <dir>] [--scan <path[,path...]>] [--format json|markdown]',
    '',
    'Report-only context/dependency audit. It never gates preflight, commits, push, or tags.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    format: 'markdown',
    scanPaths: [...DEFAULT_SCAN_PATHS],
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--root') {
      options.root = argv[++index] ?? options.root;
      continue;
    }
    if (arg.startsWith('--root=')) {
      options.root = arg.slice('--root='.length);
      continue;
    }
    if (arg === '--scan') {
      options.scanPaths = splitCsv(argv[++index] ?? '');
      continue;
    }
    if (arg.startsWith('--scan=')) {
      options.scanPaths = splitCsv(arg.slice('--scan='.length));
      continue;
    }
    if (arg === '--format') {
      options.format = argv[++index] ?? options.format;
      continue;
    }
    if (arg.startsWith('--format=')) {
      options.format = arg.slice('--format='.length);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!['json', 'markdown'].includes(options.format)) {
    throw new Error(`unsupported --format: ${options.format}`);
  }

  options.root = path.resolve(options.root);
  return options;
}

function splitCsv(value) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

function readTextIfPresent(filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return null;
  }
  return readFileSync(filePath, 'utf8');
}

function collectScanFiles(root, scanPaths) {
  const files = [];
  for (const scanPath of scanPaths) {
    const absolute = path.resolve(root, scanPath);
    if (!existsSync(absolute)) {
      continue;
    }
    const stat = statSync(absolute);
    if (stat.isFile()) {
      files.push(toPosix(path.relative(root, absolute)));
      continue;
    }
    if (stat.isDirectory()) {
      for (const file of walk(root, toPosix(path.relative(root, absolute)))) {
        if (file.endsWith('.md') || file.endsWith('.toml') || file.endsWith('.json')) {
          files.push(file);
        }
      }
    }
  }
  return [...new Set(files)].sort();
}

function walk(root, relativeDir = '') {
  const absoluteDir = path.resolve(root, relativeDir);
  const results = [];
  if (!existsSync(absoluteDir)) {
    return results;
  }
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    const relative = toPosix(path.join(relativeDir, entry.name));
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(relative) || IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      results.push(...walk(root, relative));
      continue;
    }
    if (entry.isFile()) {
      results.push(relative);
    }
  }
  return results;
}

function collectRepositoryFiles(root) {
  return walk(root).sort();
}

function dependencyClassForLine(line) {
  if (HARD_RE.test(line)) {
    return 'hard';
  }
  if (SOFT_RE.test(line)) {
    return 'soft';
  }
  if (AMBIGUOUS_RE.test(line)) {
    return 'unknown';
  }
  return 'unknown';
}

function dependencyKindForPath(referencePath) {
  if (referencePath.startsWith('.vibe/agent/')) return 'runtime-state';
  if (referencePath.startsWith('.vibe/harness/scripts/')) return 'harness-script';
  if (referencePath.startsWith('.vibe/harness/src/')) return 'harness-source';
  if (referencePath.startsWith('.vibe/harness/test/')) return 'harness-test';
  if (referencePath.startsWith('.claude/skills/') || referencePath.startsWith('.codex/skills/')) return 'skill';
  if (referencePath.startsWith('.claude/agents/') || referencePath.startsWith('.codex/agents/')) return 'agent';
  if (referencePath.startsWith('docs/context/')) return 'context-doc';
  if (referencePath.startsWith('docs/')) return 'doc';
  if (
    referencePath === 'package.json' ||
    referencePath === '.vibe/config.json' ||
    referencePath === '.vibe/sync-manifest.json' ||
    referencePath === '.claude/settings.json'
  ) {
    return 'config';
  }
  return 'project-or-other';
}

function normalizeCandidate(root, sourcePath, rawValue) {
  let value = rawValue
    .trim()
    .replace(/^["'`(<]+/, '')
    .replace(/[>"'`).,;:]+$/u, '')
    .replace(/\\/g, '/');

  if (value === '' || value.startsWith('http://') || value.startsWith('https://') || value.startsWith('#')) {
    return null;
  }
  if (value.includes('://')) {
    return null;
  }

  const lineNumberMatch = value.match(/^(.+\.(?:md|mjs|ts|tsx|js|json|toml|sh|cmd|ps1|html|css)):\d+$/u);
  if (lineNumberMatch) {
    value = lineNumberMatch[1];
  }

  if (isBareWordFalsePositive(value)) {
    return null;
  }

  if (value.startsWith('./.vibe') || value.startsWith('./.claude') || value.startsWith('./.codex')) {
    value = value.slice(2);
  } else if (value.startsWith('./') || value.startsWith('../')) {
    const sourceDir = path.dirname(path.resolve(root, sourcePath));
    const resolved = path.resolve(sourceDir, value);
    if (!resolved.startsWith(root)) {
      return null;
    }
    value = toPosix(path.relative(root, resolved));
  } else {
    value = value.replace(/^\.\//u, '');
  }

  value = value.replace(/^(\.\.\/)+/u, '');
  const jsonPropertyMatch = value.match(/^(.+\.json)\.[A-Za-z0-9_.:-]+$/u);
  if (jsonPropertyMatch) {
    value = jsonPropertyMatch[1];
  }
  if (value === '' || value.includes(' ')) {
    return null;
  }
  return value;
}

function isBareWordFalsePositive(value) {
  const ambiguousPrefixes = ['app', 'components', 'lib', 'src', 'test', 'tests', 'docs', 'scripts'];
  if (value.endsWith('-')) {
    return true;
  }
  for (const prefix of ambiguousPrefixes) {
    if (value === prefix) {
      return true;
    }
    if (value.startsWith(`${prefix}/`) || value.startsWith(`${prefix}/*`)) {
      return false;
    }
    if (value.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

function extractPathReferences(root, sourcePath, text) {
  const references = [];
  const lines = text.split(/\r?\n/u);
  let inFence = false;

  lines.forEach((line, index) => {
    if (line.trim().startsWith('```')) {
      inFence = !inFence;
      return;
    }
    if (inFence) {
      return;
    }

    const candidates = new Set();
    for (const match of line.matchAll(/`([^`]+)`/gu)) {
      collectCandidatesFromText(match[1], candidates);
    }
    for (const match of line.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      collectCandidatesFromText(match[1], candidates);
    }
    collectCandidatesFromText(line, candidates);

    for (const raw of candidates) {
      const referencePath = normalizeCandidate(root, sourcePath, raw);
      if (!referencePath) {
        continue;
      }
      references.push({
        sourcePath,
        line: index + 1,
        raw,
        path: referencePath,
        dependencyClass: dependencyClassForLine(line),
        kind: dependencyKindForPath(referencePath),
        lineText: line.trim(),
      });
    }
  });

  return references;
}

function collectCandidatesFromText(text, output) {
  for (const match of text.matchAll(ROOTISH_PREFIX_RE)) {
    output.add(match[1]);
  }
}

function globToRegExp(pattern) {
  const value = pattern.replace(/\\/g, '/');
  let source = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];
    if (char === '*' && next === '*') {
      source += '.*';
      index += 1;
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    if (char === '{') {
      const close = value.indexOf('}', index + 1);
      if (close > index) {
        source += `(${value
          .slice(index + 1, close)
          .split(',')
          .map((entry) => entry.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('|')})`;
        index = close;
        continue;
      }
    }
    source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, 'u');
}

function resolveReference(root, referencePath, repositoryFiles) {
  if (referencePath.includes('*') || referencePath.includes('{')) {
    const regex = globToRegExp(referencePath);
    const matchedPaths = repositoryFiles.filter((file) => regex.test(file));
    return {
      exists: matchedPaths.length > 0,
      matchedPaths: matchedPaths.slice(0, 20),
    };
  }

  const absolute = path.resolve(root, referencePath);
  return {
    exists: existsSync(absolute),
    matchedPaths: existsSync(absolute) ? [referencePath] : [],
  };
}

function statusForReference(reference) {
  if (!reference.exists) {
    return 'missing';
  }
  if (reference.dependencyClass === 'unknown') {
    return 'ambiguous';
  }
  return 'known';
}

function findingForReference(reference) {
  if (reference.status === 'missing' && reference.dependencyClass === 'hard') {
    return {
      id: `missing-hard:${reference.sourcePath}:${reference.line}:${reference.path}`,
      severity: 'warning',
      status: 'missing',
      message: `hard dependency reference is missing: ${reference.path}`,
      sourcePath: reference.sourcePath,
      line: reference.line,
      referencePath: reference.path,
      reportOnly: true,
    };
  }
  if (reference.status === 'missing') {
    return {
      id: `missing:${reference.sourcePath}:${reference.line}:${reference.path}`,
      severity: reference.dependencyClass === 'soft' ? 'info' : 'warning',
      status: 'missing',
      message: `${reference.dependencyClass} dependency reference is missing: ${reference.path}`,
      sourcePath: reference.sourcePath,
      line: reference.line,
      referencePath: reference.path,
      reportOnly: true,
    };
  }
  if (reference.status === 'ambiguous') {
    return {
      id: `ambiguous:${reference.sourcePath}:${reference.line}:${reference.path}`,
      severity: 'info',
      status: 'ambiguous',
      message: `dependency strength is ambiguous for: ${reference.path}`,
      sourcePath: reference.sourcePath,
      line: reference.line,
      referencePath: reference.path,
      reportOnly: true,
    };
  }
  return null;
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = item[key] ?? 'unknown';
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function runAudit(root, scanPaths) {
  const scanFiles = collectScanFiles(root, scanPaths);
  const repositoryFiles = collectRepositoryFiles(root);
  const references = [];
  let contextBytes = 0;

  for (const file of scanFiles) {
    const text = readTextIfPresent(path.resolve(root, file));
    if (text === null) {
      continue;
    }
    contextBytes += Buffer.byteLength(text, 'utf8');
    references.push(...extractPathReferences(root, file, text));
  }

  const enriched = references.map((reference) => {
    const resolved = resolveReference(root, reference.path, repositoryFiles);
    const next = {
      ...reference,
      exists: resolved.exists,
      matchedPaths: resolved.matchedPaths,
    };
    return {
      ...next,
      status: statusForReference(next),
    };
  });

  const findings = enriched
    .map((reference) => findingForReference(reference))
    .filter(Boolean);

  return {
    schemaVersion: '1.0',
    reportOnly: true,
    root,
    generatedAt: new Date().toISOString(),
    summary: {
      scannedFiles: scanFiles.length,
      contextBytes,
      references: enriched.length,
      findings: findings.length,
      byDependencyClass: countBy(enriched, 'dependencyClass'),
      byKind: countBy(enriched, 'kind'),
      byStatus: {
        known: enriched.filter((reference) => reference.status === 'known').length,
        missing: enriched.filter((reference) => reference.status === 'missing').length,
        ambiguous: enriched.filter((reference) => reference.status === 'ambiguous').length,
        stale: 0,
      },
    },
    findings,
    references: enriched,
  };
}

function renderMarkdown(audit) {
  const lines = [
    '# vibe context dependency audit',
    '',
    `generatedAt: ${audit.generatedAt}`,
    `reportOnly: ${audit.reportOnly}`,
    '',
    '## Summary',
    '',
    `- scannedFiles: ${audit.summary.scannedFiles}`,
    `- contextBytes: ${audit.summary.contextBytes}`,
    `- references: ${audit.summary.references}`,
    `- findings: ${audit.summary.findings}`,
    `- status: known=${audit.summary.byStatus.known}, missing=${audit.summary.byStatus.missing}, ambiguous=${audit.summary.byStatus.ambiguous}, stale=${audit.summary.byStatus.stale}`,
    '',
    '## Findings',
    '',
  ];

  if (audit.findings.length === 0) {
    lines.push('- none');
  } else {
    for (const finding of audit.findings.slice(0, 100)) {
      lines.push(
        `- [${finding.severity}] ${finding.status} ${finding.referencePath} (${finding.sourcePath}:${finding.line}) - ${finding.message}`,
      );
    }
  }

  lines.push('', '## References', '');
  for (const reference of audit.references.slice(0, 100)) {
    lines.push(
      `- ${reference.status} ${reference.dependencyClass}/${reference.kind} ${reference.path} (${reference.sourcePath}:${reference.line})`,
    );
  }
  if (audit.references.length > 100) {
    lines.push(`- ... ${audit.references.length - 100} more references omitted`);
  }

  lines.push('');
  return lines.join('\n');
}

function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const audit = runAudit(options.root, options.scanPaths);
  if (options.format === 'json') {
    process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
    return;
  }
  process.stdout.write(renderMarkdown(audit));
}

try {
  main();
} catch (error) {
  process.stderr.write(`[vibe-context-audit] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
