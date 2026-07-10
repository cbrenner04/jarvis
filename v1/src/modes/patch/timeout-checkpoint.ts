import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { GIT_SUBPROCESS_OPTS } from "./git-subprocess.ts";

export type TimeoutCheckpointReceipt = {
  version: 1;
  reason: "iteration-timeout";
  checkpointOid: string;
  activeSubspecPath: string;
};

const RECEIPT_RELATIVE_PATH = "jarvis/iteration-timeout-checkpoint.json";

function receiptPath(cwd: string): string {
  const path = execFileSync("git", ["rev-parse", "--git-path", RECEIPT_RELATIVE_PATH], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    ...GIT_SUBPROCESS_OPTS,
  }).trim();
  return resolve(cwd, path);
}

function gitOutput(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe", ...GIT_SUBPROCESS_OPTS }).trim();
}

export function writeTimeoutCheckpointReceipt(cwd: string, activeSubspecPath: string): void {
  const root = gitOutput(cwd, ["rev-parse", "--show-toplevel"]);
  const oid = gitOutput(cwd, ["rev-parse", "HEAD"]);
  const normalized = relative(realpathSync(root), realpathSync(activeSubspecPath));
  const path = receiptPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ version: 1, reason: "iteration-timeout", checkpointOid: oid, activeSubspecPath: normalized })}\n`);
  renameSync(temp, path);
}

function parseReceipt(raw: string): TimeoutCheckpointReceipt | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    if (
      record.version !== 1 ||
      record.reason !== "iteration-timeout" ||
      typeof record.checkpointOid !== "string" ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(record.checkpointOid) ||
      typeof record.activeSubspecPath !== "string" ||
      record.activeSubspecPath.length === 0 ||
      isAbsolute(record.activeSubspecPath) ||
      record.activeSubspecPath.split("/").includes("..") ||
      Object.keys(record).length !== 4
    ) return null;
    return record as TimeoutCheckpointReceipt;
  } catch {
    return null;
  }
}

/** Returns and consumes only an immediate, matching timeout checkpoint. */
export function consumeTimeoutCheckpointReceipt(
  cwd: string,
  activeSubspecPath: string,
  onWarning?: (message: string) => void,
): TimeoutCheckpointReceipt | null {
  const path = receiptPath(cwd);
  if (!existsSync(path)) return null;
  const receipt = parseReceipt(readFileSync(path, "utf8"));
  if (receipt === null) {
    onWarning?.("invalid timeout checkpoint receipt");
    return null;
  }
  const root = gitOutput(cwd, ["rev-parse", "--show-toplevel"]);
  const expected = relative(realpathSync(root), realpathSync(activeSubspecPath));
  const head = gitOutput(cwd, ["rev-parse", "HEAD"]);
  const subject = gitOutput(cwd, ["show", "-s", "--format=%s", receipt.checkpointOid]);
  const body = gitOutput(cwd, ["show", "-s", "--format=%b", receipt.checkpointOid]);
  if (
    receipt.activeSubspecPath !== expected ||
    head !== receipt.checkpointOid ||
    subject !== "WIP: checkpoint (iteration-timeout)" ||
    !body.split("\n").some((line) => line === `Spec: ${expected}`)
  ) {
    onWarning?.("stale or mismatched timeout checkpoint receipt");
    return null;
  }
  const consumed = `${path}.${process.pid}.consumed`;
  renameSync(path, consumed);
  rmSync(consumed, { force: true });
  return receipt;
}
