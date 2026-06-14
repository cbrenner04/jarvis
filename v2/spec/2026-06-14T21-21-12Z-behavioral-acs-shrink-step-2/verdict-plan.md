## Verdict — required refinements

### Subspec 00 (behavioral acceptance criteria)

1. **Plan review prompt targets** — Tasks and acceptance criteria must name the live debate/actuator surfaces (`plan.prompt.review.adversary`, `plan.prompt.review-actuator`, and adjudicator only if verdict language needs it), not `prompts/plan/review.md`. `review.md` is registry/fixture-only; criteria pointing at it will not run. Rationale: review enforcement is load-bearing; wrong target is a silent no-op.

2. **Product vs harness AC distinction** — `spec-guidance.md` and draft prompt examples must state that behavioral-AC rules apply to target-repo product specs; harness subspecs may name hooks, telemetry fields, and internal symbols when structure is the contract. Rationale: without the distinction, review actuators will over-correct valid harness criteria (self-consistency gap in the draft).

3. **`plan.prompt.refine`** — No refinement required; omission is deliberate unless measured escape rate warrants it.

---

### Subspec 01 (post-completion shrink step)

4. **Contract-miss definitions** — Decisions (or acceptance criteria) must operationalize:
   - **AC regression:** any criterion checked pre-shrink becomes unchecked post-shrink (checkbox state only; prose edits are spec-tree revert, not regression).
   - **Deleted test:** path under shrink scope with deletion status on repo test paths (e.g. `*.test.ts`).
   Rationale: “AC intact” and “no deleted test” are asserted but not verifiable without these definitions.

5. **Shrink scope algorithm** — Decisions must pin: accumulate paths from implementation iterations (`patch_phase` implementation or unset/default); exclude harness-only commits (checkbox, `check:fix`, PR-body); exclude spec-dir paths from allowlist (handled by read-only revert); enforce via post-invocation revert of out-of-scope edits, not prompt honor system. Rationale: “union of implementation touches” is directionally correct but not implementable as written.

6. **Run-summary parity** — Add task + acceptance criterion: `patch_phase: "shrink"` excluded from implementation iteration counts in `patchIterationsCompletedForSummary` and run-summary (`isImplementationAttempt`), mirroring `"review"`. Rationale: shrink rows would inflate implementation counts and affect `shouldRunReview` gating (`> 0` check); telemetry AC alone does not cover summary behavior.

7. **Shrink prompt assembly** — Decisions must state assembly follows patch-mode patterns: run-scoped diff (not full branch), explicit file allowlist, spec-tree read-only instruction, inject `patch.prompt.shrink` + `global.terse`, do **not** inject `patch.rules`. Register id `patch.prompt.shrink`; doc cross-links use that id, not `patch.shrink`. Rationale: checklist file alone does not define agent context; `patch.rules` conflicts with simplification objective.

8. **Pre-shrink ready gate failure** — Decisions must pin: `bun run ready` failure skips shrink with a logged warning and continues to review/`maybeMarkReady` — not fatal like review baseline. Rationale: optional cleanup must never gate an already-complete spec.

9. **All shrink agent failures** — Decisions must pin: any unsuccessful shrink invocation (quota exhaustion, timeout, spawn error, contract miss) discards worktree changes and continues; shrink discard never elevates run exit code. Quota rotation within the single invocation remains deferred to wiring. Rationale: intent principle extends beyond contract miss; without this, shrink failures could block completion paths.

10. **Re-run / resume semantics** — Record as `Deferred to first consumer: re-run shrink on already-complete spec — pin when resume/re-run semantics are exercised.` Default: once per completion transition per run session, not on every re-invocation against a complete index (mirror review). Rationale: valid gap; default is inferable but should be explicit deferral, not silent omission.

---

### Not required

- **Subspec 01 split** — One cohesive post-completion phase; `00`/`01` already separates authoring from runtime.
- **Operator disable knob** (`--shrink-passes 0`) — Intentionally omitted for v1; `git: false` suffices for debugging.
- **Operator messaging order** — Cosmetic; optional banner prefix only if actuator wants it.
- **`plan.prompt.refine`** — See item 3.
- **`PatchTelemetryPhase` type extension** — Implied by implementation; run-summary exclusion (item 6) is the real gap.
