import type {
  AsrCommandDecodeResult,
  AsrCommandSlot,
  AsrTranscriptCandidate
} from "../../shared/protocol.js";
import type { Transcript } from "./types.js";

export type AsrDecoderContext = {
  uiLabels?: string[];
  appNames?: string[];
  bookmarks?: string[];
  fileNames?: string[];
  packageNames?: string[];
  recentCommands?: string[];
  sideEffectRisk?: "read_only" | "reversible" | "side_effect" | "high_risk";
};

type AliasRule = {
  alias: string;
  canonical: string;
  source: string;
  weight: number;
};

const BUILTIN_ALIAS_RULES: AliasRule[] = [
  { alias: "리액트 라우터 돔", canonical: "react-router-dom", source: "builtin_package", weight: 0.92 },
  { alias: "리액트 라우터", canonical: "react-router", source: "builtin_package", weight: 0.78 },
  { alias: "테일윈드", canonical: "tailwind", source: "builtin_package", weight: 0.86 },
  { alias: "비주얼 스튜디오 코드", canonical: "Visual Studio Code", source: "builtin_app", weight: 0.9 },
  { alias: "브라우저", canonical: "browser", source: "builtin_surface", weight: 0.7 },
  { alias: "뒤로 가기", canonical: "뒤로가기", source: "builtin_action", weight: 0.86 },
  { alias: "앞으로 가기", canonical: "앞으로가기", source: "builtin_action", weight: 0.86 }
];

const ACTION_PATTERNS: Array<{ intent: string; canonical: string; patterns: RegExp[]; sideEffect: boolean }> = [
  { intent: "read", canonical: "읽기", sideEffect: false, patterns: [/읽어|보여|요약|설명|read/i] },
  { intent: "click", canonical: "클릭", sideEffect: true, patterns: [/클릭|눌러|선택|click/i] },
  { intent: "type", canonical: "입력", sideEffect: true, patterns: [/입력|써|타이핑|type/i] },
  { intent: "search", canonical: "검색", sideEffect: true, patterns: [/검색|찾아|search/i] },
  { intent: "navigate", canonical: "이동", sideEffect: true, patterns: [/이동|열어|접속|navigate|open/i] },
  { intent: "back", canonical: "뒤로가기", sideEffect: true, patterns: [/뒤로|back/i] },
  { intent: "forward", canonical: "앞으로가기", sideEffect: true, patterns: [/앞으로|forward/i] },
  { intent: "reload", canonical: "새로고침", sideEffect: true, patterns: [/새로\s*고침|reload|refresh/i] }
];

export function buildAsrContextualLexicon(context: AsrDecoderContext = {}): AliasRule[] {
  const dynamic = [
    ...toAliasRules(context.uiLabels, "ui_label", 0.78),
    ...toAliasRules(context.appNames, "app_name", 0.82),
    ...toAliasRules(context.bookmarks, "bookmark", 0.74),
    ...toAliasRules(context.fileNames, "file_name", 0.72),
    ...toAliasRules(context.packageNames, "package_name", 0.9),
    ...toAliasRules(context.recentCommands, "recent_command", 0.64)
  ];
  return dedupeAliasRules([...BUILTIN_ALIAS_RULES, ...dynamic]);
}

export function decodeAsrCommand(transcript: Transcript, context: AsrDecoderContext = {}): AsrCommandDecodeResult {
  const lexicon = buildAsrContextualLexicon(context);
  const baseCandidate: AsrTranscriptCandidate = {
    id: `${transcript.id}:model`,
    text: transcript.text,
    confidence: transcript.confidence,
    source: "model"
  };
  const repaired = applyAliasRules(transcript.text, lexicon);
  const aliasCandidate: AsrTranscriptCandidate = {
    id: `${transcript.id}:alias`,
    text: repaired.text,
    confidence: Math.min(1, transcript.confidence + repaired.confidenceBoost),
    source: repaired.replacements.length ? "alias" : "model",
    replacements: repaired.replacements
  };
  const grammar = scoreCommandGrammar(aliasCandidate.text);
  const grammarCandidate: AsrTranscriptCandidate = {
    id: `${transcript.id}:grammar`,
    text: grammar.canonicalText,
    confidence: Math.min(1, aliasCandidate.confidence * 0.72 + grammar.score * 0.28),
    source: "grammar",
    replacements: aliasCandidate.replacements
  };
  const slots = extractSlots(grammar.canonicalText, grammar.intent, lexicon);
  const slotConfidence = slots.length
    ? slots.reduce((sum, slot) => sum + slot.confidence, 0) / slots.length
    : 0;
  const sideEffectRisk = context.sideEffectRisk ?? (grammar.sideEffect ? "side_effect" : "read_only");
  const clarificationRequired = shouldClarify({ slots, slotConfidence, grammarScore: grammar.score, sideEffectRisk });
  return {
    schemaVersion: "asr-command-decoder.v1",
    transcriptId: transcript.id,
    candidates: dedupeCandidates([baseCandidate, aliasCandidate, grammarCandidate]),
    selectedText: grammarCandidate.text,
    canonicalText: grammar.canonicalText,
    intent: grammar.intent,
    slots,
    slotConfidence,
    grammarScore: grammar.score,
    clarificationRequired,
    clarificationReason: clarificationRequired ? buildClarificationReason({ slots, slotConfidence, grammarScore: grammar.score, sideEffectRisk }) : undefined,
    debug: {
      lexiconSize: lexicon.length,
      aliasesApplied: repaired.replacements.length,
      grammarMatches: grammar.matches
    }
  };
}

