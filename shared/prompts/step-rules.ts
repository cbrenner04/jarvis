/**
 * The contract every write-loop step prompt carries. Lives in `shared`
 * because both the v1 patch prompt and the v2 write loop render it — v1 must not import
 * from v2.
 */
export const DEFAULT_WRITE_STEP_RULES =
  "Human-only acceptance criteria contain `(Manual)`, `visual inspection only`, or `no automated guard` anywhere in the full bullet block (the first checklist line and any continuation lines). Recognition uses case-insensitive substring matching; markers need not be trailing or whole phrases.\n" +
  "Guard-inversion criteria require a source mutation on the real guard and a comment checkpoint on the pinning test that names that mutation — production invert hooks are forbidden.\n" +
  'Place `// @mutate` inside the enclosing test body (below the `test("…", …) => {` line). A directive on the line immediately above the `test`/`it` declaration (next physical line, no blank line or intervening comment) is verifier-tolerated but inside-the-body is preferred.\n' +
  "Do not add `setInvert*ForTest` exports, `invert*ForTest` module variables, `invert*` function parameters, or `invert*ForTest` type members in production code.\n" +
  "The final line of your response must be exactly one of: done, no-work, blocked, progress, with nothing after it.\n" +
  "done and no-work end the step. Use progress when work remains and you are not stuck. Use blocked when stuck; record the blocker where your mode's rules require.";
