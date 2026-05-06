import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const tempDirs: string[] = [];
const scriptPath = path.resolve('.vibe', 'harness', 'scripts', 'vibe-context-audit.mjs');

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

function runContextAudit(root: string, args: string[] = []): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--format=json',
    '--root',
    root,
    ...args,
  ], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('vibe-context-audit', () => {
  it('reports missing hard dependencies without changing the exit code', async () => {
    const root = await makeTempDir('context-audit-hard-');
    await writeText(
      path.join(root, 'CLAUDE.md'),
      [
        'Operators MUST read `docs/context/product.md`.',
        'Operators MUST read `docs/context/missing.md`.',
        'Operators may read `docs/context/optional.md`.',
      ].join('\n'),
    );
    await writeText(path.join(root, 'docs', 'context', 'product.md'), '# Product\n');

    const result = runContextAudit(root, ['--scan', 'CLAUDE.md']);
    const parsed = JSON.parse(result.stdout) as {
      reportOnly: boolean;
      summary: { byStatus: Record<string, number> };
      findings: Array<{ status: string; severity: string; referencePath: string; reportOnly: boolean }>;
    };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(parsed.reportOnly, true);
    assert.equal(parsed.summary.byStatus.missing, 2);
    assert.deepEqual(
      parsed.findings.map((finding) => [finding.status, finding.severity, finding.referencePath, finding.reportOnly]),
      [
        ['missing', 'warning', 'docs/context/missing.md', true],
        ['missing', 'info', 'docs/context/optional.md', true],
      ],
    );
  });

  it('keeps should-level dependencies ambiguous instead of treating them as optional skips', async () => {
    const root = await makeTempDir('context-audit-ambiguous-');
    await writeText(
      path.join(root, 'AGENTS.md'),
      'Planner should inspect `docs/context/architecture.md` before writing the sprint prompt.\n',
    );
    await writeText(path.join(root, 'docs', 'context', 'architecture.md'), '# Architecture\n');

    const result = runContextAudit(root, ['--scan', 'AGENTS.md']);
    const parsed = JSON.parse(result.stdout) as {
      references: Array<{ path: string; dependencyClass: string; status: string }>;
      findings: Array<{ status: string; referencePath: string }>;
    };

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(parsed.references.map((reference) => reference.dependencyClass), ['unknown']);
    assert.deepEqual(parsed.findings.map((finding) => [finding.status, finding.referencePath]), [
      ['ambiguous', 'docs/context/architecture.md'],
    ]);
  });

  it('resolves root-relative wrappers and JSON property references', async () => {
    const root = await makeTempDir('context-audit-paths-');
    await writeText(
      path.join(root, 'docs', 'context', 'orchestration.md'),
      'Generator uses `./.vibe/harness/scripts/run-codex.sh` and `.vibe/config.json.mode` is required.\n',
    );
    await writeText(path.join(root, '.vibe', 'harness', 'scripts', 'run-codex.sh'), '#!/usr/bin/env bash\n');
    await writeText(path.join(root, '.vibe', 'config.json'), '{ "mode": "human" }\n');

    const result = runContextAudit(root, ['--scan', 'docs/context/orchestration.md']);
    const parsed = JSON.parse(result.stdout) as {
      references: Array<{ path: string; exists: boolean; status: string }>;
    };

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(parsed.references.map((reference) => [reference.path, reference.exists]), [
      ['.vibe/harness/scripts/run-codex.sh', true],
      ['.vibe/config.json', true],
    ]);
  });

  it('emits reproducible JSON from the current checkout', () => {
    const result = spawnSync(process.execPath, [scriptPath, '--format=json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 10,
    });
    const parsed = JSON.parse(result.stdout) as { reportOnly?: boolean; summary?: { scannedFiles?: number } };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(parsed.reportOnly, true);
    assert.equal(typeof parsed.summary?.scannedFiles, 'number');
  });
});
