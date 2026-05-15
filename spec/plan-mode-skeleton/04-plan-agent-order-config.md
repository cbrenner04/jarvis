# 04 — Plan mode agent order (config v2)

**Note:** This subspec is superseded by
`spec/cli-modes-and-config-v2/00-config-v2-modes.md` and
`spec/cli-modes-and-config-v2/02-config-cli-and-docs.md`, which implement
config v2 with enforced `modes.patch.agentOrder` and `modes.plan.agentOrder`
keys (not optional). See those specs for the current schema, validation rules,
and `jarvis config` subcommands.

Plan mode will eventually call agents to draft and self-review specs. Patch
mode and plan mode are different workloads (structured writing vs. code edits),
and the user may want a different agent preference order for each.
`spec/cli-modes-and-config-v2/` now owns that distinction through the v2 config
shape:

```ts
modes: {
  patch: { agentOrder: AgentName[] };
  plan: { agentOrder: AgentName[] };
}
```

This subspec updates the skeleton contract so it no longer introduces the
superseded optional `planAgentOrder` key or fallback-to-patch semantics.

## Decisions

- **No `planAgentOrder`.** The optional key, "unset plan order", and
  "fall back to `agentOrder`" behavior are obsolete. Valid configs use
  `modes.plan.agentOrder` only.
- **No schema work here.** Validation, bootstrap, `jarvis config show`, and
  mode-order setter commands are implemented by
  `spec/cli-modes-and-config-v2/`. This subspec only verifies the skeleton
  does not reintroduce the old shape.
- **No consumption yet.** No code path invokes agents in this spec. Later
  behavior specs consume `config.modes.plan.agentOrder` when selecting plan
  agents.

## Implementation hints

- Search the skeleton implementation for `planAgentOrder` and
  `unset-plan-order`; neither should be added by this spec.
- If tests need a config fixture, use a v2 fixture with both
  `modes.patch.agentOrder` and `modes.plan.agentOrder` present.

## Tasks

- [ ] Remove any skeleton-spec implementation or tests that add
  `planAgentOrder` or `unset-plan-order`.
- [ ] Update plan-mode tests and fixtures to use v2 `modes.plan.agentOrder`
  when a config object is required.
- [ ] Add a regression assertion (test or static fixture check) that the
  skeleton's default/bootstrap expectations do not include `planAgentOrder`.

## Acceptance criteria

- [x] Plan-mode skeleton code and tests do not introduce or depend on
  `planAgentOrder`.
- [x] Any skeleton config fixture uses v2 `modes.plan.agentOrder`.
- [x] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 06 covers README and docs.
