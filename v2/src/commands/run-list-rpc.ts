export const FILTERED_LIST_DEFAULT_LIMIT = 200;

export type ListRpcParams = {
  sinceMs?: number;
  limit?: number;
};

export function resolveListRpcRequest(input: ListRpcParams): ListRpcParams | undefined {
  const { sinceMs, limit } = input;
  if (sinceMs === undefined && limit === undefined) return undefined;
  return {
    ...(sinceMs !== undefined ? { sinceMs } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

export function listRpcRequestIsFiltered(
  params: ListRpcParams | undefined,
): params is ListRpcParams & { sinceMs: number } {
  return params?.sinceMs !== undefined;
}
