import type { IntentKind, ResolvedIntent, VisionCaptureSession } from "./types.js";

const INTENT_RULES: Array<{
  kind: IntentKind;
  confidence: number;
  pattern: RegExp;
  summary: string;
}> = [
  {
    kind: "identify_place",
    confidence: 0.82,
    pattern: /(어딘지|어디(?:야|야\?|인지)|where is|what place|identify.*place)/i,
    summary: "Identify the likely place or location referenced by the visual evidence."
  },
  {
    kind: "debug_error",
    confidence: 0.86,
    pattern: /(왜\s*안\s*(?:돼|되)|오류|에러|error|failed|exception|stack trace|traceback)/i,
    summary: "Explain or debug the visible/recent error using visual and semantic context."
  },
  {
    kind: "modify_code",
    confidence: 0.78,
    pattern: /(수정해|고쳐|옮겨|깨지|반응형|fix|change|update|layout|responsive|bug)/i,
    summary: "Modify or repair code or UI based on the referenced visual target."
  },
  {
    kind: "summarize_content",
    confidence: 0.8,
    pattern: /(요약|summari[sz]e|핵심|정리해)/i,
    summary: "Summarize the visible content."
  },
  {
    kind: "compare_items",
    confidence: 0.78,
    pattern: /(비교|차이|compare|versus|vs\.?)/i,
    summary: "Compare the referenced visible items."
  },
  {
    kind: "rewrite_text",
    confidence: 0.76,
    pattern: /(느낌으로|제목.*바꿔|다시\s*써|rewrite|rename|rephrase|tone)/i,
    summary: "Rewrite selected or referenced text using the captured context."
  },
  {
    kind: "operate_app",
    confidence: 0.7,
    pattern: /(눌러|열어|클릭|실행|operate|click|open|select)/i,
    summary: "Operate or navigate the visible application."
  },
  {
    kind: "explain_screen",
    confidence: 0.72,
    pattern: /(뭐야|무엇|설명|explain|what is this|what am i looking at)/i,
    summary: "Explain the visible screen."
  }
];

export function resolveIntent(input: {
  utterance: string;
  captureSession?: VisionCaptureSession;
}): ResolvedIntent {
  const utterance = input.utterance.trim();
  for (const rule of INTENT_RULES) {
    if (rule.pattern.test(utterance)) {
      return {
        kind: rule.kind,
        summary: rule.summary,
        confidence: rule.confidence
      };
    }
  }

  const sourceKind = input.captureSession?.source.kind;
  return {
    kind: "unknown",
    summary: sourceKind ? `User referenced captured ${sourceKind} context, but intent is ambiguous.` : "User intent is ambiguous from the available utterance.",
    confidence: 0.35
  };
}

export function isDestructiveIntent(intent: ResolvedIntent, utterance: string): boolean {
  if (intent.kind !== "operate_app" && intent.kind !== "modify_code") {
    return false;
  }
  return /(삭제|지워|보내|게시|결제|delete|remove|send|post|purchase|pay)/i.test(utterance);
}
