import { execFile as execFileCallback } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { readDecisions, type ProjectDecision } from './decisions.js';
import { fileExists, readJson, readText } from './fs.js';
import { paths } from './paths.js';
import {
  isOpenPendingRisk,
  loadSprintStatus,
  withDefaults,
  type PendingRisk,
  type SprintStatus,
} from './sprint-status.js';
export {
  detectOptInGaps,
  type ReviewConfigInput,
  type ReviewIssueSeed,
  type ReviewSeedInput,
} from './review-opt-in.js';

const execFile = promisify(execFileCallback);
const DEFAULT_RECENT_ENTRIES = 50;
const DEFAULT_GIT_COMMITS = 20;
const PRODUCT_FETCHER_ROUTE_FILES = new Set(['route.ts', 'route.tsx', 'route.mjs', 'route.js']);
const PRODUCT_FETCHER_SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.vibe']);
const WIRING_REFERENCE_FILES = [
  'package.json',
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  '.claude/settings.json',
];

export interface PendingRestoration {
  sourceFile: string;
  ruleSlug: string;
  title: string;
  tier: 'S' | 'A' | 'B' | 'C';
  reason: string;
}

export interface WiringDriftFinding {
  artifactPath: string;
  referencePaths: string[];
  missingRuntimeReference: boolean;
  missingSyncManifest: boolean;
}

export interface HarnessGapEntry {
  id: string;
  symptom: string;
  coveredBy: string;
  status: string;
  scriptGate: string | null;
  migrationDeadline: string | null;
  line: number;
}

export interface PendingRiskRollup {
  key: string;
  count: number;
  riskIds: string[];
  sampleText: string;
  code?: string;
  raisedBy?: string;
  targetSprint?: string;
  latestCreatedAt?: string;
}

export interface ReviewInputs {
  handoff: string;
  sessionLog: string;
  recentSessionEntries: string[];
  recentEntriesLimit: number;
  gitLog: string[];
  gitLogMode: 'recent' | 'since-last-review';
  gitCommitLimit: number;
  latestReviewReportPath: string | null;
  openPendingRisks: PendingRisk[];
  decisions: ProjectDecision[];
  passedSprintCount: number;
  productText: string;
  harnessGaps: string;
  openHarnessGapCount: number;
  uncoveredHarnessGaps: HarnessGapEntry[];
  deadlineHarnessGaps: HarnessGapEntry[];
  pendingRestorations: PendingRestoration[];
  productFetcherPaths: string[];
  wiringDriftFindings: WiringDriftFinding[];
  pendingRiskRollups: PendingRiskRollup[];
}

export interface PriorReviewIssue {
  id: string;
  severity: 'blocker' | 'friction' | 'polish' | 'structural';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  proposal: string;
  sourceReportPath: string;
  sourceReportDate: string;
}

export interface RegressionStatus {
  issue: PriorReviewIssue;
  status: 'covered' | 'partial' | 'open';
  evidence: string[];
}

export interface IssueWeights {
  agentFriendly: number;
  tokenEfficient: number;
  userFyi: number;
}

function resolveRoot(root?: string): string {
  return root ?? paths.root;
}

function handoffPath(root?: string): string {
  return path.join(resolveRoot(root), '.vibe', 'agent', 'handoff.md');
}

function sessionLogPath(root?: string): string {
  return path.join(resolveRoot(root), '.vibe', 'agent', 'session-log.md');
}

function sharedConfigPath(root?: string): string {
  return path.join(resolveRoot(root), '.vibe', 'config.json');
}

function productPath(root?: string): string {
  return path.join(resolveRoot(root), 'docs', 'context', 'product.md');
}

function harnessGapsPath(root?: string): string {
  return path.join(resolveRoot(root), 'docs', 'context', 'harness-gaps.md');
}

function archiveRulesDeletedPath(root?: string): string {
  return path.join(resolveRoot(root), '.vibe', 'archive');
}

function auditPath(root?: string): string {
  return path.join(resolveRoot(root), '.vibe', 'audit');
}

