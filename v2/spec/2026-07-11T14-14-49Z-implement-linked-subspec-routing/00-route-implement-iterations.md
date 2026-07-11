# Route implement iterations to the active linked subspec

## Decisions

- Resolve the first unchecked linked index item at each iteration; rule out injecting the full index or letting the agent choose order.
- Derive both prompt body and completion artifact from that active linked subspec; rule out a caller-supplied `--artifact` path that can become stale.
- Let the harness check the completed subspec's non-human-only acceptance criteria and then tick only its index link; rule out agents mutating routing state.
- Reject `--artifact` on `run workflow implement`; rule out silently accepting a flag whose value is ignored.
- Continue linked routing until no unchecked linked item remains, then run shrink once; rule out shrink or workflow completion after the first slice.
- Reject a direct subspec input with `implement.requires_index`; rule out an implicit single-file completion contract after `--artifact` removal.
- Return complete without an implement or shrink invocation for an empty or already-complete index; rule out inventing a shrink artifact when no active linked subspec exists.
- Fail before an agent invocation with `implement.malformed_link`, `implement.link_missing`, `implement.link_unreadable`, or `implement.link_out_of_tree`; rule out parser-only diagnostics that leave operators unable to distinguish invalid routing inputs.
- Snapshot and restore index routing checklist state when an agent changes it, then return `implement.index_routing_mutated` without advancement; rule out agent-authored link edits becoming durable routing state.
- Retain index-link parsing from the existing spec parser; rule out a second v2-specific interpretation.

## Scope

- Make `run workflow implement --spec <index.md>` select the first unchecked linked subspec for every write iteration.
- Inject that subspec's path and body into the implement prompt.
- Use that path for completion, then have the harness advance its index checkbox only after all non-human-only acceptance criteria are complete; unchecked human-only criteria do not block advancement.
- Route each later iteration to the next unchecked link, and run shrink only after the last linked subspec advances.
- Reject direct subspec input, return complete without work for an empty or already-complete index, and name invalid linked-path failures.
- Restore and reject agent-authored index-link checklist changes before they can affect routing.
- Remove the implement workflow's caller-owned `--artifact` launch input and update its usage/error contract.
- Preserve standalone write and non-implement workflow behavior.

## Acceptance criteria

- [ ] An implement run launched with a multi-subspec `index.md` injects only the first unchecked linked subspec's body and path into its first prompt.
- [ ] A multi-subspec implement run validates completion against only the active linked subspec; incomplete non-human-only criteria block its index advancement, while unchecked human-only criteria do not.
- [ ] On each completed linked subspec, the harness alone checks its matching index item and routes the next iteration to the next unchecked link; shrink runs only after the final link advances.
- [ ] Agent-authored changes to an index routing checklist are restored, reported as `implement.index_routing_mutated`, and do not advance routing; acceptance-criteria edits in the active subspec remain allowed.
- [ ] `jarvis run workflow implement` requires `--spec` but rejects the obsolete `--artifact` flag before daemon connection.
- [ ] Direct subspec input fails as `implement.requires_index`; empty and already-complete indexes return complete without implement or shrink invocation.
- [ ] Malformed, missing, unreadable, and out-of-tree unchecked linked paths fail before agent invocation with their respective named diagnostics.
- [ ] Automated coverage verifies prompt isolation, active-subspec completion, incomplete and human-only criterion routing, harness-only advancement, routing progression, terminal shrink timing, index-mutation protection, and obsolete-flag rejection.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- Update `v2/docs/write-behavior.md` with active linked-subspec routing, completion, terminal shrink, and routing-state protection.
- Update `v2/docs/workflow-runner.md` with implement terminal routing, direct/complete-index outcomes, and named linked-path diagnostics.
- Update the applicable `v2/docs/v1-behaviors.md` entry with v2's index-routed implement behavior.
