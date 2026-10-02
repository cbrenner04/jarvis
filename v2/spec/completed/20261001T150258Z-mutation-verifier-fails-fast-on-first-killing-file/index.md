# Mutation verifier fails fast on the first failing killing file

Parallel scoped killing-set runs today wait for every sibling (`Promise.allSettled` / `settleBounded`) before classifying a non-timeout failure as caught. A never-settling sibling can block until the per-candidate budget while another file already failed, wrongly settling `non_terminating_mutation_failed`. One execution-module change: fail fast, abort siblings, align operator docs.

- [x] [00 — Scoped killing-set fail-fast on first non-timeout failure](./00-scoped-killing-set-fail-fast-on-first-failure.md)
