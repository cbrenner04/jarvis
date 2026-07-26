## Verdict — changes required before merge

### Required (blocking)

1. **A spawn that fails or is killed must always settle a pool slot.** `defaultSpawn` (`scripts/run-v2-tests.ts:55-76`) registers only `'close'`. A `nodeSpawn` failure (`ENOENT`, `EAGAIN` under N-way fan-out — the pressure this spec deliberately introduces) emits an unhandled `'error'` and leaves the promise pending forever, permanently consuming a worker with no diagnostic. `spawnSync` folded these into a return value; the transport swap regressed it. Additionally, after a SIGKILL, `'close'` waits for stdio EOF, so a descendant inheriting the pipes can hang the same way. Outcome: every spawn path resolves to a `SpawnOutcome` — a spawn error reported as a failure for that file, and a post-kill grace bound that resolves with whatever was captured. `scripts/ready.ts:369` is the in-repo pattern.

2. **`defaultSpawn` must be covered by tests.** Every case in `scripts/run-v2-tests.test.ts` injects a fake spawn, so the real transport is untested — including subspec 00's central decision that timeout classification comes from the timer that fired, not signal/status inference, plus capture and partial-output-on-kill. A stub that satisfies the contract by construction is not evidence for that AC. Outcome: the real spawn is exercised against a short live child covering at minimum (a) prints-then-exceeds-a-small-injected-timeout → `timedOut: true` with the pre-kill output preserved, and (b) a within-budget kill → reported as a failure, not a timeout. The new error path from item 1 gets a case too.

3. **A malformed explicit concurrency must not silently green the suite.** `resolveConcurrency` returns the explicit argument unvalidated; `NaN` (or a fractional value) propagates to `Array.from({length: NaN})`, producing zero workers, zero results, and `aggregateExitCode([]) === 0` — a passing run that executed nothing. Outcome: a non-positive-integer explicit value cannot yield a run that reports success without running files. (Explicit `0` clamping to serial is acceptable; silent no-op is not.)

4. **`LOAD_SENSITIVE_FILES` must be exported.** Subspec 02 decides "an exported explicit list" and `v2/docs/test-writing.md` documents it as exported; `scripts/test-slice.ts:14` is module-private. The doc currently describes an API that does not exist.

5. **Fix the dangling 320s reference.** `v2/docs/test-writing.md:69` says "the ≤320s figure above was a pre-measurement projection" — this commit deleted the only sentence stating 320s, so the clause refers to nothing. `320` now appears in `v2/docs/` exactly once, in that self-referential clause. Outcome: name it as subspec 01's pre-measurement projection rather than pointing "above".

6. **Confirm the follow-up issue exists.** Both `v2/docs/test-writing.md` and the runbook hard-link cbrenner04/jarvis#2181, and subspec 03's second AC depends on it being a filed harness-friction issue. It could not be verified from this environment (`gh` blocked). Outcome: confirm #2181 exists and covers the `TEST_STEP_BUDGET_MS` / `DEFAULT_TIMEOUT_MS` re-sizing; if not, file it and correct the links — two docs must not point at a dead number.

### Required (wording, same pass)

7. **Runbook over-attributes 326s.** `v2/docs/operator-runbook.md:410` presents 326s as what "the gate's test steps run against", but the same section describes `JARVIS_READY_TEST_SCOPE` scoping most gate runs to a slice subset. The number is right, the attribution isn't — state it as the aggregate `bun run test` figure (what a full-scope gate runs; scoped runs are a subset).

8. **Don't imply the integration slice gets faster.** `test-writing.md` § Bounded concurrency pool says `test:v2` and `test:integration:v2` inherit the pool, but every file in the integration slice matches the suffix convention and therefore runs isolated — the pool is vacuous there. Subspec 01 states this explicitly ("does not gain wall-clock benefit from pooling"); the doc dropped it. Restore one sentence.

### Optional / follow-up (not blocking)

- Loosen two over-tight parity assertions in `test/test-slices.test.ts`: `toContain("stopAdmitting = true")` pins a local variable name, and `.toBe(2)` on a `runV2TestFiles(` call-site count is gratuitously exact. Keep the source-literal pattern; it is the house convention and subspec 01 decided to update rather than delete it.
- The measured 326s mean sits well above the doc's own ≈267s theoretical floor; a sentence noting the floor model under-predicted (and citing runs 2–5, ~324.5s, as the warm reference) is worth more than the floor arithmetic as it stands.
- On a red suite, *which* pooled files ran is now nondeterministic and `FileResult[]` carries no "not run" marker, so `agent` mode reports a nondeterministic subset. Behavior is spec-consistent (subspec 01 explicitly preserved fail-fast); one sentence in § Stop semantics would make it honest.
- Unbounded output capture and a guard that explicit-list entries name real files are genuine hardening but carry no spec obligation — file as issues.

### Rationale

Items 1–3 are correctness defects in code the spec introduced: a hung pool slot, an untested core AC, and a configuration path that can report success without running tests. Items 4–8 are literal mismatches between shipped docs/spec decisions and the code — the class of defect that makes documentation actively misleading rather than merely stale.