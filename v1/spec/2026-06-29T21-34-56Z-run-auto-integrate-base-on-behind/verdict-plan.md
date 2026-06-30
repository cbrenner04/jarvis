## Verdict — required refinements

Core design is sound and matches intent (PR #773: conflict-free behind-base should merge, re-gate, push, ready; conflicts and gate failures stay draft). Before implementation, the spec must close these gaps:

### Call-site semantics

1. **Pin no-shrink/no-review double `maybeMarkReady`.** On the path where `iteration.ts` calls `maybeMarkReady` and completion-pipeline follows in the same invocation, the spec must state observable behavior: either skip the iteration call when completion-pipeline will run, or otherwise guarantee at most one behind-base block stderr and one auto-integrate attempt. Default `autoIntegrateBase: false` on the first call makes spurious blocked stderr likely today.

2. **Resolve `review-incomplete` in or out.** Intent targets nominal final completion flip; the subspec also enables `review-incomplete`. Pick one: include with explicit decision + behavioral AC, or limit `autoIntegrateBase: true` to `patch-complete` and review-final only. Silent inclusion is scope creep.

3. **Add review-final behavioral ACs.** Review-success completion flips via `review.ts` behind-base branch, not `maybeMarkReady`. Mirror success / conflict-abort / gate-failure-reset outcomes for that path (same contract as `maybeMarkReady` + `autoIntegrateBase: true`).

### Failure and push semantics

4. **Decision: publish merge commit when gate is clean.** After conflict-free merge + `full` gate, the harness must push the integrated tree even when the gate made no fix/post-verification commits (`runReadyAndCommit` only pushes on those commits today). Without this, merge commits can stay local while `gh pr ready` runs.

5. **Decision: post-gate-failure recovery is local-only.** On merge conflict or post-merge gate failure: abort/reset local tree to pre-merge `HEAD`, emit today's blocked stderr, leave PR draft, do not throw. If gate failure occurred after partial push, do not force-push remote back; state that remote may retain pushed integration while PR stays draft.

6. **Decision: `gh pr ready` failure after successful integrate does not throw.** Match existing behind-base guard contract (warn/return, draft PR, integrated branch may be pushed).

7. **Pre-merge dirty tree (lower priority, still required).** State whether merge is attempted only on clean porcelain, or dirty pre-merge blocks without merge attempt. Avoids lossy `reset --hard` on actuator residue.

### Tests and acceptance criteria

8. **Cite preservation/replacement tests, don't paraphrase.** Replace `review final leaves PR draft when branch is behind base` anchor with new success-path coverage while preserving conflict/gate-failure block behavior. Cite `blocks ready flip when branch is behind base` (plan) and triage behind-base `--mark-ready` tests as preservation anchors per spec-guidance.

9. **Pin new auto-integrate coverage in ACs.** Behavioral ACs for merge+gate+ready, conflict abort, and gate-failure reset must cite new tests so criteria cannot be ticked without automated guards.

10. **Cross-path parity AC (optional but recommended).** Review-final and `maybeMarkReady` with `autoIntegrateBase: true` produce identical behind-base outcomes, or cite paired tests.

### Documentation

11. **Reverse fail-fast-before-gate for enabled paths.** `v2/docs/v1-behaviors.md` documents guard-before-gate to skip wasted work. Auto-integrate intentionally merges then gates at completion-pipeline + review-final (and review-incomplete if kept). Doc tasks must state this reversal explicitly in `run-loop.md` and `v1-behaviors.md`.

12. **Operator-runbook alignment.** Beyond removing the concurrency caveat (line 192): state conflict-free behind-base auto-integrates at patch-run completion; manual Integration-merge-then-retest remains for conflicts; manual `--no-commit` trial merge unchanged vs harness auto-path committing on conflict-free merge; consistent wording wherever behind-base finalize is described.

13. **Deferred to first consumer: merge commit message/trailer** — pin when helper is drafted.

### Not required

- New subcommand, triage/plan changes, fetch soft-fail behavior, single-subspec split, shared-helper + dual-wire architecture.
- Optional `## Prerequisites` repeat (prerequisite behavior exists in shipped guard spec).
- Diverged-as-behind operator note (optional one-liner only if docs mention BEHIND narrowly).
