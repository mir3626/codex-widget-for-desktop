import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = parseArgs(process.argv.slice(2));
const dbPath = args.db ?? join(process.env.LOCALAPPDATA ?? process.env.APPDATA ?? process.cwd(), "Codex Widget", "codex-widget.sqlite");
if (!existsSync(dbPath)) {
  throw new Error(`Widget storage DB not found: ${dbPath}`);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const session = args.session
  ? db.prepare("SELECT * FROM sessions WHERE id = ?").get(args.session)
  : db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC LIMIT 1").get();
if (!session) {
  throw new Error(args.session ? `Session not found: ${args.session}` : "No widget sessions found.");
}

const since = args.since ?? session.created_at;
const messages = db.prepare(`
  SELECT role, status, content_text, created_at, completed_at
  FROM messages
  WHERE session_id = ? AND created_at >= ?
  ORDER BY created_at ASC
`).all(session.id, since);
const evalRuns = db.prepare(`
  SELECT id, prompt, status, task_success, failure_class, started_at, completed_at, elapsed_ms, metrics_json
  FROM computer_use_eval_runs
  WHERE session_id = ? AND started_at >= ?
  ORDER BY started_at ASC
`).all(session.id, since);
const activityCounts = db.prepare(`
  SELECT category, level, COUNT(*) AS count
  FROM activity_log
  WHERE session_id = ? AND created_at >= ?
  GROUP BY category, level
  ORDER BY category, level
`).all(session.id, since);
const browserActionStats = summarizeBrowserActionActivity(session.id, since);
const toolCommands = db.prepare(`
  SELECT created_at, summary
  FROM activity_log
  WHERE session_id = ? AND created_at >= ? AND category = 'tool'
  ORDER BY created_at ASC
`).all(session.id, since);

const report = {
  schemaVersion: "real-use-widget-session-audit.v1",
  dbPath,
  session: {
    id: session.id,
    title: session.title,
    status: session.status,
    activeMode: session.active_mode,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    since
  },
  messages: summarizeMessages(messages),
  evalRuns: summarizeEvalRuns(evalRuns),
  browserAction: browserActionStats,
  activityCounts,
  toolCommands: summarizeToolCommands(toolCommands),
  findings: buildFindings({ evalRuns, browserActionStats, toolCommands })
};

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printMarkdown(report);
}

function summarizeMessages(rows) {
  return {
    total: rows.length,
    realUser: rows.filter((row) => row.role === "user" && !String(row.content_text ?? "").startsWith("Vision Context:")).length,
    syntheticUser: rows.filter((row) => row.role === "user" && String(row.content_text ?? "").startsWith("Vision Context:")).length,
    assistantComplete: rows.filter((row) => row.role === "assistant" && row.status === "complete").length,
    assistantCancelled: rows.filter((row) => row.role === "assistant" && row.status === "cancelled").length,
    latestTurns: rows
      .filter((row) => row.role !== "user" || !String(row.content_text ?? "").startsWith("Vision Context:"))
      .slice(-12)
      .map((row) => ({
        createdAt: row.created_at,
        role: row.role,
        status: row.status,
        text: String(row.content_text ?? "").replace(/\s+/g, " ").slice(0, 280)
      }))
  };
}

function summarizeEvalRuns(rows) {
  const counts = {};
  const failures = {};
  for (const row of rows) {
    counts[row.task_success] = (counts[row.task_success] ?? 0) + 1;
    failures[row.failure_class] = (failures[row.failure_class] ?? 0) + 1;
  }
  return {
    total: rows.length,
    taskSuccess: counts,
    failureClass: failures,
    runs: rows.map((row) => ({
      id: row.id,
      startedAt: row.started_at,
      status: row.status,
      taskSuccess: row.task_success,
      failureClass: row.failure_class,
      elapsedMs: row.elapsed_ms,
      metrics: safeJson(row.metrics_json, {}),
      prompt: String(row.prompt ?? "").replace(/\s+/g, " ").slice(0, 220)
    }))
  };
}