function reportsPath(root?: string): string {
  return path.join(resolveRoot(root), 'docs', 'reports');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReviewSeverity(value: string): value is PriorReviewIssue['severity'] {
  return value === 'blocker' || value === 'friction' || value === 'polish' || value === 'structural';
}

function isReviewPriority(value: string): value is PriorReviewIssue['priority'] {
  return value === 'P0' || value === 'P1' || value === 'P2' || value === 'P3';
}

function readRecentEntriesLimit(config: unknown): number {
  if (!isRecord(config)) {
    return DEFAULT_RECENT_ENTRIES;
  }

  const review = config.review;
  if (!isRecord(review) || typeof review.recentEntries !== 'number') {
    return DEFAULT_RECENT_ENTRIES;
  }

  return Number.isInteger(review.recentEntries) && review.recentEntries > 0
    ? review.recentEntries
    : DEFAULT_RECENT_ENTRIES;
}

async function readOptionalText(filePath: string): Promise<string> {
  return (await fileExists(filePath)) ? readText(filePath) : '';
}

function extractFindingsSection(markdown: string): string {
  const match = markdown.match(/^##\s+Findings(?:\s*\([^)]*\))?\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  return match?.[1] ?? '';
}

function extractYamlBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const pattern = /```ya?ml\s*([\s\S]*?)```/gi;
  let match = pattern.exec(markdown);
  while (match) {
    blocks.push(match[1] ?? '');
    match = pattern.exec(markdown);
  }
  return blocks.length > 0 ? blocks : [markdown];
}

function parseYamlScalar(line: string, key: string): string | null {
  const match = line.match(new RegExp(`^\\s*-?\\s*${key}:\\s*(.+?)\\s*$`));
  if (!match?.[1]) {
    return null;
  }
  return match[1].replace(/^['"]|['"]$/g, '').trim();
}

function parseRestorationHeading(heading: string): Pick<PendingRestoration, 'ruleSlug' | 'title'> {
  const match = heading.trim().match(/^(.+?)\s+(?:—|-)\s+(.+)$/);
  const title = match?.[2]?.trim() ?? heading.trim();
  const ruleSlug = match?.[1]?.trim() ?? title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return { ruleSlug, title };
}

function validRestorationTier(value: string | null | undefined): value is PendingRestoration['tier'] {
  return value === 'S' || value === 'A' || value === 'B' || value === 'C';
}

function restorationValue(lines: string[], key: string): string | null {
  return lines.map((line) => parseYamlScalar(line, key)).find(Boolean) ?? null;
}

function splitRestorationSection(section: string): { heading: string; lines: string[] } | null {
  const lines = section.split(/\r?\n/);
  const heading = lines[0]?.replace(/^##\s+/, '').trim();
  if (!heading) {
    return null;
  }
  const body = lines.slice(1);
  const boundaryIndex = body.findIndex((line) => /^---\s*$/.test(line));
  return { heading, lines: boundaryIndex === -1 ? body : body.slice(0, boundaryIndex) };
}

function collectDeleteConfirmedSlugs(markdown: string): Set<string> {
  const slugs = new Set<string>();
  for (const section of markdown.split(/\r?\n(?=##\s+)/).filter((entry) => entry.startsWith('## '))) {
    const parsedSection = splitRestorationSection(section);
    if (!parsedSection) continue;
    const scalarDeleteConfirmed = parsedSection.lines.some(
      (line) =>
        parseYamlScalar(line, 'restoration_decision')?.replace(/\*/g, '').toLowerCase() === 'delete-confirmed',
    );
    if (scalarDeleteConfirmed) {
      slugs.add(parseRestorationHeading(parsedSection.heading).ruleSlug);
    }
    const heading = parsedSection.heading.toLowerCase();
    if (/\biter-\d+\b/.test(heading) || heading.includes('delete-confirmed')) {
      for (const line of parsedSection.lines) {
        const slug = /delete-confirmed/i.test(line) ? line.match(/`([^`]+)`/)?.[1]?.trim() : null;
        if (slug) slugs.add(slug);
      }
    }
  }
  return slugs;
}

function parseRestorationSections(markdown: string, sourceFile: string): PendingRestoration[] {
  const restorations: PendingRestoration[] = [];
  const deleteConfirmedSlugs = collectDeleteConfirmedSlugs(markdown);

  for (const section of markdown.split(/\r?\n(?=##\s+)/).filter((entry) => entry.startsWith('## '))) {
    const parsedSection = splitRestorationSection(section);
    if (!parsedSection || restorationValue(parsedSection.lines, 'restoration_decision') !== 'pending') {
      continue;
    }

    const parsedHeading = parseRestorationHeading(parsedSection.heading);
    if (deleteConfirmedSlugs.has(parsedHeading.ruleSlug)) {
      continue;
    }

    const rawTier = restorationValue(parsedSection.lines, 'tier');
    const reason = restorationValue(parsedSection.lines, 'reason') ?? '';

    restorations.push({
      sourceFile,
      ruleSlug: parsedHeading.ruleSlug,
      title: parsedHeading.title,
      tier: validRestorationTier(rawTier) ? rawTier : 'C',
      reason: validRestorationTier(rawTier) ? reason : `[tier-fallback] ${reason}`.trim(),
    });
  }

  return restorations;
}

function parseReviewIssuesFromBlock(
  block: string,
  sourceReportPath: string,
  sourceReportDate: string,
): PriorReviewIssue[] {
  const issues: PriorReviewIssue[] = [];
  const chunks = block
    .split(/\r?\n(?=\s*-\s+id:\s*)/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    const lines = chunk
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*-\s+/, '').trimEnd());
    const id = parseYamlScalar(lines[0] ?? '', 'id') ?? parseYamlScalar(chunk, 'id');
    const severity = lines.map((line) => parseYamlScalar(line, 'severity')).find(Boolean);
    const priority = lines.map((line) => parseYamlScalar(line, 'priority')).find(Boolean);
    const proposal = lines.map((line) => parseYamlScalar(line, 'proposal')).find(Boolean);

    if (
      !id ||
      !severity ||
      !priority ||
      !proposal ||
      !isReviewSeverity(severity) ||
      !isReviewPriority(priority)
    ) {
      continue;
    }

    issues.push({
      id,
      severity,
      priority,
      proposal,
      sourceReportPath,
      sourceReportDate,
    });
  }

  return issues;
}

function sourceDateFromFileName(fileName: string, fallbackMtimeMs: number): string {
  return fileName.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? new Date(fallbackMtimeMs).toISOString();
}

function proposalKeywords(proposal: string): string[] {
  return Array.from(
    new Set(
      proposal
        .toLowerCase()
        .split(/[^a-z0-9./_-]+/)
        .filter((word) => word.length >= 3),
    ),
  ).slice(0, 8);
}

function splitMarkdownTableRow(row: string): string[] {
  const cells: string[] = [];
  let current = '';
  let activeBacktickFenceLength = 0;

  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];
    if (char === undefined) {
      continue;
    }

    if (char === '`') {
      let runLength = 1;
      while (row[index + runLength] === '`') {
        runLength += 1;
      }

      current += '`'.repeat(runLength);
      if (activeBacktickFenceLength === 0) {
        activeBacktickFenceLength = runLength;
      } else if (activeBacktickFenceLength === runLength) {
        activeBacktickFenceLength = 0;
      }
      index += runLength - 1;
      continue;
    }

    if (char === '\\' && row[index + 1] === '|') {
      current += '|';
      index += 1;
      continue;
    }

    if (char === '|' && activeBacktickFenceLength === 0) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());

  if (cells[0] === '') {
    cells.shift();
  }

  if (cells[cells.length - 1] === '') {
    cells.pop();
  }

  return cells;
}

function rowHasCoveredStatus(row: string): boolean {
  const cells = splitMarkdownTableRow(row)
    .map((cell) => cell.trim().toLowerCase())
    .filter(Boolean);
  return cells.includes('covered');
}

function pathMentions(proposal: string): string[] {
  return Array.from(new Set(proposal.match(/scripts\/vibe-[a-z0-9-]+\.mjs/gi) ?? [])).map((entry) =>
    entry.replace(/\\/g, '/'),
  );
}

function extractCurrentSessionEntries(sessionLog: string, limit: number): string[] {
  const lines = sessionLog.split(/\r?\n/);
  const entries: string[] = [];
  let inEntries = false;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (inEntries) {
        break;
      }

      inEntries = line.trim() === '## Entries';
      continue;
    }

    if (inEntries && line.startsWith('- ')) {
      entries.push(line);
    }
  }

  return entries.slice(0, limit);
}

async function findLatestReviewReport(root?: string): Promise<string | null> {
  const reportsDir = reportsPath(root);
  if (!(await fileExists(reportsDir))) {
    return null;
  }

  const fileNames = await readdir(reportsDir);
  let latestFile: string | null = null;
  let latestMtime = -1;

  for (const fileName of fileNames) {
    if (!/^review-\d+-\d{4}-\d{2}-\d{2}\.md$/.test(fileName)) {
      continue;
    }

    const absolutePath = path.join(reportsDir, fileName);
    const fileStat = await stat(absolutePath);
    if (fileStat.mtimeMs <= latestMtime) {
      continue;
    }

    latestMtime = fileStat.mtimeMs;
    latestFile = absolutePath;
  }

  return latestFile;
}

async function readLastReviewCommit(
  root: string,
  latestReviewReportPath: string,
): Promise<string | null> {
  try {
    const relativePath = path.relative(root, latestReviewReportPath);
    const { stdout } = await execFile(
      'git',
      ['log', '-n', '1', '--format=%H', '--', relativePath],
      { cwd: root },
    );
    const commit = stdout.trim();
    return commit.length > 0 ? commit : null;
  } catch {
    return null;
  }
}

async function readGitLog(
  root: string,
  latestReviewReportPath: string | null,
): Promise<Pick<ReviewInputs, 'gitLog' | 'gitLogMode' | 'gitCommitLimit'>> {
  const lastReviewCommit =
    latestReviewReportPath === null
      ? null
      : await readLastReviewCommit(root, latestReviewReportPath);

  const args =
    lastReviewCommit === null
      ? ['log', '--oneline', `-${DEFAULT_GIT_COMMITS}`]
      : ['log', '--oneline', `${lastReviewCommit}..HEAD`];

  try {
    const { stdout } = await execFile('git', args, { cwd: root });
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return {
      gitLog: lines,
      gitLogMode: lastReviewCommit === null ? 'recent' : 'since-last-review',
      gitCommitLimit: DEFAULT_GIT_COMMITS,
    };
  } catch {
    return {
      gitLog: [],
      gitLogMode: lastReviewCommit === null ? 'recent' : 'since-last-review',
      gitCommitLimit: DEFAULT_GIT_COMMITS,
    };
  }
}

async function loadReviewSprintStatus(root: string): Promise<SprintStatus> {
  try {
    return await loadSprintStatus(root);
  } catch {
    return withDefaults({
      schemaVersion: '0.1',
      project: {
        name: path.basename(root),
        createdAt: '1970-01-01T00:00:00.000Z',
      },
      sprints: [],
      verificationCommands: [],
    });
  }
}

function parseHarnessGapRow(line: string, lineNumber: number): HarnessGapEntry | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.includes('gap-')) {
    return null;
  }

  const cells = splitMarkdownTableRow(trimmed).map((cell) => cell.trim());

  if (cells.length < 4 || !/^gap-[a-z0-9-]+$/i.test(cells[0] ?? '')) {
    return null;
  }

  return {
    id: cells[0] ?? '',
    symptom: cells[1] ?? '',
    coveredBy: cells[2] ?? '',
    status: (cells[3] ?? '').toLowerCase(),
    scriptGate: cells[4] === undefined || cells[4] === '' ? null : cells[4].toLowerCase(),
    migrationDeadline: cells[5] === undefined || cells[5] === '' ? null : cells[5],
    line: lineNumber,
  };
}

function parseHarnessGaps(markdown: string): HarnessGapEntry[] {
  return markdown
    .split(/\r?\n/)
    .map((line, index) => parseHarnessGapRow(line, index + 1))
    .filter((entry): entry is HarnessGapEntry => entry !== null);
}

function isUncoveredHarnessGap(gap: HarnessGapEntry): boolean {
  if (['open', 'partial', 'under-review'].includes(gap.status)) {
    return true;
  }
  return gap.scriptGate !== null && gap.scriptGate !== 'covered';
}

function hasDeadlineSignal(gap: HarnessGapEntry): boolean {
  const deadline = gap.migrationDeadline?.trim() ?? '';
  return /^\+\d+\s+sprints?$/i.test(deadline) || /^O[\w.-]*$/i.test(deadline);
}

function countOpenHarnessGaps(gaps: HarnessGapEntry[]): number {
  return gaps.filter((gap) => gap.status === 'open').length;
}

function collectUncoveredHarnessGaps(gaps: HarnessGapEntry[]): HarnessGapEntry[] {
  return gaps.filter(isUncoveredHarnessGap);
}

function collectDeadlineHarnessGaps(gaps: HarnessGapEntry[]): HarnessGapEntry[] {
  return gaps.filter((gap) => isUncoveredHarnessGap(gap) && hasDeadlineSignal(gap));
}

function normalizePendingRiskText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\bsprint-[a-z0-9-]+\b/g, 'sprint-*')
    .replace(/\b\d+\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function pendingRiskRollupKey(risk: PendingRisk): string {
  const code = typeof risk.code === 'string' && risk.code.trim() !== '' ? risk.code.trim() : null;
  if (code) {
    return `code:${code}`;
  }

  const message =
    typeof risk.message === 'string' && risk.message.trim() !== ''
      ? risk.message
      : risk.text;
  return `text:${normalizePendingRiskText(message)}`;
}

function collectPendingRiskRollups(risks: PendingRisk[]): PendingRiskRollup[] {
  const groups = new Map<string, PendingRisk[]>();
  for (const risk of risks.filter(isOpenPendingRisk)) {
    const key = pendingRiskRollupKey(risk);
    const group = groups.get(key) ?? [];
    group.push(risk);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => {
      const sorted = [...group].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      const sample = sorted[0] ?? group[0];
      const rollup: PendingRiskRollup = {
        key,
        count: group.length,
        riskIds: group.map((risk) => risk.id),
        sampleText: sample?.message ?? sample?.text ?? '',
      };
      if (sample?.code) {
        rollup.code = sample.code;
      }
      if (sample?.raisedBy) {
        rollup.raisedBy = sample.raisedBy;
      }
      if (sample?.targetSprint) {
        rollup.targetSprint = sample.targetSprint;
      }
      if (sample?.createdAt) {
        rollup.latestCreatedAt = sample.createdAt;
      }
      return rollup;
    })
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function sourceFilePath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).replace(/\\/g, '/');
}

async function collectProductFetcherPathsInDir(root: string, directory: string, files: string[]): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!PRODUCT_FETCHER_SKIP_DIRS.has(entry.name)) {
        await collectProductFetcherPathsInDir(root, path.join(directory, entry.name), files);
      }
      continue;
    }

    if (entry.isFile() && PRODUCT_FETCHER_ROUTE_FILES.has(entry.name)) {
      files.push(path.relative(root, path.join(directory, entry.name)).replace(/\\/g, '/'));
    }
  }
}

