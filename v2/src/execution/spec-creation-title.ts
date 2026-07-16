import { readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

export class PublicationTitleResolutionError extends Error {
  constructor(specPath: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Title resolution failed for spec ${specPath}: ${reason}`);
    this.name = "PublicationTitleResolutionError";
  }
}

/** Resolve `index.md` for a publication spec path (directory, index file, or sibling index). */
export function resolveSpecIndexPath(worktreePath: string, specPath: string): string {
  const resolvedSpecPath = isAbsolute(specPath) ? specPath : join(worktreePath, specPath);

  let isDirectory = false;
  try {
    isDirectory = statSync(resolvedSpecPath).isDirectory();
  } catch {
    // resolvedSpecPath may not exist yet as a directory; fall back to file-based resolution
  }

  return isDirectory || basename(resolvedSpecPath) === "index.md"
    ? join(resolvedSpecPath, isDirectory ? "index.md" : "")
    : "";
}

/** Resolve the title at publication time; explicit workflow titles remain authoritative. */
export function resolvePublicationTitle(worktreePath: string, specPath: string, explicitTitle?: unknown): string {
  if (typeof explicitTitle === "string" && explicitTitle.trim()) return explicitTitle.trim();
  const resolvedSpecPath = isAbsolute(specPath) ? specPath : join(worktreePath, specPath);
  const indexPath = resolveSpecIndexPath(worktreePath, specPath);
  if (!indexPath) return basename(resolvedSpecPath);
  try {
    const content = readFileSync(indexPath, "utf8");
    const heading = content.split("\n").find((line) => /^#\s+\S/.test(line));
    return heading?.replace(/^#\s+/, "").trim() || basename(dirname(indexPath));
  } catch (error) {
    throw new PublicationTitleResolutionError(specPath, error);
  }
}
