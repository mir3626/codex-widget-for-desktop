import {
  buildBrowserActionPlanFromCommand,
  planBrowserActionFromPrompt
} from "../dist/daemon/browser-action/index.js";

assertNoPlan("Browser Action 기능 알려줘", "browser");
assertNoPlan("what can Browser Action do?", "browser");
assertNoPlan("브라우저 액션이 뭔지 설명해줘", "browser");

assertPlan("현재 페이지 읽어줘", "browser", ["read"]);
assertPlan("지금 보고있는 페이지 설명해줘", "browser", ["read"]);
assertPlan("지금 보고있는 화면 설명해줘", "browser", ["read"]);
assertPlan("describe the current page", "browser", ["read"]);
assertPlan("Summarize the attached selection.", "browser", ["read"]);
assertPlan("현재 페이지에서 Learn more 링크 눌러줘", "browser", ["click"]);
assertPlan("새 채팅 눌러줘", "browser", ["click"], undefined, "새 채팅");
assertPlan("개념글 눌러서 재밌어보이는 글 보여줘", "browser", ["click", "click"], undefined, "개념글");
assertPlan("개념글 버튼 눌러달라는 뜻이야", "browser", ["click"], undefined, "button: 개념글");
assertPlan("글쓰기 버튼 누르고 특갤러들에게 소개하는 글을 써줘", "browser", ["click"], undefined, "button: 글쓰기");
assertPlan("재밌어보이는 글 아무거나 보여줘", "browser", ["click"], undefined, "link: 재밌어보이는 글");
assertPlan("재밌어보이는 글 누르기", "browser", ["click"], undefined, "link: 재밌어보이는 글");
assertPlan("검색창에 \"codex app-server\" 입력하고 검색해줘", "browser", ["type", "click"]);
assertPlan("playwright로 https://example.com 열어줘", "browser", ["navigate"], "playwright");
assertNavigate("구글 홈페이지 켜줘", "browser", "https://www.google.com/");
assertNavigate("구글 홈페이지 열어줘", "browser", "https://www.google.com/");
assertNavigate("왜 엉뚱한 답변하고있어. 구글 홈페이지 켜달라고했잖아.", "browser", "https://www.google.com/");
assertSearchNavigate("특이저 ㅁ 갤러리로 이동해줘", "browser");
assertPlan("뒤로가기", "browser", ["back"]);
assertPlan("앞으로가기", "browser", ["forward"]);
assertPlan("새로고침해줘", "browser", ["reload"]);
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

function assertPlan(text, mode, actions, adapterId, targetSummary) {
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
  if (targetSummary && plan.steps[0]?.targetSummary !== targetSummary) {
    throw new Error(`Unexpected target summary for ${text}: expected ${targetSummary}, got ${plan.steps[0]?.targetSummary}`);
  }
}

function assertNavigate(text, mode, url) {
  const plan = planBrowserActionFromPrompt({ text, mode });
  if (!plan) {
    throw new Error(`Navigation prompt did not produce a plan: ${text}`);
  }
  const action = plan.steps[0]?.action;
  if (action?.type !== "navigate" || action.url !== url) {
    throw new Error(`Navigation prompt did not resolve expected URL for ${text}: ${JSON.stringify(plan)}`);
  }
}

function assertSearchNavigate(text, mode) {
  const plan = planBrowserActionFromPrompt({ text, mode });
  if (!plan) {
    throw new Error(`Search navigation prompt did not produce a plan: ${text}`);
  }
  const action = plan.steps[0]?.action;
  if (action?.type !== "navigate" || !action.url.startsWith("https://www.google.com/search?q=")) {
    throw new Error(`URL-less navigation should use safe search navigation for ${text}: ${JSON.stringify(plan)}`);
  }
}
