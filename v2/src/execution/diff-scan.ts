/** Shared diff plumbing for the completion verifiers (mutation + runtime smoke). */

export async function defaultGitDiff(cwd: string, baseRef: string): Promise<string> {
  const { realAsyncSubprocessRunner } = await import("../../../shared/subprocess.ts");
  try {
    return await realAsyncSubprocessRunner.runAsync(
      "git",
      ["diff", `${baseRef}...HEAD`, "--no-ext-diff", "--no-color"],
      cwd,
    );
  } catch {
    return "";
  }
}

const NON_PRODUCTION_PATTERNS = [
  /\.test\.ts$/,
  /\.test\.js$/,
  /^test\//,
  /^v1\/spec\//,
  /^v2\/spec\//,
  /^v1\/docs\//,
  /^v2\/docs\//,
];

export function isProductionFile(path: string): boolean {
  return !NON_PRODUCTION_PATTERNS.some((pattern) => pattern.test(path));
}

export function extractFileFromDiffLine(line: string): string | null {
  const match = line.match(/b\/(.+)$/);
  return match?.[1] ?? null;
}
