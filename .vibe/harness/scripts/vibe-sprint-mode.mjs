#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

const PRESET_FILES = {
  core: 'agent-delegation.json',
  extended: 'agent-delegation-extended.json',
};

const LEGACY_PRESET_ALLOW_RULES = [
  'Bash(npm install:*)',
  'Bash(npm ci:*)',
  'Bash(npm run build:*)',
  'Bash(npm run dev:*)',
  'Bash(npm run test:*)',
  'Bash(npm run typecheck:*)',
  'Bash(npm run test:unit:*)',
  'Bash(npm run preview:*)',
  'Bash(npm run lint:*)',
  'Bash(npm run vibe:*)',
  'Bash(npm test:*)',
  'Bash(npx tsc:*)',
  'Bash(npx vitest:*)',
  'Bash(npx eslint:*)',
  'Bash(npx playwright:*)',
  'Bash(node --import tsx:*)',
  'Bash(node --import tsx --test:*)',
  'Bash(node --test:*)',
  'Bash(node --check:*)',
  'Bash(node .vibe/harness/scripts/:*)',
  'Bash(cat * | ./.vibe/harness/scripts/run-codex.sh:*)',
  'Bash(./.vibe/harness/scripts/run-codex.sh:*)',
  'Bash(git add:*)',
  'Bash(git commit:*)',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git ls-files:*)',
  'Bash(git push:*)',
  'Bash(git checkout:*)',
  'Bash(git branch:*)',
  'Bash(git rev-parse:*)',
  'Bash(git rev-list:*)',
  'Bash(git tag:*)',
  'Bash(git tag -l:*)',
  'Bash(git tag --list:*)',
  'Bash(git fetch:*)',
  'Bash(git merge-base:*)',
  'Bash(git config --get:*)',
  'Bash(git ls-remote:*)',
  'Bash(git stash list:*)',
  'Bash(mkdir:*)',
  'Bash(cp:*)',
  'Bash(mv:*)',
  'Bash(ls:*)',
  'Bash(cat:*)',
  'Bash(head:*)',
  'Bash(tail:*)',
  'Bash(wc:*)',
  'Bash(grep:*)',
  'Bash(find:*)',
  'Bash(xargs:*)',
  'Bash(cmd /c *)',
  'Bash(cmd //c *)',
  'Bash(cmd //c "npx tsc:*)',
  'Bash(cmd //c "npm run:*)',
  'Bash(cmd //c "node:*)',
  'Bash(cmd //c "node --import tsx:*)',
];

function getPresetPath(rootDir, tier) {
  return path.resolve(rootDir, '.vibe', 'settings-presets', PRESET_FILES[tier]);
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    fail(`Invalid ${label}; expected a string array`);
  }
}

function loadPreset(rootDir, tier = 'core', options = {}) {
  const presetPath = getPresetPath(rootDir, tier);
  if (!existsSync(presetPath) && tier === 'extended' && options.fallbackToCore === true) {
    if (options.warnOnFallback === true) {
      process.stderr.write(
        '[vibe-sprint-mode] WARN -- extended preset missing; falling back to core\n',
      );
    }
    return loadPreset(rootDir, 'core');
  }

  if (!existsSync(presetPath)) {
    fail(`Missing preset file: ${presetPath}`);
  }

  const preset = readJson(presetPath);
  const allowRules = preset.rules ?? preset.allowRules;
  const denyRules = preset.denyRules ?? [];
  assertStringArray(allowRules, `preset allow rules in ${presetPath}`);
  assertStringArray(denyRules, `preset deny rules in ${presetPath}`);

  return { allowRules, denyRules };
}

function loadAllPresetRules(rootDir) {
  const allowRules = new Set(LEGACY_PRESET_ALLOW_RULES);
  const denyRules = new Set();
  for (const tier of ['core', 'extended']) {
    const presetPath = getPresetPath(rootDir, tier);
    if (!existsSync(presetPath)) {
      continue;
    }

    const preset = loadPreset(rootDir, tier);
    for (const rule of preset.allowRules) {
      allowRules.add(rule);
    }
    for (const rule of preset.denyRules) {
      denyRules.add(rule);
    }
  }

  return { allowRules, denyRules };
}

function loadSettings(rootDir, createIfMissing = false) {
  const settingsPath = path.resolve(rootDir, '.claude', 'settings.local.json');
  if (!existsSync(settingsPath)) {
    return {
      settingsPath,
      exists: false,
      settings: createIfMissing
        ? {
            permissions: {
              allow: [],
            },
          }
        : null,
    };
  }

  return {
    settingsPath,
    exists: true,
    settings: readJson(settingsPath),
  };
}

function getAllowRules(settings) {
  const allow = settings?.permissions?.allow;
  if (allow === undefined) {
    return [];
  }

  if (!Array.isArray(allow) || allow.some((entry) => typeof entry !== 'string')) {
    fail('Expected .claude/settings.local.json permissions.allow to be a string array');
  }

  return allow;
}

function getDenyRules(settings) {
  const deny = settings?.permissions?.deny;
  if (deny === undefined) {
    return [];
  }

  if (!Array.isArray(deny) || deny.some((entry) => typeof entry !== 'string')) {
    fail('Expected .claude/settings.local.json permissions.deny to be a string array');
  }

  return deny;
}

