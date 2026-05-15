# 04 — Plan mode agent order (config v2)

**Note:** This subspec is superseded by
`spec/cli-modes-and-config-v2/00-config-v2-modes.md` and
`spec/cli-modes-and-config-v2/02-config-cli-and-docs.md`, which implement
config v2 with enforced `modes.patch.agentOrder` and `modes.plan.agentOrder`
keys (not optional). See those specs for the current schema, validation rules,
and `jarvis config` subcommands.

The original problem this subspec solved remains valid: plan mode and patch
mode are different workloads and the user may want a different agent
preference order for each. That is now handled by the v2 `modes` structure
where both patch and plan mode orders are required keys in the config.

## Decisions

- **Type.** `planAgentOrder?: AgentName[]`. Same `AgentName` union as
  `agentOrder`. No new agent names are introduced.
- **Default in serialized config.** **Omitted entirely** from the
  default config emitted by auto-bootstrap. An absent key means "fall
  back to `agentOrder`" at consumption time (handled by a later
  spec). The key is either present with at least one agent or absent
  entirely — there is no third "explicit empty" state. The fallback
  semantics are implemented in a later spec.
- **Validation.**
  - When present, must be an array of valid `AgentName` values.
  - Duplicates are rejected with the same error wording as `agentOrder`.
  - **Empty array is rejected.** A user invoking `jarvis config
    set-plan-order` is asserting they want a plan-mode order; an
    empty list is almost certainly a typo (e.g. `set-plan-order ""`).
    Reject with: `set-plan-order requires at least one agent; use
    \`unset-plan-order\` to clear plan-mode order and fall back to
    agentOrder`. Exit `1`. The on-disk schema *also* rejects an
    explicit empty `planAgentOrder: []` for the same reason: there
    is no semantic an empty array could carry that `unset` does not
    already cover.
  - Unknown agent names rejected with the same error wording as
    `agentOrder`.
- **`jarvis config` subcommands:**
  - `jarvis config set-plan-order <a,b,c>` — sets the comma-separated
    list. Same parsing/validation as `set-order`.
  - `jarvis config unset-plan-order` — removes the key from the config
    file (returns to "fall back to agentOrder" behavior).
  - `jarvis config show` — when `planAgentOrder` is present, prints it
    on its own line; when absent, prints `planAgentOrder: (unset; uses
    agentOrder)`.
- **Schema version.** Stays at the current version. This is an additive,
  optional field; legacy configs without the key remain valid.
- **No consumption yet.** No code path reads `planAgentOrder` in this
  spec. A later spec wires it into the plan-mode agent factory call.

## Implementation hints

- Look at how `agentOrder` is parsed by `set-order` (likely
  `src/commands/config.ts` and `src/config.ts`) and clone the same shape
  for `set-plan-order`.
- The `show` subcommand likely renders config as a known-key list; add
  the new key with the documented "unset" sentinel.

## Tasks

- [ ] Add `planAgentOrder?: AgentName[]` to the config type.
- [ ] Update validation to accept the new key and reject the same
  failure modes `agentOrder` rejects.
- [ ] Implement `jarvis config set-plan-order`, `unset-plan-order`, and
  the `show` change.
- [ ] Tests:
  - Auto-bootstrap omits `planAgentOrder` from the written file.
  - Loading a config with `planAgentOrder: ["claude"]` round-trips.
  - Loading a config with `planAgentOrder: []` is rejected at load
    time with the documented error wording.
  - `set-plan-order claude,codex` writes the expected file shape.
  - `set-plan-order ""` (empty arg) is rejected with the documented
    error wording.
  - `set-plan-order claude,claude` fails with the duplicate error.
  - `set-plan-order claude,nonsense` fails with the unknown-agent
    error.
  - `unset-plan-order` removes the key from disk.
  - `show` reflects both the present and absent cases.

## Acceptance criteria

- [ ] `planAgentOrder` is an optional config key, validated and
  round-tripped per the rules above.
- [ ] `jarvis config set-plan-order`, `unset-plan-order`, and the
  updated `show` output behave as specified.
- [ ] Legacy configs without the key continue to load and pass
  validation unchanged.
- [ ] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 06 covers README and docs.
