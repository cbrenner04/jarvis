/**
 * Structural guard: no production source under shared/** or v2/src/** resolves a `.jarvis`
 * jarvis-home path via `homedir()`/`process.env.HOME` directly — only `shared/paths.ts`'s
 * `jarvisHome()` may. That bypass (session-log.ts's pre-fix `join(homedir(), ".jarvis", ...)`)
 * defeated the test preload's `JARVIS_HOME` isolation. Other `homedir()` use (e.g. the `.codex`
 * sessions resolver) is unrelated and must not be flagged.
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");

type ProductionSources = Readonly<Record<string, string>>;

/** `join(homedir(), ".jarvis", ...)`, optionally with a `process.env.HOME ??` fallback. */
const JARVIS_HOME_HOMEDIR_JOIN_PATTERN =
  /\bjoin\s*\(\s*(?:process\.env\.HOME\s*\?\?\s*)?homedir\s*\(\)\s*,\s*["'`]\.jarvis["'`]/;

const CANONICAL_RESOLVER_PATH = "shared/paths.ts";

/** Violations: files (other than the canonical resolver) joining homedir() with a `.jarvis` segment. */
export function jarvisHomeHomedirJoinViolations(sources: ProductionSources): string[] {
  const violations: string[] = [];
  for (const [path, source] of Object.entries(sources)) {
    if (path === CANONICAL_RESOLVER_PATH) continue;
    if (JARVIS_HOME_HOMEDIR_JOIN_PATTERN.test(source)) {
      violations.push(path);
    }
  }
  return violations.sort();
}

function isExempt(repoPath: string): boolean {
  return repoPath.endsWith(".test.ts") || repoPath.endsWith(".test.tsx") || repoPath.startsWith("v2/src/testing/");
}

/** shared/** and v2/src/** — excluding *.test.ts(x) and v2/src/testing/** fixtures. */
function listGuardedProductionSources(): ProductionSources {
  const sources: Record<string, string> = {};

  const walkDir = (absDir: string, repoPrefix: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const repoPath = `${repoPrefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walkDir(join(absDir, entry.name), repoPath);
      } else if ((entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) && !isExempt(repoPath)) {
        sources[repoPath] = readFileSync(join(absDir, entry.name), "utf-8");
      }
    }
  };

  walkDir(join(REPO_ROOT, "shared"), "shared");
  walkDir(join(REPO_ROOT, "v2/src"), "v2/src");

  return sources;
}

test("the guarded shared/** and v2/src/** production sources have no jarvis-home homedir() join violations", () => {
  expect(jarvisHomeHomedirJoinViolations(listGuardedProductionSources())).toEqual([]);
});

test("flags the pre-fix session-log resolver", () => {
  const preFixSessionLog = [
    "function defaultSessionsDir(): string {",
    '  return join(homedir(), ".jarvis", "sessions");',
    "}",
  ].join("\n");

  expect(jarvisHomeHomedirJoinViolations({ "shared/invocation/session-log.ts": preFixSessionLog })).toEqual([
    "shared/invocation/session-log.ts",
  ]);
});

test("does not flag shared/invocation/agents.ts's .codex sessions resolver", () => {
  const codexResolver = [
    "function getCodexSessionsDir(): string {",
    '  return join(process.env.HOME ?? homedir(), ".codex", "sessions");',
    "}",
  ].join("\n");

  expect(jarvisHomeHomedirJoinViolations({ "shared/invocation/agents.ts": codexResolver })).toEqual([]);
});

test("does not flag the canonical resolver itself", () => {
  const canonical = [
    "export function jarvisHome(): string {",
    '  return process.env.JARVIS_HOME ?? join(homedir(), ".jarvis");',
    "}",
  ].join("\n");

  expect(jarvisHomeHomedirJoinViolations({ "shared/paths.ts": canonical })).toEqual([]);
});
