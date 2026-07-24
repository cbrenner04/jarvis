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

let invertListRpcRequestIsFilteredForTest = false;

export function setInvertListRpcRequestIsFilteredForTest(value: boolean): void {
  invertListRpcRequestIsFilteredForTest = value;
}

export function listRpcRequestIsFiltered(params: ListRpcParams | undefined): boolean {
  const filtered =
    params !== undefined &&
    (params.sinceMs !== undefined ||
      params.project !== undefined ||
      params.branch !== undefined ||
      params.specPath !== undefined ||
      params.status !== undefined);
  return invertListRpcRequestIsFilteredForTest ? !filtered : filtered;
}
