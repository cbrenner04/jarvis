import {
  AsyncSubprocessError,
  type AsyncSubprocessRunner,
  realAsyncSubprocessRunner,
} from "../../../shared/subprocess.ts";
import { runPublicationWithRetry } from "./publication-retry.ts";

export type ReadyFinalizeInput = {
  worktreePath: string;
  branch: string;
  requiredIntegrationScope?: string;
};

export type ReadyGate = (worktreePath: string) => Promise<void>;
export type GhReadyFlip = (branch: string, worktreePath: string) => Promise<void>;
type Delay = (ms: number) => Promise<void>;
type RetryNotice = (message: string) => void;

export type ReadyFinalizerSeams = {
  runReadyGate?: ReadyGate;
  ghReadyFlip?: GhReadyFlip;
  delay?: Delay;
  retryNotice?: RetryNotice;
  asyncSubprocessRunner?: AsyncSubprocessRunner;
  runRequiredIntegration?: RequiredIntegrationRunner;
};

export type ReadyFinalizer = (input: ReadyFinalizeInput) => Promise<void>;

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

const READY_GATE_MAX_BUFFER = 16 * 1024 * 1024;

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultRetryNotice(message: string): void {
  console.error(message);
}

function createDefaultRunReadyGate(runner: AsyncSubprocessRunner): ReadyGate {
  return async (worktreePath: string): Promise<void> => {
    try {
      await runner.runAsync("bun", ["run", "ready"], worktreePath, {
        maxBuffer: READY_GATE_MAX_BUFFER,
        env: { ...process.env, JARVIS_READY_TIER: "full" },
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
  const delay = seams?.delay ?? defaultDelay;
  const retryNotice = seams?.retryNotice ?? defaultRetryNotice;
  const runRequiredIntegration =
    seams?.runRequiredIntegration ?? createDefaultRunRequiredIntegration(asyncSubprocessRunner);

  return async (input) => {
    await runReadyGate(input.worktreePath);
    if (input.requiredIntegrationScope) {
      await runRequiredIntegration(input.worktreePath, input.requiredIntegrationScope);
    }
    await flipWithRetry(() => ghReadyFlip(input.branch, input.worktreePath), delay, retryNotice);
  };
}
