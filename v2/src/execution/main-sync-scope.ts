import type { AsyncSubprocessRunner } from "../../../shared/subprocess.ts";

/** Blob id placeholder for paths absent at a git object; callers and `selectMainSyncPaths` must agree. */
export const MAIN_SYNC_ABSENT_BLOB = "jarvis:main-sync:absent";

export type MainSyncPathBlobs = {
  path: string;
  headBlob: string;
  mergeBaseBlob: string;
  stagedBlob: string;
  baseRefTipBlob?: string;
  originBaseRefTipBlob?: string;
};

function isResolvedTipBlob(blob: string | undefined): blob is string {
  return blob !== undefined && blob !== MAIN_SYNC_ABSENT_BLOB;
}

function stagedMatchesResolvedTip(stagedBlob: string, entry: MainSyncPathBlobs): boolean {
  if (isResolvedTipBlob(entry.baseRefTipBlob) && stagedBlob === entry.baseRefTipBlob) {
    return true;
  }
  if (isResolvedTipBlob(entry.originBaseRefTipBlob) && stagedBlob === entry.originBaseRefTipBlob) {
    return true;
  }
  return false;
}

function isMainSyncPath(entry: MainSyncPathBlobs): boolean {
  if (entry.headBlob !== entry.mergeBaseBlob) {
    return false;
  }
  if (entry.stagedBlob === entry.mergeBaseBlob) {
    return false;
  }
  return stagedMatchesResolvedTip(entry.stagedBlob, entry);
}

/** Paths whose staged content mirrors a resolved `baseRef` / `origin/<baseRef>` tip without lane edits at HEAD. */
export function selectMainSyncPaths(entries: readonly MainSyncPathBlobs[]): string[] {
  const selected: string[] = [];
  for (const entry of entries) {
    if (isMainSyncPath(entry)) {
      selected.push(entry.path);
    }
  }
  return selected;
}

export async function resolveLaneMergeBase(
  worktreePath: string,
  baseRef: string,
  runner: AsyncSubprocessRunner,
): Promise<string | undefined> {
  try {
    const mergeBase = (await runner.runAsync("git", ["merge-base", baseRef, "HEAD"], worktreePath)).trim();
    return mergeBase.length > 0 ? mergeBase : undefined;
  } catch {
    return undefined;
  }
}
