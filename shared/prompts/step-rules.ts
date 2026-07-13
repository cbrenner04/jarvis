/**
 * The terminal-token contract every write-loop step prompt carries. Lives in `shared`
 * because both the v1 patch prompt and the v2 write loop render it — v1 must not import
 * from v2.
 */
export const DEFAULT_WRITE_STEP_RULES =
  "The final line of your response must be exactly one of: done, no-work, blocked, progress, with nothing after it.\n" +
  "done and no-work end the step. Use progress when work remains and you are not stuck. Use blocked when stuck; record the blocker where your mode's rules require.";
