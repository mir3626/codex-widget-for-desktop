import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const tempDirs: string[] = [];
const scriptPath = path.resolve('.vibe', 'harness', 'scripts', 'vibe-sprint-mode-audit.mjs');

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

function runAudit(root: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [scriptPath, '--root', root, '--format', 'json'], {
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function skillDoc(): string {
  return [
    '---',
    'name: vibe-sprint-mode',
    'description: fixture',
    '---',
    'Usage: `/vibe-sprint-mode on|off|status [--tier core|extended]`',
    '.vibe/settings-presets/agent-delegation.json',
    '.vibe/settings-presets/agent-delegation-extended.json',
    'Claude Code permission rules use wildcard matching, not JavaScript regular expressions.',
    'permissions.deny guards are required.',
    'Critical: git push --force, git reset --hard, git clean, rm -rf, npm publish, gh pr create|merge|close, .env*.',
    '`node .vibe/harness/scripts/vibe-sprint-mode.mjs on --tier extended`',
    '`node .vibe/harness/scripts/vibe-sprint-mode.mjs on --tier core`',
    '`node .vibe/harness/scripts/vibe-sprint-mode.mjs off`',
    '`[decision][sprint-mode-tier]`',
    'Only .claude/settings.local.json is edited; `.claude/settings.json` 은 절대 건드리지 않음.',
    '',
  ].join('\n');
}

function runtimeScript(): string {
  return [
    "const PRESET_FILES = { core: 'agent-delegation.json', extended: 'agent-delegation-extended.json' };",
    'const denyRules = preset.denyRules ?? [];',
    'const nextDeny = [...new Set([...currentDeny, ...preset.denyRules])];',
    'const nextDeny = currentDeny.filter((entry) => !presetSet.denyRules.has(entry));',
    'const activeDenySet = new Set(); activeDenySet.size;',
    'return { permissions: { allow: allowRules, deny: denyRules } };',
    'throw new Error("Invalid --tier value");',
    '',
  ].join('\n');
}

const coreRules = [
  'Bash(npm install *)',
  'Bash(npm ci *)',
  'Bash(npm run *)',
  'Bash(node *)',
  'Bash(./.vibe/harness/scripts/run-codex.sh *)',
  'Bash(git add *)',
  'Bash(git commit *)',
  'Bash(git push *)',
];

const extendedRules = [
  'Bash(npm *)',
  'Bash(npx *)',
  'Bash(node *)',
  'Bash(git *)',
  'Agent(sprint-planner)',
  'Agent(qa-guardian)',
  'Write(docs/**)',
  'Edit(.vibe/agent/handoff.md)',
  'Edit(.vibe/agent/session-log.md)',
  'Edit(package.json)',
  'WebFetch(domain:api.github.com)',
  'WebFetch(domain:registry.npmjs.org)',
];

const commonDenyRules = [
  'Bash(npm publish *)',
  'Bash(git push --force*)',
  'Bash(git reset --hard*)',
  'Bash(git clean *)',
  'Bash(git branch -D*)',
  'Bash(rm *)',
  'Bash(gh pr create *)',
  'Bash(gh pr merge *)',
  'Bash(gh pr close *)',
  'Bash(gh release create *)',
];

const broadGitDenyRules = [
  'Bash(git restore *)',
  'Bash(git checkout -- *)',
  'Bash(git rebase *)',
];

async function scaffoldAuditRoot(root: string): Promise<void> {
  await writeText(path.join(root, '.claude', 'skills', 'vibe-sprint-mode', 'SKILL.md'), skillDoc());
  await writeText(path.join(root, '.vibe', 'harness', 'scripts', 'vibe-sprint-mode.mjs'), runtimeScript());
  await writeJson(path.join(root, '.vibe', 'settings-presets', 'agent-delegation.json'), {
    presetName: 'agent-delegation',
    rules: coreRules,
    denyRules: commonDenyRules,
  });
  await writeJson(path.join(root, '.vibe', 'settings-presets', 'agent-delegation-extended.json'), {
    presetName: 'agent-delegation-extended',
    rules: extendedRules,
    denyRules: [...commonDenyRules, ...broadGitDenyRules],
  });
}

describe('vibe-sprint-mode-audit', () => {
  it('passes the current checkout', () => {
    const result = runAudit(process.cwd());
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      presetReports: Array<{ tier: string; allowCount: number; denyCount: number }>;
      findings: unknown[];
    };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.findings.length, 0);
    assert.equal(parsed.presetReports.some((report) => report.tier === 'core' && report.allowCount > 0), true);
    assert.equal(parsed.presetReports.some((report) => report.tier === 'extended' && report.denyCount > 0), true);
  });

  it('fails when broad git permissions lack destructive git deny guards', async () => {
    const root = await makeTempDir('sprint-mode-audit-missing-git-deny-');
    await scaffoldAuditRoot(root);
    await writeJson(path.join(root, '.vibe', 'settings-presets', 'agent-delegation-extended.json'), {
      presetName: 'agent-delegation-extended',
      rules: extendedRules,
      denyRules: commonDenyRules,
    });

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as { findings: Array<{ id: string; signal?: string }> };

    assert.equal(result.status, 1);
    assert.equal(parsed.findings.some((finding) => finding.id === 'missing-critical-signal' && finding.signal === 'git-restore'), true);
    assert.equal(parsed.findings.some((finding) => finding.id === 'missing-critical-signal' && finding.signal === 'git-rebase'), true);
  });

  it('fails when a preset directly grants sensitive write scope', async () => {
    const root = await makeTempDir('sprint-mode-audit-sensitive-write-');
    await scaffoldAuditRoot(root);
    await writeJson(path.join(root, '.vibe', 'settings-presets', 'agent-delegation-extended.json'), {
      presetName: 'agent-delegation-extended',
      rules: [...extendedRules, 'Write(src/**)'],
      denyRules: [...commonDenyRules, ...broadGitDenyRules],
    });

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as { findings: Array<{ id: string; signal?: string }> };

    assert.equal(result.status, 1);
    assert.equal(parsed.findings.some((finding) => finding.id === 'sensitive-write-allow-rule' && finding.signal === 'src-write'), true);
  });

  it('fails when sprint-mode guidance omits the decision log tag', async () => {
    const root = await makeTempDir('sprint-mode-audit-doc-signal-');
    await scaffoldAuditRoot(root);
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-sprint-mode', 'SKILL.md'),
      skillDoc().replace('`[decision][sprint-mode-tier]`', ''),
    );

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as { findings: Array<{ id: string; signal?: string }> };

    assert.equal(result.status, 1);
    assert.equal(parsed.findings.some((finding) => finding.id === 'missing-critical-signal' && finding.signal === 'session-log-tag'), true);
  });
});
