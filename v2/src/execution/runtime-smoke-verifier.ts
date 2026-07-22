import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { AsyncSubprocessError, realAsyncSubprocessRunner, type AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
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
) => Promise<{ success: boolean; output: string; command?: string }>;

type ReadSourceFile = (path: string) => Promise<string | null>;

type VerifierSeams = {
  gitDiff?: GitDiff;
  executeEntrypoint?: ExecuteEntrypoint;
  readSourceFile?: ReadSourceFile;
};

type RunnableSurface = {
  entrypoint: string;
  args: readonly string[];
};

const RUNTIME_SURFACES: readonly RunnableSurface[] = [
  { entrypoint: "v2/src/daemon-entrypoint.ts", args: ["daemon", "start/status/stop"] },
  { entrypoint: "v2/src/cli.ts", args: ["help"] },
];

const RUNTIME_SMOKE_TIMEOUT_MS = 5_000;

type DaemonHandshakeSeams = {
  now?: () => number;
  mkdtemp?: (prefix: string) => Promise<string>;
  remove?: (path: string, options: { recursive: true; force: true }) => Promise<void>;
  runAsync?: AsyncSubprocessRunner["runAsync"];
  readPid?: (runtimeHome: string) => Promise<number | null>;
  isProcessAlive?: (pid: number) => boolean;
  terminateProcess?: (pid: number) => void;
};

function remainingTimeout(deadline: number, now: () => number): number {
  return Math.max(0, deadline - now());
}

function lifecycleCommand(args: readonly string[]): string {
  return `bun run v2/src/cli.ts daemon ${args.join(" ")}`;
}

function deadlineExceeded(command: string): { success: false; output: string; command: string } {
  return { success: false, command, output: `runtime smoke deadline expired before ${command}` };
}

export async function runDaemonHandshake(
  cwd: string,
  timeoutMs: number,
  seams?: DaemonHandshakeSeams,
): Promise<{ success: boolean; output: string; command?: string }> {
  const now = seams?.now ?? Date.now;
  const runAsync = seams?.runAsync ?? realAsyncSubprocessRunner.runAsync;
  const createTempDir = seams?.mkdtemp ?? mkdtemp;
  const remove = seams?.remove ?? rm;
  const deadline = now() + timeoutMs;
  let runtimeHome: string | null = null;
  let pid: number | null = null;
  let daemonMayExist = false;
  let forcedStopSucceeded = false;
  let failure: { success: false; output: string; command: string } | null = null;
  let cleanupFailure: string | null = null;
  try {
    runtimeHome = await createTempDir(join(cwd, ".runtime-smoke-"));
  } catch (error) {
    return { success: false, command: "runtime smoke setup", output: error instanceof Error ? error.message : String(error) };
  }
  const env = { ...process.env, JARVIS_HOME: runtimeHome };
  const readPid = seams?.readPid ?? (async (home: string) => {
    try {
      const value = Number.parseInt(await readFile(join(home, "daemon.pid"), "utf8"), 10);
      return Number.isInteger(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  });
  const isProcessAlive = seams?.isProcessAlive ?? ((candidate: number) => {
    try {
      process.kill(candidate, 0);
      return true;
    } catch {
      return false;
    }
  });
  const terminateProcess = seams?.terminateProcess ?? ((candidate: number) => process.kill(candidate, "SIGKILL"));
  const run = async (args: string[]): Promise<string> => {
    const command = lifecycleCommand(args);
    const remaining = remainingTimeout(deadline, now);
    if (remaining <= 0) throw deadlineExceeded(command);
    try {
      return await runAsync("bun", ["run", "v2/src/cli.ts", "daemon", ...args], cwd, { timeoutMs: remaining, env });
    } catch (error) {
      const baseOutput = error instanceof AsyncSubprocessError ? `${error.message}\n${error.stderr}` : error instanceof Error ? error.message : String(error);
      const daemonLog = args[0] === "start" ? await readFile(join(runtimeHome, "daemon.log"), "utf8").catch(() => "") : "";
      const output = daemonLog === "" ? baseOutput : `${baseOutput}\n${daemonLog}`;
      throw Object.assign(new Error(output), { command, output });
    }
  };

  try {
    await run(["start"]);
    daemonMayExist = true;
    pid = await readPid(runtimeHome);
    const status = await run(["status"]);
    if (!status.startsWith("running ")) {
      failure = { success: false, command: lifecycleCommand(["status"]), output: `daemon status was not compatible: ${status}` };
    } else {
      await run(["stop"]);
    }
  } catch (error) {
    failure = typeof error === "object" && error !== null && "command" in error && "output" in error
      ? { success: false, command: String(error.command), output: String(error.output) }
      : { success: false, command: lifecycleCommand(["start"]), output: error instanceof Error ? error.message : String(error) };
  } finally {
    if (pid === null) pid = await readPid(runtimeHome);
    try {
      await run(["stop", "--force"]);
      forcedStopSucceeded = true;
    } catch {
      // A deadline or CLI failure still falls through to direct process reaping.
    }
    if (pid !== null && isProcessAlive(pid)) {
      try {
        terminateProcess(pid);
      } catch (error) {
        cleanupFailure ??= error instanceof Error ? error.message : String(error);
      }
      if (isProcessAlive(pid)) cleanupFailure ??= `daemon process ${pid} remained alive after cleanup`;
    }
    if (daemonMayExist && !forcedStopSucceeded && pid === null) {
      cleanupFailure ??= "forced daemon stop failed without a pid to confirm termination";
    }
    if (cleanupFailure === null) {
      try {
        await remove(runtimeHome, { recursive: true, force: true });
      } catch (error) {
        cleanupFailure = error instanceof Error ? error.message : String(error);
      }
    }
  }
  if (cleanupFailure !== null) return { success: false, command: lifecycleCommand(["stop", "--force"]), output: cleanupFailure };
  return failure ?? { success: true, output: "" };
}

async function defaultExecuteEntrypoint(
  cwd: string,
  entrypoint: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<{ success: boolean; output: string; command?: string }> {
  if (entrypoint === "v2/src/daemon-entrypoint.ts") {
    return runDaemonHandshake(cwd, timeoutMs);
  }
  try {
    const output = await realAsyncSubprocessRunner.runAsync("bun", ["run", entrypoint, ...args], cwd, { timeoutMs });
    return { success: true, output };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, output: error };
  }
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

export async function verifyRuntimeSmoke(
  input: RuntimeSmokeVerifierInput,
  seams?: VerifierSeams,
): Promise<VerificationResult> {
  const gitDiff = seams?.gitDiff ?? defaultGitDiff;
  const executeEntrypoint = seams?.executeEntrypoint ?? defaultExecuteEntrypoint;
  const readSourceFile = seams?.readSourceFile ?? defaultReadSourceFile;

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

  const result = await executeEntrypoint(input.worktreePath, surface.entrypoint, surface.args, RUNTIME_SMOKE_TIMEOUT_MS);

  if (!result.success) {
    return {
      kind: "smoke-failure",
      command: result.command ?? `bun run ${surface.entrypoint} ${surface.args.join(" ")}`,
      observation: result.output,
    };
  }

  return {
    kind: "observed-clean",
  };
}
