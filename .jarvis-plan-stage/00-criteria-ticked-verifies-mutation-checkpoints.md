# Criteria-ticked verifies mutation-checkpoint criteria

Agents tick mutation-checkpoint acceptance criteria after authoring `Mutation checkpoint:`
comments; nothing executes the named inversion, so hollow checkpoints reach `main` while scoped
tests stay green.

## Decisions

- Extend the implement `spec.criteria-ticked` contract in `v2/src/execution/write.ts` — rules out post-commit diff-derived verification as the sole checkpoint gate.
- Verify only **ticked** non-human-only criteria whose assembled bullet text contains `Mutation checkpoint:` — rules out whole-worktree scans and `(Manual)` rows.
- Resolve each criterion's pinning test from a backtick path in its text (exemplar: `` `tui-entry.test.tsx` — … ``); load `// Mutation checkpoint:` comments from that file on the named pin — rules out reading checkpoints from production guards or unspecified files.
- Multi-pin criterion: apply every linked checkpoint before accepting the tick — rules out verifying the first pin only.
- For each linked checkpoint: apply the named inversion in the run worktree, run run-base scoped suites via `resolveCiTestScope`, restore the tree; scoped suite still green ⇒ hollow checkpoint — rules out comment-only satisfaction and agent self-police.
- Hollow checkpoint on a ticked mutation-checkpoint criterion ⇒ `contract_miss` on `spec.criteria-ticked`, harness `## Blocker` on the active subspec listing each hollow checkpoint (file, line, comment text), same diagnostics on `contract_miss_detail` — rules out a bare contract miss or alternate settlement surface.
- Unparseable `Mutation checkpoint:` comment: report (operator-visible log/telemetry) and skip that comment; do not `contract_miss` — rules out treating parse misses as hollow.
- Surviving inversion is legitimate (unreachable guard); fix may delete the guard — rules out forcing a new test for dead code.
- Guard-inversion evidence stays source mutation on the real guard plus a pinning-test comment checkpoint; no production invert hooks — rules out `setInvert*ForTest` / `invert*ForTest` / `invert*` parameters.
- Reuse scoped-test execution seams from `diff-derived-mutation-verifier.ts` where practical — rules out ad-hoc `bun test` invocation diverging from the ready gate.
- General surviving-production-mutation policy stays out of scope — rules out expanding diff-derived post-commit verification in this change.
- Deferred to first consumer: mechanical checkpoint parse grammar beyond repo exemplars — pin when the first unparseable-vs-hollow distinction needs a normative rule.

## Tasks

### Checkpoint linkage and application

- Add a co-located helper under `v2/src/execution/` that, given active subspec content and worktree root:
  - selects ticked non-human-only criteria referencing `Mutation checkpoint:`;
  - resolves pinning test paths from criterion backtick paths;
  - locates linked `// Mutation checkpoint:` comments on the named pin in each test file;
  - applies each parseable inversion to the production guard the comment names;
  - runs scoped tests and classifies hollow vs caught;
  - restores the worktree after each attempt.
- Wire the helper into the `spec.criteria-ticked` contract check (after the existing unticked-criteria gate passes).
- Format hollow-checkpoint `contract_miss` reasons and `contract_miss_detail` payloads with file, line, and comment text; reuse `appendBlockerToSpec` targeting the active subspec (`expectedArtifactPath`).

### Tests

- Add `write.test.ts` cases (injectable scoped-test runner / checkpoint applier seams):
  - hollow checkpoint refuses `done`, settles `spec.criteria-ticked` `contract_miss`, appends `## Blocker` with checkpoint coordinates, and logs matching `contract_miss_detail`;
  - valid checkpoint inversion turns a scoped pin red and allows `done`;
  - unparseable checkpoint is reported without `contract_miss`.
- Add `criteria-ticked-mutation-checkpoint-regression.test.ts` replaying merge-time worktree fixtures from `v2/spec/completed/20260801T142304Z-tui-entry-tree-viewport-and-navigation` and `v2/spec/20260801T160040Z-tui-entry-reversible-descend-navigation` (three evidence rows with their checkpoint comments) and asserting each named inversion is detected as surviving — not assertions against current `main` alone.
- Add `Mutation checkpoint:` comments on new pinning tests naming inversions for the hollow-refusal and caught-checkpoint guards; inverting each named guard turns the corresponding pin RED.

### Docs

- `v2/docs/operator-runbook.md` § Gate trust — what a ticked mutation-checkpoint criterion now proves.
- `v1/docs/spec-guidance.md` — how to write a checkpoint the harness can apply (criterion backtick path, pinning-test comment, exemplar phrasing).
- `v2/docs/v1-behaviors.md` — extend the criteria-ticked entry with mutation-checkpoint verification behavior.

### Verification

- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `write.test.ts` — `done` on a subspec whose only remaining non-human-only criterion is a ticked mutation-checkpoint row linked to a hollow checkpoint settles `contract_miss` on `spec.criteria-ticked`, appends a harness `## Blocker` on the active subspec naming checkpoint file, line, and comment text, and records the same diagnostics on `contract_miss_detail`; fails against pre-fix code.
- [ ] `write.test.ts` — the same contract allows `done` when applying the linked checkpoint inversion turns a scoped pinning test red; fails against pre-fix code.
- [ ] `write.test.ts` — a `Mutation checkpoint:` comment the harness cannot mechanically apply is reported as unparseable and does not settle `contract_miss`; fails against pre-fix code.
- [ ] `criteria-ticked-mutation-checkpoint-regression.test.ts` — replays merge-time worktrees from `20260801T142304Z-tui-entry-tree-viewport-and-navigation` and `20260801T160040Z-tui-entry-reversible-descend-navigation` (three evidence rows across those trees, with their checkpoint comments) and detects each named inversion as surviving; fails against pre-fix code.
- [ ] `write.test.ts` — inverting the hollow-checkpoint refusal guard named by the new pinning test's `Mutation checkpoint:` comment turns that pin RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — a ticked mutation-checkpoint criterion proves the harness applied the linked inversion and the scoped suite turned red (or the criterion is human-only); hollow checkpoints block completion with checkpoint coordinates.
- `v1/docs/spec-guidance.md` — mutation-checkpoint AC authoring: name the pinning test in backticks, place `// Mutation checkpoint:` on that pin naming the production guard mutation; exemplar criterion shape.
- `v2/docs/v1-behaviors.md` — criteria-ticked mutation-checkpoint verification at the implement write boundary.
