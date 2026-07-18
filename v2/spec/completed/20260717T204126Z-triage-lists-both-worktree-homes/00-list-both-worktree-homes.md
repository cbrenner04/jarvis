# List both worktree homes

## Behavior

- No-argument `jarvis1 triage` renders one table containing worktrees from `<repo>/.worktree/` and the registered project's `~/.jarvis/worktrees/<project-key>/` home.
- Each table and outstanding-verdict row identifies the worktree home while retaining dirty, ahead/behind, PR, spec-progress, landed, and draft classification.

## Decision ledger

- Label `<repo>/.worktree/` rows `v1` and Jarvis-owned rows `v2`; rules out path-only or indistinguishable labels.
- Preserve a Jarvis-owned worktree's home-relative nested name, such as `plan/<name>`; rules out collapsing branch-nested directories to a basename.
- Treat both homes as one listing and one verdict input; rules out separate tables, commands, or verdicts.
- Report `no worktrees` only when both homes are empty or absent; rules out returning early when the v1 home is empty.
- Leave named triage, `--mark-ready`, and `--merge` behavior unchanged; rules out broadening this listing change into target resolution.

## Implementation

- Discover the registered project's Jarvis-owned worktree home from project configuration.
- Enumerate valid worktrees across both homes and render the combined table and verdict.
- Retain existing status and verdict classification for every discovered row.
- Add focused no-argument listing coverage for two homes, nested v2 names, duplicate names, and either home being empty.
- Update the durable operator and v1-parity documentation.

## Acceptance criteria

- [x] No-argument `jarvis1 triage` prints one table containing every worktree from the registered project's v1 and v2 homes, with each table row labeled `v1` or `v2`; equal names in different homes remain distinguishable rows.
- [x] Jarvis-owned branch-nested worktrees are listed under their complete home-relative name, and `no worktrees` prints only when neither home contains a worktree.
- [x] Dirty, ahead/behind, PR, spec-progress, landed, draft, and outstanding-verdict classification apply unchanged to rows from either home.
- [x] `v1/test/triage-command.test.ts` test `lists registered v1 and v2 worktree homes` exercises a combined no-argument listing and fails against the pre-fix code because the v2 row is absent.
- [x] Existing `v1/test/triage-command.test.ts` `describe("triage verdict")` and named-form tests stay green.
- [x] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [x] `v1/docs/operator-runbook.md` records that no-argument triage combines both homes and identifies each row's home.
- [x] `v2/docs/v1-behaviors.md` records the two-home listing and unchanged row classification.

## Documentation updates

- `v1/docs/operator-runbook.md`: document the combined, home-labeled listing.
- `v2/docs/v1-behaviors.md`: replace the v1-only listing contract with two-home discovery and classification parity.
