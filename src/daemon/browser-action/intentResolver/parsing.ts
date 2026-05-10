import { normalizeBrowserTargetText, stripBrowserActionSuffix } from "../targetLexicon.js";

export { stripBrowserActionSuffix };

export function isInformationalBrowserActionQuestion(text: string): boolean {
  return (
    /(what\s+can|what\s+is|explain|help|capabilit|기능|무엇|뭐|뭔|어떤|설명).*(browser\s*action|브라우저\s*액션)/i.test(text) ||
    /(browser\s*action|브라우저\s*액션).*(what\s+can|what\s+is|explain|help|capabilit|기능|무엇|뭐|뭔|어떤|설명)/i.test(text)
  );
}

export function extractTargetPhrase(text: string): string | undefined {
  const quoted = text.match(/[“"']([^“"']{1,120})[”"']/)?.[1];
  const textWithoutQuote = quoted ? text.replace(quoted, " ") : text;
  if (quoted && !/(http|검색|search|입력|type)/i.test(quoted) && !/(검색|search|입력|type|fill|입력창|검색창)/i.test(textWithoutQuote)) {
    return normalizeTargetPhrase(quoted);
  }
  const patterns = [
    /^(.{1,80}?)(?:을|를)?\s*(?:눌러서|누르고|누른\s*(?:뒤|후|다음)|클릭해서|클릭하고|press(?:ing)?\s+(?:and|then)|click(?:ing)?\s+(?:and|then))/i,
    /(?:에서|on)\s+(.{1,80}?)(?:을|를)?\s*(?:눌러|누르|클릭|click|press|펼쳐|expand)/i,
    /(.{1,80}?)(?:\s*링크|\s*버튼|\s*button|\s*link)(?:을|를)?\s*(?:눌러|누르|클릭|click|press)?/i,
    /^(.{1,80}?)(?:을|를)?\s*(?:눌러(?:줘|주세요|봐|봐줘)?|누르(?:기|세요|자|자마자|면|고)?|클릭(?:해|해줘|해주세요|하기)?|click|press|펼쳐(?:줘|주세요)?|expand)(?:\s*(?:줘|주세요|해줘|해주세요|please))?\.?$/i,
    /(?:검색창|search box|input|입력칸)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }
    const value = normalizeTargetPhrase((match[1] ?? match[0])
      .replace(/현재 페이지|이 페이지|현재 화면|이 화면|페이지|화면|에서|링크|버튼|검색창|입력칸/gi, " "));
    if (value) {
      return value.slice(0, 120);
    }
  }
  return undefined;
}

export function extractQuotedText(text: string): string | undefined {
  return text.match(/[“"']([^“"']{1,500})[”"']/)?.[1]?.trim();
}

export function extractTextAfterKeyword(text: string, keywords: string[]): string | undefined {
  for (const keyword of keywords) {
    const index = text.toLowerCase().indexOf(keyword.toLowerCase());
    if (index < 0) {
      continue;
    }
    const value = text.slice(index + keyword.length).replace(/(?:하고|그리고|then|and).*/i, "").trim();
    if (value) {
      return value.slice(0, 500);
    }
  }
  return undefined;
}

export function extractUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s)]+/i);
  return match?.[0];
}

export function readScrollAmount(text: string): "small" | "medium" | "large" {
  if (/조금|small/i.test(text)) {
    return "small";
  }
  if (/많이|끝까지|large|bottom/i.test(text)) {
    return "large";
  }
  return "medium";
}

function normalizeTargetPhrase(value: string): string {
  return normalizeBrowserTargetText(value).replace(/\s+/g, " ").trim();
}
