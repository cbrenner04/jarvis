import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { errorMessage } from "../../../shared/error-message.ts";
import {
  addWorktreeWithNewBranch,
  blobExistsAtRef,
  cleanWorktreeUntracked,
  commitInWorktree,
  deleteBranch,
  getBaseBranch,
  listLocalBranchHeads,
  type BlobOidAtPath,
  listRecursiveBlobOidsAtRef,
  readLocalGitConfig,
  removeWorktree,
  resetWorktreeHard,
  resolveRef,
  stagePathMove,
  stagePathRemove,
} from "../../../shared/git.ts";
import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";
import { managedWorktreePath } from "../paths.ts";
import { type ArtifactFs, type ArtifactSpec, resolveConsumedReadyIntent } from "./cleanup-artifacts.ts";

type ArchivePublicationStep = "worktree add" | "git mv" | "ready-intent prune" | "commit";

export type ArchivePublicationResult =
  | { status: "archived"; destination: string; intentPruned: boolean; branch: string; worktreePath: string }
  | { status: "intentPruned"; readyIntent: string; branch: string; worktreePath: string }
  | { status: "skipped"; reason: string };

export type ArchivePublicationSession = {
  readonly branch: string;
  readonly worktreePath: string;
  /** Number of archive commits landed on the branch so far. */
  commits(): number;
  /** Stage one in-repo archive move as a commit on the isolated cleanup branch. */
  publish(spec: ArtifactSpec): Promise<ArchivePublicationResult>;
  /**
   * Stage only a consumed ready-intent prune when the spec tree is already on the default branch.
   * Consumption is re-proven on the archive branch's tree, never the operator checkout; with
   * `expectedReadyIntent`, the re-proven path must equal it.
   */
  publishConsumedReadyIntentOnly(spec: ArtifactSpec, expectedReadyIntent?: string): Promise<ArchivePublicationResult>;
};

export type ArchivePublicationTarget = {
  branch: string;
  worktreePath: string;
};

