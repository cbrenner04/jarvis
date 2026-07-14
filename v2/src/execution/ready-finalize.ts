import { AsyncSubprocessError, type AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";

export type ReadyFinalizeInput = {
  worktreePath: string;
  branch: string;
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

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 1000;
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
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await flip();
      return;
    } catch (error) {
      const combined = ghFlipCombinedOutput(error);
      if (isPrReadySuccessGuard(combined)) {
        return;
      }
      if (attempt === MAX_ATTEMPTS) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      retryNotice(`gh pr ready: transient network error; retrying (attempt ${attempt + 1}/3)`);
      await delay(BACKOFF_MS);
    }
  }
}

/** Runs the ready gate in the worktree, then flips the draft PR to ready on green. */
export function createReadyFinalizer(seams?: ReadyFinalizerSeams): ReadyFinalizer {
  const asyncSubprocessRunner = seams?.asyncSubprocessRunner ?? realAsyncSubprocessRunner;
  const runReadyGate = seams?.runReadyGate ?? createDefaultRunReadyGate(asyncSubprocessRunner);
  const ghReadyFlip = seams?.ghReadyFlip ?? defaultGhReadyFlip;
  const delay = seams?.delay ?? defaultDelay;
  const retryNotice = seams?.retryNotice ?? defaultRetryNotice;

  return async (input) => {
    await runReadyGate(input.worktreePath);
    await flipWithRetry(() => ghReadyFlip(input.branch, input.worktreePath), delay, retryNotice);
  };
}
