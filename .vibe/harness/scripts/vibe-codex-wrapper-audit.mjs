#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const CLAUDE_SKILLS_DIR = '.claude/skills';
const CODEX_SKILLS_DIR = '.codex/skills';
const WRAPPER_BLOCK_BEGIN = '<!-- BEGIN:VIBE-CODEX:SHARDS -->';
const WRAPPER_BLOCK_END = '<!-- END:VIBE-CODEX:SHARDS -->';

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    format: 'text',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--root') {
      options.root = argv[index + 1] ?? options.root;
      index += 1;
      continue;
    }
    if (current === '--format') {
      options.format = argv[index + 1] ?? options.format;
      index += 1;
      continue;
    }
    if (current === '--help' || current === '-h') {
      process.stdout.write('Usage: node .vibe/harness/scripts/vibe-codex-wrapper-audit.mjs [--root <dir>] [--format text|json]\n');
      process.exit(0);
    }
  }

  if (!['text', 'json'].includes(options.format)) {
    throw new Error(`unsupported --format: ${options.format}`);
  }

  return options;
}

function toPosix(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function readText(root, relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function listSkillNames(root, relativeDir) {
  const absoluteDir = path.join(root, relativeDir);
  if (!existsSync(absoluteDir)) {
    return [];
  }

  return readdirSync(absoluteDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(path.join(absoluteDir, name, 'SKILL.md')))
    .sort((left, right) => left.localeCompare(right));
}

function extractBlock(text, beginMarker, endMarker) {
  const begin = text.indexOf(beginMarker);
  const end = text.indexOf(endMarker);
  if (begin === -1 && end === -1) {
    return null;
  }
  if (begin === -1 || end === -1 || end <= begin) {
    throw new Error(`invalid marker block: ${beginMarker}`);
  }
  return text.slice(begin + beginMarker.length, end);
}

function extractMarkdownPaths(text) {
  const paths = new Set();
  const pattern = /`([^`]+\.md)`|\(([^)]+\.md)\)/g;
  for (const match of text.matchAll(pattern)) {
    const rawPath = match[1] ?? match[2] ?? '';
    const normalized = toPosix(rawPath.trim());
    if (normalized.length > 0) {
      paths.add(normalized);
    }
  }
  return [...paths];
}

function extractShardPaths(text) {
  const paths = new Set();
  const blockPattern = /<!--[ \t]*BEGIN:[^>]*SHARDS[ \t]*-->[\s\S]*?<!--[ \t]*END:[^>]*SHARDS[ \t]*-->/g;
  for (const blockMatch of text.matchAll(blockPattern)) {
    for (const markdownPath of extractMarkdownPaths(blockMatch[0])) {
      paths.add(markdownPath);
    }
  }
  return [...paths];
}

function classifyInjectablePath(relativePath) {
  if (relativePath.includes('..') || path.isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath)) {
    return 'unsafe-path';
  }
  if (
    relativePath === 'CLAUDE.md' ||
    relativePath === 'AGENTS.md' ||
    relativePath === 'GEMINI.md' ||
    /^docs\/context\/[^/]+\.md$/.test(relativePath) ||
    /^docs\/guides\/[^/]+\.md$/.test(relativePath) ||
    /^docs\/orchestration\/[^/]+\.md$/.test(relativePath) ||
    relativePath === 'docs/plans/sprint-roadmap.md' ||
    relativePath === 'docs/release/README.md' ||
    /^\.vibe\/agent\/[^/]+\.md$/.test(relativePath) ||
    /^\.vibe\/harness\/sidecars\/[^/]+\.md$/.test(relativePath) ||
    relativePath.startsWith('.claude/agents/') && relativePath.endsWith('.md') ||
    relativePath.startsWith('.claude/skills/') && relativePath.endsWith('.md') ||
    relativePath.startsWith('.claude/templates/') && relativePath.endsWith('.md') ||
    relativePath.startsWith('.codex/skills/') && relativePath.endsWith('.md')
  ) {
    return 'inject';
  }
  return 'not-allowlisted';
}

function addFinding(findings, id, detail, extra = {}) {
  findings.push({ severity: 'error', id, detail, ...extra });
}

function collectTransitiveTargets(root, initialTargets, findings, sourcePath) {
  const targets = [];
  const queue = [...initialTargets];
  const seen = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) {
      continue;
    }
    seen.add(current);
    targets.push(current);

    const classification = classifyInjectablePath(current);
    if (classification !== 'inject') {
      addFinding(findings, 'non-injectable-target', `target would not be injected by run-codex: ${classification}`, { path: current, sourcePath });
      continue;
    }

    const absolutePath = path.join(root, current);
    if (!existsSync(absolutePath)) {
      addFinding(findings, 'missing-target', 'wrapper or shard target does not exist', { path: current, sourcePath });
      continue;
    }

    const content = readText(root, current);
    for (const shardPath of extractShardPaths(content)) {
      const normalizedShardPath = toPosix(shardPath);
      if (!seen.has(normalizedShardPath)) {
        queue.push(normalizedShardPath);
      }
    }
  }

  return targets;
}

function auditWrapper(root, skillName, findings) {
  const wrapperPath = `${CODEX_SKILLS_DIR}/${skillName}/SKILL.md`;
  const sharedPath = `${CLAUDE_SKILLS_DIR}/${skillName}/SKILL.md`;
  const wrapperText = readText(root, wrapperPath);
  const localFindings = [];

  if (/\.\.\/\.\.\/\.\.\/\.claude\/skills/.test(wrapperText) || /\.\.[/\\]/.test(wrapperText)) {
    addFinding(localFindings, 'unsafe-wrapper-reference', 'wrapper must use repository-root shared skill paths', { path: wrapperPath });
  }
  if (!/provider-neutral skill runbooks/.test(wrapperText)) {
    addFinding(localFindings, 'missing-wrapper-signal', 'wrapper must identify provider-neutral shared runbooks', { path: wrapperPath, signal: 'provider-neutral' });
  }
  if (!/repository-root path/.test(wrapperText)) {
    addFinding(localFindings, 'missing-wrapper-signal', 'wrapper must instruct Codex to open repository-root paths', { path: wrapperPath, signal: 'repository-root-path' });
  }

  let wrapperBlock = null;
  try {
    wrapperBlock = extractBlock(wrapperText, WRAPPER_BLOCK_BEGIN, WRAPPER_BLOCK_END);
  } catch (error) {
    addFinding(localFindings, 'invalid-wrapper-shard-block', error instanceof Error ? error.message : String(error), { path: wrapperPath });
  }
  if (wrapperBlock === null) {
    addFinding(localFindings, 'missing-wrapper-shard-block', 'wrapper has no VIBE-CODEX shard block', { path: wrapperPath });
  }

  const declaredTargets = wrapperBlock ? extractMarkdownPaths(wrapperBlock) : [];
  if (!declaredTargets.includes(sharedPath)) {
    addFinding(localFindings, 'missing-shared-skill-target', `wrapper shard block must include ${sharedPath}`, { path: wrapperPath });
  }
  for (const target of declaredTargets) {
    if (target !== sharedPath) {
      addFinding(localFindings, 'unexpected-wrapper-target', 'Codex wrapper shard block should list only the matching shared runbook', { path: target, sourcePath: wrapperPath });
    }
  }

  const transitiveTargets = collectTransitiveTargets(root, [wrapperPath, ...declaredTargets], localFindings, wrapperPath);
  findings.push(...localFindings);

  return {
    skill: skillName,
    wrapperPath,
    sharedPath,
    targetCount: transitiveTargets.length,
    targets: transitiveTargets,
    ok: localFindings.length === 0,
  };
}

function audit(root) {
  const findings = [];
  const claudeSkills = listSkillNames(root, CLAUDE_SKILLS_DIR);
  const codexSkills = listSkillNames(root, CODEX_SKILLS_DIR);
  const claudeSet = new Set(claudeSkills);
  const codexSet = new Set(codexSkills);

  for (const skillName of claudeSkills) {
    if (!codexSet.has(skillName)) {
      addFinding(findings, 'missing-codex-wrapper', 'shared skill has no Codex wrapper', { skill: skillName });
    }
  }
  for (const skillName of codexSkills) {
    if (!claudeSet.has(skillName)) {
      addFinding(findings, 'orphan-codex-wrapper', 'Codex wrapper has no matching shared skill', { skill: skillName });
    }
  }

  const wrapperReports = [];
  for (const skillName of codexSkills.filter((name) => claudeSet.has(name))) {
    wrapperReports.push(auditWrapper(root, skillName, findings));
  }

  return {
    ok: findings.length === 0,
    claudeSkillCount: claudeSkills.length,
    codexSkillCount: codexSkills.length,
    wrapperReports,
    findings,
  };
}

function printText(report) {
  const status = report.ok ? 'OK' : 'FAIL';
  const targetCount = report.wrapperReports.reduce((sum, wrapper) => sum + wrapper.targetCount, 0);
  process.stdout.write(`[vibe-codex-wrapper-audit] ${status} claudeSkills=${report.claudeSkillCount} codexSkills=${report.codexSkillCount} targets=${targetCount}\n`);
  for (const finding of report.findings) {
    const target = finding.path ?? finding.skill ?? finding.signal ?? '';
    process.stdout.write(`- ${finding.severity}: ${finding.id}${target ? ` ${target}` : ''} - ${finding.detail}\n`);
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  const report = audit(path.resolve(options.root));
  if (options.format === 'json') {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printText(report);
  }
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  process.stderr.write(`[vibe-codex-wrapper-audit] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
