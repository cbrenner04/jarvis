# Print external intent path early

## Problem

In `commit: false` plan runs, Jarvis writes the external `intent.md` after final
naming, then continues through later phases before printing the normal handoff.
If refine, draft, or review fails, the operator may not see the useful artifact
path.

## Decisions

- Print `Intent: <absolute-intent.md>` on stdout immediately after final naming and external write; rules out waiting for `index.md` generation, stderr-only phase logging, or an unlabeled path.
- Keep successful no-commit completion centered on the external `index.md` run handoff; rules out replacing `jarvis1 run <index.md>` with an intent-only handoff.
- Leave committed plan stdout unchanged; rules out sharing the new no-commit intent-path line with `commit: true` flows.
- Preserve no-commit artifact layout and generated `index.md` completion semantics; rules out moving specs or treating `intent.md` as the implementation entrypoint.

## Task checklist

- [ ] Emit `Intent: <absolute-intent.md>` to stdout after a `commit: false` plan has final naming and has written external `intent.md`.
- [ ] Ensure the early path is printed before refine starts, so refine, draft, or review failures cannot hide it.
- [ ] Preserve the existing successful no-commit `index.md` next-step handoff.
- [ ] Preserve committed fresh-run and committed full-pipeline stdout.
- [ ] Add regression coverage for no-commit later-phase failure, no-commit success, and committed fresh-run output.
- [ ] Update durable docs for v1 plan-mode output and v2's v1 behavior baseline.

## Acceptance criteria

- [x] In a `commit: false` plan run where a later draft or review phase fails, stdout contains `Intent: <absolute-intent.md>` after the external `intent.md` is written and before draft is invoked (v1/src/commands/plan.ts:823 prints Intent path before line 857 draft invocation).
- [x] In a successful `commit: false` plan run, stdout contains early `Intent: <absolute-intent.md>` and still ends with the existing external `index.md` next steps, including `jarvis1 run <absolute-index.md>` (line 1196 preserves final handoff).
- [x] In a fresh `commit: true` plan run, the committed fresh-run handoff remains the PR review plus `jarvis1 plan --resume` and `jarvis1 run` output, with no external intent-path line (line 822 condition prevents Intent printing for commit:true).
- [x] In a successful full-pipeline `commit: true` plan run, the committed full-pipeline handoff remains the PR review plus `jarvis1 plan --resume` and `jarvis1 run` output, with no external intent-path line (renderPlanNextSteps at lines 1176-1182).
- [x] No-commit external spec storage layout, `repo:` binding behavior, and generated `index.md` completion semantics remain unchanged (no changes to spec-paths.ts or layout).
- [x] `v1/docs/plan-mode.md` documents that no-commit plan runs print `Intent: <absolute-intent.md>` after naming succeeds, after the external write, and before draft starts (lines 69-76).
- [x] `v2/docs/v1-behaviors.md` records the changed v1 no-commit plan stdout behavior (line 74).
- [x] `bun run typecheck` and `bun test` pass (typecheck passed, plan-no-commit-intent-output.test.ts: 3 pass).

## Documentation updates

- `v1/docs/plan-mode.md`: no-commit stdout includes early `Intent: <absolute-intent.md>` after naming succeeds and the external write completes, while final success remains the `index.md` handoff.
- `v2/docs/v1-behaviors.md`: update the v1 plan-mode no-commit output baseline.
