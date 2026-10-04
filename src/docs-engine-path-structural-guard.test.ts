/**
 * Structural guard: committed operator docs and reliability specs must not retain retired
 * `v2/src`, `v2/spec`, or `v2/docs` live-engine path literals after the top-level tree move.
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const LIVE_ENGINE_PATH_LITERALS = ["v2/src", "v2/spec", "v2/docs"] as const;

type MarkdownSources = Readonly<Record<string, string>>;

export function liveEnginePathLiteralViolations(sources: MarkdownSources): string[] {
  const violations: string[] = [];
  for (const [path, source] of Object.entries(sources)) {
    for (const literal of LIVE_ENGINE_PATH_LITERALS) {
      if (source.includes(literal)) {
        violations.push(`${path}: ${literal}`);
      }
    }
  }
  return violations.sort();
}

function walkMarkdown(absDir: string, repoPrefix: string): MarkdownSources {
  const sources: Record<string, string> = {};
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const repoPath = `${repoPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      Object.assign(sources, walkMarkdown(join(absDir, entry.name), repoPath));
    } else if (entry.name.endsWith(".md")) {
      sources[repoPath] = readFileSync(join(absDir, entry.name), "utf-8");
    }
  }
  return sources;
}

function listGuardedMarkdownSources(): MarkdownSources {
  const sources: Record<string, string> = { ...walkMarkdown(join(REPO_ROOT, "docs"), "docs") };
  const reliabilityDir = join(REPO_ROOT, "spec");
  for (const entry of readdirSync(reliabilityDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.startsWith("reliability-") && entry.name.endsWith(".md")) {
      const repoPath = `spec/${entry.name}`;
      sources[repoPath] = readFileSync(join(reliabilityDir, entry.name), "utf-8");
    }
  }
  return sources;
}

test("committed docs and reliability specs contain no retired v2 live-engine path literals", () => {
  expect(liveEnginePathLiteralViolations(listGuardedMarkdownSources())).toEqual([]);
});

test("flags each retired live-engine path literal", () => {
  const fixtures: MarkdownSources = {
    "docs/example.md": "see v2/src/cli.ts\n",
    "spec/reliability-brief.md": "under v2/spec/foo\n",
  };
  expect(liveEnginePathLiteralViolations(fixtures)).toEqual([
    "docs/example.md: v2/src",
    "spec/reliability-brief.md: v2/spec",
  ]);
});
