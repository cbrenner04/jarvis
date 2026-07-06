/** Stubs `crypto.randomUUID` for the duration of `fn`. A single id repeats for every call;
 * an array is consumed in order, throwing once exhausted. */
export function withFixedUuid<T>(idOrIds: string | string[], fn: () => Promise<T>): Promise<T> {
  const queue = Array.isArray(idOrIds) ? [...idOrIds] : undefined;
  const originalRandomUuid = crypto.randomUUID;
  crypto.randomUUID = () => {
    if (queue) {
      const next = queue.shift();
      if (next === undefined) throw new Error("no more fixed UUIDs");
      return next as `${string}-${string}-${string}-${string}-${string}`;
    }
    return idOrIds as `${string}-${string}-${string}-${string}-${string}`;
  };
  return fn().finally(() => {
    crypto.randomUUID = originalRandomUuid;
  });
}
