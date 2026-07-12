import { readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

export function resolveSpecCreationTitle(worktreePath: string, specPath: string): string | undefined {
  const resolvedSpecPath = isAbsolute(specPath) ? specPath : join(worktreePath, specPath);

  let isDirectory = false;
  try {
    isDirectory = statSync(resolvedSpecPath).isDirectory();
  } catch {
    // resolvedSpecPath may not exist yet as a directory; fall back to file-based resolution
  }

  const indexPath = isDirectory
    ? join(resolvedSpecPath, "index.md")
    : basename(resolvedSpecPath) === "index.md"
      ? resolvedSpecPath
      : join(dirname(resolvedSpecPath), "index.md");

  try {
    const heading = readFileSync(indexPath, "utf8")
      .split("\n")
      .find((line) => /^#\s+/.test(line));
    const title = heading?.replace(/^#\s+/, "").trim();
    return title ? title : undefined;
  } catch {
    return undefined;
  }
}
