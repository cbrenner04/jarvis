import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function assertIndexLinks(indexBody: string, sourceFiles: readonly string[]): void {
  const linked = new Set<string>();
  const lines = indexBody.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const match = line.match(/^\s*-\s\[[ xX]\]\s+\[[^\]]+\]\((?:\.\/)?([^)]+)\)$/u);
    const file = match?.[1];
    if (file === undefined || !/^\d{2}-.*\.md$/u.test(file)) continue;
    if (!sourceFiles.includes(file)) throw new Error(`Plan index links unknown subspec ${file}`);
    if (linked.has(file)) throw new Error(`Plan index links ${file} more than once`);
    linked.add(file);
  }
  for (const file of sourceFiles) {
    if (!linked.has(file)) throw new Error(`Plan index does not link ${file}`);
  }
}

/** Validates that the authored plan index links every authored subspec exactly once. */
export function normalizePlanDraftSpecDir(specDir: string): void {
  const sourceFiles = readdirSync(specDir)
    .filter((file) => /^\d{2}-.*\.md$/u.test(file))
    .sort();
  const indexBody = readFileSync(join(specDir, "index.md"), "utf8");
  assertIndexLinks(indexBody, sourceFiles);
}
