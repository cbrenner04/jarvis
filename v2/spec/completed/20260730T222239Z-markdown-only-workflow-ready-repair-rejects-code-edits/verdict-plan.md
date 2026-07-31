Spot-checking the codebase on the advocate's highest-severity claims so the verdict is grounded in the repo.
## Verdict: refinements required

The spec’s core rule is sound (markdown-only intent/plan workflows, layered after the run-diff fence, per-surface-class rejection, frozen output roots). It is not merge-ready until the gaps below are closed. These are required outcomes, not rewrite prescriptions.

### 1. Production-path parity (required)

The markdown-only constraint must hold on every route where the existing run-diff fence is enforced today—not only on the live repair loop.

**Required outcomes:**
- Persist markdown output roots (or an equivalent pre-intersected allowset) at first repair freeze alongside existing `ReadyGateRepairFenceProvenance` data.
- Re-enforce the markdown-only layer on completed-run retry, `jarvis run resume`, and review-mutation recovery—the same entry points covered by `01-durable-ready-gate-repair-fence` and `02-review-mutation-repair-fence`.
- Fail closed when provenance is missing or invalid on markdown-only runs.

**Rationale:** Without this, implementers can pass loop-only unit tests while resume/recovery still commits rejected code—the exact bypass class the prerequisite fence work closed.

If adding these recovery ACs makes the single subspec span multiple independently testable production routes, split into additional index-linked subspecs (one per entry point), preserving every original acceptance outcome exactly once across replacements.

### 2. Classification source at repair time (required)

**Required outcome:** State explicitly that markdown-only classification uses the originating write-step workflow identity (original `promptId`, frozen landing kind, or equivalent durable parent context)—not the repair iteration’s `write.ready-repair` id, which overwrites `promptId` during repair.

**Rationale:** Enforcement keyed to repair-time `promptId` would never fire; the spec’s `intent.prompt.split` / `plan.prompt.draft` decisions are currently unimplementable as written.

### 3. Distinct failure messaging (required)

**Required outcomes:**
- A dedicated error prefix/message for markdown-only violations (non-`.md` or path outside frozen output roots), separate from the existing run-diff fence wording.
- Deterministic first-offender selection (byte-sorted, escaped) with evaluation order documented: run-diff fence first, then markdown-only layer.

**Rationale:** A path like `v2/src/foo.ts` can pass the run-diff fence but fail markdown-only; reusing the run-diff message would misdescribe the violation.

### 4. Plan workflow coverage (required)

**Required outcome:** Intent-only regressions are insufficient for plan root resolution (`durablePath` / `.jarvis-plan-stage/` vs `ready-intents/` / `.jarvis-intent-stage/`). Add either a focused plan-workflow rejection regression or an AC proving frozen landing carries `durablePath` and enforcement uses it—testable without assuming intent fixtures exercise plan wiring.

**Rationale:** Intent names both workflows; a plan-only root bug can ship with green intent tests.

### 5. Pinned fixture paths (required)

**Required outcome:** Replace literal `test/**` with repo-accurate surface-class paths in Work and/or ACs (e.g. source `v2/src/**`, script `scripts/**`, test `v1/test/**`, consistent with existing repair-fence fixtures and `shared/module-boundary-surfaces`).

**Rationale:** No top-level `test/` exists; unpinned paths invite wrong fixtures that do not exercise the intended surface class.

### 6. Intent-workflow test harness (required)

**Required outcome:** Work section must state that new regressions extend the repair-fence test harness with intent-shaped inputs: originating `promptId`, `expectedArtifactPath: ".jarvis-intent-stage"`, spec path under `ready-intents/`, and frozen landing metadata (`output.durableDir`, staging dir)—mirroring patterns in `write.test.ts` and `workflow-runner.test.ts`.

**Rationale:** Current `runRepairFenceLoop` defaults are implement-shaped; ACs requiring intent behavior cannot be satisfied without documented harness extension.

### 7. Guard invert coverage (required)

**Required outcomes (per spec guidance):** Either invert ACs for script- and test-path rejection regressions, or one AC stating that inverting only the markdown-only fence reds all three surface-class rejection tests.

**Rationale:** A single source-path invert proves the guard exists but not that all three branches are wired.

### 8. Commit boundary assertions (required)

**Required outcome:** Rejection ACs must align with intent’s “not committed” promise—assert no successful repair republish and no repair commit (e.g. `publishCalls`, absent repair commit SHA), matching the existing `rejects ready-gate repairs outside the run diff and spec tree` test pattern.

**Rationale:** `completion_commit_failed` alone does not prove the staged edit was not committed.

### 9. Staging-root freeze semantics (required)

**Required outcome:** Clarify that `.jarvis-intent-stage/` and `.jarvis-plan-stage/` are included in frozen roots based on landing/repair-input contract at freeze time—not re-derived from on-disk presence at enforcement time, and not dropped if the staging dir is removed post-landing while paths remain in the run diff.

### 10. Scope boundary for sidecars (required)

**Required outcome:** One explicit decision line: sidecar exclusion (`.jarvis-*` paths) is owned by the sibling `ready-gate-repair-omits-jarvis-sidecars-from-commits` intent; this spec covers source/script/test non-markdown paths only.

**Rationale:** Problem text cites sidecars; without a boundary, reviewers will expect sidecar ACs here.

### 11. Documentation and prerequisite alignment (required)

**Required outcomes:**
- Add `v2/docs/v1-behaviors.md` to `intent.md` documentation updates (subspec already has it; intent must not drift).
- Copy the run-diff+spec-tree prerequisite into the subspec so implement agents reading only the active subspec see the dependency.

### Not required (defend as-is)

- Separate plan-only triple of surface-class tests when shared classifier + plan-root coverage AC exists.
- Optional edge-case ACs (`.md` outside roots, non-`.md` inside roots)—decisions already bound scope; PR #2243 failure mode is covered by the four intent ACs plus persistence parity.