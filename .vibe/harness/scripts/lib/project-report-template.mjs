import { isMetaSprintId } from './project-report-meta.mjs';

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const DECISION_FILTERS = [
  'decision',
  'failure',
  'sprint-complete',
  'user-directive',
  'audit',
  'planner-skip',
  'drift-observed',
];

const SEOUL_TZ = 'Asia/Seoul';
function toSeoulParts(parsed) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: SEOUL_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(parsed).map((p) => [p.type, p.value]));
  return parts;
}

function formatDate(value) {
  if (!value) return 'unknown';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  const p = toSeoulParts(parsed);
  return `${p.year}-${p.month}-${p.day}`;
}

function formatDateTime(value) {
  if (!value) return 'unknown';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  const p = toSeoulParts(parsed);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} KST`;
}

function normalizeStatus(value) {
  const raw = String(value ?? 'idle').toLowerCase();
  if (raw === 'passed' || raw === 'complete' || raw === 'completed' || raw === 'resolved') {
    return 'complete';
  }
  if (raw === 'in-progress' || raw.endsWith('-in-progress') || raw === 'active' || raw === 'running') {
    return 'in-progress';
  }
  if (raw === 'partial' || raw === 'blocked') {
    return 'partial';
  }
  if (raw === 'failed' || raw === 'open' || raw === 'error') {
    return 'failed';
  }
  return 'idle';
}

function renderBadge(label, status = label) {
  return `<span class="status-badge" data-status="${escapeHtml(normalizeStatus(status))}">${escapeHtml(label)}</span>`;
}

function renderSectionHeading(title, context = '') {
  const contextHtml = context ? `<span>${escapeHtml(context)}</span>` : '';
  return `<div class="section-heading"><h2>${escapeHtml(title)}</h2>${contextHtml}</div>`;
}

function renderEmptyPreview(message, bodyHtml) {
  return `<div class="empty-preview" data-demo="true">
    <p class="empty-state">${escapeHtml(message)} Showing a layout-safe preview.</p>
    ${bodyHtml}
  </div>`;
}

function sumLoc(sprints) {
  return sprints.reduce(
    (total, entry) => {
      const loc = isRecord(entry.actualLoc) ? entry.actualLoc : {};
      return {
        added: total.added + Number(loc.added ?? 0),
        deleted: total.deleted + Number(loc.deleted ?? 0),
        net: total.net + Number(loc.net ?? 0),
      };
    },
    { added: 0, deleted: 0, net: 0 },
  );
}

function getVisibleSprints(status, history, metaProject) {
  const knownSprints = new Set(history.iterations.flatMap((entry) => entry.plannedSprints));
  const entries = Array.isArray(status?.sprints) ? status.sprints : [];
  return entries
    .filter((entry) => knownSprints.size === 0 || knownSprints.has(entry.id) || entry.status === 'passed')
    .filter((entry) => !metaProject || !isMetaSprintId(entry.id));
}

function renderMetricCards(model) {
  const sprints = Array.isArray(model.status?.sprints) ? model.status.sprints : [];
  const passed = sprints.filter((entry) => entry.status === 'passed' || entry.status === 'complete');
  const loc = sumLoc(sprints);
  const openRisks = Array.isArray(model.status?.pendingRisks)
    ? model.status.pendingRisks.filter((risk) => risk?.status === 'open').length
    : 0;
  const current = model.iterationHistory.currentIteration ?? 'no active iteration';
  const cards = [
    ['TOTAL SPRINTS', String(passed.length), `${sprints.length} recorded`],
    ['TOTAL ITERATIONS', String(model.iterationHistory.iterations.length), current],
    ['TOTAL LOC', `${loc.net >= 0 ? '+' : ''}${loc.net}`, `${loc.added} added / ${loc.deleted} deleted`],
    ['OPEN RISKS', String(openRisks), `${model.status?.sprintsSinceLastAudit ?? 0} sprints since audit`],
  ];

  return `<section class="metric-grid" aria-label="Project metrics">${cards
    .map(
      ([label, value, context]) => `<article class="metric-card">
        <p>${escapeHtml(label)}</p>
        <strong>${escapeHtml(value)}</strong>
        <span>${escapeHtml(context)}</span>
      </article>`,
    )
    .join('')}</section>`;
}

function renderIterationTimeline(history) {
  if (history.iterations.length === 0) {
    const demo = [
      { id: 'interview', label: 'interview', goal: 'Capture product intent and constraints.', status: 'complete', date: 'sample' },
      { id: 'sprint-1', label: 'sprint-1', goal: 'Deliver the first usable slice.', status: 'current', date: 'sample' },
      { id: 'review', label: 'review', goal: 'Collect evidence and choose the next move.', status: 'idle', date: 'sample' },
    ];
    return renderEmptyPreview(
      'No iterations recorded yet.',
      `<ol class="iteration-timeline demo-timeline" aria-label="Sample iteration timeline">${demo
        .map((entry) => `<li class="timeline-item" data-status="${escapeHtml(entry.status)}">
          <button class="timeline-dot" type="button" aria-label="${escapeHtml(`${entry.label}: ${entry.goal}`)}" title="${escapeHtml(entry.goal)}"></button>
          <span class="timeline-label">${escapeHtml(entry.id)}</span>
          <span class="timeline-status">${escapeHtml(entry.status)}</span>
          <time>${escapeHtml(entry.date)}</time>
        </li>`)
        .join('')}</ol>`,
    );
  }

  return `<ol class="iteration-timeline" aria-label="Iteration timeline">${history.iterations
    .map((entry) => {
      const status = entry.id === history.currentIteration ? 'current' : entry.completedAt ? 'complete' : 'idle';
      const date = entry.completedAt ?? entry.startedAt;
      return `<li class="timeline-item" data-status="${escapeHtml(status)}">
        <button class="timeline-dot" type="button" aria-label="${escapeHtml(`${entry.label || entry.id}: ${entry.goal || 'No goal recorded.'}`)}" title="${escapeHtml(entry.goal || 'No goal recorded.')}"></button>
        <span class="timeline-label">${escapeHtml(entry.id)}</span>
        <span class="timeline-status">${escapeHtml(status === 'current' ? 'current' : status)}</span>
        <time datetime="${escapeHtml(date || '')}">${escapeHtml(formatDate(date))}</time>
      </li>`;
    })
    .join('')}</ol>`;
}

function renderSprintCards(status, roadmapDetails, history, metaProject) {
  const visible = getVisibleSprints(status, history, metaProject);
  if (visible.length === 0) {
    const demo = [
      {
        id: 'sprint-contract',
        status: 'passed',
        goal: 'Lock the product contract and evidence checklist.',
        loc: { added: 118, deleted: 24, net: 94 },
        commit: 'sample',
        completedAt: 'sample',
      },
      {
        id: 'sprint-ui-slice',
        status: 'in-progress',
        goal: 'Build the first visible workflow with inspection notes.',
        loc: { added: 236, deleted: 41, net: 195 },
        commit: 'pending',
        completedAt: 'in progress',
      },
    ];
    return renderEmptyPreview(
      'No project sprint outputs to show yet.',
      `<div class="sprint-grid demo-grid">${demo
        .map((entry) => `<article class="sprint-card" data-sprint-id="${escapeHtml(entry.id)}" data-demo="true">
          <div class="card-head">
            <h3>${escapeHtml(entry.id)}</h3>
            ${renderBadge(entry.status, entry.status)}
          </div>
          <p>${escapeHtml(entry.goal)}</p>
          <dl>
            <dt>LOC delta</dt><dd><span class="loc-line"><span class="loc-add">+${entry.loc.added}</span> / <span class="loc-del">-${entry.loc.deleted}</span></span><span class="loc-line loc-net-line">net <span class="loc-net pos">+${entry.loc.net}</span></span></dd>
            <dt>Commit</dt><dd><code>${escapeHtml(entry.commit)}</code></dd>
            <dt>Completed</dt><dd>${escapeHtml(entry.completedAt)}</dd>
          </dl>
        </article>`)
        .join('')}</div>`,
    );
  }

  return `<div class="sprint-grid">${visible
    .map((entry) => {
      const detail = roadmapDetails.get(entry.id) ?? { name: entry.name ?? entry.id, goal: 'No goal recorded.' };
      let loc = 'n/a';
      if (entry.actualLoc) {
        const netValue = entry.actualLoc.net;
        const netClass = netValue > 0 ? 'pos' : netValue < 0 ? 'neg' : 'zero';
        const netText = netValue >= 0 ? `+${netValue}` : String(netValue);
        loc = `<span class="loc-line"><span class="loc-add">+${entry.actualLoc.added}</span> / <span class="loc-del">-${entry.actualLoc.deleted}</span></span><span class="loc-line loc-net-line">net <span class="loc-net ${netClass}">${escapeHtml(netText)}</span></span>`;
      }
      const hash = typeof entry.commit === 'string' ? entry.commit : typeof entry.commitHash === 'string' ? entry.commitHash : 'n/a';
      return `<article class="sprint-card" data-sprint-id="${escapeHtml(entry.id)}">
        <div class="card-head">
          <h3>${escapeHtml(entry.id)}</h3>
          ${renderBadge(entry.status ?? 'unknown', entry.status)}
        </div>
        <p>${escapeHtml(detail.goal)}</p>
        <dl>
          <dt>LOC delta</dt><dd>${loc}</dd>
          <dt>Commit</dt><dd><code>${escapeHtml(hash)}</code></dd>
          <dt>Completed</dt><dd><time datetime="${escapeHtml(entry.completedAt ?? '')}">${escapeHtml(formatDate(entry.completedAt))}</time></dd>
        </dl>
      </article>`;
    })
    .join('')}</div>`;
}

function renderMilestones(milestones, progress) {
  if (milestones.length === 0) {
    return '';
  }

  return `<section id="milestones" data-section="milestones" class="report-section">
    ${renderSectionHeading('Milestone Progress')}
    <div class="milestone-list">${milestones
      .map((milestone) => {
        const ratio = Math.max(0, Math.min(1, Number(progress[milestone.id] ?? 0)));
        const percent = Math.round(ratio * 100);
        const completed = Math.round(ratio * 100);
        return `<article class="milestone-row">
          <div>
            <h3>${escapeHtml(milestone.name)}</h3>
            <p>${escapeHtml(milestone.definition || milestone.progressMetric)}</p>
          </div>
          <div class="progress-wrap" aria-label="${escapeHtml(`${milestone.name} ${percent}% complete`)}">
            <div class="progress-bar"><span style="width:${percent}%"></span></div>
            <span>${escapeHtml(`${completed}/100`)}</span>
          </div>
        </article>`;
      })
      .join('')}</div>
  </section>`;
}

function renderDecisionContent(entry) {
  if (entry.content.length >= 150) {
    const summary = `${entry.content.slice(0, 100).trim()}...`;
    return `<details><summary>${escapeHtml(summary)}</summary><p>${escapeHtml(entry.content)}</p></details>`;
  }
  return `<p>${escapeHtml(entry.content)}</p>`;
}

function renderDecisions(productMd, entries, metaSummary) {
  const seed = productMd.includes('Dimension summary')
    ? productMd.slice(productMd.indexOf('Dimension summary')).split(/\r?\n/).slice(0, 8)
    : [];
  const seededEntries = seed
    .filter(Boolean)
    .map((content) => ({ date: 'Project', time: '--:--', tag: 'decision', content }));
  const metaEntries = metaSummary.map((content) => ({ date: 'Meta', time: '--:--', tag: 'decision', content }));
  let items = [...seededEntries, ...entries, ...metaEntries];
  const demo = items.length === 0;
  if (demo) {
    items = [
      {
        date: 'Sample',
        time: '--:--',
        tag: 'decision',
        content: 'No key decisions recorded yet. Example: define the acceptance evidence before the first sprint starts.',
      },
      {
        date: 'Sample',
        time: '--:--',
        tag: 'failure',
        content: 'Example risk: browser inspection evidence is missing, so the next sprint should include a screenshot or playthrough note.',
      },
    ];
  }

  const groups = new Map();
  for (const item of items) {
    const existing = groups.get(item.date) ?? [];
    existing.push(item);
    groups.set(item.date, existing);
  }

  const chips = ['all', ...DECISION_FILTERS]
    .map((tag) => {
      const pressed = tag === 'all' ? 'true' : 'false';
      return `<button class="filter-chip" type="button" data-filter="${escapeHtml(tag)}" aria-pressed="${pressed}">${escapeHtml(tag === 'all' ? 'All' : tag)}</button>`;
    })
    .join('');

  const demoIntro = demo ? '<p class="empty-state">No key decisions recorded yet. Showing a layout-safe preview.</p>' : '';

  return `${demoIntro}<div class="decision-tools" aria-label="Decision filters">
      <div class="filter-list" role="group" aria-label="Filter key decisions">${chips}</div>
      <div class="expand-actions">
        <button type="button" data-decision-action="expand">Expand all</button>
        <button type="button" data-decision-action="collapse">Collapse all</button>
      </div>
    </div>
    <div class="decision-groups" ${demo ? 'data-demo="true" ' : ''}data-active-tags="${escapeHtml(DECISION_FILTERS.join(' '))}">${[...groups.entries()]
      .map(
        ([date, group]) => `<section class="decision-date-group" aria-label="${escapeHtml(`Decisions for ${date}`)}">
          <h3>${escapeHtml(date)}</h3>
          ${group
            .map(
              (entry) => `<article class="decision-entry" data-tag="${escapeHtml(entry.tag)}">
                <time>${escapeHtml(entry.time)}</time>
                ${renderBadge(entry.tag, entry.tag === 'failure' ? 'failed' : entry.tag === 'sprint-complete' ? 'complete' : entry.tag)}
                <div>${renderDecisionContent(entry)}</div>
              </article>`,
            )
            .join('')}
        </section>`,
      )
      .join('')}</div>`;
}

function renderScriptStatus(status, packageJson) {
  const scripts = isRecord(packageJson?.scripts) ? packageJson.scripts : {};
  const recorded = Array.isArray(status?.verificationCommands) ? status.verificationCommands : [];
  const rows = recorded
    .filter(isRecord)
    .map((entry) => ({
      name: String(entry.command ?? entry.name ?? 'verification'),
      status: String(entry.status ?? (entry.exit === 0 ? 'passed' : entry.exit) ?? 'recorded'),
      timestamp: String(entry.completedAt ?? entry.updatedAt ?? entry.timestamp ?? 'unknown'),
    }));

  for (const name of ['typecheck', 'test', 'build', 'lint']) {
    if (typeof scripts[name] === 'string' && !rows.some((row) => row.name === name)) {
      rows.push({ name, status: 'idle', timestamp: scripts[name] });
    }
  }

  if (rows.length === 0) {
    rows.push(
      { name: 'typecheck', status: 'idle', timestamp: 'sample command slot' },
      { name: 'test', status: 'idle', timestamp: 'sample command slot' },
      { name: 'build', status: 'idle', timestamp: 'sample command slot' },
    );
    return `<div class="empty-preview" data-demo="true">
      <p class="empty-state">No verification runs recorded. Showing a layout-safe preview.</p>
      <div class="verification-list">${rows
        .map(
          (row) => `<article class="verification-row">
            <code>${escapeHtml(row.name)}</code>
            ${renderBadge(row.status, row.status)}
            <span>${escapeHtml(row.timestamp)}</span>
          </article>`,
        )
        .join('')}</div>
    </div>`;
  }

  return `<div class="verification-list">${rows
    .map(
      (row) => `<article class="verification-row">
        <code>${escapeHtml(row.name)}</code>
        ${renderBadge(row.status, row.status)}
        <span>${escapeHtml(row.timestamp)}</span>
      </article>`,
    )
    .join('')}</div>`;
}

function renderNextSteps(status, roadmapIds, history) {
  const passed = new Set((Array.isArray(status?.sprints) ? status.sprints : []).filter((entry) => entry.status === 'passed').map((entry) => entry.id));
  const next = roadmapIds.find((id) => !passed.has(id));
  const openRisks = Array.isArray(status?.pendingRisks)
    ? status.pendingRisks.filter((risk) => risk?.status === 'open').length
    : 0;
  const steps = [];
  if (history.currentIteration) {
    steps.push(`Continue ${history.currentIteration} with the next roadmap slot.`);
  }
  if (next) {
    steps.push(`Start ${next}.`);
  } else if (roadmapIds.length > 0) {
    steps.push('Plan the next iteration with /vibe-iterate.');
  }
  if (openRisks > 0) {
    steps.push(`Triage ${openRisks} open risk${openRisks === 1 ? '' : 's'}.`);
  }
  if (steps.length === 0) {
    steps.push('Run /vibe-init or /vibe-iterate to create a fresh plan.');
  }
  return `<ol class="next-steps">${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>`;
}

export function renderProjectReportHtml(model) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(model.product.name)} report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@500;600&display=swap" rel="stylesheet">
<style>
:root{color-scheme:light;--bg:#f7f8f6;--paper:#ffffff;--paper-soft:#f1f4f1;--text:#20231f;--secondary:#596158;--muted:#81897d;--line:#dfe5dc;--line-strong:#c8d3c7;--accent:#0f766e;--accent-soft:rgba(15,118,110,0.12);--surface:rgba(255,255,255,0.9);--surface-quiet:rgba(247,248,246,0.82);--surface-shadow:0 1px 2px rgba(31,35,31,0.04),0 18px 42px rgba(31,35,31,0.08);--inner-line:inset 0 1px 0 rgba(255,255,255,0.86);--border:var(--line);--border-strong:var(--line-strong);--accent-subtle:var(--accent-soft);--glass-bg:var(--surface);--glass-bg-flat:var(--surface);--glass-highlight:var(--inner-line);--glass-depth:var(--surface-shadow);--complete-bg:rgba(26,127,55,0.13);--complete-text:#176b35;--progress-bg:rgba(15,118,110,0.13);--progress-text:#0f766e;--partial-bg:rgba(181,108,19,0.14);--partial-text:#8a520f;--failed-bg:rgba(180,45,39,0.12);--failed-text:#9e2f2a;--idle-bg:rgba(89,97,88,0.12);--idle-text:#596158;--loc-add:#176b35;--loc-del:#9e2f2a;--loc-net-neutral:#596158;--motion:cubic-bezier(.2,.8,.2,1)}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:linear-gradient(180deg,#fafbf8 0%,var(--bg) 48%,#eef2ed 100%);background-attachment:fixed;color:var(--text);font-family:Geist,"Segoe UI",sans-serif;font-size:15px;line-height:1.65;padding:0;font-variant-numeric:tabular-nums}
body::before{content:"";position:fixed;inset:0;pointer-events:none;background-image:linear-gradient(rgba(32,35,31,0.035) 1px,transparent 1px),linear-gradient(90deg,rgba(32,35,31,0.028) 1px,transparent 1px);background-size:44px 44px;mask-image:linear-gradient(180deg,rgba(0,0,0,.5),rgba(0,0,0,.08));z-index:-1}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline;text-underline-offset:3px}
button{font:inherit;color:inherit;background:transparent;border:0;padding:0;cursor:pointer}
button:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
code,time{font-family:"Geist Mono","SF Mono",Consolas,monospace;font-size:13px;font-weight:500}
.skip-link{position:absolute;left:32px;top:24px;z-index:20;transform:translateY(-160%);background:var(--glass-bg-flat);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:10px 16px;backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px)}
.skip-link:focus{transform:translateY(0)}
.outer-frame{border:0;border-radius:0;padding:0;min-height:100vh;background:transparent;position:relative;overflow:visible}
.ambient-glow{display:none}
.site-nav{position:fixed;top:16px;left:50%;transform:translateX(-50%);width:calc(100% - 48px);max-width:1552px;z-index:10;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:24px;padding:10px 18px;background:rgba(250,251,248,0.82);border:1px solid var(--line);border-radius:999px;backdrop-filter:blur(28px) saturate(110%);-webkit-backdrop-filter:blur(28px) saturate(110%);box-shadow:var(--inner-line),0 12px 34px rgba(31,35,31,0.08);will-change:transform}
.site-nav .brand{justify-self:start}
.site-nav .nav-anchors{justify-self:center}
.site-nav .nav-meta{justify-self:end}
.site-nav::after{content:"";position:absolute;inset:1px;border-radius:inherit;pointer-events:none;border:1px solid rgba(255,255,255,0.58)}
.brand{display:flex;align-items:center;gap:12px;font-weight:600}
.brand-name{font-size:15px;font-weight:650;letter-spacing:0;color:var(--text)}
.brand-mark{width:34px;height:34px;border-radius:12px;display:grid;place-items:center;flex-shrink:0;background:linear-gradient(145deg,#ffffff,#e9eee8);border:1px solid var(--line);box-shadow:var(--inner-line),0 8px 18px rgba(31,35,31,0.09)}
.brand-mark svg{width:21px;height:21px;stroke:var(--accent);stroke-width:1.7;fill:none;stroke-linecap:round;stroke-linejoin:round}
.brand-mark .pulse-line{animation:mark-pulse 3.6s var(--motion) infinite;transform-origin:center}
@keyframes mark-pulse{0%,100%{opacity:.58;transform:translateY(0)}50%{opacity:1;transform:translateY(-1px)}}
.nav-anchors{display:flex;gap:2px;list-style:none;margin:0;padding:0}
.nav-anchors a{display:inline-block;padding:6px 14px;font-size:13px;color:var(--secondary);border-radius:999px;transition:background .24s var(--motion),color .24s var(--motion),transform .24s var(--motion);text-decoration:none}
.nav-anchors a:hover{background:var(--accent-soft);color:var(--text);text-decoration:none;transform:translateY(-1px)}
.nav-meta{display:flex;align-items:center;gap:12px;font-size:12px;color:var(--muted);font-family:"Geist Mono","SF Mono",Consolas,monospace}
.container{max-width:1600px;margin:0 auto;padding:0 24px}
.hero{padding:46px 0 54px;max-width:920px}
.eyebrow{font-size:11px;font-weight:600;letter-spacing:0;text-transform:uppercase;color:var(--muted);margin:0 0 16px}
h1{font-size:48px;line-height:1.05;font-weight:650;letter-spacing:0;margin:0 0 20px;color:var(--text)}
h2{font-size:28px;line-height:1.2;font-weight:600;letter-spacing:0;color:var(--text);margin:0}
h3{font-size:16px;line-height:1.4;font-weight:600;color:var(--text);margin:0}
.subtitle{font-size:17px;line-height:1.55;color:var(--secondary);margin:0 0 24px;max-width:720px}
.meta-row{display:flex;flex-wrap:wrap;align-items:center;gap:12px 24px;font-size:13px;color:var(--muted);font-family:"Geist Mono","SF Mono",Consolas,monospace}
.meta-row>span{display:inline-flex;align-items:center;gap:8px}
main.container{padding-top:90px;padding-bottom:0;padding-left:24px;padding-right:24px}
.report-section{margin-top:56px;scroll-margin-top:96px;content-visibility:auto;contain-intrinsic-size:0 600px}
.report-section.wrap{padding:30px 0 0;border-top:1px solid var(--line);border-radius:0;background:transparent;box-shadow:none}
.report-section.wrap .section-heading{margin-bottom:20px}
.report-section.wrap .sprint-grid{margin-top:4px}
.report-section.wrap .sprint-card,.report-section.wrap .milestone-row,.report-section.wrap .verification-row{background:var(--surface);border-color:var(--line);box-shadow:var(--inner-line),0 8px 24px rgba(31,35,31,0.06)}
.report-section.wrap .decision-groups{background:transparent;border:0;box-shadow:none;padding:0}
.report-grid{display:grid;grid-template-columns:7fr 6fr;gap:40px;align-items:start}
.col-main{min-width:0}
.col-side{min-width:0}
.col-side .report-section{margin-top:0}
.section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:24px}
.section-heading span{color:var(--muted);font-size:13px;font-weight:500}
.metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px}
.metric-card,.sprint-card,.milestone-row,.verification-row,.decision-groups{background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--inner-line),var(--surface-shadow)}
.metric-card{padding:24px;transition:transform .24s var(--motion),border-color .24s var(--motion),box-shadow .24s var(--motion);position:relative;overflow:hidden}
.metric-card::before{content:"";position:absolute;left:18px;right:18px;top:0;height:2px;background:var(--accent);opacity:.5;transform:scaleX(.42);transform-origin:left center;transition:transform .32s var(--motion),opacity .32s var(--motion)}
.metric-card:hover{transform:translateY(-2px);border-color:var(--line-strong);box-shadow:var(--inner-line),0 18px 44px rgba(31,35,31,0.1)}
.metric-card:hover::before{transform:scaleX(1);opacity:.72}
.metric-card p{font-size:11px;font-weight:600;letter-spacing:0;text-transform:uppercase;color:var(--muted);margin:0 0 16px}
.metric-card strong{display:block;font-size:36px;line-height:1;font-weight:600;font-variant-numeric:tabular-nums;color:var(--text);margin-bottom:12px;letter-spacing:0}
.metric-card span{color:var(--secondary);font-size:13px;font-weight:500}
.iteration-timeline{position:relative;display:flex;gap:24px;list-style:none;margin:0;padding:40px 0 0;overflow-x:auto;justify-content:flex-start}
.iteration-timeline::before{content:"";position:absolute;left:12px;right:12px;top:50px;border-top:1px dashed var(--border-strong);opacity:0.6}
.timeline-item{position:relative;min-width:160px;padding-top:40px;text-align:center}
.timeline-dot{position:absolute;top:0;left:50%;transform:translateX(-50%);width:20px;height:20px;border-radius:50%;border:1px solid rgba(160,160,165,0.4);background:linear-gradient(135deg,#f5f5f7 0%,#c7c7cc 50%,#8e8e93 100%);box-shadow:inset 0 1px 1px rgba(255,255,255,0.9),inset 0 -1px 1px rgba(0,0,0,0.12),0 2px 5px rgba(60,60,67,0.15);z-index:1}
.timeline-item[data-status="current"] .timeline-label{color:var(--text);font-weight:700}
.timeline-item[data-status="current"] .timeline-dot{box-shadow:inset 0 1px 1px rgba(255,255,255,0.9),inset 0 -1px 1px rgba(0,0,0,0.12),0 2px 5px rgba(60,60,67,0.15),0 0 0 3px rgba(120,120,128,0.2)}
.timeline-label{display:block;font-weight:600;color:var(--text);line-height:1.35;margin-bottom:4px}
.timeline-status,.timeline-item time{display:block;color:var(--muted);font-size:13px;font-family:"Geist Mono","SF Mono",Consolas,monospace}
.sprint-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}
.sprint-card{padding:24px;transition:transform .24s var(--motion),border-color .24s var(--motion),box-shadow .24s var(--motion)}
.sprint-card:hover{transform:translateY(-2px);border-color:var(--line-strong);box-shadow:var(--inner-line),0 18px 44px rgba(31,35,31,0.1)}
.card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px}
.card-head h3{font-family:"Geist Mono","SF Mono",Consolas,monospace;font-size:12px;font-weight:500;letter-spacing:0;word-break:break-word;color:var(--text)}
.sprint-card>p{color:var(--secondary);margin:0 0 20px;font-size:14px}
dl{display:grid;grid-template-columns:100px minmax(0,1fr);gap:8px 12px;margin:0;padding-top:16px;border-top:1px solid var(--border)}
dt{color:var(--muted);font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0}
dd{margin:0;min-width:0;word-break:break-word;color:var(--secondary);font-size:13px;font-family:"Geist Mono","SF Mono",Consolas,monospace}
.loc-line{display:block}
.loc-net-line{margin-top:2px;color:var(--muted)}
.loc-add{color:var(--loc-add);font-weight:600}
.loc-del{color:var(--loc-del);font-weight:600}
.loc-net{font-weight:600}
.loc-net.pos{color:var(--loc-add)}
.loc-net.neg{color:var(--loc-del)}
.loc-net.zero{color:var(--loc-net-neutral)}
.status-badge{display:inline-flex;align-items:center;border-radius:999px;padding:4px 11px;font-size:10px;font-weight:600;letter-spacing:0;text-transform:uppercase;white-space:nowrap;border:1px solid transparent;box-shadow:inset 0 1px 0 rgba(255,255,255,0.65),0 1px 2px rgba(0,0,0,0.05)}
.status-badge[data-status="complete"]{background:linear-gradient(135deg,rgba(52,199,89,0.28),rgba(52,199,89,0.14));color:var(--complete-text);border-color:rgba(52,199,89,0.42)}
.status-badge[data-status="in-progress"]{background:linear-gradient(135deg,rgba(0,122,255,0.26),rgba(0,122,255,0.12));color:var(--progress-text);border-color:rgba(0,122,255,0.38)}
.status-badge[data-status="partial"]{background:linear-gradient(135deg,rgba(255,149,0,0.3),rgba(255,149,0,0.14));color:var(--partial-text);border-color:rgba(255,149,0,0.42)}
.status-badge[data-status="failed"]{background:linear-gradient(135deg,rgba(255,59,48,0.28),rgba(255,59,48,0.14));color:var(--failed-text);border-color:rgba(255,59,48,0.42)}
.status-badge[data-status="idle"]{background:linear-gradient(135deg,rgba(120,120,128,0.22),rgba(120,120,128,0.1));color:var(--idle-text);border-color:rgba(120,120,128,0.28)}
.milestone-list{display:grid;gap:16px}
.milestone-row{display:grid;grid-template-columns:minmax(0,1fr) 240px;gap:24px;align-items:center;padding:20px 24px}
.milestone-row p{color:var(--secondary);margin:8px 0 0;font-size:14px}
.progress-wrap{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;color:var(--secondary);font-size:13px;font-family:"Geist Mono","SF Mono",Consolas,monospace}
.progress-bar{height:6px;border-radius:3px;overflow:hidden;background:rgba(60,60,67,0.1);border:0}
.progress-bar span{display:block;height:100%;background:linear-gradient(90deg,#0f766e,#32a399)}
.decision-tools{display:flex;justify-content:space-between;gap:16px;align-items:flex-end;margin-bottom:24px;flex-wrap:wrap}
.filter-list,.expand-actions{display:flex;gap:8px;flex-wrap:wrap}
.filter-chip{padding:6px 14px;border-radius:999px;color:var(--muted);font-size:12px;font-weight:500;background:transparent;border:1px solid var(--line);transition:background .24s var(--motion),color .24s var(--motion),border-color .24s var(--motion),transform .24s var(--motion)}
.filter-chip[aria-pressed="true"]{color:var(--text);background:var(--accent-subtle);border-color:var(--border-strong)}
.filter-chip:hover{color:var(--text);border-color:var(--line-strong);transform:translateY(-1px)}
.expand-actions button{color:var(--secondary);font-size:13px;font-weight:500;padding:8px 16px;border-radius:999px;background:var(--surface);border:1px solid var(--line);box-shadow:var(--inner-line),0 6px 16px rgba(31,35,31,0.06);transition:background .24s var(--motion),color .24s var(--motion),border-color .24s var(--motion),transform .24s var(--motion)}
.expand-actions button:hover{color:var(--text);background:#fff;border-color:var(--line-strong);transform:translateY(-1px)}
.decision-groups{padding:24px 28px}
.decision-date-group{margin-top:32px}
.decision-date-group:first-child{margin-top:0}
.decision-date-group>h3{background:transparent;border-bottom:1px solid var(--line);color:var(--text);font-size:12px;font-family:"Geist Mono","SF Mono",Consolas,monospace;font-weight:700;padding:10px 0;margin-bottom:12px;letter-spacing:0}
.decision-entry{display:none;grid-template-columns:76px 124px minmax(0,1fr);gap:14px;align-items:start;padding:14px 0;border-bottom:1px solid var(--border)}
.decision-entry .status-badge{justify-content:center;width:100%}
.decision-entry:last-child{border-bottom:0}
.decision-entry time{color:var(--muted);font-size:12px}
.decision-entry p{margin:0;color:var(--text);font-size:14px;line-height:1.6}
.decision-entry summary{cursor:pointer;color:var(--text)}
.decision-entry details p{margin-top:8px;color:var(--secondary)}
[data-active-tags~="decision"] .decision-entry[data-tag="decision"],[data-active-tags~="failure"] .decision-entry[data-tag="failure"],[data-active-tags~="sprint-complete"] .decision-entry[data-tag="sprint-complete"],[data-active-tags~="user-directive"] .decision-entry[data-tag="user-directive"],[data-active-tags~="audit"] .decision-entry[data-tag="audit"],[data-active-tags~="planner-skip"] .decision-entry[data-tag="planner-skip"],[data-active-tags~="drift-observed"] .decision-entry[data-tag="drift-observed"]{display:grid}
.verification-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
.verification-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:18px 20px}
.verification-row .status-badge{justify-self:start}
.verification-row span{grid-column:1/-1;color:var(--muted);font-size:12px;word-break:break-word;font-family:"Geist Mono","SF Mono",Consolas,monospace}
.next-steps{margin:0;padding-left:24px;color:var(--text)}
.next-steps li{font-size:15px;line-height:1.6;margin-bottom:12px}
.next-steps li::marker{color:var(--text);font-weight:600}
.empty-state{color:var(--muted);margin:0}
.empty-preview{display:grid;gap:18px}
.empty-preview .empty-state{padding:12px 14px;border:1px dashed var(--line-strong);border-radius:14px;background:var(--surface-quiet)}
.demo-grid .sprint-card,.demo-timeline .timeline-item{opacity:.78}
.site-footer{border-top:1px solid var(--line);color:var(--muted);font-size:12px;font-family:"Geist Mono","SF Mono",Consolas,monospace;padding:32px 0 16px;margin-top:80px;text-align:center}
@media (max-width:1024px){h1{font-size:44px}.nav-anchors{display:none}.report-grid{grid-template-columns:1fr;gap:0}.col-side .report-section{margin-top:80px}.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:640px){body{padding:8px}.outer-frame{padding:12px;border-radius:16px}.site-nav{padding:10px 14px;border-radius:20px;flex-wrap:wrap;gap:12px;margin-bottom:48px}.nav-meta{display:none}h1{font-size:32px}.hero{padding:32px 0 48px}.report-section{margin-top:48px}.section-heading,.decision-tools{display:block}.filter-list,.expand-actions{margin-top:16px}.milestone-row{grid-template-columns:1fr}.decision-entry{grid-template-columns:1fr;gap:8px}.decision-date-group>h3{top:80px}.metric-card strong{font-size:36px}.subtitle{font-size:15px}}
@media (prefers-reduced-motion:reduce){.brand-mark .pulse-line{animation:none}.metric-card,.sprint-card,.nav-anchors a,.filter-chip,.expand-actions button{transition:none}}
@media print{body{background:#fff;color:#000;padding:0}.outer-frame{border:0;padding:0;background:none;backdrop-filter:none}.ambient-glow{display:none}.site-nav{position:static;margin-bottom:32px;border:1px solid #ccc;background:#fff;box-shadow:none;backdrop-filter:none;color:#000}.nav-anchors,.nav-meta,.skip-link,.decision-tools,.brand-mark{display:none}.brand-name{color:#000}.metric-card,.sprint-card,.milestone-row,.verification-row,.decision-groups{background:#fff;border:1px solid #ccc;box-shadow:none;backdrop-filter:none;color:#000}.metric-card p,.metric-card span,.sprint-card>p,dt,dd,.eyebrow,.subtitle,.meta-row,.timeline-status,.timeline-item time,.next-steps li,.decision-entry p{color:#000}h1,h2,h3{color:#000}.report-section{break-inside:avoid;margin-top:32px}details:not([open])>summary{margin-bottom:8px}details:not([open])>:not(summary){display:block}.site-footer::after{content:" / " counter(page)}a::after{content:" (" attr(href) ")";color:#666;font-size:90%}}
</style>
</head>
<body>
<a class="skip-link" href="#content">Skip to content</a>
<div class="ambient-glow one" aria-hidden="true"></div>
<div class="ambient-glow two" aria-hidden="true"></div>
<div class="outer-frame">
<nav class="site-nav" aria-label="Report navigation">
  <div class="brand">
    <div class="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M5 12h4l2-6 3 12 2-6h3"></path>
        <path class="pulse-line" d="M4 18h16"></path>
      </svg>
    </div>
    <span class="brand-name">vibe doctor</span>
  </div>
  <ul class="nav-anchors">
    <li><a href="#iterations">Iterations</a></li>
    <li><a href="#sprints">Sprints</a></li>
    <li><a href="#decisions">Decisions</a></li>
    <li><a href="#verification">Verification</a></li>
  </ul>
  <div class="nav-meta">
    <span>${escapeHtml(model.iterationHistory.currentIteration ?? 'idle')}</span>
    <span>/</span>
    <span>${escapeHtml(formatDate(model.generatedAt))}</span>
  </div>
</nav>
<main id="content" class="container">
<section class="hero">
  <p class="eyebrow">Project Report</p>
  <h1>${escapeHtml(model.product.name)}</h1>
  <p class="subtitle">${escapeHtml(model.product.oneLiner)}</p>
  <div class="meta-row" aria-label="Report metadata">
    <span>Generated ${escapeHtml(formatDateTime(model.generatedAt))}</span>
    <span>Platform: ${escapeHtml(model.product.platform)}</span>
    <span>Status: ${renderBadge(model.statusLabel, model.statusLabel)}</span>
  </div>
</section>
<div class="report-grid">
  <div class="col-main">
    ${renderMetricCards(model)}
    <section id="iterations" data-section="iterations" class="report-section wrap">${renderSectionHeading('Iteration Timeline')}${renderIterationTimeline(model.iterationHistory)}</section>
    <section id="sprints" data-section="sprints" class="report-section wrap">${renderSectionHeading('Sprint Outputs', `${getVisibleSprints(model.status, model.iterationHistory, model.metaProject).length} sprints across ${model.iterationHistory.iterations.length} iterations`)}${renderSprintCards(model.status, model.roadmapDetails, model.iterationHistory, model.metaProject)}</section>
    ${renderMilestones(model.milestones, model.milestoneProgress)}
    <section id="verification" data-section="verification" class="report-section wrap">${renderSectionHeading('Verification Status')}${renderScriptStatus(model.status, model.packageJson)}</section>
    <section id="next-steps" data-section="next-steps" class="report-section wrap">${renderSectionHeading('Next Steps')}${renderNextSteps(model.status, model.roadmapIds, model.iterationHistory)}</section>
  </div>
  <aside class="col-side">
    <section id="decisions" data-section="decisions" class="report-section wrap decisions-section">${renderSectionHeading('Key Decisions', `${model.reportEntries.length} entries`)}${renderDecisions(model.productMd, model.reportEntries, model.metaSummary)}</section>
  </aside>
</div>
</main>
<footer class="site-footer">
  <div class="container">Generated by vibe-doctor ${escapeHtml(model.packageJson?.harnessVersion ?? model.packageJson?.version ?? 'unknown')} / ${escapeHtml(formatDateTime(model.generatedAt))}</div>
</footer>
</div>
<script>
(() => {
  const groups = document.querySelector('.decision-groups');
  if (!groups) return;
  const filters = Array.from(document.querySelectorAll('[data-filter]'));
  const tags = ${JSON.stringify(DECISION_FILTERS)};
  const allBtn = filters.find((b) => b.dataset.filter === 'all');
  const others = filters.filter((b) => b.dataset.filter !== 'all');
  const showAll = () => {
    groups.dataset.activeTags = tags.join(' ');
    if (allBtn) allBtn.setAttribute('aria-pressed', 'true');
    for (const b of others) b.setAttribute('aria-pressed', 'false');
  };
  const applyIndividual = () => {
    const active = others.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.filter);
    if (active.length === 0 || active.length === others.length) {
      showAll();
      return;
    }
    if (allBtn) allBtn.setAttribute('aria-pressed', 'false');
    groups.dataset.activeTags = active.join(' ');
  };
  if (allBtn) allBtn.addEventListener('click', () => showAll());
  for (const b of others) {
    b.addEventListener('click', () => {
      const cur = b.getAttribute('aria-pressed') === 'true';
      b.setAttribute('aria-pressed', cur ? 'false' : 'true');
      applyIndividual();
    });
  }
  for (const button of document.querySelectorAll('[data-decision-action]')) {
    button.addEventListener('click', () => {
      const open = button.dataset.decisionAction === 'expand';
      document.querySelectorAll('#decisions details').forEach((node) => {
        node.open = open;
      });
    });
  }
  const prefersReduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const link of document.querySelectorAll('a[href^="#"]')) {
    link.addEventListener('click', (event) => {
      const id = link.getAttribute('href').slice(1);
      if (!id) return;
      const target = document.getElementById(id);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
      history.replaceState(null, '', '#' + id);
    });
  }
})();
</script>
</body>
</html>
`;
}
