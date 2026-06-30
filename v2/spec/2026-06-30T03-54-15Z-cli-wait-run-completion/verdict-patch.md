# Adjudicator verdict — CLI wait run-completion

**Disposition:** Approve with minor hardening. Implementation satisfies the refined subspec and all acceptance criteria; no behavioral or contract defects block merge.

## Required outcomes

1. **Stdout shape must be regression-locked for `loopOutcomeKind`-omitted resolves.** At least one exit-matrix case (e.g. `{ runStatus: "failed" }`) must assert the printed line is a single minified JSON object containing only `runStatus` (no `null` placeholders, no extra keys). Rationale: decisions and the stdout AC require omitting absent optional fields; current matrix tests lock exit codes only, so stdout serialization could regress undetected.

2. **`v2/docs/write-behavior.md` Verification section must include `jarvis run wait`.** Add `jarvis run wait` blocking, exit mapping, and error pass-through to the existing `cli.test.ts` bullet. Rationale: operator doc already documents wait semantics; Verification still lists only foreground `write`, lifecycle, run-control, and log streaming — stale relative to delivered coverage.

## Not required (deferred or defended)

- **Daemon disconnect during an in-flight `wait`:** Pre-existing IPC `request()` behavior; subspec scopes unbounded block and reuses run-control connection errors. Belongs in a separate IPC-hardening slice, not this merge.
- **Strict `loopOutcomeKind` / `runStatus` enum validation → `invalid daemon response`:** Matches malformed-payload AC and sibling run-control verbs; co-versioned daemon/CLI coupling is intentional.
- **Additional precedence rows, quiescent `budget-exhausted` immediacy test, `run_execution_failed` naming, broader malformed variants, whitespace-only run ID handling, `intent.md` lifecycle wording:** Optional polish or outside this subspec’s Documentation updates; uniform precedence rule and existing matrix/quiescent tests already govern behavior.
- **`exitCodeForWriteResult` reuse, daemon type import, extra-args usage, blocking-test depth:** Consistent with spec intent and sibling patterns; ACs met.
