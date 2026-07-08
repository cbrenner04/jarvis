# Wire Cursor Binding

Resolved `cursor` bindings still return the terminal unwired error. Wire them to spawn the real Cursor CLI through shared invocation, preserving the existing binding identity, fallback, and telemetry contracts.

## Decisions

- Port only Cursor argv/model mapping from v1; rules out duplicating v1 process lifecycle or fallback loops.
- Use `cursor agent -p --output-format text --model <resolved-cli-model> --force --workspace <cwd> <prompt>` with ignored stdin; rules out stdin prompt delivery and display-name fuzzy matching.
- Keep `agentId/adapterModel/priceKey` as binding id and telemetry metadata source; rules out CLI-slug-derived rung identity.
- Classify Cursor with agent-specific quota patterns plus shared model-config/transient handling; rules out inheriting Claude-only quota detection.
- Treat aborts, spawn failures, stream failures, and unmatched non-zero exits as terminal `error`; rules out quota fallback on unknown Cursor failures.
- Cursor token estimation is optional in this slice; rules out blocking real Cursor spawning on usage/cost parity.
- Leave unhandled agents on the terminal unwired stub; rules out wiring Codex or OpenCode in the Cursor slice.

## Tasks

- Add Cursor model-label to CLI-slug resolution in `shared/invocation/agents.ts`, ported from `v1/src/agents/cursor.ts`.
- Make `createResolvedAgentBinding({ agentId: "cursor", ... })` spawn Cursor with the resolved CLI argv, caller `cwd`, and abort signal.
- Add Cursor-specific quota classification while keeping model-config, transient retry, abort, spawn-failure, and generic-error behavior aligned with the shared spawn loop.
- Preserve unwired terminal-error behavior for agents not handled by this slice.
- Cover Cursor success, model slug mapping, quota, model_config, generic error, abort-as-error, spawn-failure-as-error, binding metadata, telemetry metadata, and unwired-agent behavior with tests.

## Documentation updates

- Update `v2/docs/shared-invocation.md` to state resolved Cursor bindings spawn the real CLI and classify settled results.
- Update `v2/docs/write-behavior.md` so its current-scope note no longer claims real agent process spawning is wholly unwired.
- Update `v2/docs/v1-behaviors.md` only if shared Cursor command shape or classification intentionally differs from v1 `cursor.ts`/`spawn.ts`/`quota.ts`.

## Acceptance criteria

- [ ] A resolved `cursor` binding invokes the real Cursor CLI command shape with `adapterModel` mapped to the Cursor CLI model slug, prompt as the trailing positional argument, ignored stdin, caller `cwd`, `--workspace <cwd>`, and abort signal handling.
- [ ] Cursor binding results classify as `ok`, `quota`, `model_config`, or `error` using Cursor quota patterns and shared subprocess semantics, with aborts and spawn failures returning terminal `error`.
- [ ] A settled resolved `cursor` invocation emits `invocation_completed` telemetry with real `cursor` agent and resolved model metadata.
- [ ] Cursor quota in an ordered binding chain advances to the next binding, while Cursor `model_config` and generic `error` stop without trying later bindings.
- [ ] Unhandled resolved agents still return the existing terminal unwired `error` result and keep metadata.
- [ ] `shared/invocation/agents.test.ts` covers Cursor binding behavior and the unwired-agent fallback.
- [ ] `shared/invocation/execute.test.ts` fallback and telemetry tests stay green.
- [ ] `v2/docs/shared-invocation.md`, `v2/docs/write-behavior.md`, and, when needed, `v2/docs/v1-behaviors.md` describe the landed behavior without duplicating implementation detail.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` are green.
