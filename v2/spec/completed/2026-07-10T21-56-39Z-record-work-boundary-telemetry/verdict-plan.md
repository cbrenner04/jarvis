## Verdict: Refine before implementation

The spec's core sourcing mechanism is under-specified at two of its three publish sites, and its "exactly one row" contract is unachievable across crash/resume. Six upheld refinements follow; one adversary concern (join-via-`run_id` documentation) is declined.

### Required refinements

**1. Name the mechanism that threads the stamped join keys to every emission site.**
Subspec 01 sources `attempt_id`/`outcome_kind`/`run_status` from "the values stamped at that boundary's `commitCompletionBoundary`." That co-location exists only at the fresh-complete path. At the workflow publish site the commit is published once at the workflow level where only `WriteLoopResult` is in scope (which carries `runId`/`commitSha`/`completionAgent` but not `attemptId`/`outcomeKind`/`runStatus`), and the resume-republish path reconstructs a result that deliberately drops those fields. The spec must choose and state how these keys reach the emit point (e.g. extend the write-loop result to carry the stamped values, mirroring how subspec 00 extends the commit result with `filesChanged`, and populate them on the resume path). Without this, the headline decision is not implementable at 2/3 sites.

**2. Address the resume-republish emission and relax the "exactly one" contract.**
The resume path republishes a real commit, so by the intent's own rule ("one row per boundary that produces a harness commit") it is an in-scope emission site the spec never confronts. With an append-only sink and no dedup key, exactly-once is unachievable: a crash between boundary-stamp and publish loses the row (resume is the only emit chance), and a crash after emit-but-before-return duplicates it on resume. The spec must either weaken the AC to at-least-once (consistent with telemetry being best-effort and append-failure already tolerated) or specify an idempotency mechanism. As written, "appends exactly one row" is a contract the architecture cannot keep.

**3. State the emission-suppression condition.**
"Defaults to `~/.jarvis/telemetry.jsonl`" read literally makes a bare write-loop invocation (including existing tests) write the operator's real home file. The spec must state that boundary emission is gated — emit only when a telemetry block with `sinkPath` is attached — matching how invocation telemetry is opt-in. This is load-bearing for test safety, not cosmetic.

**4. Decide the sink-extension approach to avoid a shared-layer leak.**
`work_boundary_recorded` is a v2-only record kind; the injectable sink type lives in `shared/`. The task bullet "extend `telemetry-sink.ts` / the injectable sink" is ambiguous about whether the shared union widens to admit a v2 concept — which `shared/**` must not import v2 forbids. The spec must pin a clean-layering approach (a v2 boundary-sink builder or a generic path-append helper) rather than widening the shared type.

**5. Say which step's boundary supplies the values for multi-step workflows.**
A workflow has multiple write steps and publishes once. "That boundary's `commitCompletionBoundary`" implies a single stamp when there are several. State that the values come from the publishing step's attempt. This largely dissolves once refinement 1 threads the stamp onto the result, but the spec should say so rather than leave "that boundary" to interpretation.

**6. Pin the `filesChanged` diff invocation (no rename detection).**
Since the count is a reviewable telemetry fact, its value must be deterministic. Rename detection changes the count (1 vs 2). Subspec 00's AC should nail the exact diff semantics — plain name-only tree diff, no `-M` — so the number is reproducible.

### Declined

- **Join via `run_id` / `operator_session_id` omission.** Not a defect. The omission is deliberate and attempt-grain; `telemetry-capture.md` already documents that operator roll-ups join through `run_id`. No spec change needed.

### Rationale

Refinements 1–2 are load-bearing: they concern the spec's central sourcing decision and a stated AC the architecture cannot satisfy — precisely the "invented precision that the first consumer disproves" failure the guidance warns against. 3–4 protect test safety and the `shared/**` layering rule in AGENTS.md. 5–6 make named telemetry facts deterministic and unambiguous. Subspec 00's return-site enumeration and resume-stable count decision are otherwise sound and need no change beyond refinement 6.