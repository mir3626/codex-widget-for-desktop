#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SKILL_PATH = '.claude/skills/vibe-sprint-mode/SKILL.md';
const RUNTIME_PATH = '.vibe/harness/scripts/vibe-sprint-mode.mjs';
const PRESETS = [
  {
    tier: 'core',
    path: '.vibe/settings-presets/agent-delegation.json',
    expectedName: 'agent-delegation',
    requiredAllowSignals: [
      { id: 'npm-install', pattern: /Bash\(npm install \*\)/ },
      { id: 'npm-ci', pattern: /Bash\(npm ci \*\)/ },
      { id: 'npm-run', pattern: /Bash\(npm run \*\)/ },
      { id: 'node', pattern: /Bash\(node \*\)/ },
      { id: 'run-codex', pattern: /run-codex\.sh/ },
      { id: 'git-add', pattern: /Bash\(git add \*\)/ },
      { id: 'git-commit', pattern: /Bash\(git commit \*\)/ },
      { id: 'git-push', pattern: /Bash\(git push \*\)/ },
    ],
  },
  {
    tier: 'extended',
    path: '.vibe/settings-presets/agent-delegation-extended.json',
    expectedName: 'agent-delegation-extended',
    requiredAllowSignals: [
      { id: 'npm-family', pattern: /Bash\(npm \*\)/ },
      { id: 'npx-family', pattern: /Bash\(npx \*\)/ },
      { id: 'node-family', pattern: /Bash\(node \*\)/ },
      { id: 'git-family', pattern: /Bash\(git \*\)/ },
      { id: 'agent-sprint-planner', pattern: /Agent\(sprint-planner\)/ },
      { id: 'agent-qa-guardian', pattern: /Agent\(qa-guardian\)/ },
      { id: 'docs-write', pattern: /Write\(docs\/\*\*\)/ },
      { id: 'handoff-edit', pattern: /Edit\(\.vibe\/agent\/handoff\.md\)/ },
      { id: 'session-log-edit', pattern: /Edit\(\.vibe\/agent\/session-log\.md\)/ },
      { id: 'package-edit', pattern: /Edit\(package\.json\)/ },
      { id: 'github-webfetch', pattern: /WebFetch\(domain:api\.github\.com\)/ },
      { id: 'npm-webfetch', pattern: /WebFetch\(domain:registry\.npmjs\.org\)/ },
    ],
  },
];

