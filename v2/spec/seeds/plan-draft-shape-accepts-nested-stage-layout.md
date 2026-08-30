# plan.draft.shape rejects a well-formed draft nested at .jarvis-plan-stage/spec/<name>/ — validator requires flat, prompt/guidance teach nested

## Problem

The plan-draft artifact contract (`artifact.exists` / `plan.draft.shape`, `validatePlanDraftShape` in `v2/src/execution/write.ts:100`) requires `index.md` and `NN-*.md` **directly** inside `.jarvis-plan-stage/` (`join(specDir, "index.md")` + a top-level `readdirSync`). But the draft prompt only says to write files "under" the staging dir, and the ~200 lines of injected spec-guidance above that instruction repeatedly demonstrate the durable layout `spec/<UTC-timestamp>-<slug>/index.md`. An agent that follows the guidance's example nests the tree at `.jarvis-plan-stage/spec/<name>/index.md`, which the validator rejects as missing `index.md` — a correct, complete draft blocked by a prompt/validator contradiction.

## Evidence (2026-08-30, issue #3156)

Run `467c7b2b-975f-4b31-af36-855f18f0a9db` (plan for `engine-opponent-board-feedback`, cursor after codex quota fail-over): cursor produced a complete, correctly-formed spec tree nested under `spec/<name>/`, and the shape validator rejected it. Distinct from the multi-surface-AC / orphan-file plan blocks (those had a flat layout).

## Decisions

- Resolve the contradiction on the **validator** side: `validatePlanDraftShape` accepts either a flat `.jarvis-plan-stage/index.md` or a single nested `.jarvis-plan-stage/spec/<name>/index.md`, normalizing to the flat contract downstream. Rules out only hardening the prompt (the guidance's own examples teach nesting, so prompt-only wording stays fragile). Pairs with the plan-draft prompt hardening in #3154.
- If a nested tree is accepted, it is promoted to the same durable destination as the flat form; no change to the landed layout. Rules out two divergent on-main layouts.
- Exactly-one-spec-dir under the nested `spec/` is required; multiple or zero nested spec dirs stay a shape failure. Rules out ambiguous promotion.

## Acceptance criteria

- [ ] A `validatePlanDraftShape` test proves a draft nested at `.jarvis-plan-stage/spec/<name>/{index.md,00-*.md}` passes shape validation and normalizes to the flat contract; it fails against the current top-level-only readdir.
- [ ] A test proves a flat `.jarvis-plan-stage/{index.md,00-*.md}` still passes (no regression), and that zero/multiple nested spec dirs still fail.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v1/docs/spec-guidance.md` (or the plan-draft prompt reference) — note that the staging tree may be flat or nested under `spec/<name>/`, and both land identically.
