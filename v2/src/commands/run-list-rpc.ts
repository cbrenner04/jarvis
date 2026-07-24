import type { Run, RunStatus } from "../persistence/state-store.ts";

export const FILTERED_LIST_DEFAULT_LIMIT = 200;

export type ListRpcParams = {
  sinceMs?: number;
  limit?: number;
  project?: string;
  branch?: string;
  specPath?: string;
  status?: RunStatus;
};

const LIST_RPC_PARAM_KEYS = [
  "sinceMs",
  "limit",
  "project",
  "branch",
  "specPath",
  "status",
] as const satisfies ReadonlyArray<keyof ListRpcParams>;

export function resolveListRpcRequest(input: ListRpcParams): ListRpcParams | undefined {
  const entries = LIST_RPC_PARAM_KEYS.flatMap((key) => {
    const value = input[key];
    return value === undefined ? [] : ([[key, value]] as const);
  });
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries) as ListRpcParams;
}

let invertListRpcRequestIsFilteredForTest = false;

export function setInvertListRpcRequestIsFilteredForTest(value: boolean): void {
  invertListRpcRequestIsFilteredForTest = value;
}

export function listRpcRequestIsFiltered(params: ListRpcParams | undefined): boolean {
  if (params === undefined) return false;
  const filtered =
    params.sinceMs !== undefined ||
    params.project !== undefined ||
    params.branch !== undefined ||
    params.specPath !== undefined ||
    params.status !== undefined;
  return invertListRpcRequestIsFilteredForTest ? !filtered : filtered;
}

export type ListRpcMatchRun = Pick<Run, "createdAt" | "project" | "branch" | "specPath" | "status">;

export function runMatchesListRpcParams(run: ListRpcMatchRun, params: ListRpcParams | undefined): boolean {
  if (params === undefined) return true;
  if (params.sinceMs !== undefined && run.createdAt < params.sinceMs) return false;
  if (params.project !== undefined && run.project !== params.project) return false;
  if (params.branch !== undefined && run.branch !== params.branch) return false;
  if (params.specPath !== undefined && run.specPath !== params.specPath) return false;
  if (params.status !== undefined && run.status !== params.status) return false;
  return true;
}
