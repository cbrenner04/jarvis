/**
 * Per-cycle profile context: call function contexts with the pass metadata; stamp
 * plain-object contexts with it. Object stamping is what lets builders emit
 * serializable contexts — the daemon IPC boundary drops function-valued step fields.
 */
export function cycleProfileContext(
  context: unknown,
  passNumber: number,
  priorCycleVerdict: string | undefined,
): unknown {
  if (typeof context === "function") return context(passNumber, priorCycleVerdict);
  if (context !== null && typeof context === "object") {
    return { ...context, passNumber, ...(priorCycleVerdict !== undefined ? { priorCycleVerdict } : {}) };
  }
  return context;
}
