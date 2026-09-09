# Single-pipeline verbs route to the daemon that owns the pipeline

`wait`, `approve`, `reject`, `resume`, `recover`, `dismiss`, and `undismiss` currently issue their RPC against the invoking digest's socket, so a digest rotation strands control of live pipelines with `connect ENOENT`. Route each through the shared `pipeline_owner` resolver instead.

- [x] [00-resolve-pipeline-id-arguments-across-daemons.md](./00-resolve-pipeline-id-arguments-across-daemons.md)
- [ ] [01-route-single-pipeline-verbs-through-owner.md](./01-route-single-pipeline-verbs-through-owner.md)