const REQUIRED_DOC_SIGNALS = [
  { id: 'usage', pattern: /\/vibe-sprint-mode on\|off\|status \[--tier core\|extended]/ },
  { id: 'core-preset-path', pattern: /\.vibe\/settings-presets\/agent-delegation\.json/ },
  { id: 'extended-preset-path', pattern: /\.vibe\/settings-presets\/agent-delegation-extended\.json/ },
  { id: 'wildcard-warning', pattern: /wildcard matching, not JavaScript regular expressions/ },
  { id: 'permissions-deny', pattern: /permissions\.deny/ },
  { id: 'git-push-force', pattern: /git push --force/ },
  { id: 'git-reset-hard', pattern: /git reset --hard/ },
  { id: 'git-clean', pattern: /git clean/ },
  { id: 'rm', pattern: /rm -rf|모든 `rm`/ },
  { id: 'npm-publish', pattern: /npm publish/ },
  { id: 'gh-pr', pattern: /gh pr create\|merge\|close/ },
  { id: 'env-deny', pattern: /\.env\*/ },
  { id: 'settings-local-only', pattern: /\.claude\/settings\.local\.json/ },
  { id: 'shared-settings-never', pattern: /\.claude\/settings\.json` 은 절대 건드리지 않음/ },
  { id: 'session-log-tag', pattern: /\[decision]\[sprint-mode-tier]/ },
  { id: 'extended-command', pattern: /vibe-sprint-mode\.mjs on --tier extended/ },
  { id: 'core-command', pattern: /vibe-sprint-mode\.mjs on --tier core/ },
  { id: 'off-command', pattern: /vibe-sprint-mode\.mjs off/ },
];

const REQUIRED_RUNTIME_SIGNALS = [
  { id: 'core-preset-file', pattern: /core:\s*'agent-delegation\.json'/ },
  { id: 'extended-preset-file', pattern: /extended:\s*'agent-delegation-extended\.json'/ },
  { id: 'deny-rules-load', pattern: /const denyRules = preset\.denyRules \?\? \[\]/ },
  { id: 'settings-deny-merge', pattern: /deny:\s*denyRules/ },
  { id: 'on-merges-deny', pattern: /nextDeny = \[\.\.\.new Set\(\[\.\.\.currentDeny, \.\.\.preset\.denyRules]\)\]/ },
  { id: 'off-removes-deny', pattern: /nextDeny = currentDeny\.filter/ },
  { id: 'status-counts-deny', pattern: /activeDenySet\.size/ },
  { id: 'tier-parse', pattern: /Invalid --tier value/ },
];

const REQUIRED_DENY_SIGNALS = [
  { id: 'npm-publish', pattern: /npm publish/ },
  { id: 'git-push-force', pattern: /git push .*--force|git push --force/ },
  { id: 'git-reset-hard', pattern: /git reset --hard/ },
  { id: 'git-clean', pattern: /git clean/ },
  { id: 'git-branch-force-delete', pattern: /git branch -D|git branch --delete --force/ },
  { id: 'rm', pattern: /Bash\((?:cmd \/\/?c )?(?:rm|rmdir|del|erase|rd) / },
  { id: 'gh-pr-create', pattern: /gh pr create/ },
  { id: 'gh-pr-merge', pattern: /gh pr merge/ },
  { id: 'gh-pr-close', pattern: /gh pr close/ },
  { id: 'gh-release-create', pattern: /gh release create/ },
];

const BROAD_GIT_DENY_SIGNALS = [
  { id: 'git-restore', pattern: /git restore/ },
  { id: 'git-checkout-path', pattern: /git checkout --/ },
  { id: 'git-rebase', pattern: /git rebase/ },
];

const SENSITIVE_WRITE_PATTERNS = [
  { id: 'src-write', pattern: /^(?:Write|Edit)\(src\// },
  { id: 'scripts-write', pattern: /^(?:Write|Edit)\(scripts\// },
  { id: 'test-write', pattern: /^(?:Write|Edit)\(test\// },
  { id: 'env-write', pattern: /^(?:Write|Edit)\(\.env/ },
  { id: 'secrets-write', pattern: /^(?:Write|Edit)\(secrets\// },
  { id: 'credentials-write', pattern: /^(?:Write|Edit)\(config\/credentials\.json\)/ },
];

const DIRECT_DANGEROUS_ALLOW_PATTERNS = [
  { id: 'npm-publish', pattern: /Bash\(.*npm publish/ },
  { id: 'git-push-force', pattern: /Bash\(.*git push .*--force|Bash\(.*git push --force/ },
  { id: 'git-reset-hard', pattern: /Bash\(.*git reset --hard/ },
  { id: 'git-clean', pattern: /Bash\(.*git clean / },
  { id: 'git-branch-force-delete', pattern: /Bash\(.*git branch (?:-D|--delete --force)/ },
  { id: 'git-restore', pattern: /Bash\(.*git restore / },
  { id: 'git-checkout-path', pattern: /Bash\(.*git checkout -- / },
  { id: 'git-rebase', pattern: /Bash\(.*git rebase / },
  { id: 'gh-pr-create', pattern: /Bash\(.*gh pr create / },
  { id: 'gh-pr-merge', pattern: /Bash\(.*gh pr merge / },
  { id: 'gh-pr-close', pattern: /Bash\(.*gh pr close / },
  { id: 'gh-release-create', pattern: /Bash\(.*gh release create / },
  { id: 'rm', pattern: /Bash\((?:cmd \/\/?c )?(?:rm|rmdir|del|erase|rd) / },
  { id: 'taskkill', pattern: /Bash\(taskkill / },
];

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    format: 'text',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--root') {
      options.root = argv[index + 1] ?? options.root;
      index += 1;
      continue;
    }
    if (current === '--format') {
      options.format = argv[index + 1] ?? options.format;
      index += 1;
      continue;
    }
    if (current === '--help' || current === '-h') {
      process.stdout.write('Usage: node .vibe/harness/scripts/vibe-sprint-mode-audit.mjs [--root <dir>] [--format text|json]\n');
      process.exit(0);
    }
  }

  if (!['text', 'json'].includes(options.format)) {
    throw new Error(`unsupported --format: ${options.format}`);
  }

  return options;
}

function readText(root, relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(root, relativePath) {
  return JSON.parse(readText(root, relativePath).replace(/^\uFEFF/, ''));
}

function hasPattern(values, pattern) {
  return values.some((value) => pattern.test(value));
}

function isBroadCommandFamily(value, command) {
  const normalized = value.replaceAll('"', '');
  return (
    normalized === `Bash(${command} *)` ||
    normalized === `Bash(cmd /c ${command} *)` ||
    normalized === `Bash(cmd //c ${command} *)`
  );
}

function assertStringArray(value, label, findings) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    findings.push({ severity: 'error', id: 'invalid-string-array', target: label, detail: `${label} must be a string array` });
    return [];
  }
  return value;
}

