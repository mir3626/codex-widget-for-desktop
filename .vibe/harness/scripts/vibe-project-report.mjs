#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn as defaultSpawn } from 'node:child_process';
import { openExternalTarget } from './lib/browser-open.mjs';
import { isMetaSprintId } from './lib/project-report-meta.mjs';
import { renderProjectReportHtml } from './lib/project-report-template.mjs';

const OPEN_DEDUP_WINDOW_MS = 30_000;
const META_SESSION_TAGS = ['[harness-review]', '[meta-sprint-complete]', '[sprint-complete]'];
const META_COMMIT_PREFIXES = [
  'docs(process)',
  'chore(harness)',
  'refactor(process)',
  'docs(sprint):',
];

function parseArgs(argv) {
  const flags = {
    forceOpen: false,
    noOpen: false,
    output: path.join('docs', 'reports', 'project-report.html'),
    verbose: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--no-open') {
      flags.noOpen = true;
      continue;
    }
    if (token === '--force-open') {
      flags.forceOpen = true;
      continue;
    }
    if (token === '--verbose') {
      flags.verbose = true;
      continue;
    }
    if (token === '--output') {
      flags.output = argv[index + 1] ?? flags.output;
      index += 1;
    }
  }

  return flags;
}

async function readOptionalText(filePath) {
  if (!existsSync(filePath)) {
    return '';
  }
  return readFile(filePath, 'utf8');
}

async function readArchivedRoadmaps(root) {
  const archiveDir = path.join(root, 'docs', 'plans', 'archive', 'roadmaps');
  if (!existsSync(archiveDir)) {
    return '';
  }

  const files = (await readdir(archiveDir))
    .filter((entry) => entry.endsWith('.md'))
    .sort();
  const contents = [];
  for (const fileName of files) {
    contents.push(await readOptionalText(path.join(archiveDir, fileName)));
  }
  return contents.filter((content) => content.trim() !== '').join('\n\n');
}

