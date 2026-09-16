import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { resolveSpecIndexPath } from "./spec-creation-title.ts";

/** Worktree-relative path for PR bodies and completion commit messages. */
export function normalizePublicationSpecPath(worktreePath: string, specPath: string): string {
  if (!isAbsolute(specPath)) {
    return specPath.replace(/\\/g, "/");
  }
  const rel = relative(worktreePath, specPath).replace(/\\/g, "/");
  return rel.startsWith("..") ? specPath : rel;
}

/** PR-body-only `Spec:` line: repo-relative for in-worktree specs, spec dir/file basename
 * otherwise — never leaks an absolute or home-relative path into a PR body. */
export function formatPublicationSpecPathForPrBody(worktreePath: string, specPath: string): string {
  const normalized = normalizePublicationSpecPath(worktreePath, specPath);
  if (!isAbsolute(normalized)) return normalized;
  const resolvedSpecPath = isAbsolute(specPath) ? specPath : join(worktreePath, specPath);
  const indexPath = resolveSpecIndexPath(worktreePath, specPath);
  return indexPath ? basename(dirname(indexPath)) : basename(resolvedSpecPath);
}
