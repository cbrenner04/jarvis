import { join } from "node:path";
import { branchExistsLocalAsync, listTreeChildrenAtRef } from "../shared/git.ts";
import { realAsyncSubprocessRunner } from "../shared/subprocess.ts";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchingPlanSpecDirBasenamePattern(readyName: string): RegExp {
  return new RegExp(`^\\d{8}T\\d{6}Z-${escapeRegExp(readyName)}$`);
}

export function selectNewestBranchAddedPlanSpecBasename(
  branchChildren: readonly { type: string; name: string }[] | undefined,
  baseChildren: readonly { type: string; name: string }[] | undefined,
  readyName: string,
): string | undefined {
  if (branchChildren === undefined) return undefined;
  const onBase = new Set((baseChildren ?? []).filter((entry) => entry.type === "tree").map((entry) => entry.name));
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
): Promise<string | undefined> {
  if (!(await branchExistsLocalAsync(projectRoot, planBranch))) return undefined;
  const [branchChildren, baseChildren] = await Promise.all([
    listTreeChildrenAtRef(projectRoot, planBranch, targetDir, realAsyncSubprocessRunner),
    listTreeChildrenAtRef(projectRoot, baseRef, targetDir, realAsyncSubprocessRunner),
  ]);
  const basename = selectNewestBranchAddedPlanSpecBasename(branchChildren, baseChildren, readyName);
  return basename === undefined ? undefined : join(targetDir, basename);
}
