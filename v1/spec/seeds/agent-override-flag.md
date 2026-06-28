# `--agent` override to force a specific agent for one invocation

No jarvis command lets the operator force a specific agent/model; selection always
walks the configured `agentOrder` (tier/floor/quota resolution). When verifying a
newly-configured agent (e.g. confirming opencode's Zen model works after a config
change), the only way to exercise it is to hand-edit `~/.jarvis/config.json` to
reorder the block, run, then restore — fragile manual config surgery for a routine check.

## Decisions

- Add a global `--agent <name>` flag (optionally `--agent <name>:<model>` or a paired
  `--model`) honored by at least `jarvis1 prompt` (cheapest one-shot probe), pinning
  selection to that agent for the invocation; rules out config surgery to test an agent.
- The override bypasses `agentOrder` for primary selection but keeps normal
  quota/error handling; rules out a parallel selection path that masks real failures.
- Unknown/unconfigured agent name exits non-zero with the valid set; rules out silent
  fallback to the configured order when the operator asked for a specific agent.
- Scope to `prompt` first (the verification path); fold into other modes only if a
  consumer needs it; rules out speculative wiring across every mode.

## Documentation updates

- `v1/docs/operator-runbook.md` — note `--agent` as the way to verify a configured
  agent; remove the config-surgery workaround once this ships (cleanup trigger).
- `v1/docs/agents.md` — document the override flag and precedence vs `agentOrder`.
