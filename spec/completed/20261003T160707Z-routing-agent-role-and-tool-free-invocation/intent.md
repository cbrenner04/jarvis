---
name: routing-agent-role-and-tool-free-invocation
---

# A routing role invokes a cheap agent with no tools and minimal context

## Problem

Every agent binding in `shared/invocation/agents.ts` launches a vendor CLI with its native coding tools. Routing needs a cheap, tool-free translation call that `v2/src/config/agent-model-config.ts` has no role for.

## Decisions

- A `routing` executable role joins `EXECUTABLE_ROLES` and resolves its model through the existing machine-profile rungs; no new model-ranking system.
- The routing invocation disables execution tools, repository browsing, and inherited coding-agent permissions; it receives only the action catalog and the minimal explicit context needed for translation. Plan must decide how tool-free invocation is enforced per vendor and what a vendor that cannot enforce it does (refuse, not degrade).
- Routing time and output are bounded; a timeout or malformed output is a named failure, not a retry loop.

## Prerequisites

- The action catalog defines what the routing prompt may select (delivered by: routing-action-catalog-and-validation)

## Acceptance criteria

- [x] `agent-model-config.test.ts`: `routing` resolves a binding from the machine profile like other roles; fails against current code (unknown role).
- [x] `agents.test.ts`: the routing invocation's argv for each vendor carries that vendor's tool-disabling form and no read-dir or workspace grants; an attempted tool call in the routing transcript is a named failure; fails against current code.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/agent-model-config.md` — routing role, model selection, and the tool-free invocation contract.

## Primary implementation surface

- `v2/src/config/agent-model-config.ts`
- `shared/invocation/agents.ts`
- `config/machines/*.json`
