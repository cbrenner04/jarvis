## Verdict: refine before merge

The 00/01 split, core contracts (structured records, `runId` key, optional sink, tail/follow only, deferred retention/medium), and behavior-preserving AC citing `write-loop.test.ts` are sound. The draft is not merge-ready: several emission and payload contracts are unstated or under-tested relative to existing loop behavior.

### 00 — Log event model, sink, and reader

1. **Pin payload field types in the event vocabulary table** — `boundary_committed.outcomeKind` and `runStatus` must align with existing `OutcomeKind` / `RunStatus`; `loop_finished.loopOutcomeKind` must align with `WriteLoopOutcomeKind`. The mapping for terminal steps must match `terminalMapping` in `write-loop.ts`, not a new taxonomy.

2. **Pin `seq` and `ts` contract** — State starting value (0 vs 1) and that `ts` is ISO-8601 on every record. Interleaved-run ordering AC implies `seq` but does not pin format or origin.

3. **Pin sink lifecycle** — Minimal contract for open/close (or stateless append), idempotent close if applicable, and whether `follow` survives writer close. Rules out ambiguity vs state store's explicit `close()`.

4. **Pin empty/unknown `runId` behavior** — `tail` and `follow` return an empty stream, not an error. Matches state-store posture for unknown IDs.

5. **Pin single-writer assumption** — One writer per `runId` on the sink; concurrent append from multiple writers is out of scope. Write loop is the only appender in 01.

6. **Rule out orchestration-store colocation** — Log stream is a separate injectable artifact, not rows in `v2.sqlite`, even if implementation uses SQLite on disk elsewhere. Aligns with Persistence bullets in `v2-architecture.md`.

7. **Deferred to first consumer: cross-process `follow` wake** — Pin in Phase 3 daemon refine before daemon tail ships. In-process proofs in 00 suffice for this slice.

### 01 — Write loop emission

8. **Pin soft-stop emission shape** — Budget soft-stop calls `setRunStatus` only; no terminal `boundary_committed`. Last boundary before soft-stop is progress with `runStatus: "in-progress"`. Terminal visibility is solely `loop_finished` (`loopOutcomeKind: "budget-exhausted"`, `resumable: true`). AC must assert no terminal boundary on soft-stop and that the preceding boundary matches progress.

9. **Pin abort/cancellation emission** — Abort checked at iteration top (before `iteration_started`). Mid-step abort completes the in-flight step, commits progress boundary, then exits on next iteration check with `kind: "progress"`. Expected: paired events for completed iterations + `loop_finished`; no orphan `iteration_started`. Add AC mirroring `cancellation propagates via AbortSignal`.

10. **Pin mid-boundary rollback emission** — Distinct from kill/crash resume: `iteration_started`, failed boundary (no `boundary_committed`), retry with same `attemptId`, then success boundary. Add scenario + AC or explicit defer with owner; omission is a real gap given `write-loop.test.ts` coverage.

11. **Clarify idempotent terminal re-entry** — Zero events of any kind, including no `loop_finished`. Decision text "no new iteration events" is ambiguous; AC "without appending new log events" is correct but decision should match.

12. **Pin duplicate `iteration_started` + same `attemptId`** — Expected on kill/crash resume and mid-boundary retry, not a dedup key.

13. **Pin append failure policy** — `append` throws propagate; loop aborts. Logging must not silently drop boundary visibility. Rules out best-effort swallow.

14. **Expand terminal-outcome AC coverage** — Current four scenarios miss distinct `WriteLoopOutcomeKind` payload shapes. Require AC coverage (parameterized or per-kind) for: `blocked`, `contract_miss`, `invocation_failure`, `no-work` terminal (`outcomeKind: "no-work"`, `loopOutcomeKind: "complete"`), and terminal `boundary_committed` + matching `loop_finished` payloads. Without this, 01 can pass while mis-emitting on common terminals.

15. **Add soft-stop resume continuation AC** — Second invocation on same `runId` appends new events to the existing stream without idempotent suppression. Mirrors `a budget-soft-stopped run resumes with a fresh per-invocation budget`.

16. **Widen architecture doc update** — Beyond replacing Interface "Logs need improvement": (a) Recovery — observability stream is not a recovery source; resume still derives from state store; (b) Persistence — logs stay out of orchestration store; (c) note that `follow` replays from the beginning (no offset/cursor API); consumers filter post-hoc via `seq`.

### Rationale

- Intent makes event shape the load-bearing interface; unstated payload types and emission gaps let implementers diverge from existing loop semantics (`terminalMapping`, soft-stop path, abort timing, mid-boundary retry).
- Spec guidance requires behavioral ACs backed by observable outcomes; 01's selected scenarios are representative but do not cover all distinct terminal kinds already exercised in `write-loop.test.ts`.
- `v2-architecture.md` Recovery and Persistence sections currently contradict an observability-only log stream if Interface alone is updated.
- Deferred medium and cross-process follow are acceptable for 00/01; the refinements above pin what this slice must settle vs what Phase 3 owns.
