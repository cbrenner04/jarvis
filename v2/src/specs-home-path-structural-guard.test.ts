/**
 * Structural guard: no v2/src production source outside paths.ts joins the literal "specs"
 * path segment. Every project specs home is built via paths.ts's `specsHome`/`specsRoot` — see
 * 00-specs-home-builder.
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const CANONICAL_SPECS_LITERAL_PATH = "v2/src/paths.ts";
const SPECS_LITERAL_PATTERN = /["']specs["']/;

type ProductionSources = Readonly<Record<string, string>>;

export function specsLiteralViolations(sources: ProductionSources): string[] {
  const violations: string[] = [];
  for (const [path, source] of Object.entries(sources)) {
    if (path === CANONICAL_SPECS_LITERAL_PATH) continue;
    if (SPECS_LITERAL_PATTERN.test(source)) {
      violations.push(path);
    }
  }
  return violations.sort();
}

/** Every non-test `.ts` file under v2/src. */
function listV2ProductionSources(): ProductionSources {
  const sources: Record<string, string> = {};
  const walk = (absDir: string, repoPrefix: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const repoPath = `${repoPrefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(absDir, entry.name), repoPath);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        sources[repoPath] = readFileSync(join(absDir, entry.name), "utf-8");
      }
    }
  };
  walk(join(REPO_ROOT, "v2/src"), "v2/src");
  return sources;
}

test('no v2/src production source outside paths.ts joins a "specs" path literal', () => {
  expect(specsLiteralViolations(listV2ProductionSources())).toEqual([]);
});

test('flags a "specs" path literal in a non-exempt file, not in paths.ts', () => {
  const fixtures: ProductionSources = {
    "v2/src/paths.ts": 'export function specsRoot(root: string): string { return join(root, "specs"); }\n',
    "v2/src/commands/cleanup.ts": 'const home = join(jarvisHome(), "specs", safeId);\n',
  };

  expect(specsLiteralViolations(fixtures)).toEqual(["v2/src/commands/cleanup.ts"]);
});
