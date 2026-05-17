import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const tempDirs: string[] = [];
const scriptPath = path.resolve('.vibe', 'harness', 'scripts', 'vibe-iterate-shard-audit.mjs');

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

function runAudit(root: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [scriptPath, '--root', root, '--format', 'json'], {
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function buildSkillContent(omitPhaseHeading?: string): string {
  const phases = [
    [
      '## Phase 0 - Load State',
      'Read docs/reports/project-report.html, .vibe/agent/handoff.md, .vibe/agent/session-log.md, docs/plans/project-milestones.md, .vibe/agent/iteration-history.json, and docs/plans/sprint-roadmap.md.',
      'This state is Orchestrator input only; do not inject the full history into Planner prompts.',
    ],
    [
      '## Phase 1 - Differential Interview',
      'Run node .vibe/harness/scripts/vibe-interview.mjs --mode iterate --carryover <prior-iter-id> --output .vibe/interview-log/iter-<N>.json.',
      'Build the carryover seed. empty carryover is a fresh restart.',
    ],
    [
      '## Phase 2 - Write Active Sprint Roadmap',
      'Write ## Iteration iter-<N> to docs/plans/sprint-roadmap.md. Never delete existing roadmap content unless it has first been archived.',
      'Run node .vibe/harness/scripts/vibe-roadmap-maintenance.mjs --mode start-check after currentIteration is set.',
    ],
    [
      '## Phase 3 - Update Iteration History',
      'Set currentIteration in .vibe/agent/iteration-history.json with plannedSprints[].',
    ],
    [
      '## Phase 4 - Run Sprints Normally',
      'Planner must not receive `.vibe/agent/iteration-history.json`. Use the prior-sprint header: This is iter-<N> sprint-NN.',
    ],
    [
      '## Phase 5 - Refresh Project Report',
      'Run node .vibe/harness/scripts/vibe-project-report.mjs when stale. Use --no-open for a silent refresh.',
      'Point the user to the report Iteration timeline and milestone progress. Keep handoff.md` focused on the current iteration only.',
    ],
  ];

  return [
    '---',
    'name: vibe-iterate',
    'description: fixture',
    '---',
    '',
    '# vibe-iterate',
    '',
    ...phases
      .filter(([heading]) => heading !== omitPhaseHeading)
      .flatMap((lines) => [...lines, '']),
    '## Context Isolation Guarantee',
    'Planner remains fresh-context per Sprint. Use short Orchestrator-authored prior-sprint summaries.',
    '',
  ].join('\n');
}

describe('vibe-iterate-shard-audit', () => {
  it('passes the current checkout', () => {
    const result = runAudit(process.cwd());
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      mode: string;
      requiredPhases: string[];
      shardPaths: string[];
    };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.mode, 'sharded');
    assert.deepEqual(parsed.shardPaths, [
      '.claude/skills/vibe-iterate/phases/phase-0-load-state.md',
      '.claude/skills/vibe-iterate/phases/phase-1-differential-interview.md',
      '.claude/skills/vibe-iterate/phases/phase-2-roadmap-history.md',
      '.claude/skills/vibe-iterate/phases/phase-4-sprints-report.md',
    ]);
    assert.deepEqual(parsed.requiredPhases, [
      'phase-0-load-state',
      'phase-1-differential-interview',
      'phase-2-write-active-sprint-roadmap',
      'phase-3-update-iteration-history',
      'phase-4-run-sprints-normally',
      'phase-5-refresh-project-report',
    ]);
  });

  it('fails when a required phase is missing', async () => {
    const root = await makeTempDir('vibe-iterate-shard-missing-phase-');
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-iterate', 'SKILL.md'),
      buildSkillContent('## Phase 3 - Update Iteration History'),
    );

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      findings: Array<{ id: string; phase?: string }>;
    };

    assert.equal(result.status, 1);
    assert.equal(parsed.ok, false);
    assert.equal(
      parsed.findings.some(
        (finding) => finding.id === 'phase-count' && finding.phase === 'phase-3-update-iteration-history',
      ),
      true,
    );
  });

  it('passes a sharded fixture when all phase shards are listed', async () => {
    const root = await makeTempDir('vibe-iterate-shard-listed-');
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-iterate', 'SKILL.md'),
      [
        '---',
        'name: vibe-iterate',
        'description: fixture',
        '---',
        '# vibe-iterate',
        '<!-- BEGIN:VIBE-ITERATE:PHASE-SHARDS -->',
        '- `.claude/skills/vibe-iterate/phases/load.md`',
        '- `.claude/skills/vibe-iterate/phases/interview.md`',
        '- `.claude/skills/vibe-iterate/phases/roadmap.md`',
        '- `.claude/skills/vibe-iterate/phases/report.md`',
        '<!-- END:VIBE-ITERATE:PHASE-SHARDS -->',
        '## Context Isolation Guarantee',
        'Planner remains fresh-context per Sprint. Use short Orchestrator-authored prior-sprint summaries.',
        '',
      ].join('\n'),
    );
    const content = buildSkillContent();
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-iterate', 'phases', 'load.md'),
      content.match(/## Phase 0[\s\S]*?(?=\n## Phase 1)/)?.[0] ?? '',
    );
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-iterate', 'phases', 'interview.md'),
      content.match(/## Phase 1[\s\S]*?(?=\n## Phase 2)/)?.[0] ?? '',
    );
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-iterate', 'phases', 'roadmap.md'),
      content.match(/## Phase 2[\s\S]*?(?=\n## Phase 4)/)?.[0] ?? '',
    );
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-iterate', 'phases', 'report.md'),
      content.match(/## Phase 4[\s\S]*?(?=\n## Context Isolation Guarantee)/)?.[0] ?? '',
    );

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; mode: string; shardPaths: string[] };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.mode, 'sharded');
    assert.equal(parsed.shardPaths.length, 4);
  });

  it('fails when a phase shard exists but is not listed', async () => {
    const root = await makeTempDir('vibe-iterate-shard-unlisted-');
    await writeText(path.join(root, '.claude', 'skills', 'vibe-iterate', 'SKILL.md'), buildSkillContent());
    await writeText(path.join(root, '.claude', 'skills', 'vibe-iterate', 'phases', 'orphan.md'), '# orphan\n');

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as { findings: Array<{ id: string; path?: string }> };

    assert.equal(result.status, 1);
    assert.equal(
      parsed.findings.some(
        (finding) => finding.id === 'unlisted-phase-shard' && finding.path === '.claude/skills/vibe-iterate/phases/orphan.md',
      ),
      true,
    );
  });
});
