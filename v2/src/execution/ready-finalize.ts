import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { resolveCiTestScope } from "../../../scripts/ci-test-scope.ts";
import {
  DEADLINE_KILL_MARKER,
  READY_STEP_COMPLETION_MARKER,
  type ReadyStepCompletion,
  TIMEOUT_EXIT_CODE,
} from "../../../scripts/ready.ts";
import { FAILING_TEST_FILE_MARKER } from "../../../scripts/run-v2-tests.ts";
import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";
import {
  defaultPublicationDelay,
  defaultPublicationRetryNotice,
  runPublicationWithRetry,
} from "./publication-retry.ts";
import { normalizePublicationSpecPath } from "./publication-spec-path.ts";
import type { SmokePass, VerificationResult } from "./runtime-smoke-verifier.ts";

export type ReadyFinalizeInput = {
  worktreePath: string;
  branch: string;
  baseRef: string;
  requiredIntegrationScope?: string;
};

export type ReadyGate = (worktreePath: string, baseRef: string) => Promise<void>;
export type GhReadyFlip = (branch: string, worktreePath: string) => Promise<void>;
type Delay = (ms: number) => Promise<void>;
type RetryNotice = (message: string) => void;

type MutationVerificationRunner = (worktreePath: string, baseRef: string) => Promise<void>;
type RuntimeSmokeVerificationRunner = (worktreePath: string, baseRef: string) => Promise<VerificationResult>;

export type ReadyFinalizerSeams = {
  runReadyGate?: ReadyGate;
  ghReadyFlip?: GhReadyFlip;
  delay?: Delay;
  retryNotice?: RetryNotice;
  asyncSubprocessRunner?: AsyncSubprocessRunner;
  runRequiredIntegration?: RequiredIntegrationRunner;
  runMutationVerification?: MutationVerificationRunner;
  runRuntimeSmokeVerification?: RuntimeSmokeVerificationRunner;
};

export type ReadyFinalizationResult = {
  runtimeSmokeOutcome?: SmokePass;
};

export type ReadyFinalizer = (
  input: ReadyFinalizeInput,
) => Promise<ReadyFinalizationResult | undefined> | Promise<void>;

export class ReadyFlipError extends Error {
  constructor(
    readonly readyFlipError: Error,
    readonly runtimeSmokeOutcome: SmokePass,
  ) {
    super(readyFlipError.message, { cause: readyFlipError });
    this.name = "ReadyFlipError";
  }
}

export type ReadyGateFailureKind = "ready_gate_failed" | "ready_gate_out_of_scope";

export type ReadyGateClassification = {
  kind: ReadyGateFailureKind;
  outsidePaths?: readonly string[];
};

export type ReadyGateScopeInput = {
  worktreePath: string;
  baseRef: string;
  specPath: string;
};

export type ReadyGateScopeSeams = {
  gitDiffNameStatus?: (worktreePath: string, baseRef: string) => Promise<string | null>;
  gitUntracked?: (worktreePath: string) => Promise<string | null>;
  listSpecTreePaths?: (worktreePath: string, specPath: string) => Promise<string[] | null>;
};

export class ReadyGateError extends Error {
  readonly gateFailureKind: ReadyGateFailureKind;
  readonly outsidePaths?: readonly string[];

  constructor(
    readonly command: string,
    readonly exitCode: number | undefined,
    readonly output: string,
    readonly timedOut: boolean = false,
    classification?: ReadyGateClassification,
  ) {
    super(`ready gate failed (exit ${exitCode ?? "unknown"}): ${output.trim()}`);
    this.name = "ReadyGateError";
    this.gateFailureKind = classification?.kind ?? "ready_gate_failed";
    if (classification?.outsidePaths !== undefined) {
      this.outsidePaths = classification.outsidePaths;
    }
  }
}

/** Normalize and validate a repo-relative path; reject absolute, escaping, empty, or malformed values. */
export function validateRepoRelativePath(path: string): string | undefined {
  if (path.length === 0 || path.trim() !== path) {
    return undefined;
  }
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      return undefined;
    }
    parts.push(segment);
  }
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join("/");
}

