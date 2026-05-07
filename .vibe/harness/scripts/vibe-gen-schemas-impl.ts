#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  GENERATED_ARTIFACT_SCHEMAS,
  STATE_FILE_SCHEMAS,
  type StateFileName,
} from '../src/lib/schemas/index.js';

const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
const mode = modeArg?.slice('--mode='.length) === 'write' ? 'write' : 'check';

const outputs: Record<StateFileName, string> = {
  'sprint-status.json': '.vibe/agent/sprint-status.schema.json',
  'project-map.json': '.vibe/agent/project-map.schema.json',
  'sprint-api-contracts.json': '.vibe/agent/sprint-api-contracts.schema.json',
  'iteration-history.json': '.vibe/agent/iteration-history.schema.json',
  'model-registry.json': '.vibe/model-registry.schema.json',
};

const artifactOutputs = {
  'sidecar-input.json': '.vibe/harness/schemas/sidecar-input.schema.json',
  'sidecar-artifact.json': '.vibe/harness/schemas/sidecar-artifact.schema.json',
} as const;

const allOutputs = {
  ...outputs,
  ...artifactOutputs,
} as const;

const allSchemas = {
  ...STATE_FILE_SCHEMAS,
  ...GENERATED_ARTIFACT_SCHEMAS,
} as const;

type SchemaOutputName = keyof typeof allOutputs;

function schemaName(name: SchemaOutputName): string {
  return name.replace(/\.json$/, '').replace(/(^|-)([a-z])/g, (_match, _prefix: string, char: string) =>
    char.toUpperCase(),
  );
}

function render(name: SchemaOutputName): string {
  const schema = zodToJsonSchema(allSchemas[name], {
    name: schemaName(name),
    target: 'jsonSchema7',
  });
  return `${JSON.stringify(schema, null, 2)}\n`;
}

function firstDiffLine(left: string, right: string): string {
  const leftLines = left.split(/\r?\n/);
  const rightLines = right.split(/\r?\n/);
  const length = Math.max(leftLines.length, rightLines.length);
  for (let index = 0; index < length; index += 1) {
    if (leftLines[index] !== rightLines[index]) {
      return `line ${index + 1}\n- ${leftLines[index] ?? ''}\n+ ${rightLines[index] ?? ''}`;
    }
  }
  return 'unknown diff';
}

let drift = false;
for (const name of Object.keys(allOutputs) as SchemaOutputName[]) {
  const filePath = resolve(allOutputs[name]);
  const generated = render(name);
  if (mode === 'write') {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, generated, 'utf8');
    process.stdout.write(`wrote ${allOutputs[name]}\n`);
    continue;
  }

  const current = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  if (current !== generated) {
    drift = true;
    process.stderr.write(`schema drift: ${allOutputs[name]}\n${firstDiffLine(current, generated)}\n`);
  }
}

process.exit(drift ? 1 : 0);
