#!/usr/bin/env node

import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, statSync, watch as fsWatch } from 'node:fs';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { openExternalTarget } from './lib/browser-open.mjs';
import { renderIconSvg, renderShellHtml } from './lib/dashboard-template.mjs';

const DEFAULT_PORT = 5175;
const DEFAULT_HOST = '127.0.0.1';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAILY_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
const WATCH_DEBOUNCE_MS = 150;
const POLL_MS = 2_000;
const HEARTBEAT_MS = 20_000;

function rootDir() {
  return process.env.VIBE_ROOT ? path.resolve(process.env.VIBE_ROOT) : process.cwd();
}

function agentDir(root) {
  return path.join(root, '.vibe', 'agent');
}

function pidPath(root) {
  return path.join(agentDir(root), 'dashboard.pid');
}

function parseArgs(argv) {
  const flags = {
    port: null,
    host: null,
    noOpen: false,
    detach: false,
    stop: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--port') {
      flags.port = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--host') {
      flags.host = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token === '--no-open') {
      flags.noOpen = true;
      continue;
    }
    if (token === '--detach') {
      flags.detach = true;
      continue;
    }
    if (token === '--stop') {
      flags.stop = true;
    }
  }
  return flags;
}

async function readOptionalText(filePath, fallback = '') {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

async function readOptionalJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTemplateProjectStatus(root, status) {
  return (
    isRecord(status) &&
    isRecord(status.project) &&
    status.project.name === 'vibe-doctor' &&
    path.basename(root).toLowerCase() !== 'vibe-doctor'
  );
}

function isTemplateProductState(root, productMd) {
  return path.basename(root).toLowerCase() !== 'vibe-doctor' && /PROJECT NOT INITIALIZED/im.test(productMd);
}

function emptyIteration() {
  return {
    currentIteration: null,
    iterations: [],
  };
}

function normalizeSprintStatusForDisplay(root, status) {
  if (!isTemplateProjectStatus(root, status)) {
    return status;
  }

  return {
    ...status,
    handoff: {
      ...(isRecord(status.handoff) ? status.handoff : {}),
      currentSprintId: 'idle',
    },
    sprints: [],
    pendingRisks: [],
  };
}

function utcDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function isValidDateShard(date) {
  if (!DATE_RE.test(date)) {
    return false;
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function readPidText(text) {
  const pid = Number(text.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

async function readPid(root) {
  try {
    return readPidText(await readFile(pidPath(root), 'utf8'));
  } catch {
    return null;
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopDashboard(root) {
  const pid = await readPid(root);
  if (!pid) {
    process.stdout.write('dashboard not running\n');
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // stale pid is still cleaned below
  }
  await unlink(pidPath(root)).catch(() => {});
  process.stdout.write(`dashboard stopped pid=${pid}\n`);
}

export function openBrowser(url, spawnFn = spawn, platform = process.platform, stderr = process.stderr) {
  openExternalTarget(url, 'dashboard', spawnFn, platform, stderr);
}

async function resolveConfig(root) {
  const config = await readOptionalJson(path.join(root, '.vibe', 'config.json'), {});
  return isRecord(config?.dashboard) ? config.dashboard : {};
}

async function resolveHostPort(root, flags) {
  const dashboard = await resolveConfig(root);
  const host = flags.host ?? (typeof dashboard.host === 'string' ? dashboard.host : DEFAULT_HOST);
  const configPort = Number(dashboard.port);
  const port = flags.port ?? (Number.isInteger(configPort) ? configPort : DEFAULT_PORT);
  return { host, port };
}

function parseRoadmapPointer(roadmapMd) {
  const marker = roadmapMd.match(
    /<!-- BEGIN:VIBE:CURRENT-SPRINT -->[\s\S]*?Current\*\*:\s*([^\s(]+)[\s\S]*?<!-- END:VIBE:CURRENT-SPRINT -->/,
  );
  return marker?.[1] ?? null;
}

function parseRoadmapSprintIds(roadmapMd) {
  const ids = [];
  const directMatches = roadmapMd.matchAll(/-\s+\*\*id\*\*:\s+`([^`]+)`/g);
  for (const match of directMatches) {
    if (match[1]) {
      ids.push(match[1]);
    }
  }
  if (ids.length > 0) {
    return [...new Set(ids)];
  }
  return [...roadmapMd.matchAll(/\b(sprint-[A-Za-z0-9_.-]+|M\d+[A-Za-z0-9_.-]*)\b/g)]
    .map((match) => match[1])
    .filter(Boolean);
}

function sprintState(sprintId, status, currentSprintId) {
  const entry = Array.isArray(status?.sprints)
    ? status.sprints.find((sprint) => sprint?.id === sprintId)
    : null;
  if (entry?.status === 'passed' || entry?.status === 'failed') {
    return entry.status;
  }
  if (entry?.status === 'in_progress' || sprintId === currentSprintId) {
    return 'in-progress';
  }
  return 'pending';
}

function parsePhases(productMd, handoffMd) {
  const haystack = `${productMd}\n${handoffMd}`.toLowerCase();
  return ['0', '1', '2', '3', '4'].map((phase) => {
    const complete = haystack.includes(`phase ${phase}`) && /complete|completed|sealed|done|idle/.test(haystack);
    const active = haystack.includes(`phase ${phase}`) && !complete;
    return {
      id: `Phase ${phase}`,
      state: complete ? 'complete' : active ? 'active' : 'pending',
    };
  });
}

async function listAvailableDates(root) {
  try {
    return (await readdir(path.join(agentDir(root), 'daily')))
      .map((entry) => entry.match(DAILY_FILE_RE)?.[1])
      .filter(Boolean)
      .sort((left, right) => right.localeCompare(left));
  } catch {
    return [];
  }
}

function parseJsonl(raw) {
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function readDaily(root, date, limit = 500) {
  const raw = await readFile(path.join(agentDir(root), 'daily', `${date}.jsonl`), 'utf8');
  const events = parseJsonl(raw);
  const truncated = events.length > limit;
  return { date, events: events.slice(-limit), truncated };
}

async function readAttention(root, sinceIso = null) {
  const raw = await readOptionalText(path.join(agentDir(root), 'attention.jsonl'), '');
  const since = sinceIso ? Date.parse(sinceIso) : Date.now() - 24 * 60 * 60 * 1_000;
  return parseJsonl(raw).filter((event) => {
    const ts = Date.parse(String(event?.ts ?? ''));
    return Number.isFinite(ts) && ts >= since;
  });
}

function latestTestResult(todayEvents) {
  const latest = [...todayEvents]
    .reverse()
    .find((event) => event?.type === 'test-failed' || event?.type === 'sprint-completed');
  if (!latest) {
    return null;
  }
  return {
    type: latest.type,
    ts: latest.ts,
    summary: summarizeEvent(latest),
  };
}

function summarizeEvent(event) {
  const payload = isRecord(event?.payload) ? event.payload : {};
  if (typeof payload.summary === 'string') {
    return payload.summary;
  }
  if (typeof payload.detail === 'string') {
    return payload.detail;
  }
  if (typeof payload.title === 'string') {
    return payload.title;
  }
  if (typeof payload.sprintId === 'string') {
    return `${payload.sprintId} ${payload.status ?? ''}`.trim();
  }
  if (typeof payload.phase === 'string') {
    return `${payload.phase} ${payload.ambiguity ?? ''}`.trim();
  }
  if (typeof event?.type === 'string') {
    return event.type;
  }
  return 'event';
}

async function buildState(root) {
  const [
    rawSprintStatus,
    handoffMd,
    rawIteration,
    tokens,
    rawRoadmapMd,
    rawProductMd,
    todayEventsResult,
  ] = await Promise.all([
    readOptionalJson(path.join(agentDir(root), 'sprint-status.json'), {}),
    readOptionalText(path.join(agentDir(root), 'handoff.md'), ''),
    readOptionalJson(path.join(agentDir(root), 'iteration-history.json'), emptyIteration()),
    readOptionalJson(path.join(agentDir(root), 'tokens.json'), {}),
    readOptionalText(path.join(root, 'docs', 'plans', 'sprint-roadmap.md'), ''),
    readOptionalText(path.join(root, 'docs', 'context', 'product.md'), ''),
    readDaily(root, utcDate(), 50).catch(() => ({ date: utcDate(), events: [], truncated: false })),
  ]);
  const templateState = isTemplateProjectStatus(root, rawSprintStatus) || isTemplateProductState(root, rawProductMd);
  const sprintStatus = normalizeSprintStatusForDisplay(root, rawSprintStatus);
  const roadmapMd = templateState ? '' : rawRoadmapMd;
  const iteration = templateState ? emptyIteration() : rawIteration;
  const handoffText = templateState ? '' : handoffMd;
  const productMd = templateState ? '' : rawProductMd;
  const currentSprint =
    sprintStatus?.handoff?.currentSprintId ??
    parseRoadmapPointer(roadmapMd) ??
    'idle';
  const roadmapIds = parseRoadmapSprintIds(roadmapMd);
  const sprintIds =
    roadmapIds.length > 0
      ? roadmapIds
      : Array.isArray(sprintStatus?.sprints)
        ? sprintStatus.sprints.map((entry) => entry.id).filter(Boolean)
        : [];
  const sprintNodes = sprintIds.map((id) => ({
    id,
    state: sprintState(id, sprintStatus, currentSprint),
  }));
  const risks = Array.isArray(sprintStatus?.pendingRisks)
    ? sprintStatus.pendingRisks.filter((risk) => risk?.status === 'open')
    : [];
  return {
    roadmap: {
      current: currentSprint,
      phases: parsePhases(productMd, handoffText),
      sprints: sprintNodes,
    },
    currentSprint: {
      id: currentSprint,
      status:
        Array.isArray(sprintStatus?.sprints)
          ? sprintStatus.sprints.find((entry) => entry?.id === currentSprint)?.status ?? 'idle'
          : 'idle',
      startedAt:
        Array.isArray(sprintStatus?.sprints)
          ? sprintStatus.sprints.find((entry) => entry?.id === currentSprint)?.startedAt ?? null
          : null,
    },
    iteration,
    todayEvents: todayEventsResult.events,
    risks,
    tokens,
    latestTest: latestTestResult(todayEventsResult.events),
    updatedAt: new Date().toISOString(),
  };
}

function jsonResponse(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

function textResponse(response, status, value, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
  });
  response.end(value);
}

function sseSend(response, event, data) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

class DashboardEvents {
  constructor(root) {
    this.root = root;
    this.clients = new Set();
    this.watchers = [];
    this.pollTimer = null;
    this.debounce = new Map();
    this.statCache = new Map();
    this.attentionOffset = 0;
  }

  async init() {
    const attentionPath = path.join(agentDir(this.root), 'attention.jsonl');
    if (existsSync(attentionPath)) {
      this.attentionOffset = statSync(attentionPath).size;
    }
    await mkdir(path.join(agentDir(this.root), 'daily'), { recursive: true }).catch(() => {});
    this.setupWatchers();
  }

  addClient(response) {
    this.clients.add(response);
    response.write(': ping\n\n');
    const timer = setInterval(() => {
      response.write(': ping\n\n');
    }, HEARTBEAT_MS);
    response.on('close', () => {
      clearInterval(timer);
      this.clients.delete(response);
    });
  }

  emitState(files) {
    for (const client of this.clients) {
      sseSend(client, 'state-updated', { files });
    }
  }

  emitAttention(event) {
    for (const client of this.clients) {
      sseSend(client, 'attention', event);
    }
  }

  schedule(file) {
    clearTimeout(this.debounce.get(file));
    const timer = setTimeout(() => {
      this.debounce.delete(file);
      this.emitState([file]);
      if (file.endsWith('attention.jsonl')) {
        this.emitNewAttention().catch((error) => {
          process.stderr.write(`dashboard attention watch failed: ${error.message}\n`);
        });
      }
    }, WATCH_DEBOUNCE_MS);
    this.debounce.set(file, timer);
  }

  setupWatchers() {
    const targets = [
      agentDir(this.root),
      path.join(agentDir(this.root), 'sprint-status.json'),
      path.join(agentDir(this.root), 'handoff.md'),
      path.join(agentDir(this.root), 'iteration-history.json'),
      path.join(agentDir(this.root), 'tokens.json'),
      path.join(agentDir(this.root), 'attention.jsonl'),
      path.join(agentDir(this.root), 'daily'),
      path.join(this.root, 'docs', 'plans', 'sprint-roadmap.md'),
    ];
    try {
      for (const target of targets) {
        if (!existsSync(target)) {
          continue;
        }
        const watcher = fsWatch(target, () => {
          if (target === agentDir(this.root)) {
            this.schedule('attention.jsonl');
            return;
          }
          this.schedule(path.relative(agentDir(this.root), target).replace(/\\/g, '/'));
        });
        watcher.on('error', () => this.setupPolling(targets));
        this.watchers.push(watcher);
      }
      if (this.watchers.length === 0) {
        this.setupPolling(targets);
      }
    } catch {
      this.setupPolling(targets);
    }
  }

  setupPolling(targets) {
    if (this.pollTimer) {
      return;
    }
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
    this.pollTimer = setInterval(async () => {
      for (const target of targets) {
        try {
          const current = await stat(target);
          const key = target;
          const previous = this.statCache.get(key);
          const label =
            target === agentDir(this.root)
              ? 'attention.jsonl'
              : path.relative(agentDir(this.root), target).replace(/\\/g, '/');
          if (previous !== undefined && previous !== current.mtimeMs) {
            this.schedule(label);
          } else if (
            previous === undefined &&
            target.endsWith('attention.jsonl') &&
            current.size > this.attentionOffset
          ) {
            this.schedule(label);
          }
          this.statCache.set(key, current.mtimeMs);
        } catch {
          // Missing files are normal before the first sprint event.
        }
      }
    }, POLL_MS);
  }

  async emitNewAttention() {
    const filePath = path.join(agentDir(this.root), 'attention.jsonl');
    const raw = await readOptionalText(filePath, '');
    const next = raw.slice(this.attentionOffset);
    this.attentionOffset = Buffer.byteLength(raw, 'utf8');
    for (const event of parseJsonl(next)) {
      this.emitAttention(event);
    }
  }

  close() {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    for (const client of this.clients) {
      client.write('retry: 0\n\n');
      client.end();
    }
    this.clients.clear();
  }
}

async function handleRequest(root, events, request, response) {
  if (request.method !== 'GET') {
    textResponse(response, 405, 'method not allowed');
    return;
  }
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/') {
    textResponse(response, 200, renderShellHtml(), 'text/html; charset=utf-8');
    return;
  }
  if (url.pathname === '/icon.svg') {
    textResponse(response, 200, renderIconSvg(), 'image/svg+xml; charset=utf-8');
    return;
  }
  if (url.pathname === '/api/state') {
    jsonResponse(response, 200, await buildState(root));
    return;
  }
  if (url.pathname === '/api/daily-index') {
    jsonResponse(response, 200, { dates: await listAvailableDates(root) });
    return;
  }
  if (url.pathname.startsWith('/api/daily/')) {
    const date = decodeURIComponent(url.pathname.slice('/api/daily/'.length));
    if (!isValidDateShard(date)) {
      jsonResponse(response, 400, { error: 'invalid date' });
      return;
    }
    try {
      jsonResponse(response, 200, await readDaily(root, date, 500));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        jsonResponse(response, 404, { error: 'daily log not found' });
        return;
      }
      throw error;
    }
    return;
  }
  if (url.pathname === '/api/attention') {
    jsonResponse(response, 200, { events: await readAttention(root, url.searchParams.get('since')) });
    return;
  }
  if (url.pathname === '/events') {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    events.addClient(response);
    return;
  }
  jsonResponse(response, 404, { error: 'not found' });
}

async function listenWithPortDiscovery(server, host, requestedPort) {
  for (let offset = 0; offset <= 10; offset += 1) {
    const port = requestedPort + offset;
    const result = await new Promise((resolve) => {
      const onError = (error) => {
        server.off('listening', onListening);
        resolve({ ok: false, error });
      };
      const onListening = () => {
        server.off('error', onError);
        resolve({ ok: true, port });
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
    if (result.ok) {
      return result.port;
    }
    if (result.error?.code !== 'EADDRINUSE') {
      throw result.error;
    }
  }
  throw new Error(`port unavailable: ${requestedPort}..${requestedPort + 10}`);
}

export async function runDashboard(argv = process.argv.slice(2), options = {}) {
  const root = path.resolve(options.root ?? rootDir());
  const flags = parseArgs(argv);
  const { host, port } = await resolveHostPort(root, flags);
  if (host !== '127.0.0.1' && host !== 'localhost') {
    process.stderr.write('localhost only: dashboard refuses non-localhost bind addresses\n');
    return 1;
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    process.stderr.write(`invalid port: ${port}\n`);
    return 1;
  }
  if (flags.stop) {
    await stopDashboard(root);
    return 0;
  }

  const existingPid = await readPid(root);
  if (existingPid && existingPid !== process.pid && processAlive(existingPid)) {
    process.stdout.write(`dashboard already running at http://127.0.0.1:${port}\n`);
    return 0;
  }
  if (existingPid && existingPid !== process.pid) {
    await unlink(pidPath(root)).catch(() => {});
  }

  if (flags.detach) {
    const childArgs = process.argv
      .slice(1)
      .filter((arg) => arg !== '--detach');
    const child = spawn(process.execPath, childArgs, {
      cwd: root,
      env: { ...process.env, VIBE_ROOT: root },
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    if (child.pid) {
      await mkdir(agentDir(root), { recursive: true });
      await writeFile(pidPath(root), `${child.pid}\n`, 'utf8');
    }
    process.stdout.write(`dashboard starting pid=${child.pid ?? 'unknown'}\n`);
    return 0;
  }

  const sse = new DashboardEvents(root);
  await sse.init();
  const server = http.createServer((request, response) => {
    handleRequest(root, sse, request, response).catch((error) => {
      jsonResponse(response, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
  const actualPort = await listenWithPortDiscovery(server, host, port);
  await mkdir(agentDir(root), { recursive: true });
  await writeFile(pidPath(root), `${process.pid}\n`, 'utf8');

  const url = `http://127.0.0.1:${actualPort}`;
  process.stdout.write(`${url}\n`);
  if (!flags.noOpen) {
    openBrowser(url);
  }

  const shutdown = () => {
    sse.close();
    server.close(() => {
      unlink(pidPath(root)).catch(() => {}).finally(() => process.exit(0));
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return 0;
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href) {
  runDashboard().then((code) => {
    if (code !== 0) {
      process.exit(code);
    }
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
