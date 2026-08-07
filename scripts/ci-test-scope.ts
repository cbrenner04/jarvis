import { readFileSync } from "node:fs";

export type ScopedTests = "full" | string[];

const ROOT_TOOLING_PATTERNS = [/^package\.json$/, /^tsconfig.*\.json$/, /^\.github\//, /^scripts\//];

const NO_TEST_IMPACT_PATTERNS = [
  /^ready-intents\//,
  /^reports\//,
  /^v1\/docs\//,
  /^v1\/spec\//,
  /^v2\/docs\//,
  /^v2\/spec\//,
];

/** Classify already-resolved changed paths into the scripts CI needs to run. */
export function classifyChangedPaths(paths: string[]): ScopedTests {
  if (paths.length === 0) {
    return "full";
  }

  for (const path of paths) {
    if (ROOT_TOOLING_PATTERNS.some((pattern) => pattern.test(path))) {
      return "full";
    }
  }

  const filtered = paths.filter((path) => !NO_TEST_IMPACT_PATTERNS.some((pattern) => pattern.test(path)));
  if (filtered.length === 0) {
    return [];
  }

  let needsV1 = false;
  let needsV2 = false;
  let needsShared = false;

  for (const path of filtered) {
    if (path.startsWith("v1/")) {
      needsV1 = true;
    } else if (path.startsWith("v2/")) {
      needsV2 = true;
    } else if (path.startsWith("shared/")) {
      needsV1 = true;
      needsV2 = true;
      needsShared = true;
    } else if (path.startsWith("test/")) {
      needsShared = true;
    } else {
      return "full";
    }
  }

  const scripts: string[] = [];
  if (needsV1) scripts.push("test:v1", "test:integration:v1");
  if (needsV2) scripts.push("test:v2", "test:integration:v2");
  if (needsShared) scripts.push("test:shared", "test:integration:shared");
  return scripts.length > 0 ? scripts : "full";
}

/** Entry point: falls back to `full` whenever the base SHA didn't resolve. */
export function resolveCiTestScope(changedPaths: string[], baseResolvable: boolean): ScopedTests {
  if (!baseResolvable) {
    const classified = classifyChangedPaths(changedPaths);
    if (classified === "full") {
      return "full";
    }
    if (classified.length === 0) {
      return [];
    }
    return "full";
  }
  return classifyChangedPaths(changedPaths);
}

if (import.meta.main) {
  const resolvable = process.argv[2] === "true";
  const changedPaths = readFileSync(0, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const result = resolveCiTestScope(changedPaths, resolvable);
  process.stdout.write(result === "full" ? "full" : result.join(" "));
}
