/** Abort check at write-execution seams; the message is the one operators see in `invocation_failure` detail. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("write execution aborted");
}
