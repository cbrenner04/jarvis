export const DEFAULT_PLAN_TARGET_DIR = "spec";

/**
 * The one plan target-directory precedence: explicit request, then the canonical queue parent the
 * input came from, then the project's `plan.targetDir`, then the legacy global `modes.plan.targetDir`,
 * then `spec`. Callers validate shape before resolving; this only orders the candidates.
 */
export function resolvePlanTargetDir(candidates: {
  explicit?: string | undefined;
  canonical?: string | undefined;
  projectTargetDir?: unknown;
  modeTargetDir?: unknown;
}): string {
  return (
    candidates.explicit ??
    candidates.canonical ??
    (typeof candidates.projectTargetDir === "string" ? candidates.projectTargetDir : undefined) ??
    (typeof candidates.modeTargetDir === "string" ? candidates.modeTargetDir : undefined) ??
    DEFAULT_PLAN_TARGET_DIR
  );
}
