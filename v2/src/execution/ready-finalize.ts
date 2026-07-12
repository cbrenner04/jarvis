import { AsyncSubprocessError, realAsyncSubprocessRunner } from "../../../shared/subprocess.ts";

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
};

export type ReadyFinalizer = (input: ReadyFinalizeInput) => Promise<void>;

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 1000;
const READY_GATE_MAX_BUFFER = 10 * 1024 * 1024;

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultRetryNotice(message: string): void {
  console.error(message);
}

async function defaultRunReadyGate(worktreePath: string): Promise<void> {
  try {
    await realAsyncSubprocessRunner.runAsync("bun", ["run", "ready"], worktreePath, {
      maxBuffer: READY_GATE_MAX_BUFFER,
    });
  } catch (error) {
    const detail = error instanceof AsyncSubprocessError ? error.stderr : error instanceof Error ? error.message : String(error);
    const status = error instanceof AsyncSubprocessError ? error.status : undefined;
    throw new Error(`ready gate failed (exit ${status ?? "unknown"}): ${detail.trim()}`);
  }
}

async function defaultGhReadyFlip(branch: string, worktreePath: string): Promise<void> {
  await realAsyncSubprocessRunner.runAsync("gh", ["pr", "ready", branch], worktreePath);
}

function ghFlipCombinedOutput(error: unknown): string {
  if (error instanceof Error) {
    const output = error as Error & { stdout?: string; stderr?: string };
    return [output.stdout, output.stderr, error.message]
      .filter(Boolean)
      .join("\n");
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
  const runReadyGate = seams?.runReadyGate ?? defaultRunReadyGate;
  const ghReadyFlip = seams?.ghReadyFlip ?? defaultGhReadyFlip;
  const delay = seams?.delay ?? defaultDelay;
  const retryNotice = seams?.retryNotice ?? defaultRetryNotice;

  return async (input) => {
    await runReadyGate(input.worktreePath);
    await flipWithRetry(() => ghReadyFlip(input.branch, input.worktreePath), delay, retryNotice);
  };
}
