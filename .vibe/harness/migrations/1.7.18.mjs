#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { maintainRoadmap } from '../scripts/vibe-roadmap-maintenance.mjs';

const MAX_HANDOFF_BYTES = Number.parseInt(process.env.VIBE_HANDOFF_MAX_BYTES ?? '', 10) || 96 * 1024;
const MAX_HANDOFF_LINES = Number.parseInt(process.env.VIBE_HANDOFF_MAX_LINES ?? '', 10) || 1200;

function handoffStatus(root) {
  const filePath = path.join(root, '.vibe', 'agent', 'handoff.md');
  if (!existsSync(filePath)) {
    return 'missing';
  }

  const content = readFileSync(filePath, 'utf8');
  const bytes = Buffer.byteLength(content, 'utf8');
  const lines = content.split(/\r?\n/).length;
  return bytes > MAX_HANDOFF_BYTES || lines > MAX_HANDOFF_LINES
    ? `oversize:${bytes}B:${lines}L`
    : `ok:${bytes}B:${lines}L`;
}

function main() {
  const root = path.resolve(process.argv[2] ?? process.cwd());
  const roadmap = maintainRoadmap(root, { mode: 'migration' });
  const archived = roadmap.archived.map((entry) => `${entry.iterationId}:${entry.action}`).join(',') || '-';
  process.stdout.write(
    `[migrate 1.7.18] roadmap=${roadmap.reason} changed=${roadmap.changed} kept=${roadmap.kept.join(',') || '-'} archived=${archived} handoff=${handoffStatus(root)}\n`,
  );
}

try {
  main();
  process.exit(0);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
