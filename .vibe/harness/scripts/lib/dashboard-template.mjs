export function renderIconSvg() {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#111827"/><path d="M16 34h11l5-16 6 28 5-12h5" fill="none" stroke="#2dd4bf" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

export function renderShellHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vibe Dashboard</title>
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
code,time,.mono{font-family:"Geist Mono","SF Mono",Consolas,monospace;font-size:13px;font-weight:500}
.muted{color:var(--muted)}
.skip-link{position:absolute;left:32px;top:24px;z-index:20;transform:translateY(-160%);background:var(--glass-bg-flat);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:10px 16px;backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px)}
.skip-link:focus{transform:translateY(0)}
.outer-frame{border:0;border-radius:0;padding:0;min-height:100vh;background:transparent;position:relative;overflow:visible}
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
main.container{padding-top:90px;padding-bottom:0;padding-left:24px;padding-right:24px}
.hero{padding:46px 0 54px;max-width:920px}
.eyebrow{font-size:11px;font-weight:600;letter-spacing:0;text-transform:uppercase;color:var(--muted);margin:0 0 16px}
h1{font-size:48px;line-height:1.05;font-weight:650;letter-spacing:0;margin:0 0 20px;color:var(--text)}
h2{font-size:28px;line-height:1.2;font-weight:600;letter-spacing:0;color:var(--text);margin:0}
h3{font-size:16px;line-height:1.4;font-weight:600;color:var(--text);margin:0}
.subtitle{font-size:17px;line-height:1.55;color:var(--secondary);margin:0 0 24px;max-width:720px}
.meta-row{display:flex;flex-wrap:wrap;align-items:center;gap:12px 24px;font-size:13px;color:var(--muted);font-family:"Geist Mono","SF Mono",Consolas,monospace}
.meta-row>span{display:inline-flex;align-items:center;gap:8px}
.report-grid{display:grid;grid-template-columns:7fr 6fr;gap:40px;align-items:start}
.col-main{min-width:0}
.col-side{min-width:0;display:flex;flex-direction:column;gap:28px}
.col-side .report-section{margin-top:0}
.report-section{margin-top:56px;scroll-margin-top:96px;content-visibility:auto;contain-intrinsic-size:0 600px}
.report-section.wrap{padding:30px 0 0;border-top:1px solid var(--line);border-radius:0;background:transparent;box-shadow:none}
.report-section.wrap .section-heading{margin-bottom:20px}
.report-section.wrap .sprint-grid{margin-top:4px}
.report-section.wrap .sprint-card,.report-section.wrap .day{background:var(--surface);border-color:var(--line);box-shadow:var(--inner-line),0 8px 24px rgba(31,35,31,0.06)}
.section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:24px}
.section-heading span{color:var(--muted);font-size:13px;font-weight:500}
.phase-list{display:flex;flex-wrap:wrap;gap:10px}
.metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px}
.metric-card,.sprint-card,.day,.decision-groups{background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--inner-line),var(--surface-shadow)}
.metric-card{padding:24px;transition:transform .24s var(--motion),border-color .24s var(--motion),box-shadow .24s var(--motion);position:relative;overflow:hidden;text-align:left}
.metric-card::before{content:"";position:absolute;left:18px;right:18px;top:0;height:2px;background:var(--accent);opacity:.5;transform:scaleX(.42);transform-origin:left center;transition:transform .32s var(--motion),opacity .32s var(--motion)}
.metric-card:hover{transform:translateY(-2px);border-color:var(--line-strong);box-shadow:var(--inner-line),0 18px 44px rgba(31,35,31,0.1)}
.metric-card:hover::before{transform:scaleX(1);opacity:.72}
.metric-card p{font-size:11px;font-weight:600;letter-spacing:0;text-transform:uppercase;color:var(--muted);margin:0 0 16px}
.metric-card strong{display:block;font-size:36px;line-height:1;font-weight:600;font-variant-numeric:tabular-nums;color:var(--text);margin-bottom:12px;letter-spacing:0}
.metric-card span{color:var(--secondary);font-size:13px;font-weight:500}
.metric-card code{display:block;color:var(--text);word-break:break-word;margin-bottom:12px}
.progress-wrap{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;color:var(--secondary);font-size:13px;font-family:"Geist Mono","SF Mono",Consolas,monospace}
.progress-bar{height:6px;border-radius:3px;overflow:hidden;background:rgba(60,60,67,0.1);border:0}
.progress-bar span{display:block;height:100%;background:linear-gradient(90deg,#0f766e,#32a399)}
.sprint-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}
.sprint-card{padding:24px;transition:transform .24s var(--motion),border-color .24s var(--motion),box-shadow .24s var(--motion)}
.sprint-card:hover{transform:translateY(-2px);border-color:var(--line-strong);box-shadow:var(--inner-line),0 18px 44px rgba(31,35,31,0.1)}
.card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px}
.card-head h3{font-family:"Geist Mono","SF Mono",Consolas,monospace;font-size:12px;font-weight:500;letter-spacing:0;word-break:break-word;color:var(--text)}
.sprint-card>p{color:var(--secondary);margin:0;font-size:14px}
.status-badge{display:inline-flex;align-items:center;border-radius:999px;padding:4px 11px;font-size:10px;font-weight:600;letter-spacing:0;text-transform:uppercase;white-space:nowrap;border:1px solid transparent;box-shadow:inset 0 1px 0 rgba(255,255,255,0.65),0 1px 2px rgba(0,0,0,0.05)}
.status-badge[data-status="complete"]{background:linear-gradient(135deg,rgba(52,199,89,0.28),rgba(52,199,89,0.14));color:var(--complete-text);border-color:rgba(52,199,89,0.42)}
.status-badge[data-status="in-progress"]{background:linear-gradient(135deg,rgba(0,122,255,0.26),rgba(0,122,255,0.12));color:var(--progress-text);border-color:rgba(0,122,255,0.38)}
.status-badge[data-status="partial"]{background:linear-gradient(135deg,rgba(255,149,0,0.3),rgba(255,149,0,0.14));color:var(--partial-text);border-color:rgba(255,149,0,0.42)}
.status-badge[data-status="failed"]{background:linear-gradient(135deg,rgba(255,59,48,0.28),rgba(255,59,48,0.14));color:var(--failed-text);border-color:rgba(255,59,48,0.42)}
.status-badge[data-status="idle"]{background:linear-gradient(135deg,rgba(120,120,128,0.22),rgba(120,120,128,0.1));color:var(--idle-text);border-color:rgba(120,120,128,0.28)}
.day{margin-bottom:14px;overflow:hidden;transition:border-color .24s var(--motion),box-shadow .24s var(--motion)}
.day:hover{border-color:var(--border-strong)}
.day>summary{cursor:pointer;padding:15px 22px;font-weight:600;color:var(--text);list-style:none;display:flex;align-items:center;gap:12px;font-size:13px;font-family:"Geist Mono","SF Mono",Consolas,monospace;letter-spacing:0}
.day>summary::-webkit-details-marker{display:none}
.day>summary::before{content:"";width:0;height:0;border-top:5px solid transparent;border-bottom:5px solid transparent;border-left:7px solid var(--muted);transition:transform .24s var(--motion);flex-shrink:0}
.day[open]>summary::before{transform:rotate(90deg)}
.day[open]>summary{border-bottom:1px solid var(--border)}
.timeline{padding:4px 0}
.event{display:grid;grid-template-columns:76px 150px minmax(0,1fr);gap:16px;padding:11px 22px;align-items:start;transition:background .15s ease}
.event:hover{background:rgba(255,255,255,0.35)}
.event+.event{border-top:1px solid rgba(60,60,67,0.08)}
.event time{color:var(--muted);padding-top:1px;font-size:12px}
.event.muted{color:var(--muted);grid-template-columns:1fr;padding:14px 22px}
.event .status-badge{justify-content:center;width:100%}
.event-summary{color:var(--secondary);line-height:1.5;font-size:13px;word-break:break-word}
.dashboard-metrics.wrap{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.dashboard-metrics.wrap .card-wide{grid-column:1 / -1}
.dashboard-metrics button.metric-card{width:100%}
.dashboard-metrics button.metric-card:hover{background:rgba(255,255,255,0.82)}
.eyebrow-sm{font-size:11px;font-weight:600;letter-spacing:0;text-transform:uppercase;color:var(--muted);margin:0 0 16px}
.iteration-card h3{font-size:20px;margin-bottom:10px}
.iteration-card .progress-wrap{margin-top:18px}
.current-sprint-card .card-head{margin-bottom:0}
.decision-groups{padding:16px 22px}
.decision-entry{display:grid;grid-template-columns:76px 124px minmax(0,1fr);gap:14px;align-items:start;padding:14px 0;border-bottom:1px solid var(--border)}
.decision-entry .status-badge{justify-content:center;width:100%}
.decision-entry:last-child{border-bottom:0}
.decision-entry time{color:var(--muted);font-size:12px}
.decision-entry p{margin:0;color:var(--text);font-size:14px;line-height:1.6}
.empty-state{color:var(--muted);margin:0}
.empty-preview{display:grid;gap:14px}
.empty-preview .empty-state{padding:12px 14px;border:1px dashed var(--line-strong);border-radius:14px;background:var(--surface-quiet)}
.preview-row{display:flex;flex-wrap:wrap;gap:10px}
.sprint-card[data-demo="true"],.decision-entry[data-demo="true"],.event[data-demo="true"]{opacity:.78}
.banner{display:none;margin:28px 0 0;padding:14px 16px;border:1px solid var(--border);background:rgba(255,255,255,0.46);border-radius:18px;box-shadow:var(--glass-highlight),var(--glass-depth);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);font-size:13px;color:var(--secondary)}
.banner.show{display:flex;justify-content:space-between;gap:12px;align-items:center}
.filter-chip{padding:6px 14px;border-radius:999px;color:var(--muted);font-size:12px;font-weight:500;background:transparent;border:1px solid var(--line);transition:background .24s var(--motion),color .24s var(--motion),border-color .24s var(--motion),transform .24s var(--motion)}
.filter-chip:hover{color:var(--text);border-color:var(--line-strong);transform:translateY(-1px)}
.expand-actions button,.modal button{color:var(--secondary);font-size:13px;font-weight:500;padding:8px 16px;border-radius:999px;background:var(--surface);border:1px solid var(--line);box-shadow:var(--inner-line),0 6px 16px rgba(31,35,31,0.06);transition:background .24s var(--motion),color .24s var(--motion),border-color .24s var(--motion),transform .24s var(--motion)}
.expand-actions button:hover,.modal button:hover{color:var(--text);background:#fff;border-color:var(--line-strong);transform:translateY(-1px)}
.toasts{position:fixed;right:24px;bottom:24px;display:grid;gap:10px;z-index:30}
.toast{width:320px;background:rgba(255,255,255,0.78);color:var(--text);border:1px solid var(--border);border-radius:18px;padding:14px 16px;box-shadow:var(--glass-highlight),0 20px 48px rgba(60,60,67,0.18);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);animation:fade 8s forwards;font-size:13px;line-height:1.5}
.toast strong{font-weight:600;display:block;margin-bottom:2px}
@keyframes fade{0%,85%{opacity:1}100%{opacity:0}}
.modal{position:fixed;inset:0;background:rgba(18,18,20,0.36);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);display:none;align-items:center;justify-content:center;padding:20px;z-index:40}
.modal.open{display:flex}
.modal-card{background:linear-gradient(135deg,rgba(245,245,247,0.78) 0%,rgba(220,220,225,0.62) 50%,rgba(200,200,205,0.66) 100%);border:1px solid rgba(160,160,170,0.22);border-radius:20px;max-width:620px;width:100%;padding:32px;box-shadow:var(--glass-highlight),0 28px 64px rgba(0,0,0,0.2)}
.modal-card h2{font-size:18px;font-weight:600;margin:0 0 14px;color:var(--text)}
#riskList p{margin:10px 0;font-size:13px;color:var(--secondary);line-height:1.55}
#riskList strong{color:var(--text);font-weight:600}
.modal-card button{margin-top:16px}
@media (max-width:1024px){h1{font-size:44px}.nav-anchors{display:none}.report-grid{grid-template-columns:1fr;gap:0}.col-side{gap:48px}.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:640px){body{padding:8px}.outer-frame{padding:12px;border-radius:16px}.site-nav{padding:10px 14px;border-radius:20px;flex-wrap:wrap;gap:12px;margin-bottom:48px}.nav-meta{display:none}h1{font-size:32px}.hero{padding:32px 0 48px}.report-section{margin-top:48px}.section-heading{display:block}.section-heading span{display:block;margin-top:8px}.event{grid-template-columns:1fr;gap:8px}.decision-entry{grid-template-columns:1fr;gap:8px}.metric-card strong{font-size:36px}.subtitle{font-size:15px}.toasts{right:16px;left:16px}.toast{width:auto}}
@media (prefers-reduced-motion:reduce){.brand-mark .pulse-line{animation:none}.metric-card,.sprint-card,.nav-anchors a,.filter-chip,.expand-actions button,.modal button{transition:none}}
</style>
</head>
<body>
<a class="skip-link" href="#content">Skip to content</a>
<div class="outer-frame">
<nav class="site-nav" aria-label="Dashboard navigation">
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
    <li><a href="#phases">Phases</a></li>
    <li><a href="#sprints">Sprints</a></li>
    <li><a href="#timeline">Timeline</a></li>
    <li><a href="#attention">Attention</a></li>
  </ul>
  <div class="nav-meta" aria-label="Dashboard status">
    <span id="navIter">idle</span>
    <span>/</span>
    <span id="navUpdated">unknown</span>
    <span id="conn" class="conn connected"><span id="connBadge" class="status-badge" data-status="complete">connected</span></span>
  </div>
