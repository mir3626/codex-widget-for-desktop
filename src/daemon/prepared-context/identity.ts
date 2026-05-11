import type { PreparedContextIdentity } from "./types.js";

export function createPreparedContextKey(identity: PreparedContextIdentity): string {
  return [
    identity.surface,
    identity.sourceId,
    identity.surfaceId,
    identity.origin,
    identity.routeKey,
    identity.revision,
    identity.mutationRevision,
    identity.digest
  ].filter(Boolean).join(":");
}

export function isPreparedContextIdentityCompatible(input: {
  expected?: PreparedContextIdentity;
  actual?: PreparedContextIdentity;
}): boolean {
  if (!input.expected || !input.actual) {
    return true;
  }
  if (input.expected.surface !== input.actual.surface) {
    return false;
  }
  if (input.expected.sourceId && input.actual.sourceId && input.expected.sourceId !== input.actual.sourceId) {
    return false;
  }
  if (input.expected.surfaceId && input.actual.surfaceId && input.expected.surfaceId !== input.actual.surfaceId) {
    return false;
  }
  if (input.expected.routeKey && input.actual.routeKey && input.expected.routeKey !== input.actual.routeKey) {
    return false;
  }
  return true;
}

