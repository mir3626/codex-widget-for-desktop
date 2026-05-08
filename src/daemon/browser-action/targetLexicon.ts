const ACTION_SUFFIX_PATTERN = new RegExp([
  String.raw`(?:을|를|은|는|이|가)?\s*`,
  String.raw`(?:`,
  String.raw`눌러(?:줘|주세요|봐|봐줘)?`,
  String.raw`|클릭(?:해|해줘|해주세요)?`,
  String.raw`|press|click`,
  String.raw`|열어(?:줘|주세요)?`,
  String.raw`|선택(?:해|해줘|해주세요)?`,
  String.raw`|펼쳐(?:줘|주세요)?`,
  String.raw`|expand|open|select`,
  String.raw`)`,
  String.raw`(?:\s*(?:줘|주세요|해줘|해주세요|해|please))?\.?$`
].join(""), "i");

const LEADING_CONTEXT_PATTERN = /^(?:현재\s*페이지(?:에서)?|이\s*페이지(?:에서)?|페이지(?:에서)?|현재\s*화면(?:에서)?|화면(?:에서)?|사이트(?:에서)?|브라우저(?:에서)?|active\s*tab(?:에서)?|on\s+(?:this\s+)?page)\s*/i;

const TARGET_WORD_PATTERN = /(?:\s*(?:링크|버튼|button|link|항목|메뉴|탭))$/i;

const ALIAS_SETS = [
  ["새 채팅", "새 대화", "새로운 채팅", "새로운 대화", "new chat", "new conversation", "new thread", "start new chat"],
  ["채팅", "대화", "chat", "conversation"],
  ["검색", "검색창", "search", "search box", "searchbox"],
  ["뒤로", "back", "go back"],
  ["앞으로", "forward", "go forward"],
  ["새로고침", "reload", "refresh"]
];

export function normalizeBrowserTargetText(value: string | undefined): string {
  return (value ?? "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(LEADING_CONTEXT_PATTERN, "")
    .replace(ACTION_SUFFIX_PATTERN, "")
    .replace(TARGET_WORD_PATTERN, "")
    .replace(/\b(?:please|now)\b/gi, " ")
    .replace(/[?!。．.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function expandBrowserTargetAliases(value: string | undefined): string[] {
  const normalized = normalizeBrowserTargetText(value);
  if (!normalized) {
    return [];
  }
  const aliases = new Set<string>([normalized]);
  const compact = compactText(normalized);
  if (compact) {
    aliases.add(compact);
  }
  for (const set of ALIAS_SETS) {
    const normalizedSet = set.map(normalizeBrowserTargetText);
    if (normalizedSet.some((item) => item === normalized || compactText(item) === compact)) {
      for (const item of normalizedSet) {
        if (item) {
          aliases.add(item);
          aliases.add(compactText(item));
        }
      }
    }
  }
  return [...aliases].filter(Boolean);
}

export function tokenizeBrowserTargetText(value: string | undefined): string[] {
  const normalized = normalizeBrowserTargetText(value);
  if (!normalized) {
    return [];
  }
  const tokens = new Set<string>();
  for (const part of normalized.split(/[\s/_|.,:;()[\]{}"'`<>-]+/)) {
    const token = part.trim();
    if (!token) {
      continue;
    }
    if (hasCjk(token) ? token.length >= 1 : token.length >= 2) {
      tokens.add(token);
    }
  }
  const compact = compactText(normalized);
  if (compact && compact !== normalized) {
    tokens.add(compact);
  }
  return [...tokens];
}

export function stripBrowserActionSuffix(value: string | undefined): string {
  return normalizeBrowserTargetText(value);
}

export function compactText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, "").trim().toLowerCase();
}

function hasCjk(value: string): boolean {
  return /[\u3131-\u318e\uac00-\ud7a3\u3040-\u30ff\u3400-\u9fff]/.test(value);
}
