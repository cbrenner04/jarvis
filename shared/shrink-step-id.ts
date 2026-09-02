export const SHRINK_STEP_ID_SUFFIX = "~shrink";

export function endsWith(stepId: string | undefined | null): boolean {
  return stepId?.endsWith(SHRINK_STEP_ID_SUFFIX) === true;
}

export function strip(stepId: string): string {
  return stepId.slice(0, -SHRINK_STEP_ID_SUFFIX.length);
}
