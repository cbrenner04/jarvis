import {
  SHRINK_STEP_ID_SUFFIX,
  endsWith as shrinkStepIdEndsWith,
  strip as stripShrinkStepId,
} from "./shrink-step-id.ts";

export { SHRINK_STEP_ID_SUFFIX };

export const LINK_STEP_ID_INFIX = "~link-";

export function matchesExactStepId(candidateStepId: string | null | undefined, stepId: string): boolean {
  return candidateStepId === stepId;
}

export function matchesLinkedSiblingStepId(candidateStepId: string | null | undefined, writeStepId: string): boolean {
  return candidateStepId?.startsWith(`${writeStepId}${LINK_STEP_ID_INFIX}`) ?? false;
}

/** Exact authored write step or a linked-implement execution row. Excludes hidden-shrink rows. */
export function isWriteSiblingStepId(candidateStepId: string | null | undefined, writeStepId: string): boolean {
  return matchesExactStepId(candidateStepId, writeStepId) || matchesLinkedSiblingStepId(candidateStepId, writeStepId);
}

export function isHiddenShrinkStepId(stepId: string | null | undefined): boolean {
  return shrinkStepIdEndsWith(stepId);
}

export function resolveAuthoredStepId(runStepId: string): string {
  if (shrinkStepIdEndsWith(runStepId)) {
    return stripShrinkStepId(runStepId);
  }
  const linkIndex = runStepId.indexOf(LINK_STEP_ID_INFIX);
  if (linkIndex !== -1) {
    return runStepId.slice(0, linkIndex);
  }
  return runStepId;
}

export function findSnapshotStepForRunStepId<T extends { stepId: string }>(
  steps: readonly T[],
  runStepId: string,
): T | undefined {
  const authoredStepId = resolveAuthoredStepId(runStepId);
  return steps.find((step) => step.stepId === authoredStepId);
}
