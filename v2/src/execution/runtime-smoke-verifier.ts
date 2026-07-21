import { readFile } from "node:fs/promises";
import { dirname, normalize, relative, resolve } from "node:path";
import { defaultGitDiff, extractFileFromDiffLine, isProductionFile } from "./diff-scan.ts";
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
  args: readonly string[],
  timeoutMs: number,
) => Promise<{ success: boolean; output: string }>;

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
  { entrypoint: "v2/src/daemon-entrypoint.ts", args: ["--help"] },
  { entrypoint: "v2/src/cli.ts", args: ["help"] },
];

async function defaultExecuteEntrypoint(
  cwd: string,
  entrypoint: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<{ success: boolean; output: string }> {
  const { realAsyncSubprocessRunner } = await import("../../../shared/subprocess.ts");
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
      discoveryReason: "no production files changed in diff",
    };
  }

  const surface = await discoverChangedRunnableSurface(input.worktreePath, changedFiles, readSourceFile);

  if (!surface) {
    return {
      kind: "not-runnable",
      inspectedPaths: changedFiles,
      discoveryReason: "no changed runnable entrypoint found",
    };
  }

  const result = await executeEntrypoint(input.worktreePath, surface.entrypoint, surface.args, 5000);

  if (!result.success) {
    return {
      kind: "smoke-failure",
      command: `bun run ${surface.entrypoint} ${surface.args.join(" ")}`,
      observation: result.output,
    };
  }

  return {
    kind: "observed-clean",
  };
}
