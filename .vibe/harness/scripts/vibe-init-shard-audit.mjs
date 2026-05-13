#!/usr/bin/env node
import process from 'node:process';
import {
  buildShardAuditBase,
  countMatches,
  escapeRegExp,
  runShardAuditCli,
} from './lib/skill-shard-audit.mjs';

const SKILL_PATH = '.claude/skills/vibe-init/SKILL.md';
const SHARD_DIR = '.claude/skills/vibe-init/phases';
const SHARD_BLOCK_BEGIN = '<!-- BEGIN:VIBE-INIT:PHASE-SHARDS -->';
const SHARD_BLOCK_END = '<!-- END:VIBE-INIT:PHASE-SHARDS -->';

const REQUIRED_PHASES = [
  { id: 'phase-1', pattern: /^## Phase 1\b/m },
  { id: 'phase-2', pattern: /^## Phase 2\b/m },
  { id: 'phase-3', pattern: /^## Phase 3\b/m },
  { id: 'phase-4', pattern: /^## Phase 4\b/m },
  { id: 'rules', pattern: /^## 중요 규칙(?:\s|$)/m },
];

const REQUIRED_STEPS = [
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

const CRITICAL_SIGNALS = [
  { id: 'human-bootstrap-command', pattern: /npm run vibe:init -- --from-agent-skill --mode=human/ },
  { id: 'agent-bootstrap-command', pattern: /--mode=agent --runtime=(?:<claude\|codex>|claude|codex)/ },
  { id: 'agent-mode-stop', pattern: /본 `?\/vibe-init`? skill 흐름은 \*\*즉시 중단\*\*/ },
  { id: 'no-phase3-skip', pattern: /Phase 3는 스킵 금지/ },
  { id: 'consensus-check', pattern: /consensus/i },
  { id: 'context-shard-write', pattern: /docs\/context\/product\.md/ },
  { id: 'review-signals', pattern: /BEGIN:PROJECT:review-signals/ },
  { id: 'test-pattern-markers', pattern: /BEGIN:VIBE:TEST-PATTERNS/ },
  { id: 'lint-pattern-markers', pattern: /BEGIN:VIBE:LINT-PATTERNS/ },
  { id: 'utility-opt-in-log', pattern: /\[decision]\[phase3-utility-opt-in]/ },
  { id: 'roadmap-drafted-log', pattern: /\[decision]\[sprint-roadmap-drafted]/ },
  { id: 'phase0-seal', pattern: /vibe-phase0-seal\.mjs/ },
  { id: 'sprint-mode-preset', pattern: /vibe-sprint-mode\.mjs on/ },
  { id: 'config-local', pattern: /\.vibe\/config\.local\.json/ },
  { id: 'agents-md', pattern: /AGENTS\.md/ },
  { id: 'providers-doc', pattern: /docs\/orchestration\/providers\.md/ },
];

function stepPattern(step) {
  return new RegExp(`^#{2,4}\\s+${escapeRegExp(step)}(?::|\\s|$)`, 'm');
}

function audit(root) {
  const base = buildShardAuditBase({
    root,
    skillPath: SKILL_PATH,
    shardDir: SHARD_DIR,
    shardBlockBegin: SHARD_BLOCK_BEGIN,
    shardBlockEnd: SHARD_BLOCK_END,
    invalidBlockMessage: 'invalid vibe-init phase shard marker block',
    shardLabel: 'phase',
  });
  const { discoveredShards, effectiveText, ...baseReport } = base;

  if (base.mode === 'missing') {
    return {
      ...baseReport,
      discoveredPhaseShards: discoveredShards,
      requiredSteps: REQUIRED_STEPS,
    };
  }

  const findings = [...base.findings];

  for (const phase of REQUIRED_PHASES) {
    const count = countMatches(effectiveText, phase.pattern);
    if (count !== 1) {
      findings.push({ severity: 'error', id: 'phase-count', phase: phase.id, detail: `expected exactly 1 matching heading, found ${count}` });
    }
  }

  const stepPositions = [];
  for (const step of REQUIRED_STEPS) {
    const pattern = stepPattern(step);
    const count = countMatches(effectiveText, pattern);
    const position = effectiveText.search(pattern);
    stepPositions.push({ step, position });
    if (count !== 1) {
      findings.push({ severity: 'error', id: 'step-count', step, detail: `expected exactly 1 matching heading, found ${count}` });
    }
  }

  for (let index = 1; index < stepPositions.length; index += 1) {
    const previous = stepPositions[index - 1];
    const current = stepPositions[index];
    if (previous.position === -1 || current.position === -1) {
      continue;
    }
    if (current.position <= previous.position) {
      findings.push({
        severity: 'error',
        id: 'step-order',
        step: current.step,
        detail: `${current.step} appears before ${previous.step}`,
      });
    }
  }

  for (const signal of CRITICAL_SIGNALS) {
    if (!signal.pattern.test(effectiveText)) {
      findings.push({ severity: 'error', id: 'missing-critical-signal', signal: signal.id, detail: `missing required signal: ${signal.id}` });
    }
  }

  return {
    ...baseReport,
    ok: findings.length === 0,
    discoveredPhaseShards: discoveredShards,
    requiredSteps: REQUIRED_STEPS,
    criticalSignals: CRITICAL_SIGNALS.map((signal) => signal.id),
    findings,
  };
}

function printText(report) {
  const status = report.ok ? 'OK' : 'FAIL';
  process.stdout.write(`[vibe-init-shard-audit] ${status} mode=${report.mode} steps=${report.requiredSteps.length} shards=${report.shardPaths.length}\n`);
  for (const finding of report.findings) {
    const target = finding.path ?? finding.step ?? finding.phase ?? finding.signal ?? '';
    process.stdout.write(`- ${finding.severity}: ${finding.id}${target ? ` ${target}` : ''} - ${finding.detail}\n`);
  }
}

runShardAuditCli({
  argv: process.argv.slice(2),
  usage: 'Usage: node .vibe/harness/scripts/vibe-init-shard-audit.mjs [--root <dir>] [--format text|json]',
  commandName: 'vibe-init-shard-audit',
  audit,
  printText,
});
