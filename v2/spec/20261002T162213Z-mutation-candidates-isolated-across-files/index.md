# Cross-file mutant isolation for diff-derived verification

Concurrent production-file mutation candidates today share one worktree while distinct files run in parallel; cross-import overlap during any in-flight mutate→restore window can mis-settle `non_terminating_mutation_failed` or hide a survivor. One subspec: symmetric import-aware scheduling with atomic admission, regression fixture, operator docs.

- [x] [00 — Serialize cross-importing concurrent production candidates](./00-cross-file-mutant-isolation.md)
