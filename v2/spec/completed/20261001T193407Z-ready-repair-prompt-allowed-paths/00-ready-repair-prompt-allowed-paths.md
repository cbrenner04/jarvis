# 00 — `ALLOWED_PATHS` on `write.ready-repair`

## Problem

`write.ready-repair` omits the attributable allowset the repair fence enforces (`resolveAttributableRepairAllowset` in `v2/src/execution/ready-finalize.ts`, applied after the agent returns in `runReadyGateRepairLoop` at `v2/src/execution/write-loop.ts`), so agents edit refused paths and runs settle `completion_commit_failed`.

## Decisions

- Add required placeholder `ALLOWED_PATHS` to `prompts/write/ready-repair.md` with `revision` bump; frontmatter `placeholders` must list `ALLOWED_PATHS` (revision bump alone is not the contract). Rules out an undocumented placeholder the registry verifier cannot see.
- Prompt body lists allowed repo-relative paths one per line under a short heading, plus one sentence that edits outside the list are reverted and end the run. Rules out burying the list only in `STEP_RULES`.
- Prompt contract is the attributable allowset from `resolveAttributableRepairAllowset` plus that sentence, not full repair-fence parity (markdown-only workflow roots may still refuse paths the prompt lists). Rules out operators or agents reading the prompt as the entire fence.
- Each `runReadyRepairIteration` call in `runReadyGateRepairLoop` sets `ALLOWED_PATHS` from `[...resolveAttributableRepairAllowset(frozenRepairAllowset, currentOutcome.error)].sort()` joined with `\n`, using the same `currentOutcome.error` as the impending fence for that iteration; no dedicated second-iteration prompt AC. Rules out freezing the first gate error’s allowlist across later repair reprompts when `currentOutcome.error` changes.
- Post-fix: when marker attribution narrows below the frozen run-diff set, the rendered list must match `resolveAttributableRepairAllowset(frozen, error)` and must omit at least one frozen-only path (reachable: `write-loop.test.ts` `repair refuses a staged path outside the attributable allowset`). Rules out populating `ALLOWED_PATHS` from the frozen run-diff set when attribution applies.
- Deferred to first consumer: empty attributable allowset copy in the prompt — pin when a test constructs `resolveAttributableRepairAllowset` → size 0 without settling `ready_gate_out_of_scope` first.
- Deferred to first consumer: test-terminal repair prompt fixture — pin when adding ready test-command repair prompt coverage (`isReadyTestCommand` → frozen allowset branch of `resolveAttributableRepairAllowset`).
- New regression file `v2/src/execution/write-loop-ready-repair.test.ts` owns ready-repair prompt allowset coverage; do not grow `write-loop.test.ts` (over budget pending split). Rules out duplicating the `repairPromptForGateLog` harness in the monolith.
- If `ready-repair-fixes-dead-exports-in-diff` (`v2/spec/seeds/ready-repair-fixes-dead-exports-in-diff.md`) is planned in parallel, use one spec index with ordered subspecs or land this subspec first so both intents share one `write-loop-ready-repair.test.ts` scaffold. Rules out two implement runs each creating the same new file.
- Extend `v2/src/execution/write.test.ts` `write.ready-repair` render-observer case with a sample `ALLOWED_PATHS` value so required-placeholder rendering stays covered (`shared/prompts/render-observer-tests.ts` mapping unchanged).

## Tasks

- [x] Bump `prompts/write/ready-repair.md` (`ALLOWED_PATHS`, revision, placeholder list, prose).
- [x] Thread `frozenRepairAllowset` into `runReadyRepairIteration` and populate `ALLOWED_PATHS` before `awaitIteration` from `currentOutcome.error` each loop pass.
- [x] Add `v2/src/execution/write-loop-ready-repair.test.ts` with marker-attributed subset case, frozen-run-diff fallback case, and unpopulated-allowlist negative case.
- [x] Extend `write.test.ts` ready-repair placeholder fixture for `ALLOWED_PATHS`.
- [x] Update docs listed below.

## Acceptance criteria

- [x] `v2/src/execution/write-loop-ready-repair.test.ts`: for a marker-attributed lint gate failure, the rendered `write.ready-repair` allowed-path block matches `resolveAttributableRepairAllowset(frozen, error)` and excludes at least one path in the frozen run-diff allowset but not in the attributable set; fails against the pre-fix prompt (no populated attributable allowlist). Reachable narrowing: `write-loop.test.ts` `repair refuses a staged path outside the attributable allowset`.
- [x] `v2/src/execution/write-loop-ready-repair.test.ts`: for a gate failure with no marker-attributed lint paths (frozen-run-diff fallback branch of `resolveAttributableRepairAllowset`, not the test-terminal branch), the allowed-path block matches that function’s output; fails against the pre-fix prompt.
- [x] `v2/src/execution/write-loop-ready-repair.test.ts`: on an active repair iteration, asserts the rendered prompt’s allowed-path block is non-empty and wired from `ALLOWED_PATHS` (test fails when the placeholder is missing or blank); fails against the pre-fix template/wiring.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/prompts.md` — add `ALLOWED_PATHS` to the `write.ready-repair` row.
- `v2/docs/workflow-runner.md` § Ready gate repair — note the repair agent receives the attributable allowset in the prompt.
- `v2/docs/v1-behaviors.md` — record ready-gate repair prompt allowlist surfacing (parity/additive bullet beside existing repair-prompt scoping entry).
