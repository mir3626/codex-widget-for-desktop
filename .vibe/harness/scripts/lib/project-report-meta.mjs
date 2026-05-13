const META_SPRINT_PATTERNS = [/^sprint-M\d+/, /^self-evolution-/, /^harness-/, /^v\d+\./];

export function isMetaSprintId(sprintId) {
  return META_SPRINT_PATTERNS.some((pattern) => pattern.test(String(sprintId)));
}
