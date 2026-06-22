import { type SpawnOptions, spawn } from "node:child_process";
import { isTransientNetworkError } from "./agents/quota.ts";
import { harnessGitGhTransientRetryLine } from "./quota-harness-messages.ts";

type SpawnFn = typeof spawn;

const GH_RETRY_CAP = 3; // 3 total invocations (2 re-attempts)
const GH_RETRY_BACKOFF_MS = 1000;

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

  const { spawnImpl = spawn, sleepMs = defaultSleep, onRetry, op } = opts;

  let lastResult = await runGhCommandOnce(args, cwd, spawnImpl);

  let attempt = 1;
  while (lastResult.exitCode !== 0 && isTransientNetworkError(lastResult.exitCode, lastResult.stderr)) {
    if (attempt >= GH_RETRY_CAP) {
      break;
    }

    attempt++;

    if (onRetry) {
      onRetry(harnessGitGhTransientRetryLine(op || "gh", attempt, GH_RETRY_CAP));
    }

    await sleepMs(GH_RETRY_BACKOFF_MS);
    lastResult = await runGhCommandOnce(args, cwd, spawnImpl);
  }

  return lastResult;
}

export async function assertGhReady(): Promise<void> {
  const result = await runGhCommand(["auth", "status"]);
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
  );
  if (result.exitCode !== 0) {
    const errorMessage = result.stderr || result.stdout;
    throw new Error(`failed to detect base branch: ${errorMessage.trim()}`);
  }
  return result.stdout.trim();
}

export async function postPrComment(prNumber: number, body: string, cwd?: string): Promise<void> {
  const result = await runGhCommand(["pr", "comment", String(prNumber), "--body", body], cwd);
  if (result.exitCode !== 0) {
    const errorMessage = result.stderr || result.stdout;
    throw new Error(`failed to post PR comment: ${errorMessage.trim()}`);
  }
}