function mergePermissions(settings, allowRules, denyRules = getDenyRules(settings)) {
  const nextSettings =
    settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  const nextPermissions =
    nextSettings.permissions &&
    typeof nextSettings.permissions === 'object' &&
    !Array.isArray(nextSettings.permissions)
      ? nextSettings.permissions
      : {};

  return {
    ...nextSettings,
    permissions: {
      ...nextPermissions,
      allow: allowRules,
      deny: denyRules,
    },
  };
}

function saveSettings(settingsPath, settings) {
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

function runOn(rootDir, tier) {
  const preset = loadPreset(rootDir, tier, {
    fallbackToCore: true,
    warnOnFallback: tier === 'extended',
  });
  const { settingsPath, settings } = loadSettings(rootDir, true);
  const legacyPresetSet = new Set(LEGACY_PRESET_ALLOW_RULES);
  const currentAllow = getAllowRules(settings).filter((entry) => !legacyPresetSet.has(entry));
  const currentDeny = getDenyRules(settings);
  const nextAllow = [...new Set([...currentAllow, ...preset.allowRules])];
  const nextDeny = [...new Set([...currentDeny, ...preset.denyRules])];
  const addedCount = nextAllow.length - currentAllow.length;
  const addedDenyCount = nextDeny.length - currentDeny.length;

  saveSettings(settingsPath, mergePermissions(settings, nextAllow, nextDeny));
  process.stdout.write(
    `[vibe-sprint-mode] ON -- ${preset.allowRules.length} allow rules and ${preset.denyRules.length} deny guards merged (${addedCount} allow new, ${addedDenyCount} deny new). Total allow rules: ${nextAllow.length}\n`,
  );
}

function runOff(rootDir) {
  const presetSet = loadAllPresetRules(rootDir);
  const { settingsPath, exists, settings } = loadSettings(rootDir, false);

  if (!exists || settings === null) {
    process.stdout.write('[vibe-sprint-mode] OFF -- nothing to remove\n');
    return;
  }

  const currentAllow = getAllowRules(settings);
  const currentDeny = getDenyRules(settings);
  const nextAllow = currentAllow.filter((entry) => !presetSet.allowRules.has(entry));
  const nextDeny = currentDeny.filter((entry) => !presetSet.denyRules.has(entry));
  const removedCount = currentAllow.length - nextAllow.length;
  const removedDenyCount = currentDeny.length - nextDeny.length;

  saveSettings(settingsPath, mergePermissions(settings, nextAllow, nextDeny));
  process.stdout.write(
    `[vibe-sprint-mode] OFF -- ${removedCount} allow rules and ${removedDenyCount} deny guards removed. Remaining allow rules: ${nextAllow.length}\n`,
  );
}

function runStatus(rootDir) {
  const hasExtendedPreset = existsSync(getPresetPath(rootDir, 'extended'));
  const statusTier = hasExtendedPreset ? 'extended' : 'core';
  const preset = loadPreset(rootDir, statusTier);
  const presetSet = new Set(preset.allowRules);
  const coreRules = hasExtendedPreset ? loadPreset(rootDir, 'core').allowRules : preset.allowRules;
  const denySet = new Set(preset.denyRules);
  const { settings } = loadSettings(rootDir, false);
  const currentAllow = settings === null ? [] : getAllowRules(settings);
  const currentDeny = settings === null ? [] : getDenyRules(settings);
  const activeSet = new Set(currentAllow.filter((entry) => presetSet.has(entry)));
  const activeDenySet = new Set(currentDeny.filter((entry) => denySet.has(entry)));
  const activeCount = activeSet.size;
  const hasAllCoreRules = coreRules.every((entry) => activeSet.has(entry));
  const hasOnlyCoreRules = hasAllCoreRules && activeCount === coreRules.length;
  const hasAllPresetRules = activeCount === preset.allowRules.length;
  const mode =
    hasExtendedPreset && activeCount > 0 && !hasOnlyCoreRules && !hasAllPresetRules
      ? 'PARTIAL'
      : activeCount > 0
        ? 'ON'
        : 'OFF';
  const tierLabel =
    hasExtendedPreset && mode === 'ON'
      ? hasAllPresetRules
        ? ' (extended)'
        : ' (core)'
      : '';

  process.stdout.write(
    `[vibe-sprint-mode] ${mode}${tierLabel} -- ${activeCount}/${preset.allowRules.length} allow rules active, ${activeDenySet.size}/${preset.denyRules.length} deny guards active\n`,
  );
}

function parseArgs(argv) {
  const command = argv[0];
  let tier = 'core';

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg !== '--tier') {
      fail(`Unknown option: ${arg}`);
    }

    tier = argv[i + 1];
    i++;
  }

  if (!['core', 'extended'].includes(tier)) {
    fail(`Invalid --tier value: ${tier}. Expected core or extended.`);
  }

  return { command, tier };
}

function main() {
  const { command, tier } = parseArgs(process.argv.slice(2));

  if (command === 'on') {
    runOn(process.cwd(), tier);
    return;
  }

  if (command === 'off') {
    runOff(process.cwd());
    return;
  }

  if (command === 'status') {
    runStatus(process.cwd());
    return;
  }

  fail('Usage: node .vibe/harness/scripts/vibe-sprint-mode.mjs <on|off|status>');
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