type ArchivePublicationDeps = {
  runner: AsyncSubprocessRunner;
  projectRoot: string;
  jarvisRoot: string;
  project: string;
  /** Branch stamp; defaults to a UTC compact timestamp. */
  stamp?: string;
  /** Reuse an existing staged cleanup archive branch instead of minting a new stamp. */
  adoptedBranch?: string;
  adoptedWorktreePath?: string;
  onStagedArchiveBranch?: (branch: string) => void;
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

/** A committed blob-id snapshot: `fs` reads return blob ids, so byte equality is id equality. */
type CommittedBlobIds = { fs: ArtifactFs; paths: string[] };

/**
 * Blob ids of `relPaths` (directories recurse) as committed on `ref`, from one `git ls-tree`. Paths
 * are keyed absolute under `projectRoot`. Identical bytes have identical blob ids, so the returned
 * read-only `fs` answers `resolveConsumedReadyIntent` without reading any blob. Undefined when `ref`
 * is unreadable.
 */
export async function committedBlobIdsAtRef(
  runner: AsyncSubprocessRunner,
  cwd: string,
  projectRoot: string,
  ref: string,
  relPaths: readonly string[],
): Promise<CommittedBlobIds | undefined> {
  let listing: BlobOidAtPath[] | undefined;
  try {
    listing = await listRecursiveBlobOidsAtRef(cwd, ref, relPaths, runner);
  } catch {
    return undefined;
  }
  if (listing === undefined) return undefined;
  const ids = new Map<string, Buffer>();
  for (const { path, oid } of listing) {
    ids.set(resolve(projectRoot, path), Buffer.from(oid));
  }
  const readOnly = (): never => {
    throw new Error("a committed blob-id snapshot is read-only");
  };
  return {
    paths: [...ids.keys()],
    fs: {
      exists: (path) => ids.has(resolve(path)),
      read: (path) => {
        const id = ids.get(resolve(path));
        if (id === undefined) throw new Error(`not committed on ${ref}: ${path}`);
        return id;
      },
      mkdir: readOnly,
      rename: readOnly,
      unlink: readOnly,
    },
  };
}

/** Cleanup archive branches whose tree already carries `relDest`: the move is staged, awaiting its PR. */
export async function cleanupBranchCarryingArchive(
  runner: AsyncSubprocessRunner,
  projectRoot: string,
  relDest: string,
): Promise<string | undefined> {
  let branches: string[];
  try {
    branches = (await listLocalBranchHeads(projectRoot, runner))
      .map((head) => head.branch)
      .filter((branch) => branch.startsWith(CLEANUP_ARCHIVE_BRANCH_PREFIX));
  } catch {
    return undefined;
  }
  for (const branch of branches) {
    if (await blobExistsAtRef(projectRoot, branch, relDest, runner)) return branch;
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
  const branch = deps.adoptedBranch ?? `${CLEANUP_ARCHIVE_BRANCH_PREFIX}${deps.stamp ?? utcStamp()}`;
  const worktreePath = deps.adoptedWorktreePath ?? managedWorktreePath(deps.jarvisRoot, deps.project, branch);
  let materialized = deps.adoptedBranch !== undefined && existsSync(worktreePath);
  let commits = 0;

  async function materialize(): Promise<ArchivePublicationResult | undefined> {
    if (materialized) return undefined;
    try {
      const baseRef = await resolveArchiveBaseRef();
      await addWorktreeWithNewBranch(
        deps.projectRoot,
        { path: worktreePath, branch, startPoint: baseRef },
        deps.runner,
      );
      materialized = true;
      return undefined;
    } catch (error) {
      return { status: "skipped", reason: `archive publication failed at worktree add: ${errorMessage(error)}` };
    }
  }

  /** The project's default branch when it resolves locally, else the checkout's HEAD. */
  async function resolveArchiveBaseRef(): Promise<string> {
    const baseBranch = await getBaseBranch(deps.projectRoot, deps.runner);
    if ((await resolveRef(deps.projectRoot, `refs/heads/${baseBranch}`, deps.runner)).status === "resolved") {
      return baseBranch;
    }
    return "HEAD";
  }

  /** A checkout with no committer identity (CI, fresh machines) still gets a committed archive. */
  async function commitIdentity(): Promise<{ name: string; email: string } | undefined> {
    if ((await readLocalGitConfig(worktreePath, "user.email", deps.runner)) !== undefined) return undefined;
    return { name: "jarvis cleanup", email: "jarvis-cleanup@localhost" };
  }

  async function rollback(step: ArchivePublicationStep, error: unknown): Promise<ArchivePublicationResult> {
    try {
      await resetWorktreeHard(worktreePath, deps.runner);
      await cleanWorktreeUntracked(worktreePath, deps.runner);
    } catch {
      // the worktree is disposable; removal below is the stronger reset
    }
    if (commits === 0) {
      try {
        await removeWorktree(deps.projectRoot, worktreePath, deps.runner, { force: true });
        await deleteBranch(deps.projectRoot, branch, deps.runner, { force: true });
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
        deps.onStagedArchiveBranch?.(staged);
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
        await stagePathMove(worktreePath, relSource, relDest, deps.runner);
      } catch (error) {
        return rollback("git mv", error);
      }
      if (relReadyIntent !== undefined) {
        try {
          await stagePathRemove(worktreePath, relReadyIntent, deps.runner);
        } catch (error) {
          return rollback("ready-intent prune", error);
        }
      }
      try {
        const subject = `spec: archive ${spec.name}${relReadyIntent !== undefined ? " and prune its consumed ready-intent" : ""}`;
        const identity = await commitIdentity();
        await commitInWorktree(worktreePath, subject, deps.runner, {
          quiet: true,
          ...(identity === undefined ? {} : { identity }),
        });
      } catch (error) {
        return rollback("commit", error);
      }
      commits += 1;
      return { status: "archived", destination, intentPruned: relReadyIntent !== undefined, branch, worktreePath };
    },
    async publishConsumedReadyIntentOnly(spec, expectedReadyIntent) {
      const relSource = repoRelative(deps.projectRoot, spec.source);
      const relHome = repoRelative(deps.projectRoot, spec.home);
      if (relSource === undefined || relHome === undefined) {
        return { status: "skipped", reason: "ready-intent path lies outside the project checkout" };
      }
      const probe = [`${relSource}/intent.md`, `${relHome}/ready-intents`];
      const committed = materialized
        ? await committedBlobIdsAtRef(deps.runner, worktreePath, deps.projectRoot, "HEAD", probe)
        : await committedBlobIdsAtRef(
            deps.runner,
            deps.projectRoot,
            deps.projectRoot,
            await resolveArchiveBaseRef(),
            probe,
          );
      if (committed === undefined) {
        return { status: "skipped", reason: "failed to inspect ready-intent: archive base tree unreadable" };
      }
      let readyIntent: string | undefined;
      try {
        readyIntent = resolveConsumedReadyIntent(spec, committed.fs);
      } catch (error) {
        return { status: "skipped", reason: `failed to inspect ready-intent: ${errorMessage(error)}` };
      }
      if (readyIntent === undefined) {
        return { status: "skipped", reason: "no consumed ready-intent to prune" };
      }
      if (expectedReadyIntent !== undefined && resolve(readyIntent) !== resolve(expectedReadyIntent)) {
        return {
          status: "skipped",
          reason: `re-proven ready-intent ${readyIntent} is not the proven ${expectedReadyIntent}`,
        };
      }
      const relReadyIntent = repoRelative(deps.projectRoot, readyIntent);
      if (relReadyIntent === undefined) {
        return { status: "skipped", reason: "ready-intent path lies outside the project checkout" };
      }
      const materializeFailure = await materialize();
      if (materializeFailure !== undefined) return materializeFailure;
      try {
        await stagePathRemove(worktreePath, relReadyIntent, deps.runner);
      } catch (error) {
        return rollback("ready-intent prune", error);
      }
      try {
        const identity = await commitIdentity();
        await commitInWorktree(worktreePath, `spec: prune consumed ready-intent for ${spec.name}`, deps.runner, {
          quiet: true,
          ...(identity === undefined ? {} : { identity }),
        });
      } catch (error) {
        return rollback("commit", error);
      }
      commits += 1;
      return { status: "intentPruned", readyIntent, branch, worktreePath };
    },
  };
}
