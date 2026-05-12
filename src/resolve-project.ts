import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import {
  type Config,
  type ConfigOptions,
  findProjectMatchForPath,
  loadConfig,
  type ProjectMatch,
} from "./config.ts";
import { normalizeRepoUrl } from "./repo-url.ts";

export type ResolvedProject = {
  project: ProjectMatch;
  mode: "registered" | "ad-hoc";
  /**
   * Which resolution step produced this match. Used by callers to attribute
   * downstream errors (e.g. missing project root) to the right input.
   *
   * - `repo-flag`: matched via the `--repo` CLI flag.
   * - `spec-repo`: matched via the spec body's `repo:` line (absolute-path
   *   exact match against a registered root, or URL/slug loose match against
   *   a registered origin).
   * - `registered`: spec path lives inside a registered project's root.
   * - `ad-hoc`: walked parents from the spec location until a `.git` was
   *   found; not registered in config.
   */
  source: "repo-flag" | "spec-repo" | "registered" | "ad-hoc";
};

export type ResolveResult =
  | { kind: "ok"; resolved: ResolvedProject }
  | { kind: "error"; message: string }
  | { kind: "ambiguous"; candidates: ProjectMatch[]; reason: string }
  | { kind: "needs-prompt"; reason: string };

export type ResolveOptions = {
  /** Spec path on disk (absolute or relative). */
  specPath: string;
  /** Optional `repo:` line value parsed from the spec body. */
  specRepo?: string | undefined;
  /** Optional `--repo` CLI flag value. */
  repoFlag?: string | undefined;
  /** Optional explicit config (for tests); otherwise loaded from disk. */
  config?: ConfigOptions;
  /** Override the loaded config object directly (for tests). */
  configObject?: Config;
};

/**
 * Resolve which project a `jarvis run` invocation should target.
 *
 * See spec/portable-repo-resolution/01-repo-url-resolution.md for the
 * resolution order.
 */
export function resolveProject(opts: ResolveOptions): ResolveResult {
  const cfg = opts.configObject ?? loadConfig(opts.config);
  const projects = listProjects(cfg);

  // Step 1: --repo flag (if given) → resolve and stop.
  if (opts.repoFlag !== undefined) {
    return resolveFromFlag(opts.repoFlag, projects);
  }

  // Step 2: Spec `repo:` URL/slug → loose-match against registered origins.
  // Legacy absolute-path repo values are handled by subspec 03; here we
  // preserve back-compat by checking for an exact root match first.
  if (opts.specRepo !== undefined && opts.specRepo.trim() !== "") {
    const repoValue = opts.specRepo.trim();
    if (isAbsolute(repoValue)) {
      const exact = projects.find((p) => p.root === resolve(repoValue));
      if (exact !== undefined) {
        return {
          kind: "ok",
          resolved: {
            project: exact,
            mode: "registered",
            source: "spec-repo",
          },
        };
      }
      // Otherwise ignored per portable-repo-resolution decisions; fall
      // through to location-based resolution.
    } else {
      const normalized = normalizeRepoUrl(repoValue);
      if (normalized === undefined) {
        return {
          kind: "error",
          message: `unrecognized \`repo:\` value: ${repoValue}`,
        };
      }
      const matches = projects.filter(
        (p) =>
          p.origin !== undefined && normalizeRepoUrl(p.origin) === normalized,
      );
      if (matches.length === 1) {
        const project = matches[0] as ProjectMatch;
        return {
          kind: "ok",
          resolved: { project, mode: "registered", source: "spec-repo" },
        };
      }
      if (matches.length > 1) {
        return {
          kind: "ambiguous",
          candidates: matches,
          reason: `multiple registered projects match repo ${repoValue}`,
        };
      }
      // No matches → fall through to location-based resolution.
    }
  }

  const specPath = resolve(opts.specPath);

  // Step 3: spec lives inside a registered project's root.
  const byPath = findProjectMatchForPath(specPath, opts.config);
  if (byPath !== undefined) {
    return {
      kind: "ok",
      resolved: { project: byPath, mode: "registered", source: "registered" },
    };
  }

  // Step 4: spec lives inside any git checkout (walk parents until `.git`).
  const gitRoot = findGitCheckoutRoot(dirname(specPath));
  if (gitRoot !== undefined) {
    return {
      kind: "ok",
      resolved: {
        project: { key: basenameOf(gitRoot), root: gitRoot },
        mode: "ad-hoc",
        source: "ad-hoc",
      },
    };
  }

  // Step 5: fall through to prompt (handled by subspec 02; surface signal).
  return {
    kind: "needs-prompt",
    reason: "spec could not be resolved to a project automatically",
  };
}

function listProjects(cfg: Config): ProjectMatch[] {
  const out: ProjectMatch[] = [];
  for (const [key, project] of Object.entries(cfg.projects)) {
    const match: ProjectMatch = { key, root: project.root };
    if (project.origin !== undefined) {
      match.origin = project.origin;
    }
    out.push(match);
  }
  return out;
}

function resolveFromFlag(
  value: string,
  projects: ProjectMatch[],
): ResolveResult {
  const trimmed = value.trim();
  if (trimmed === "") {
    return { kind: "error", message: "--repo value is empty" };
  }

  // Try matching as a registered project name first (exact match).
  const byName = projects.find((p) => p.key === trimmed);
  if (byName !== undefined) {
    return {
      kind: "ok",
      resolved: { project: byName, mode: "registered", source: "repo-flag" },
    };
  }

  // Absolute path: must equal a registered project's root.
  if (isAbsolute(trimmed)) {
    const root = resolve(trimmed);
    const byRoot = projects.find((p) => p.root === root);
    if (byRoot !== undefined) {
      return {
        kind: "ok",
        resolved: { project: byRoot, mode: "registered", source: "repo-flag" },
      };
    }
    return {
      kind: "error",
      message: formatUnknownRepoError(trimmed, projects),
    };
  }

  // URL or slug: loose-match against registered origins.
  const normalized = normalizeRepoUrl(trimmed);
  if (normalized !== undefined) {
    const matches = projects.filter(
      (p) =>
        p.origin !== undefined && normalizeRepoUrl(p.origin) === normalized,
    );
    if (matches.length === 1) {
      const project = matches[0] as ProjectMatch;
      return {
        kind: "ok",
        resolved: { project, mode: "registered", source: "repo-flag" },
      };
    }
    if (matches.length > 1) {
      return {
        kind: "ambiguous",
        candidates: matches,
        reason: `multiple registered projects match --repo ${trimmed}`,
      };
    }
  }

  return { kind: "error", message: formatUnknownRepoError(trimmed, projects) };
}

function formatUnknownRepoError(
  value: string,
  projects: ProjectMatch[],
): string {
  const names = projects.map((p) => p.key).sort();
  const list =
    names.length === 0
      ? "(none registered)"
      : names.map((n) => `  - ${n}`).join("\n");
  return `--repo: no project matches ${JSON.stringify(value)}\nRegistered projects:\n${list}`;
}

function findGitCheckoutRoot(start: string): string | undefined {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function basenameOf(p: string): string {
  const parts = p.split(sep).filter((s) => s.length > 0);
  return parts.length === 0 ? p : (parts[parts.length - 1] as string);
}
