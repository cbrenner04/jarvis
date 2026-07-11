import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { parseSpec } from "../../../../shared/spec-parser.ts";

type TimeoutRecord = {
  record_role?: unknown;
  mode?: unknown;
  exit_reason?: unknown;
  active_subspec_path?: unknown;
};

export type RecoveryTarget = {
  indexPath: string;
  subspecPath: string;
  indexLine: number;
};

/** Locate one unchecked, local index target without guessing through malformed links. */
export function findRecoveryTarget(indexPath: string, selectedPath: string): RecoveryTarget {
  const treeRoot = dirname(resolve(indexPath));
  if (!existsSync(indexPath)) throw new Error(`recovery: index not found: ${indexPath}`);
  if (isAbsolute(selectedPath)) throw new Error("recovery: selected subspec must be a relative index target");

  const wanted = resolve(treeRoot, selectedPath);
  if (relative(treeRoot, wanted).startsWith(".."))
    throw new Error("recovery: selected subspec is outside the spec tree");
  const lines = readFileSync(indexPath, "utf8").replace(/\r\n/g, "\n").split("\n");
  const matches: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^\s*-\s+\[([ xX])\]\s+\[[^\]]+\]\(([^)]+)\)\s*$/.exec(lines[i] ?? "");
    if (match?.[2] !== undefined && resolve(treeRoot, match[2]) === wanted) {
      if (match[1] !== " ") throw new Error("recovery: selected subspec is already complete");
      matches.push(i);
    }
  }
  if (matches.length !== 1)
    throw new Error(`recovery: selected subspec must have one unchecked index link (found ${matches.length})`);
  if (!existsSync(wanted)) throw new Error(`recovery: selected subspec not found: ${selectedPath}`);
  return { indexPath: resolve(indexPath), subspecPath: wanted, indexLine: matches[0] as number };
}

/** A recovery requires a patch terminal timeout explicitly tied to this subspec. */
export function hasQualifyingTimeout(telemetryPath: string, projectRoot: string, subspecPath: string): boolean {
  if (!existsSync(telemetryPath)) return false;
  const expected = relative(resolve(projectRoot), resolve(subspecPath));
  for (const line of readFileSync(telemetryPath, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let record: TimeoutRecord;
    try {
      record = JSON.parse(line) as TimeoutRecord;
    } catch {
      continue;
    }
    if (
      record.record_role === "run_terminal" &&
      record.mode === "patch" &&
      (record.exit_reason === "iteration-timeout" || record.exit_reason === "watchdog-iteration-timeout") &&
      record.active_subspec_path === expected
    ) {
      return true;
    }
  }
  return false;
}

/** Reject a replacement before staging unless it remains a normal runnable subspec. */
export function validateRecoveryReplacement(path: string, content: string): void {
  if (!/^\d\d-[a-z0-9][a-z0-9-]*\.md$/.test(basename(path))) {
    throw new Error(`recovery: invalid replacement filename: ${basename(path)}`);
  }
  const parsed = parseSpec(content);
  if (parsed.h1 === undefined || parsed.acceptanceCriteria.length === 0 || parsed.blocker !== undefined) {
    throw new Error(`recovery: invalid replacement subspec: ${basename(path)}`);
  }
}

/** Recovery never steals a patch worktree or its one-shot checkpoint receipt. */
export function assertRecoveryCheckpointSafe(projectRoot: string, specDirBasename: string): void {
  const patchWorktree = join(projectRoot, ".worktree", specDirBasename);
  if (existsSync(patchWorktree)) {
    throw new Error("recovery: patch worktree exists; resume or abandon it first");
  }
  const receipt = join(projectRoot, ".git", "jarvis", "iteration-timeout-checkpoint.json");
  if (existsSync(receipt)) {
    throw new Error("recovery: timeout checkpoint receipt exists; resume or abandon patch work first");
  }
}

/** Ensure the draft replaced, rather than merely supplemented, the selected task. */
export function validateRecoveryReconciliation(args: {
  specDir: string;
  oldSubspecBasename: string;
  indexPath: string;
}): number {
  if (existsSync(join(args.specDir, args.oldSubspecBasename))) {
    throw new Error("recovery: selected subspec was not removed");
  }
  const index = readFileSync(args.indexPath, "utf8");
  const oldLink = `](${`./${args.oldSubspecBasename}`})`;
  if (index.includes(oldLink)) throw new Error("recovery: index retains selected subspec link");
  const replacements = readdirSync(args.specDir)
    .filter((name) => /^\d\d-[a-z0-9][a-z0-9-]*\.md$/.test(name))
    .filter((name) => name !== args.oldSubspecBasename);
  if (replacements.length < 2) throw new Error("recovery: recovery must create at least two replacement subspecs");
  for (const name of readdirSync(args.specDir).filter((entry) => entry.endsWith(".md"))) {
    const content = readFileSync(join(args.specDir, name), "utf8");
    if (content.includes(oldLink)) throw new Error(`recovery: stale structured link in ${name}`);
  }
  return replacements.length;
}
