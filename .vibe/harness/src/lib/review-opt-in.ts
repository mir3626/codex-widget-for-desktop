const PHASE3_UTILITY_OPT_IN_TAG = '[decision][phase3-utility-opt-in]';
const PHASE3_UTILITY_OPT_IN_PATTERN = /\[decision]\s*\[phase3-utility-opt-in]/;
const FRONTEND_PLATFORM_PATTERN = /\b(web|browser|frontend|next(?:\.js)?|react|vue|svelte)\b/i;
const REVIEW_SIGNALS_BLOCK_PATTERN =
  /<!--\s*BEGIN:(?:HARNESS|PROJECT):review-signals\s*-->([\s\S]*?)<!--\s*END:(?:HARNESS|PROJECT):review-signals\s*-->/gi;

export interface ReviewConfigInput {
  bundle?: {
    enabled?: boolean;
    policy?: 'automatic' | 'custom' | 'off';
    rationale?: string;
    replacementEvidence?: string;
  };
  browserSmoke?: {
    enabled?: boolean;
    rationale?: string;
    replacementEvidence?: string;
  };
}

export interface ReviewSeedInput {
  productText?: string;
  platform?: string | string[];
  sessionLogRecent?: string[];
}

interface ReviewSignals {
  frontend?: boolean;
  platforms: string[];
}

export interface ReviewIssueSeed {
  id: string;
  severity: 'friction';
  priority: 'P1';
  proposal: string;
  estimated_loc: number;
  proposed_sprint: 'backlog';
}

interface UtilityOptInDecision {
  bundle?: boolean;
  browserSmoke?: boolean;
  rationale?: string;
  replacementEvidence?: string;
}

function parseBoolean(value: string): boolean | undefined {
  const normalized = value.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  if (normalized === 'true' || normalized === 'yes' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === 'no' || normalized === '0') {
    return false;
  }
  return undefined;
}

function parseStringList(value: string): string[] {
  const trimmed = value.trim();
  const arrayMatch = trimmed.match(/^\[(.*)]$/);
  const rawItems = arrayMatch ? (arrayMatch[1]?.trim() ? arrayMatch[1].split(',') : []) : [trimmed];

  return rawItems
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter((item) => item.length > 0);
}

function parseReviewSignalsBlock(productText: string): ReviewSignals | null {
  const signals: ReviewSignals = { platforms: [] };
  REVIEW_SIGNALS_BLOCK_PATTERN.lastIndex = 0;
  let found = false;
  let match = REVIEW_SIGNALS_BLOCK_PATTERN.exec(productText);

  while (match) {
    found = true;
    const body = match[1] ?? '';
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith('#')) {
        continue;
      }

      const keyValue = line.match(/^([A-Za-z][\w-]*)\s*[:=]\s*(.+)$/);
      if (!keyValue?.[1] || !keyValue[2]) {
        continue;
      }

      const key = keyValue[1].toLowerCase();
      const value = keyValue[2];
      if (key === 'frontend') {
        const parsed = parseBoolean(value);
        if (typeof parsed === 'boolean') {
          signals.frontend = parsed;
        }
      } else if (key === 'platform' || key === 'platforms') {
        signals.platforms.push(...parseStringList(value));
      }
    }

    match = REVIEW_SIGNALS_BLOCK_PATTERN.exec(productText);
  }

  return found ? signals : null;
}

function extractExplicitProductPlatforms(productText: string): string[] {
  const platforms: string[] = [];

  for (const rawLine of productText.split(/\r?\n/)) {
    const match = rawLine.match(/^\s*(?:[-*]\s*)?(?:\*\*)?platforms?(?:\*\*)?\s*[:=]\s*(.+)$/i);
    if (match?.[1]) {
      platforms.push(...parseStringList(match[1]));
    }
  }

  return platforms;
}

function normalizePlatformSignals(seed: ReviewSeedInput): ReviewSignals {
  const signals: ReviewSignals = { platforms: [] };

  if (Array.isArray(seed.platform)) {
    signals.platforms.push(...seed.platform);
  } else if (typeof seed.platform === 'string') {
    signals.platforms.push(seed.platform);
  }

  if (signals.platforms.length > 0) {
    return signals;
  }

  if (typeof seed.productText === 'string') {
    const blockSignals = parseReviewSignalsBlock(seed.productText);
    if (blockSignals) {
      return blockSignals;
    }
    signals.platforms.push(...extractExplicitProductPlatforms(seed.productText));
  }

  return signals;
}

function isWebPlatformSeed(seed: ReviewSeedInput): boolean {
  const signals = normalizePlatformSignals(seed);
  if (typeof signals.frontend === 'boolean') {
    return signals.frontend;
  }

  return signals.platforms.some((signal) => FRONTEND_PLATFORM_PATTERN.test(signal));
}

function hasUtilityOptInDecision(seed: ReviewSeedInput): boolean {
  return (seed.sessionLogRecent ?? []).some(
    (entry) => entry.includes(PHASE3_UTILITY_OPT_IN_TAG) || PHASE3_UTILITY_OPT_IN_PATTERN.test(entry),
  );
}

function parseBooleanToken(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', 'no', 'n', '0', 'off'].includes(normalized)) {
    return false;
  }
  return undefined;
}