async function collectProductFetcherPaths(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const appRoot of ['app', 'src/app'].map((relativeRoot) => path.join(root, relativeRoot))) {
    if (await fileExists(appRoot)) {
      await collectProductFetcherPathsInDir(root, appRoot, files);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function collectFilesInDir(
  root: string,
  relativeDir: string,
  predicate: (relativePath: string) => boolean,
): Promise<string[]> {
  const absoluteDir = path.join(root, relativeDir);
  const files: string[] = [];
  if (!(await fileExists(absoluteDir))) {
    return files;
  }

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (entry.isFile() && predicate(relativePath)) {
        files.push(relativePath);
      }
    }
  }

  await visit(absoluteDir);
  return files.sort((left, right) => left.localeCompare(right));
}

function referencesArtifact(content: string, artifactPath: string): boolean {
  const basename = path.basename(artifactPath);
  return content.includes(artifactPath) || content.includes(basename);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function manifestPatternMatches(pattern: string, artifactPath: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, '/');
  const normalizedArtifact = artifactPath.replace(/\\/g, '/');
  const regex = new RegExp(
    `^${escapeRegExp(normalizedPattern)
      .replaceAll('\\*\\*', '.*')
      .replaceAll('\\*', '[^/]*')}$`,
  );
  return regex.test(normalizedArtifact);
}

