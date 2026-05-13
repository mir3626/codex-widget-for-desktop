import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const tempDirs: string[] = [];
const scriptPath = path.resolve('.vibe', 'harness', 'scripts', 'vibe-init-shard-audit.mjs');

const requiredSteps = [
  'Step 1-0',
  'Step 1-0-agent',
  'Step 1-1',
  'Step 2-1',
  'Step 2-2',
  'Step 2-3',
  'Step 3-0',
  'Step 3-1',
  'Step 3-2',
  'Step 3-3',
  'Step 3-4',
  'Step 3-5',
  'Step 4-0',
  'Step 4-0a',
  'Step 4-0b',
  'Step 4-1',
];

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

function phaseForStep(step: string): string {
  if (step.startsWith('Step 1-')) {
    return 'Phase 1';
  }
  if (step.startsWith('Step 2-')) {
    return 'Phase 2';
  }
  if (step.startsWith('Step 3-')) {
    return 'Phase 3';
  }
  return 'Phase 4';
}

function buildSkillContent(omitStep?: string): string {
  const sections = new Map<string, string[]>();
  for (const step of requiredSteps) {
    if (step === omitStep) {
      continue;
    }
    const phase = phaseForStep(step);
    const entries = sections.get(phase) ?? [];
    entries.push(`### ${step}: fixture`);
    sections.set(phase, entries);
  }

  return [
    '---',
    'name: vibe-init',
    'description: fixture',
    '---',
    '',
    '## Phase 1 — 환경 점검 (doctor)',
    ...(sections.get('Phase 1') ?? []),
    '',
    '## Phase 2 — Sprint 역할별 Provider 배정 및 인증',
    ...(sections.get('Phase 2') ?? []),
    '',
    '## Phase 3 — 프로젝트 맞춤 설정 (native socratic interview: vibe-interview)',
    'Phase 3는 스킵 금지. consensus check is required.',
    'docs/context/product.md and BEGIN:PROJECT:review-signals must be written.',
    'BEGIN:VIBE:TEST-PATTERNS and BEGIN:VIBE:LINT-PATTERNS are required.',
    '[decision][phase3-utility-opt-in] and [decision][sprint-roadmap-drafted] are recorded.',
    ...(sections.get('Phase 3') ?? []),
    '',
    '## Phase 4 — 설정 요약 및 완료',
    'Run vibe-phase0-seal.mjs and vibe-sprint-mode.mjs on when needed.',
    ...(sections.get('Phase 4') ?? []),
    '',
    '## 중요 규칙',
    'Use npm run vibe:init -- --from-agent-skill --mode=human.',
    'Use --mode=agent --runtime=<claude|codex> for agent delegation.',
    '본 /vibe-init skill 흐름은 **즉시 중단**.',
    'Touch .vibe/config.local.json, AGENTS.md, and docs/orchestration/providers.md.',
    '',
  ].join('\n');
}