function checkSignals(text, signals, target, findings) {
  for (const signal of signals) {
    if (!signal.pattern.test(text)) {
      findings.push({ severity: 'error', id: 'missing-critical-signal', target, signal: signal.id, detail: `missing required signal: ${signal.id}` });
    }
  }
}

function checkNoDuplicates(values, target, findings) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      findings.push({ severity: 'error', id: 'duplicate-rule', target, detail: `duplicate rule: ${value}` });
    }
    seen.add(value);
  }
}

function checkPreset(root, presetConfig, findings) {
  const absolutePath = path.join(root, presetConfig.path);
  if (!existsSync(absolutePath)) {
    findings.push({ severity: 'error', id: 'preset-missing', target: presetConfig.tier, path: presetConfig.path, detail: `${presetConfig.path} is missing` });
    return {
      tier: presetConfig.tier,
      path: presetConfig.path,
      allowCount: 0,
      denyCount: 0,
    };
  }

  let preset = null;
  try {
    preset = readJson(root, presetConfig.path);
  } catch (error) {
    findings.push({ severity: 'error', id: 'preset-json-invalid', target: presetConfig.tier, path: presetConfig.path, detail: error instanceof Error ? error.message : String(error) });
    return {
      tier: presetConfig.tier,
      path: presetConfig.path,
      allowCount: 0,
      denyCount: 0,
    };
  }

  if (preset?.presetName !== presetConfig.expectedName) {
    findings.push({ severity: 'error', id: 'preset-name', target: presetConfig.tier, detail: `expected presetName=${presetConfig.expectedName}` });
  }

  const allowRules = assertStringArray(preset?.rules ?? preset?.allowRules, `${presetConfig.tier}.rules`, findings);
  const denyRules = assertStringArray(preset?.denyRules ?? [], `${presetConfig.tier}.denyRules`, findings);
  checkNoDuplicates(allowRules, `${presetConfig.tier}.rules`, findings);
  checkNoDuplicates(denyRules, `${presetConfig.tier}.denyRules`, findings);

  const allowText = allowRules.join('\n');
  const denyText = denyRules.join('\n');
  checkSignals(allowText, presetConfig.requiredAllowSignals, `${presetConfig.tier}.rules`, findings);
  checkSignals(denyText, REQUIRED_DENY_SIGNALS, `${presetConfig.tier}.denyRules`, findings);

  for (const dangerous of DIRECT_DANGEROUS_ALLOW_PATTERNS) {
    if (hasPattern(allowRules, dangerous.pattern)) {
      findings.push({ severity: 'error', id: 'dangerous-allow-rule', target: presetConfig.tier, signal: dangerous.id, detail: `allow rule directly grants dangerous operation: ${dangerous.id}` });
    }
  }

  for (const sensitive of SENSITIVE_WRITE_PATTERNS) {
    if (hasPattern(allowRules, sensitive.pattern)) {
      findings.push({ severity: 'error', id: 'sensitive-write-allow-rule', target: presetConfig.tier, signal: sensitive.id, detail: `allow rule grants sensitive write scope: ${sensitive.id}` });
    }
  }

  const hasBroadGit = allowRules.some((rule) => isBroadCommandFamily(rule, 'git'));
  if (hasBroadGit) {
    checkSignals(denyText, BROAD_GIT_DENY_SIGNALS, `${presetConfig.tier}.denyRules`, findings);
  }

  const hasBroadNpm = allowRules.some((rule) => isBroadCommandFamily(rule, 'npm'));
  if (hasBroadNpm && !/npm publish/.test(denyText)) {
    findings.push({ severity: 'error', id: 'missing-broad-family-deny', target: presetConfig.tier, signal: 'npm-publish', detail: 'broad npm allow requires npm publish deny guard' });
  }

  const hasBroadGh = allowRules.some((rule) => isBroadCommandFamily(rule, 'gh'));
  if (hasBroadGh) {
    findings.push({ severity: 'error', id: 'broad-gh-allow-rule', target: presetConfig.tier, detail: 'use gh run/api scoped rules instead of broad gh *' });
  }

  return {
    tier: presetConfig.tier,
    path: presetConfig.path,
    allowCount: allowRules.length,
    denyCount: denyRules.length,
    broadGit: hasBroadGit,
    broadNpm: hasBroadNpm,
  };
}

