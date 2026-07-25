import { resolveCiTestScope } from "../../../scripts/ci-test-scope.ts";
import { DEADLINE_KILL_MARKER, TIMEOUT_EXIT_CODE } from "../../../scripts/ready.ts";
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

export class ReadyGateError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number | undefined,
    readonly output: string,
    readonly timedOut: boolean = false,
  ) {
    super(`ready gate failed (exit ${exitCode ?? "unknown"}): ${output.trim()}`);
    this.name = "ReadyGateError";
  }
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

export type SurvivingMutationLogFields = {
  survivingMutation?: string;
  survivingMutationSourceFile?: string;
  survivingMutationSourceLine?: number;
};

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
