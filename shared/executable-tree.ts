import { createHash } from "node:crypto";
import type { AsyncSubprocessRunner } from "./subprocess.ts";

/** Git pathspecs whose tracked content defines the daemon executable tree digest. */
export const EXECUTABLE_TREE_PATHSPECS = [
  "v2/src",
  "shared",
  "package.json",
  "bun.lock",
  "tsconfig.json",
  "tsconfig.base.json",
  "v2/tsconfig.json",
  "shared/tsconfig.json",
] as const;

/** Representative changed paths and whether they require a daemon bounce when merged alone. */
export const PATH_BOUNCE_CLASSIFICATION_FIXTURE = [
  { path: "v2/src/cli.ts", bounceRequired: true },
  { path: "shared/git.ts", bounceRequired: true },
  { path: "package.json", bounceRequired: true },
  { path: "bun.lock", bounceRequired: true },
  { path: "tsconfig.json", bounceRequired: true },
  { path: "v2/spec/20260721T041838Z-docs-only-merge-does-not-halt-dispatch/index.md", bounceRequired: false },
  { path: "v2/docs/operator-runbook.md", bounceRequired: false },
  { path: "v1/src/cli.ts", bounceRequired: false },
  { path: "scripts/run-v2-tests.ts", bounceRequired: false },
  { path: "prompts/patch/rules.md", bounceRequired: false },
] as const;

function normalizeChangedPath(changedPath: string): string {
  return changedPath.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** True when a lone change to `changedPath` alters daemon-executable source and requires a bounce. */
export function requiresDaemonBounceForChangedPath(changedPath: string): boolean {
  const normalized = normalizeChangedPath(changedPath);
  for (const spec of EXECUTABLE_TREE_PATHSPECS) {
    if (normalized === spec || normalized.startsWith(`${spec}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * SHA-256 digest of tracked blob identities under {@link EXECUTABLE_TREE_PATHSPECS} at `HEAD`.
 *
 * The pathspecs are repo-root-relative and `git` resolves pathspecs against the process cwd, so
 * this resolves the repository top level from `cwd` first. Running `ls-tree` directly in a
 * subdirectory (e.g. a caller passing `import.meta.dir`) matches nothing and silently yields the
 * digest of the empty string, which compares unequal to every real digest.
 */
export async function getExecutableTreeDigest(cwd: string, runner: AsyncSubprocessRunner): Promise<string> {
  const repoRoot = (await runner.runAsync("git", ["rev-parse", "--show-toplevel"], cwd)).trim();
  const output = await runner.runAsync("git", ["ls-tree", "-r", "HEAD", "--", ...EXECUTABLE_TREE_PATHSPECS], repoRoot);
  const lines = output
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}
