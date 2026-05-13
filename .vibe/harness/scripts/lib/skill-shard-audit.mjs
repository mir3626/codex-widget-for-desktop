import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export function parseShardAuditArgs(argv, usage) {
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
      process.stdout.write(`${usage}\n`);
      process.exit(0);
    }
  }

  if (!['text', 'json'].includes(options.format)) {
    throw new Error(`unsupported --format: ${options.format}`);
  }

  return options;
}

export function toPosix(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function readText(root, relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

export function countMatches(text, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);
  return Array.from(text.matchAll(globalPattern)).length;
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractShardBlock(mainText, shardBlockBegin, shardBlockEnd, invalidMessage) {
  const begin = mainText.indexOf(shardBlockBegin);
  const end = mainText.indexOf(shardBlockEnd);
  if (begin === -1 && end === -1) {
    return null;
  }
  if (begin === -1 || end === -1 || end <= begin) {
    throw new Error(invalidMessage);
  }
  return mainText.slice(begin + shardBlockBegin.length, end);
}

export function extractShardPaths(block) {
  const paths = new Set();
  const pathPattern = /`([^`]+\.md)`|\(([^)]+\.md)\)/g;
  for (const match of block.matchAll(pathPattern)) {
    const rawPath = match[1] ?? match[2] ?? '';
    const normalized = toPosix(rawPath.trim());
    if (normalized.length > 0) {
      paths.add(normalized);
    }
  }
  return [...paths];
}

export function listShardFiles(root, shardDir) {
  const absoluteDir = path.join(root, shardDir);
  if (!existsSync(absoluteDir)) {
    return [];
  }

  return readdirSync(absoluteDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => `${shardDir}/${entry.name}`)
    .sort((left, right) => left.localeCompare(right));
}

export function validateShardPath(root, shardPath, shardDir, shardLabel) {
  if (shardPath.includes('..') || path.isAbsolute(shardPath)) {
    return 'unsafe shard path';
  }
  if (!shardPath.startsWith(`${shardDir}/`)) {
    return `${shardLabel} shard must live under ${shardDir}`;
  }
  if (!existsSync(path.join(root, shardPath))) {
    return 'missing shard file';
  }
  return null;
}

export function buildShardAuditBase({
  root,
  skillPath,
  shardDir,
  shardBlockBegin,
  shardBlockEnd,
  invalidBlockMessage,
  shardLabel,
}) {
  const findings = [];
  const skillExists = existsSync(path.join(root, skillPath));
  if (!skillExists) {
    return {
      ok: false,
      mode: 'missing',
      skillPath,
      shardBlockPresent: false,
      shardPaths: [],
      discoveredShards: [],
      effectiveText: '',
      findings: [{ severity: 'error', id: 'skill-missing', detail: `${skillPath} is missing` }],
    };
  }

  const mainText = readText(root, skillPath);
  const block = extractShardBlock(mainText, shardBlockBegin, shardBlockEnd, invalidBlockMessage);
  const listedShardPaths = block ? extractShardPaths(block) : [];
  const discoveredShards = listShardFiles(root, shardDir);
  const mode = listedShardPaths.length > 0 ? 'sharded' : 'monolith';

  if (block && listedShardPaths.length === 0) {
    findings.push({ severity: 'error', id: 'empty-shard-block', detail: `${shardBlockBegin} contains no markdown shard paths` });
  }

  for (const shardPath of listedShardPaths) {
    const validation = validateShardPath(root, shardPath, shardDir, shardLabel);
    if (validation) {
      findings.push({ severity: 'error', id: 'invalid-shard-path', path: shardPath, detail: validation });
    }
  }

  for (const shardPath of discoveredShards) {
    if (!listedShardPaths.includes(shardPath)) {
      findings.push({ severity: 'error', id: `unlisted-${shardLabel}-shard`, path: shardPath, detail: `${shardLabel} shard exists but is not listed in the main skill shard block` });
    }
  }

  if (!block && discoveredShards.length > 0) {
    findings.push({ severity: 'error', id: 'missing-shard-block', detail: `${shardDir} exists but ${skillPath} has no ${shardLabel} shard marker block` });
  }

  const orderedParts = [{ path: skillPath, text: mainText }];
  for (const shardPath of listedShardPaths) {
    if (existsSync(path.join(root, shardPath))) {
      orderedParts.push({ path: shardPath, text: readText(root, shardPath) });
    }
  }
  const effectiveText = orderedParts.map((part) => `\n<!-- Source: ${part.path} -->\n${part.text}`).join('\n');

  return {
    ok: findings.length === 0,
    mode,
    skillPath,
    shardBlockPresent: block !== null,
    shardPaths: listedShardPaths,
    discoveredShards,
    effectiveText,
    findings,
  };
}

export function runShardAuditCli({ argv, usage, commandName, audit, printText }) {
  try {
    const options = parseShardAuditArgs(argv, usage);
    const report = audit(path.resolve(options.root));
    if (options.format === 'json') {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printText(report);
    }
    process.exit(report.ok ? 0 : 1);
  } catch (error) {
    process.stderr.write(`[${commandName}] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
