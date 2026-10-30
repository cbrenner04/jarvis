import { join } from "node:path";
import { branchExistsLocalAsync, listTreeChildrenAtRef } from "../shared/git.ts";
import { realAsyncSubprocessRunner } from "../shared/subprocess.ts";

export type PlanSpecDirGitRead = {
  branchExistsLocal(projectRoot: string, branchName: string): Promise<boolean>;
  listTreeChildrenAtRef(
    projectRoot: string,
    ref: string,
    treePath: string,
  ): Promise<readonly { type: string; name: string }[] | undefined>;
};

export const defaultPlanSpecDirGitRead: PlanSpecDirGitRead = {
  branchExistsLocal: branchExistsLocalAsync,
  listTreeChildrenAtRef: (projectRoot, ref, treePath) =>
    listTreeChildrenAtRef(projectRoot, ref, treePath, realAsyncSubprocessRunner),
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchingPlanSpecDirBasenamePattern(readyName: string): RegExp {
  return new RegExp(`^\\d{8}T\\d{6}Z-${escapeRegExp(readyName)}$`);
}

function treeDirectoryNames(children: readonly { type: string; name: string }[] | undefined): Set<string> {
  if (children === undefined) return new Set();
  return new Set(children.filter((entry) => entry.type === "tree").map((entry) => entry.name));
}

/** Newest branch-added `<UTC>-<readyName>` under `targetDir` relative to `baseRef`, or undefined. */
export function selectNewestBranchAddedPlanSpecBasename(
  branchChildren: readonly { type: string; name: string }[] | undefined,
  baseChildren: readonly { type: string; name: string }[] | undefined,
  readyName: string,
): string | undefined {
  if (branchChildren === undefined) return undefined;
  const onBase = treeDirectoryNames(baseChildren);
  const pattern = matchingPlanSpecDirBasenamePattern(readyName);
  let newest: string | undefined;
  for (const entry of branchChildren) {
    if (entry.type !== "tree") continue;
    if (!pattern.test(entry.name)) continue;
    if (onBase.has(entry.name)) continue;
    if (newest === undefined || entry.name > newest) newest = entry.name;
  }
  return newest;
}

export async function resolveReusedPlanSpecDirRelativePath(
  projectRoot: string,
  baseRef: string,
  planBranch: string,
  targetDir: string,
  readyName: string,
  gitRead: PlanSpecDirGitRead = defaultPlanSpecDirGitRead,
): Promise<string | undefined> {
  if (!(await gitRead.branchExistsLocal(projectRoot, planBranch))) return undefined;
  const [branchChildren, baseChildren] = await Promise.all([
    gitRead.listTreeChildrenAtRef(projectRoot, planBranch, targetDir),
    gitRead.listTreeChildrenAtRef(projectRoot, baseRef, targetDir),
  ]);
  const basename = selectNewestBranchAddedPlanSpecBasename(branchChildren, baseChildren, readyName);
  return basename === undefined ? undefined : join(targetDir, basename);
}
