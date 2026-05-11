import { spawn } from "node:child_process";

async function runGhCommand(args: string[]): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  return new Promise((resolve) => {
    const child = spawn("gh", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
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

    child.on("error", (err) => {
      resolve({
        stdout: "",
        stderr: String(err),
        exitCode: -1,
      });
    });
  });
}

export async function assertGhReady(): Promise<void> {
  const result = await runGhCommand(["auth", "status"]);
  if (result.exitCode !== 0) {
    let errorMessage =
      "gh: not authenticated or not installed. Run `gh auth login` to proceed.";
    if (result.stderr.length > 0) {
      errorMessage = result.stderr;
    }
    throw new Error(errorMessage);
  }
}

export async function getBaseBranch(): Promise<string> {
  const result = await runGhCommand([
    "repo",
    "view",
    "--json",
    "defaultBranchRef",
    "-q",
    ".defaultBranchRef.name",
  ]);
  if (result.exitCode !== 0) {
    const errorMessage = result.stderr || result.stdout;
    throw new Error(`failed to detect base branch: ${errorMessage.trim()}`);
  }
  return result.stdout.trim();
}
