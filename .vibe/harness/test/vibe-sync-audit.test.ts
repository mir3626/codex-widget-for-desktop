import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const tempDirs: string[] = [];
const scriptPath = path.resolve('.vibe', 'harness', 'scripts', 'vibe-sync-audit.mjs');

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

async function writeText(filePath: string, value: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, 'utf8');
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readCurrentJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(path.resolve(relativePath), 'utf8')) as T;
}

async function scaffoldAuditRoot(root: string): Promise<{
  manifest: {
    files: {
      harness: string[];
      hybrid: Record<string, { harnessKeys?: string[]; projectKeys?: string[]; strategy?: string }>;
      project: string[];
    };
    migrations: Record<string, string | null>;
  };
}> {
  const [skill, runtime, manifest] = await Promise.all([
    readFile(path.resolve('.claude', 'skills', 'vibe-sync', 'SKILL.md'), 'utf8'),
    readFile(path.resolve('.vibe', 'harness', 'src', 'commands', 'sync.ts'), 'utf8'),
    readCurrentJson<{
      files: {
        harness: string[];
        hybrid: Record<string, { harnessKeys?: string[]; projectKeys?: string[]; strategy?: string }>;
        project: string[];
      };
      migrations: Record<string, string | null>;
    }>('.vibe/sync-manifest.json'),
  ]);

  await writeText(path.join(root, '.claude', 'skills', 'vibe-sync', 'SKILL.md'), skill);
  await writeText(path.join(root, '.vibe', 'harness', 'src', 'commands', 'sync.ts'), runtime);
  await writeJson(path.join(root, '.vibe', 'sync-manifest.json'), manifest);
  return { manifest };
}

function runAudit(root: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [scriptPath, '--root', root, '--format', 'json'], {
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('vibe-sync-audit', () => {
  it('passes the current checkout', () => {
    const result = runAudit(process.cwd());
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      harnessCount: number;
      hybridCount: number;
      projectCount: number;
      skillSignals: string[];
      runtimeSignals: string[];
    };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.harnessCount > 0);
    assert.ok(parsed.hybridCount > 0);
    assert.ok(parsed.projectCount > 0);
    assert.equal(parsed.skillSignals.includes('dry-run-first'), true);
    assert.equal(parsed.runtimeSignals.includes('harness-typecheck-selection'), true);
  });

  it('fails when the harness manifest claims root source ownership', async () => {
    const root = await makeTempDir('vibe-sync-audit-src-owned-');
    const { manifest } = await scaffoldAuditRoot(root);
    manifest.files.harness.push('src/**');
    await writeJson(path.join(root, '.vibe', 'sync-manifest.json'), manifest);

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; findings: Array<{ id: string; path?: string }> };

    assert.equal(result.status, 1);
    assert.equal(parsed.ok, false);
    assert.equal(
      parsed.findings.some((finding) => finding.id === 'project-owned-harness-entry' && finding.path === 'src/**'),
      true,
    );
  });

  it('fails when the harness manifest claims root README ownership', async () => {
    const root = await makeTempDir('vibe-sync-audit-root-readme-owned-');
    const { manifest } = await scaffoldAuditRoot(root);
    manifest.files.harness.push('README.md');
    await writeJson(path.join(root, '.vibe', 'sync-manifest.json'), manifest);

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; findings: Array<{ id: string; path?: string }> };

    assert.equal(result.status, 1);
    assert.equal(parsed.ok, false);
    assert.equal(
      parsed.findings.some((finding) => finding.id === 'project-owned-harness-entry' && finding.path === 'README.md'),
      true,
    );
  });

  it('fails when package.json harness keys include product scripts', async () => {
    const root = await makeTempDir('vibe-sync-audit-package-owned-');
    const { manifest } = await scaffoldAuditRoot(root);
    manifest.files.hybrid['package.json'] = {
      ...manifest.files.hybrid['package.json'],
      harnessKeys: [...(manifest.files.hybrid['package.json']?.harnessKeys ?? []), 'scripts.test'],
    };
    await writeJson(path.join(root, '.vibe', 'sync-manifest.json'), manifest);

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; findings: Array<{ id: string; path?: string; detail?: string }> };

    assert.equal(result.status, 1);
    assert.equal(parsed.ok, false);
    assert.equal(
      parsed.findings.some(
        (finding) =>
          finding.id === 'forbidden-hybrid-key' &&
          finding.path === 'package.json' &&
          finding.detail?.includes('scripts.test'),
      ),
      true,
    );
  });

  it('fails when the sync runbook omits dry-run-first guidance', async () => {
    const root = await makeTempDir('vibe-sync-audit-skill-drift-');
    await scaffoldAuditRoot(root);
    const skillPath = path.join(root, '.claude', 'skills', 'vibe-sync', 'SKILL.md');
    const skill = await readFile(skillPath, 'utf8');
    await writeText(skillPath, skill.replace('npm run vibe:sync -- --dry-run', 'npm run vibe:sync -- --plan'));

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; findings: Array<{ id: string; signal?: string }> };

    assert.equal(result.status, 1);
    assert.equal(parsed.ok, false);
    assert.equal(
      parsed.findings.some((finding) => finding.id === 'missing-critical-signal' && finding.signal === 'dry-run-first'),
      true,
    );
  });
});
