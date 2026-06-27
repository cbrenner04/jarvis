import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { findMatchingOpenPrs, type MatchingOpenPr } from "../pr.ts";
import type { TriageIo } from "./triage.ts";

const LABEL = "triage --merge";

export type PrHeadLookupResult =
  | { ok: true; headRef: string }
  | { ok: false; message: string };

export type MergeTargetResolutionSeams = {
  listWorktreeNames?: (worktreeDir: string) => string[];
  readActiveSpecPath?: (worktreePath: string) => string | null;
  getWorktreeBranch?: (worktreePath: string) => string | null;
  lookupPrHeadRef?: (prNumber: number, projectRoot: string) => PrHeadLookupResult;
  findMatchingOpenPrs?: (branch: string, cwd?: string) => MatchingOpenPr[];
};

export type MergeTargetResolution =
  | { ok: true; worktreeName: string }
  | { ok: false; code: number };

/**
 * Classify a `--merge` positional into a local patch worktree name.
 * Order: worktree directory name, PR reference, spec path (basename + marker scan).
 * Zero or multiple matches fail closed with stderr diagnostics.
 */
export function resolveMergeTarget(
  projectRoot: string,
  arg: string,
  cwd: string,
  io: TriageIo,
  seams?: MergeTargetResolutionSeams,
): MergeTargetResolution {
  const worktreeDir = join(projectRoot, ".worktree");
  const listNames = seams?.listWorktreeNames ?? defaultListWorktreeNames;
  const readMarker = seams?.readActiveSpecPath ?? defaultReadActiveSpecPath;
  const getBranch = seams?.getWorktreeBranch ?? defaultGetWorktreeBranch;
  const lookupPr = seams?.lookupPrHeadRef ?? defaultLookupPrHeadRef;
  const findOpenPrs = seams?.findMatchingOpenPrs ?? findMatchingOpenPrs;

  if (existsSync(join(worktreeDir, arg))) {
    return { ok: true, worktreeName: arg };
  }

  const prNumber = parsePrReference(arg);
  if (prNumber !== null) {
    const prResult = resolveWorktreeFromPrRef({
      prNumber,
      prRef: arg,
      projectRoot,
      worktreeDir,
      listNames,
      getBranch,
      lookupPr,
      findOpenPrs,
      io,
    });
    if (prResult !== null) {
      return prResult;
    }
  }

  if (isSpecPathShape(arg)) {
    return resolveWorktreeFromSpecPath({
      arg,
      cwd,
      worktreeDir,
      listNames,
      readMarker,
      io,
    });
  }

  io.stderr(`${LABEL}: unresolvable target (not a worktree name, PR reference, or spec path): ${arg}\n`);
  return { ok: false, code: 1 };
}

