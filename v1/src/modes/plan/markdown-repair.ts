import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { applyIssueReferenceGuard, runMarkdownlintAutofix } from "../../markdownlint-repair.ts";
import { stripNonContractIndexLines } from "./index-cleanup.ts";

/** Plan spec markdown eligible for pre-ready repair (`index.md`, `intent.md`, numbered subspecs). */
export function listPlanSpecMarkdownPaths(specDirPath: string): string[] {
  if (!existsSync(specDirPath)) {
    return [];
  }

  const paths: string[] = [];
  for (const name of ["index.md", "intent.md"]) {
    const path = join(specDirPath, name);
    if (existsSync(path)) {
      paths.push(path);
    }
  }

  for (const entry of readdirSync(specDirPath)) {
    if (/^\d{2}-.+\.md$/.test(entry) && !entry.startsWith("verdict-")) {
      paths.push(join(specDirPath, entry));
    }
  }

  return paths;
}

/**
 * Lint-clean generated plan spec markdown before the ready gate.
 * Applies MD018 guard, markdownlint autofix, then re-strips non-contract index lines when committing.
 */
export async function repairPlanSpecMarkdown(args: {
  specDirPath: string;
  commit: boolean;
  warn: (message: string) => void;
}): Promise<void> {
  const files = listPlanSpecMarkdownPaths(args.specDirPath);
  for (const path of files) {
    applyIssueReferenceGuard(path);
  }

  await runMarkdownlintAutofix({ files, warn: args.warn });

  if (args.commit) {
    stripNonContractIndexLines({
      specDirPath: args.specDirPath,
      stderr: args.warn,
    });
  }
}