function toAliasRules(values: string[] | undefined, source: string, weight: number): AliasRule[] {
  return (values ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((canonical) => {
      const aliases = new Set([canonical, canonical.toLowerCase(), canonical.replace(/[-_.]/g, " "), canonical.replace(/[-_.]/g, "")]);
      return [...aliases].map((alias) => ({ alias, canonical, source, weight }));
    });
}

function dedupeAliasRules(rules: AliasRule[]): AliasRule[] {
  const byAlias = new Map<string, AliasRule>();
  for (const rule of rules) {
    const key = normalize(rule.alias);
    const existing = byAlias.get(key);
    if (!existing || existing.weight < rule.weight) {
      byAlias.set(key, rule);
    }
  }
  return [...byAlias.values()];
}

function applyAliasRules(text: string, lexicon: AliasRule[]): {
  text: string;
  replacements: NonNullable<AsrTranscriptCandidate["replacements"]>;
  confidenceBoost: number;
} {
  let output = text;
  const replacements: NonNullable<AsrTranscriptCandidate["replacements"]> = [];
  for (const rule of lexicon.sort((left, right) => right.alias.length - left.alias.length)) {
    if (!rule.alias || normalize(rule.alias) === normalize(rule.canonical)) {
      continue;
    }
    const pattern = new RegExp(escapeRegExp(rule.alias), "ig");
    if (!pattern.test(output)) {
      continue;
    }
    output = output.replace(pattern, rule.canonical);
    replacements.push({ from: rule.alias, to: rule.canonical, reason: rule.source, confidenceBoost: Math.min(0.1, rule.weight / 20) });
  }
  return {
    text: output,
    replacements,
    confidenceBoost: Math.min(0.22, replacements.reduce((sum, item) => sum + item.confidenceBoost, 0))
  };
}

function scoreCommandGrammar(text: string): { intent?: string; canonicalText: string; score: number; matches: string[]; sideEffect: boolean } {
  const matches: string[] = [];
  let best: typeof ACTION_PATTERNS[number] | undefined;
  for (const candidate of ACTION_PATTERNS) {
    if (candidate.patterns.some((pattern) => pattern.test(text))) {
      best = candidate;
      matches.push(candidate.intent);
      break;
    }
  }
  if (!best) {
    return { canonicalText: normalizeSpacing(text), score: 0.35, matches, sideEffect: false };
  }
  const hasTarget = /\S+\s+(?:클릭|눌러|입력|검색|읽어|열어|이동|찾아)/.test(text) || /(?:클릭|눌러|입력|검색|읽어|열어|이동|찾아)\s+\S+/.test(text);
  const score = Math.min(1, 0.58 + (hasTarget ? 0.22 : 0) + (matches.length > 0 ? 0.12 : 0));
  return {
    intent: best.intent,
    canonicalText: normalizeSpacing(text.replace(best.patterns[0], best.canonical)),
    score,
    matches,
    sideEffect: best.sideEffect
  };
}

function extractSlots(text: string, intent: string | undefined, lexicon: AliasRule[]): AsrCommandSlot[] {
  const slots: AsrCommandSlot[] = [];
  if (intent) {
    slots.push({ name: "action", value: intent, confidence: 0.82, source: "grammar" });
  }
  const lexiconHit = lexicon.find((rule) => normalize(text).includes(normalize(rule.canonical)));
  if (lexiconHit) {
    const slotName: AsrCommandSlot["name"] = lexiconHit.source === "package_name" ? "package" : lexiconHit.source === "app_name" ? "app" : "target";
    slots.push({ name: slotName, value: lexiconHit.canonical, confidence: lexiconHit.weight, source: "lexicon" });
  }
  const quoted = /['"`“”‘’]([^'"`“”‘’]+)['"`“”‘’]/.exec(text);
  if (quoted?.[1]) {
    slots.push({ name: "value", value: quoted[1], confidence: 0.86, source: "grammar" });
  }
  const location = /(상단|하단|왼쪽|오른쪽|본문|주소창|검색창|첫번째|두번째|마지막)/.exec(text);
  if (location?.[1]) {
    slots.push({ name: "location", value: location[1], confidence: 0.74, source: "grammar" });
  }
  return slots;
}

function shouldClarify(input: {
  slots: AsrCommandSlot[];
  slotConfidence: number;
  grammarScore: number;
  sideEffectRisk: NonNullable<AsrDecoderContext["sideEffectRisk"]>;
}): boolean {
  const action = input.slots.find((slot) => slot.name === "action");
  const target = input.slots.find((slot) => slot.name === "target" || slot.name === "package" || slot.name === "app" || slot.name === "location");
  if (!action) return true;
  if (input.sideEffectRisk !== "read_only" && !target && action.value !== "back" && action.value !== "forward" && action.value !== "reload") {
    return true;
  }
  const required = input.sideEffectRisk === "high_risk" ? 0.78 : input.sideEffectRisk === "side_effect" ? 0.64 : 0.45;
  return input.slotConfidence < required || input.grammarScore < required;
}

function buildClarificationReason(input: {
  slots: AsrCommandSlot[];
  slotConfidence: number;
  grammarScore: number;
  sideEffectRisk: string;
}): string {
  const missingTarget = !input.slots.some((slot) => slot.name === "target" || slot.name === "package" || slot.name === "app" || slot.name === "location");
  if (missingTarget && input.sideEffectRisk !== "read_only") {
    return "side_effect_target_underdetermined";
  }
  if (input.grammarScore < input.slotConfidence) {
    return "grammar_confidence_low";
  }
  return "slot_confidence_low";
}

function dedupeCandidates(candidates: AsrTranscriptCandidate[]): AsrTranscriptCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = normalize(candidate.text);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeSpacing(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
