#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROADMAP_RELATIVE_PATH = path.join('docs', 'plans', 'sprint-roadmap.md');
const ARCHIVE_RELATIVE_DIR = path.join('docs', 'plans', 'archive', 'roadmaps');
const ITERATION_HISTORY_RELATIVE_PATH = path.join('.vibe', 'agent', 'iteration-history.json');
const CURRENT_POINTER_BEGIN = '<!-- BEGIN:VIBE:CURRENT-SPRINT -->';
const CURRENT_POINTER_END = '<!-- END:VIBE:CURRENT-SPRINT -->';

const iterationHeaderPattern = /^(#{1,6})\s+Iteration\s+(?:iter-)?(\d+)\b[^\n]*$/gim;
const sprintIdPatterns = [
  /^- \*\*id\*\*:\s*`([^`]+)`/gim,
  /^#{2,6}\s+((?:iter-\d+-)?sprint-[A-Za-z0-9_.-]+)\b[^\n]*$/gim,
];

function normalizeSlashes(value) {
  return value.replace(/\\/g, '/');
}

function normalizeIterationId(value) {
  const match = String(value ?? '').trim().match(/^(?:iter-)?(\d+)$/i);
  return match?.[1] ? `iter-${match[1]}` : String(value ?? '').trim();
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readIterationHistory(root) {
  const filePath = path.join(root, ITERATION_HISTORY_RELATIVE_PATH);
  const history = readJson(filePath, null);
  if (!isRecord(history)) {
    return { currentIteration: null, iterations: [] };
  }

  const iterations = Array.isArray(history.iterations)
    ? history.iterations.filter((entry) => isRecord(entry) && typeof entry.id === 'string')
    : [];
  return {
    currentIteration:
      typeof history.currentIteration === 'string' && history.currentIteration.trim() !== ''
        ? normalizeIterationId(history.currentIteration)
        : null,
    iterations,
  };
}

function lineNumberAtOffset(text, offset) {
  if (offset <= 0) {
    return 1;
  }
  return text.slice(0, offset).split(/\r?\n/).length;
}

export function parseIterationSections(markdown) {
  const matches = Array.from(markdown.matchAll(iterationHeaderPattern));
  return matches.flatMap((match, index) => {
    const startOffset = match.index;
    const iterationNumber = match[2];
    if (startOffset === undefined || iterationNumber === undefined) {
      return [];
    }

    const nextStartOffset = matches[index + 1]?.index ?? markdown.length;
    const text = markdown.slice(startOffset, nextStartOffset).trim();
    if (text.length === 0) {
      return [];
    }

    return [
      {
        iterationId: `iter-${iterationNumber}`,
        header: match[0],
        startLine: lineNumberAtOffset(markdown, startOffset),
        endLine: lineNumberAtOffset(markdown, nextStartOffset),
        text,
      },
    ];
  });
}

export function extractSprintIds(markdown) {
  const ids = [];
  const seen = new Set();
  for (const pattern of sprintIdPatterns) {
    for (const match of markdown.matchAll(pattern)) {
      const id = match[1]?.trim();
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function currentIterationEntry(history) {
  if (!history.currentIteration) {
    return null;
  }
  return history.iterations.find((entry) => normalizeIterationId(entry.id) === history.currentIteration) ?? null;
}

function pointerBlock(history, activeSection) {
  const entry = currentIterationEntry(history);
  const completed = new Set(
    Array.isArray(entry?.completedSprints)
      ? entry.completedSprints.filter((id) => typeof id === 'string')
      : [],
  );
  const planned = Array.isArray(entry?.plannedSprints) && entry.plannedSprints.length > 0
    ? entry.plannedSprints.filter((id) => typeof id === 'string')
    : activeSection
      ? extractSprintIds(activeSection.text)
      : [];
  const current = planned.find((id) => !completed.has(id)) ?? 'idle';
  const pending = planned.filter((id) => id !== current && !completed.has(id));
  const completedList = [...completed].filter((id) => planned.length === 0 || planned.includes(id));

  return [
    CURRENT_POINTER_BEGIN,
    `> **Current**: ${current}`,
    `> **Completed**: ${completedList.length > 0 ? completedList.join(', ') : '-'}`,
    `> **Pending**: ${pending.length > 0 ? pending.join(', ') : '-'}`,
    CURRENT_POINTER_END,
  ].join('\n');
}

function renderActiveRoadmap(history, activeSection) {
  const lines = [
    '# Sprint Roadmap',
    '',
    pointerBlock(history, activeSection),
    '',
    '> Active file: current iteration only. Archived iteration roadmaps live under `docs/plans/archive/roadmaps/`.',
    '',
  ];

  if (activeSection) {
    lines.push(activeSection.text.trim(), '');
  } else {
    lines.push('## No Active Iteration', '', 'Start the next iteration with `/vibe-iterate`.', '');
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}`;
}

