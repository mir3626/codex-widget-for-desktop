import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

async function listFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isFile()) {
      files.push(entry.name);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function isInitializedDownstreamProject(): Promise<boolean> {
  try {
    const [productContext, sprintStatusRaw] = await Promise.all([
      readFile(path.join(process.cwd(), 'docs', 'context', 'product.md'), 'utf8'),
      readFile(path.join(process.cwd(), '.vibe', 'agent', 'sprint-status.json'), 'utf8'),
    ]);
    const sprintStatus = JSON.parse(sprintStatusRaw) as { project?: { name?: string } };
    const projectName = sprintStatus.project?.name;
    return (
      productContext.trim().length > 0 &&
      !/PROJECT NOT INITIALIZED/.test(productContext) &&
      typeof projectName === 'string' &&
      projectName.length > 0 &&
      projectName !== 'vibe-doctor'
    );
  } catch {
    return false;
  }
}

describe('template project-owned hygiene', () => {
  it('does not ship stale project prompts, reports, plans, or archived sprint prompts', async () => {
    if (await isInitializedDownstreamProject()) {
      return;
    }
    assert.deepEqual(await listFiles(path.join(process.cwd(), 'docs', 'prompts')), ['.gitkeep']);
    assert.deepEqual(await listFiles(path.join(process.cwd(), 'docs', 'reports')), ['.gitkeep']);
    assert.deepEqual(await listFiles(path.join(process.cwd(), '.vibe', 'archive', 'prompts')), ['.gitkeep']);
    assert.deepEqual(await listFiles(path.join(process.cwd(), 'docs', 'plans')), ['.gitkeep', 'sprint-roadmap.md']);
  });

  it('keeps project context shards in explicit not-initialized template form', async () => {
    if (await isInitializedDownstreamProject()) {
      return;
    }
    const shards = await Promise.all(
      ['product.md', 'architecture.md', 'conventions.md', 'qa.md', 'secrets.md', 'tokens.md'].map((fileName) =>
        readFile(path.join(process.cwd(), 'docs', 'context', fileName), 'utf8'),
      ),
    );

    for (const content of shards) {
      assert.match(content, /PROJECT NOT INITIALIZED/);
      assert.doesNotMatch(content, /dogfood\d+/i);
      assert.doesNotMatch(content, /sprint-M\d/i);
    }

    const conventions = shards[2] ?? '';
    assert.doesNotMatch(conventions, /TypeScript \(Node\.js\)/);
    assert.doesNotMatch(conventions, /Vitest/);
  });

  it('keeps checked-in project runtime state empty and explicitly template-owned', async () => {
    if (await isInitializedDownstreamProject()) {
      return;
    }
    const [handoff, sessionLog, sprintStatusRaw] = await Promise.all([
      readFile(path.join(process.cwd(), '.vibe', 'agent', 'handoff.md'), 'utf8'),
      readFile(path.join(process.cwd(), '.vibe', 'agent', 'session-log.md'), 'utf8'),
      readFile(path.join(process.cwd(), '.vibe', 'agent', 'sprint-status.json'), 'utf8'),
    ]);
    const sprintStatus = JSON.parse(sprintStatusRaw) as {
      project?: { name?: string };
      sprints?: unknown[];
      pendingRisks?: unknown[];
      lastSprintScope?: unknown[];
      lastSprintScopeGlob?: unknown[];
    };

    assert.match(handoff, /PROJECT NOT INITIALIZED/);
    assert.match(sessionLog, /PROJECT NOT INITIALIZED/);
    assert.equal(sprintStatus.project?.name, 'vibe-doctor');
    assert.deepEqual(sprintStatus.sprints, []);
    assert.deepEqual(sprintStatus.pendingRisks, []);
    assert.deepEqual(sprintStatus.lastSprintScope, []);
    assert.deepEqual(sprintStatus.lastSprintScopeGlob, []);
    assert.doesNotMatch(handoff, /sprint-M\d|dogfood\d+|iter-[789]/i);
    assert.doesNotMatch(sessionLog, /sprint-M\d|dogfood\d+|iter-[789]/i);
  });

  it('keeps dashboard and project report render templates split from CLIs', async () => {
    const [dashboardCli, dashboardTemplate, reportCli, reportTemplate, reportMeta] = await Promise.all([
      readFile(path.join(process.cwd(), '.vibe', 'harness', 'scripts', 'vibe-dashboard.mjs'), 'utf8'),
      readFile(path.join(process.cwd(), '.vibe', 'harness', 'scripts', 'lib', 'dashboard-template.mjs'), 'utf8'),
      readFile(path.join(process.cwd(), '.vibe', 'harness', 'scripts', 'vibe-project-report.mjs'), 'utf8'),
      readFile(path.join(process.cwd(), '.vibe', 'harness', 'scripts', 'lib', 'project-report-template.mjs'), 'utf8'),
      readFile(path.join(process.cwd(), '.vibe', 'harness', 'scripts', 'lib', 'project-report-meta.mjs'), 'utf8'),
    ]);

    assert.match(dashboardCli, /from '\.\/lib\/dashboard-template\.mjs'/);
    assert.doesNotMatch(dashboardCli, /function renderShellHtml\(/);
    assert.match(dashboardTemplate, /export function renderShellHtml\(/);
    assert.match(dashboardTemplate, /export function renderIconSvg\(/);

    assert.match(reportCli, /from '\.\/lib\/project-report-template\.mjs'/);
    assert.match(reportCli, /from '\.\/lib\/project-report-meta\.mjs'/);
    assert.doesNotMatch(reportCli, /function renderHtml\(/);
    assert.match(reportTemplate, /export function renderProjectReportHtml\(/);
    assert.match(reportMeta, /export function isMetaSprintId\(/);
  });
});
