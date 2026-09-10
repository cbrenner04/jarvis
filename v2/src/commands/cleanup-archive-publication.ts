import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { errorMessage } from "../../../shared/error-message.ts";
import { getBaseBranch } from "../../../shared/git.ts";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { managedWorktreePath } from "../paths.ts";
import { type ArtifactSpec, resolveConsumedReadyIntent } from "./cleanup-artifacts.ts";

type ArchivePublicationStep = "worktree add" | "git mv" | "ready-intent prune" | "commit";

export type ArchivePublicationResult =
  | { status: "archived"; destination: string; intentPruned: boolean; branch: string; worktreePath: string }
  | { status: "skipped"; reason: string };

export type ArchivePublicationSession = {
  readonly branch: string;
  readonly worktreePath: string;
  /** Number of archive commits landed on the branch so far. */
  commits(): number;
  /** Stage one in-repo archive move as a commit on the isolated cleanup branch. */
  publish(spec: ArtifactSpec): Promise<ArchivePublicationResult>;
};

type ArchivePublicationDeps = {
  runner: AsyncSubprocessRunner;
  projectRoot: string;
  jarvisRoot: string;
  project: string;
  /** Branch stamp; defaults to a UTC compact timestamp. */
  stamp?: string;
};

const CLEANUP_ARCHIVE_BRANCH_PREFIX = "cleanup/archive-";

function utcStamp(now = new Date()): string {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/** Drop the `cleanup/` parent a rolled-back worktree leaves behind, so a failure leaves no trace. */
function removeIfEmpty(dir: string): void {
  try {
    if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true });
  } catch {
    // absent or non-empty: nothing to tidy
  }
}

function repoRelative(projectRoot: string, path: string): string | undefined {
  const rel = relative(projectRoot, path).replace(/\\/g, "/");
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return rel;
}

/** Cleanup archive branches whose tree already carries `relDest`: the move is staged, awaiting its PR. */
export async function cleanupBranchCarryingArchive(
  runner: AsyncSubprocessRunner,
  projectRoot: string,
  relDest: string,
): Promise<string | undefined> {
  let branches: string[];
  try {
    const listed = await runner.runAsync(
      "git",
      ["for-each-ref", "--format=%(refname:short)", `refs/heads/${CLEANUP_ARCHIVE_BRANCH_PREFIX}*`],
      projectRoot,
    );
    branches = listed
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return undefined;
  }
  for (const branch of branches) {
    try {
      await runner.runAsync("git", ["cat-file", "-e", `${branch}:${relDest}`], projectRoot);
      return branch;
    } catch {
      // not on this branch
    }
  }
  return undefined;
}

/**
 * One isolated cleanup branch and worktree per invocation and project. Archive moves are `git mv`
 * commits on that branch; the operator checkout is never written. A failed local step is rolled
 * back inside the worktree (`git reset --hard`) and, when nothing landed, the branch and worktree
 * are removed, so the only traces of a failure are the named step in the skip line.
 */
export function createArchivePublicationSession(deps: ArchivePublicationDeps): ArchivePublicationSession {
  const branch = `${CLEANUP_ARCHIVE_BRANCH_PREFIX}${deps.stamp ?? utcStamp()}`;
  const worktreePath = managedWorktreePath(deps.jarvisRoot, deps.project, branch);
  let materialized = false;
  let commits = 0;

  const git = (args: string[], cwd: string) => deps.runner.runAsync("git", args, cwd);

  async function materialize(): Promise<ArchivePublicationResult | undefined> {
    if (materialized) return undefined;
    try {
      const baseRef = await resolveArchiveBaseRef();
      await git(["worktree", "add", "-b", branch, worktreePath, baseRef], deps.projectRoot);
      materialized = true;
      return undefined;
    } catch (error) {
      return { status: "skipped", reason: `archive publication failed at worktree add: ${errorMessage(error)}` };
    }
  }

  /** The project's default branch when it resolves locally, else the checkout's HEAD. */
  async function resolveArchiveBaseRef(): Promise<string> {
    const baseBranch = await getBaseBranch(deps.projectRoot, deps.runner);
    try {
      await git(["rev-parse", "--verify", "--quiet", `refs/heads/${baseBranch}`], deps.projectRoot);
      return baseBranch;
    } catch {
      return "HEAD";
    }
  }

  async function rollback(step: ArchivePublicationStep, error: unknown): Promise<ArchivePublicationResult> {
    try {
      await git(["reset", "--hard", "HEAD"], worktreePath);
      await git(["clean", "-fd"], worktreePath);
    } catch {
      // the worktree is disposable; removal below is the stronger reset
    }
    if (commits === 0) {
      try {
        await git(["worktree", "remove", "--force", worktreePath], deps.projectRoot);
        await git(["branch", "-D", branch], deps.projectRoot);
        removeIfEmpty(dirname(worktreePath));
        materialized = false;
      } catch {
        // leave the empty branch for the operator; the primary checkout is untouched either way
      }
    }
    return { status: "skipped", reason: `archive publication failed at ${step}: ${errorMessage(error)}` };
  }

  return {
    branch,
    worktreePath,
    commits: () => commits,
    async publish(spec) {
      const relSource = repoRelative(deps.projectRoot, spec.source);
      const destination = join(spec.home, "completed", basename(spec.source));
      const relDest = repoRelative(deps.projectRoot, destination);
      if (relSource === undefined || relDest === undefined) {
        return { status: "skipped", reason: "archive paths lie outside the project checkout" };
      }
      const staged = await cleanupBranchCarryingArchive(deps.runner, deps.projectRoot, relDest);
      if (staged !== undefined) {
        return {
          status: "skipped",
          reason: `already staged on cleanup branch ${staged}; push it and open the archive PR`,
        };
      }
      let readyIntent: string | undefined;
      try {
        readyIntent = resolveConsumedReadyIntent(spec);
      } catch (error) {
        return { status: "skipped", reason: `failed to inspect ready-intent: ${errorMessage(error)}` };
      }
      const relReadyIntent = readyIntent === undefined ? undefined : repoRelative(deps.projectRoot, readyIntent);

      const materializeFailure = await materialize();
      if (materializeFailure !== undefined) return materializeFailure;
      try {
        mkdirSync(dirname(join(worktreePath, relDest)), { recursive: true });
        await git(["mv", relSource, relDest], worktreePath);
      } catch (error) {
        return rollback("git mv", error);
      }
      if (relReadyIntent !== undefined) {
        try {
          await git(["rm", "--quiet", relReadyIntent], worktreePath);
        } catch (error) {
          return rollback("ready-intent prune", error);
        }
      }
      try {
        const subject = `spec: archive ${spec.name}${relReadyIntent !== undefined ? " and prune its consumed ready-intent" : ""}`;
        await git(["commit", "--quiet", "-m", subject], worktreePath);
      } catch (error) {
        return rollback("commit", error);
      }
      commits += 1;
      return { status: "archived", destination, intentPruned: relReadyIntent !== undefined, branch, worktreePath };
    },
  };
}