async function readOptionalJson(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTemplateProjectStatus(root, status) {
  return (
    isRecord(status) &&
    isRecord(status.project) &&
    status.project.name === 'vibe-doctor' &&
    path.basename(root).toLowerCase() !== 'vibe-doctor'
  );
}

function isTemplateProductState(root, productMd) {
  return path.basename(root).toLowerCase() !== 'vibe-doctor' && /PROJECT NOT INITIALIZED/im.test(productMd);
}

function emptyIterationHistory() {
  return {
    currentIteration: null,
    iterations: [],
  };
}

function normalizeStatusForDisplay(root, status) {
  if (!isTemplateProjectStatus(root, status)) {
    return status;
  }

  return {
    ...status,
    project: {
      ...(isRecord(status.project) ? status.project : {}),
      name: 'Project',
    },
    handoff: {
      ...(isRecord(status.handoff) ? status.handoff : {}),
      currentSprintId: 'idle',
    },
    sprints: [],
    pendingRisks: [],
    sprintsSinceLastAudit: 0,
  };
}

function firstNonEmptyLine(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

function parseProduct(productMd, statusProjectName) {
  const lines = productMd.split(/\r?\n/).map((line) => line.trim());
  const heading = lines.find((line) => line.startsWith('# '));
  const platformLine = lines.find((line) => /^platform\s*:/i.test(line));
  const oneLiner = lines.find((line) => line.length > 0 && !line.startsWith('#') && !/^platform\s*:/i.test(line));

  return {
    name: heading ? heading.replace(/^#\s+/, '') : statusProjectName || 'Project',
    oneLiner: oneLiner ?? 'No project one-liner recorded yet.',
    platform: platformLine ? platformLine.replace(/^platform\s*:\s*/i, '') : 'unspecified',
  };
}

export function isMetaProject(inputs) {
  const config = isRecord(inputs.config) ? inputs.config : {};
  const packageJson = isRecord(inputs.packageJson) ? inputs.packageJson : {};
  const roadmapFirstLine = firstNonEmptyLine(inputs.roadmapMd ?? '') ?? '';

  return (
    (isRecord(config.project) && config.project.kind === 'meta') ||
    packageJson.name === 'vibe-doctor' ||
    /^#\s+vibe-doctor\b/i.test(roadmapFirstLine)
  );
}

function parseRoadmapSprintIds(roadmapMd) {
  const ids = [];
  const seen = new Set();

  for (const pattern of [
    /^- \*\*id\*\*:\s*`([^`]+)`/gim,
    /^#{2,6}\s+((?:iter-\d+-)?sprint-[A-Za-z0-9_.-]+)\b[^\n]*$/gim,
  ]) {
    for (const match of roadmapMd.matchAll(pattern)) {
      const id = match[1]?.trim();
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      ids.push(id);
    }
  }

  if (ids.length > 0) {
    return ids;
  }

  const lines = roadmapMd.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^##\s+Sprint\b/i.test(lines[index] ?? '')) {
      continue;
    }

    for (let offset = 1; offset <= 8; offset += 1) {
      const line = lines[index + offset];
      if (!line || line.startsWith('## ')) {
        break;
      }
      const match = line.match(/^\s*-\s+\*\*id\*\*:\s+`([^`]+)`/i);
      if (match?.[1]) {
        ids.push(match[1]);
        break;
      }
    }
  }

  return ids;
}

function parseRoadmapSprintDetails(roadmapMd) {
  const lines = roadmapMd.split(/\r?\n/);
  const details = new Map();

  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index]?.match(/^##\s+Sprint\s+(.+)$/i);
    const idHeading = lines[index]?.match(/^#{2,6}\s+((?:iter-\d+-)?sprint-[A-Za-z0-9_.-]+)\b[^\n]*$/i);
    if (idHeading?.[1]) {
      let goal = '';
      for (let offset = 1; offset <= 8; offset += 1) {
        const line = lines[index + offset];
        if (line === undefined || /^#{1,6}\s+/.test(line)) {
          break;
        }
        if (line.trim() === '') {
          continue;
        }
        const goalMatch = line.match(/^\s*(?:-\s+\*\*[^*]*(?:goal|target|objective|[^*]*)\*\*:\s+|Goal:\s*)(.+)$/i);
        if (goalMatch?.[1]) {
          goal = goalMatch[1].replace(/`/g, '').trim();
          break;
        }
      }
      details.set(idHeading[1], {
        name: idHeading[1],
        goal: goal || 'No sprint goal recorded.',
      });
      continue;
    }

    if (!heading) {
      continue;
    }

    let id = '';
    let goal = '';
    for (let offset = 1; offset <= 12; offset += 1) {
      const line = lines[index + offset];
      if (!line || line.startsWith('## ')) {
        break;
      }
      const idMatch = line.match(/^\s*-\s+\*\*id\*\*:\s+`([^`]+)`/i);
      if (idMatch?.[1]) {
        id = idMatch[1];
      }
      const goalMatch = line.match(/^\s*-\s+\*\*[^*]*(?:goal|target|objective|[^*]*)\*\*:\s+(.+)$/i);
      if (goal === '' && goalMatch?.[1]) {
        goal = goalMatch[1].replace(/`/g, '').trim();
      }
    }
    if (id !== '') {
      details.set(id, {
        name: heading[1]?.trim() ?? id,
        goal: goal || 'No sprint goal recorded.',
      });
    }
  }

  return details;
}

function parseMilestones(markdown) {
  const lines = markdown.split(/\r?\n/);
  const milestones = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(
      /^-\s+\*\*([^*]+)\*\*\s+[-:]\s+target_iteration=`([^`]+)`,\s+progress_metric=`([^`]+)`/i,
    );
    if (!match?.[1] || !match[2] || !match[3]) {
      continue;
    }

    const definitionLine = lines[index + 1]?.trim().replace(/^-\s+/, '') ?? '';
    milestones.push({
      id: match[1].trim(),
      name: match[1].trim(),
      targetIteration: match[2].trim(),
      progressMetric: match[3].trim(),
      definition: definitionLine,
    });
  }

  return milestones;
}

function computeMilestoneProgressFallback(history, milestones) {
  const progress = {};
  for (const milestone of milestones) {
    if (milestone.progressMetric !== 'sprint_complete_ratio') {
      progress[milestone.id] = 0;
      continue;
    }
    const target = history.iterations.find((entry) => entry.id === milestone.targetIteration);
    progress[milestone.id] =
      target && target.plannedSprints.length > 0
        ? target.completedSprints.length / target.plannedSprints.length
        : 0;
  }
  return progress;
}

async function computeMilestoneProgress(root, history, milestones) {
  try {
    const modulePath = pathToFileURL(path.join(root, 'src', 'lib', 'iteration.ts')).href;
    const mod = await import(modulePath);
    if (typeof mod.computeMilestoneProgress === 'function') {
      return mod.computeMilestoneProgress(history, milestones);
    }
  } catch {
    // Plain node cannot load TypeScript; keep the report CLI build-free.
  }

  return computeMilestoneProgressFallback(history, milestones);
}

function normalizeIterationHistory(value) {
  if (!isRecord(value) || !Array.isArray(value.iterations)) {
    return { currentIteration: null, iterations: [] };
  }
  return {
    currentIteration: typeof value.currentIteration === 'string' ? value.currentIteration : null,
    iterations: value.iterations.filter(isRecord).map((entry) => ({
      id: String(entry.id ?? ''),
      label: String(entry.label ?? entry.id ?? ''),
      goal: String(entry.goal ?? ''),
      startedAt: String(entry.startedAt ?? ''),
      completedAt: typeof entry.completedAt === 'string' ? entry.completedAt : null,
      plannedSprints: Array.isArray(entry.plannedSprints) ? entry.plannedSprints.map(String) : [],
      completedSprints: Array.isArray(entry.completedSprints)
        ? entry.completedSprints.map(String)
        : [],
      milestoneProgress: isRecord(entry.milestoneProgress) ? entry.milestoneProgress : {},
      summary: String(entry.summary ?? ''),
    })),
  };
}

function filterSessionDecisions(sessionLog, metaProject) {
  return sessionLog
    .split(/\r?\n/)
    .filter((line) => line.includes('[decision]'))
    .filter((line) => !metaProject || !META_SESSION_TAGS.some((tag) => line.includes(tag)))
    .slice(0, 12);
}

function readGitLog(root) {
  try {
    return execFileSync('git', ['log', '--oneline', '-200'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function filterCommits(commits, metaProject) {
  if (!metaProject) {
    return commits;
  }
  return commits.filter((line) => {
    const message = line.replace(/^[a-f0-9]+\s+/, '');
    return !META_COMMIT_PREFIXES.some((prefix) => message.startsWith(prefix));
  });
}

function statusLabel(status, iterationHistory) {
  if (iterationHistory.currentIteration) {
    return `${iterationHistory.currentIteration}-in-progress`;
  }
  return status?.handoff?.currentSprintId && status.handoff.currentSprintId !== 'idle'
    ? 'in-progress'
    : 'idle';
}

function classifyLogTag(tags) {
  if (tags.includes('planner-skip')) {
    return 'planner-skip';
  }
  if (tags.includes('drift-observed')) {
    return 'drift-observed';
  }
  if (tags.includes('user-directive')) {
    return 'user-directive';
  }
  if (tags.includes('sprint-complete')) {
    return 'sprint-complete';
  }
  if (tags.includes('failure')) {
    return 'failure';
  }
  if (tags.some((tag) => tag === 'audit' || tag === 'audit-clear' || tag === 'harness-review')) {
    return 'audit';
  }
  if (tags.includes('decision')) {
    return 'decision';
  }
  return null;
}

function parseSessionEntry(line) {
  const match = line.match(/^\s*-\s+(\d{4}-\d{2}-\d{2})T([^ ]+)\s+((?:\[[^\]]+\])+)\s*(.*)$/);
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  const tags = [...match[3].matchAll(/\[([^\]]+)\]/g)].map((tagMatch) => tagMatch[1]).filter(Boolean);
  const tag = classifyLogTag(tags);
  if (!tag) {
    return null;
  }
  return {
    date: match[1],
    time: match[2].replace(/(?:\.\d{3})?Z$/, '').slice(0, 8),
    tag,
    content: match[4]?.trim() ?? '',
  };
}

function filterSessionEntries(sessionLog, metaProject) {
  return sessionLog
    .split(/\r?\n/)
    .filter((line) => !metaProject || !line.includes('[harness-review]'))
    .map(parseSessionEntry)
    .filter(Boolean)
    .slice(0, 80);
}

async function buildModel(root) {
  const [
    rawProductMd,
    rawRoadmapMd,
    archivedRoadmapMd,
    rawMilestonesMd,
    rawStatus,
    rawSessionLog,
    rawHandoff,
    rawIterationHistory,
    config,
    packageJson,
  ] = await Promise.all([
    readOptionalText(path.join(root, 'docs', 'context', 'product.md')),
    readOptionalText(path.join(root, 'docs', 'plans', 'sprint-roadmap.md')),
    readArchivedRoadmaps(root),
    readOptionalText(path.join(root, 'docs', 'plans', 'project-milestones.md')),
    readOptionalJson(path.join(root, '.vibe', 'agent', 'sprint-status.json'), {}),
    readOptionalText(path.join(root, '.vibe', 'agent', 'session-log.md')),
    readOptionalText(path.join(root, '.vibe', 'agent', 'handoff.md')),
    readOptionalJson(path.join(root, '.vibe', 'agent', 'iteration-history.json'), emptyIterationHistory()),
    readOptionalJson(path.join(root, '.vibe', 'config.json'), {}),
    readOptionalJson(path.join(root, 'package.json'), {}),
  ]);
  const templateState = isTemplateProjectStatus(root, rawStatus) || isTemplateProductState(root, rawProductMd);
  const productMd = templateState ? '' : rawProductMd;
  const roadmapMd = templateState ? '' : [rawRoadmapMd, archivedRoadmapMd].filter((text) => text.trim() !== '').join('\n\n');
  const milestonesMd = templateState ? '' : rawMilestonesMd;
  const status = normalizeStatusForDisplay(root, rawStatus);
  const sessionLog = templateState ? '' : rawSessionLog;
  const handoff = templateState ? '' : rawHandoff;
  const iterationHistoryRaw = templateState ? emptyIterationHistory() : rawIterationHistory;
  const iterationHistory = normalizeIterationHistory(iterationHistoryRaw);
  const milestones = parseMilestones(milestonesMd);
  const metaProject = !templateState && isMetaProject({ config, packageJson, roadmapMd });
  const commits = filterCommits(readGitLog(root), metaProject);
  const excludedCommits = readGitLog(root).length - commits.length;
  const decisions = filterSessionDecisions(sessionLog, metaProject);
  const reportEntries = filterSessionEntries(sessionLog, metaProject);
  const metaSummary = metaProject
    ? (Array.isArray(status?.sprints) ? status.sprints : [])
        .filter((entry) => isMetaSprintId(entry.id))
        .slice(-6)
        .map((entry) => `Meta sprint ${entry.id}: ${entry.status}`)
    : [];

  return {
    productMd,
    product: parseProduct(productMd, status?.project?.name),
    status,
    sessionLog,
    handoff,
    iterationHistory,
    milestones,
    milestoneProgress: await computeMilestoneProgress(root, iterationHistory, milestones),
    roadmapIds: parseRoadmapSprintIds(roadmapMd),
    roadmapDetails: parseRoadmapSprintDetails(roadmapMd),
    packageJson,
    metaProject,
    decisions,
    reportEntries,
    metaSummary,
    commits,
    statusLabel: statusLabel(status, iterationHistory),
    generatedAt: new Date().toISOString(),
    updatedAt: String(status?.stateUpdatedAt ?? status?.handoff?.updatedAt ?? 'unknown'),
    filterStats: {
      excludedSprints: (Array.isArray(status?.sprints) ? status.sprints : []).filter((entry) => metaProject && isMetaSprintId(entry.id)).length,
      excludedCommits,
    },
  };
}

function reportOpenMarkerPath(root, outPath) {
  const hash = createHash('sha256')
    .update(path.resolve(root))
    .update('\0')
    .update(path.resolve(outPath))
    .digest('hex')
    .slice(0, 24);
  return path.join(tmpdir(), 'vibe-doctor', `project-report-open-${hash}.json`);
}

async function shouldOpenReport(root, outPath, flags, nowMs) {
  if (flags.forceOpen) {
    return true;
  }

  try {
    const marker = JSON.parse(await readFile(reportOpenMarkerPath(root, outPath), 'utf8'));
    const openedAtMs =
      typeof marker?.openedAtMs === 'number'
        ? marker.openedAtMs
        : Date.parse(String(marker?.openedAt ?? ''));
    const ageMs = nowMs - openedAtMs;
    return !(Number.isFinite(ageMs) && ageMs >= 0 && ageMs < OPEN_DEDUP_WINDOW_MS);
  } catch {
    return true;
  }
}

async function recordReportOpen(root, outPath, nowMs) {
  try {
    const markerPath = reportOpenMarkerPath(root, outPath);
    await mkdir(path.dirname(markerPath), { recursive: true });
    await writeFile(
      markerPath,
      `${JSON.stringify({ openedAt: new Date(nowMs).toISOString(), openedAtMs: nowMs }, null, 2)}\n`,
      'utf8',
    );
  } catch {
    // Best-effort browser-open dedupe. Report generation must not fail because of marker I/O.
  }
}

function openReport(outPath, spawnFn, platform, stderr = process.stderr) {
  return openExternalTarget(outPath, 'project report', spawnFn, platform, stderr);
}

export async function runProjectReportCli(argv = process.argv.slice(2), options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const flags = parseArgs(argv);
  const outPath = path.resolve(root, flags.output);
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const model = await buildModel(root);
  const html = renderProjectReportHtml(model);

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, html, 'utf8');

  if (flags.verbose) {
    const stderr = options.stderr ?? process.stderr;
    stderr.write(
      `meta-project=${model.metaProject ? 'true' : 'false'}, excluded sprints=${model.filterStats.excludedSprints}, excluded commits=${model.filterStats.excludedCommits}\n`,
    );
  }

  if (!flags.noOpen && await shouldOpenReport(root, outPath, flags, nowMs)) {
    const opened = openReport(outPath, options.spawn ?? defaultSpawn, options.platform ?? process.platform, options.stderr ?? process.stderr);
    if (opened) {
      await recordReportOpen(root, outPath, nowMs);
    }
  }

  const stdout = options.stdout ?? process.stdout;
  stdout.write(`${outPath}\n`);
  return { outPath, html, model };
}

const entryHref = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entryHref) {
  runProjectReportCli().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
