import { compactSemanticText, normalizeSemanticText } from "../ontology.js";

const GENERIC_ALIAS_SETS = [
  ["새 채팅", "새 대화", "새로운 채팅", "새로운 대화", "new chat", "new conversation", "new thread", "start new chat"],
  ["검색", "검색창", "search", "search box", "searchbox"],
  ["저장", "저장하기", "save"],
  ["설정", "settings", "preferences"],
  ["닫기", "close"],
  ["열기", "open"],
  ["뒤로", "back", "go back"],
  ["앞으로", "forward", "go forward"]
];

export function expandSemanticAliases(value: string | undefined): string[] {
  const normalized = normalizeSemanticText(value);
  if (!normalized) return [];
  const compact = compactSemanticText(normalized);
  const aliases = new Set<string>([normalized, compact]);
  for (const set of GENERIC_ALIAS_SETS) {
    const normalizedSet = set.map(normalizeSemanticText);
    if (normalizedSet.some((item) => item === normalized || compactSemanticText(item) === compact)) {
      for (const item of normalizedSet) {
        if (item) {
          aliases.add(item);
          aliases.add(compactSemanticText(item));
        }
      }
    }
  }
  return [...aliases].filter(Boolean);
}