describe('vibe-init-shard-audit', () => {
  it('passes the current checkout', () => {
    const result = runAudit(process.cwd());
    const parsed = JSON.parse(result.stdout) as { ok: boolean; mode: string; requiredSteps: string[]; shardPaths: string[] };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.mode, 'sharded');
    assert.deepEqual(parsed.shardPaths, [
      '.claude/skills/vibe-init/phases/phase-2-providers.md',
      '.claude/skills/vibe-init/phases/phase-3-interview.md',
      '.claude/skills/vibe-init/phases/phase-4-complete.md',
      '.claude/skills/vibe-init/phases/rules.md',
    ]);
    assert.deepEqual(parsed.requiredSteps, requiredSteps);
  });

  it('fails when a required step is missing', async () => {
    const root = await makeTempDir('vibe-init-shard-missing-step-');
    await writeText(path.join(root, '.claude', 'skills', 'vibe-init', 'SKILL.md'), buildSkillContent('Step 3-4'));

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      findings: Array<{ id: string; step?: string }>;
    };

    assert.equal(result.status, 1);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.findings.some((finding) => finding.id === 'step-count' && finding.step === 'Step 3-4'), true);
  });

  it('passes a sharded fixture when all phase shards are listed', async () => {
    const root = await makeTempDir('vibe-init-shard-listed-');
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-init', 'SKILL.md'),
      [
        '---',
        'name: vibe-init',
        'description: fixture',
        '---',
        '<!-- BEGIN:VIBE-INIT:PHASE-SHARDS -->',
        '- `.claude/skills/vibe-init/phases/phase-1.md`',
        '- `.claude/skills/vibe-init/phases/phase-2.md`',
        '- `.claude/skills/vibe-init/phases/phase-3.md`',
        '- `.claude/skills/vibe-init/phases/phase-4.md`',
        '- `.claude/skills/vibe-init/phases/rules.md`',
        '<!-- END:VIBE-INIT:PHASE-SHARDS -->',
        '',
      ].join('\n'),
    );
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-init', 'phases', 'phase-1.md'),
      ['## Phase 1 — 환경 점검 (doctor)', '### Step 1-0: fixture', '### Step 1-0-agent: fixture', '### Step 1-1: fixture'].join('\n'),
    );
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-init', 'phases', 'phase-2.md'),
      ['## Phase 2 — Sprint 역할별 Provider 배정 및 인증', '### Step 2-1: fixture', '### Step 2-2: fixture', '### Step 2-3: fixture'].join('\n'),
    );
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-init', 'phases', 'phase-3.md'),
      [
        '## Phase 3 — 프로젝트 맞춤 설정 (native socratic interview: vibe-interview)',
        'Phase 3는 스킵 금지. consensus check is required.',
        'docs/context/product.md and BEGIN:PROJECT:review-signals must be written.',
        'BEGIN:VIBE:TEST-PATTERNS and BEGIN:VIBE:LINT-PATTERNS are required.',
        '[decision][phase3-utility-opt-in] and [decision][sprint-roadmap-drafted] are recorded.',
        '### Step 3-0: fixture',
        '### Step 3-1: fixture',
        '### Step 3-2: fixture',
        '### Step 3-3: fixture',
        '### Step 3-4: fixture',
        '### Step 3-5: fixture',
      ].join('\n'),
    );
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-init', 'phases', 'phase-4.md'),
      ['## Phase 4 — 설정 요약 및 완료', 'Run vibe-phase0-seal.mjs and vibe-sprint-mode.mjs on when needed.', '### Step 4-0: fixture', '### Step 4-0a: fixture', '### Step 4-0b: fixture', '### Step 4-1: fixture'].join('\n'),
    );
    await writeText(
      path.join(root, '.claude', 'skills', 'vibe-init', 'phases', 'rules.md'),
      ['## 중요 규칙', 'Use npm run vibe:init -- --from-agent-skill --mode=human.', 'Use --mode=agent --runtime=<claude|codex> for agent delegation.', '본 /vibe-init skill 흐름은 **즉시 중단**.', 'Touch .vibe/config.local.json, AGENTS.md, and docs/orchestration/providers.md.'].join('\n'),
    );

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; mode: string; shardPaths: string[] };

    assert.equal(result.status, 0, result.stderr);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.mode, 'sharded');
    assert.equal(parsed.shardPaths.length, 5);
  });

  it('fails when a phase shard exists but is not listed', async () => {
    const root = await makeTempDir('vibe-init-shard-unlisted-');
    await writeText(path.join(root, '.claude', 'skills', 'vibe-init', 'SKILL.md'), buildSkillContent());
    await writeText(path.join(root, '.claude', 'skills', 'vibe-init', 'phases', 'phase-1.md'), '# orphan\n');

    const result = runAudit(root);
    const parsed = JSON.parse(result.stdout) as { findings: Array<{ id: string; path?: string }> };

    assert.equal(result.status, 1);
    assert.equal(
      parsed.findings.some(
        (finding) => finding.id === 'unlisted-phase-shard' && finding.path === '.claude/skills/vibe-init/phases/phase-1.md',
      ),
      true,
    );
  });
});
