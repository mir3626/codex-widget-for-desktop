import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const tempDirs: string[] = [];
const scriptPath = path.resolve('.vibe', 'harness', 'scripts', 'vibe-interview-shard-audit.mjs');

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

function buildSkillContent(omitHeading?: string): string {
  const sections = [
    ['## When To Invoke', 'Use this skill in /vibe-init Phase 3.'],
    [
      '## Invocation Protocol',
      '1. Ask the user for a one-liner prompt.',
      '2. `node .vibe/harness/scripts/vibe-interview.mjs --init --prompt "<one-liner>"` phase: "domain-inference"',
      '3. Orchestrator evaluates inferencePrompt.',
      '4. `node .vibe/harness/scripts/vibe-interview.mjs --set-domain --domain "<inferred_domain>"` phase: "round"',
      '5. Orchestrator evaluates synthesizerPrompt.',
      '6. Orchestrator asks the user.',
      '7. `node .vibe/harness/scripts/vibe-interview.mjs --continue --answer "<text>"` phase: "parse"',
      '8. Orchestrator returns structured JSON attribution.',
      '9. `node .vibe/harness/scripts/vibe-interview.mjs --record --attribution \'<json>\'` phase: "consensus"',
      '10. Show the user consensus summary.',
      '11. Record with --consensus --decision approve, --consensus --decision revise, --consensus --decision defer, or --consensus --decision proxy-unconfirmed.',
      '12. Return phase: "done" and seedForProductMd.',
    ],
    [
      '## Operating Notes',
      'The Orchestrator is the LLM host. There is no external model call. Output MUST be parseable JSON.',
      '## PO-Proxy Mode',
      'Final consensus MUST NOT be marked `approved`. Log [decision][phase3-po-proxy].',
      '## "I don\'t know" / "미정" Handling',
      'Parser maps uncertainty to `deferred` sub-fields.',
    ],
    [
      '## Termination',
      'Hard terminate when ambiguity <= 0.2. Hard terminate when roundNumber > maxRounds. Soft terminate when coverage `>= 0.8` and `ambiguity <= 0.3`.',
      '## Consensus Check',
      'This is the last Phase 3 gate before context shard creation.',
    ],
    [
      '## Output Artifacts',
      'Append seedForProductMd into docs/context/product.md with ### Phase 3 Consensus Check.',
    ],
  ];

  return [
    '---',
    'name: vibe-interview',
    'description: fixture',
    '---',
    '',
    ...sections
      .filter(([heading]) => heading !== omitHeading)
      .flatMap((lines) => [...lines, '']),
  ].join('\n');
}

describe('vibe-interview-shard-audit', () => {
  it('passes the current checkout', () => {
    const result = runAudit(process.cwd());
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      mode: string;
      requiredHeadings: string[];
      requiredInvocationSteps: number[];
      shardPaths: string[];
    };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.mode, 'sharded');
    assert.deepEqual(parsed.shardPaths, [
      '.claude/skills/vibe-interview/sections/invocation-protocol.md',
      '.claude/skills/vibe-interview/sections/operating-modes.md',
      '.claude/skills/vibe-interview/sections/termination-consensus.md',
      '.claude/skills/vibe-interview/sections/output-artifacts.md',
    ]);
    assert.deepEqual(parsed.requiredHeadings, [
      'when-to-invoke',
      'invocation-protocol',
      'operating-notes',
      'po-proxy-mode',
      'unknown-handling',
      'termination',
      'consensus-check',
      'output-artifacts',
    ]);
    assert.deepEqual(parsed.requiredInvocationSteps, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('fails when a required invocation step is missing', async () => {
    const root = await makeTempDir('vibe-interview-shard-missing-step-');
    const content = buildSkillContent().replace(/^8\. Orchestrator returns structured JSON attribution\.\n/m, '');
    await writeText(path.join(root, '.claude', 'skills', 'vibe-interview', 'SKILL.md'), content);

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      findings: Array<{ id: string; step?: number }>;
    };

    assert.equal(result.status, 1);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.findings.some((finding) => finding.id === 'invocation-step-count' && finding.step === 8), true);
  });

  it('passes a sharded fixture when all section shards are listed', async () => {
    const root = await makeTempDir('vibe-interview-shard-listed-');
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-interview', 'SKILL.md'),
      [
        '---',
        'name: vibe-interview',
        'description: fixture',
        '---',
        '## When To Invoke',
        'Use this skill in /vibe-init Phase 3.',
        '<!-- BEGIN:VIBE-INTERVIEW:SECTION-SHARDS -->',
        '- `.claude/skills/vibe-interview/sections/invocation.md`',
        '- `.claude/skills/vibe-interview/sections/modes.md`',
        '- `.claude/skills/vibe-interview/sections/termination.md`',
        '- `.claude/skills/vibe-interview/sections/output.md`',
        '<!-- END:VIBE-INTERVIEW:SECTION-SHARDS -->',
        '',
      ].join('\n'),
    );
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-interview', 'sections', 'invocation.md'),
      buildSkillContent()
        .match(/## Invocation Protocol[\s\S]*?(?=\n## Operating Notes)/)?.[0] ?? '',
    );
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-interview', 'sections', 'modes.md'),
      buildSkillContent()
        .match(/## Operating Notes[\s\S]*?(?=\n## Termination)/)?.[0] ?? '',
    );
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-interview', 'sections', 'termination.md'),
      buildSkillContent()
        .match(/## Termination[\s\S]*?(?=\n## Output Artifacts)/)?.[0] ?? '',
    );
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-interview', 'sections', 'output.md'),
      buildSkillContent()
        .match(/## Output Artifacts[\s\S]*$/)?.[0] ?? '',
    );

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; mode: string; shardPaths: string[] };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.mode, 'sharded');
    assert.equal(parsed.shardPaths.length, 4);
  });

  it('fails when a section shard exists but is not listed', async () => {
    const root = await makeTempDir('vibe-interview-shard-unlisted-');
    await writeText(path.join(root, '.claude', 'skills', 'vibe-interview', 'SKILL.md'), buildSkillContent());
    await writeText(path.join(root, '.claude', 'skills', 'vibe-interview', 'sections', 'orphan.md'), '# orphan\n');

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as { findings: Array<{ id: string; path?: string }> };

    assert.equal(result.status, 1);
    assert.equal(
      parsed.findings.some(
        (finding) => finding.id === 'unlisted-section-shard' && finding.path === '.claude/skills/vibe-interview/sections/orphan.md',
      ),
      true,
    );
  });
});
