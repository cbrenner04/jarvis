import { readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

export function resolveSpecCreationTitle(worktreePath: string, specPath: string): string | undefined {
  const resolvedSpecPath = isAbsolute(specPath) ? specPath : join(worktreePath, specPath);
  const indexPath =
    basename(resolvedSpecPath) === "index.md" ? resolvedSpecPath : join(dirname(resolvedSpecPath), "index.md");

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
