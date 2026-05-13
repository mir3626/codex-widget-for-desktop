import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const tempDirs: string[] = [];
const scriptPath = path.resolve('.vibe', 'harness', 'scripts', 'vibe-codex-wrapper-audit.mjs');

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

function codexWrapper(skillName: string, sharedPath = `.claude/skills/${skillName}/SKILL.md`): string {
  return [
    '---',
    `name: ${skillName}`,
    'description: fixture',
    '---',
    `# ${skillName} for Codex`,
    'This repository keeps provider-neutral skill runbooks under `.claude/skills`.',
    '<!-- BEGIN:VIBE-CODEX:SHARDS -->',
    `- \`${sharedPath}\``,
    '<!-- END:VIBE-CODEX:SHARDS -->',
    'When this skill is invoked in Codex, open the repository-root path and follow:',
    `\`${sharedPath}\``,
    '',
  ].join('\n');
}

describe('vibe-codex-wrapper-audit', () => {
  it('passes the current checkout and reports compact wrapper targets', () => {
    const result = runAudit(process.cwd());
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      claudeSkillCount: number;
      codexSkillCount: number;
      wrapperReports: Array<{ skill: string; targetCount: number; targets: string[] }>;
    };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.claudeSkillCount, parsed.codexSkillCount);

    const bySkill = new Map(parsed.wrapperReports.map((report) => [report.skill, report]));
    for (const compactSkill of ['goal-to-plan', 'maintain-context', 'self-qa', 'vibe-sprint-mode', 'write-report']) {
      const report = bySkill.get(compactSkill);
      assert.ok(report, compactSkill);
      assert.equal(report.targetCount, 2, compactSkill);
      assert.deepEqual(report.targets, [
        `.codex/skills/${compactSkill}/SKILL.md`,
        `.claude/skills/${compactSkill}/SKILL.md`,
      ]);
    }
    assert.equal(bySkill.get('vibe-init')?.targetCount, 6);
    assert.equal(bySkill.get('vibe-interview')?.targetCount, 6);
    assert.equal(bySkill.get('vibe-iterate')?.targetCount, 6);
    assert.equal(bySkill.get('vibe-review')?.targetCount, 6);
  });

  it('fails when a wrapper uses an unsafe relative shared skill path', async () => {
    const root = await makeTempDir('codex-wrapper-unsafe-');
    await writeText(path.join(root, '.claude', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\n---\n# demo\n');
    await writeText(
      path.join(root, '.codex', 'skills', 'demo', 'SKILL.md'),
      codexWrapper('demo', '../../../.claude/skills/demo/SKILL.md'),
    );

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; findings: Array<{ id: string }> };

    assert.equal(result.status, 1);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.findings.some((finding) => finding.id === 'unsafe-wrapper-reference'), true);
    assert.equal(parsed.findings.some((finding) => finding.id === 'non-injectable-target'), true);
  });

  it('fails when a wrapper omits the VIBE-CODEX shard block', async () => {
    const root = await makeTempDir('codex-wrapper-missing-block-');
    await writeText(path.join(root, '.claude', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\n---\n# demo\n');
    await writeText(
      path.join(root, '.codex', 'skills', 'demo', 'SKILL.md'),
      [
        '---',
        'name: demo',
        'description: fixture',
        '---',
        'This repository keeps provider-neutral skill runbooks under `.claude/skills`.',
        'Open the repository-root path `.claude/skills/demo/SKILL.md`.',
        '',
      ].join('\n'),
    );

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; findings: Array<{ id: string }> };

    assert.equal(result.status, 1);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.findings.some((finding) => finding.id === 'missing-wrapper-shard-block'), true);
  });

  it('fails when a shared runbook declares a missing transitive shard', async () => {
    const root = await makeTempDir('codex-wrapper-missing-shard-');
    await writeText(
      path.join(root, '.claude', 'skills', 'demo', 'SKILL.md'),
      [
        '---',
        'name: demo',
        '---',
        '<!-- BEGIN:DEMO:SHARDS -->',
        '- `.claude/skills/demo/sections/missing.md`',
        '<!-- END:DEMO:SHARDS -->',
        '',
      ].join('\n'),
    );
    await writeText(path.join(root, '.codex', 'skills', 'demo', 'SKILL.md'), codexWrapper('demo'));

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; findings: Array<{ id: string; path?: string }> };

    assert.equal(result.status, 1);
    assert.equal(parsed.ok, false);
    assert.equal(
      parsed.findings.some(
        (finding) => finding.id === 'missing-target' && finding.path === '.claude/skills/demo/sections/missing.md',
      ),
      true,
    );
  });
});
