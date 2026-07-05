---
name: local-model-terminal-agent-order
---
# Local Model Terminal Agent Order

# Local model as terminal agent-order entry

On the personal machine, the agent fallback order gains a local model (qwen
via opencode + ollama) as its last entry, so a run falls through to a local
model instead of stopping when every remote agent is exhausted.

## Prerequisites

- Per-machine agent fallback order and role→model store are implemented