function manifestReferencesArtifact(syncManifest: string, artifactPath: string): boolean {
  if (syncManifest.includes(artifactPath)) {
    return true;
  }

  const patterns = Array.from(syncManifest.matchAll(/"([^"]*\*[^"]*)"/g), (match) => match[1] ?? '');
  return patterns.some((pattern) => manifestPatternMatches(pattern, artifactPath));
}

async function collectWiringReferenceFiles(root: string): Promise<Array<{ path: string; content: string }>> {
  const skillFiles = [
    ...(await collectFilesInDir(root, '.claude/skills', (relativePath) => relativePath.endsWith('/SKILL.md'))),
    ...(await collectFilesInDir(root, '.codex/skills', (relativePath) => relativePath.endsWith('/SKILL.md'))),
  ];
  const scriptFiles = [
    ...(await collectFilesInDir(root, '.vibe/harness/scripts', (relativePath) =>
      /^\.vibe\/harness\/scripts\/[\w-]+\.(?:mjs|cmd|sh)$/.test(relativePath),
    )),
    ...(await collectFilesInDir(root, 'scripts', (relativePath) => /^scripts\/[\w-]+\.(?:mjs|cmd|sh)$/.test(relativePath))),
  ];
  const candidates = [...WIRING_REFERENCE_FILES, ...skillFiles, ...scriptFiles];
  const references: Array<{ path: string; content: string }> = [];

  for (const relativePath of candidates) {
    const content = await readOptionalText(path.join(root, relativePath));
    if (content.length > 0) {
      references.push({ path: relativePath, content });
    }
  }

  return references;
}

