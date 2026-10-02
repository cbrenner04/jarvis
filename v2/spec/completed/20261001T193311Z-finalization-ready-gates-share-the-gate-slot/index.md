# Harness finalization gates share the one-per-daemon gate slot

The one-per-daemon full-suite gate slot in `write-loop.ts` is acquired only by agent-invoked gates; harness finalization and terminal-publication gates spawn without it, so concurrent lane publications run several full suites at once and false-red on load.

- [x] [00-gate-invocation-lease-module.md](00-gate-invocation-lease-module.md) — extract lease module; FIFO `awaitGateInvocationLease`
- [x] [01-finalization-gates-wait-for-slot.md](01-finalization-gates-wait-for-slot.md) — `publishCompletionArtifacts` gates wait, log, and list surfacing
- [x] [02-terminal-publication-gate-holds-slot.md](02-terminal-publication-gate-holds-slot.md) — terminal-publication ready gate holds the slot
- [x] [03-finalization-lease-release-redrives-agents.md](03-finalization-lease-release-redrives-agents.md) — harness lease releases wake slot-refused agent gates
