# Print external intent path early

## Problem

In `commit: false` plan runs, Jarvis writes the external `intent.md` after final
naming, then continues through later phases before printing the normal handoff.
If refine, draft, or review fails, the operator may not see the useful artifact
path.

## Decisions

- Print the absolute external `intent.md` path on stdout immediately after final naming and external write; rules out waiting for `index.md` generation or stderr-only phase logging.
- Keep successful no-commit completion centered on the external `index.md` run handoff; rules out replacing `jarvis1 run <index.md>` with an intent-only handoff.
- Leave committed plan stdout unchanged; rules out sharing the new no-commit intent-path line with `commit: true` flows.
- Preserve no-commit artifact layout and generated `index.md` completion semantics; rules out moving specs or treating `intent.md` as the implementation entrypoint.
- Deferred to first consumer: exact stdout label for the early path -- pin when another parser or documented command contract needs it.

## Task checklist

- [ ] Emit the absolute external `intent.md` path to stdout after a `commit: false` plan has final naming and has written external `intent.md`.
- [ ] Ensure the early path is printed before refine, draft, or review can fail.
- [ ] Preserve the existing successful no-commit `index.md` next-step handoff.
- [ ] Preserve committed fresh-run and committed full-pipeline stdout.
- [ ] Add regression coverage for no-commit later-phase failure, no-commit success, and committed fresh-run output.
- [ ] Update durable docs for v1 plan-mode output and v2's v1 behavior baseline.

## Acceptance criteria

- [ ] In a `commit: false` plan run where a later refine, draft, or review phase fails, stdout contains the absolute external `intent.md` path before the failure is reported and before any final `index.md` handoff would be possible.
- [ ] In a successful `commit: false` plan run, stdout contains the early absolute external `intent.md` path and still ends with the existing external `index.md` next steps, including `jarvis1 run <absolute-index.md>`.
- [ ] In a fresh `commit: true` plan run, the committed fresh-run handoff remains the PR review plus `jarvis1 plan --resume-draft <targetDir>/<spec-dir>/intent.md>` output, with no external intent-path line.
- [ ] No-commit external spec storage layout, `repo:` binding behavior, and generated `index.md` completion semantics remain unchanged.
- [ ] `v1/docs/plan-mode.md` documents that no-commit plan runs print the absolute external `intent.md` path after naming succeeds and before later phases.
- [ ] `v2/docs/v1-behaviors.md` records the changed v1 no-commit plan stdout behavior.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/plan-mode.md`: no-commit stdout includes the early absolute external `intent.md` path after naming succeeds, while final success remains the `index.md` handoff.
- `v2/docs/v1-behaviors.md`: update the v1 plan-mode no-commit output baseline.
