# Resolve daemon bindings explicitly

The daemon still preserves bare or serialized binding ids through `normalizeBindings`, then guesses whether they are live by checking for `invoke`. Now that shared invocation can create real `claude`, `codex`, and `cursor` bindings from resolved model rungs, daemon start and rehydration paths should rebuild bindings from stored role/profile context instead of runtime-introspecting binding objects.

## Decisions

- Resolve daemon write-loop bindings from `(agents, role, agentModelConfig)` at admission/rehydration; rules out reconstructing from serialized binding ids.
- Remove `normalizeBindings`/`hasLiveBindings`; rules out object-shape liveness introspection after deserialization.
- Paused `resume` reconstructs the original write-loop input from durable run data; rules out keeping `not_implemented` once binding reconstruction is available.
- Keep `list`/`wait` paused discovery semantics as `resumable_pause` / `nextAction: "resume"`; rules out adding `not_implemented` to composed run errors.

## Tasks

- Replace daemon start/queued-input binding normalization with explicit `resolveInvocationBindings(resolveExecutableRole(role), agents, agentModelConfig, createResolvedAgentBinding)` at the deserialization points.
- Ensure queued-run promotion and paused-run resume spawn write loops with live resolved bindings.
- Remove daemon imports and code paths that call bare `createAgentBindings`.
- Update daemon tests for start, queued promotion, and paused resume.
- Update durable docs for daemon RPC behavior and v1/v2 behavior parity.

## Acceptance criteria

- [ ] Daemon `start` with serialized write-loop agent/role/profile context invokes the write loop with live `createResolvedAgentBinding` bindings, not bare `createAgentBindings` terminal-error bindings.
- [ ] A queued daemon run rehydrates with the same resolved binding chain order it would have used when admitted immediately.
- [ ] `resume` on a durable `paused` run returns `{ ok: true }`, respawns the write loop with reconstructed live bindings, and no longer returns `not_implemented`.
- [ ] `resume` still rejects `worktree_claimed` before spawning a paused run when another live run owns the same `(project, branch)`.
- [ ] `list` and `wait` for a paused run continue to surface `resumable_pause` / `nextAction: "resume"` until the resumed write loop changes durable status.
- [ ] `v2/src/daemon/daemon.ts` no longer defines `normalizeBindings` or `hasLiveBindings` and no daemon production path imports or calls `createAgentBindings`.
- [ ] `bun run typecheck` stays green.
- [ ] `bun run test:v2` and `bun run test:integration:v2` stay green.

## Documentation updates

- `v2/docs/daemon-host.md` — update the `resume` RPC row: paused runs resume via reconstructed bindings instead of `not_implemented`.
- `v2/docs/v1-behaviors.md` — replace the v2 additive paused-resume placeholder with the new binding reconstruction behavior.
- `v2/docs/agent-model-config.md` — update only if implementation changes how daemon paths select role/profile binding rungs.
