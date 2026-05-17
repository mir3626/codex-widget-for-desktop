import type { BrowserChromeCommandName } from "./commandBridge.js";

export type BrowserChromePromptControl = {
  command: BrowserChromeCommandName;
  payload: Record<string, unknown>;
  label: string;
  reason: string;
};

export function resolveBrowserChromePromptControl(text: string): BrowserChromePromptControl | undefined {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized || !/(?:탭|tab)/i.test(normalized)) {
    return undefined;
  }
  if (!/(?:전환|이동|바꿔|활성|선택|보여|switch|activate|focus|go\s*to|move\s*to)/i.test(normalized)) {
    return undefined;
  }
  const ordinal = readTabOrdinal(normalized);
  if (ordinal === undefined) {
    return undefined;
  }
  const index = ordinal - 1;
  return {
    command: "tab.activate",
    payload: {
      index,
      ordinal,
      focusWindow: true,
      prompt: normalized,
      executionPolicy: {
        preferredSurface: "browser_chrome_background",
        nativeInput: false,
        hotkey: false,
        pointer: false
      }
    },
    label: readKoreanOrdinalLabel(ordinal) ?? `tab ${ordinal}`,
    reason: "Resolved browser tab switch prompt to Browser Chrome background tab activation."
  };
}

function readTabOrdinal(text: string): number | undefined {
  const patterns: Array<[RegExp, number]> = [
    [/(?:첫|첫번|첫번째|첫째|1st|first)/i, 1],
    [/(?:두|두번|두번째|둘째|2nd|second)/i, 2],
    [/(?:세|세번|세번째|셋째|3rd|third)/i, 3],
    [/(?:네|네번|네번째|넷째|4th|fourth)/i, 4],
    [/(?:다섯|다섯번|다섯번째|5th|fifth)/i, 5],
    [/(?:여섯|여섯번|여섯번째|6th|sixth)/i, 6],
    [/(?:일곱|일곱번|일곱번째|7th|seventh)/i, 7],
    [/(?:여덟|여덟번|여덟번째|8th|eighth)/i, 8],
    [/(?:아홉|아홉번|아홉번째|9th|ninth)/i, 9]
  ];
  for (const [pattern, ordinal] of patterns) {
    if (pattern.test(text)) {
      return ordinal;
    }
  }
  const numeric = text.match(/(?:^|\D)([1-9])\s*(?:번(?:째)?\s*)?(?:탭|tab)/i)?.[1];
  return numeric ? Number(numeric) : undefined;
}

function readKoreanOrdinalLabel(ordinal: number): string | undefined {
  return [
    "첫번째 탭",
    "두번째 탭",
    "세번째 탭",
    "네번째 탭",
    "다섯번째 탭",
    "여섯번째 탭",
    "일곱번째 탭",
    "여덟번째 탭",
    "아홉번째 탭"
  ][ordinal - 1];
}