export async function collectWiringDriftFindings(root?: string): Promise<WiringDriftFinding[]> {
  const resolvedRoot = resolveRoot(root);
  const scriptPaths = [
    ...(await collectFilesInDir(
      resolvedRoot,
      '.vibe/harness/scripts',
      (relativePath) => /^\.vibe\/harness\/scripts\/vibe-[\w-]+\.mjs$/.test(relativePath),
    )),
    ...(await collectFilesInDir(
      resolvedRoot,
      'scripts',
      (relativePath) => /^scripts\/vibe-[\w-]+\.mjs$/.test(relativePath),
    )),
  ];
  const syncManifest = await readOptionalText(path.join(resolvedRoot, '.vibe', 'sync-manifest.json'));
  const referenceFiles = await collectWiringReferenceFiles(resolvedRoot);
  const findings: WiringDriftFinding[] = [];

  for (const artifactPath of scriptPaths) {
    const referencePaths = referenceFiles
      .filter((reference) => reference.path !== artifactPath)
      .filter((reference) => referencesArtifact(reference.content, artifactPath))
      .map((reference) => reference.path)
      .sort((left, right) => left.localeCompare(right));
    const missingRuntimeReference = referencePaths.length === 0;
    const missingSyncManifest = !manifestReferencesArtifact(syncManifest, artifactPath);

    if (missingRuntimeReference || missingSyncManifest) {
      findings.push({
        artifactPath,
        referencePaths,
        missingRuntimeReference,
        missingSyncManifest,
      });
    }
  }

  return findings.sort((left, right) => left.artifactPath.localeCompare(right.artifactPath));
}

