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

/** SHA-256 digest of tracked blob identities under {@link EXECUTABLE_TREE_PATHSPECS} at `HEAD`. */
export async function getExecutableTreeDigest(cwd: string, runner: AsyncSubprocessRunner): Promise<string> {
  const output = await runner.runAsync("git", ["ls-tree", "-r", "HEAD", "--", ...EXECUTABLE_TREE_PATHSPECS], cwd);
  const lines = output
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}
