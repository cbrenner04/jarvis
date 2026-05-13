# Harness hardening

A grouped set of small specs that harden the jarvis harness against the
mid-iteration failure modes surfaced in an architectural review of the
post-patch-mode codebase. None of these add user-facing features; each closes
a concrete gap that can lose work, corrupt state, waste an agent call, or
make `runCommand` harder to extend.

The subspecs are ordered for landing. Earlier subspecs are higher-impact
(prevent work loss, prevent corruption). The pure refactor is last so it
rebases over the behavior changes, not under them.

## Subspecs

- [x] [01 — Iteration safety (SIGINT, timeouts)](./01-iteration-safety.md)
- [x] [02 — Atomic config writes and worktree lock](./02-config-and-lock.md)
- [x] [03 — Heredoc-free commits](./03-heredoc-commits.md)
- [ ] [04 — Blocker handling](./04-blocker-handling.md)
- [ ] [05 — Deterministic PR body](./05-deterministic-pr-body.md)
- [ ] [06 — Unified spec parser](./06-spec-parser.md)
- [ ] [07 — Quota in-loop fallback](./07-quota-fallback.md)
- [ ] [08 — Quota pattern audit (opportunistic)](./08-quota-pattern-audit.md)
- [ ] [09 — Local run telemetry](./09-local-telemetry.md)
- [ ] [10 — Fire-and-forget log shipping](./10-fire-and-forget-logs.md)
- [ ] [11 — Decompose runCommand](./11-decompose-run-command.md)

## Conventions

- Run this spec with `jarvis run spec/harness-hardening/index.md`.
- Complete one subspec per iteration. Do not bundle.
- If a subspec is blocked, append a `## Blocker` section to that file and
  stop. (Subspec 04 makes jarvis honor this automatically; until then the
  patch-mode rule already requires it.)
- Subspecs may add new exit codes. Each subspec that does so updates
  `docs/run-loop.md` in its own iteration.
