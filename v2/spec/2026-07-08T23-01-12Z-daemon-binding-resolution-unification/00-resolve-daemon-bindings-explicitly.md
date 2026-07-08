# Resolve workflow daemon bindings explicitly

Workflow-step daemon runs still preserve bare or serialized binding ids through `normalizeBindings`, then guess whether they are live by checking for `invoke`. Now that shared invocation can create real `claude`, `codex`, and `cursor` bindings from resolved model rungs, workflow-step start, queued promotion, and resume should rebuild bindings from persisted role/profile context instead of runtime-introspecting binding objects.

## Decisions

- Persist workflow-step resolution context on `WriteLoopInput`: `agents`, `role`, and `agentModelConfig`; rules out sourcing live bindings from `telemetry.role` or serialized binding ids.
- Resolve workflow-step daemon write-loop bindings from persisted `(agents, role, agentModelConfig)` at admission/rehydration; rules out reconstructing from serialized binding ids.
- Remove `normalizeBindings`/`hasLiveBindings` from workflow-step daemon paths; rules out object-shape liveness introspection after deserialization.
- Paused workflow-step `resume` reconstructs the original write-loop input from durable run data plus persisted resolution context; rules out keeping `not_implemented` for workflow-backed paused rows.
- Ad-hoc paused `resume` keeps `not_implemented` after the `worktree_claimed` guard; rules out assuming every paused row has a workflow snapshot.
- Keep `list`/`wait` paused discovery semantics as `resumable_pause` / `nextAction: "resume"`; rules out adding `not_implemented` to composed run errors.
- Deferred to first consumer: ad-hoc/direct write binding resolution from machine profile — pin when a caller needs it.

## Tasks

- Add persisted workflow-step resolution context to `WriteLoopInput` creation/serialization and use it at daemon start and queued-input rehydration.
- Replace workflow-step daemon start/queued-input binding normalization with explicit `resolveInvocationBindings(resolveExecutableRole(role), agents, agentModelConfig, createResolvedAgentBinding)` at the deserialization points.
- Ensure workflow-step queued-run promotion and paused-run resume spawn write loops with live resolved bindings.
- Keep ad-hoc/direct daemon writes on bare `createAgentBindings` until a caller supplies role/profile context.
- Update daemon tests for workflow-step start, queued promotion, paused resume, and ad-hoc paused fallback.
- Update durable docs for daemon RPC behavior, ad-hoc fallback, and v1/v2 behavior parity.

## Acceptance criteria

- [ ] Workflow-step daemon `start` from serialized input reaches the first resolved agent binding instead of terminal-erroring from bare serialized bindings.
- [ ] A queued workflow-step daemon run rehydrates from persisted `WriteLoopInput` resolution context with the same resolved binding chain order it would have used when admitted immediately.
- [ ] `resume` on a durable workflow-step `paused` run returns `{ ok: true }`, respawns the write loop with reconstructed live bindings, and no longer returns `not_implemented`.
- [ ] `resume` on an ad-hoc `paused` run still returns `not_implemented` after passing the `worktree_claimed` guard.
- [ ] `resume` still rejects `worktree_claimed` before spawning a paused run when another live run owns the same `(project, branch)`.
- [ ] `list` and `wait` for a paused run continue to surface `resumable_pause` / `nextAction: "resume"` until the resumed write loop changes durable status.
- [ ] `v2/src/daemon/daemon.ts` no longer defines `normalizeBindings` or `hasLiveBindings`, and workflow-step daemon production paths do not import or call `createAgentBindings`.
- [ ] Ad-hoc/direct daemon production paths remain the only daemon callers of bare `createAgentBindings`.
- [ ] `bun run typecheck` stays green.
- [ ] `bun run test:v2` and `bun run test:integration:v2` stay green.

## Documentation updates

- `v2/docs/daemon-host.md` — update the `resume` RPC row: workflow-step paused runs resume via reconstructed bindings; ad-hoc paused runs keep `not_implemented`.
- `v2/docs/v1-behaviors.md` — replace the v2 additive paused-resume placeholder with workflow-step binding reconstruction and ad-hoc fallback behavior.
- `v2/docs/agent-model-config.md` — update if implementation changes how daemon paths select role/profile binding rungs or documents `WriteLoopInput` as a resolver consumer.
