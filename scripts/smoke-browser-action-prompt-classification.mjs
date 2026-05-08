import {
  buildBrowserActionPlanFromCommand,
  planBrowserActionFromPrompt
} from "../dist/daemon/browser-action/index.js";

assertNoPlan("Browser Action 기능 알려줘", "browser");
assertNoPlan("what can Browser Action do?", "browser");
assertNoPlan("브라우저 액션이 뭔지 설명해줘", "browser");

assertPlan("현재 페이지 읽어줘", "browser", ["read"]);
assertPlan("현재 페이지에서 Learn more 링크 눌러줘", "browser", ["click"]);
assertPlan("검색창에 \"codex app-server\" 입력하고 검색해줘", "browser", ["type", "click"]);
assertPlan("playwright로 https://example.com 열어줘", "browser", ["navigate"], "playwright");
assertPlan("cdp로 새로고침해줘", "browser", ["reload"], "cdp");
assertNoPlan("Browser Action 기능 알려줘. 그리고 위험한 액션은 어떻게 승인돼?", "browser");

const directSearch = buildBrowserActionPlanFromCommand({
  actionSessionId: "prompt-classification-direct",
  command: {
    kind: "search",
    adapterId: "extension",
    targetText: "Search",
    text: "codex widget"
  }
});
if (directSearch.steps.length !== 2 || directSearch.steps[0].action.type !== "type" || directSearch.steps[1].action.type !== "click") {
  throw new Error(`Direct search command did not produce a type+click plan: ${JSON.stringify(directSearch)}`);
}

const directNavigate = buildBrowserActionPlanFromCommand({
  actionSessionId: "prompt-classification-direct",
  command: {
    kind: "navigate",
    url: "example.com"
  }
});
if (directNavigate.steps[0].action.type !== "navigate" || directNavigate.steps[0].action.url !== "https://example.com") {
  throw new Error(`Direct navigate command did not normalize URL: ${JSON.stringify(directNavigate)}`);
}

console.log("browser action prompt classification smoke ok");

function assertNoPlan(text, mode) {
  const plan = planBrowserActionFromPrompt({ text, mode });
  if (plan) {
    throw new Error(`Informational prompt was misclassified as Browser Action execution: ${JSON.stringify(plan)}`);
  }
}

function assertPlan(text, mode, actions, adapterId) {
  const plan = planBrowserActionFromPrompt({ text, mode });
  if (!plan) {
    throw new Error(`Browser Action prompt did not produce a plan: ${text}`);
  }
  const actual = plan.steps.map((step) => step.action.type);
  if (JSON.stringify(actual) !== JSON.stringify(actions)) {
    throw new Error(`Unexpected actions for ${text}: expected ${JSON.stringify(actions)}, got ${JSON.stringify(actual)}`);
  }
  if (adapterId && plan.adapterId !== adapterId) {
    throw new Error(`Unexpected adapter for ${text}: expected ${adapterId}, got ${plan.adapterId}`);
  }
}