function auditIterationPriority(filePath: string): number {
  const match = filePath.replace(/\\/g, '/').match(/\.vibe\/audit\/iter-(\d+)\/rules-deleted\.md$/);
  return match?.[1] ? 1000 + Number.parseInt(match[1], 10) : 1000;
}

async function collectRulesDeletedFiles(
  root: string,
): Promise<Array<{ absolutePath: string; priority: number }>> {
  const files: Array<{ absolutePath: string; priority: number }> = [];
  const archiveDir = archiveRulesDeletedPath(root);
  if (await fileExists(archiveDir)) {
    for (const fileName of await readdir(archiveDir)) {
      if (/^rules-deleted-.*\.md$/i.test(fileName)) {
        files.push({ absolutePath: path.join(archiveDir, fileName), priority: 0 });
      }
    }
  }

  const auditDir = auditPath(root);
  if (await fileExists(auditDir)) {
    for (const dirName of await readdir(auditDir)) {
      const absolutePath = path.join(auditDir, dirName, 'rules-deleted.md');
      if (dirName.startsWith('iter-') && (await fileExists(absolutePath))) {
        files.push({ absolutePath, priority: auditIterationPriority(absolutePath) });
      }
    }
  }

  return files.sort((left, right) => left.priority - right.priority || left.absolutePath.localeCompare(right.absolutePath));
}

