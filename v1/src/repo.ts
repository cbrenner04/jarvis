import {
  type ResolveOptions,
  type ResolveResult,
  resolveProject,
} from "./resolve-project.ts";

export type ResolveTargetRepoOptions = {
  /**
   * Optional `--repo` CLI flag value, if the user supplied one.
   */
  repoFlag?: string | undefined;
  /**
   * Path used as the candidate location for the "inside a registered
   * project" / "inside a git checkout" walks. For `jarvis run` this is
   * the spec path; for `jarvis plan` it's the intent file path (file
   * mode) or the effective working directory (inline / interactive
   * modes).
   *
   * Required: callers without any meaningful path candidate should pass
   * `process.cwd()` (or a `--cwd` override) explicitly so the path-walk
   * fallbacks have a starting point.
   */
  candidatePath: string;
  /**
   * Optional `repo:` value parsed from a spec body. Plan mode never
   * supplies this; run mode populates it from the spec's `repo:` line.
   */
  specRepo?: string | undefined;
  /**
   * Optional config dir override (for tests).
   */
  config?: ResolveOptions["config"];
  /**
   * Optional in-memory config object (for tests).
   */
  configObject?: ResolveOptions["configObject"];
};

/**
 * Resolve the target repository for a `jarvis` invocation.
 *
 * Thin facade over `resolveProject` so that `jarvis run` and `jarvis plan`
 * can share a single entry point with the same resolution rules:
 * `--repo` flag → spec `repo:` URL/slug → `candidatePath` inside a
 * registered project → `candidatePath` inside any git checkout (ad-hoc) →
 * prompt/error.
 *
 * Plan mode supplies only `repoFlag` and `candidatePath`; run mode
 * additionally supplies `specRepo`.
 */
export function resolveTargetRepo(
  opts: ResolveTargetRepoOptions,
): ResolveResult {
  const resolveOpts: ResolveOptions = {
    specPath: opts.candidatePath,
  };
  if (opts.repoFlag !== undefined) {
    resolveOpts.repoFlag = opts.repoFlag;
  }
  if (opts.specRepo !== undefined) {
    resolveOpts.specRepo = opts.specRepo;
  }
  if (opts.config !== undefined) {
    resolveOpts.config = opts.config;
  }
  if (opts.configObject !== undefined) {
    resolveOpts.configObject = opts.configObject;
  }
  return resolveProject(resolveOpts);
}

export type { ResolveResult } from "./resolve-project.ts";
