# Terminal publication settles superseded preceding stage PRs

After successful single-lane `ready` or `merge` terminal publication with `supersede: "close"`, comment and close open PRs from earlier succeeded workflow stages; record nonfatal `supersedeFailures` without revoking terminal success. Policy admission is prerequisite (`v2/src/execution/project-pipeline-resolution.ts`).

## Subspecs

- [x] [00 — Durable `supersedeFailures` on the pipeline row](./00-supersede-failures-persistence.md)
- [x] [01 — Terminal supersede settlement](./01-terminal-supersede-settlement.md)
