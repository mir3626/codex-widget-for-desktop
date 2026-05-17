import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const tempDirs: string[] = [];
const scriptPath = path.resolve('.vibe', 'harness', 'scripts', 'vibe-roadmap-maintenance.mjs');

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

describe('vibe-roadmap-maintenance', () => {
  it('archives inactive iteration sections and keeps only the current iteration active', async () => {
    const root = await makeTempDir('roadmap-maintenance-');
    await writeJson(path.join(root, '.vibe', 'agent', 'iteration-history.json'), {
      currentIteration: 'iter-3',
      iterations: [
        {
          id: 'iter-2',
          plannedSprints: ['iter-2-sprint-01-old'],
          completedSprints: ['iter-2-sprint-01-old'],
        },
        {
          id: 'iter-3',
          plannedSprints: ['iter-3-sprint-01-current', 'iter-3-sprint-02-next'],
          completedSprints: ['iter-3-sprint-01-current'],
        },
      ],
    });
    await writeText(
      path.join(root, 'docs', 'plans', 'sprint-roadmap.md'),
      [
        '# Sprint Roadmap',
        '',
        '## Iteration iter-2: old work',
        '### iter-2-sprint-01-old',
        'Goal: old',
        '',
        '## Iteration iter-3: current work',
        '### iter-3-sprint-01-current',
        'Goal: done',
        '',
        '### iter-3-sprint-02-next',
        'Goal: next',
        '',
      ].join('\n'),
    );

    const result = spawnSync(process.execPath, [scriptPath, '--root', root, '--mode', 'start-check', '--json'], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout) as { changed: boolean; kept: string[]; archived: Array<{ iterationId: string }> };
    assert.equal(parsed.changed, true);
    assert.deepEqual(parsed.kept, ['iter-3']);
    assert.equal(parsed.archived.some((entry) => entry.iterationId === 'iter-2'), true);

    const active = await readFile(path.join(root, 'docs', 'plans', 'sprint-roadmap.md'), 'utf8');
    assert.match(active, /## Iteration iter-3/);
    assert.match(active, /Current\*\*: iter-3-sprint-02-next/);
    assert.doesNotMatch(active, /Iteration iter-2/);

    const archived = await readFile(path.join(root, 'docs', 'plans', 'archive', 'roadmaps', 'iter-2.md'), 'utf8');
    assert.match(archived, /iter-2-sprint-01-old/);
  });

  it('archives all sections when there is no active iteration', async () => {
    const root = await makeTempDir('roadmap-maintenance-idle-');
    await writeJson(path.join(root, '.vibe', 'agent', 'iteration-history.json'), {
      currentIteration: null,
      iterations: [],
    });
    await writeText(
      path.join(root, 'docs', 'plans', 'sprint-roadmap.md'),
      ['# Sprint Roadmap', '', '## Iteration iter-5: done', '### iter-5-sprint-01-finished', 'Goal: done', ''].join('\n'),
    );

    const result = spawnSync(process.execPath, [scriptPath, '--root', root, '--mode', 'completion-check', '--json'], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const active = await readFile(path.join(root, 'docs', 'plans', 'sprint-roadmap.md'), 'utf8');
    assert.match(active, /## No Active Iteration/);
    assert.doesNotMatch(active, /iter-5-sprint-01-finished/);
    const archived = await readFile(path.join(root, 'docs', 'plans', 'archive', 'roadmaps', 'iter-5.md'), 'utf8');
    assert.match(archived, /iter-5-sprint-01-finished/);
  });
});
