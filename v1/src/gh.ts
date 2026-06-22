import { type SpawnOptions, spawn } from "node:child_process";
import { isTransientNetworkError } from "./agents/quota.ts";
import { harnessGitGhTransientRetryLine } from "./quota-harness-messages.ts";

type SpawnFn = typeof spawn;

export const GH_RETRY_CAP = 3; // 3 total invocations (2 re-attempts)
export const GH_RETRY_BACKOFF_MS = 1000;

export type GhCommandOptions = {
  spawnImpl?: SpawnFn;
  sleepMs?: (ms: number) => Promise<void>;
  onRetry?: (line: string) => void;
  op?: string; // operation label for messages, e.g. "gh auth status"
};

async function runGhCommandOnce(
  args: string[],
  cwd?: string,
  spawnImpl: SpawnFn = spawn,
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  return new Promise((resolve) => {
    const options: SpawnOptions = {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    };
    if (cwd !== undefined) {
      options.cwd = cwd;
    }
    const child = spawnImpl("gh", args, options);
    const stdout = child.stdout;
    const stderr = child.stderr;

    if (stdout === null || stderr === null) {
      resolve({
        stdout: "",
        stderr: "failed to open gh process streams",
        exitCode: -1,
      });
      return;
    }

    let outBuf = "";
    let errBuf = "";

    stdout.on("data", (chunk: Buffer) => {
      outBuf += chunk.toString("utf8");
    });
    stderr.on("data", (chunk: Buffer) => {
      errBuf += chunk.toString("utf8");
    });

    child.on("close", (code) => {
      resolve({
        stdout: outBuf,
        stderr: errBuf,
        exitCode: code ?? -1,
      });
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      const stderrMessage =
        err.code === "ENOENT"
          ? "gh: binary not found on PATH. Install with 'brew install gh' or ensure its directory is on PATH for this shell."
          : String(err);
      resolve({
        stdout: "",
        stderr: stderrMessage,
        exitCode: -1,
      });
    });
  });
}

async function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultOnRetry(line: string): void {
  process.stderr.write(line + "\n");
}

export async function runGhCommand(
  args: string[],
  cwd?: string,
  optsOrSpawn?: GhCommandOptions | SpawnFn,
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  let opts: GhCommandOptions;

  // Support both old API (third param is SpawnFn) and new API (third param is GhCommandOptions)
  if (typeof optsOrSpawn === "function") {
    opts = { spawnImpl: optsOrSpawn };
  } else {
    opts = optsOrSpawn ?? {};
  }

  const { spawnImpl = spawn, sleepMs = defaultSleep, onRetry = defaultOnRetry, op } = opts;

  let lastResult = await runGhCommandOnce(args, cwd, spawnImpl);

  let attempt = 1;
  while (lastResult.exitCode !== 0 && isTransientNetworkError(lastResult.exitCode, lastResult.stderr)) {
    if (attempt >= GH_RETRY_CAP) {
      break;
    }

    attempt++;

    onRetry(harnessGitGhTransientRetryLine(op || "gh", attempt, GH_RETRY_CAP));

    await sleepMs(GH_RETRY_BACKOFF_MS);
    lastResult = await runGhCommandOnce(args, cwd, spawnImpl);
  }

  return lastResult;
}

export async function assertGhReady(): Promise<void> {
  const result = await runGhCommand(["auth", "status"], undefined, { op: "gh auth status" });
  if (result.exitCode !== 0) {
    let errorMessage = "gh: not authenticated or not installed. Run `gh auth login` to proceed.";
    if (result.stderr.length > 0) {
      errorMessage = result.stderr;
    }
    throw new Error(errorMessage);
  }
}

export async function getBaseBranch(cwd?: string): Promise<string> {
  const result = await runGhCommand(
    ["repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"],
    cwd,
    { op: "gh repo view" },
  );
  if (result.exitCode !== 0) {
    const errorMessage = result.stderr || result.stdout;
    throw new Error(`failed to detect base branch: ${errorMessage.trim()}`);
  }
  return result.stdout.trim();
}

export async function postPrComment(prNumber: number, body: string, cwd?: string): Promise<void> {
  // Note: `gh pr comment` retries on transient failures but has no guard against
  // duplicate-on-retry (lost-ack case). Unlike `gh pr ready` which signals "already ready",
  // a re-posted comment is cosmetic and does not kill the run, so this is accepted.
  const result = await runGhCommand(
    ["pr", "comment", String(prNumber), "--body", body],
    cwd,
    { op: "gh pr comment" },
  );
  if (result.exitCode !== 0) {
    const errorMessage = result.stderr || result.stdout;
    throw new Error(`failed to post PR comment: ${errorMessage.trim()}`);
  }
}

function defaultSleepSync(ms: number): void {
  // Bun is injected by the Bun runtime; unavailable in non-Bun environments
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bunGlobal = (globalThis as any).Bun;
  if (bunGlobal?.sleepSync) {
    bunGlobal.sleepSync(ms);
  }
}

function defaultOnRetrySync(line: string): void {
  process.stderr.write(line + "\n");
}

export type SyncTransientRetryOptions = {
  op: string; // operation label for messages, e.g. "git push" or "gh pr ready"
  sleepSync?: (ms: number) => void;
  onRetry?: (line: string) => void;
  isPrReady?: boolean; // when true, "already ready" stderr resolves as success
};

export function withSyncTransientRetry(thunk: () => void, opts: SyncTransientRetryOptions): void {
  const { op, sleepSync = defaultSleepSync, onRetry = defaultOnRetrySync, isPrReady = false } = opts;

  let lastError: Error | null = null;
  let attempt = 1;

  while (attempt <= GH_RETRY_CAP) {
    try {
      thunk();
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Extract stderr: check if error has .stderr Buffer property, otherwise use message
      let stderr = "";
      if (
        typeof lastError === "object" &&
        "stderr" in lastError &&
        Buffer.isBuffer((lastError as { stderr: unknown }).stderr)
      ) {
        stderr = (lastError as { stderr: Buffer }).stderr.toString("utf8");
      } else {
        stderr = lastError.message;
      }
      const exitCode = (lastError as any).status ?? -1;

      // For gh pr ready, treat "already ready" as success (lost-ack case)
      if (isPrReady && (/\balready ready\b/i.test(stderr) || /\bnot a draft\b/i.test(stderr))) {
        return;
      }

      // Check if transient; if not, re-throw immediately
      if (!isTransientNetworkError(exitCode, stderr)) {
        throw lastError;
      }

      // Transient error: retry if we haven't hit the cap yet
      if (attempt >= GH_RETRY_CAP) {
        throw lastError;
      }

      attempt++;

      onRetry(harnessGitGhTransientRetryLine(op, attempt, GH_RETRY_CAP));

      sleepSync(GH_RETRY_BACKOFF_MS);
    }
  }
}
