import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ProjectMatch } from "../../config.ts";

export function formatPlanSpecTimestamp(date: Date = new Date()): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:/g, "-");
}

const TIMESTAMPED_SPEC_DIR_RE = /^(?:\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z|\d{8}T\d{6}Z)-(.+)$/;

export function stripPlanSpecTimestampPrefix(dirBasename: string): string {
  const match = TIMESTAMPED_SPEC_DIR_RE.exec(dirBasename);
  return match?.[1] ?? dirBasename;
}

/**
 * Compute a filesystem-safe project identifier from a project match.
 * Prefers the project key, falls back to a safe slug derived from the origin URL,
 * and finally uses the root basename if no other identifier is available.
 */
export function computeProjectSafeId(project: ProjectMatch): string {
  // Prefer the project key
  if (project.key && project.key.length > 0) {
    return project.key;
  }

  // Fall back to origin-derived slug if available
  if (project.origin) {
    const slug = project.origin
      .toLowerCase()
      .replace(/^(?:https?:\/\/|ssh:\/\/|git:\/\/|git@)/, "") // Strip protocols and git@
      .replace(/[:./]+/g, "_") // Replace separators with underscores
      .replace(/\.git$/, "") // Strip .git suffix
      .replace(/[^a-z0-9_-]/g, "") // Keep only safe chars
      .replace(/^_+|_+$/g, ""); // Trim underscores
    if (slug.length > 0) {
      return slug;
    }
  }

  // Last resort: basename of root
  return project.root.split(/[/\\]/).pop() || "project";
}

/**
 * Compute the Jarvis-owned spec storage root for a no-commit plan.
 * Returns: `<jarvisConfigDir>/specs/<projectSafeId>/<specDirBasename>/`
 */
export function computeNoCommitSpecRoot(
  jarvisConfigDir: string,
  project: ProjectMatch,
  specDirBasename: string,
): string {
  const projectId = computeProjectSafeId(project);
  return join(jarvisConfigDir, "specs", projectId, specDirBasename);
}

/**
 * Create the parent directory for a no-commit spec and return the spec root.
 * Returns: `<jarvisConfigDir>/specs/<projectSafeId>/<specDirBasename>/`
 */
export function ensureNoCommitSpecRoot(
  jarvisConfigDir: string,
  project: ProjectMatch,
  specDirBasename: string,
): string {
  const specRoot = computeNoCommitSpecRoot(jarvisConfigDir, project, specDirBasename);
  mkdirSync(join(specRoot, ".."), { recursive: true });
  return specRoot;
}