export async function collectPendingRestorationDecisions(
  root?: string,
): Promise<PendingRestoration[]> {
  const resolvedRoot = resolveRoot(root);
  const bySlug = new Map<string, PendingRestoration>();

  for (const file of await collectRulesDeletedFiles(resolvedRoot)) {
    const sourceFile = sourceFilePath(resolvedRoot, file.absolutePath);
    for (const restoration of parseRestorationSections(await readText(file.absolutePath), sourceFile)) {
      bySlug.set(restoration.ruleSlug, restoration);
    }
  }

  return [...bySlug.values()];
}

export async function collectReviewInputs(root?: string): Promise<ReviewInputs> {
  const resolvedRoot = resolveRoot(root);
  const config = await readJson<unknown>(sharedConfigPath(resolvedRoot)).catch(() => ({}));
  const recentEntriesLimit = readRecentEntriesLimit(config);
  const [
    handoff,
    sessionLog,
    status,
    decisions,
    productText,
    harnessGaps,
    latestReviewReportPath,
    pendingRestorations,
    productFetcherPaths,
    wiringDriftFindings,
  ] = await Promise.all([
    readOptionalText(handoffPath(resolvedRoot)),
    readOptionalText(sessionLogPath(resolvedRoot)),
    loadReviewSprintStatus(resolvedRoot),
    readDecisions(resolvedRoot),
    readOptionalText(productPath(resolvedRoot)),
    readOptionalText(harnessGapsPath(resolvedRoot)),
    findLatestReviewReport(resolvedRoot),
    collectPendingRestorationDecisions(resolvedRoot),
    collectProductFetcherPaths(resolvedRoot),
    collectWiringDriftFindings(resolvedRoot),
  ]);
  const gitLogState = await readGitLog(resolvedRoot, latestReviewReportPath);
  const parsedHarnessGaps = parseHarnessGaps(harnessGaps);
  const openPendingRisks = status.pendingRisks.filter(isOpenPendingRisk);

  return {
    handoff,
    sessionLog,
    recentSessionEntries: extractCurrentSessionEntries(sessionLog, recentEntriesLimit),
    recentEntriesLimit,
    gitLog: gitLogState.gitLog,
    gitLogMode: gitLogState.gitLogMode,
    gitCommitLimit: gitLogState.gitCommitLimit,
    latestReviewReportPath,
    openPendingRisks,
    decisions,
    passedSprintCount: status.sprints.filter((sprint) => sprint.status === 'passed').length,
    productText,
    harnessGaps,
    openHarnessGapCount: countOpenHarnessGaps(parsedHarnessGaps),
    uncoveredHarnessGaps: collectUncoveredHarnessGaps(parsedHarnessGaps),
    deadlineHarnessGaps: collectDeadlineHarnessGaps(parsedHarnessGaps),
    pendingRestorations,
    productFetcherPaths,
    wiringDriftFindings,
    pendingRiskRollups: collectPendingRiskRollups(openPendingRisks),
  };
}

