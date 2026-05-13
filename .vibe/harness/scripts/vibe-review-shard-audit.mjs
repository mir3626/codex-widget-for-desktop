#!/usr/bin/env node
import process from 'node:process';
import {
  buildShardAuditBase,
  countMatches,
  runShardAuditCli,
} from './lib/skill-shard-audit.mjs';

const SKILL_PATH = '.claude/skills/vibe-review/SKILL.md';
const SHARD_DIR = '.claude/skills/vibe-review/sections';
const SHARD_BLOCK_BEGIN = '<!-- BEGIN:VIBE-REVIEW:SECTION-SHARDS -->';
const SHARD_BLOCK_END = '<!-- END:VIBE-REVIEW:SECTION-SHARDS -->';

const REQUIRED_HEADINGS = [
  { id: 'protocol', pattern: /^## Protocol\b/m },
  { id: 'rubric', pattern: /^## Rubric\b/m },
  { id: 'findings-format', pattern: /^## Findings Format\b/m },
  { id: 'automatic-checks', pattern: /^## Automatic Checks\b/m },
  { id: 'adapter-health-blind-spot', pattern: /^### Adapter-Health Blind Spot\b/m },
  { id: 'report-shape', pattern: /^## Report Shape\b/m },
];

const CRITICAL_SIGNALS = [
  { id: 'input-helper-install', pattern: /vibe-review-inputs\.mjs --install/ },
  { id: 'partial-init-exception', pattern: /partial or uninitialized downstream checkout/ },
  { id: 'report-path-template', pattern: /docs\/reports\/review-<sprintCount>-<YYYY-MM-DD>\.md/ },
  { id: 'detect-opt-in-gaps', pattern: /detectOptInGaps\(\)/ },
  { id: 'review-signal-markers', pattern: /BEGIN:PROJECT:review-signals/ },
  { id: 'pending-restorations', pattern: /pendingRestorations\.length > 0/ },
  { id: 'bundle-disabled-check', pattern: /\.vibe\/config\.json\.bundle\.enabled === false/ },
  { id: 'browser-smoke-disabled-check', pattern: /\.vibe\/config\.json\.browserSmoke\.enabled === false/ },
  { id: 'bundle-automatic-policy', pattern: /\.vibe\/config\.json\.bundle\.policy === "automatic"/ },
  { id: 'harness-gap-ledger', pattern: /openHarnessGapCount/ },
  { id: 'pending-risk-rollups', pattern: /pendingRiskRollups\.length > 0/ },
  { id: 'wiring-drift-findings', pattern: /wiringDriftFindings\.length > 0/ },
  { id: 'adapter-health-paths', pattern: /productFetcherPaths/ },
  { id: 'report-findings-heading', pattern: /## Findings \(severity desc\)/ },
];

function audit(root) {
  const base = buildShardAuditBase({
    root,
    skillPath: SKILL_PATH,
    shardDir: SHARD_DIR,
    shardBlockBegin: SHARD_BLOCK_BEGIN,
    shardBlockEnd: SHARD_BLOCK_END,
    invalidBlockMessage: 'invalid vibe-review section shard marker block',
    shardLabel: 'section',
  });
  const { discoveredShards, effectiveText, ...baseReport } = base;

  if (base.mode === 'missing') {
    return {
      ...baseReport,
      discoveredSectionShards: discoveredShards,
      requiredHeadings: REQUIRED_HEADINGS.map((heading) => heading.id),
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
    criticalSignals: CRITICAL_SIGNALS.map((signal) => signal.id),
    findings,
  };
}

function printText(report) {
  const status = report.ok ? 'OK' : 'FAIL';
  process.stdout.write(`[vibe-review-shard-audit] ${status} mode=${report.mode} headings=${report.requiredHeadings.length} shards=${report.shardPaths.length}\n`);
  for (const finding of report.findings) {
    const target = finding.path ?? finding.heading ?? finding.signal ?? '';
    process.stdout.write(`- ${finding.severity}: ${finding.id}${target ? ` ${target}` : ''} - ${finding.detail}\n`);
  }
}

runShardAuditCli({
  argv: process.argv.slice(2),
  usage: 'Usage: node .vibe/harness/scripts/vibe-review-shard-audit.mjs [--root <dir>] [--format text|json]',
  commandName: 'vibe-review-shard-audit',
  audit,
  printText,
});