</nav>
<main id="content" class="container">
<section class="hero">
  <p class="eyebrow">Live Dashboard</p>
  <h1>Vibe Dashboard</h1>
  <p id="heroSubtitle" class="subtitle">Idle - run /vibe-init to start a project.</p>
  <div class="meta-row" aria-label="Dashboard metadata">
    <span>Updated <time id="heroUpdated" datetime="">unknown</time></span>
    <span>Iteration: <span id="heroIteration">idle</span></span>
    <span>Status: <span id="heroStatus" class="status-badge" data-status="idle">idle</span></span>
  </div>
  <div id="permissionBanner" class="banner">
    <span>Enable desktop notifications for urgent attention requests.</span>
    <button id="enableNotifications" class="filter-chip" type="button">Enable notifications</button>
  </div>
</section>
<div class="report-grid">
  <div class="col-main">
    <section id="phases" data-section="phases" class="report-section wrap">
      <div class="section-heading"><h2>Phase Progress</h2><span id="phaseContext">0 phases</span></div>
      <div id="phaseList" class="phase-list" aria-label="Phase progress"></div>
    </section>
    <section id="sprints" data-section="sprints" class="report-section wrap">
      <div class="section-heading"><h2>Sprint Roadmap</h2><span id="sprintContext">0 sprints</span></div>
      <div id="sprintGrid" class="sprint-grid"></div>
    </section>
    <section id="timeline" data-section="timeline" class="report-section wrap">
      <div class="section-heading"><h2>Timeline</h2><span>Activity by day</span></div>
      <div id="days"></div>
    </section>
  </div>
  <aside class="col-side">
    <section id="attention" data-section="attention" class="report-section wrap">
      <div class="section-heading"><h2>Attention</h2><span id="attentionContext">0 recent</span></div>
      <div id="attentionList" class="decision-groups"></div>
    </section>
    <section class="report-section wrap iteration-card" aria-label="Iteration summary">
      <p id="iterId" class="eyebrow-sm">ITERATION</p>
      <h3 id="iterLabel">No active iteration</h3>
      <span id="iterGoal" class="muted"></span>
      <div class="progress-wrap" aria-label="Iteration sprint progress">
        <div class="progress-bar"><span id="iterBarFill" style="width:0%"></span></div>
        <span id="iterPercent">0%</span>
      </div>
      <span id="iterProgressText" class="muted">0 / 0 sprints</span>
    </section>
    <section class="report-section wrap current-sprint-card" id="currentSprintCard" data-status="idle" aria-label="Current sprint summary">
      <p class="eyebrow-sm">Current Sprint</p>
      <div class="card-head">
        <h3><code id="sprintId">idle</code></h3>
        <span id="sprintStatus" class="status-badge" data-status="idle">idle</span>
      </div>
    </section>
    <section class="metric-grid dashboard-metrics report-section wrap" aria-label="Dashboard metrics">
      <button class="metric-card" id="riskButton" type="button">
        <p>Open Risks</p>
        <strong id="riskCount">0</strong>
        <span>pending</span>
      </button>
      <article class="metric-card">
        <p>Tokens Today</p>
        <strong id="tokens">n/a</strong>
        <span>cumulative</span>
      </article>
      <article class="metric-card card-wide">
        <p>Latest Test</p>
        <strong id="latestTest">n/a</strong>
        <span id="latestTestDetail"></span>
      </article>
    </section>
  </aside>
