/** Revision stepId scheme for `revise`: `${repeatStepId}~r<n>`, n starting at 1. */
export function revisionStepId(repeatStepId: string, n: number): string {
  return `${repeatStepId}~r${n}`;
}

/** Extract `n` from a `${repeatStepId}~r<n>` stepId; null if it doesn't match that scheme. */
export function parseRevisionNumber(stepId: string, repeatStepId: string): number | null {
  const prefix = `${repeatStepId}~r`;
  if (!stepId.startsWith(prefix)) return null;
  const n = Number(stepId.slice(prefix.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Next revision number to spawn: highest existing `~r<n>` among `stepIds` plus one, starting at 1. */
export function nextRevisionNumber(stepIds: readonly (string | null | undefined)[], repeatStepId: string): number {
  const numbers = stepIds
    .map((stepId) => (stepId ? parseRevisionNumber(stepId, repeatStepId) : null))
    .filter((n): n is number => n !== null);
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}