export async function loadPriorReviewIssues(root?: string): Promise<PriorReviewIssue[]> {
  const resolvedRoot = resolveRoot(root);
  const reportsDir = reportsPath(resolvedRoot);
  if (!(await fileExists(reportsDir))) {
    return [];
  }

  const fileNames = (await readdir(reportsDir))
    .filter((fileName) => /^review-.*\.md$/i.test(fileName))
    .sort();
  const reports = await Promise.all(
    fileNames.map(async (fileName) => {
      const absolutePath = path.join(reportsDir, fileName);
      const fileStat = await stat(absolutePath);
      return {
        fileName,
        absolutePath,
        mtimeMs: fileStat.mtimeMs,
      };
    }),
  );

  reports.sort((left, right) => right.mtimeMs - left.mtimeMs || right.fileName.localeCompare(left.fileName));

  const byId = new Map<string, PriorReviewIssue>();
  for (const report of reports) {
    const relativePath = path.relative(resolvedRoot, report.absolutePath).replace(/\\/g, '/');
    const sourceReportDate = sourceDateFromFileName(report.fileName, report.mtimeMs);
    const findings = extractFindingsSection(await readText(report.absolutePath));

    for (const block of extractYamlBlocks(findings)) {
      for (const issue of parseReviewIssuesFromBlock(block, relativePath, sourceReportDate)) {
        if (!byId.has(issue.id)) {
          byId.set(issue.id, issue);
        }
      }
    }
  }

  return [...byId.values()];
}

async function readGitEvidence(issueId: string, root: string): Promise<string[]> {
  try {
    const { stdout } = await execFile(
      'git',
      ['log', '--all', `--grep=${issueId}`, '--format=%h'],
      { cwd: root },
    );
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((hash) => `git:${hash}`);
  } catch {
    return [];
  }
}

function readHarnessGapEvidence(issue: PriorReviewIssue, harnessGaps: string): string[] {
  const keywords = proposalKeywords(issue.proposal);
  const rows = harnessGaps
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && rowHasCoveredStatus(line));

  return rows
    .filter((row) => {
      const lower = row.toLowerCase();
      if (lower.includes(issue.id.toLowerCase())) {
        return true;
      }
      return keywords.length >= 2 && keywords.filter((keyword) => lower.includes(keyword)).length >= 2;
    })
    .map((row) => `harness-gaps:${row}`)
    .slice(0, 3);
}

async function readFilePathEvidence(issue: PriorReviewIssue, root: string): Promise<string[]> {
  const evidence: string[] = [];
  for (const relativePath of pathMentions(issue.proposal)) {
    if (await fileExists(path.join(root, relativePath))) {
      evidence.push(`file:${relativePath}`);
    }
  }
  return evidence;
}

export async function assessRegression(
  issues: PriorReviewIssue[],
  root?: string,
): Promise<RegressionStatus[]> {
  const resolvedRoot = resolveRoot(root);
  const harnessGaps = await readOptionalText(harnessGapsPath(resolvedRoot));
  const statuses: RegressionStatus[] = [];

  for (const issue of issues) {
    const [gitEvidence, fileEvidence] = await Promise.all([
      readGitEvidence(issue.id, resolvedRoot),
      readFilePathEvidence(issue, resolvedRoot),
    ]);
    const harnessEvidence = readHarnessGapEvidence(issue, harnessGaps);
    const coveredEvidence = [...harnessEvidence, ...fileEvidence];
    const evidence = [...gitEvidence, ...coveredEvidence];
    const status =
      coveredEvidence.length > 0 && gitEvidence.length > 0
        ? 'covered'
        : coveredEvidence.length > 0 || gitEvidence.length > 0
          ? 'partial'
          : 'open';

    statuses.push({ issue, status, evidence });
  }

  return statuses;
}

export function computeRegressionCoverage(statuses: RegressionStatus[]): {
  covered: number;
  partial: number;
  open: number;
  score: number;
} {
  const covered = statuses.filter((entry) => entry.status === 'covered').length;
  const partial = statuses.filter((entry) => entry.status === 'partial').length;
  const open = statuses.filter((entry) => entry.status === 'open').length;

  return {
    covered,
    partial,
    open,
    score: statuses.length === 0 ? 0 : covered / statuses.length,
  };
}

export function computePriorityScore(weights: IssueWeights): number {
  for (const [key, value] of Object.entries(weights)) {
    if (!Number.isInteger(value) || value < 0 || value > 5) {
      throw new Error(`invalid issue weight ${key}: ${value}`);
    }
  }

  return 10 * weights.agentFriendly + 5 * weights.tokenEfficient + weights.userFyi;
}
