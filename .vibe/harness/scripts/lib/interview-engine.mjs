const REQUIRED_SOFT_TERMINATE_RATIO = 0.8;

function clampConfidence(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}

// CROSS-REF (src/lib/interview.ts:subFieldCoverageValue)
// Inline port because .mjs stays build-free and cannot import .ts here.
export function subFieldCoverageValue(subFieldCoverage) {
  return subFieldCoverage.deferred ? 0 : clampConfidence(subFieldCoverage.confidence);
}

// CROSS-REF (src/lib/interview.ts:dimensionCoverageRatio)
// Keep this logic in lockstep with the test-only typed helper.
export function dimensionCoverageRatio(spec, dimensionCoverage) {
  if (spec.subFields.length === 0) {
    const freeForm = dimensionCoverage?.subFields?.free_form;
    if (!freeForm || freeForm.deferred || String(freeForm.value ?? '').trim() === '') {
      return 0;
    }

    return 1;
  }

  const total = spec.subFields.reduce((sum, subFieldId) => {
    const subField = dimensionCoverage?.subFields?.[subFieldId];
    return sum + (subField ? subFieldCoverageValue(subField) : 0);
  }, 0);

  return total / spec.subFields.length;
}

// CROSS-REF (src/lib/interview.ts:computeAmbiguity)
export function computeAmbiguity(dimensions, coverage) {
  const totalWeight = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
  if (totalWeight <= 0) {
    return 1;
  }

  const weightedCoverage = dimensions.reduce((sum, dimension) => {
    const dimensionCoverage = coverage[dimension.id] ?? { ratio: 0, subFields: {} };
    return sum + dimension.weight * dimensionCoverageRatio(dimension, dimensionCoverage);
  }, 0);

  return 1 - weightedCoverage / totalWeight;
}

function sortByCoverageThenWeight(dimensions, coverage) {
  return [...dimensions].sort((left, right) => {
    const leftRatio = dimensionCoverageRatio(left, coverage[left.id] ?? { ratio: 0, subFields: {} });
    const rightRatio = dimensionCoverageRatio(right, coverage[right.id] ?? { ratio: 0, subFields: {} });

    if (leftRatio !== rightRatio) {
      return leftRatio - rightRatio;
    }

    if (left.weight !== right.weight) {
      return right.weight - left.weight;
    }

    return left.id.localeCompare(right.id);
  });
}

function sortByWeightThenCoverage(dimensions, coverage) {
  return [...dimensions].sort((left, right) => {
    if (left.weight !== right.weight) {
      return right.weight - left.weight;
    }

    const leftRatio = dimensionCoverageRatio(left, coverage[left.id] ?? { ratio: 0, subFields: {} });
    const rightRatio = dimensionCoverageRatio(right, coverage[right.id] ?? { ratio: 0, subFields: {} });
    if (leftRatio !== rightRatio) {
      return leftRatio - rightRatio;
    }

    return left.id.localeCompare(right.id);
  });
}

// CROSS-REF (src/lib/interview.ts:selectNextDimension)
// Keep candidate ordering and thrash avoidance aligned with the typed helper.
export function selectNextDimension(dimensions, coverage, recentDimensionIds, options = {}) {
  const thrashWindow = options.thrashWindow ?? 3;
  const recent = new Set(recentDimensionIds.slice(-thrashWindow));
  const requiredCandidates = sortByCoverageThenWeight(
    dimensions.filter((dimension) => dimension.required),
    coverage,
  );
  const pendingRequired = requiredCandidates.filter((dimension) => {
    const ratio = dimensionCoverageRatio(
      dimension,
      coverage[dimension.id] ?? { ratio: 0, subFields: {} },
    );
    return ratio < 0.5;
  });
  const pool =
    pendingRequired.length > 0
      ? pendingRequired
      : sortByWeightThenCoverage(
          dimensions.filter((dimension) => {
            const ratio = dimensionCoverageRatio(
              dimension,
              coverage[dimension.id] ?? { ratio: 0, subFields: {} },
            );
            return ratio < 0.5;
          }),
          coverage,
        );

  if (pool.length === 0) {
    return sortByCoverageThenWeight(dimensions, coverage)[0] ?? dimensions[0] ?? null;
  }

  if (!recent.has(pool[0].id)) {
    return pool[0];
  }

  return pool.find((dimension) => !recent.has(dimension.id)) ?? pool[0];
}

function allRequiredDimensionsCovered(dimensions, coverage) {
  return dimensions
    .filter((dimension) => dimension.required)
    .every((dimension) => {
      const ratio = dimensionCoverageRatio(
        dimension,
        coverage[dimension.id] ?? { ratio: 0, subFields: {} },
      );
      return ratio >= REQUIRED_SOFT_TERMINATE_RATIO;
    });
}

// CROSS-REF (src/lib/interview.ts:shouldTerminate)
// Keep termination thresholds aligned with the typed helper.
export function shouldTerminate(ambiguity, round, maxRounds, dimensions, coverage) {
  if (round > maxRounds) {
    return { terminate: true, reason: 'max-rounds' };
  }

  if (ambiguity <= 0.2) {
    return { terminate: true, reason: 'ambiguity' };
  }

  if (allRequiredDimensionsCovered(dimensions, coverage) && ambiguity <= 0.3) {
    return { terminate: true, reason: 'soft-terminate' };
  }

  return { terminate: false, reason: null };
}
