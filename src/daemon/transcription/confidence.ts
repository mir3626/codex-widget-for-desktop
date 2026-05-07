import type { ActionSlotConfidence } from "./types.js";

export function scoreActionSlots(input: {
  text: string;
  hasPointer?: boolean;
  hasSelection?: boolean;
  currentMode?: string;
}): ActionSlotConfidence {
  const text = input.text;
  return {
    target: clamp01((input.hasPointer ? 0.45 : 0) + (input.hasSelection ? 0.35 : 0) + (/(여기|저기|이거|저거|this|that)/i.test(text) ? 0.18 : 0.08)),
    action: clamp01(/(수정|고쳐|설명|요약|비교|알려|click|open|fix|summarize|compare|explain)/i.test(text) ? 0.78 : 0.32),
    location: clamp01(/(위|아래|왼쪽|오른쪽|상단|하단|left|right|top|bottom)/i.test(text) ? 0.76 : input.hasPointer ? 0.68 : 0.3),
    condition: clamp01(/(모바일|데스크톱|방금|아까|if|when|while|mobile|desktop)/i.test(text) ? 0.72 : 0.42),
    domain: clamp01(input.currentMode ? 0.76 : 0.38)
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
