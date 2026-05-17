import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = parseArgs(process.argv.slice(2));
if (args.selfTest) {
  runSelfTest();
  process.exit(0);
}

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

const sinceInput = args.since ?? session.created_at;
const since = normalizeSinceTimestamp(sinceInput);
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
const debugFeedback = summarizeDebugFeedback(session.id, since);
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
    sinceInput,
    since
  },
  messages: summarizeMessages(messages),
  evalRuns: summarizeEvalRuns(evalRuns),
  browserAction: browserActionStats,
  debugFeedback,
  activityCounts,
  toolCommands: summarizeToolCommands(toolCommands),
  findings: buildFindings({ evalRuns, browserActionStats, debugFeedback, toolCommands })
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

function summarizeDebugFeedback(sessionId, since) {
  const rows = db.prepare(`
    SELECT created_at, summary, detail_json
    FROM activity_log
    WHERE session_id = ? AND created_at >= ? AND category = 'debug-feedback'
    ORDER BY created_at ASC
  `).all(sessionId, since);
  return {
    total: rows.length,
    manualDebug: rows.filter((row) => String(row.detail_json ?? "").includes("manual-debug")).length,
    entries: rows.map((row) => {
      const detail = safeJson(row.detail_json, {});
      return {
        createdAt: row.created_at,
        messageId: typeof detail.messageId === "string" ? detail.messageId : undefined,
        outcome: readDebugFeedbackOutcome(detail),
        reason: String(detail.reason ?? row.summary ?? "").replace(/\s+/g, " ").slice(0, 300),
        userText: String(detail.userText ?? "").replace(/\s+/g, " ").slice(0, 220),
        assistantText: String(detail.assistantText ?? "").replace(/\s+/g, " ").slice(0, 220),
        tags: Array.isArray(detail.tags) ? detail.tags.slice(0, 8) : []
      };
    })
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

function buildFindings({ evalRuns, browserActionStats, debugFeedback, toolCommands }) {
  const findings = [];
  const failedEvalRuns = evalRuns.filter((run) => run.task_success === "failed");
  if (browserActionStats.succeeded > 0 && failedEvalRuns.length > 0) {
    findings.push({
      severity: "high",
      title: "Browser Action success/eval mismatch",
      detail: `${browserActionStats.succeeded} Browser Action success event(s) were present while ${failedEvalRuns.length} eval run(s) were failed.`
    });
  }
  const passedRuns = evalRuns.filter((run) => run.task_success === "passed");
  const negativeFeedback = debugFeedback.entries.filter((entry) => isNegativeDebugFeedbackOutcome(entry.outcome));
  const feedbackOnPassedRuns = negativeFeedback.filter((entry) =>
    passedRuns.some((run) => debugFeedbackMatchesEvalRun(entry, run, evalRuns))
  );
  if (feedbackOnPassedRuns.length > 0) {
    findings.push({
      severity: "high",
      title: "Manual debug feedback contradicts passed eval runs",
      detail: `${feedbackOnPassedRuns.length} manual debug note(s) matched prompt(s) that the eval ledger marked passed. Treat these as verifier false positives until replayed.`
    });
  }
  if (debugFeedback.total > 0 && browserActionStats.debugBundles === 0) {
    findings.push({
      severity: "medium",
      title: "Manual debug feedback lacks Browser Action debug bundles",
      detail: `${debugFeedback.total} manual debug note(s) were present, but no Browser Action debug bundle activity was recorded in the selected range.`
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
  console.log(`- Debug feedback: ${report.debugFeedback.total} total, ${report.debugFeedback.manualDebug} manual-debug`);
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
  if (report.debugFeedback.entries.length) {
    console.log(`\n## Debug Feedback`);
    for (const entry of report.debugFeedback.entries.slice(-10)) {
      console.log(`- ${entry.createdAt}: ${entry.userText} :: ${entry.reason}`);
    }
  }
}

function normalizePrompt(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeSinceTimestamp(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return text;
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    return text;
  }
  return new Date(parsed).toISOString();
}

function readDebugFeedbackOutcome(detail) {
  if (detail.outcome === "success" ||
    detail.outcome === "failure" ||
    detail.outcome === "partial" ||
    detail.outcome === "ux_issue" ||
    detail.outcome === "unknown") {
    return detail.outcome;
  }
  return classifyDebugFeedbackOutcome(detail.reason, detail.assistantText);
}

function classifyDebugFeedbackOutcome(reason, assistantText) {
  const reasonText = normalizePrompt(reason);
  const combinedText = `${reasonText} ${normalizePrompt(assistantText)}`;
  const successPattern = /(정상적으로\s*동작|완전한\s*성공|최종적으로는?.{0,40}성공|결과적으로.{0,40}성공|success|succeeded|worked)/i;
  const uxPattern = /(fallback|폴백|과다|정확|background|백그라운드|직접\s*마우스|개선|느림|지연|UX|사용성)/i;
  const partialPattern = /(부분|partial|의도는\s*파악|fallback|폴백)/i;
  const failurePattern = /((?:polling|pooling)\s*실패|동작\s*수행\s*실패|실패|failed|not\s+work|안\s*됨|못\s*함|잘못|엉뚱|가버림|달라고\s*했는데|했는데.*(?:누름|열림|이동)|대신|다른\s*(?:페이지|탭|대상)|wrong)/i;

  if (successPattern.test(reasonText)) {
    return uxPattern.test(reasonText) ? "ux_issue" : "success";
  }
  if (failurePattern.test(reasonText) && partialPattern.test(reasonText)) {
    return "partial";
  }
  if (failurePattern.test(reasonText)) {
    return "failure";
  }
  if (partialPattern.test(reasonText) && failurePattern.test(combinedText)) {
    return "partial";
  }
  if (uxPattern.test(reasonText)) {
    return "ux_issue";
  }
  if (failurePattern.test(combinedText) && !successPattern.test(combinedText)) {
    return "failure";
  }
  return "unknown";
}

function isNegativeDebugFeedbackOutcome(outcome) {
  return outcome === "failure" || outcome === "partial";
}

function debugFeedbackMatchesEvalRun(entry, run, allRuns) {
  const requestIds = readEvalRunRequestIds(run);
  if (entry.messageId && requestIds.size > 0) {
    return requestIds.has(entry.messageId);
  }
  const prompt = normalizePrompt(entry.userText);
  if (!prompt || normalizePrompt(run.prompt) !== prompt) {
    return false;
  }
  const samePromptRuns = allRuns.filter((candidate) => normalizePrompt(candidate.prompt) === prompt);
  return samePromptRuns.length === 1;
}

function readEvalRunRequestIds(run) {
  const metrics = safeJson(run.metrics_json, {});
  const ids = new Set();
  for (const value of [
    metrics.requestId,
    metrics.messageId,
    metrics.actionSessionId,
    metrics.transactionId
  ]) {
    if (typeof value === "string" && value.trim()) {
      ids.add(value.trim());
    }
  }
  return ids;
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
    } else if (arg === "--self-test") {
      parsed.selfTest = true;
    }
  }
  return parsed;
}

function runSelfTest() {
  const normalized = normalizeSinceTimestamp("2026-05-18T02:55:59+09:00");
  if (normalized !== "2026-05-17T17:55:59.000Z") {
    throw new Error(`Expected timezone-aware since normalization, got ${normalized}`);
  }

  const repeatedPromptFindings = buildFindings({
    browserActionStats: { succeeded: 0, debugBundles: 1 },
    toolCommands: [],
    evalRuns: [
      createSelfTestEvalRun({ taskSuccess: "passed", prompt: "전체글 눌러줘", requestId: "request-1" }),
      createSelfTestEvalRun({ taskSuccess: "passed", prompt: "전체글 눌러줘", requestId: "request-2" })
    ],
    debugFeedback: {
      total: 1,
      entries: [{
        messageId: "request-3",
        outcome: "failure",
        userText: "전체글 눌러줘",
        reason: "polling 실패"
      }]
    }
  });
  if (repeatedPromptFindings.some((finding) => finding.title === "Manual debug feedback contradicts passed eval runs")) {
    throw new Error(`Repeated prompt without request-id match must not be flagged as a contradiction: ${JSON.stringify(repeatedPromptFindings)}`);
  }

  const matchedFailureFindings = buildFindings({
    browserActionStats: { succeeded: 0, debugBundles: 1 },
    toolCommands: [],
    evalRuns: [createSelfTestEvalRun({ taskSuccess: "passed", prompt: "전체글 눌러줘", requestId: "request-1" })],
    debugFeedback: {
      total: 1,
      entries: [{
        messageId: "request-1",
        outcome: "failure",
        userText: "전체글 눌러줘",
        reason: "polling 실패"
      }]
    }
  });
  if (!matchedFailureFindings.some((finding) => finding.title === "Manual debug feedback contradicts passed eval runs")) {
    throw new Error(`Failure feedback with matching request id must be flagged: ${JSON.stringify(matchedFailureFindings)}`);
  }

  const matchedSuccessFindings = buildFindings({
    browserActionStats: { succeeded: 0, debugBundles: 1 },
    toolCommands: [],
    evalRuns: [createSelfTestEvalRun({ taskSuccess: "passed", prompt: "특갤 열어줘", requestId: "request-success" })],
    debugFeedback: {
      total: 1,
      entries: [{
        messageId: "request-success",
        outcome: "success",
        userText: "특갤 열어줘",
        reason: "정상적으로 동작 수행했는데 failed로 기록됨"
      }]
    }
  });
  if (matchedSuccessFindings.some((finding) => finding.title === "Manual debug feedback contradicts passed eval runs")) {
    throw new Error(`Successful feedback must not be flagged as a contradiction: ${JSON.stringify(matchedSuccessFindings)}`);
  }

  const fallbackOutcome = classifyDebugFeedbackOutcome(
    "여러 단계의 fallback이 있었지만 최종적으로는 목표 수행 성공. but fallback 횟수를 줄이거나 정확성 높일 수 있는 방법은 찾아볼 필요 있음.",
    "안 되면 좌표 클릭으로 처리하겠습니다."
  );
  if (fallbackOutcome !== "ux_issue") {
    throw new Error(`Fallback-heavy final success should be classified as ux_issue, got ${fallbackOutcome}`);
  }

  console.log("real-use widget session audit self-test ok");
}

function createSelfTestEvalRun({ taskSuccess, prompt, requestId }) {
  return {
    id: requestId,
    prompt,
    task_success: taskSuccess,
    failure_class: taskSuccess === "passed" ? "none" : "action_failed",
    metrics_json: JSON.stringify({ requestId, messageId: requestId })
  };
}