</div>
</main>
<div class="toasts" id="toasts"></div>
<div class="modal" id="riskModal" role="dialog" aria-modal="true" aria-labelledby="riskModalTitle">
  <div class="modal-card">
    <h2 id="riskModalTitle">Open pending risks</h2>
    <div id="riskList"></div>
    <button id="closeRisks" type="button">Close</button>
  </div>
</div>
</div>
<script>
const cache = new Map();
let state = null;
let retries = 0;
let lastPing = Date.now();
let es = null;
let reconnectTimer = null;
let connectionTimer = null;
let attentionEvents = [];
const today = new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const $ = (id) => document.getElementById(id);
function normalizeStatus(value){const raw=String(value??'idle').toLowerCase();if(raw==='passed'||raw==='complete'||raw==='completed'||raw==='resolved')return'complete';if(raw==='in_progress'||raw==='in-progress'||raw.endsWith('-in-progress')||raw==='active'||raw==='running')return'in-progress';if(raw==='partial'||raw==='blocked'||raw==='pending-risk'||raw.startsWith('pending-risk'))return'partial';if(raw==='failed'||raw==='open'||raw==='error')return'failed';return'idle'}
function statusFromEvent(type){const raw=String(type??'');if(raw.startsWith('sprint-completed'))return'complete';if(raw.startsWith('sprint-failed')||raw==='test-failed'||raw.startsWith('attention'))return'failed';if(raw.startsWith('phase'))return'in-progress';if(raw.startsWith('pending-risk'))return'partial';return'idle'}
function summary(evt){const p=evt.payload||{};return p.summary||p.detail||p.title||(p.sprintId?String(p.sprintId)+' '+(p.status||''):evt.type)}
function timePart(ts){const d=new Date(ts);return Number.isFinite(d.getTime())?d.toISOString().slice(11,19):''}
function escapeHtml(v){return String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;")}
function renderBadge(label,status){return '<span class="status-badge" data-status="'+escapeHtml(normalizeStatus(status))+'">'+escapeHtml(label)+'</span>'}
function renderEventBadge(type){return '<span class="status-badge" data-status="'+escapeHtml(statusFromEvent(type))+'">'+escapeHtml(type)+'</span>'}
async function fetchJson(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(url+' '+r.status);return r.json()}
function currentIterationEntry(iter){const cur=iter?.currentIteration;return cur&&Array.isArray(iter?.iterations)?iter.iterations.find((e)=>e&&e.id===cur):null}
function iterationProgress(iter){const entry=currentIterationEntry(iter);if(!entry)return{entry:null,done:0,total:0,pct:0};const done=Array.isArray(entry.completedSprints)?entry.completedSprints.length:0;const total=Array.isArray(entry.plannedSprints)?entry.plannedSprints.length:0;const pct=total?Math.round((done/total)*100):0;return{entry,done,total,pct}}
function renderIteration(iter){const cur=iter?.currentIteration;const progress=iterationProgress(iter);const card=document.querySelector('.iteration-card');if(!progress.entry){if(card)card.dataset.demo='true';$('iterId').textContent='ITERATION PREVIEW';$('iterLabel').textContent='Sample iteration';$('iterGoal').textContent='Define scope, deliver one slice, then review evidence.';$('iterProgressText').textContent='1 / 3 sample sprints';$('iterPercent').textContent='33%';$('iterBarFill').style.width='33%';return}if(card)delete card.dataset.demo;$('iterId').textContent=cur||progress.entry.id;$('iterLabel').textContent=progress.entry.label||progress.entry.id;$('iterGoal').textContent=progress.entry.goal||'';$('iterProgressText').textContent=progress.done+' / '+progress.total+' sprints';$('iterPercent').textContent=progress.pct+'%';$('iterBarFill').style.width=progress.pct+'%'}
function fmtUpdated(iso){if(!iso)return'unknown';try{const d=new Date(iso);if(!Number.isFinite(d.getTime()))return'unknown';return d.toISOString().slice(11,19)+' UTC'}catch{return'unknown'}}
function renderPhaseBadge(node){return renderBadge(node.id, node.state)}
function renderSprintCard(node){const status=normalizeStatus(node.state);return '<article class="sprint-card" data-sprint-id="'+escapeHtml(node.id)+'"><div class="card-head"><h3>'+escapeHtml(node.id)+'</h3>'+renderBadge(node.state||'idle',status)+'</div><p>'+escapeHtml(node.id)+' is '+escapeHtml(status.replace('-', ' '))+'.</p></article>'}
function renderHero(next){const cur=next.iteration?.currentIteration||'idle';const progress=iterationProgress(next.iteration);const sprint=next.currentSprint?.id||'idle';if(sprint==='idle'&&!next.iteration?.currentIteration){$('heroSubtitle').textContent='Idle - run /vibe-init to start a project.'}else{$('heroSubtitle').textContent=sprint+' / '+cur+' / passed '+progress.done+' / '+progress.total}$('heroIteration').textContent=cur;$('navIter').textContent=cur;$('heroUpdated').textContent=fmtUpdated(next.updatedAt);$('heroUpdated').setAttribute('datetime',next.updatedAt||'');$('navUpdated').textContent=fmtUpdated(next.updatedAt);const status=next.currentSprint?.status||'idle';$('heroStatus').dataset.status=normalizeStatus(status);$('heroStatus').textContent=status}
function renderState(next){state=next;renderHero(next);const phases=Array.isArray(next.roadmap?.phases)?next.roadmap.phases:[];const sprints=Array.isArray(next.roadmap?.sprints)?next.roadmap.sprints:[];$('phaseContext').textContent=phases.length+' phases';$('phaseList').innerHTML=phases.map(renderPhaseBadge).join('')||'<div class="empty-preview" data-demo="true"><p class="empty-state">No phases detected. Showing a layout-safe preview.</p><div class="preview-row">'+renderBadge('Phase 0','complete')+renderBadge('Phase 1','in-progress')+renderBadge('Phase 2','idle')+'</div></div>';$('sprintContext').textContent=sprints.length+' sprints';$('sprintGrid').innerHTML=sprints.map(renderSprintCard).join('')||'<div class="empty-preview" data-demo="true"><p class="empty-state">No sprints detected. Showing a layout-safe preview.</p><article class="sprint-card" data-sprint-id="sample-contract" data-demo="true"><div class="card-head"><h3>sample-contract</h3>'+renderBadge('passed','passed')+'</div><p>Capture scope and acceptance evidence.</p></article><article class="sprint-card" data-sprint-id="sample-build" data-demo="true"><div class="card-head"><h3>sample-build</h3>'+renderBadge('in_progress','in-progress')+'</div><p>Build the first inspectable slice.</p></article></div>';$('sprintId').textContent=next.currentSprint?.id||'idle';$('sprintStatus').textContent=next.currentSprint?.status||'idle';$('sprintStatus').dataset.status=normalizeStatus(next.currentSprint?.status);const sprintCard=$('currentSprintCard');if(sprintCard)sprintCard.dataset.status=normalizeStatus(next.currentSprint?.status);$('riskCount').textContent=String(Array.isArray(next.risks)?next.risks.length:0);$('tokens').textContent=String(next.tokens?.todayTotal??next.tokens?.total??'n/a');$('latestTest').textContent=next.latestTest?.type??'n/a';$('latestTestDetail').textContent=next.latestTest?.summary??'';renderIteration(next.iteration);renderRisks(Array.isArray(next.risks)?next.risks:[])}
function renderRisks(risks){$('riskList').innerHTML=risks.length===0?'<div class="empty-preview" data-demo="true"><p class="muted">No open risks. Showing a layout-safe preview.</p><p><strong>sample-risk</strong><br>Example: screenshot evidence still needs review.</p></div>':risks.map((risk)=>'<p><strong>'+escapeHtml(risk.id)+'</strong><br>'+escapeHtml(risk.text||'')+'</p>').join('')}
async function renderDays(){const data=await fetchJson('/api/daily-index');const dates=data.dates.length?data.dates:[today];$('days').innerHTML=dates.map((date)=>{const safeDate=escapeHtml(date);return '<details class="day" data-date="'+safeDate+'" '+(date===today?'open':'')+'><summary>'+safeDate+'</summary><div class="timeline" data-body="'+safeDate+'"></div></details>'}).join('');for(const detail of document.querySelectorAll('details.day')){detail.addEventListener('toggle',()=>{if(detail.open)loadDate(detail.dataset.date)});if(detail.open)loadDate(detail.dataset.date)}}
function renderSampleEvents(){return '<div class="event muted">No events yet. Showing a layout-safe preview.</div><div class="event" data-demo="true"><time>--:--:--</time><span>'+renderEventBadge('session-started')+'</span><span class="event-summary">Sample session opened and context loaded.</span></div><div class="event" data-demo="true"><time>--:--:--</time><span>'+renderEventBadge('sprint-completed')+'</span><span class="event-summary">Sample sprint completed with verification evidence.</span></div>'}
async function loadDate(date){if(!date)return;const body=document.querySelector('[data-body="'+date+'"]');if(!body)return;if(cache.has(date)){body.innerHTML=cache.get(date);return}body.innerHTML='<div class="event muted">loading</div>';try{const data=await fetchJson('/api/daily/'+date);const html=data.events.map((evt)=>'<div class="event"><time datetime="'+escapeHtml(evt.ts||'')+'">'+escapeHtml(timePart(evt.ts))+'</time><span>'+renderEventBadge(evt.type)+'</span><span class="event-summary">'+escapeHtml(summary(evt))+'</span></div>').join('')||renderSampleEvents();cache.set(date,html);body.innerHTML=html}catch{body.innerHTML=renderSampleEvents()}}
async function refresh(){const next=await fetchJson('/api/state');renderState(next);cache.delete(today);await loadDate(today)}
function renderAttention(){const recent=attentionEvents.slice(0,3);$('attentionContext').textContent=recent.length+' recent';$('attentionList').innerHTML=recent.length===0?'<div class="empty-preview" data-demo="true"><p class="empty-state">No attention requests yet. Showing a layout-safe preview.</p><div class="decision-entry" data-demo="true"><time>--:--:--</time>'+renderEventBadge('attention-needed')+'<p>Sample permission request appears here.</p></div></div>':recent.map((evt)=>'<div class="decision-entry"><time datetime="'+escapeHtml(evt.ts||'')+'">'+escapeHtml(timePart(evt.ts))+'</time>'+renderEventBadge(evt.type||'attention-needed')+'<p>'+escapeHtml(evt.title||evt.detail||'Attention requested')+'</p></div>').join('')}
async function loadAttention(){try{const data=await fetchJson('/api/attention');attentionEvents=Array.isArray(data.events)?data.events.slice().reverse():[];renderAttention()}catch{renderAttention()}}
function pushToast(evt){const el=document.createElement('div');el.className='toast';el.innerHTML='<strong>'+escapeHtml(evt.title||'Attention')+'</strong><br>'+escapeHtml(evt.detail||'Attention requested');$('toasts').prepend(el);setTimeout(()=>el.remove(),8200);while($('toasts').children.length>5){$('toasts').lastElementChild.remove()}}
function handleAttention(evt){attentionEvents=[evt].concat(attentionEvents).slice(0,20);renderAttention();if(window.Notification&&Notification.permission==='granted'){const note=new Notification(evt.title||'User attention required',{body:evt.detail||'',icon:'/icon.svg',tag:evt.id,requireInteraction:evt.severity==='urgent'});note.onclick=()=>window.focus()}else{pushToast(evt)}}
function setConnection(label){const badge=$('connBadge');const status=label==='connected'?'complete':label==='reconnecting'?'partial':'failed';$('conn').className='conn '+label;badge.dataset.status=status;badge.textContent=label==='dead'?'disconnected':label}
function connect(){if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null}if(es){es.close()}es=new EventSource('/events');es.onopen=()=>{retries=0;lastPing=Date.now();setConnection('connected')};es.addEventListener('state-updated',()=>{lastPing=Date.now();refresh().catch(console.error)});es.addEventListener('attention',(ev)=>{lastPing=Date.now();handleAttention(JSON.parse(ev.data))});es.onerror=()=>{if(es){es.close()}retries+=1;setConnection(retries>3?'dead':'reconnecting');reconnectTimer=setTimeout(connect,Math.min(10000,500*retries))}}
function startConnectionWatch(){if(connectionTimer)return;connectionTimer=setInterval(()=>{if(es&&es.readyState===1){lastPing=Date.now()}else if(Date.now()-lastPing>40000){setConnection('reconnecting')}},30000)}
function setupSmoothScroll(){const prefersReduced=typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;for(const link of document.querySelectorAll('a[href^="#"]')){link.addEventListener('click',(event)=>{const id=link.getAttribute('href').slice(1);if(!id)return;const target=document.getElementById(id);if(!target)return;event.preventDefault();target.scrollIntoView({behavior:prefersReduced?'auto':'smooth',block:'start'});history.replaceState(null,'','#'+id)})}}
async function boot(){if('Notification'in window&&Notification.permission==='default'){$('permissionBanner').classList.add('show')}$('enableNotifications').onclick=()=>window.Notification&&Notification.requestPermission().then(()=>$('permissionBanner').classList.remove('show'));$('riskButton').onclick=()=>$('riskModal').classList.add('open');$('closeRisks').onclick=()=>$('riskModal').classList.remove('open');$('riskModal').addEventListener('click',(event)=>{if(event.target===$('riskModal'))$('riskModal').classList.remove('open')});setupSmoothScroll();renderAttention();await refresh();await renderDays();await loadAttention();startConnectionWatch();connect()}
boot().catch((error)=>{document.body.innerHTML='<pre>'+escapeHtml(error.message)+'</pre>'});
</script>
</body>
</html>`;
}
