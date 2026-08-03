# Verdict: required refinements

## 1. Settlement mirroring acceptance must pin the real failure path

Subspec 00’s mirroring criterion must require the full composed operator error from a settled entry run with terminal log context—not only `reason` and `nextAction` on a minimal stub. Include resumability (`retryable: true` for `completion_commit_failed` / `resume`). Task checklist must state that settlement uses terminal log context when calling `composeRunOperatorError`, matching the production bug the intent describes.

**Why:** Intent forbids generic `harness_failure` when the run carries operator detail; baseline only maps `completion_commit_failed` with `loop_finished` context. Narrow ACs can pass without fixing the bug.

## 2. Anchor every `@mutate` checkpoint with a concrete directive

Each mutation-checkpoint AC must have a pre-identified `// @mutate` directive in the task checklist that targets text occurring exactly once in the named file. Required for:

- **Mirroring (00):** baseline has no separate mirroring guard—the directive must neuter terminal-log wiring or equivalent, not a nonexistent guard.
- **Live window (00):** directive must invert dispatch ordering (e.g. terminalize before `wait` resolves).
- **Live guard (01):** directive must target the shared live-link guard once introduced.

**Why:** Spec guidance refuses criteria whose mutations leave the suite green or lack linked directives.

## 3. Define “still-live entry run” in subspec 01

Subspec 01 decisions must state the liveness predicate used in tests and guards (e.g. loaded run status is in-progress, aligned with how dispatch `wait` treats settlement). Without this, execution tests may encode the wrong contract across multiple writers.

**Why:** Execution has several stage-row patch sites; “still-live” is operational, not structural like dispatch’s `await wait`.

## 4. Broaden subspec 01 acceptance to match overwrite decisions

While `workflowInvocationId` names a still-live entry run, the stage row must remain `running` with linkage and timestamps intact—no premature `failed`, no `endedAt` (addressing `startedAt == endedAt`), no clearing or replacing `workflowInvocationId`, and no other terminal overwrite.

**Why:** Decisions forbid terminalize **or overwrite**; AC that only forbids `failed` allows violations that match the reported incidents.

## 5. Pin the motivating incident in subspec 01 tests

Add at least one execution regression shaped like the fan-out failure: admitted entry run still live (deferred settlement), stage must not terminalize or stamp terminal timestamps until that run settles. Distinguish post-admission linkage from pre-run refusal (`worktree_claimed` with no linkage).

**Why:** Generic live-guard tests can pass without closing the fan-out / stale-invocation hole the intent describes.

## 6. Name execution writers (or carve out) for the live invariant

Subspec 01 must clarify which stage-row mutation paths honor the live-link invariant—e.g. progression, fan-out continuation, stranded/reconciliation, throw handlers—or explicitly carve out paths that may still terminalize with rationale. Task checklist should reflect that scope.

**Why:** “Guard execution paths that patch stage rows” is broad; unlisted writers leave gaps the decisions already forbid.

## 7. Make PR #2555 test lift actionable

Subspec 00 task checklist (or intent prerequisites) must list which linkage/settlement cases to port from PR #2555 (by test name or scenario) and explicitly exclude that PR’s subspec directory.

**Why:** Intent references #2555 as prior art; without a lift list, implementers risk duplicate or missed regressions.

## 8. Align verification gates across subspecs

Reconcile intent’s five commands (`typecheck`, `check`, `lint:md`, `test:v2`, `test:integration:v2`) with per-subspec ACs. Subspec 00 edits `daemon-host.md` but omits `check` and `lint:md`; subspec 01 carries the full set. Either add doc-appropriate gates to 00 or document that full gates run only on 01, without leaving 00 completable below intent’s bar.

**Why:** Misaligned gates let subspec 00 finish with unlinted docs and unchecked harness constraints.

## 9. Fix documentation ownership between subspecs

Subspec 01 operator-runbook update must cover only “a `failed` stage never names a live invocation.” Failure-detail mirroring belongs in subspec 00 / `daemon-host.md` (or cross-reference 00). Remove mirroring claims from 01’s doc tasks unless scoped as a cross-reference.

**Why:** Mirroring is implemented at dispatch settlement (00), not execution progression (01); split docs avoid wrong or duplicate guidance.

---

## Not required

- **Split subspec 01** — single module boundary with one shared invariant is acceptable; no index split unless implementation discovers unrelated surfaces.
- **Integration-scenario failing-test AC** — full `test:integration:v2` gate on 01 is sufficient if unit regressions and `@mutate` checkpoints pin guards.
- **Subspec 00 as sole fix for fan-out stale linkage** — 00/01 seam is correct; 00 owns dispatch settlement and linkage identity, 01 owns execution premature terminalization. Clarify in scope text if helpful, not a structural change.
- **`derivePipelineState` / wait-on-`running` behavior** — correctly out of scope per intent.