# Criteria-ticked verifies mutation-checkpoint criteria

Agents tick mutation-checkpoint acceptance criteria after authoring `Mutation checkpoint:`
comments; nothing executes the named inversion, so hollow checkpoints reach `main` while scoped
tests stay green.

## Prerequisites

- Diff-derived mutation verification applies production-guard inversions and runs scoped test scripts.
- `parseSpec` assembles acceptance-criteria bullet blocks and classifies human-only markers.
- `spec.criteria-ticked` blocks implement `done` / `no-work` while any non-human-only acceptance criterion remains unchecked.

## Decisions

- Extend the implement `spec.criteria-ticked` contract in `v2/src/execution/write.ts` — rules out post-commit diff-derived verification as the sole checkpoint gate.
- On every implement `done` / `no-work`, run mutation-checkpoint verification on **ticked** non-human-only criteria whose assembled bullet text contains `Mutation checkpoint:` — independent of whether the unticked-row `spec.criteria-ticked` contract registered; rules out pre-ticked hollow bypass when all rows are already checked.
- Verify only those ticked non-human-only mutation-checkpoint criteria — rules out whole-worktree scans and `(Manual)` rows.
- **Pinning-test linkage:** extract the first backtick path segment from criterion text (basename, e.g. `` `tui-entry.test.tsx` ``); resolve under the run worktree root by basename search — 0 matches or >1 match ⇒ unparseable linkage (report, skip criterion checkpoints; no `contract_miss`).
- **Pin linkage:** when criterion prose names a pin title (or multiple), match each `// Mutation checkpoint:` comment to the `test`/`it` block whose title substring appears in the criterion; multi-line assembled bullets use the full block text — rules out scanning unrelated pins in the same file.
- **Linkage failures** (missing file, ambiguous file, named pin with no matching `// Mutation checkpoint:`) ⇒ unparseable (report, skip); do not treat as hollow and do not silently pass — rules out missing checkpoint on a named pin counting as satisfied.
- Multi-pin criterion: apply every linked checkpoint before accepting the tick — rules out verifying the first pin only.
- For each linked checkpoint: apply the named inversion in the run worktree, run scoped suites via `resolveCiTestScope` with `changedPaths` derived from inverted production guard file(s) (coarseness matches diff-derived mutation verification), restore the worktree after each attempt including scoped-test failure or timeout; scoped suite still green ⇒ hollow checkpoint — rules out comment-only satisfaction and agent self-police.
- Hollow checkpoint on a ticked mutation-checkpoint criterion ⇒ `contract_miss` on `spec.criteria-ticked`, harness `## Blocker` on the active subspec listing each hollow checkpoint as `path:line: comment`, same diagnostics on `contract_miss_detail` and in `failureReason` — rules out a bare contract miss or alternate settlement surface; aggregate all hollow checkpoints on the criterion.
- **Mixed outcomes:** unparseable comments on a criterion are reported and skipped; any remaining hollow parseable checkpoint still refuses completion.
- Unparseable `Mutation checkpoint:` comment body (cannot mechanically apply inversion): report via injectable operator-visible log/telemetry with file and line; skip that comment; do not `contract_miss` — rules out treating parse misses as hollow.
- `no-work` runs the same mutation-checkpoint verification as `done` — rules out bypass via terminal token choice.
- Surviving inversion is legitimate (unreachable guard); fix may delete the guard — rules out forcing a new test for dead code.
- Guard-inversion evidence stays source mutation on the real guard plus a pinning-test comment checkpoint; no production invert hooks — rules out `setInvert*ForTest` / `invert*ForTest` / `invert*` parameters.
- Reuse scoped-test execution seams from `diff-derived-mutation-verifier.ts` where practical — rules out ad-hoc `bun test` invocation diverging from the ready gate.
- General surviving-production-mutation policy stays out of scope — rules out expanding diff-derived post-commit verification in this change.
- Deferred to first consumer: mechanical checkpoint parse grammar beyond exemplar-plus-minimum linkage above — pin when the first unparseable-vs-hollow distinction needs a normative rule.

## Tasks

### Checkpoint linkage and application

- Add a co-located helper under `v2/src/execution/` that, given active subspec content and worktree root:
  - selects ticked non-human-only criteria referencing `Mutation checkpoint:`;
  - resolves pinning tests and pins per linkage rules above;
  - locates linked `// Mutation checkpoint:` comments;
  - applies each parseable inversion, runs scoped tests, classifies hollow vs caught;
  - restores the worktree after each attempt.
- Wire the helper into implement completion for both `done` and `no-work`: after the unticked-criteria gate when it runs, and **always** when ticked mutation-checkpoint criteria exist (even if the unticked gate did not register).
- Return hollow-checkpoint `failureReason` and drive write-loop `contract_miss_detail` / `appendBlockerToSpec` on the active subspec (`expectedArtifactPath`).

### Tests