function summarizeBrowserActionActivity(sessionId, since) {
  const rows = db.prepare(`
    SELECT created_at, summary, detail_json
    FROM activity_log
    WHERE session_id = ? AND created_at >= ? AND category = 'browser-action'
    ORDER BY created_at ASC
  `).all(sessionId, since);
  const stats = {
    started: 0,
    pending: 0,
    succeeded: 0,
    completedAfterExtension: 0,
    failed: 0,
    needsClarification: 0,
    debugBundles: 0
  };
  for (const row of rows) {
    if (/started/i.test(row.summary)) stats.started += 1;
    if (/pending/i.test(row.summary)) stats.pending += 1;
    if (/succeeded/i.test(row.summary)) stats.succeeded += 1;
    if (/completed after extension/i.test(row.summary)) stats.completedAfterExtension += 1;
    if (/failed/i.test(row.summary)) stats.failed += 1;
    if (String(row.detail_json ?? "").includes("needs_clarification")) stats.needsClarification += 1;
    if (/debug bundle/i.test(row.summary)) stats.debugBundles += 1;
  }
  return {
    ...stats,
    events: rows
      .filter((row) => /started|pending|succeeded|completed after extension|failed|debug bundle|timing summary/i.test(row.summary))
      .slice(-20)
      .map((row) => ({
        createdAt: row.created_at,
        summary: row.summary,
        detail: String(row.detail_json ?? "{}").replace(/\s+/g, " ").slice(0, 240)
      }))
  };
}

function summarizeToolCommands(rows) {
  const powershell = rows.filter((row) => /powershell|pwsh|npm\.ps1/i.test(row.summary));
  return {
    total: rows.length,
    powershellLike: powershell.length,
    recentPowershellLike: powershell.slice(-12).map((row) => ({
      createdAt: row.created_at,
      summary: row.summary.replace(/\s+/g, " ").slice(0, 300)
    }))
  };
}

function buildFindings({ evalRuns, browserActionStats, toolCommands }) {
  const findings = [];
  const failedEvalRuns = evalRuns.filter((run) => run.task_success === "failed");
  if (browserActionStats.succeeded > 0 && failedEvalRuns.length > 0) {
    findings.push({
      severity: "high",
      title: "Browser Action success/eval mismatch",
      detail: `${browserActionStats.succeeded} Browser Action success event(s) were present while ${failedEvalRuns.length} eval run(s) were failed.`
    });
  }
  const npmLike = toolCommands.filter((row) => /npm\.ps1/i.test(row.summary));
  if (npmLike.length === 0) {
    findings.push({
      severity: "info",
      title: "No npm.ps1 tool invocation logged in the selected range",
      detail: "The selected widget session range did not include a tool activity summary containing npm.ps1."
    });
  }
  return findings;
}

function printMarkdown(report) {
  console.log(`# Real-Use Widget Session Audit`);
  console.log(`- DB: ${report.dbPath}`);
  console.log(`- Session: ${report.session.title} (${report.session.id})`);
  console.log(`- Range: ${report.session.since} -> ${report.session.updatedAt}`);
  console.log(`- Messages: ${report.messages.total} total, ${report.messages.realUser} real user, ${report.messages.assistantComplete} assistant complete, ${report.messages.assistantCancelled} cancelled`);
  console.log(`- Eval runs: ${report.evalRuns.total} ${JSON.stringify(report.evalRuns.taskSuccess)}`);
  console.log(`- Browser Action: ${JSON.stringify({
    started: report.browserAction.started,
    succeeded: report.browserAction.succeeded,
    completedAfterExtension: report.browserAction.completedAfterExtension,
    needsClarification: report.browserAction.needsClarification,
    debugBundles: report.browserAction.debugBundles
  })}`);
  console.log(`- Tool commands: ${report.toolCommands.total}, PowerShell/npm-like: ${report.toolCommands.powershellLike}`);
  if (report.findings.length) {
    console.log(`\n## Findings`);
    for (const finding of report.findings) {
      console.log(`- [${finding.severity}] ${finding.title}: ${finding.detail}`);
    }
  }
  console.log(`\n## Latest Turns`);
  for (const turn of report.messages.latestTurns) {
    console.log(`- ${turn.createdAt} ${turn.role}/${turn.status}: ${turn.text}`);
  }
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--db") {
      parsed.db = argv[++index];
    } else if (arg === "--session") {
      parsed.session = argv[++index];
    } else if (arg === "--since") {
      parsed.since = argv[++index];
    }
  }
  return parsed;
}