function audit(root) {
  const findings = [];
  const skillExists = existsSync(path.join(root, SKILL_PATH));
  const runtimeExists = existsSync(path.join(root, RUNTIME_PATH));

  if (!skillExists) {
    findings.push({ severity: 'error', id: 'skill-missing', path: SKILL_PATH, detail: `${SKILL_PATH} is missing` });
  } else {
    checkSignals(readText(root, SKILL_PATH), REQUIRED_DOC_SIGNALS, SKILL_PATH, findings);
  }

  if (!runtimeExists) {
    findings.push({ severity: 'error', id: 'runtime-missing', path: RUNTIME_PATH, detail: `${RUNTIME_PATH} is missing` });
  } else {
    checkSignals(readText(root, RUNTIME_PATH), REQUIRED_RUNTIME_SIGNALS, RUNTIME_PATH, findings);
  }

  const presetReports = PRESETS.map((preset) => checkPreset(root, preset, findings));

  return {
    ok: findings.length === 0,
    skillPath: SKILL_PATH,
    runtimePath: RUNTIME_PATH,
    presetReports,
    docSignals: REQUIRED_DOC_SIGNALS.map((signal) => signal.id),
    runtimeSignals: REQUIRED_RUNTIME_SIGNALS.map((signal) => signal.id),
    denySignals: REQUIRED_DENY_SIGNALS.map((signal) => signal.id),
    findings,
  };
}

function printText(report) {
  const status = report.ok ? 'OK' : 'FAIL';
  const presets = report.presetReports.map((preset) => `${preset.tier}:${preset.allowCount}/${preset.denyCount}`).join(',');
  process.stdout.write(`[vibe-sprint-mode-audit] ${status} presets=${presets} docSignals=${report.docSignals.length} denySignals=${report.denySignals.length}\n`);
  for (const finding of report.findings) {
    const target = finding.path ?? finding.target ?? finding.signal ?? '';
    process.stdout.write(`- ${finding.severity}: ${finding.id}${target ? ` ${target}` : ''} - ${finding.detail}\n`);
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  const report = audit(path.resolve(options.root));
  if (options.format === 'json') {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printText(report);
  }
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  process.stderr.write(`[vibe-sprint-mode-audit] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
