# Pipeline resume/recover expose stale-reset override flags

- [ ] [00 - Pipeline CLI stale-reset override flags](./00-pipeline-cli-stale-reset-override-flags.md)
- [ ] [01 - Pipeline resume override stale-reset dispatch](./01-pipeline-resume-override-stale-reset-dispatch.md)
- [ ] [02 - Operator runbook pipeline reset overrides](./02-operator-runbook-pipeline-reset-overrides.md)
- [ ] [03 - v1-behaviors pipeline reset overrides](./03-v1-behaviors-pipeline-reset-overrides.md)

Scope: expose `--reset-despite-dirty` and `--reset-despite-landed-criteria` on `pipeline resume` (unscoped and branch-scoped) and `pipeline recover` (branch-scoped); resume threads each flag through the existing daemon RPC into shared `resetStaleWorkspace` preflight; recover forwards the flags for RPC parity only; standalone workflow re-run gates and failed-plan auto-clear stay unchanged.
