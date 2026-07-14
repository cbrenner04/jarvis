import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { getCurrentBranch } from "../../../shared/git.ts";
import { CONFIG_DIR, type ConfigOptions, findProjectMatchForPath } from "../config.ts";
import { stripPlanSpecTimestampPrefix } from "../modes/plan/spec-paths.ts";
import { findMatchingOpenPrs, type MatchingOpenPr } from "../pr.ts";
import type { TriageIo } from "./triage.ts";

export function emitMergeRefusal(
  io: TriageIo,
  className: "unknown worktree" | "plan PR" | "implementation PR",
  message: string,
): void {
  io.stderr(`triage --merge (${className}): ${message}\n`);
}

type PrHeadLookupResult = { ok: true; headRef: string } | { ok: false; message: string };

export type MergeTargetResolutionSeams = {
  listWorktreeNames?: (worktreeDir: string) => string[];
  readActiveSpecPath?: (worktreePath: string) => string | null;
  getWorktreeBranch?: (worktreePath: string) => string | null;
  lookupPrHeadRef?: (prNumber: number, projectRoot: string) => PrHeadLookupResult;
  findMatchingOpenPrs?: (branch: string, cwd?: string) => MatchingOpenPr[];
};

export type MergeTargetResolution = { ok: true; worktreePath: string } | { ok: false };

/**
 * Resolve a `triage --merge` positional target to a local worktree path.
 * Order: (1) direct worktree directories in either home, (2) PR reference,
 * (3) spec-path via basename, plan-slug, and marker scan (unioned).
 * Bare `.md` filenames: marker scan only.
 */
export function resolveMergeTarget(
  projectRoot: string,
  arg: string,
  cwd: string,
  io: TriageIo,
  seams?: MergeTargetResolutionSeams,
  config?: ConfigOptions,
): MergeTargetResolution {
  const homes = [join(projectRoot, ".worktree")];
  const project = findProjectMatchForPath(projectRoot, config);
  if (project !== undefined) {
    homes.push(join(config?.dir ?? CONFIG_DIR, "worktrees", project.key));
  }
  const listNames = seams?.listWorktreeNames ?? defaultListWorktreeNames;
  const readMarker = seams?.readActiveSpecPath ?? defaultReadActiveSpecPath;
  const getBranch = seams?.getWorktreeBranch ?? defaultGetWorktreeBranch;
  const lookupPr = seams?.lookupPrHeadRef ?? defaultLookupPrHeadRef;
  const findOpenPrs = seams?.findMatchingOpenPrs ?? findMatchingOpenPrs;

  const directMatches = homes.filter((home) => isDirectory(join(home, arg)));
  const [onlyDirectMatch, ...extraDirectMatches] = directMatches;
  if (extraDirectMatches.length > 0) {
    emitMergeRefusal(io, "unknown worktree", "multiple worktrees match worktree:");
    for (const path of directMatches.sort()) io.stderr(`  ${path}\n`);
    return { ok: false };
  }
  if (onlyDirectMatch !== undefined) {
    return { ok: true, worktreePath: join(onlyDirectMatch, arg) };
  }

  const prNumber = parsePrReference(arg);
  if (prNumber !== null) {
    return resolveWorktreeFromPrRef({
      prNumber,
      prRef: arg,
      projectRoot,
      homes,
      listNames,
      getBranch,
      lookupPr,
      findOpenPrs,
      io,
    });
  }

  if (arg.includes("/") || arg.includes("\\") || arg.endsWith(".md")) {
    return resolveWorktreeFromSpecPath({
      arg,
      cwd,
      homes,
      listNames,
      readMarker,
      io,
    });
  }

  return fail(io, `unresolvable target (not a worktree name, PR reference, or spec path): ${arg}`);
}

function fail(io: TriageIo, message: string): MergeTargetResolution {
  emitMergeRefusal(io, "unknown worktree", message);
  return { ok: false };
}

