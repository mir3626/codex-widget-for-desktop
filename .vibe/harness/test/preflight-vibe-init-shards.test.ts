import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const tempDirs: string[] = [];
const preflightPath = path.resolve('.vibe', 'harness', 'scripts', 'vibe-preflight.mjs');

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function scaffoldBootstrapRoot(root: string): Promise<void> {
  await mkdir(path.join(root, 'docs', 'context'), { recursive: true });
  await writeJson(path.join(root, '.vibe', 'config.json'), {
    harnessVersion: '1.7.16',
    harnessVersionInstalled: '1.7.16',
    sprintRoles: {},
    providers: {},
  });
  await writeFile(path.join(root, 'docs', 'context', 'product.md'), 'PROJECT NOT INITIALIZED.\n', 'utf8');
}

function runPreflightJson(root: string) {
  const result = spawnSync(process.execPath, [preflightPath, '--bootstrap', '--json'], {
    cwd: root,
    encoding: 'utf8',
  });
  const records = JSON.parse(result.stdout) as Array<{ id: string; ok: boolean; detail: string; level?: string }>;
  return { result, records };
}

describe('vibe-preflight vibe-init shard audit', () => {
  it('skips when the shared vibe-init skill is absent from a partial checkout', async () => {
    const root = await makeTempDir('preflight-vibe-init-shard-absent-');
    await scaffoldBootstrapRoot(root);

    const { result, records } = runPreflightJson(root);
    const initRecord = records.find((entry) => entry.id === 'vibe-init.shards');
    const codexWrapperRecord = records.find((entry) => entry.id === 'codex-wrapper.audit');
    const interviewRecord = records.find((entry) => entry.id === 'vibe-interview.shards');
    const iterateRecord = records.find((entry) => entry.id === 'vibe-iterate.shards');
    const reviewRecord = records.find((entry) => entry.id === 'vibe-review.shards');
    const sprintModeRecord = records.find((entry) => entry.id === 'vibe-sprint-mode.audit');
    const syncRecord = records.find((entry) => entry.id === 'vibe-sync.audit');

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(initRecord);
    assert.equal(initRecord.ok, true);
    assert.equal(initRecord.level, 'info');
    assert.match(initRecord.detail, /skipped/);
    assert.ok(codexWrapperRecord);
    assert.equal(codexWrapperRecord.ok, true);
    assert.equal(codexWrapperRecord.level, 'info');
    assert.match(codexWrapperRecord.detail, /skipped/);
    assert.ok(interviewRecord);
    assert.equal(interviewRecord.ok, true);
    assert.equal(interviewRecord.level, 'info');
    assert.match(interviewRecord.detail, /skipped/);
    assert.ok(iterateRecord);
    assert.equal(iterateRecord.ok, true);
    assert.equal(iterateRecord.level, 'info');
    assert.match(iterateRecord.detail, /skipped/);
    assert.ok(reviewRecord);
    assert.equal(reviewRecord.ok, true);
    assert.equal(reviewRecord.level, 'info');
    assert.match(reviewRecord.detail, /skipped/);
    assert.ok(sprintModeRecord);
    assert.equal(sprintModeRecord.ok, true);
    assert.equal(sprintModeRecord.level, 'info');
    assert.match(sprintModeRecord.detail, /skipped/);
    assert.ok(syncRecord);
    assert.equal(syncRecord.ok, true);
    assert.equal(syncRecord.level, 'info');
    assert.match(syncRecord.detail, /skipped/);
  });

  it('fails when the synced vibe-init skill breaks the shard audit', async () => {
    const root = await makeTempDir('preflight-vibe-init-shard-invalid-');
    await scaffoldBootstrapRoot(root);
    await mkdir(path.join(root, '.claude', 'skills', 'vibe-init'), { recursive: true });
    await writeFile(path.join(root, '.claude', 'skills', 'vibe-init', 'SKILL.md'), '# broken\n', 'utf8');

    const { result, records } = runPreflightJson(root);
    const record = records.find((entry) => entry.id === 'vibe-init.shards');

    assert.equal(result.status, 1);
    assert.ok(record);
    assert.equal(record.ok, false);
    assert.match(record.detail, /phase-count|step-count|signal-missing/);
  });

  it('fails when a synced Codex skill wrapper has an unsafe shared path', async () => {
    const root = await makeTempDir('preflight-codex-wrapper-invalid-');
    await scaffoldBootstrapRoot(root);
    await mkdir(path.join(root, '.claude', 'skills', 'demo'), { recursive: true });
    await mkdir(path.join(root, '.codex', 'skills', 'demo'), { recursive: true });
    await writeFile(path.join(root, '.claude', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\n---\n# demo\n', 'utf8');
    await writeFile(
      path.join(root, '.codex', 'skills', 'demo', 'SKILL.md'),
      [
        '---',
        'name: demo',
        'description: fixture',
        '---',
        'This repository keeps provider-neutral skill runbooks under `.claude/skills`.',
        '<!-- BEGIN:VIBE-CODEX:SHARDS -->',
        '- `../../../.claude/skills/demo/SKILL.md`',
        '<!-- END:VIBE-CODEX:SHARDS -->',
        'Open the repository-root path.',
        '',
      ].join('\n'),
      'utf8',
    );

    const { result, records } = runPreflightJson(root);
    const record = records.find((entry) => entry.id === 'codex-wrapper.audit');

    assert.equal(result.status, 1);
    assert.ok(record);
    assert.equal(record.ok, false);
    assert.match(record.detail, /unsafe-wrapper-reference|non-injectable-target|missing-shared-skill-target/);
  });

  it('fails when the synced vibe-interview skill breaks the shard audit', async () => {
    const root = await makeTempDir('preflight-vibe-interview-shard-invalid-');
    await scaffoldBootstrapRoot(root);
    await mkdir(path.join(root, '.claude', 'skills', 'vibe-interview'), { recursive: true });
    await writeFile(path.join(root, '.claude', 'skills', 'vibe-interview', 'SKILL.md'), '# broken\n', 'utf8');

    const { result, records } = runPreflightJson(root);
    const record = records.find((entry) => entry.id === 'vibe-interview.shards');

    assert.equal(result.status, 1);
    assert.ok(record);
    assert.equal(record.ok, false);
    assert.match(record.detail, /heading-count|invocation-step-count|missing-critical-signal/);
  });

  it('fails when the synced vibe-review skill breaks the shard audit', async () => {
    const root = await makeTempDir('preflight-vibe-review-shard-invalid-');
    await scaffoldBootstrapRoot(root);
    await mkdir(path.join(root, '.claude', 'skills', 'vibe-review'), { recursive: true });
    await writeFile(path.join(root, '.claude', 'skills', 'vibe-review', 'SKILL.md'), '# broken\n', 'utf8');

    const { result, records } = runPreflightJson(root);
    const record = records.find((entry) => entry.id === 'vibe-review.shards');

    assert.equal(result.status, 1);
    assert.ok(record);
    assert.equal(record.ok, false);
    assert.match(record.detail, /heading-count|missing-critical-signal/);
  });

  it('fails when the synced vibe-iterate skill breaks the shard audit', async () => {
    const root = await makeTempDir('preflight-vibe-iterate-shard-invalid-');
    await scaffoldBootstrapRoot(root);
    await mkdir(path.join(root, '.claude', 'skills', 'vibe-iterate'), { recursive: true });
    await writeFile(path.join(root, '.claude', 'skills', 'vibe-iterate', 'SKILL.md'), '# broken\n', 'utf8');

    const { result, records } = runPreflightJson(root);
    const record = records.find((entry) => entry.id === 'vibe-iterate.shards');

    assert.equal(result.status, 1);
    assert.ok(record);
    assert.equal(record.ok, false);
    assert.match(record.detail, /phase-count|missing-critical-signal/);
  });

  it('fails when synced sprint-mode artifacts break the permission audit', async () => {
    const root = await makeTempDir('preflight-sprint-mode-audit-invalid-');
    await scaffoldBootstrapRoot(root);
    await mkdir(path.join(root, '.vibe', 'settings-presets'), { recursive: true });
    await writeFile(
      path.join(root, '.vibe', 'settings-presets', 'agent-delegation.json'),
      JSON.stringify({ presetName: 'agent-delegation', rules: ['Write(src/**)'], denyRules: [] }),
      'utf8',
    );

    const { result, records } = runPreflightJson(root);
    const record = records.find((entry) => entry.id === 'vibe-sprint-mode.audit');

    assert.equal(result.status, 1);
    assert.ok(record);
    assert.equal(record.ok, false);
    assert.match(record.detail, /sensitive-write-allow-rule|missing-critical-signal|skill-missing/);
  });

  it('fails when synced vibe-sync artifacts break the boundary audit', async () => {
    const root = await makeTempDir('preflight-vibe-sync-audit-invalid-');
    await scaffoldBootstrapRoot(root);
    await mkdir(path.join(root, '.vibe'), { recursive: true });
    await writeJson(path.join(root, '.vibe', 'sync-manifest.json'), {
      manifestVersion: '1.0',
      files: {
        harness: ['src/**'],
        hybrid: {},
        project: [],
      },
      migrations: {},
    });

    const { result, records } = runPreflightJson(root);
    const record = records.find((entry) => entry.id === 'vibe-sync.audit');

    assert.equal(result.status, 1);
    assert.ok(record);
    assert.equal(record.ok, false);
    assert.match(record.detail, /project-owned-harness-entry|missing-required-manifest-entry|skill-missing|runtime-missing/);
  });
});
