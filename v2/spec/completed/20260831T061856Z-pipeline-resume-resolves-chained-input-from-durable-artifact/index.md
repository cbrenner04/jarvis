# Pipeline resume resolves chained input from durable artifact

- [x] [00 - Chained stage resolution durable fallback](./00-chained-stage-resolution-durable-fallback.md)
- [x] [01 - Pipeline resume dispatches after prior worktree removal](./01-pipeline-resume-dispatches-after-worktree-removal.md)

Scope: chained plan/implement downstream-input resolution falls back from an absent prior entry-run worktree directory to the prior stage branch and pipeline admission base, rebinds per-workflow read roots (plan `cwd`, implement `preflightGitRoot`/`specReadRoot`) before preset build, and rematerializes branch-only inputs when needed; distinct never-landed refusals; `pipeline resume` dispatches through that resolution instead of refusing at stage resolution.
