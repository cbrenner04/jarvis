# Route implement iterations to the active linked subspec

## Decisions

- Resolve the first unchecked linked index item at each iteration; rule out injecting the full index or letting the agent choose order.
- Derive both prompt body and completion artifact from that active linked subspec; rule out a caller-supplied `--artifact` path that can become stale.
- Let the harness check the completed subspec's acceptance criteria and then tick only its index link; rule out agents mutating routing state.
- Reject `--artifact` on `run workflow implement`; rule out silently accepting a flag whose value is ignored.
- Retain index-link parsing and malformed-link handling from the existing spec parser; rule out a second v2-specific interpretation.

## Scope

- Make `run workflow implement --spec <index.md>` select the first unchecked linked subspec for every write iteration.
- Inject that subspec's path and body into the implement prompt.
- Use that path for completion, then have the harness advance its index checkbox only after all non-human-only acceptance criteria are complete.
- Route a subsequent iteration to the next unchecked link without changing completed subspec criteria.
- Remove the implement workflow's caller-owned `--artifact` launch input and update its usage/error contract.
- Preserve standalone write and non-implement workflow behavior.

## Acceptance criteria

- [ ] An implement run launched with a multi-subspec `index.md` injects only the first unchecked linked subspec's body and path into its first prompt.
- [ ] When the active linked subspec's non-human-only acceptance criteria are complete, completion validation uses that subspec, the harness checks only its corresponding index item, and the next write iteration targets the next unchecked link.
- [ ] An implement agent can check acceptance criteria in its active subspec without modifying `index.md`; the harness alone advances the completed index link.
- [ ] `jarvis run workflow implement` requires `--spec` but rejects the obsolete `--artifact` flag before daemon connection.
- [ ] `v2/src/execution/implement-workflow-steps.test.ts`, `v2/src/execution/write.test.ts`, `v2/src/execution/write-loop.test.ts`, and `v2/src/cli.test.ts` cover multi-subspec routing, harness-owned index advancement, active-subspec completion, and obsolete-flag rejection.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- Update `v2/docs/write-behavior.md` with active linked-subspec prompt routing, active-subspec completion, and harness-owned index advancement.
- Update `v2/docs/first-workflow-walkthrough.md` to remove `--artifact` from the implement command and describe index-routed execution.
