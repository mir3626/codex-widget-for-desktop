#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const TEMPLATE_ARTIFACTS = [
  {
    relativePath: 'docs/plans/dogfood6-improvements.md',
    markers: ['dogfood6'],
  },
  {
    relativePath: 'docs/plans/iter-7-upstream-handoff.md',
    markers: ['dogfood10', 'iter-7'],
  },
  {
    relativePath: 'docs/prompts/dashboard-col-side-padding.md',
    markers: ['Dashboard col-side padding', 'renderShellHtml()'],
  },
  {
    relativePath: 'docs/prompts/dashboard-redesign.md',
    markers: ['Dashboard 디자인 리팩토링', 'renderShellHtml()'],
  },
  {
    relativePath: 'docs/prompts/sprint-commit-daily-scope-fix.md',
    markers: ['sprint-commit', 'daily log'],
  },
  {
    relativePath: 'docs/prompts/sprint-mode-tier-flag.md',
    markers: ['vibe-sprint-mode', '--tier core|extended'],
  },
  {
    relativePath: 'docs/reports/project-report.html',
    markers: ['iter-7-kickoff', 'vibe-doctor'],
  },
  {
    relativePath: '.vibe/archive/prompts/sprint-M1-codex-unavailable-signal.md',
    markers: ['CODEX_UNAVAILABLE', 'sprint-M1-codex-unavailable-signal'],
  },
  {
    relativePath: '.vibe/archive/prompts/sprint-M2-generator-scope-discipline.md',
    markers: ['Generator scope discipline', 'sprint-M2-generator-scope-discipline'],
  },
  {
    relativePath: '.vibe/archive/prompts/sprint-M3-review-adapter-blind-spot.md',
    markers: ['adapter-health', 'sprint-M3-review-adapter-blind-spot'],
  },
];

function readJson(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value, 'utf8');
}

function contentHasMarkers(filePath, markers) {
  let content = '';
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return false;
  }

  const lower = content.toLowerCase();
  return markers.every((marker) => lower.includes(marker.toLowerCase()));
}

function removeIfTemplateArtifact(root, artifact) {
  const filePath = path.join(root, artifact.relativePath);
  if (!existsSync(filePath) || !contentHasMarkers(filePath, artifact.markers)) {
    return false;
  }

  rmSync(filePath, { force: true });
  return true;
}

function ensureGitkeep(root, relativePath) {
  const filePath = path.join(root, relativePath);
  if (existsSync(filePath)) {
    return false;
  }

  writeText(filePath, '');
  return true;
}

function normalizeEmptyProjectMap(root) {
  const filePath = path.join(root, '.vibe', 'agent', 'project-map.json');
  if (!existsSync(filePath)) {
    return false;
  }

  const value = readJson(filePath, null);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.updatedAt !== '2026-04-16T00:00:00.000Z' ||
    !value.modules ||
    Object.keys(value.modules).length !== 0
  ) {
    return false;
  }

  writeJson(filePath, {
    ...value,
    updatedAt: new Date().toISOString(),
  });
  return true;
}

function normalizeEmptyContracts(root) {
  const filePath = path.join(root, '.vibe', 'agent', 'sprint-api-contracts.json');
  if (!existsSync(filePath)) {
    return false;
  }

  const value = readJson(filePath, null);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.updatedAt !== '2026-04-16T00:00:00.000Z' ||
    !value.contracts ||
    Object.keys(value.contracts).length !== 0
  ) {
    return false;
  }

  writeJson(filePath, {
    ...value,
    updatedAt: new Date().toISOString(),
  });
  return true;
}

function main() {
  const root = path.resolve(process.argv[2] ?? process.cwd());
  let removed = 0;
  let createdKeepFiles = 0;
  for (const artifact of TEMPLATE_ARTIFACTS) {
    if (removeIfTemplateArtifact(root, artifact)) {
      removed += 1;
    }
  }

  for (const keepFile of [
    'docs/plans/.gitkeep',
    'docs/prompts/.gitkeep',
    'docs/reports/.gitkeep',
    '.vibe/archive/prompts/.gitkeep',
  ]) {
    if (ensureGitkeep(root, keepFile)) {
      createdKeepFiles += 1;
    }
  }

  const projectMap = normalizeEmptyProjectMap(root) ? 'normalized' : 'idempotent';
  const contracts = normalizeEmptyContracts(root) ? 'normalized' : 'idempotent';
  process.stdout.write(
    `[migrate 1.7.14] removedTemplateArtifacts=${removed} keepFiles=${createdKeepFiles} projectMap=${projectMap} contracts=${contracts}\n`,
  );
}

try {
  main();
  process.exit(0);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
