import {
  type AsyncSubprocessRunner,
  realAsyncSubprocessRunner,
  realSubprocessRunner,
  type SubprocessRunner,
} from "./subprocess.ts";

/** Resolve GitHub's default branch, falling back to `main` when unavailable. */
export async function getBaseBranch(
  cwd?: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<string> {
  try {
    const branch = (
      await runner.runAsync(
        "gh",
        ["repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"],
        cwd ?? "",
      )
    ).trim();
    return branch.length > 0 ? branch : "main";
  } catch {
    return "main";
  }
}

/** True when `branchName` resolves to a local ref in `projectRoot`. */
export function branchExistsLocal(
  projectRoot: string,
  branchName: string,
  runner: SubprocessRunner = realSubprocessRunner,
): boolean {
  try {
    runner.run("git", ["rev-parse", "--verify", branchName], projectRoot);
    return true;
  } catch {
    return false;
  }
}

function originHeadListedInLsRemote(output: string, branchName: string): boolean {
  const want = `refs/heads/${branchName}`;
  for (const line of output.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    const tab = trimmed.indexOf("\t");
    if (tab === -1) continue;
    if (trimmed.slice(tab + 1) === want) return true;
  }
  return false;
}

/**
 * True when `origin` has branch `branchName` per `git ls-remote --heads`. Fails closed
 * (false) when `ls-remote` errors or returns no matching head; a local remote-tracking
 * ref alone does not count.
 */
export function branchExistsOnOrigin(
  projectRoot: string,
  branchName: string,
  runner: SubprocessRunner = realSubprocessRunner,
): boolean {
  try {
    const output = runner.run("git", ["ls-remote", "--heads", "origin", branchName], projectRoot);
    return originHeadListedInLsRemote(output, branchName);
  } catch {
    return false;
  }
}

/** The checked-out branch name (`rev-parse --abbrev-ref HEAD`) at `cwd`. */
export function getCurrentBranch(cwd: string, runner: SubprocessRunner = realSubprocessRunner): string {
  return runner.run("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd).trim();
}

/** True when `git status --porcelain` at `cwd` reports any uncommitted changes. */
export function isWorktreeDirty(cwd: string, runner: SubprocessRunner = realSubprocessRunner): boolean {
  return runner.run("git", ["status", "--porcelain"], cwd).trim().length > 0;
}

/** True when `cwd` is inside a git working tree; false for plain (git-disabled) directories. */
export function isGitRepo(cwd: string, runner: SubprocessRunner = realSubprocessRunner): boolean {
  try {
    runner.run("git", ["rev-parse", "--is-inside-work-tree"], cwd);
    return true;
  } catch {
    return false;
  }
}

/** Async version: True when `branchName` resolves to a local ref in `projectRoot`. */
export async function branchExistsLocalAsync(
  projectRoot: string,
  branchName: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<boolean> {
  try {
    await runner.runAsync("git", ["rev-parse", "--verify", branchName], projectRoot);
    return true;
  } catch {
    return false;
  }
}

/** True when `origin/<branchName>` resolves locally (may be stale vs `ls-remote`). */
export async function originTrackingRefResolvesAsync(
  projectRoot: string,
  branchName: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<boolean> {
  try {
    await runner.runAsync("git", ["rev-parse", "--verify", `origin/${branchName}`], projectRoot);
    return true;
  } catch {
    return false;
  }
}

/** Async version: True when `origin` lists `branchName` per `git ls-remote --heads`. */
export async function branchExistsOnOriginAsync(
  projectRoot: string,
  branchName: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<boolean> {
  try {
    const output = await runner.runAsync("git", ["ls-remote", "--heads", "origin", branchName], projectRoot);
    return originHeadListedInLsRemote(output, branchName);
  } catch {
    return false;
  }
}

/** Async version: The checked-out branch name at `cwd`. */
export async function getCurrentBranchAsync(
  cwd: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<string> {
  return (await runner.runAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd)).trim();
}

/** Async version: True when `git status --porcelain` at `cwd` reports any uncommitted changes. */
export async function isWorktreeDirtyAsync(
  cwd: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<boolean> {
  return (await runner.runAsync("git", ["status", "--porcelain"], cwd)).trim().length > 0;
}

/** Async version: True when `cwd` is inside a git working tree; false for plain (git-disabled) directories. */
export async function isGitRepoAsync(
  cwd: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<boolean> {
  try {
    await runner.runAsync("git", ["rev-parse", "--is-inside-work-tree"], cwd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** The full HEAD commit hash at `cwd` asynchronously. */
export async function getCurrentHeadAsync(
  cwd: string,
  runner: AsyncSubprocessRunner = realAsyncSubprocessRunner,
): Promise<string> {
  return (await runner.runAsync("git", ["rev-parse", "HEAD"], cwd)).trim();
}