function resolveWorktreeFromPrRef(args: {
  prNumber: number;
  prRef: string;
  projectRoot: string;
  worktreeDir: string;
  listNames: (worktreeDir: string) => string[];
  getBranch: (worktreePath: string) => string | null;
  lookupPr: (prNumber: number, projectRoot: string) => PrHeadLookupResult;
  findOpenPrs: (branch: string, cwd?: string) => MatchingOpenPr[];
  io: TriageIo;
}): MergeTargetResolution | null {
  const lookup = args.lookupPr(args.prNumber, args.projectRoot);
  if (!lookup.ok) {
    args.io.stderr(`${LABEL}: failed to look up PR reference ${args.prRef}: ${lookup.message}\n`);
    return { ok: false, code: 1 };
  }

  let matchingOpenPrs: MatchingOpenPr[];
  try {
    matchingOpenPrs = args.findOpenPrs(lookup.headRef, args.projectRoot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    args.io.stderr(`${LABEL}: failed to look up PR reference ${args.prRef}: ${message}\n`);
    return { ok: false, code: 1 };
  }

  if (matchingOpenPrs.length > 1) {
    args.io.stderr(`${LABEL}: multiple open PRs match branch ${lookup.headRef}\n`);
    return { ok: false, code: 1 };
  }

  const matches: string[] = [];
  for (const name of args.listNames(args.worktreeDir)) {
    const branch = args.getBranch(join(args.worktreeDir, name));
    if (branch === lookup.headRef) {
      matches.push(name);
    }
  }

  if (matches.length === 0) {
    args.io.stderr(
      `${LABEL}: no local worktree for PR reference ${args.prRef} (branch ${lookup.headRef})\n`,
    );
    return { ok: false, code: 1 };
  }
  if (matches.length > 1) {
    args.io.stderr(`${LABEL}: multiple worktrees match PR reference ${args.prRef}:\n`);
    for (const name of matches) {
      args.io.stderr(`  ${name}\n`);
    }
    return { ok: false, code: 1 };
  }

  const worktreeName = matches[0];
  if (worktreeName === undefined) {
    args.io.stderr(`${LABEL}: no local worktree for PR reference ${args.prRef}\n`);
    return { ok: false, code: 1 };
  }
  return { ok: true, worktreeName };
}

function resolveWorktreeFromSpecPath(args: {
  arg: string;
  cwd: string;
  worktreeDir: string;
  listNames: (worktreeDir: string) => string[];
  readMarker: (worktreePath: string) => string | null;
  io: TriageIo;
}): MergeTargetResolution {
  const normalizedSpecPath = normalizeSpecInput(args.arg, args.cwd);
  const candidates = new Set<string>();

  if (args.arg.includes("/") || args.arg.includes("\\")) {
    const specDirBasename = basename(dirname(normalizedSpecPath));
    const basenameWorktree = join(args.worktreeDir, specDirBasename);
    if (existsSync(basenameWorktree)) {
      candidates.add(basenameWorktree);
    }
  }

  for (const name of args.listNames(args.worktreeDir)) {
    const worktreePath = join(args.worktreeDir, name);
    const markerPath = args.readMarker(worktreePath);
    if (markerPath !== null && normalizeSpecInput(markerPath, args.cwd) === normalizedSpecPath) {
      candidates.add(worktreePath);
    }
  }

  if (candidates.size === 0) {
    args.io.stderr(`${LABEL}: no worktree found for spec path: ${normalizedSpecPath}\n`);
    return { ok: false, code: 1 };
  }

  const worktreePaths = [...candidates].sort();
  if (worktreePaths.length > 1) {
    args.io.stderr(`${LABEL}: multiple worktrees match spec path ${normalizedSpecPath}:\n`);
    for (const worktreePath of worktreePaths) {
      args.io.stderr(`  ${basename(worktreePath)}\n`);
    }
    return { ok: false, code: 1 };
  }

  const worktreePath = worktreePaths[0];
  if (worktreePath === undefined) {
    args.io.stderr(`${LABEL}: no worktree found for spec path: ${normalizedSpecPath}\n`);
    return { ok: false, code: 1 };
  }
  return { ok: true, worktreeName: basename(worktreePath) };
}

function normalizeSpecInput(specPath: string, cwd: string): string {
  return resolve(isAbsolute(specPath) ? specPath : resolve(cwd, specPath));
}

function isSpecPathShape(arg: string): boolean {
  return arg.includes("/") || arg.includes("\\") || arg.endsWith(".md");
}

function parsePrReference(arg: string): number | null {
  const hashMatch = /^#(\d+)$/.exec(arg);
  if (hashMatch?.[1] !== undefined) {
    return Number.parseInt(hashMatch[1], 10);
  }

  const urlMatch = /^https?:\/\/\S+\/pull\/(\d+)\/?$/.exec(arg);
  if (urlMatch?.[1] !== undefined) {
    return Number.parseInt(urlMatch[1], 10);
  }

  if (/^\d+$/.test(arg)) {
    return Number.parseInt(arg, 10);
  }

  return null;
}

function defaultListWorktreeNames(worktreeDir: string): string[] {
  try {
    return readdirSync(worktreeDir).filter((name) => name !== ".keep");
  } catch {
    return [];
  }
}

function defaultReadActiveSpecPath(worktreePath: string): string | null {
  const markerPath = join(worktreePath, ".active-spec-path");
  if (!existsSync(markerPath)) {
    return null;
  }
  try {
    const value = readFileSync(markerPath, "utf8").trim();
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

function defaultGetWorktreeBranch(worktreePath: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: worktreePath,
      stdio: "pipe",
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

function defaultLookupPrHeadRef(prNumber: number, projectRoot: string): PrHeadLookupResult {
  try {
    const output = execFileSync("gh", ["pr", "view", String(prNumber), "--json", "headRefName,state"], {
      cwd: projectRoot,
      env: process.env,
      stdio: "pipe",
      encoding: "utf8",
    }).trim();
    const parsed = JSON.parse(output) as { headRefName?: string; state?: string };
    const state = parsed.state?.toUpperCase();
    if (state === "MERGED" || state === "CLOSED") {
      return { ok: false, message: `PR #${prNumber} is ${state.toLowerCase()}` };
    }
    const headRef = parsed.headRefName?.trim();
    if (!headRef) {
      return { ok: false, message: `PR #${prNumber} has no head ref` };
    }
    return { ok: true, headRef };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes("not found")) {
      return { ok: false, message: `PR #${prNumber} not found` };
    }
    return { ok: false, message };
  }
}
