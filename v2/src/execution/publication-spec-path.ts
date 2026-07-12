import { isAbsolute, relative } from "node:path";

/** Worktree-relative path for PR bodies and completion commit messages. */
export function normalizePublicationSpecPath(worktreePath: string, specPath: string): string {
  if (!isAbsolute(specPath)) {
    return specPath.replace(/\\/g, "/");
  }
  const rel = relative(worktreePath, specPath).replace(/\\/g, "/");
  return rel.startsWith("..") ? specPath : rel;
}