function parseMarkerRecords<T>(output: string, marker: string, validate: (value: unknown) => value is T): T[] {
  const records: T[] = [];
  for (const line of output.split("\n")) {
    if (!line.startsWith(marker)) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(line.slice(marker.length));
      if (validate(parsed)) {
        records.push(parsed);
      }
    } catch {
      // malformed records are ignored at parse time
    }
  }
  return records;
}

function isReadyStepCompletion(value: unknown): value is ReadyStepCompletion {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as ReadyStepCompletion;
  return (
    typeof record.stepId === "string" &&
    typeof record.attemptId === "string" &&
    typeof record.command === "string" &&
    typeof record.status === "number"
  );
}

function isFailingTestFileRecord(value: unknown): value is { attemptId: string; path: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as { attemptId: string; path: string };
  return typeof record.attemptId === "string" && typeof record.path === "string";
}

function isReadyTestCommand(command: string): boolean {
  return /^bun run test(?::|$)/.test(command);
}

function validateAndDeduplicatePaths(rawPaths: readonly string[]): string[] | undefined {
  const seen = new Map<string, string>();
  const result: string[] = [];
  for (const raw of rawPaths) {
    const normalized = validateRepoRelativePath(raw);
    if (normalized === undefined) {
      return undefined;
    }
    const prior = seen.get(normalized);
    if (prior !== undefined && prior !== raw) {
      return undefined;
    }
    if (prior === undefined) {
      seen.set(normalized, raw);
      result.push(normalized);
    }
  }
  return result;
}

/** Select validated failing paths from the terminal failed ready test step's final attempt. */
export function selectTerminalFailingPaths(output: string): string[] | undefined {
  const completions = parseMarkerRecords(output, READY_STEP_COMPLETION_MARKER, isReadyStepCompletion);
  const terminalFailed = [...completions].reverse().find((record) => record.status !== 0);
  if (terminalFailed === undefined || !isReadyTestCommand(terminalFailed.command)) {
    return undefined;
  }
  const fileRecords = parseMarkerRecords(output, FAILING_TEST_FILE_MARKER, isFailingTestFileRecord);
  const matching = fileRecords.filter((record) => record.attemptId === terminalFailed.attemptId);
  if (matching.length === 0) {
    return undefined;
  }
  return validateAndDeduplicatePaths(matching.map((record) => record.path));
}

function parseNulDelimitedPaths(output: string): string[] | undefined {
  if (output.length === 0) {
    return [];
  }
  if (!output.endsWith("\0")) {
    return undefined;
  }
  return output.slice(0, -1).split("\0").filter(Boolean);
}

/** Parse NUL-delimited `git diff --name-status -z` output into changed paths. */
export function parseGitNameStatusZ(output: string): string[] | undefined {
  if (output.length === 0) {
    return [];
  }
  if (!output.endsWith("\0")) {
    return undefined;
  }
  const parts = output.slice(0, -1).split("\0");
  const paths: string[] = [];
  let index = 0;
  while (index < parts.length) {
    const status = parts[index];
    if (status === undefined || status.length === 0) {
      index += 1;
      continue;
    }
    const kind = status[0];
    if (kind === "R" || kind === "C") {
      const oldPath = parts[index + 1];
      const newPath = parts[index + 2];
      if (oldPath === undefined || newPath === undefined) {
        return undefined;
      }
      paths.push(oldPath, newPath);
      index += 3;
      continue;
    }
    const path = parts[index + 1];
    if (path === undefined) {
      return undefined;
    }
    paths.push(path);
    index += 2;
  }
  return paths;
}

function listMarkdownFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path);
    }
  }
  return files;
}

function resolveSpecScopeRoot(worktreePath: string, specPath: string): string | null {
  const resolvedSpecPath = isAbsolute(specPath) ? specPath : join(worktreePath, specPath);
  try {
    if (statSync(resolvedSpecPath).isDirectory()) {
      return resolvedSpecPath;
    }
  } catch {
    // fall through to file-based resolution
  }
  if (basename(resolvedSpecPath).endsWith(".md")) {
    return dirname(resolvedSpecPath);
  }
  return null;
}

