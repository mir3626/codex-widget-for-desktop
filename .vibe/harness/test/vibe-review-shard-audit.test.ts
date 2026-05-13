import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const tempDirs: string[] = [];
const scriptPath = path.resolve('.vibe', 'harness', 'scripts', 'vibe-review-shard-audit.mjs');

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
    ['## Protocol', 'Run node .vibe/harness/scripts/vibe-review-inputs.mjs --install.', 'Allowed in a partial or uninitialized downstream checkout.', 'Write docs/reports/review-<sprintCount>-<YYYY-MM-DD>.md.'],
    ['## Rubric', 'Use openHarnessGapCount and pendingRiskRollups.length > 0.'],
    ['## Findings Format', 'Use ## Findings (severity desc).'],
    ['## Automatic Checks', 'Call detectOptInGaps(). Use BEGIN:PROJECT:review-signals. Check pendingRestorations.length > 0. Check .vibe/config.json.bundle.enabled === false, .vibe/config.json.browserSmoke.enabled === false, and .vibe/config.json.bundle.policy === "automatic". Check wiringDriftFindings.length > 0.'],
    ['### Adapter-Health Blind Spot', 'Check productFetcherPaths.'],
    ['## Report Shape', 'Use ## Inputs loaded, ## Findings (severity desc), ## Suggested next-sprint scope, and ## Links.'],
  ];

  return [
    '---',
    'name: vibe-review',
    'description: fixture',
    '---',
    '',
    ...sections
      .filter(([heading]) => heading !== omitHeading)
      .flatMap((lines) => [...lines, '']),
  ].join('\n');
}

describe('vibe-review-shard-audit', () => {
  it('passes the current checkout', () => {
    const result = runAudit(process.cwd());
    const parsed = JSON.parse(result.stdout) as { ok: boolean; mode: string; requiredHeadings: string[]; shardPaths: string[] };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.mode, 'sharded');
    assert.deepEqual(parsed.shardPaths, [
      '.claude/skills/vibe-review/sections/protocol.md',
      '.claude/skills/vibe-review/sections/rubric-and-findings.md',
      '.claude/skills/vibe-review/sections/automatic-checks.md',
      '.claude/skills/vibe-review/sections/report-shape.md',
    ]);
    assert.deepEqual(parsed.requiredHeadings, [
      'protocol',
      'rubric',
      'findings-format',
      'automatic-checks',
      'adapter-health-blind-spot',
      'report-shape',
    ]);
  });

  it('fails when a required heading is missing', async () => {
    const root = await makeTempDir('vibe-review-shard-missing-heading-');
    await writeText(path.join(root, '.claude', 'skills', 'vibe-review', 'SKILL.md'), buildSkillContent('## Automatic Checks'));

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      findings: Array<{ id: string; heading?: string }>;
    };

    assert.equal(result.status, 1);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.findings.some((finding) => finding.id === 'heading-count' && finding.heading === 'automatic-checks'), true);
  });

  it('passes a sharded fixture when all section shards are listed', async () => {
    const root = await makeTempDir('vibe-review-shard-listed-');
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-review', 'SKILL.md'),
      [
        '---',
        'name: vibe-review',
        'description: fixture',
        '---',
        '<!-- BEGIN:VIBE-REVIEW:SECTION-SHARDS -->',
        '- `.claude/skills/vibe-review/sections/protocol.md`',
        '- `.claude/skills/vibe-review/sections/rubric.md`',
        '- `.claude/skills/vibe-review/sections/checks.md`',
        '- `.claude/skills/vibe-review/sections/report.md`',
        '<!-- END:VIBE-REVIEW:SECTION-SHARDS -->',
        '',
      ].join('\n'),
    );
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-review', 'sections', 'protocol.md'),
      '## Protocol\nRun node .vibe/harness/scripts/vibe-review-inputs.mjs --install. Allowed in a partial or uninitialized downstream checkout. Write docs/reports/review-<sprintCount>-<YYYY-MM-DD>.md.\n',
    );
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-review', 'sections', 'rubric.md'),
      '## Rubric\nUse openHarnessGapCount and pendingRiskRollups.length > 0.\n\n## Findings Format\nUse ## Findings (severity desc).\n',
    );
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-review', 'sections', 'checks.md'),
      '## Automatic Checks\nCall detectOptInGaps(). Use BEGIN:PROJECT:review-signals. Check pendingRestorations.length > 0. Check .vibe/config.json.bundle.enabled === false, .vibe/config.json.browserSmoke.enabled === false, and .vibe/config.json.bundle.policy === "automatic". Check wiringDriftFindings.length > 0.\n\n### Adapter-Health Blind Spot\nCheck productFetcherPaths.\n',
    );
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-review', 'sections', 'report.md'),
      '## Report Shape\nUse ## Inputs loaded, ## Findings (severity desc), ## Suggested next-sprint scope, and ## Links.\n',
    );

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; mode: string; shardPaths: string[] };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.mode, 'sharded');
    assert.equal(parsed.shardPaths.length, 4);
  });

  it('fails when a section shard exists but is not listed', async () => {
    const root = await makeTempDir('vibe-review-shard-unlisted-');
    await writeText(path.join(root, '.claude', 'skills', 'vibe-review', 'SKILL.md'), buildSkillContent());
    await writeText(path.join(root, '.claude', 'skills', 'vibe-review', 'sections', 'orphan.md'), '# orphan\n');

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as { findings: Array<{ id: string; path?: string }> };

    assert.equal(result.status, 1);
    assert.equal(
      parsed.findings.some(
        (finding) => finding.id === 'unlisted-section-shard' && finding.path === '.claude/skills/vibe-review/sections/orphan.md',
      ),
      true,
    );
  });
});
