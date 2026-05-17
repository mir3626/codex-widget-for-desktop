#!/usr/bin/env node
import process from 'node:process';
import {
  buildShardAuditBase,
  countMatches,
  runShardAuditCli,
} from './lib/skill-shard-audit.mjs';

const SKILL_PATH = '.claude/skills/vibe-iterate/SKILL.md';
const SHARD_DIR = '.claude/skills/vibe-iterate/phases';
const SHARD_BLOCK_BEGIN = '<!-- BEGIN:VIBE-ITERATE:PHASE-SHARDS -->';
const SHARD_BLOCK_END = '<!-- END:VIBE-ITERATE:PHASE-SHARDS -->';

const REQUIRED_PHASES = [
  { id: 'phase-0-load-state', pattern: /^#{1,2}\s+(?:vibe-iterate\s+)?Phase 0 - Load State\b/m },
  { id: 'phase-1-differential-interview', pattern: /^#{1,2}\s+(?:vibe-iterate\s+)?Phase 1 - Differential Interview\b/m },
  { id: 'phase-2-write-active-sprint-roadmap', pattern: /^#{1,2}\s+(?:vibe-iterate\s+)?Phase 2 - Write Active Sprint Roadmap\b/m },
  { id: 'phase-3-update-iteration-history', pattern: /^#{1,2}\s+(?:vibe-iterate\s+)?Phase 3 - Update Iteration History\b/m },
  { id: 'phase-4-run-sprints-normally', pattern: /^#{1,2}\s+(?:vibe-iterate\s+)?Phase 4 - Run Sprints Normally\b/m },
  { id: 'phase-5-refresh-project-report', pattern: /^#{1,2}\s+(?:vibe-iterate\s+)?Phase 5 - Refresh Project Report\b/m },
];

const CRITICAL_SIGNALS = [
  { id: 'project-report-input', pattern: /docs\/reports\/project-report\.html|project-report\.html/ },
  { id: 'handoff-input', pattern: /\.vibe\/agent\/handoff\.md/ },
  { id: 'session-log-input', pattern: /\.vibe\/agent\/session-log\.md/ },
  { id: 'milestones-input', pattern: /docs\/plans\/project-milestones\.md/ },
  { id: 'iteration-history-input', pattern: /\.vibe\/agent\/iteration-history\.json/ },
  { id: 'roadmap-input', pattern: /docs\/plans\/sprint-roadmap\.md/ },
  { id: 'orchestrator-input-only', pattern: /Orchestrator input only/ },
  { id: 'no-full-history-planner', pattern: /do not inject the full history into\s+Planner prompts/ },
  { id: 'iterate-interview-command', pattern: /vibe-interview\.mjs --mode iterate --carryover/ },
  { id: 'interview-output-log', pattern: /\.vibe\/interview-log\/iter-<N>\.json/ },
  { id: 'carryover-seed', pattern: /carryover seed/ },
  { id: 'empty-carryover-fresh-restart', pattern: /empty carryover/ },
  { id: 'write-roadmap-section', pattern: /## Iteration iter-<N>/ },
  { id: 'archive-before-compact-roadmap', pattern: /Never delete existing roadmap content unless it has first been archived/ },
  { id: 'roadmap-maintenance-command', pattern: /vibe-roadmap-maintenance\.mjs --mode start-check/ },
  { id: 'current-iteration-set', pattern: /currentIteration/ },
  { id: 'planned-sprints', pattern: /plannedSprints\[\]/ },
  { id: 'planner-no-iteration-history', pattern: /Planner must not receive `\.vibe\/agent\/iteration-history\.json`/ },
  { id: 'prior-sprint-header', pattern: /This is iter-<N> sprint-NN/ },
  { id: 'report-generator-command', pattern: /vibe-project-report\.mjs/ },
  { id: 'silent-report-refresh', pattern: /--no-open/ },
  { id: 'user-follow-up-report', pattern: /Iteration timeline and milestone progress/ },
  { id: 'handoff-current-iteration-only', pattern: /handoff\.md` focused on the current iteration only/ },
  { id: 'context-isolation-guarantee', pattern: /Context Isolation Guarantee/ },
  { id: 'fresh-context-per-sprint', pattern: /Planner remains fresh-context per Sprint/ },
  { id: 'short-prior-sprint-summaries', pattern: /short\s+Orchestrator-authored prior-sprint summaries/ },
];

function audit(root) {
  const base = buildShardAuditBase({
    root,
    skillPath: SKILL_PATH,
    shardDir: SHARD_DIR,
    shardBlockBegin: SHARD_BLOCK_BEGIN,
    shardBlockEnd: SHARD_BLOCK_END,
    invalidBlockMessage: 'invalid vibe-iterate phase shard marker block',
    shardLabel: 'phase',
  });
  const { discoveredShards, effectiveText, ...baseReport } = base;

  if (base.mode === 'missing') {
    return {
      ...baseReport,
      discoveredPhaseShards: discoveredShards,
      requiredPhases: REQUIRED_PHASES.map((phase) => phase.id),
    };
  }

  const findings = [...base.findings];
  const phasePositions = [];
  for (const phase of REQUIRED_PHASES) {
    const count = countMatches(effectiveText, phase.pattern);
    const position = effectiveText.search(phase.pattern);
    phasePositions.push({ phase: phase.id, position });
    if (count !== 1) {
      findings.push({ severity: 'error', id: 'phase-count', phase: phase.id, detail: `expected exactly 1 matching phase, found ${count}` });
    }
  }

  for (let index = 1; index < phasePositions.length; index += 1) {
    const previous = phasePositions[index - 1];
    const current = phasePositions[index];
    if (previous.position === -1 || current.position === -1) {
      continue;
    }
    if (current.position <= previous.position) {
      findings.push({
        severity: 'error',
        id: 'phase-order',
        phase: current.phase,
        detail: `${current.phase} appears before ${previous.phase}`,
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
    requiredPhases: REQUIRED_PHASES.map((phase) => phase.id),
    criticalSignals: CRITICAL_SIGNALS.map((signal) => signal.id),
    findings,
  };
}

function printText(report) {
  const status = report.ok ? 'OK' : 'FAIL';
  process.stdout.write(`[vibe-iterate-shard-audit] ${status} mode=${report.mode} phases=${report.requiredPhases.length} signals=${report.criticalSignals?.length ?? 0} shards=${report.shardPaths.length}\n`);
  for (const finding of report.findings) {
    const target = finding.path ?? finding.phase ?? finding.signal ?? '';
    process.stdout.write(`- ${finding.severity}: ${finding.id}${target ? ` ${target}` : ''} - ${finding.detail}\n`);
  }
}

runShardAuditCli({
  argv: process.argv.slice(2),
  usage: 'Usage: node .vibe/harness/scripts/vibe-iterate-shard-audit.mjs [--root <dir>] [--format text|json]',
  commandName: 'vibe-iterate-shard-audit',
  audit,
  printText,
});
