import { resolveCiTestScope } from "../../../scripts/ci-test-scope.ts";
import type { SmokePass } from "./runtime-smoke-verifier.ts";
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

export type ReadyFinalizeInput = {
  worktreePath: string;
  branch: string;
  baseRef: string;
  requiredIntegrationScope?: string;
  onRuntimeSmokeOutcome?: (outcome: SmokePass) => void;
};

export type ReadyGate = (worktreePath: string, baseRef: string) => Promise<void>;
export type GhReadyFlip = (branch: string, worktreePath: string) => Promise<void>;
type Delay = (ms: number) => Promise<void>;
type RetryNotice = (message: string) => void;

type MutationVerificationRunner = (worktreePath: string, baseRef: string) => Promise<void>;
type RuntimeSmokeVerificationRunner = (worktreePath: string, baseRef: string) => Promise<SmokePass>;

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

export type ReadyFinalizer = (input: ReadyFinalizeInput) => Promise<SmokePass | void>;

export class ReadyGateError extends Error {
  constructor(
    readonly command: string,
    readonly exitCode: number | undefined,
    readonly output: string,
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
  ) {
    super(`Surviving mutation in ${sourceSiteFile}:${sourceSiteLine}: ${mutation}`);
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
        throw new ReadyGateError("bun run ready", error.status, `${error.stdout}${error.stderr}`);
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
        throw new ReadyGateError(scope, error.status, `${error.stdout}${error.stderr}`);
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
    if (runtimeSmokeOutcome !== undefined) input.onRuntimeSmokeOutcome?.(runtimeSmokeOutcome);
    await flipWithRetry(() => ghReadyFlip(input.branch, input.worktreePath), delay, retryNotice);
    return runtimeSmokeOutcome;
  };
}