function uniqueArchivePath(archiveDir, iterationId) {
  const basePath = path.join(archiveDir, `${iterationId}.md`);
  if (!existsSync(basePath)) {
    return basePath;
  }

  const stamp = (process.env.VIBE_ROADMAP_ARCHIVE_TIMESTAMP || new Date().toISOString())
    .replace(/[^0-9]/g, '')
    .slice(0, 14);
  for (let index = 1; index < 100; index += 1) {
    const candidate = path.join(archiveDir, `${iterationId}-${stamp}-${index}.md`);
    if (!existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`unable to allocate archive path for ${iterationId}`);
}

function archiveSection(root, section, dryRun) {
  const archiveDir = path.join(root, ARCHIVE_RELATIVE_DIR);
  const archiveContent = `${section.text.trim()}\n`;
  const primaryPath = path.join(archiveDir, `${section.iterationId}.md`);

  if (existsSync(primaryPath)) {
    const existing = readFileSync(primaryPath, 'utf8');
    if (existing.trim() === archiveContent.trim()) {
      return { action: 'exists', path: normalizeSlashes(path.relative(root, primaryPath)) };
    }

    const revisionPath = uniqueArchivePath(archiveDir, section.iterationId);
    if (!dryRun) {
      mkdirSync(archiveDir, { recursive: true });
      writeFileSync(revisionPath, archiveContent, 'utf8');
    }
    return { action: 'revision', path: normalizeSlashes(path.relative(root, revisionPath)) };
  }

  if (!dryRun) {
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(primaryPath, archiveContent, 'utf8');
  }
  return { action: 'archived', path: normalizeSlashes(path.relative(root, primaryPath)) };
}

function archivedIterationIds(root) {
  const archiveDir = path.join(root, ARCHIVE_RELATIVE_DIR);
  if (!existsSync(archiveDir)) {
    return new Set();
  }

  return new Set(
    readdirSync(archiveDir)
      .map((entry) => entry.match(/^(iter-\d+)(?:-\d{14}-\d+)?\.md$/)?.[1])
      .filter((id) => typeof id === 'string'),
  );
}

export function maintainRoadmap(root, options = {}) {
  const dryRun = options.dryRun === true;
  const roadmapPath = path.join(root, ROADMAP_RELATIVE_PATH);
  const history = readIterationHistory(root);
  if (!existsSync(roadmapPath)) {
    return {
      ok: true,
      changed: false,
      reason: 'roadmap-missing',
      activeIteration: history.currentIteration,
      archived: [],
      kept: [],
      findings: [],
    };
  }

  const original = readFileSync(roadmapPath, 'utf8');
  const sections = parseIterationSections(original);
  if (sections.length === 0) {
    return {
      ok: true,
      changed: false,
      reason: 'no-iteration-sections',
      activeIteration: history.currentIteration,
      archived: [],
      kept: [],
      findings: [],
    };
  }

  const currentId = history.currentIteration;
  const activeCandidates = currentId
    ? sections.filter((section) => section.iterationId === currentId)
    : [];
  const activeSection = activeCandidates.at(-1) ?? null;
  const archiveTargets = sections.filter((section) => section !== activeSection);
  const archived = archiveTargets.map((section) => ({
    iterationId: section.iterationId,
    ...archiveSection(root, section, dryRun),
  }));
  const nextContent = renderActiveRoadmap(history, activeSection);
  const changed = original.trim() !== nextContent.trim();

  if (changed && !dryRun) {
    mkdirSync(path.dirname(roadmapPath), { recursive: true });
    writeFileSync(roadmapPath, nextContent, 'utf8');
  }

  const archivedIds = archivedIterationIds(root);
  for (const result of archived) {
    archivedIds.add(result.iterationId);
  }
  const findings = [];
  for (const section of sections) {
    if (activeSection && section === activeSection) {
      continue;
    }
    if (!archivedIds.has(section.iterationId)) {
      findings.push({
        id: 'archive-missing',
        iterationId: section.iterationId,
        detail: `inactive roadmap section ${section.iterationId} is not archived`,
      });
    }
  }

  return {
    ok: findings.length === 0,
    changed,
    reason: changed ? 'rewrote-active-roadmap' : 'idempotent',
    activeIteration: currentId,
    archived,
    kept: activeSection ? [activeSection.iterationId] : [],
    findings,
  };
}

function parseArgs(argv) {
  const flags = {
    root: process.cwd(),
    dryRun: false,
    json: false,
    mode: 'check',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--root') {
      flags.root = path.resolve(argv[index + 1] ?? flags.root);
      index += 1;
    } else if (token === '--dry-run') {
      flags.dryRun = true;
    } else if (token === '--json') {
      flags.json = true;
    } else if (token === '--mode') {
      flags.mode = argv[index + 1] ?? flags.mode;
      index += 1;
    } else if (token === '--help' || token === '-h') {
      process.stdout.write('Usage: node .vibe/harness/scripts/vibe-roadmap-maintenance.mjs [--mode check|start-check|completion-check] [--root <dir>] [--dry-run] [--json]\n');
      process.exit(0);
    }
  }
  return flags;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const report = maintainRoadmap(flags.root, { dryRun: flags.dryRun, mode: flags.mode });

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const archived = report.archived.map((entry) => `${entry.iterationId}:${entry.action}`).join(', ') || '-';
    const kept = report.kept.join(', ') || '-';
    process.stdout.write(
      `[vibe-roadmap-maintenance] ${report.ok ? 'OK' : 'FAIL'} mode=${flags.mode} changed=${report.changed} active=${report.activeIteration ?? 'none'} kept=${kept} archived=${archived}\n`,
    );
    for (const finding of report.findings) {
      process.stdout.write(`- ${finding.id} ${finding.iterationId}: ${finding.detail}\n`);
    }
  }

  process.exit(report.ok ? 0 : 1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main();
}
