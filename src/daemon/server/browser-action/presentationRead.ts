import {
  redactBrowserActionSecret,
  type BrowserObservation
} from "../../browser-action/index.js";

export function renderBrowserReadResponse(observation: BrowserObservation | undefined, promptText: string): string {
  const korean = /[가-힣]/.test(promptText);
  if (!observation) {
    return korean
      ? "현재 브라우저 페이지 관찰 결과를 읽지 못했습니다. Browser Bridge 연결과 현재 사이트 권한을 확인해 주세요."
      : "I could not read the current browser observation. Check the Browser Bridge connection and site permission.";
  }

  const title = observation.title || readHostLabel(observation.url) || (korean ? "제목 없음" : "Untitled page");
  const url = observation.url || "";
  const bullets = extractBrowserTextBullets(observation.text, korean);
  const controls = observation.elements
    .filter((element) => element.visible && (element.role === "button" || element.role === "link" || element.editable))
    .map((element) => element.label || element.text || element.placeholder || element.title || element.href || element.selector)
    .filter(Boolean)
    .slice(0, 5);

  const lines = korean
    ? [
        `현재 보고 있는 페이지는 **${title}**입니다.`,
        url ? `URL: ${url}` : undefined,
        "",
        bullets.length > 0 ? "주요 내용:" : "페이지 본문 텍스트는 거의 비어 있거나 읽을 수 없습니다.",
        ...bullets.map((item) => `- ${item}`),
        controls.length > 0 ? "" : undefined,
        controls.length > 0 ? `보이는 주요 조작 요소: ${controls.join(", ")}` : undefined
      ]
    : [
        `The current browser page is **${title}**.`,
        url ? `URL: ${url}` : undefined,
        "",
        bullets.length > 0 ? "Main content:" : "The page body text is empty or unavailable.",
        ...bullets.map((item) => `- ${item}`),
        controls.length > 0 ? "" : undefined,
        controls.length > 0 ? `Visible controls: ${controls.join(", ")}` : undefined
      ];
  return lines.filter((line) => line !== undefined).map((line) => String(redactBrowserActionSecret(line))).join("\n");
}

export function readHostLabel(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function extractBrowserTextBullets(value: string | undefined, korean: boolean): string[] {
  const mainText = String(value ?? "")
    .split(/\n\s*Interactive elements:/i)[0]
    .replace(/\s+/g, " ")
    .trim();
  if (!mainText) {
    return [];
  }
  const chunks = mainText
    .split(korean ? /(?<=[.!?。！？])\s+|(?:\s{2,})/ : /(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 12);
  const source = chunks.length > 0 ? chunks : [mainText];
  const seen = new Set<string>();
  const bullets: string[] = [];
  for (const item of source) {
    const normalized = item.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    bullets.push(item.length > 220 ? `${item.slice(0, 217).trim()}...` : item);
    if (bullets.length >= 4) {
      break;
    }
  }
  return bullets;
}
