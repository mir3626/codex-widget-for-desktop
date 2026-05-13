#!/usr/bin/env node
import process from 'node:process';
import {
  buildShardAuditBase,
  countMatches,
  runShardAuditCli,
} from './lib/skill-shard-audit.mjs';

const SKILL_PATH = '.claude/skills/vibe-interview/SKILL.md';
const SHARD_DIR = '.claude/skills/vibe-interview/sections';
const SHARD_BLOCK_BEGIN = '<!-- BEGIN:VIBE-INTERVIEW:SECTION-SHARDS -->';
const SHARD_BLOCK_END = '<!-- END:VIBE-INTERVIEW:SECTION-SHARDS -->';

const REQUIRED_HEADINGS = [
  { id: 'when-to-invoke', pattern: /^## When To Invoke\b/m },
  { id: 'invocation-protocol', pattern: /^## Invocation Protocol\b/m },
  { id: 'operating-notes', pattern: /^## Operating Notes\b/m },
  { id: 'po-proxy-mode', pattern: /^## PO-Proxy Mode\b/m },
  { id: 'unknown-handling', pattern: /^## "I don't know" \/ "미정" Handling\b/m },
  { id: 'termination', pattern: /^## Termination\b/m },
  { id: 'consensus-check', pattern: /^## Consensus Check\b/m },
  { id: 'output-artifacts', pattern: /^## Output Artifacts\b/m },
];

const REQUIRED_INVOCATION_STEPS = Array.from({ length: 12 }, (_, index) => index + 1);

const CRITICAL_SIGNALS = [
  { id: 'init-command', pattern: /vibe-interview\.mjs --init --prompt/ },
  { id: 'domain-inference-phase', pattern: /phase: "domain-inference"/ },
  { id: 'set-domain-command', pattern: /vibe-interview\.mjs --set-domain --domain/ },
  { id: 'round-phase', pattern: /phase: "round"/ },
  { id: 'continue-command', pattern: /vibe-interview\.mjs --continue --answer/ },
  { id: 'parse-phase', pattern: /phase: "parse"/ },
  { id: 'record-command', pattern: /vibe-interview\.mjs --record --attribution/ },
  { id: 'consensus-phase', pattern: /phase: "consensus"/ },
  { id: 'approve-decision', pattern: /--consensus --decision approve/ },
  { id: 'revise-decision', pattern: /--consensus --decision revise/ },
  { id: 'defer-decision', pattern: /--consensus --decision defer/ },
  { id: 'proxy-unconfirmed-decision', pattern: /--consensus --decision proxy-unconfirmed/ },
  { id: 'done-phase', pattern: /phase: "done"/ },
  { id: 'seed-for-product-md', pattern: /seedForProductMd/ },
  { id: 'internal-llm-host', pattern: /The Orchestrator is the LLM host/ },
  { id: 'no-external-model-call', pattern: /no external model call/ },
  { id: 'json-retry', pattern: /MUST be parseable JSON/ },
  { id: 'po-proxy-not-approved', pattern: /MUST NOT be marked `approved`/ },
  { id: 'po-proxy-session-log', pattern: /\[decision]\[phase3-po-proxy]/ },
  { id: 'deferred-sub-fields', pattern: /deferred` sub-fields/ },
  { id: 'hard-ambiguity-threshold', pattern: /ambiguity <= 0\.2/ },
  { id: 'max-rounds-threshold', pattern: /roundNumber > maxRounds/ },
  { id: 'soft-coverage-threshold', pattern: /coverage `>= 0\.8` and `ambiguity <= 0\.3`/ },
  { id: 'consensus-before-context', pattern: /last Phase 3 gate before context shard creation/ },
  { id: 'product-md-append', pattern: /docs\/context\/product\.md/ },
  { id: 'phase3-consensus-check-heading', pattern: /### Phase 3 Consensus Check/ },
];

function invocationStepPattern(step) {
  return new RegExp(`^${step}\\.\\s`, 'm');
}

function audit(root) {
  const base = buildShardAuditBase({
    root,
    skillPath: SKILL_PATH,
    shardDir: SHARD_DIR,
    shardBlockBegin: SHARD_BLOCK_BEGIN,
    shardBlockEnd: SHARD_BLOCK_END,
    invalidBlockMessage: 'invalid vibe-interview section shard marker block',
    shardLabel: 'section',
  });
  const { discoveredShards, effectiveText, ...baseReport } = base;

  if (base.mode === 'missing') {
    return {
      ...baseReport,
      discoveredSectionShards: discoveredShards,
      requiredHeadings: REQUIRED_HEADINGS.map((heading) => heading.id),
      requiredInvocationSteps: REQUIRED_INVOCATION_STEPS,
    };
  }

  const findings = [...base.findings];
  const headingPositions = [];
  for (const heading of REQUIRED_HEADINGS) {
    const count = countMatches(effectiveText, heading.pattern);
    const position = effectiveText.search(heading.pattern);
    headingPositions.push({ heading: heading.id, position });
    if (count !== 1) {
      findings.push({ severity: 'error', id: 'heading-count', heading: heading.id, detail: `expected exactly 1 matching heading, found ${count}` });
    }
  }

  for (let index = 1; index < headingPositions.length; index += 1) {
    const previous = headingPositions[index - 1];
    const current = headingPositions[index];
    if (previous.position === -1 || current.position === -1) {
      continue;
    }
    if (current.position <= previous.position) {
      findings.push({
        severity: 'error',
        id: 'heading-order',
        heading: current.heading,
        detail: `${current.heading} appears before ${previous.heading}`,
      });
    }
  }

  const stepPositions = [];
  for (const step of REQUIRED_INVOCATION_STEPS) {
    const pattern = invocationStepPattern(step);
    const count = countMatches(effectiveText, pattern);
    const position = effectiveText.search(pattern);
    stepPositions.push({ step, position });
    if (count !== 1) {
      findings.push({ severity: 'error', id: 'invocation-step-count', step, detail: `expected exactly 1 matching invocation step, found ${count}` });
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
        id: 'invocation-step-order',
        step: current.step,
        detail: `step ${current.step} appears before step ${previous.step}`,
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
    discoveredSectionShards: discoveredShards,
    requiredHeadings: REQUIRED_HEADINGS.map((heading) => heading.id),
    requiredInvocationSteps: REQUIRED_INVOCATION_STEPS,
    criticalSignals: CRITICAL_SIGNALS.map((signal) => signal.id),
    findings,
  };
}

function printText(report) {
  const status = report.ok ? 'OK' : 'FAIL';
  process.stdout.write(`[vibe-interview-shard-audit] ${status} mode=${report.mode} headings=${report.requiredHeadings.length} steps=${report.requiredInvocationSteps.length} shards=${report.shardPaths.length}\n`);
  for (const finding of report.findings) {
    const target = finding.path ?? finding.heading ?? finding.step ?? finding.signal ?? '';
    process.stdout.write(`- ${finding.severity}: ${finding.id}${target ? ` ${target}` : ''} - ${finding.detail}\n`);
  }
}

runShardAuditCli({
  argv: process.argv.slice(2),
  usage: 'Usage: node .vibe/harness/scripts/vibe-interview-shard-audit.mjs [--root <dir>] [--format text|json]',
  commandName: 'vibe-interview-shard-audit',
  audit,
  printText,
});
