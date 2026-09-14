import { isRecord } from "../../../shared/is-record.ts";

type SpecsHome = "repo" | "external";
export type ResolveSpecsHomeResult = { ok: true; specsHome: SpecsHome } | { ok: false; error: string };

/**
 * `projects.<key>.specs` (`"external"` | `"repo"`, absent defaults to `"external"`) is the sole
 * spec-home knob every intent/plan/pipeline/implement site resolves through. Legacy
 * `projects.<key>.plan.commit` and machine `modes.plan.commit` are rejected outright rather than
 * silently ignored or aliased.
 */
export function resolveSpecsHome(
  projectConfig: Record<string, unknown> | undefined,
  modePlan: Record<string, unknown> | undefined,
): ResolveSpecsHomeResult {
  const plan = isRecord(projectConfig?.plan) ? projectConfig.plan : undefined;
  if (plan !== undefined && "commit" in plan)
    return { ok: false, error: "projects.<key>.plan.commit is no longer supported; use projects.<key>.specs" };
  if (modePlan !== undefined && "commit" in modePlan)
    return { ok: false, error: "modes.plan.commit is no longer supported; use projects.<key>.specs" };
  const specs = projectConfig?.specs;
  if (specs === undefined) return { ok: true, specsHome: "external" };
  if (specs === "external" || specs === "repo") return { ok: true, specsHome: specs };
  return { ok: false, error: `projects.<key>.specs must be "external" or "repo", got ${JSON.stringify(specs)}` };
}
