# 03 — Documentation updates

Update install instructions and command-invocation examples so the docs describe the shipped v1 executable as `jarvis1` and explain why the bare `jarvis` command is being left open for v2.

## Decisions

- Change executable invocations, install snippets, and shim-path references that describe how to run v1.
- Keep product-name prose, repo identity, and `~/.jarvis/` data paths unchanged.
- Document the rationale once in README: v1 now installs as `jarvis1` so v2 can later claim `jarvis`.

## Files in scope

1. `README.md`
2. `CLAUDE.md`
3. `v1/docs/spec-guidance.md`
4. `v1/docs/run-loop.md`
5. `v1/docs/quota-signals.md`
6. `v1/docs/agents.md`
7. `v1/docs/plan-mode.md`
8. `v1/docs/workflows.md`

## Task checklist

- [ ] Update README install snippets, shim-path references, and command examples to `jarvis1`
- [ ] Add a brief README note that `jarvis` is reserved for the future v2 CLI
- [ ] Update command-invocation examples in `CLAUDE.md`
- [ ] Update command-invocation examples in the six `v1/docs/*.md` files listed above
- [ ] Leave product-name prose and `~/.jarvis/` path examples unchanged

## Acceptance criteria

- [ ] The files listed above no longer instruct users to invoke v1 with bare `jarvis`
- [ ] README includes a brief explanation that v1 now installs as `jarvis1` so the bare `jarvis` command can be reused by v2
- [ ] Any remaining `jarvis` occurrences in those files are only product-name prose, repo/package identity, protected markers, or `~/.jarvis/` data paths
- [ ] `bun run check` passes

## Documentation updates

This subspec is the documentation update.
