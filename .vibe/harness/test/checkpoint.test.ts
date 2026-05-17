import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const checkpointScriptPath = path.resolve('.vibe', 'harness', 'scripts', 'vibe-checkpoint.mjs');
const tempDirs: string[] = [];

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

describe('vibe-checkpoint', () => {
  it('uses provider-neutral checkpoint wording on failure', async () => {
    const root = await makeTempDir('checkpoint-missing-state-');

    const result = spawnSync(process.execPath, [checkpointScriptPath], {
      cwd: root,
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Checkpoint blocked/);
    assert.doesNotMatch(result.stderr, /PreCompact blocked/);
  });

  it('blocks oversized active handoff files', async () => {
    const root = await makeTempDir('checkpoint-handoff-budget-');
    const now = new Date().toISOString();
    await writeText(
      path.join(root, '.vibe', 'agent', 'sprint-status.json'),
      `${JSON.stringify({
        handoff: {
          updatedAt: now,
          orchestratorContextBudget: 'low',
        },
      })}\n`,
    );
    await writeText(path.join(root, '.vibe', 'agent', 'session-log.md'), '# Session Log\n\n## Entries\n- 2026-04-16T00:00:00.000Z [decision] ok\n');
    await writeText(path.join(root, '.vibe', 'agent', 'handoff.md'), `# Handoff\n\n${'x'.repeat(150_000)}\n`);

    const result = spawnSync(process.execPath, [checkpointScriptPath, '--json'], {
      cwd: root,
      encoding: 'utf8',
    });
    const records = JSON.parse(result.stdout) as Array<{ id: string; ok: boolean; detail: string }>;
    const budget = records.find((entry) => entry.id === 'handoff.budget');

    assert.equal(result.status, 1);
    assert.equal(budget?.ok, false);
    assert.match(budget?.detail ?? '', /handoff too large/);
  });
});
