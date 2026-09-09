/**
 * The contract every write-loop step prompt carries. Lives in `shared` so prompt
 * assembly and the write loop share one source.
 */
export const DEFAULT_WRITE_STEP_RULES =
  "Human-only acceptance criteria contain `(Manual)`, `visual inspection only`, or `no automated guard` anywhere in the full bullet block (the first checklist line and any continuation lines). Recognition uses case-insensitive substring matching; markers need not be trailing or whole phrases.\n" +
  "Do not add `set*ForTest`/`set*ForTests` exports, `invert*ForTest` and `*ForTest`/`*ForTests` module variables, `invert*` function parameters, `*ForTest`/`*ForTests` function parameters, `invert*ForTest` type members, or `*ForTest`/`*ForTests` type members in production code.\n" +
  "The final line of your response must be exactly one of: done, no-work, blocked, progress, with nothing after it.\n" +
  "done and no-work end the step. Use progress when work remains and you are not stuck. Use blocked when stuck; record the blocker where your mode's rules require.";
