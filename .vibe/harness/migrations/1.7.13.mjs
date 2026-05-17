#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const LEGACY_ITERATION_IDS = new Set(['iter-7', 'iter-8', 'iter-9', 'iter-10', 'iter-11', 'iter-12']);
const LEGACY_LABELS = new Set([
  'dogfood10-findings-A-B-D',
  'dogfood10-finding-C-app-loc-threshold',
  'rule-gates-and-wiring-drift',
  'dashboard-attention-wiring',
  'playwright-dashboard-report-smoke',
  'linux-ci-run-codex-wrapper',
]);
const LEGACY_SPRINT_MARKERS = [
  'sprint-M1-codex-unavailable-signal',
  'sprint-M2-generator-scope-discipline',
  'sprint-M3-review-adapter-blind-spot',
  'sprint-iter8-app-loc-threshold',
  'sprint-rule-disposition-gate',
  'sprint-wiring-drift-detector',
  'sprint-dashboard-attention-wiring',
  'sprint-playwright-dashboard-report-smoke',
  'sprint-linux-ci-run-codex-wrapper',
];

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

function initialIterationHistory() {
  return {
    $schema: './iteration-history.schema.json',
    currentIteration: null,
    iterations: [],
  };
}

function initialSprintRoadmap() {
  return [
    '# Sprint Roadmap',
    '',
    '<!-- BEGIN:VIBE:CURRENT-SPRINT -->',
    '> **Current**: idle',
    '> **Completed**: —',
    '> **Pending**: —',
    '<!-- END:VIBE:CURRENT-SPRINT -->',
    '',
    '## 배경',
    '',
    '이 파일은 `/vibe-init` Phase 4에서 Orchestrator가 프로젝트별 Sprint 로드맵을 작성해 저장하는 공간이다.',
    'active 파일에는 현재 iteration만 유지하고, 완료된 iteration 섹션은 `docs/plans/archive/roadmaps/` 에 보존한다.',
    '',
    '## 초기 상태',
    '',
    '아직 프로젝트 Sprint 로드맵이 작성되지 않았다. `/vibe-init` 완료 후 Phase 4/5에서 프로젝트 고유 Sprint 목록을 생성한다.',
    '',
  ].join('\n');
}

function isLegacyIteration(entry) {
  if (!isRecord(entry)) {
    return false;
  }
  const id = typeof entry.id === 'string' ? entry.id : '';
  const label = typeof entry.label === 'string' ? entry.label : '';
  const plannedSprints = Array.isArray(entry.plannedSprints) ? entry.plannedSprints : [];
  const completedSprints = Array.isArray(entry.completedSprints) ? entry.completedSprints : [];
  const sprintText = [...plannedSprints, ...completedSprints].filter((item) => typeof item === 'string').join('\n');
  return (
    LEGACY_ITERATION_IDS.has(id) &&
    (LEGACY_LABELS.has(label) || LEGACY_SPRINT_MARKERS.some((marker) => sprintText.includes(marker)))
  );
}

function migrateIterationHistory(root) {
  const filePath = path.join(root, '.vibe', 'agent', 'iteration-history.json');
  if (!existsSync(filePath)) {
    writeJson(filePath, initialIterationHistory());
    return 'created';
  }

  const history = readJson(filePath, null);
  if (!isRecord(history) || !Array.isArray(history.iterations)) {
    writeJson(filePath, initialIterationHistory());
    return 'reset-malformed';
  }

  const legacyEntries = history.iterations.filter((entry) => isLegacyIteration(entry));
  if (legacyEntries.length === 0) {
    return 'idempotent';
  }

  const nextIterations = history.iterations.filter((entry) => !isLegacyIteration(entry));
  const currentIteration =
    typeof history.currentIteration === 'string' && !LEGACY_ITERATION_IDS.has(history.currentIteration)
      ? history.currentIteration
      : null;

  writeJson(filePath, {
    ...history,
    $schema: typeof history.$schema === 'string' ? history.$schema : './iteration-history.schema.json',
    currentIteration: nextIterations.some((entry) => isRecord(entry) && entry.id === currentIteration)
      ? currentIteration
      : null,
    iterations: nextIterations,
  });
  return nextIterations.length === 0 ? 'reset-template' : `removed-template-entries:${legacyEntries.length}`;
}

function roadmapIterationNumbers(content) {
  return [...content.matchAll(/^# Iteration\s+(\d+)/gim)].map((match) => Number(match[1]));
}

function isTemplateRoadmap(content) {
  const legacyMarkerCount = LEGACY_SPRINT_MARKERS.filter((marker) => content.includes(marker)).length;
  if (legacyMarkerCount === 0) {
    return false;
  }

  const iterationNumbers = roadmapIterationNumbers(content);
  if (iterationNumbers.length === 0) {
    return legacyMarkerCount >= 2;
  }

  return iterationNumbers.every((value) => value >= 7 && value <= 12);
}

function migrateSprintRoadmap(root) {
  const filePath = path.join(root, 'docs', 'plans', 'sprint-roadmap.md');
  if (!existsSync(filePath)) {
    writeText(filePath, initialSprintRoadmap());
    return 'created';
  }

  const content = readFileSync(filePath, 'utf8');
  if (!isTemplateRoadmap(content)) {
    return 'idempotent';
  }

  writeText(filePath, initialSprintRoadmap());
  return 'reset-template';
}

function main() {
  const root = path.resolve(process.argv[2] ?? process.cwd());
  const iterationHistory = migrateIterationHistory(root);
  const sprintRoadmap = migrateSprintRoadmap(root);
  process.stdout.write(`[migrate 1.7.13] iterationHistory=${iterationHistory} sprintRoadmap=${sprintRoadmap}\n`);
}

try {
  main();
  process.exit(0);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
