# Verdict

## Required — block on these

**1. Production retries must emit the operator-distinguishable line by default.**
Spec 00 decides the retry notification is "emitted via an injectable callback **defaulting to a `process.stderr` write**," with the explicit purpose of ruling out "a silent retry indistinguishable from a hang." As implemented, the retry callback has no default in either the async chokepoint (`runGhCommand`) or the sync wrapper (`withSyncTransientRetry`), and no production caller supplies one — so every real retry is silent. The acceptance-criteria test passes only because it injects its own callback. **Outcome:** every production retry (async and sync) must emit `harnessGitGhTransientRetryLine` to stderr without a test-supplied callback. The `v2/docs/v1-behaviors.md` line must describe this default-to-stderr behavior, not merely an "injectable callback," so the doc records the intended observable behavior.

**2. The async chokepoint must op-scope its retry line.**
Spec 00 requires `op` to be the gh/git subcommand "so the multi-subcommand chokepoint identifies which call is retrying." The sync `gh pr ready` / `git push` sites pass `op` correctly, but the three async callers (`getBaseBranch`, `postPrComment`, `assertGhReady`) call through with no `op`, so the line degrades to a bare `"gh"`. **Outcome:** those callers must thread a distinguishing op label (e.g. `gh repo view`, `gh pr comment`, `gh auth status`) so retries are operator-attributable as the spec requires. Fix alongside #1 — same emission path.

## Required — correctness/faithfulness gaps

**3. `gh pr comment` lost-ack must not silently duplicate.**
Spec 00 added `postPrComment` to the retried chokepoint but reasoned about lost-ack idempotency only for `gh pr ready`. A transient failure after the comment is server-side accepted will re-post on retry — the same lost-ack shape the `gh pr ready` guard exists to prevent, with no analogue for comments. **Outcome:** the actuator must either guard the comment path against duplicate-on-retry or make a conscious, documented decision to accept the duplicate (it is cosmetic, not a killed run). Do not leave it silently exposed when the spec named it in-scope.

**4. Sync path must classify on captured stderr and `.status`, not the JS error message.**
Decision 01.2 explicitly specifies classifying on "the thrown error's captured `stderr` buffer" with exitCode `= .status ?? -1`, and explicitly "rules out classifying on the generic JS error message." The implementation reads `lastError.message` and a hardcoded `-1`. It happens to be correct today only because the current thunks fold stderr into `.message`. **Outcome:** classify on the error's `.stderr` with exitCode `.status ?? -1` as the decision states, so the contract holds against a future thunk that does not append stderr to its message. Low live risk, but the spec named the robust form specifically.

## Recommended (not blocking)

- **Production-wiring coverage:** the silent-retry and missing-`op` defects (#1/#2) survived because tests exercise the wrappers directly and nothing asserts production call sites route transience through them and emit a line. Add a narrow assertion that a production caller emits a retry line on an injected transient. This is the gap that let #1 through.
- **Dead pattern entry:** `operation timed out` is a strict subset of `timed out` in the harness phrasing list. Drop the redundant entry — consistent with the spec's "grounded, not enumerated for thoroughness" instruction.

Items #5 (attempt-agnostic already-ready guard), #8 (`defaultSleepSync` off-Bun), and #9 (redundant exitCode conjunct) are acceptable as-is; no action.