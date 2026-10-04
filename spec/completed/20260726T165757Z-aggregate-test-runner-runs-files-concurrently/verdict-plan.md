## Verdict — refinement required

### Blocking

**1. The agent-mode contract in subspec 00 (and the intent) is factually wrong.**
Today's runner returns on *any* non-zero exit status in every mode (`scripts/run-v2-tests.ts:72-74`); only the timeout path branches on mode (`:66`). The existing test `scripts/run-v2-tests.test.ts:96` pins this: agent mode over `["failing.test.ts","ok.test.ts"]` asserts only the first file is spawned. The spec's AC "agent mode reports every failing file across concurrent workers" cannot coexist with "existing cases stay green." Settle this: preserve fail-fast-on-failure, scope the continue-and-report-all guarantee to timeouts (the actual agent-mode contract), and write the preserved half as a preservation AC citing that test. Widening agent mode to run the whole roster past a red file is a separate policy change with gate-budget consequences — if wanted, name it as out of scope, not as an AC here.

**2. The aggregate's integration phase bypasses the seam the spec changes.**
`scripts/run-tests.ts:29-36` runs the integration files in its own `for` loop with a bare `spawnSync` — no timeout, no injected seam. That phase is ~158.7 s of the 574 s roster (28%). Subspec 00's "concurrency lands in the shared seam so everything inherits it" is true for `test:v2`/`test:integration:v2` and false for `bun run test`, which is the only thing the intent targets. The spec needs an explicit decision plus an acceptance outcome routing that phase through the concurrent runner (or an explicit, justified exclusion with its wall-clock cost stated).

**3. The wall-clock floor and the default-limit derivation are mis-derived.**
The floor is not the slowest file. With sandbox-unrunnable files serialized (158.7 s) plus the pooled remainder (407.9 s) and a slowest pooled file of 108.8 s (`v1/test/run.test.ts`), the floor is ≈ 158.7 + max(407.9/N, 108.8) ≈ **267 s**, and the pooled phase stops improving at N≈4. "Half of `availableParallelism()`" (9 on this box) is therefore past the knee, and the decision's stated rationale doesn't hold. Correct the arithmetic, re-derive (or re-justify) the default limit against it, and replace "materially below the 697 s baseline" with a concrete target number — as written, 650 s passes.

**4. Subspec 00 is oversized (fifteen decisions, twelve ACs) and has a genuine split.**
Split into two independently implementable and independently verifiable subspecs, both linked from `index.md`:
- **(a) Async seam + captured, per-file-attributed output — still serial.** Behavior-preserving, pinned by the existing `run-v2-tests.test.ts` cases plus a new attribution test.
- **(b) Bounded pool.** Limit derivation/override, `aggregateExitCode` from any failure rather than the last result, stop-by-not-starting with in-flight results reported, `test/test-slices.test.ts` literal-parity updates. Finding 2's `run-tests.ts` routing rides here or becomes its own small subspec.

Every original decision and acceptance outcome in current 00 must appear exactly once across the replacements — no dropped items, no duplicated ones. Do not solve this by compressing prose.

**5. Two ACs are unverifiable from the implement agent's worktree.**
The measured `bun run test` wall clock and the five-consecutive-run stability bar both require the operator's real machine, and the aggregate roster includes sandbox-unrunnable files that cannot run in the agent's sandbox at all. Mark both `(Manual)` per the human-only convention, or they strand the run at `blocked`.

### Should fix

- **Predicate naming.** `isSandboxUnrunnable` is the slice-partition key (`scripts/test-slice.ts:4-8`); overloading it as the load-sensitivity signal makes a future per-file graduation impossible. Introduce a distinct load-sensitivity predicate that defaults to including the suffix set, documented as preserving today's serialization for those files. (Note the suffix rule regresses nothing — those files already run serially in both paths — so the cost is opportunity, not regression.)
- **Shared-resource collisions are an unaddressed failure class.** The flake analysis is entirely CPU-framed; concurrent files can now collide on fixture paths, `$TMPDIR`, `~/.jarvis`, and ports — a class serial execution never exposed. One decision naming the class and pointing at the load-sensitive list as its absorber is enough.
- **`v1/test/run.test.ts` (108.8 s) is the floor-setter**, is not sandbox-unrunnable so it lands in the pool, and does real git/gh fixture work — the most obvious isolation candidate in the roster, currently unmentioned. Make the call explicitly, including the trade (isolating it pushes the serial tail toward ~267 s).
- **Three-files-vs-two divergence.** The intent names three load-dependent failures; subspec 01 can only name two (the integration one is unnamed). State that as a decision — the convention rule covers the unnamed one — rather than leaving the counts silently inconsistent.
- **Concurrency-knob details:** precedence between the explicit argument and `JARVIS_TEST_CONCURRENCY`, and handling of malformed or `0` values.
- **Partial output on kill.** Today `stdio: "inherit"` gives the operator a killed file's output as it happens; capture-and-flush must not silently drop it when a child is SIGKILLed.
- **Timeout classification.** Inferring a timeout from `signal === "SIGKILL" && status === null` (`run-v2-tests.ts:27-29`) starts misattributing OOM kills under N-way concurrency; classify explicitly from the timer that fired.
- **Subspec 02 doc consistency:** "no file still presents 697 s" contradicts 02's own decision to retain 697 s side-by-side — reword to target the framing (no doc cites it as *current*). And `v2/docs/test-writing.md:54` derives the `JARVIS_READY_TIMEOUT_MS` retry argument from 697 s; 02 must either recompute that sentence or name the owner of the follow-up, not leave "pending re-sizing" unassigned.
- **Gate on a loaded box.** `JARVIS_TEST_CONCURRENCY` is the mitigation; 02's runbook guidance should name it.

### Not required

The concern that a per-settle output flush could trip an idle-output watchdog on the ready gate does not apply: `ready-finalize.ts:179` passes only `maxBuffer` and `env`, and `scripts/ready.ts` has no idle-output concept. The gate already buffers everything, so per-settle flushing is strictly an improvement. One line in the spec recording that no idle bound applies is optional.

### Rationale

Findings 1 and 2 are correctness defects: an AC that contradicts a pinning test, and a decision whose central claim is false for the command the intent targets — both would strand or mislead an implement run. Finding 3 undermines the spec's only quantitative success bar. Finding 4 is the spec-guidance atomicity rule (one commit-sized, independently testable change per subspec). Finding 5 is the agent-verifiable-AC rule.