import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { defaultGitDiff, extractFileFromDiffLine, isProductionFile } from "./diff-scan.ts";
export type RuntimeSmokeVerifierInput = {
  worktreePath: string;
  runBase: string;
};

export type SmokeObservedClean = {
  kind: "observed-clean";
};

declare const nonEmptyDiscoveryReasonBrand: unique symbol;

export type NonEmptyDiscoveryReason = string & { readonly [nonEmptyDiscoveryReasonBrand]: true };

export function nonEmptyDiscoveryReason(value: string): NonEmptyDiscoveryReason {
  if (value.trim() === "") throw new Error("Runtime smoke discovery reason must be non-empty");
  return value as NonEmptyDiscoveryReason;
}

export type SmokeNotRunnable = {
  kind: "not-runnable";
  inspectedPaths: string[];
  discoveryReason: NonEmptyDiscoveryReason;
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
  args: readonly string[],
  timeoutMs: number,
  env?: Record<string, string>,
) => Promise<{ success: boolean; output: string }>;

type ReadSourceFile = (path: string) => Promise<string | null>;
type ReadPidFile = (path: string) => Promise<number | null>;
type GetCurrentTime = () => number;

type VerifierSeams = {
  gitDiff?: GitDiff;
  executeEntrypoint?: ExecuteEntrypoint;
  readSourceFile?: ReadSourceFile;
  readPidFile?: ReadPidFile;
  getCurrentTime?: GetCurrentTime;
};

type RunnableSurface = {
  entrypoint: string;
  args: readonly string[];
  handshakeType: "cli-help" | "daemon-lifecycle";
};

const RUNTIME_SURFACES: readonly RunnableSurface[] = [
  { entrypoint: "v2/src/daemon-entrypoint.ts", args: [], handshakeType: "daemon-lifecycle" },
  { entrypoint: "v2/src/cli.ts", args: ["help"], handshakeType: "cli-help" },
];

async function defaultExecuteEntrypoint(
  cwd: string,
  entrypoint: string,
  args: readonly string[],
  timeoutMs: number,
  env?: Record<string, string>,
): Promise<{ success: boolean; output: string }> {
  const { realAsyncSubprocessRunner } = await import("../../../shared/subprocess.ts");
  try {
    const options: { timeoutMs: number; env?: NodeJS.ProcessEnv } = { timeoutMs };
    if (env) {
      options.env = Object.assign({}, process.env, env);
    }
    const output = await realAsyncSubprocessRunner.runAsync("bun", ["run", entrypoint, ...args], cwd, options);
    return { success: true, output };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, output: error };
  }
}

async function defaultReadPidFile(path: string): Promise<number | null> {
  try {
    const content = await readFile(path, "utf8");
    const raw = content.trim();
    if (raw.length === 0) return null;
    const pid = Number.parseInt(raw, 10);
    if (Number.isInteger(pid) && pid > 0) return pid;
    return null;
  } catch {
    return null;
  }
}

function defaultGetCurrentTime(): number {
  return Date.now();
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

async function defaultReadSourceFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function importedModulePaths(source: string): string[] {
  const paths = new Set<string>();
  const pattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    const modulePath = match[1] ?? match[2];
    if (modulePath?.startsWith(".")) paths.add(modulePath);
  }
  return [...paths];
}

function resolveImportedModule(worktreePath: string, importer: string, modulePath: string): string[] {
  const base = resolve(worktreePath, dirname(importer), modulePath);
  return [base, `${base}.ts`, resolve(base, "index.ts")].map((candidate) => {
    const path = normalize(relative(worktreePath, candidate));
    return path.startsWith("..") ? "" : path;
  });
}

async function surfaceLoadsFile(
  worktreePath: string,
  surface: RunnableSurface,
  changedFile: string,
  readSourceFile: ReadSourceFile,
): Promise<boolean> {
  const pending = [surface.entrypoint];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || visited.has(file)) continue;
    if (file === changedFile) return true;
    visited.add(file);
    const source = await readSourceFile(resolve(worktreePath, file));
    if (source === null) continue;
    for (const modulePath of importedModulePaths(source)) {
      for (const importedFile of resolveImportedModule(worktreePath, file, modulePath)) {
        if (!visited.has(importedFile)) pending.push(importedFile);
      }
    }
  }
  return false;
}

async function discoverChangedRunnableSurface(
  worktreePath: string,
  changedFiles: string[],
  readSourceFile: ReadSourceFile,
): Promise<RunnableSurface | null> {
  for (const changedFile of changedFiles) {
    const directSurface = RUNTIME_SURFACES.find((surface) => surface.entrypoint === changedFile);
    if (directSurface) return directSurface;
    for (const surface of RUNTIME_SURFACES) {
      if (await surfaceLoadsFile(worktreePath, surface, changedFile, readSourceFile)) return surface;
    }
  }
  return null;
}

