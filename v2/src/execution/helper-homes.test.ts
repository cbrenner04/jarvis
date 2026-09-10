import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const V2_SRC = join(import.meta.dir, "..");

function productionSources(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "testing") walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name) || entry.name.endsWith(".test-support.ts"))
        continue;
      out.push([relative(V2_SRC, path).replace(/\\/g, "/"), readFileSync(path, "utf8")]);
    }
  };
  walk(V2_SRC);
  return out;
}

/** Helper family → the one v2 file allowed to define it (shared homes live outside v2/src). */
const CANONICAL_V2_HOMES: Readonly<Record<string, string | undefined>> = {
  isRecord: undefined,
  isLoadError: "config/agent-model-config.ts",
  errorMessage: undefined,
  sleep: undefined,
  throwIfAborted: "execution/throw-if-aborted.ts",
  resolveTargetDir: undefined,
  listMarkdownFiles: undefined,
  listFiles: undefined,
};

test("inventoried helper families have no local copies under v2/src", () => {
  const sources = productionSources();
  expect(sources.length).toBeGreaterThan(50);
  for (const [family, home] of Object.entries(CANONICAL_V2_HOMES)) {
    const pattern = new RegExp(`^(?:export )?(?:async )?function ${family}\\(`, "m");
    const definers = sources.filter(([, source]) => pattern.test(source)).map(([path]) => path);
    expect(definers, family).toEqual(home === undefined ? [] : [home]);
  }
});

test("managed worktree layout is derived only through paths.ts", () => {
  const offenders = productionSources()
    .filter(([path, source]) => path !== "paths.ts" && /join\([^)]*"worktrees"/.test(source))
    .map(([path]) => path);
  expect(offenders).toEqual([]);
  const paths = readFileSync(join(V2_SRC, "paths.ts"), "utf8");
  expect(paths).toContain("export function managedWorktreePath(");
  expect(paths).toContain("export function worktreesRoot(");
});

test("execution-loop error text goes through the shared errorMessage helper", () => {
  const offenders = productionSources()
    .filter(
      ([path, source]) =>
        path.startsWith("execution/") && /\b(\w+) instanceof Error \? \1\.message : String\(\1\)/.test(source),
    )
    .map(([path]) => path);
  expect(offenders).toEqual([]);
});
