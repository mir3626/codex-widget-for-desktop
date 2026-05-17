## Iteration iter-18: Browser View Graph v2 Prepared Context

Carryover: Iteration 17 hardened Browser Action runtime behavior, but the deeper live-product gap remains prepared page understanding. This iteration follows `docs/plans/browser-view-graph-v2-handoff.md` and records that Browser Action previously relied on prompt-time snapshot/observation; View Graph v2 is now the prepared page-understanding layer needed before any broader Browser Perception scheduler.

### iter-18-sprint-01-view-graph-v2-types-identity-and-builder

Goal: create a schema-versioned View Graph v2 module under `src/daemon/browser-perception/view-graph/` and bridge it into `BrowserObservation.viewGraph`.

Dependencies: iter-17 Browser Action runtime closure, existing `BrowserObservation.viewGraph`, Semantic Interface Browser Action adapter.

Expected scope: v2 graph types, identity/freshness/digest model, region/control/form/content-list graph construction, affordance index, diagnostics, redaction summary, and compatibility with existing Browser Action consumers.

Status: complete. Added the `browser-perception/view-graph` module, extended Browser Action view graph types, and made fallback BrowserObservation graph construction emit `schemaVersion: "browser-view-graph.v2"` with identity, route key, query signature, freshness, regions, controls, content lists, forms, edges, affordance index, diagnostics, and metadata-only redaction summaries.

### iter-18-sprint-02-extension-metadata-and-prepared-provider-context

Goal: enrich Browser Bridge observations and make the daemon retain prepared graph context before prompts arrive.

Dependencies: Sprint 01 builder, Browser Bridge snapshot ingress, ProviderRegistry.

Expected scope: additive extension metadata, DOM path/source-order/landmark/form/list/mutation hints, ProviderRegistry prepared observation, prompt fast path that can use fresh prepared v2 graph before waiting for a request-scoped snapshot.

Status: complete. Browser Bridge DOM snapshots now include additive metadata such as source order, DOM path hashes, parent hashes, frame/url hints, ARIA refs, nearest heading/landmark, form/list owners, computed visibility, sticky/overlay hints, and mutation revision timestamps. ProviderRegistry stores a prepared `BrowserObservation` and attaches its v2 graph back onto the DOM snapshot. Prompt Browser Action can use a fresh prepared v2 graph immediately before falling back to the existing fresh-snapshot wait.

### iter-18-sprint-03-semantic-evidence-and-target-resolution

Goal: feed v2 graph evidence into Semantic Interface and representative content resolution.

Dependencies: Sprints 01-02, Semantic Interface Browser Action adapter, target resolver.

Expected scope: graph action/risk/list/form/freshness evidence in Semantic Interface tier2 metadata, content-list representative target selection, and source/route metadata on extension commands.

Status: complete. Semantic Interface Browser Action projection now carries view action hints, risk hints, list/form ids, freshness, and view revisions. Representative content target resolution first consults View Graph v2 content-list representative evidence before falling back to older heuristics. Extension commands now carry route key/view revision/freshness metadata, with extension-side compatibility for route-key source validation when present.

### iter-18-sprint-04-smoke-dogfood-and-completion

Goal: prove View Graph v2 behavior and preserve existing Browser Action/Bridge/Semantic behavior.

Dependencies: Sprints 01-03 and verification scripts.

Expected scope: new `smoke:browser-view-graph-v2`, deterministic dogfood report, existing Browser Action/Bridge/Semantic smoke coverage, durable context/report updates.

Status: complete. Added `npm run smoke:browser-view-graph-v2` and `npm run dogfood:browser-view-graph-v2`; both pass locally. Existing focused smokes for Browser Action, Browser Action E2E control, prompt classification, Browser Bridge, extension, DOM provider, Semantic Interface, and Semantic Memory passed, followed by full `npm run lint`, `npm run smoke` including `build:web`, Browser Action/Semantic dogfood refresh, UTF-8/mojibake checks, project report refresh, and checkpoint.
