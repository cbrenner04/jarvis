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
- **Checkpoint directives are structured, not prose.** A verifiable checkpoint is a single-line comment in the pinning test file:
  `// @mutate <repo-relative-path> "<exact source text>" -> "<replacement text>"`.
  The harness never infers a file, symbol, or edit from English — rules out natural-language resolution, which is the failure mode that sank the first attempt (identifiers from the evidence rows were hardcoded to make fixtures pass).
- **No line numbers in directives.** The target is located by exact source text, which must occur **exactly once** in the named file; zero or multiple occurrences ⇒ unparseable — rules out directives that rot when unrelated edits shift lines.
- **Pinning-test linkage:** extract the first backtick path segment from criterion text (basename, e.g. `` `tui-entry.test.tsx` ``); resolve under the run worktree root by basename search — 0 matches or >1 match ⇒ unparseable linkage (report, skip criterion checkpoints; no `contract_miss`).
- **Pin linkage:** a directive belongs to the `test`/`it` block that encloses it; a directive is linked to a criterion when the criterion text contains that block's title substring. Criterion naming no pin title ⇒ every directive in the resolved file is linked — rules out scanning unrelated pins while still covering single-pin files.
- **A ticked criterion that claims a mutation turns a pin red and links no `@mutate` directive is hollow**, and refuses completion with a message naming the required directive form — rules out satisfying the contract with a prose-only comment, which is exactly the loophole this change exists to close. Prose `Mutation checkpoint:` comments remain legal as human-readable context; they are never the machine contract.
- Multi-pin criterion: apply every linked directive before accepting the tick — rules out verifying the first directive only.
- For each linked directive: apply the replacement in the run worktree, run scoped suites via `resolveCiTestScope` with `changedPaths` derived from the directive's target file(s) (coarseness matches diff-derived mutation verification), restore the worktree after each attempt including scoped-test failure or timeout; scoped suite still green ⇒ hollow checkpoint — rules out comment-only satisfaction and agent self-police.
- Hollow checkpoint on a ticked mutation-checkpoint criterion ⇒ `contract_miss` on `spec.criteria-ticked`, harness `## Blocker` on the active subspec listing each hollow checkpoint as `path:line: directive`, same diagnostics on `contract_miss_detail` and in `failureReason` — rules out a bare contract miss or alternate settlement surface; aggregate all hollow checkpoints on the criterion.
- **Mixed outcomes:** unparseable directives on a criterion are reported and skipped; any remaining hollow parseable directive still refuses completion.
- Unparseable directive (malformed syntax, unresolvable path, target text absent or ambiguous): report via injectable operator-visible log/telemetry with file, line, and reason; skip that directive; do not `contract_miss` — rules out treating parse misses as hollow.
- `no-work` runs the same mutation-checkpoint verification as `done` — rules out bypass via terminal token choice.
- Surviving inversion is legitimate (unreachable guard); fix may delete the guard — rules out forcing a new test for dead code.
- Guard-inversion evidence stays source mutation on the real guard plus a linked directive; no production invert hooks — rules out `setInvert*ForTest` / `invert*ForTest` / `invert*` parameters.
- Reuse scoped-test execution seams from `diff-derived-mutation-verifier.ts` where practical — rules out ad-hoc `bun test` invocation diverging from the ready gate.
- **The verifier is domain-blind.** No identifier, filename, pin title, or comment phrase drawn from the regression evidence rows may appear in verifier source — rules out passing the fixtures by special-casing them, which is why the first implementation was abandoned (PR #2498).
- General surviving-production-mutation policy stays out of scope — rules out expanding diff-derived post-commit verification in this change.

## Tasks

### Checkpoint linkage and application

- Add a co-located helper under `v2/src/execution/` that, given active subspec content and worktree root:
  - selects ticked non-human-only criteria referencing `Mutation checkpoint:`;
  - resolves pinning tests and pins per linkage rules above;
  - parses `// @mutate <path> "<old>" -> "<new>"` directives in the resolved file and links them to criteria by enclosing pin title;
  - refuses a linked-directive-free criterion as hollow, naming the required directive form;
  - applies each parseable directive, runs scoped tests, classifies hollow vs caught;
  - restores the worktree after each attempt.
- Wire the helper into implement completion for both `done` and `no-work`: after the unticked-criteria gate when it runs, and **always** when ticked mutation-checkpoint criteria exist (even if the unticked gate did not register).
- Return hollow-checkpoint `failureReason` and drive write-loop `contract_miss_detail` / `appendBlockerToSpec` on the active subspec (`expectedArtifactPath`).

### Tests

- `write.test.ts` (injectable scoped-test runner / checkpoint applier / report sink):
  - hollow checkpoint refuses `done`/`no-work` with `spec.criteria-ticked` `contract_miss` and `failureReason` listing each hollow checkpoint as `path:line: directive`;
  - valid checkpoint inversion allows completion;
  - unparseable comment or linkage failure is reported (file+line) without `contract_miss`;
  - multi-pin ticked criterion with one hollow and one caught checkpoint refuses completion until all are valid;
  - pre-ticked hollow criterion refuses completion when every non-human-only row is already ticked.
- `write-loop.test.ts`: `spec.criteria-ticked` mutation-checkpoint `contract_miss` appends harness `## Blocker` on the active subspec and logs matching `contract_miss_detail` (same pattern as existing criteria-ticked settlement).
- `criteria-ticked-mutation-checkpoint-regression.test.ts`: materialize committed fixtures from merge SHAs `56cfcff8` (viewport, #2473) and `1f75bad7` (reversible-descend, #2485) under `v2/test/fixtures/mutation-checkpoint-regression/`; drive verification with **synthetic ticked non-manual** criteria derived from the manual source ACs below; assert each listed inversion is detected as surviving (scoped suite stays green) — not assertions against current `main` alone.
  Each row's historical prose checkpoint is expressed **in the fixture** as an `@mutate` directive; the
  directive text lives in fixture data, never in verifier source.
  - **Row 1** (`56cfcff8`): `tui-entry.test.tsx` — `drives row navigation through the injected input hook`; directive reproduces the selection-driven list collapse in `monitorSelectableNodeIds`.
  - **Row 2** (`56cfcff8`): `tui-entry.test.tsx` — `aligns selectable node ids with left-pane tree rows for the measured terminal size`; directive drops the measured-terminal wrapper at the `setState` assignment.
  - **Row 3** (`1f75bad7`): `tui-entry.test.tsx` — `overflow fixture forward j then k retraces the exact reverse visit order`; directive reintroduces the `ids[0]` fallthrough in `selectNextRun`.
  - **Row 4 (generality, mandatory):** a checkpoint sharing **no** identifier, path, or pin title with rows 1-3 — a directive against a non-TUI production file — detected as caught (mutation turns its pin red). Rules out a verifier that only handles the shapes in rows 1-3.
  - **Excluded:** `j on the first painted pipeline row selects its first child, not ids[0] via fallthrough` — same `ids[0]` fallthrough guard as row 3; not a distinct surviving inversion under fixture state.
- Add `@mutate` directives on new pinning tests for hollow-refusal and caught-checkpoint guards; applying each directive turns the corresponding pin RED.

### Docs

- `v2/docs/operator-runbook.md` § Gate trust — what a ticked mutation-checkpoint criterion now proves.
- `v1/docs/spec-guidance.md` — how to write a checkpoint the harness can apply (criterion backtick path, pinning-test comment, exemplar phrasing).
- `v2/docs/v1-behaviors.md` — extend the criteria-ticked entry with mutation-checkpoint verification behavior.

### Verification

- Run `bun run typecheck` and `bun run test:v2`.

## Acceptance criteria

- [ ] `write.test.ts` — a ticked mutation-checkpoint criterion linked to a hollow checkpoint refuses `done` with `spec.criteria-ticked` `contract_miss` and `failureReason` listing each hollow checkpoint as `path:line: directive`; fails against pre-fix code.
- [ ] `write.test.ts` — the same path allows completion when applying the linked inversion turns a scoped pinning test red; fails against pre-fix code.
- [ ] `write.test.ts` — an unparseable directive (malformed syntax, unresolvable path, target text absent, target text ambiguous) or linkage failure is reported (injectable log/telemetry with file, line, and reason) and does not settle `contract_miss`; the four unparseable causes are pinned separately; fails against pre-fix code.
- [ ] `write.test.ts` — a ticked criterion claiming a mutation turns a pin red with **no** linked `@mutate` directive refuses completion, and the message names the required directive form; fails against pre-fix code.
- [ ] `write.test.ts` — one ticked criterion with two linked checkpoints where one is hollow and one is caught refuses completion until all are valid; fails against pre-fix code.
- [ ] `write.test.ts` — when every non-human-only criterion is already ticked including a hollow mutation-checkpoint row, completion is still refused; fails against pre-fix code.
- [ ] `write-loop.test.ts` — `spec.criteria-ticked` mutation-checkpoint `contract_miss` appends harness `## Blocker` on the active subspec naming each hollow checkpoint and logs matching `contract_miss_detail`; fails against pre-fix code.
- [ ] `criteria-ticked-mutation-checkpoint-regression.test.ts` — replays fixture trees at `56cfcff8` and `1f75bad7` with synthetic ticked non-manual criteria for rows 1-3 above and detects each directive's inversion as surviving; fails against pre-fix code.
- [ ] `criteria-ticked-mutation-checkpoint-regression.test.ts` — row 4 (generality): a directive against a non-TUI production file, sharing no identifier, path, or pin title with rows 1-3, is detected as caught; fails against pre-fix code.
- [ ] **Domain-blindness:** no identifier, path, pin title, or comment phrase from rows 1-3 appears in verifier source. Proved by a test that reads the verifier module and asserts absence of each evidence-row token, so the guard cannot rot silently; fails against a verifier that special-cases the fixtures.
- [ ] Deleting the row-4 fixture leaves rows 1-3 green — confirming row 4 is the only generality evidence — while deleting any row 1-3 fixture leaves row 4 green. (Manual)
- [ ] `write.test.ts` — applying the `@mutate` directive on the new hollow-refusal pinning test turns that pin RED.
- [ ] `write.test.ts` — applying the `@mutate` directive on the new caught-checkpoint pinning test turns that pin RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — a ticked mutation-checkpoint criterion proves the harness applied the linked inversion and the scoped suite turned red; hollow checkpoints block completion with `path:line: directive` coordinates; pre-ticked rows are verified on `done`/`no-work`.
- `v1/docs/spec-guidance.md` — mutation-checkpoint AC authoring: name the pinning test in backticks and place a `// @mutate <path> "<old>" -> "<new>"` directive on the named pin; exact-text-occurs-once rule, unparseable causes, and why a prose-only checkpoint no longer satisfies a ticked criterion.
- `v2/docs/v1-behaviors.md` — criteria-ticked mutation-checkpoint verification at the implement write boundary (`done`/`no-work`, independent of unticked-row registration).