function parseUtilityDecisionEntry(entry: string): UtilityOptInDecision | null {
  if (!entry.includes(PHASE3_UTILITY_OPT_IN_TAG) && !PHASE3_UTILITY_OPT_IN_PATTERN.test(entry)) {
    return null;
  }

  const fields = new Map<string, string>();
  for (const match of entry.matchAll(/\b([A-Za-z][A-Za-z0-9_-]*)=("[^"]*"|'[^']*'|\S+)/g)) {
    const key = match[1]?.toLowerCase();
    const rawValue = match[2];
    if (!key || rawValue === undefined) {
      continue;
    }
    fields.set(key, rawValue.replace(/^["']|["']$/g, ''));
  }

  const decision: UtilityOptInDecision = {};
  const bundle = parseBooleanToken(fields.get('bundle'));
  const browserSmoke = parseBooleanToken(fields.get('browsersmoke') ?? fields.get('browser-smoke'));
  const rationale = fields.get('rationale');
  const replacementEvidence =
    fields.get('replacementevidence') ??
    fields.get('replacement-evidence') ??
    fields.get('replacement') ??
    fields.get('evidence');
  if (bundle !== undefined) {
    decision.bundle = bundle;
  }
  if (browserSmoke !== undefined) {
    decision.browserSmoke = browserSmoke;
  }
  if (rationale !== undefined) {
    decision.rationale = rationale;
  }
  if (replacementEvidence !== undefined) {
    decision.replacementEvidence = replacementEvidence;
  }
  return decision;
}

function readLatestUtilityOptInDecision(seed: ReviewSeedInput): UtilityOptInDecision | null {
  const entries = seed.sessionLogRecent ?? [];
  for (const entry of entries) {
    const parsed = parseUtilityDecisionEntry(entry);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function hasReplacementEvidence(
  decision: UtilityOptInDecision | null,
  config: { rationale?: string; replacementEvidence?: string } | undefined,
): boolean {
  const rationale = decision?.rationale ?? config?.rationale;
  const replacementEvidence = decision?.replacementEvidence ?? config?.replacementEvidence;
  return Boolean(rationale?.trim()) && Boolean(replacementEvidence?.trim());
}

function optOutEvidenceIssue(id: string, proposal: string): ReviewIssueSeed {
  return {
    id,
    severity: 'friction',
    priority: 'P1',
    proposal,
    estimated_loc: 20,
    proposed_sprint: 'backlog',
  };
}

export function detectOptInGaps(
  config: ReviewConfigInput,
  seed: ReviewSeedInput,
): ReviewIssueSeed[] {
  if (!isWebPlatformSeed(seed)) {
    return [];
  }

  const issues: ReviewIssueSeed[] = [];
  const utilityDecision = readLatestUtilityOptInDecision(seed);

  if (config.bundle?.enabled !== true) {
    if (utilityDecision?.bundle === false || config.bundle?.policy === 'off') {
      if (!hasReplacementEvidence(utilityDecision, config.bundle)) {
        issues.push(
          optOutEvidenceIssue(
            'review-bundle-opt-out-missing-evidence',
            'bundle-size gate 가 명시적으로 꺼졌지만 rationale/replacement evidence 가 없음',
          ),
        );
      }
    } else if (utilityDecision?.bundle === true) {
      issues.push(
        optOutEvidenceIssue(
          'review-bundle-decision-config-mismatch',
          'session-log 는 bundle gate 활성화를 기록했지만 .vibe/config.json bundle.enabled 가 true 가 아님',
        ),
      );
    } else if (config.bundle?.policy === 'automatic') {
      issues.push(
        optOutEvidenceIssue(
          'review-bundle-policy-unresolved',
          'bundle policy 가 automatic 상태로 남아 있어 frontend 프로젝트의 bundle gate 결정 근거가 없음',
        ),
      );
    } else if (!hasUtilityOptInDecision(seed)) {
      issues.push({
        id: 'review-bundle-opt-in-disabled',
        severity: 'friction',
        priority: 'P1',
        proposal: 'frontend 프로젝트인데 bundle-size gate 가 opt-in 되지 않음',
        estimated_loc: 20,
        proposed_sprint: 'backlog',
      });
    }
  }

  if (config.browserSmoke?.enabled !== true) {
    if (utilityDecision?.browserSmoke === false) {
      if (!hasReplacementEvidence(utilityDecision, config.browserSmoke)) {
        issues.push(
          optOutEvidenceIssue(
            'review-browser-smoke-opt-out-missing-evidence',
            'browser smoke gate 가 명시적으로 꺼졌지만 rationale/replacement evidence 가 없음',
          ),
        );
      }
    } else if (utilityDecision?.browserSmoke === true) {
      issues.push(
        optOutEvidenceIssue(
          'review-browser-smoke-decision-config-mismatch',
          'session-log 는 browser smoke 활성화를 기록했지만 .vibe/config.json browserSmoke.enabled 가 true 가 아님',
        ),
      );
    } else if (!hasUtilityOptInDecision(seed)) {
      issues.push({
        id: 'review-browser-smoke-opt-in-disabled',
        severity: 'friction',
        priority: 'P1',
        proposal: 'frontend 프로젝트인데 browser smoke gate 가 opt-in 되지 않음',
        estimated_loc: 20,
        proposed_sprint: 'backlog',
      });
    }
  }

  return issues;
}
