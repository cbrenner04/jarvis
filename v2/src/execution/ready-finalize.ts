import { execFileSync } from "node:child_process";

export type ReadyFinalizeInput = {
  worktreePath: string;
  branch: string;
};

export type ReadyGate = (worktreePath: string) => void;
export type GhReadyFlip = (branch: string, worktreePath: string) => void;
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

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultRetryNotice(message: string): void {
  console.error(message);
}

function defaultRunReadyGate(worktreePath: string): void {
  try {
    execFileSync("bun", ["run", "ready"], { cwd: worktreePath, encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { status?: number; stderr?: Buffer };
    const detail = err.stderr?.toString("utf8") ?? (error instanceof Error ? error.message : String(error));
    throw new Error(`ready gate failed (exit ${err.status ?? "unknown"}): ${detail.trim()}`);
  }
}

function defaultGhReadyFlip(branch: string, worktreePath: string): void {
  try {
    execFileSync("gh", ["pr", "ready", branch], { cwd: worktreePath, encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { status?: number; stdout?: Buffer; stderr?: Buffer };
    const combined = [
      err.stdout?.toString("utf8"),
      err.stderr?.toString("utf8"),
      error instanceof Error ? error.message : String(error),
    ]
      .filter(Boolean)
      .join("\n");
    throw new Error(combined);
  }
}

function ghFlipCombinedOutput(error: unknown): string {
  if (error instanceof Error) {
    const withBuffers = error as Error & { stdout?: Buffer; stderr?: Buffer };
    return [withBuffers.stdout?.toString("utf8"), withBuffers.stderr?.toString("utf8"), error.message]
      .filter(Boolean)
      .join("\n");
  }
  return String(error);
}

function isPrReadySuccessGuard(message: string): boolean {
  return /\balready ready\b/i.test(message) || /\bnot a draft\b/i.test(message);
}

async function flipWithRetry(flip: () => void, delay: Delay, retryNotice: RetryNotice): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      flip();
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
    runReadyGate(input.worktreePath);
    await flipWithRetry(() => ghReadyFlip(input.branch, input.worktreePath), delay, retryNotice);
  };
}
