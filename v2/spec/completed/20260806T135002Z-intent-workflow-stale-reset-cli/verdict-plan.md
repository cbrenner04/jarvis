Validating critical advocate findings against the codebase before issuing the verdict.
## Verdict: refinements required before merge

The spec’s direction—add `intent` to stale-reset membership, reuse shared preflight, export the seam for the pipeline sibling—is sound. The draft is not yet implementable as written: several decision lines assume implement/plan semantics that do not hold for intent, and some acceptance criteria cannot be satisfied or verified against current code.

### 1. Resolve dirty-gate vs poisoned verdict sidecars (blocking)

**Required outcome:** The spec must state explicitly how an incomplete git-enabled intent re-run retires a worktree that carries `.jarvis-intent-review-verdict.md` and its `.owner` sidecar.

**Why:** Those files are untracked in porcelain today and are not gitignored. Adding `"intent"` to `STALE_RESET_WORKFLOWS` routes intent through the same dirty gate as implement/plan; the typical poisoned case therefore swaps `boundaryViolation` at review for dirty-gate refusal unless the spec chooses another path. Intent’s CLI parse options do not currently accept `--reset-despite-dirty` or `--reset-despite-landed-criteria`, so the decision line “when present” is accurate for implement/plan but misleading for intent.

**The spec must pick and record one resolution** (product decision, not left to implementer discovery):

- Wire the same override flags on intent CLI/help/usage, **or**
- Exclude harness `.jarvis-*` sidecars from the dirty gate for stale reset, **or**
- Narrow the stated problem and prove a fixture that is actually porcelain-clean aside from verdict files (only viable if sidecars cease to count as dirty).

Until this is settled, the integration AC (“seed verdict + `.owner`, assert retirement before `start`”) conflicts with “same gates as implement/plan.”

### 2. Resolve landed-criteria gate vs intent `specPath` (blocking)

**Required outcome:** The spec must define what the preserve/landed-criteria gate means for intent when the write step’s `specPath` is a directory (`ready-intents`), not an index-routed spec tree.

**Why:** Production intent steps pass a directory into preflight; `specTreeRelPaths` reads that path as a file and throws. `maybeResetStaleWorkspace` surfaces that as `Stale workspace reset failed`, not a clean gate refusal. Implement/plan integration tests avoid this by mocking steps with `specPath: "index.md"`. An AC that drives production intent wiring without addressing this will fail or force undeclared scope.

**The spec must pick and record one resolution:** skip/N/A when `specPath` is not a spec file or index tree; add intent override flags; or pass a different preflight `specPath`. The choice must be consistent with whether the integration test uses production builders or mocks.

### 3. Fix mutation-checkpoint directive format (blocking)

**Required outcome:** Replace the single-quoted `@mutate` form in the mutation AC with a harness-parseable directive: double-quoted original and replacement per `DIRECTIVE_PATTERN` in `mutation-checkpoint-verifier.ts`.

**Why:** The current AC text is not directive-shaped; the harness will refuse the criterion at completion even if the comment is pasted verbatim. Spec guidance requires a linked, parseable directive with a stable anchor that inverts membership and turns the guard test red.

### 4. Sync `intent.md` with the subspec export decision

**Required outcome:** Mirror the subspec’s fifth decision—that `STALE_RESET_WORKFLOWS` is exported (or relocated) with the seam so membership is directly assertable—in `intent.md`, including the corresponding task.

**Why:** Implementers routed from `intent.md` alone could export only `maybeResetStaleWorkspace`, satisfy integration behavior, and still fail the membership AC. Intent and subspec must agree on the export contract.

### 5. Tighten integration AC to match implement/plan pins

**Required outcomes:**

- Fixture must include a foreign `invocationId` in the `.owner` sidecar (the stated failure mode).
- Assert retirement **ordering**: worktree absent from `git worktree list` and verdict sidecars gone **before** daemon `start` (e.g. via IPC frame/`sent` inspection), not only post-hoc absence.
- Replace “removed and recreated” with implement/plan language: worktree **retired** (absent from worktree list), sidecars gone, `start` proceeds.
- State whether the test uses production `buildIntentWorkflowSteps` or the same mocked-step pattern as implement/plan; if production, items 1–2 above must already be resolved.

**Why:** Existing pins in `workflow.test.ts` under `implement preflight stale workspace reset` are the contract; underspecified intent wiring risks a false-green integration test that never exercises preflight.

### 6. Name the daemon-surface import regression target

**Required outcome:** The AC for “importable outside `workflow.ts`” must name a concrete regression file (e.g. a daemon-surface test or dedicated seam smoke test), not only “a daemon-surface regression import.”

**Why:** Export proof is structural; without a named import site, implementers can satisfy behavior while leaving the pipeline prerequisite unverified. Bundling export with CLI membership in one subspec is acceptable given serial pipeline ordering; the import AC still needs a definite home.

### 7. Clarify mutation checkpoint scope

**Required outcome:** State that inverting `STALE_RESET_WORKFLOWS` membership must turn **both** the exported-set membership assertion **and** the intent integration test red.

**Why:** Membership removal suppresses the preflight early-return; a mocked builder that never calls `maybeResetStaleWorkspace` could false-green the mutation. Align with spec guidance on guard inversion.

### 8. Expand documentation outcomes

**Required outcomes:**

- Operator runbook § Workflow presets (~324): add `intent` beside `plan` for incomplete re-run stale-workspace preflight, including `intent-reviewed` as covered by the same canonical name.
- Operator runbook blocked-run recovery (~995): update prose that currently names only implement/plan as workflows that reset stale worktrees on re-run.
- `v2/docs/v1-behaviors.md`: record intent in the stale-reset workflow set and document intent-specific gate semantics once items 1–2 are decided (override availability, sidecar dirty treatment, or landed-criteria N/A).
- Record that stale reset applies only to **git-enabled** intent re-runs (`worktree.git === false` no-ops), consistent with the pipeline sibling.
- Until dirty/override semantics are resolved, document that `jarvis cleanup --abandon` remains the manual fallback when automatic re-run reset is refused—do not imply re-run alone always clears poisoned verdict trees.

### 9. Optional but low-cost

A one-line prerequisite citing landed `resetStaleWorkspace` / claim-before-reset / dispatch-scoped retirement behavior would reduce implementer archaeology; not blocking if empty prerequisites remain allowed.

---

**Summary:** Approve the core bet (membership + shared preflight + export seam). **Do not merge** until dirty-gate and landed-criteria interactions with intent-specific CLI and `specPath` are explicit product decisions, the mutation directive is harness-valid, intent/subspec are aligned on export, and integration/docs ACs match observable implement/plan contracts.