function smokeFailure(command: string, observation: string): SmokeFailure {
  return { kind: "smoke-failure", command, observation };
}

async function verifyDaemonLifecycleHandshake(
  cwd: string,
  executeEntrypoint: ExecuteEntrypoint,
  readPidFile: ReadPidFile,
  getCurrentTime: GetCurrentTime,
  timeoutMs: number,
): Promise<SmokeFailure | SmokeObservedClean> {
  const isolatedHome = mkdtempSync(join(tmpdir(), "smoke-daemon-"));
  const env = { JARVIS_HOME: isolatedHome };
  const pidPath = join(isolatedHome, "daemon.pid");
  const deadline = getCurrentTime() + timeoutMs;

  try {
    const startResult = await executeEntrypoint(
      cwd,
      "v2/src/cli.ts",
      ["daemon", "start"],
      deadline - getCurrentTime(),
      env,
    );
    if (!startResult.success) {
      return smokeFailure("bun run v2/src/cli.ts daemon start", startResult.output);
    }

    let startData: { pid?: unknown; state?: string } = {};
    try {
      startData = JSON.parse(startResult.output);
    } catch {
      return smokeFailure("bun run v2/src/cli.ts daemon start", `invalid JSON response: ${startResult.output}`);
    }

    if (typeof startData.pid !== "number" || !Number.isInteger(startData.pid) || startData.pid <= 0) {
      return smokeFailure("bun run v2/src/cli.ts daemon start", `invalid pid in response: ${startData.pid}`);
    }

    const statusResult = await executeEntrypoint(
      cwd,
      "v2/src/cli.ts",
      ["daemon", "status"],
      deadline - getCurrentTime(),
      env,
    );
    if (!statusResult.success) {
      return smokeFailure("bun run v2/src/cli.ts daemon status", statusResult.output);
    }

    if (!statusResult.output.includes("running")) {
      return smokeFailure("bun run v2/src/cli.ts daemon status", `daemon not in running state: ${statusResult.output}`);
    }

    const stopResult = await executeEntrypoint(
      cwd,
      "v2/src/cli.ts",
      ["daemon", "stop"],
      deadline - getCurrentTime(),
      env,
    );
    if (!stopResult.success) {
      return smokeFailure("bun run v2/src/cli.ts daemon stop", stopResult.output);
    }

    return { kind: "observed-clean" };
  } finally {
    // Unconditional cleanup: kill any remaining daemon process and remove isolated home
    try {
      const remainingPid = await readPidFile(pidPath);
      if (remainingPid !== null && remainingPid > 0) {
        try {
          process.kill(remainingPid, "SIGKILL");
        } catch {
          // Process may already be dead
        }
      }
    } catch {
      // Ignore cleanup errors
    }
    try {
      rmSync(isolatedHome, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

export async function verifyRuntimeSmoke(
  input: RuntimeSmokeVerifierInput,
  seams?: VerifierSeams,
): Promise<VerificationResult> {
  const gitDiff = seams?.gitDiff ?? defaultGitDiff;
  const executeEntrypoint = seams?.executeEntrypoint ?? defaultExecuteEntrypoint;
  const readSourceFile = seams?.readSourceFile ?? defaultReadSourceFile;
  const readPidFile = seams?.readPidFile ?? defaultReadPidFile;
  const getCurrentTime = seams?.getCurrentTime ?? defaultGetCurrentTime;

  const diffOutput = await gitDiff(input.worktreePath, input.runBase);
  const changedFiles = parseDiffChangedFiles(diffOutput);

  if (changedFiles.length === 0) {
    return {
      kind: "not-runnable",
      inspectedPaths: [],
      discoveryReason: nonEmptyDiscoveryReason("no production files changed in diff"),
    };
  }

  const surface = await discoverChangedRunnableSurface(input.worktreePath, changedFiles, readSourceFile);

  if (!surface) {
    return {
      kind: "not-runnable",
      inspectedPaths: changedFiles,
      discoveryReason: nonEmptyDiscoveryReason("no changed runnable entrypoint found"),
    };
  }

  const wallClockTimeoutMs = 10000;

  if (surface.handshakeType === "daemon-lifecycle") {
    return await verifyDaemonLifecycleHandshake(
      input.worktreePath,
      executeEntrypoint,
      readPidFile,
      getCurrentTime,
      wallClockTimeoutMs,
    );
  }

  const result = await executeEntrypoint(input.worktreePath, surface.entrypoint, surface.args, wallClockTimeoutMs);

  if (!result.success) {
    return smokeFailure(`bun run ${surface.entrypoint} ${surface.args.join(" ")}`, result.output);
  }

  return {
    kind: "observed-clean",
  };
}