function enumerateSpecTreePaths(worktreePath: string, specPath: string): string[] | null {
  const scopeRoot = resolveSpecScopeRoot(worktreePath, specPath);
  if (scopeRoot === null) {
    const normalized = normalizePublicationSpecPath(worktreePath, specPath);
    const validated = validateRepoRelativePath(normalized);
    return validated === undefined ? null : [validated];
  }
  if (!existsSync(scopeRoot)) {
    return null;
  }
  const files = listMarkdownFiles(scopeRoot);
  if (files.length === 0) {
    return null;
  }
  const paths: string[] = [];
  for (const file of files) {
    const rel = relative(worktreePath, file).replace(/\\/g, "/");
    const validated = validateRepoRelativePath(rel);
    if (validated === undefined) {
      return null;
    }
    paths.push(validated);
  }
  return paths;
}

/** Derive the fail-closed allowed path set from base diff, untracked inventory, and spec tree. */
export async function deriveGateAllowedPaths(
  scope: ReadyGateScopeInput,
  seams?: ReadyGateScopeSeams,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<Set<string> | undefined> {
  let diffOutput: string | null;
  try {
    diffOutput =
      seams?.gitDiffNameStatus !== undefined
        ? await seams.gitDiffNameStatus(scope.worktreePath, scope.baseRef)
        : await runner.runAsync(
            "git",
            ["diff", "--name-status", "-z", "--diff-filter=ACDMRTUXB", `${scope.baseRef}...HEAD`],
            scope.worktreePath,
            { maxBuffer: READY_GATE_MAX_BUFFER },
          );
  } catch {
    return undefined;
  }
  if (diffOutput === null) {
    return undefined;
  }

  let untrackedOutput: string | null;
  try {
    untrackedOutput =
      seams?.gitUntracked !== undefined
        ? await seams.gitUntracked(scope.worktreePath)
        : await runner.runAsync("git", ["ls-files", "--others", "--exclude-standard", "-z"], scope.worktreePath);
  } catch {
    return undefined;
  }
  if (untrackedOutput === null) {
    return undefined;
  }

  const specPaths =
    seams?.listSpecTreePaths !== undefined
      ? await seams.listSpecTreePaths(scope.worktreePath, scope.specPath)
      : enumerateSpecTreePaths(scope.worktreePath, scope.specPath);
  if (specPaths === null) {
    return undefined;
  }

  const diffPaths = parseGitNameStatusZ(diffOutput);
  if (diffPaths === undefined) {
    return undefined;
  }
  const untrackedPaths = parseNulDelimitedPaths(untrackedOutput);
  if (untrackedPaths === undefined) {
    return undefined;
  }

  const allowed = new Set<string>();
  for (const rawPath of [...diffPaths, ...untrackedPaths, ...specPaths]) {
    const normalized = validateRepoRelativePath(rawPath);
    if (normalized === undefined) {
      return undefined;
    }
    allowed.add(normalized);
  }
  return allowed;
}

/** Classify a ready gate failure from terminal test evidence and the run's allowed path set. */
export function classifyReadyGateFailure(
  error: Pick<ReadyGateError, "command" | "output" | "timedOut">,
  failingPaths: string[] | undefined,
  allowedPaths: Set<string> | undefined,
): ReadyGateClassification {
  if (error.timedOut || error.command !== "bun run ready") {
    return { kind: "ready_gate_failed" };
  }
  if (failingPaths === undefined || allowedPaths === undefined || failingPaths.length === 0) {
    return { kind: "ready_gate_failed" };
  }
  const outsidePaths = failingPaths.filter((path) => !allowedPaths.has(path));
  if (outsidePaths.length === 0 || outsidePaths.length < failingPaths.length) {
    return { kind: "ready_gate_failed" };
  }
  return { kind: "ready_gate_out_of_scope", outsidePaths };
}

export async function classifyReadyGateError(
  error: ReadyGateError,
  scope: ReadyGateScopeInput,
  seams?: ReadyGateScopeSeams,
  runner?: AsyncSubprocessRunner,
): Promise<ReadyGateError> {
  const failingPaths = selectTerminalFailingPaths(error.output);
  const allowedPaths = await deriveGateAllowedPaths(scope, seams, runner);
  const classification = classifyReadyGateFailure(error, failingPaths, allowedPaths);
  if (classification.kind === error.gateFailureKind && classification.outsidePaths === error.outsidePaths) {
    return error;
  }
  return new ReadyGateError(error.command, error.exitCode, error.output, error.timedOut, classification);
}

export class SurvivingMutationError extends Error {
  constructor(
    readonly mutation: string,
    readonly sourceSiteFile: string,
    readonly sourceSiteLine: number,
    readonly dualConstraint?: true,
  ) {
    let message = `Surviving mutation in ${sourceSiteFile}:${sourceSiteLine}: ${mutation}`;
    if (dualConstraint) {
      message +=
        "; the changed line sits inside a setTimeout/setInterval callback in a determinism-guarded suite (v2/src/daemon or v2/src/execution .test.ts), which forbids real-timer waits. Both constraints block the natural kill test: test the determinism guard's own condition as a pure exported predicate, then verify both truth directions directly without a real-timer wait.";
    }
    super(message);
    this.name = "SurvivingMutationError";
  }
}

export type ReadyGateOutOfScopeLogFields = {
  readyGateOutsidePaths?: string[];
  readyGateOutOfScopeDetail?: string;
};

export function formatReadyGateOutOfScopeDetail(paths: readonly string[]): string {
  return `ready gate failing paths lie outside the run's touched set: ${paths.join(", ")}`;
}

export function readyGateOutOfScopeLogFields(
  source: Error | ReadyGateOutOfScopeLogFields | undefined,
): ReadyGateOutOfScopeLogFields {
  if (source === undefined) return {};
  if (
    source instanceof ReadyGateError &&
    source.gateFailureKind === "ready_gate_out_of_scope" &&
    source.outsidePaths !== undefined
  ) {
    return {
      readyGateOutsidePaths: [...source.outsidePaths],
      readyGateOutOfScopeDetail: formatReadyGateOutOfScopeDetail(source.outsidePaths),
    };
  }
  if (source instanceof Error) return {};
  const fields: ReadyGateOutOfScopeLogFields = {};
  if (source.readyGateOutsidePaths !== undefined) {
    fields.readyGateOutsidePaths = [...source.readyGateOutsidePaths];
  }
  if (source.readyGateOutOfScopeDetail !== undefined) {
    fields.readyGateOutOfScopeDetail = source.readyGateOutOfScopeDetail;
  }
  return fields;
}

export type SurvivingMutationLogFields = {
  survivingMutation?: string;
  survivingMutationSourceFile?: string;
  survivingMutationSourceLine?: number;
};

export type ReadyGateFailureOrigin =
  | "repair_budget_exhausted"
  | "repair_blocked"
  | "repair_unsettled"
  | "iteration_limit"
  | "timeout";

export type ReadyGateFailureLogFields = {
  readyGateFailureOrigin?: ReadyGateFailureOrigin;
  readyGateRepairCount?: number;
  finalizationLineageRunId?: string;
  retainedFinalizationCheckpoint?: boolean;
};

export function exhaustedRedGateFailureMeta(
  runId: string,
  repairBudgetCap: number,
  retainedCheckpoint = true,
): ReadyGateFailureLogFields {
  return {
    readyGateFailureOrigin: "repair_budget_exhausted",
    readyGateRepairCount: repairBudgetCap,
    finalizationLineageRunId: runId,
    ...(retainedCheckpoint ? { retainedFinalizationCheckpoint: true } : {}),
  };
}

export type ExhaustedRedAdmissionInvert = {
  origin?: boolean;
  repairCount?: boolean;
  lineage?: boolean;
  checkpoint?: boolean;
};

/** Admission predicate for gate-only resume after repair-budget exhaustion (not composed operator error). */
export function isExhaustedRedReadyGateAdmission(
  event: {
    loopOutcomeKind: string;
    resumable: boolean;
    readyGateFailureOrigin?: ReadyGateFailureOrigin;
    readyGateRepairCount?: number;
    finalizationLineageRunId?: string;
    retainedFinalizationCheckpoint?: boolean;
  },
  runId: string,
  repairBudgetCap: number,
  invert?: ExhaustedRedAdmissionInvert,
): boolean {
  if (event.loopOutcomeKind !== "ready_gate_failed" || !event.resumable) return false;
  const inv = invert ?? {};
  const originOk = inv.origin
    ? event.readyGateFailureOrigin !== "repair_budget_exhausted"
    : event.readyGateFailureOrigin === "repair_budget_exhausted";
  const repairCountOk = inv.repairCount
    ? event.readyGateRepairCount !== repairBudgetCap
    : event.readyGateRepairCount === repairBudgetCap;
  const lineageOk = inv.lineage
    ? event.finalizationLineageRunId !== runId
    : event.finalizationLineageRunId === runId;
  const checkpointOk = inv.checkpoint
    ? event.retainedFinalizationCheckpoint !== true
    : event.retainedFinalizationCheckpoint === true;
  return originOk && repairCountOk && lineageOk && checkpointOk;
}

export function survivingMutationLogFields(
  source: Error | SurvivingMutationLogFields | undefined,
): SurvivingMutationLogFields {
  if (source === undefined) return {};
  if (source instanceof SurvivingMutationError) {
    return {
      survivingMutation: source.mutation,
      survivingMutationSourceFile: source.sourceSiteFile,
      survivingMutationSourceLine: source.sourceSiteLine,
    };
  }
  if (source instanceof Error) return {};
  const fields: SurvivingMutationLogFields = {};
  if (source.survivingMutation !== undefined) fields.survivingMutation = source.survivingMutation;
  if (source.survivingMutationSourceFile !== undefined) {
    fields.survivingMutationSourceFile = source.survivingMutationSourceFile;
  }
  if (source.survivingMutationSourceLine !== undefined) {
    fields.survivingMutationSourceLine = source.survivingMutationSourceLine;
  }
  return fields;
}

export class RuntimeSmokeFailedError extends Error {
  constructor(
    readonly command: string,
    readonly observation: string,
  ) {
    super(`Runtime smoke failed: ${command} — ${observation}`);
    this.name = "RuntimeSmokeFailedError";
  }
}

const READY_GATE_MAX_BUFFER = 16 * 1024 * 1024;

function isDeadlineKilledGate(exitCode: number | undefined, output: string): boolean {
  return exitCode === TIMEOUT_EXIT_CODE || output.includes(DEADLINE_KILL_MARKER);
}

async function getChangedPathsWithResolvability(
  runner: AsyncSubprocessRunner,
  worktreePath: string,
  baseRef: string,
): Promise<{ paths: string[]; baseResolvable: boolean }> {
  try {
    const result = await runner.runAsync(
      "git",
      ["diff", "--name-only", "--diff-filter=ACM", `${baseRef}...HEAD`],
      worktreePath,
      { maxBuffer: 10 * 1024 * 1024 },
    );
    const paths = result
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    try {
      const untrackedResult = await runner.runAsync(
        "git",
        ["ls-files", "--others", "--exclude-standard"],
        worktreePath,
      );
      const untrackedPaths = untrackedResult
        .split("\n")
        .map((p) => p.trim())
        .filter(Boolean);
      return { paths: [...paths, ...untrackedPaths], baseResolvable: true };
    } catch {
      return { paths, baseResolvable: true };
    }
  } catch {
    return { paths: [], baseResolvable: false };
  }
}

function createDefaultRunReadyGate(runner: AsyncSubprocessRunner): ReadyGate {
  return async (worktreePath: string, baseRef: string): Promise<void> => {
    const { paths: changedPaths, baseResolvable } = await getChangedPathsWithResolvability(
      runner,
      worktreePath,
      baseRef,
    );
    const scope = resolveCiTestScope(changedPaths, baseResolvable);
    const testScope = scope === "full" ? "full" : scope.join(" ");
    const env = { ...process.env, JARVIS_READY_TIER: "full", JARVIS_READY_TEST_SCOPE: testScope };
    try {
      await runner.runAsync("bun", ["run", "ready"], worktreePath, {
        maxBuffer: READY_GATE_MAX_BUFFER,
        env,
      });
    } catch (error) {
      if (error instanceof AsyncSubprocessError) {
        const output = `${error.stdout}${error.stderr}`;
        const timedOut = isDeadlineKilledGate(error.status, output);
        throw new ReadyGateError("bun run ready", error.status, output, timedOut);
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new ReadyGateError("bun run ready", undefined, detail);
    }
  };
}

type RequiredIntegrationRunner = (worktreePath: string, scope: string) => Promise<void>;

function createDefaultRunRequiredIntegration(runner: AsyncSubprocessRunner): RequiredIntegrationRunner {
  return async (worktreePath: string, scope: string): Promise<void> => {
    try {
      await runner.runAsync("bun", ["run", scope], worktreePath, {
        maxBuffer: READY_GATE_MAX_BUFFER,
      });
    } catch (error) {
      if (error instanceof AsyncSubprocessError) {
        const output = `${error.stdout}${error.stderr}`;
        const timedOut = isDeadlineKilledGate(error.status, output);
        throw new ReadyGateError(scope, error.status, output, timedOut);
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new ReadyGateError(scope, undefined, detail);
    }
  };
}

async function defaultGhReadyFlip(branch: string, worktreePath: string): Promise<void> {
  await realAsyncSubprocessRunner.runAsync("gh", ["pr", "ready", branch], worktreePath);
}

function ghFlipCombinedOutput(error: unknown): string {
  if (error instanceof Error) {
    const withOutput = error as Error & { stdout?: string | Buffer; stderr?: string | Buffer };
    return [withOutput.stdout?.toString(), withOutput.stderr?.toString(), error.message].filter(Boolean).join("\n");
  }
  return String(error);
}

function isPrReadySuccessGuard(message: string): boolean {
  return /\balready ready\b/i.test(message) || /\bnot a draft\b/i.test(message);
}

async function flipWithRetry(flip: () => Promise<void>, delay: Delay, retryNotice: RetryNotice): Promise<void> {
  await runPublicationWithRetry("gh pr ready", flip, {
    delay,
    retryNotice,
    isSuccess: (error) => isPrReadySuccessGuard(ghFlipCombinedOutput(error)),
  });
}

/** Runs the ready gate in the worktree, then flips the draft PR to ready on green. */
export function createReadyFinalizer(seams?: ReadyFinalizerSeams): ReadyFinalizer {
  const asyncSubprocessRunner = seams?.asyncSubprocessRunner ?? realAsyncSubprocessRunner;
  const runReadyGate = seams?.runReadyGate ?? createDefaultRunReadyGate(asyncSubprocessRunner);
  const ghReadyFlip = seams?.ghReadyFlip ?? defaultGhReadyFlip;
  const delay = seams?.delay ?? defaultPublicationDelay;
  const retryNotice = seams?.retryNotice ?? defaultPublicationRetryNotice;
  const runRequiredIntegration =
    seams?.runRequiredIntegration ?? createDefaultRunRequiredIntegration(asyncSubprocessRunner);
  const runMutationVerification = seams?.runMutationVerification;
  const runRuntimeSmokeVerification = seams?.runRuntimeSmokeVerification;

  return async (input) => {
    await runReadyGate(input.worktreePath, input.baseRef);
    if (input.requiredIntegrationScope) {
      await runRequiredIntegration(input.worktreePath, input.requiredIntegrationScope);
    }
    if (runMutationVerification) {
      await runMutationVerification(input.worktreePath, input.baseRef);
    }
    const runtimeSmokeOutcome = runRuntimeSmokeVerification
      ? await runRuntimeSmokeVerification(input.worktreePath, input.baseRef)
      : undefined;
    if (runtimeSmokeOutcome?.kind === "smoke-failure") {
      throw new RuntimeSmokeFailedError(runtimeSmokeOutcome.command, runtimeSmokeOutcome.observation);
    }
    try {
      await flipWithRetry(() => ghReadyFlip(input.branch, input.worktreePath), delay, retryNotice);
    } catch (error) {
      if (runtimeSmokeOutcome !== undefined) {
        throw new ReadyFlipError(error instanceof Error ? error : new Error(String(error)), runtimeSmokeOutcome);
      }
      throw error;
    }
    return runtimeSmokeOutcome !== undefined ? { runtimeSmokeOutcome } : {};
  };
}