function resolveWorktreeFromPrRef(args: {
  prNumber: number;
  prRef: string;
  projectRoot: string;
  homes: string[];
  listNames: (worktreeDir: string) => string[];
  getBranch: (worktreePath: string) => string | null;
  lookupPr: (prNumber: number, projectRoot: string) => PrHeadLookupResult;
  findOpenPrs: (branch: string, cwd?: string) => MatchingOpenPr[];
  io: TriageIo;
}): MergeTargetResolution {
  const lookup = args.lookupPr(args.prNumber, args.projectRoot);
  if (!lookup.ok) {
    return fail(args.io, `failed to look up PR reference ${args.prRef}: ${lookup.message}`);
  }

  let matchingOpenPrs: MatchingOpenPr[];
  try {
    matchingOpenPrs = args.findOpenPrs(lookup.headRef, args.projectRoot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(args.io, `failed to look up PR reference ${args.prRef}: ${message}`);
  }

  if (matchingOpenPrs.length > 1) {
    return fail(args.io, `multiple open PRs match branch ${lookup.headRef}`);
  }

  const matches: string[] = [];
  for (const home of args.homes) {
    const names = args.listNames(home);
    for (const name of names) {
      const path = join(home, name);
      const branch = args.getBranch(path);
      if (branch === lookup.headRef) matches.push(path);
    }
  }

  const [onlyMatch, ...extraMatches] = matches;
  if (onlyMatch === undefined) {
    return fail(args.io, `no local worktree for PR reference ${args.prRef} (branch ${lookup.headRef})`);
  }
  if (extraMatches.length > 0) {
    emitMergeRefusal(args.io, "unknown worktree", `multiple worktrees match PR reference ${args.prRef}:`);
    for (const path of matches) args.io.stderr(`  ${path}\n`);
    return { ok: false };
  }

  return { ok: true, worktreePath: onlyMatch };
}

function resolveWorktreeFromSpecPath(args: {
  arg: string;
  cwd: string;
  homes: string[];
  listNames: (worktreeDir: string) => string[];
  readMarker: (worktreePath: string) => string | null;
  io: TriageIo;
}): MergeTargetResolution {
  const normalizedSpecPath = normalizeSpecInput(args.arg, args.cwd);
  const candidates = new Set<string>();

  if (args.arg.includes("/") || args.arg.includes("\\")) {
    const specDirBasename = basename(dirname(normalizedSpecPath));
    for (const home of args.homes) {
      const basenameWorktree = join(home, specDirBasename);
      if (isDirectory(basenameWorktree)) candidates.add(basenameWorktree);
      const planWorktree = join(home, `plan-${stripPlanSpecTimestampPrefix(specDirBasename)}`);
      if (isDirectory(planWorktree)) candidates.add(planWorktree);
      const nestedPlanWorktree = join(home, "plan", stripPlanSpecTimestampPrefix(specDirBasename));
      if (isDirectory(nestedPlanWorktree)) candidates.add(nestedPlanWorktree);
    }
  }

  for (const home of args.homes) {
    for (const name of args.listNames(home)) {
      const worktreePath = join(home, name);
      const markerPath = args.readMarker(worktreePath);
      if (markerPath !== null && normalizeSpecInput(markerPath, args.cwd) === normalizedSpecPath) {
        candidates.add(worktreePath);
      }
    }
  }

  const worktreePaths = [...candidates].sort();
  const [onlyWorktreePath, ...extraWorktreePaths] = worktreePaths;
  if (onlyWorktreePath === undefined) {
    return fail(args.io, `no worktree found for spec path: ${normalizedSpecPath}`);
  }
  if (extraWorktreePaths.length > 0) {
    emitMergeRefusal(args.io, "unknown worktree", `multiple worktrees match spec path ${normalizedSpecPath}:`);
    for (const worktreePath of worktreePaths) args.io.stderr(`  ${worktreePath}\n`);
    return { ok: false };
  }

  return { ok: true, worktreePath: onlyWorktreePath };
}

function normalizeSpecInput(specPath: string, cwd: string): string {
  return resolve(isAbsolute(specPath) ? specPath : resolve(cwd, specPath));
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
  const names: string[] = [];
  const walk = (dir: string, relative: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === ".keep") continue;
      const path = join(dir, name);
      if (existsSync(join(path, ".git"))) {
        names.push(join(relative, name));
      } else if (isDirectory(path)) {
        walk(path, join(relative, name));
      }
    }
  };
  walk(worktreeDir, "");
  return names;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
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
    return getCurrentBranch(worktreePath);
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
