export type RuntimeSmokeVerifierInput = {
  worktreePath: string;
  runBase: string;
};

export type SmokeObservedClean = {
  kind: "observed-clean";
};

export type SmokeNotRunnable = {
  kind: "not-runnable";
  inspectedPaths: string[];
  discoveryReason: string;
};

export type SmokePass = SmokeObservedClean | SmokeNotRunnable;

export type SmokeFailure = {
  kind: "smoke-failure";
  command: string;
  observation: string;
};

export type VerificationResult = SmokePass | SmokeFailure;

type GitDiff = (cwd: string, baseRef: string) => Promise<string>;
type ExecuteEntrypoint = (
  cwd: string,
  entrypoint: string,
  timeoutMs: number,
) => Promise<{ success: boolean; output: string }>;

type VerifierSeams = {
  gitDiff?: GitDiff;
  executeEntrypoint?: ExecuteEntrypoint;
};

async function defaultGitDiff(cwd: string, baseRef: string): Promise<string> {
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

async function defaultExecuteEntrypoint(
  cwd: string,
  entrypoint: string,
  timeoutMs: number,
): Promise<{ success: boolean; output: string }> {
  const { realAsyncSubprocessRunner } = await import("../../../shared/subprocess.ts");
  try {
    const output = await realAsyncSubprocessRunner.runAsync("bun", ["run", entrypoint, "--help"], cwd, { timeoutMs });
    return { success: true, output };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, output: error };
  }
}

function isProductionFile(path: string): boolean {
  const NON_PRODUCTION_PATTERNS = [
    /\.test\.ts$/,
    /\.test\.js$/,
    /^test\//,
    /^v1\/spec\//,
    /^v2\/spec\//,
    /^v1\/docs\//,
    /^v2\/docs\//,
  ];
  return !NON_PRODUCTION_PATTERNS.some((pattern) => pattern.test(path));
}

function extractFileFromDiffLine(line: string): string | null {
  const match = line.match(/b\/(.+)$/);
  return match?.[1] ?? null;
}

function parseDiffChangedFiles(diffOutput: string): string[] {
  const changedFiles = new Set<string>();
  const diffLines = diffOutput.split("\n");

  for (const line of diffLines) {
    if (line.startsWith("diff --git")) {
      const file = extractFileFromDiffLine(line);
      if (file && isProductionFile(file)) {
        changedFiles.add(file);
      }
    }
  }

  return Array.from(changedFiles);
}

function isRunnableEntrypoint(filePath: string): boolean {
  // Explicit entrypoint files (e.g., daemon-entrypoint.ts, cli-entrypoint.ts)
  if (filePath.endsWith("-entrypoint.ts")) {
    return true;
  }

  // Root-level entrypoints: cli.ts at v1/src or v2/src, or index.ts at v1/src
  const runnableRoots = ["v1/src/index.ts", "v2/src/cli.ts"];
  if (runnableRoots.includes(filePath)) {
    return true;
  }

  return false;
}

async function discoverChangedRunnableEntrypoint(
  _worktreePath: string,
  changedFiles: string[],
  _gitDiff: GitDiff,
): Promise<string | null> {
  // Discover a changed runnable entrypoint from the production diff
  for (const file of changedFiles) {
    if (isRunnableEntrypoint(file)) {
      return file;
    }
  }
  return null;
}

export async function verifyRuntimeSmoke(
  input: RuntimeSmokeVerifierInput,
  seams?: VerifierSeams,
): Promise<VerificationResult> {
  const gitDiff = seams?.gitDiff ?? defaultGitDiff;
  const executeEntrypoint = seams?.executeEntrypoint ?? defaultExecuteEntrypoint;

  const diffOutput = await gitDiff(input.worktreePath, input.runBase);
  const changedFiles = parseDiffChangedFiles(diffOutput);

  if (changedFiles.length === 0) {
    return {
      kind: "not-runnable",
      inspectedPaths: [],
      discoveryReason: "no production files changed in diff",
    };
  }

  const entrypoint = await discoverChangedRunnableEntrypoint(input.worktreePath, changedFiles, gitDiff);

  if (!entrypoint) {
    return {
      kind: "not-runnable",
      inspectedPaths: changedFiles,
      discoveryReason: "no changed runnable entrypoint found",
    };
  }

  // Execute the entrypoint with a wall-clock bound
  const SMOKE_TIMEOUT_MS = 5000; // 5 second timeout
  const result = await executeEntrypoint(input.worktreePath, entrypoint, SMOKE_TIMEOUT_MS);

  if (!result.success) {
    return {
      kind: "smoke-failure",
      command: `bun run ${entrypoint} --help`,
      observation: result.output,
    };
  }

  return {
    kind: "observed-clean",
  };
}
