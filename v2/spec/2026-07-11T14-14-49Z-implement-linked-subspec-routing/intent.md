---
name: implement-linked-subspec-routing
---

# Route implement iterations to the active linked subspec

For `--spec .../index.md`, each implement iteration targets the first unchecked linked subspec. Its body is injected into the write prompt and its path is the expected completion artifact.

The harness, not the agent, advances the index checkbox after a linked subspec completes. Agents tick only acceptance criteria in the active subspec. Routing advances to the next link on later iterations.

## Decisions

- The first unchecked linked subspec is the iteration target, not the entire index; rules out agents choosing their own task order.
- Harness updates index links, while agents update active subspec criteria; rules out agent-owned routing state.
- The active subspec path is the completion artifact, not a caller-provided artifact; rules out stale completion checks.

## Documentation updates

- Update `v2/docs/write-behavior.md` with active-linked-subspec prompt routing and harness-owned index advancement.

## Acceptance criteria

- [ ] A multi-subspec index injects only the active linked subspec into each implement prompt.
- [ ] Completion checking follows the active linked subspec.
- [ ] Completing a linked subspec updates its index checkbox through the harness and routes the next iteration to the next unchecked link.
- [ ] Tests cover routing across a multi-subspec index and preserve agent-only acceptance-criteria edits.

## Prerequisites

- Generic workflow launching is available.
- The `implement` preset exists.