- `write.test.ts` (injectable scoped-test runner / checkpoint applier / report sink):
  - hollow checkpoint refuses `done`/`no-work` with `spec.criteria-ticked` `contract_miss` and `failureReason` listing each hollow checkpoint as `path:line: comment`;
  - valid checkpoint inversion allows completion;
  - unparseable comment or linkage failure is reported (file+line) without `contract_miss`;
  - multi-pin ticked criterion with one hollow and one caught checkpoint refuses completion until all are valid;
  - pre-ticked hollow criterion refuses completion when every non-human-only row is already ticked.
- `write-loop.test.ts`: `spec.criteria-ticked` mutation-checkpoint `contract_miss` appends harness `## Blocker` on the active subspec and logs matching `contract_miss_detail` (same pattern as existing criteria-ticked settlement).
- `criteria-ticked-mutation-checkpoint-regression.test.ts`: materialize committed fixtures from merge SHAs `56cfcff8` (viewport, #2473) and `1f75bad7` (reversible-descend, #2485) under `v2/test/fixtures/mutation-checkpoint-regression/`; drive verification with **synthetic ticked non-manual** criteria derived from the manual source ACs below; assert each listed inversion is detected as surviving (scoped suite stays green) — not assertions against current `main` alone.
  - **Row 1** (`56cfcff8`): `tui-entry.test.tsx` — `drives row navigation through the injected input hook`; checkpoint: selection-driven list collapse during the ↑ walk.
  - **Row 2** (`56cfcff8`): `tui-entry.test.tsx` — `aligns selectable node ids with left-pane tree rows for the measured terminal size`; checkpoint: `currentState` lacking measured `terminalColumns`/`terminalRows` when navigation calls `monitorSelectableNodeIds`.
  - **Row 3** (`1f75bad7`): `tui-entry.test.tsx` — `overflow fixture forward j then k retraces the exact reverse visit order`; checkpoint: reintroducing `ids[0]` fallthrough when `indexOf` is `-1` in `selectNextRun`/`selectPreviousRun`.
  - **Excluded:** `j on the first painted pipeline row selects its first child, not ids[0] via fallthrough` — same `ids[0]` fallthrough guard as row 3; not a distinct surviving inversion under fixture state.
- Add `Mutation checkpoint:` comments on new pinning tests for hollow-refusal and caught-checkpoint guards; inverting each named guard turns the corresponding pin RED.

### Docs

- `v2/docs/operator-runbook.md` § Gate trust — what a ticked mutation-checkpoint criterion now proves.
- `v1/docs/spec-guidance.md` — how to write a checkpoint the harness can apply (criterion backtick path, pinning-test comment, exemplar phrasing).
- `v2/docs/v1-behaviors.md` — extend the criteria-ticked entry with mutation-checkpoint verification behavior.

### Verification

- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [x] `write.test.ts` — a ticked mutation-checkpoint criterion linked to a hollow checkpoint refuses `done` with `spec.criteria-ticked` `contract_miss` and `failureReason` listing each hollow checkpoint as `path:line: comment`; fails against pre-fix code.
- [x] `write.test.ts` — the same path allows completion when applying the linked inversion turns a scoped pinning test red; fails against pre-fix code.
- [x] `write.test.ts` — unparseable `Mutation checkpoint:` comment or linkage failure is reported (injectable log/telemetry with file and line) and does not settle `contract_miss`; fails against pre-fix code.
- [x] `write.test.ts` — one ticked criterion with two linked checkpoints where one is hollow and one is caught refuses completion until all are valid; fails against pre-fix code.
- [x] `write.test.ts` — when every non-human-only criterion is already ticked including a hollow mutation-checkpoint row, completion is still refused; fails against pre-fix code.
- [x] `write-loop.test.ts` — `spec.criteria-ticked` mutation-checkpoint `contract_miss` appends harness `## Blocker` on the active subspec naming each hollow checkpoint and logs matching `contract_miss_detail`; fails against pre-fix code.
- [x] `criteria-ticked-mutation-checkpoint-regression.test.ts` — replays fixture trees at `56cfcff8` and `1f75bad7` with synthetic ticked non-manual criteria for rows 1–3 above and detects each named inversion as surviving; fails against pre-fix code.
- [x] `write.test.ts` — inverting the hollow-checkpoint refusal guard named by the new hollow-refusal pinning test's `Mutation checkpoint:` comment turns that pin RED.
- [x] `write.test.ts` — inverting the caught-checkpoint guard named by the new caught-checkpoint pinning test's `Mutation checkpoint:` comment turns that pin RED.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — a ticked mutation-checkpoint criterion proves the harness applied the linked inversion and the scoped suite turned red; hollow checkpoints block completion with `path:line: comment` coordinates; pre-ticked rows are verified on `done`/`no-work`.
- `v1/docs/spec-guidance.md` — mutation-checkpoint AC authoring: name the pinning test in backticks, place `// Mutation checkpoint:` on the named pin naming the production guard mutation; exemplar criterion shape and minimum linkage rules.
- `v2/docs/v1-behaviors.md` — criteria-ticked mutation-checkpoint verification at the implement write boundary (`done`/`no-work`, independent of unticked-row registration).
