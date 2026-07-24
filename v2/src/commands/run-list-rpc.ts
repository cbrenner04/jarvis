import type { RunStatus } from "../persistence/state-store.ts";

export const FILTERED_LIST_DEFAULT_LIMIT = 200;

export type ListRpcParams = {
  sinceMs?: number;
  limit?: number;
  project?: string;
  branch?: string;
  specPath?: string;
  status?: RunStatus;
};

export function resolveListRpcRequest(input: ListRpcParams): ListRpcParams | undefined {
  const { sinceMs, limit, project, branch, specPath, status } = input;
  if (
    sinceMs === undefined &&
    limit === undefined &&
    project === undefined &&
    branch === undefined &&
    specPath === undefined &&
    status === undefined
  ) {
    return undefined;
  }
  return {
    ...(sinceMs !== undefined ? { sinceMs } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(project !== undefined ? { project } : {}),
    ...(branch !== undefined ? { branch } : {}),
    ...(specPath !== undefined ? { specPath } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}

export function listRpcRequestIsFiltered(params: ListRpcParams | undefined): boolean {
  if (params === undefined) return false;
  return (
    params.sinceMs !== undefined ||
    params.project !== undefined ||
    params.branch !== undefined ||
    params.specPath !== undefined ||
    params.status !== undefined
  );
}

let invertListRpcRequestIsFilteredForTest = false;

export function setInvertListRpcRequestIsFilteredForTest(value: boolean): void {
  invertListRpcRequestIsFilteredForTest = value;
}

export function evaluateListRpcRequestIsFiltered(params: ListRpcParams | undefined): boolean {
  const filtered = listRpcRequestIsFiltered(params);
  return invertListRpcRequestIsFilteredForTest ? !filtered : filtered;
}
