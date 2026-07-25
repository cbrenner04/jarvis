## Verdict: changes required

The daemon-side predicate, branch, and reconstruction are sound and correctly scoped. Two blocking gaps and several parity/observability gaps must be closed.

### Blocking

**1. Resume must commit the operator's fix before verifying and publishing.**
The inline workflow publication tail runs the completion committer *before* `publishWithReadyRepair`; `resumeReviewPublicationTail` calls `publishWithReadyRepair` directly. Inside that function the only commit is on the ready-gate-repair branch, which a surviving-mutation failure never reaches, and mutation verification diffs `baseRef...HEAD` — so uncommitted coverage fixes are invisible. The exact operator loop the intent describes (fix coverage → `jarvis run resume <review-row>`) re-fails identically unless the operator hand-commits first. Required outcome: the resumed tail commits pending worktree changes under the same rules/idempotency as the inline path before re-verification and publication, so a resume after a real coverage fix reaches `complete`. This is what the subspec decision ("commit, push, and PR refresh follow existing finalizer/idempotency rules") already binds; document it, don't work around it.

**2. The executed publication tail must have real test coverage.**
Every current test injects `reviewPublicationTailExecutor`, and the stub itself writes the `loop_finished {complete, resumable:false}` record and sets `completed` — the assertions read back the stub, not the production path. `resumeReviewPublicationTail` has zero direct coverage. AC1's "finalization completes … on the same publication-tail resume code path" and AC2's write-step non-invocation are therefore not actually satisfied (`pendingCount() === 0` is trivially true when the tail never runs). Required outcome: add tests that drive `resumeReviewPublicationTail` itself with fake publisher/committer/finalizer seams, covering success, publication failure, and the `ready_flip_failed` status branch, and asserting the commit-before-publish ordering from item 1 and that no write-step agent invocation occurs. Existing daemon RPC-level tests may stay as branch coverage. Re-verify the AC ticks against the strengthened tests.

### Also required (inline-path parity)

**3. Resume telemetry must not go dark.** The reconstructed input carries no log sink, state store, signal, or operator session id, so a ready-gate repair during resume emits `iteration_started` / `boundary_committed` / `ready_gate_repair` into nothing and `jarvis run log` shows a silent gap. Wire the same context the production write executor injects.

**4. Iteration budget must not silently reset.** Passing `iterationsConsumed: 0` hands ready-repair a fresh full budget, unlike the inline path. Carry forward the row's real consumed count (or explicitly justify a bounded repair budget in the subspec decisions).

**5. PR body must not regress.** The inline path sets `specTemplate` + `deriveSpecRunBodySummary` for the implement role; the resume tail passes neither, so `refreshPrBody` rewrites without the spec summary. Derive the same fields from the reconstructed completion step.

**6. A thrown tail must still settle a boundary.** There is no try/catch around the resumed tail, so a throw sets `failed` with no `loop_finished` record — `jarvis run wait` sees no boundary. Mirror the inline path's terminal-record-on-throw behavior.

### Documentation

**7.** Note that a publication-tail resume is not pausable/killable (`pause`/`kill` return `run_not_active` while it holds the `(project, branch)` claim) — consistent with the existing workflow variant, but currently undocumented for this path.

**8.** `daemon-host.md`'s `wait` row still reads as if these rows force `resumable: false` via unsupported-write-context; add a clause covering the newly-supported review row.

**9.** Record the reconstruction limitations as caveats (no code change expected): completion-step selection ignores `durable` and cannot honor `publishCompletion: false` because that field is absent from the workflow snapshot; landed-spec-path handling is untested outside implement workflows. Prefer `snapshot.creationTitle` as a fallback when the row's title is absent.

### Rejected

The entry-id refusal test is correct as written: under v2 semantics the workflow entry run id *is* step 0's run id, so resuming the implement row and asserting `terminal_run` matches the intent's observed refusal. No change needed.